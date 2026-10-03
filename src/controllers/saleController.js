const { query, transaction } = require('../config/db');
const { formatCurrency, add, subtract, multiply, toDecimal } = require('../utils/decimal');
const { logAudit } = require('../utils/auditLogger');
const { recordSaleLedger, reverseSaleLedger } = require('../services/ledgerService');
const { allocateSaleProfit, reverseSaleProfitAllocations } = require('../services/profitEngine');

// Generate unique invoice number: INV-YYYYMMDD-XXXX
function generateInvoiceNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${dateStr}-${randomStr}`;
}

// Record new confirmed sale (Super Admin only)
async function createSale(req, res) {
  try {
    const {
      saleInvoiceNumber,
      saleDate,
      paymentMethod = 'cash',
      paymentStatus = 'paid',
      customerReference,
      directExpenses = 0,
      priceOverrideApproved = false,
      priceOverrideReason = null,
      items
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A sale transaction must contain at least one product item.'
      });
    }

    const invoiceNo = (saleInvoiceNumber && String(saleInvoiceNumber).trim()) || generateInvoiceNumber();
    const saleTimestamp = saleDate ? new Date(saleDate).toISOString() : new Date().toISOString();
    const expenseAmount = toDecimal(directExpenses).toFixed(2);

    // Check duplicate invoice number
    const dupCheck = await query('SELECT id FROM sales WHERE sale_invoice_number = $1', [invoiceNo]);
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Sale with invoice number "${invoiceNo}" already exists.`
      });
    }

    // Validate items
    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      const price = toDecimal(item.unitSellingPrice);

      if (!item.productId || isNaN(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Each item must specify a valid product and a quantity greater than zero.'
        });
      }

      if (price.lessThanOrEqualTo(0)) {
        return res.status(400).json({
          success: false,
          message: 'Unit selling price must be greater than zero.'
        });
      }
    }

    const recordedSale = await transaction(async (client) => {
      let totalRevenue = '0.00';
      let totalCogs = '0.00';
      let hasPriceOverride = false;
      const verifiedItems = [];

      // 1. Validate each product: price range check & overselling check
      for (const item of items) {
        const productId = parseInt(item.productId, 10);
        const qtySold = parseInt(item.quantity, 10);
        const unitSellingPrice = toDecimal(item.unitSellingPrice).toFixed(2);

        // Lock product row to prevent overselling race conditions
        const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
        if (prodRes.rows.length === 0) {
          throw new Error(`Product with ID ${productId} does not exist.`);
        }

        const product = prodRes.rows[0];

        // Overselling prevention
        if (product.quantity_available < qtySold) {
          throw new Error(
            `Insufficient stock for "${product.name}" (${product.sku}). Requested: ${qtySold}, Available: ${product.quantity_available}.`
          );
        }

        // Expected Price Range Verification (Section 4 requirement)
        const minPrice = toDecimal(product.min_selling_price);
        const maxPrice = toDecimal(product.max_selling_price);
        const sellingPriceDec = toDecimal(unitSellingPrice);

        const isOutsideRange = sellingPriceDec.lessThan(minPrice) || sellingPriceDec.greaterThan(maxPrice);
        if (isOutsideRange) {
          if (!priceOverrideApproved || !priceOverrideReason || String(priceOverrideReason).trim().length === 0) {
            throw new Error(
              `Selling price Rs. ${unitSellingPrice} for "${product.name}" is outside configured range (Rs. ${product.min_selling_price} – Rs. ${product.max_selling_price}). Authorized approval and documented reason are required.`
            );
          }
          hasPriceOverride = true;
        }

        // Financial Subtotals (using moving average purchase cost)
        const unitPurchaseCost = formatCurrency(product.purchase_cost_per_unit);
        const subtotalRevenue = multiply(unitSellingPrice, qtySold);
        const subtotalCogs = multiply(unitPurchaseCost, qtySold);
        const subtotalProfit = subtract(subtotalRevenue, subtotalCogs);

        totalRevenue = add(totalRevenue, subtotalRevenue);
        totalCogs = add(totalCogs, subtotalCogs);

        // Deduct inventory
        const newAvailable = product.quantity_available - qtySold;
        let newStatus = product.status;
        if (newAvailable === 0) {
          newStatus = 'Sold Out';
        } else if (newAvailable < product.quantity_purchased) {
          newStatus = 'Partially Sold';
        }

        await client.query(`
          UPDATE products
          SET quantity_available = $1, status = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [newAvailable, newStatus, productId]);

        verifiedItems.push({
          productId,
          qtySold,
          unitPurchaseCost,
          unitSellingPrice,
          subtotalRevenue,
          subtotalCogs,
          subtotalProfit,
          productName: product.name,
          sku: product.sku
        });
      }

      // Net profit = Revenue - COGS - Direct Expenses
      const grossProfit = subtract(totalRevenue, totalCogs);
      const netProfit = subtract(grossProfit, expenseAmount);

      // 2. Insert sales master record
      const saleRes = await client.query(`
        INSERT INTO sales (
          sale_invoice_number, sale_date, total_revenue, total_cost_of_goods, total_direct_expenses,
          net_profit, payment_method, payment_status, customer_reference,
          price_override_approved, price_override_reason, recorded_by, status
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, 'confirmed'
        )
        RETURNING *
      `, [
        invoiceNo,
        saleTimestamp,
        totalRevenue,
        totalCogs,
        expenseAmount,
        netProfit,
        paymentMethod,
        paymentStatus,
        customerReference ? String(customerReference).trim() : null,
        hasPriceOverride,
        hasPriceOverride ? String(priceOverrideReason).trim() : null,
        req.user.id
      ]);

      const sale = saleRes.rows[0];

      // 3. Insert sale_items and inventory_movements records
      for (const item of verifiedItems) {
        await client.query(`
          INSERT INTO sale_items (
            sale_id, product_id, quantity, unit_purchase_cost, unit_selling_price,
            subtotal_revenue, subtotal_cogs, subtotal_profit
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          sale.id,
          item.productId,
          item.qtySold,
          item.unitPurchaseCost,
          item.unitSellingPrice,
          item.subtotalRevenue,
          item.subtotalCogs,
          item.subtotalProfit
        ]);

        await client.query(`
          INSERT INTO inventory_movements (
            product_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, recorded_by
          ) VALUES ($1, 'sale_out', $2, $3, 'sale', $4, $5, $6)
        `, [
          item.productId,
          item.qtySold,
          item.unitPurchaseCost,
          sale.id,
          `Sale Invoice ${invoiceNo} (${item.qtySold} sold @ Rs. ${item.unitSellingPrice})`,
          req.user.id
        ]);
      }

      // 4. Record double-entry financial ledger lines
      await recordSaleLedger(client, sale, req.user.id);

      // 5. Automatically allocate net profit to owners and brand reinvestment
      const allocations = await allocateSaleProfit(client, sale.id, sale.net_profit, req.user.id);

      return {
        ...sale,
        items: verifiedItems,
        allocations
      };
    });

    await logAudit({
      userId: req.user.id,
      action: 'SALE_RECORDED',
      entityType: 'sales',
      entityId: recordedSale.id,
      newValues: {
        invoiceNumber: recordedSale.sale_invoice_number,
        totalRevenue: recordedSale.total_revenue,
        cogs: recordedSale.total_cost_of_goods,
        netProfit: recordedSale.net_profit,
        itemCount: recordedSale.items.length
      },
      req
    });

    return res.status(201).json({
      success: true,
      message: `Sale ${recordedSale.sale_invoice_number} recorded successfully.`,
      sale: {
        ...recordedSale,
        total_revenue: formatCurrency(recordedSale.total_revenue),
        total_cost_of_goods: formatCurrency(recordedSale.total_cost_of_goods),
        total_direct_expenses: formatCurrency(recordedSale.total_direct_expenses),
        net_profit: formatCurrency(recordedSale.net_profit)
      }
    });
  } catch (err) {
    console.error('[CreateSale Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to record sale.'
    });
  }
}

