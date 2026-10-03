const { query, transaction } = require('../config/db');
const { formatCurrency, multiply, toDecimal } = require('../utils/decimal');
const { logAudit } = require('../utils/auditLogger');

// List products with optional status, category, and keyword search
async function listProducts(req, res) {
  try {
    const { status, category, search } = req.query;

    let sql = `
      SELECT id, sku, name, category, description, condition, location, supplier,
             purchase_date, purchase_cost_per_unit, quantity_purchased, quantity_available,
             min_selling_price, max_selling_price, status, created_at, updated_at
      FROM products
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    if (category && category !== 'all') {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.trim().toLowerCase()}%`);
      sql += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(sku) LIKE $${params.length})`;
    }

    sql += ' ORDER BY id DESC';

    const result = await query(sql, params);

    // Format records with decimal-safe strings and valuation
    const formatted = result.rows.map(p => {
      const unitCost = formatCurrency(p.purchase_cost_per_unit);
      const minPrice = formatCurrency(p.min_selling_price);
      const maxPrice = formatCurrency(p.max_selling_price);
      const valuation = multiply(unitCost, p.quantity_available);

      return {
        ...p,
        purchase_cost_per_unit: unitCost,
        min_selling_price: minPrice,
        max_selling_price: maxPrice,
        inventory_valuation: valuation
      };
    });

    return res.json({
      success: true,
      products: formatted
    });
  } catch (err) {
    console.error('[ListProducts Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve inventory products.'
    });
  }
}

// Get inventory summary statistics
async function getProductStats(req, res) {
  try {
    const countsRes = await query(`
      SELECT
        COUNT(*) AS total_items,
        COALESCE(SUM(quantity_available), 0) AS total_available_units,
        COUNT(*) FILTER (WHERE status = 'Available') AS available_listings,
        COUNT(*) FILTER (WHERE status = 'Partially Sold') AS partially_sold_listings,
        COUNT(*) FILTER (WHERE status = 'Sold Out') AS sold_out_listings,
        COUNT(*) FILTER (WHERE status = 'Archived') AS archived_listings,
        COUNT(*) FILTER (WHERE quantity_available <= 2 AND quantity_available > 0 AND status != 'Archived') AS low_stock_count,
        COALESCE(SUM(quantity_available * purchase_cost_per_unit), 0) AS total_inventory_valuation
      FROM products
    `);

    const stats = countsRes.rows[0];

    return res.json({
      success: true,
      stats: {
        totalItems: parseInt(stats.total_items, 10),
        totalAvailableUnits: parseInt(stats.total_available_units, 10),
        availableListings: parseInt(stats.available_listings, 10),
        partiallySoldListings: parseInt(stats.partially_sold_listings, 10),
        soldOutListings: parseInt(stats.sold_out_listings, 10),
        archivedListings: parseInt(stats.archived_listings, 10),
        lowStockCount: parseInt(stats.low_stock_count, 10),
        totalInventoryValuation: formatCurrency(stats.total_inventory_valuation)
      }
    });
  } catch (err) {
    console.error('[GetProductStats Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve inventory statistics.'
    });
  }
}

// Get single product details by ID
async function getProductById(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const prodRes = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const product = prodRes.rows[0];

    // Fetch media
    const mediaRes = await query('SELECT * FROM product_media WHERE product_id = $1 ORDER BY is_primary DESC, id ASC', [id]);

    // Fetch recent inventory movements
    const movementsRes = await query(`
      SELECT im.*, u.full_name as recorder_name
      FROM inventory_movements im
      LEFT JOIN users u ON im.recorded_by = u.id
      WHERE im.product_id = $1
      ORDER BY im.id DESC LIMIT 20
    `, [id]);

    return res.json({
      success: true,
      product: {
        ...product,
        purchase_cost_per_unit: formatCurrency(product.purchase_cost_per_unit),
        min_selling_price: formatCurrency(product.min_selling_price),
        max_selling_price: formatCurrency(product.max_selling_price),
        inventory_valuation: multiply(product.purchase_cost_per_unit, product.quantity_available),
        media: mediaRes.rows,
        movements: movementsRes.rows
      }
    });
  } catch (err) {
    console.error('[GetProductById Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch product details.'
    });
  }
}

// Create new product listing (Super Admin only)
async function createProduct(req, res) {
  try {
    const {
      sku,
      name,
      category,
      description,
      condition = 'New',
      location,
      supplier,
      purchaseDate,
      purchaseCostPerUnit,
      quantityPurchased,
      minSellingPrice,
      maxSellingPrice
    } = req.body;

    if (!sku || !name) {
      return res.status(400).json({
        success: false,
        message: 'Product SKU and Name are required.'
      });
    }

    const cleanSku = String(sku).trim().toUpperCase();
    const cleanName = String(name).trim();

    // Check SKU uniqueness
    const existing = await query('SELECT id FROM products WHERE sku = $1', [cleanSku]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Product with SKU "${cleanSku}" already exists.`
      });
    }

    const cost = toDecimal(purchaseCostPerUnit);
    const minPrice = toDecimal(minSellingPrice);
    const maxPrice = toDecimal(maxSellingPrice);
    const qty = parseInt(quantityPurchased, 10) || 0;

    if (cost.isNegative()) {
      return res.status(400).json({ success: false, message: 'Purchase cost per unit cannot be negative.' });
    }

    if (minPrice.isNegative() || maxPrice.isNegative()) {
      return res.status(400).json({ success: false, message: 'Selling prices cannot be negative.' });
    }

    if (maxPrice.lessThan(minPrice)) {
      return res.status(400).json({
        success: false,
        message: 'Maximum selling price cannot be lower than minimum selling price.'
      });
    }

    if (qty < 0) {
      return res.status(400).json({ success: false, message: 'Quantity purchased cannot be negative.' });
    }

    const initialStatus = qty > 0 ? 'Available' : 'Draft';
    const dateVal = purchaseDate || new Date().toISOString().split('T')[0];

    const result = await transaction(async (client) => {
      // 1. Insert product record
      const insertRes = await client.query(`
        INSERT INTO products (
          sku, name, category, description, condition, location, supplier,
          purchase_date, purchase_cost_per_unit, quantity_purchased, quantity_available,
          min_selling_price, max_selling_price, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14
        )
        RETURNING *
      `, [
        cleanSku,
        cleanName,
        category ? String(category).trim() : 'General',
        description ? String(description).trim() : null,
        condition ? String(condition).trim() : 'New',
        location ? String(location).trim() : null,
        supplier ? String(supplier).trim() : null,
        dateVal,
        cost.toFixed(2),
        qty,
        qty,
        minPrice.toFixed(2),
        maxPrice.toFixed(2),
        initialStatus
      ]);

      const newProduct = insertRes.rows[0];

      // 2. Record initial inventory movement if quantity > 0
      if (qty > 0) {
        await client.query(`
          INSERT INTO inventory_movements (
            product_id, movement_type, quantity, unit_cost, reference_type, notes, recorded_by
          ) VALUES ($1, 'purchase_in', $2, $3, 'initial_stock', 'Initial stock purchase registration', $4)
        `, [newProduct.id, qty, cost.toFixed(2), req.user.id]);
      }

      return newProduct;
    });

    // Audit log
    await logAudit({
      userId: req.user.id,
      action: 'PRODUCT_CREATED',
      entityType: 'products',
      entityId: result.id,
      newValues: { sku: result.sku, name: result.name, cost: result.purchase_cost_per_unit, qty },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Product stock listing created successfully.',
      product: {
        ...result,
        purchase_cost_per_unit: formatCurrency(result.purchase_cost_per_unit),
        min_selling_price: formatCurrency(result.min_selling_price),
        max_selling_price: formatCurrency(result.max_selling_price)
      }
    });
  } catch (err) {
    console.error('[CreateProduct Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create product listing.'
    });
  }
}

