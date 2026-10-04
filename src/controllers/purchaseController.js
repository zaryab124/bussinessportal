const { query, transaction } = require('../config/db');
const { formatCurrency, add, multiply, divide, toDecimal } = require('../utils/decimal');
const { logAudit } = require('../utils/auditLogger');
const { recordPurchaseLedger } = require('../services/ledgerService');

// Generate unique PO reference
function generatePoNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${dateStr}-${randomStr}`;
}

// Record new purchase order with weighted average unit costing (Super Admin only)
async function createPurchase(req, res) {
  try {
    const {
      purchaseOrderNumber,
      supplierName,
      purchaseDate,
      items,
      notes
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A purchase order must contain at least one item.'
      });
    }

    const poNumber = (purchaseOrderNumber && String(purchaseOrderNumber).trim()) || generatePoNumber();
    const poDate = purchaseDate || new Date().toISOString().split('T')[0];
    const supplier = supplierName ? String(supplierName).trim() : 'Standard Supplier';

    // Validate items
    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const costVal = item.unitCost !== undefined ? item.unitCost : item.unit_cost;
      const cost = toDecimal(costVal);
      const prodId = item.productId || item.product_id;

      if (!prodId || isNaN(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Each item must specify a valid product and a quantity greater than zero.'
        });
      }

      if (cost.isNegative()) {
        return res.status(400).json({
          success: false,
          message: 'Item unit cost cannot be negative.'
        });
      }
    }

    const recordedPurchase = await transaction(async (client) => {
      // 1. Create stock_purchases record
      const poRes = await client.query(`
        INSERT INTO stock_purchases (
          purchase_order_number, supplier_name, purchase_date, total_cost, status, notes, recorded_by
        ) VALUES ($1, $2, $3, 0.00, 'completed', $4, $5)
        RETURNING *
      `, [poNumber, supplier, poDate, notes ? String(notes).trim() : null, req.user.id]);

      const purchase = poRes.rows[0];
      let orderTotalCost = '0.00';

      // 2. Process each item and apply weighted average stock costing
      for (const item of items) {
        const productId = parseInt(item.productId || item.product_id, 10);
        const qtyPurchased = parseInt(item.quantity, 10);
        const costVal = item.unitCost !== undefined ? item.unitCost : item.unit_cost;
        const unitCost = toDecimal(costVal).toFixed(2);
        const itemTotal = multiply(unitCost, qtyPurchased);
        orderTotalCost = add(orderTotalCost, itemTotal);

        // Insert purchase item
        await client.query(`
          INSERT INTO purchase_items (
            purchase_id, product_id, quantity, unit_cost, total_cost
          ) VALUES ($1, $2, $3, $4, $5)
        `, [purchase.id, productId, qtyPurchased, unitCost, itemTotal]);

        // Lock product row to prevent race conditions during cost calculation
        const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
        if (prodRes.rows.length === 0) {
          throw new Error(`Product with ID ${productId} not found.`);
        }

        const product = prodRes.rows[0];
        const currentQtyAvailable = product.quantity_available;
        const currentUnitCost = product.purchase_cost_per_unit;

        // Weighted Moving Average Unit Cost Calculation:
        // New Cost = ((Current Qty * Current Cost) + (New Qty * New Cost)) / (Current Qty + New Qty)
        let updatedWeightedCost = unitCost;
        const newTotalQty = currentQtyAvailable + qtyPurchased;

        if (currentQtyAvailable > 0) {
          const currentValue = multiply(currentQtyAvailable, currentUnitCost);
          const incomingValue = multiply(qtyPurchased, unitCost);
          const combinedValue = add(currentValue, incomingValue);
          updatedWeightedCost = divide(combinedValue, newTotalQty);
        } else {
          // If available stock was 0, new cost is the incoming purchase cost
          updatedWeightedCost = unitCost;
        }

        const updatedAvailable = currentQtyAvailable + qtyPurchased;
        const updatedTotalPurchased = product.quantity_purchased + qtyPurchased;

        // Determine updated status
        let updatedStatus = product.status;
        if (product.status === 'Sold Out' || product.status === 'Draft') {
          updatedStatus = 'Available';
        }

        // Update product record
        await client.query(`
          UPDATE products
          SET purchase_cost_per_unit = $1,
              quantity_available = $2,
              quantity_purchased = $3,
              status = $4,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $5
        `, [updatedWeightedCost, updatedAvailable, updatedTotalPurchased, updatedStatus, productId]);

        // Insert inventory movement
        await client.query(`
          INSERT INTO inventory_movements (
            product_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, recorded_by
          ) VALUES ($1, 'purchase_in', $2, $3, 'purchase_order', $4, $5, $6)
        `, [
          productId,
          qtyPurchased,
          unitCost,
          purchase.id,
          `Purchase Order ${poNumber} from ${supplier}`,
          req.user.id
        ]);
      }

      // Update total cost in purchase record
      await client.query(`
        UPDATE stock_purchases
        SET total_cost = $1
        WHERE id = $2
      `, [orderTotalCost, purchase.id]);

      purchase.total_cost = orderTotalCost;
      // Record double-entry financial ledger lines for purchase
      await recordPurchaseLedger(client, purchase, req.user.id);

      return purchase;
    });

    await logAudit({
      userId: req.user.id,
      action: 'PURCHASE_ORDER_RECORDED',
      entityType: 'stock_purchases',
      entityId: recordedPurchase.id,
      newValues: { poNumber, supplier, totalCost: recordedPurchase.total_cost, itemCount: items.length },
      req
    });

    return res.status(201).json({
      success: true,
      message: `Purchase order ${recordedPurchase.purchase_order_number} recorded successfully.`,
      purchase: {
        ...recordedPurchase,
        total_cost: formatCurrency(recordedPurchase.total_cost)
      }
    });
  } catch (err) {
    console.error('[CreatePurchase Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to record purchase order.'
    });
  }
}

// List all purchase orders
async function listPurchases(req, res) {
  try {
    const result = await query(`
      SELECT sp.id, sp.purchase_order_number, sp.supplier_name, sp.purchase_date,
             sp.total_cost, sp.status, sp.notes, sp.created_at,
             u.full_name as recorder_name,
             COUNT(pi.id) as item_count
      FROM stock_purchases sp
      LEFT JOIN users u ON sp.recorded_by = u.id
      LEFT JOIN purchase_items pi ON sp.id = pi.purchase_id
      GROUP BY sp.id, u.full_name
      ORDER BY sp.id DESC
    `);

    const formatted = result.rows.map(p => ({
      ...p,
      total_cost: formatCurrency(p.total_cost),
      item_count: parseInt(p.item_count, 10)
    }));

    return res.json({
      success: true,
      purchases: formatted
    });
  } catch (err) {
    console.error('[ListPurchases Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve purchase orders.'
    });
  }
}

// Get single purchase order by ID with line items
async function getPurchaseById(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid purchase order ID.' });
    }

    const poRes = await query(`
      SELECT sp.*, u.full_name as recorder_name
      FROM stock_purchases sp
      LEFT JOIN users u ON sp.recorded_by = u.id
      WHERE sp.id = $1
    `, [id]);

    if (poRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Purchase order not found.' });
    }

    const itemsRes = await query(`
      SELECT pi.*, p.sku, p.name as product_name
      FROM purchase_items pi
      JOIN products p ON pi.product_id = p.id
      WHERE pi.purchase_id = $1
      ORDER BY pi.id ASC
    `, [id]);

    const formattedItems = itemsRes.rows.map(it => ({
      ...it,
      unit_cost: formatCurrency(it.unit_cost),
      total_cost: formatCurrency(it.total_cost)
    }));

    return res.json({
      success: true,
      purchase: {
        ...poRes.rows[0],
        total_cost: formatCurrency(poRes.rows[0].total_cost),
        items: formattedItems
      }
    });
  } catch (err) {
    console.error('[GetPurchaseById Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve purchase order details.'
    });
  }
}

// List all inventory movements (Audit history of all stock inflows, outflows, adjustments)
async function listMovements(req, res) {
  try {
    const { productId, movementType, limit = 50 } = req.query;

    let sql = `
      SELECT im.*, p.sku, p.name as product_name, u.full_name as recorder_name
      FROM inventory_movements im
      JOIN products p ON im.product_id = p.id
      LEFT JOIN users u ON im.recorded_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (productId) {
      params.push(parseInt(productId, 10));
      sql += ` AND im.product_id = $${params.length}`;
    }

    if (movementType) {
      params.push(movementType);
      sql += ` AND im.movement_type = $${params.length}`;
    }

    params.push(parseInt(limit, 10) || 50);
    sql += ` ORDER BY im.id DESC LIMIT $${params.length}`;

    const result = await query(sql, params);

    const formatted = result.rows.map(m => ({
      ...m,
      unit_cost: formatCurrency(m.unit_cost)
    }));

    return res.json({
      success: true,
      movements: formatted
    });
  } catch (err) {
    console.error('[ListMovements Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve inventory movement logs.'
    });
  }
}

module.exports = {
  createPurchase,
  listPurchases,
  getPurchaseById,
  listMovements
};