// List all sales
async function listSales(req, res) {
  try {
    const { status, paymentStatus } = req.query;

    let sql = `
      SELECT s.id, s.sale_invoice_number, s.sale_date, s.total_revenue, s.total_cost_of_goods,
             s.total_direct_expenses, s.net_profit, s.payment_method, s.payment_status,
             s.customer_reference, s.price_override_approved, s.price_override_reason,
             s.status, s.created_at,
             u.full_name as recorder_name,
             COUNT(si.id) as item_count
      FROM sales s
      LEFT JOIN users u ON s.recorded_by = u.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND s.status = $${params.length}`;
    }

    if (paymentStatus && paymentStatus !== 'all') {
      params.push(paymentStatus);
      sql += ` AND s.payment_status = $${params.length}`;
    }

    sql += ' GROUP BY s.id, u.full_name ORDER BY s.id DESC';

    const result = await query(sql, params);

    const formatted = result.rows.map(s => ({
      ...s,
      total_revenue: formatCurrency(s.total_revenue),
      total_cost_of_goods: formatCurrency(s.total_cost_of_goods),
      total_direct_expenses: formatCurrency(s.total_direct_expenses),
      net_profit: formatCurrency(s.net_profit),
      item_count: parseInt(s.item_count, 10)
    }));

    return res.json({
      success: true,
      sales: formatted
    });
  } catch (err) {
    console.error('[ListSales Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve sales records.'
    });
  }
}