// Update product listing metadata and price ranges (Super Admin only)
async function updateProduct(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const {
      name,
      category,
      description,
      condition,
      location,
      supplier,
      minSellingPrice,
      maxSellingPrice,
      status
    } = req.body;

    const existingRes = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const existing = existingRes.rows[0];

    const minPrice = minSellingPrice !== undefined ? toDecimal(minSellingPrice) : toDecimal(existing.min_selling_price);
    const maxPrice = maxSellingPrice !== undefined ? toDecimal(maxSellingPrice) : toDecimal(existing.max_selling_price);

    if (minPrice.isNegative() || maxPrice.isNegative()) {
      return res.status(400).json({ success: false, message: 'Selling prices cannot be negative.' });
    }

    if (maxPrice.lessThan(minPrice)) {
      return res.status(400).json({
        success: false,
        message: 'Maximum selling price cannot be lower than minimum selling price.'
      });
    }

    const validStatuses = ['Draft', 'Available', 'Partially Sold', 'Sold Out', 'Archived'];
    const updatedStatus = status && validStatuses.includes(status) ? status : existing.status;

    const updateRes = await query(`
      UPDATE products
      SET name = $1,
          category = $2,
          description = $3,
          condition = $4,
          location = $5,
          supplier = $6,
          min_selling_price = $7,
          max_selling_price = $8,
          status = $9,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `, [
      name !== undefined ? String(name).trim() : existing.name,
      category !== undefined ? String(category).trim() : existing.category,
      description !== undefined ? String(description).trim() : existing.description,
      condition !== undefined ? String(condition).trim() : existing.condition,
      location !== undefined ? String(location).trim() : existing.location,
      supplier !== undefined ? String(supplier).trim() : existing.supplier,
      minPrice.toFixed(2),
      maxPrice.toFixed(2),
      updatedStatus,
      id
    ]);

    const updated = updateRes.rows[0];

    await logAudit({
      userId: req.user.id,
      action: 'PRODUCT_UPDATED',
      entityType: 'products',
      entityId: id,
      oldValues: { name: existing.name, minPrice: existing.min_selling_price, maxPrice: existing.max_selling_price },
      newValues: { name: updated.name, minPrice: updated.min_selling_price, maxPrice: updated.max_selling_price },
      req
    });

    return res.json({
      success: true,
      message: 'Product listing updated successfully.',
      product: {
        ...updated,
        purchase_cost_per_unit: formatCurrency(updated.purchase_cost_per_unit),
        min_selling_price: formatCurrency(updated.min_selling_price),
        max_selling_price: formatCurrency(updated.max_selling_price)
      }
    });
  } catch (err) {
    console.error('[UpdateProduct Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update product listing.'
    });
  }
}

