const { query } = require('../config/db');
const { toCsv } = require('../utils/csvHelper');

/**
 * Export products inventory to CSV (Super Admin)
 */
async function exportProducts(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        p.id, p.sku, p.name, p.category, p.status, p.condition, 
        p.location, p.supplier, p.purchase_cost_per_unit, 
        p.min_selling_price, p.max_selling_price, p.quantity_available, p.quantity_purchased, p.created_at
      FROM products p
      ORDER BY p.created_at DESC
    `);

    const columns = [
      { key: 'id', label: 'Product ID' },
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Product Name' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'condition', label: 'Condition' },
      { key: 'location', label: 'Location' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'purchase_cost_per_unit', label: 'Purchase Cost Per Unit' },
      { key: 'min_selling_price', label: 'Min Selling Price' },
      { key: 'max_selling_price', label: 'Max Selling Price' },
      { key: 'quantity_available', label: 'Quantity Available' },
      { key: 'quantity_purchased', label: 'Quantity Purchased' },
      { key: 'created_at', label: 'Created At' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-products.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * Export sales ledger to CSV (Super Admin)
 */
async function exportSales(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        s.id, s.sale_invoice_number, s.sale_date, 
        COALESCE(p.sku, 'N/A') as sku, 
        COALESCE(p.name, 'Sale Order') as product_name,
        COALESCE(si.quantity, 0) as quantity_sold, 
        COALESCE(si.unit_selling_price, s.total_revenue) as actual_selling_price_per_unit,
        s.total_revenue, 
        s.total_cost_of_goods as cost_of_goods_sold, 
        s.total_direct_expenses as direct_expenses,
        s.net_profit, 
        s.payment_method, 
        s.payment_status, 
        s.status,
        u.full_name as recorded_by
      FROM sales s
      JOIN users u ON s.recorded_by = u.id
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON si.product_id = p.id
      ORDER BY s.sale_date DESC
    `);

    const columns = [
      { key: 'id', label: 'Sale ID' },
      { key: 'sale_invoice_number', label: 'Invoice Number' },
      { key: 'sale_date', label: 'Sale Date' },
      { key: 'sku', label: 'SKU' },
      { key: 'product_name', label: 'Product Name' },
      { key: 'quantity_sold', label: 'Qty Sold' },
      { key: 'actual_selling_price_per_unit', label: 'Unit Price' },
      { key: 'total_revenue', label: 'Total Revenue' },
      { key: 'cost_of_goods_sold', label: 'COGS' },
      { key: 'direct_expenses', label: 'Direct Expenses' },
      { key: 'net_profit', label: 'Net Profit' },
      { key: 'payment_method', label: 'Payment Method' },
      { key: 'payment_status', label: 'Payment Status' },
      { key: 'status', label: 'Sale Status' },
      { key: 'recorded_by', label: 'Recorded By' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * Export purchase orders to CSV (Super Admin)
 */
async function exportPurchases(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        po.id, po.purchase_order_number as po_number, po.supplier_name, po.purchase_date as order_date,
        po.total_cost as total_amount, po.status, u.full_name as recorded_by, po.notes
      FROM stock_purchases po
      JOIN users u ON po.recorded_by = u.id
      ORDER BY po.purchase_date DESC
    `);

    const columns = [
      { key: 'id', label: 'PO ID' },
      { key: 'po_number', label: 'PO Number' },
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'order_date', label: 'Order Date' },
      { key: 'total_amount', label: 'Total Amount' },
      { key: 'status', label: 'Status' },
      { key: 'recorded_by', label: 'Recorded By' },
      { key: 'notes', label: 'Notes' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="purchases-report.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * Export operating expenses to CSV (Super Admin)
 */
async function exportExpenses(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        e.id, e.expense_code, e.category as expense_category, e.description, e.amount,
        e.expense_date as incurred_date, u.full_name as recorded_by
      FROM expenses e
      JOIN users u ON e.recorded_by = u.id
      ORDER BY e.expense_date DESC
    `);

    const columns = [
      { key: 'id', label: 'Expense ID' },
      { key: 'expense_code', label: 'Expense Code' },
      { key: 'expense_category', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount' },
      { key: 'incurred_date', label: 'Incurred Date' },
      { key: 'recorded_by', label: 'Recorded By' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="operating-expenses.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * Export double-entry financial ledger to CSV (Super Admin)
 */
async function exportLedger(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        fl.id, fl.entry_number, fl.entry_date as transaction_date, fl.account_category as account_name, fl.account_category as account_type,
        fl.entry_type, fl.amount, fl.description, fl.reference_type,
        fl.reference_id, fl.is_traceable_adjustment, u.full_name as created_by
      FROM financial_ledger fl
      LEFT JOIN users u ON fl.recorded_by = u.id
      ORDER BY fl.id ASC
    `);

    const columns = [
      { key: 'id', label: 'Entry ID' },
      { key: 'entry_number', label: 'Entry Number' },
      { key: 'transaction_date', label: 'Transaction Date' },
      { key: 'account_name', label: 'Account Name' },
      { key: 'account_type', label: 'Account Type' },
      { key: 'entry_type', label: 'Debit / Credit' },
      { key: 'amount', label: 'Amount' },
      { key: 'description', label: 'Description' },
      { key: 'reference_type', label: 'Ref Type' },
      { key: 'reference_id', label: 'Ref ID' },
      { key: 'is_traceable_adjustment', label: 'Is Adjustment' },
      { key: 'created_by', label: 'Created By' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="financial-ledger.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * Export all owner settlements to CSV (Super Admin)
 */
async function exportSettlements(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        s.id, s.settlement_code, u.full_name as owner_name, s.amount, s.settlement_date,
        s.payment_method, s.reference_note as notes,
        a.full_name as recorded_by
      FROM owner_settlements s
      JOIN users u ON s.owner_id = u.id
      JOIN users a ON s.recorded_by = a.id
      ORDER BY s.settlement_date DESC
    `);

    const columns = [
      { key: 'id', label: 'Settlement ID' },
      { key: 'settlement_code', label: 'Settlement Code' },
      { key: 'owner_name', label: 'Owner Name' },
      { key: 'amount', label: 'Amount Paid' },
      { key: 'settlement_date', label: 'Settlement Date' },
      { key: 'payment_method', label: 'Payment Method' },
      { key: 'notes', label: 'Notes' },
      { key: 'recorded_by', label: 'Recorded By' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="owner-settlements.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * Export owner profit allocations (Strict Horizontal Isolation)
 */
async function exportOwnerAllocations(req, res, next) {
  try {
    let targetOwnerId = req.user.id;
    if (req.user.role === 'super_admin' && req.query.owner_id) {
      targetOwnerId = req.query.owner_id;
    }

    const result = await query(`
      SELECT 
        pa.id, 
        s.id as sale_id, 
        COALESCE(p.name, 'Sale Allocation') as product_name, 
        COALESCE(p.sku, '-') as sku,
        pa.allocated_amount, 
        pa.allocation_type, 
        pa.status, 
        pa.created_at
      FROM profit_allocations pa
      LEFT JOIN sales s ON pa.sale_id = s.id
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON si.product_id = p.id
      WHERE pa.owner_id = $1
      ORDER BY pa.created_at DESC
    `, [targetOwnerId]);

    const columns = [
      { key: 'id', label: 'Allocation ID' },
      { key: 'sale_id', label: 'Sale ID' },
      { key: 'product_name', label: 'Product Name' },
      { key: 'sku', label: 'SKU' },
      { key: 'allocated_amount', label: 'Allocated Amount' },
      { key: 'allocation_type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Date' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-profit-allocations.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

/**
 * Export owner settlements (Strict Horizontal Isolation)
 */
async function exportOwnerSettlements(req, res, next) {
  try {
    let targetOwnerId = req.user.id;
    if (req.user.role === 'super_admin' && req.query.owner_id) {
      targetOwnerId = req.query.owner_id;
    }

    const result = await query(`
      SELECT 
        s.id, s.settlement_code, s.amount, s.settlement_date, s.payment_method,
        s.reference_note as notes
      FROM owner_settlements s
      WHERE s.owner_id = $1
      ORDER BY s.settlement_date DESC
    `, [targetOwnerId]);

    const columns = [
      { key: 'id', label: 'Settlement ID' },
      { key: 'settlement_code', label: 'Settlement Code' },
      { key: 'amount', label: 'Amount Paid' },
      { key: 'settlement_date', label: 'Settlement Date' },
      { key: 'payment_method', label: 'Payment Method' },
      { key: 'notes', label: 'Notes' }
    ];

    const csv = toCsv(columns, result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-settlements.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  exportProducts,
  exportSales,
  exportPurchases,
  exportExpenses,
  exportLedger,
  exportSettlements,
  exportOwnerAllocations,
  exportOwnerSettlements
};