// Get single sale by ID with itemized line items
async function getSaleById(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sale ID.' });
    }

    const saleRes = await query(`
      SELECT s.*, u.full_name as recorder_name
      FROM sales s
      LEFT JOIN users u ON s.recorded_by = u.id
      WHERE s.id = $1
    `, [id]);

    if (saleRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sale not found.' });
    }

    const itemsRes = await query(`
      SELECT si.*, p.sku, p.name as product_name
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      WHERE si.sale_id = $1
      ORDER BY si.id ASC
    `, [id]);

    const formattedItems = itemsRes.rows.map(it => ({
      ...it,
      unit_purchase_cost: formatCurrency(it.unit_purchase_cost),
      unit_selling_price: formatCurrency(it.unit_selling_price),
      subtotal_revenue: formatCurrency(it.subtotal_revenue),
      subtotal_cogs: formatCurrency(it.subtotal_cogs),
      subtotal_profit: formatCurrency(it.subtotal_profit)
    }));

    return res.json({
      success: true,
      sale: {
        ...saleRes.rows[0],
        total_revenue: formatCurrency(saleRes.rows[0].total_revenue),
        total_cost_of_goods: formatCurrency(saleRes.rows[0].total_cost_of_goods),
        total_direct_expenses: formatCurrency(saleRes.rows[0].total_direct_expenses),
        net_profit: formatCurrency(saleRes.rows[0].net_profit),
        items: formattedItems
      }
    });
  } catch (err) {
    console.error('[GetSaleById Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve sale details.'
    });
  }
}

// Traceable cancellation of a sale and inventory restoration (Super Admin only)
async function cancelSale(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { cancellationReason } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sale ID.' });
    }

    if (!cancellationReason || String(cancellationReason).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A documented cancellation reason is required for financial trace.'
      });
    }

    const cancelledSale = await transaction(async (client) => {
      const saleRes = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [id]);
      if (saleRes.rows.length === 0) {
        throw new Error('Sale not found.');
      }

      const sale = saleRes.rows[0];
      if (sale.status !== 'confirmed') {
        throw new Error(`Cannot cancel a sale with status "${sale.status}".`);
      }

      // Fetch items to reverse stock
      const itemsRes = await client.query('SELECT * FROM sale_items WHERE sale_id = $1', [id]);

      for (const item of itemsRes.rows) {
        const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);
        const product = prodRes.rows[0];

        const restoredQty = product.quantity_available + item.quantity;
        let restoredStatus = product.status;
        if (restoredQty >= product.quantity_purchased) {
          restoredStatus = 'Available';
        } else if (restoredQty > 0) {
          restoredStatus = 'Partially Sold';
        }

        // Restore stock
        await client.query(`
          UPDATE products
          SET quantity_available = $1, status = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [restoredQty, restoredStatus, item.product_id]);

        // Record return movement
        await client.query(`
          INSERT INTO inventory_movements (
            product_id, movement_type, quantity, unit_cost, reference_type, reference_id, notes, recorded_by
          ) VALUES ($1, 'sale_return_in', $2, $3, 'sale_cancellation', $4, $5, $6)
        `, [
          item.product_id,
          item.quantity,
          item.unit_purchase_cost,
          sale.id,
          `Sale Cancellation (${sale.sale_invoice_number}): ${String(cancellationReason).trim()}`,
          req.user.id
        ]);
      }

      // Mark sale as cancelled
      const updateSaleRes = await client.query(`
        UPDATE sales
        SET status = 'cancelled', payment_status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `, [id]);

      // Reverse financial ledger entries traceably
      await reverseSaleLedger(client, sale, req.user.id, cancellationReason);

      // Reverse profit allocations
      await reverseSaleProfitAllocations(client, sale.id);

      return updateSaleRes.rows[0];
    });

    await logAudit({
      userId: req.user.id,
      action: 'SALE_CANCELLED',
      entityType: 'sales',
      entityId: id,
      newValues: { invoiceNumber: cancelledSale.sale_invoice_number, reason: cancellationReason },
      req
    });

    return res.json({
      success: true,
      message: `Sale ${cancelledSale.sale_invoice_number} has been cancelled and inventory restored.`,
      sale: cancelledSale
    });
  } catch (err) {
    console.error('[CancelSale Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to cancel sale.'
    });
  }
}

module.exports = {
  createSale,
  listSales,
  getSaleById,
  cancelSale
};