// Traceable stock adjustment (Super Admin only: add, subtract, damage/loss)
async function adjustStock(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const { adjustmentType, quantity, reason } = req.body;
    const qtyChange = parseInt(quantity, 10);

    if (!['adjustment_add', 'adjustment_subtract', 'damage_loss'].includes(adjustmentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid adjustment type. Must be adjustment_add, adjustment_subtract, or damage_loss.'
      });
    }

    if (isNaN(qtyChange) || qtyChange <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Adjustment quantity must be a positive integer greater than zero.'
      });
    }

    if (!reason || String(reason).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A documented reason is mandatory for traceable stock adjustments.'
      });
    }

    const updatedProduct = await transaction(async (client) => {
      const prodRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
      if (prodRes.rows.length === 0) {
        throw new Error('Product not found.');
      }

      const product = prodRes.rows[0];
      let newQty = product.quantity_available;

      if (adjustmentType === 'adjustment_add') {
        newQty += qtyChange;
      } else {
        if (product.quantity_available < qtyChange) {
          throw new Error(`Insufficient stock. Current available: ${product.quantity_available}, cannot deduct ${qtyChange}.`);
        }
        newQty -= qtyChange;
      }

      // Determine updated status
      let newStatus = product.status;
      if (newQty === 0) {
        newStatus = 'Sold Out';
      } else if (newQty < product.quantity_purchased) {
        newStatus = 'Partially Sold';
      } else if (newQty >= product.quantity_purchased) {
        newStatus = 'Available';
      }

      // Update product
      const updateRes = await client.query(`
        UPDATE products
        SET quantity_available = $1, status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
      `, [newQty, newStatus, id]);

      // Record movement
      await client.query(`
        INSERT INTO inventory_movements (
          product_id, movement_type, quantity, unit_cost, reference_type, notes, recorded_by
        ) VALUES ($1, $2, $3, $4, 'manual_adjustment', $5, $6)
      `, [id, adjustmentType, qtyChange, product.purchase_cost_per_unit, String(reason).trim(), req.user.id]);

      return updateRes.rows[0];
    });

    await logAudit({
      userId: req.user.id,
      action: 'STOCK_ADJUSTED',
      entityType: 'products',
      entityId: id,
      newValues: { adjustmentType, quantity: qtyChange, reason, remainingAvailable: updatedProduct.quantity_available },
      req
    });

    return res.json({
      success: true,
      message: `Stock successfully adjusted (${adjustmentType}: ${qtyChange} units).`,
      product: {
        ...updatedProduct,
        purchase_cost_per_unit: formatCurrency(updatedProduct.purchase_cost_per_unit),
        min_selling_price: formatCurrency(updatedProduct.min_selling_price),
        max_selling_price: formatCurrency(updatedProduct.max_selling_price)
      }
    });
  } catch (err) {
    console.error('[AdjustStock Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to adjust stock.'
    });
  }
}

// Archive product listing (Super Admin only)
async function archiveProduct(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const prodRes = await query('SELECT id, name, status FROM products WHERE id = $1', [id]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    await query(`
      UPDATE products
      SET status = 'Archived', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);

    await logAudit({
      userId: req.user.id,
      action: 'PRODUCT_ARCHIVED',
      entityType: 'products',
      entityId: id,
      oldValues: { status: prodRes.rows[0].status },
      newValues: { status: 'Archived' },
      req
    });

    return res.json({
      success: true,
      message: 'Product listing has been archived.'
    });
  } catch (err) {
    console.error('[ArchiveProduct Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to archive product.'
    });
  }
}

module.exports = {
  listProducts,
  getProductStats,
  getProductById,
  createProduct,
  updateProduct,
  adjustStock,
  archiveProduct
};
