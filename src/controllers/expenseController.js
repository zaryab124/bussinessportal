const { query, transaction } = require('../config/db');
const { formatCurrency, toDecimal } = require('../utils/decimal');
const { recordExpenseLedger, postLedgerLine } = require('../services/ledgerService');
const { logAudit } = require('../utils/auditLogger');

function generateExpenseCode() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `EXP-${dateStr}-${rand}`;
}

/**
 * Record a new business operating expense (Admin only)
 */
async function createExpense(req, res) {
  try {
    const { category, amount, expense_date, description, sale_id } = req.body;

    if (!category || !category.trim()) {
      return res.status(400).json({ error: 'Expense category is required.' });
    }

    if (!amount || toDecimal(amount).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Expense amount must be a positive number.' });
    }

    const expenseDate = expense_date ? new Date(expense_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const expenseCode = generateExpenseCode();
    const formattedAmount = toDecimal(amount).toFixed(2);

    const result = await transaction(async (client) => {
      // 1. Insert expense record
      const insertRes = await client.query(`
        INSERT INTO expenses (
          expense_code, category, amount, expense_date, description, sale_id, recorded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        expenseCode,
        category.trim(),
        formattedAmount,
        expenseDate,
        description ? description.trim() : null,
        sale_id || null,
        req.user.id
      ]);

      const createdExpense = insertRes.rows[0];

      // 2. Post balanced double-entry lines to financial_ledger
      await recordExpenseLedger(client, createdExpense, req.user.id);

      return createdExpense;
    });

    // 3. Log audit action
    await logAudit({
      userId: req.user.id,
      action: 'EXPENSE_RECORDED',
      entityType: 'expense',
      entityId: result.id,
      newValues: {
        expense_code: result.expense_code,
        category: result.category,
        amount: result.amount,
        expense_date: result.expense_date
      },
      req
    });

    return res.status(201).json({
      success: true,
      message: `Expense ${result.expense_code} recorded successfully.`,
      expense: result
    });
  } catch (err) {
    console.error('[CreateExpense Error]', err);
    return res.status(500).json({ error: 'Failed to record expense: ' + err.message });
  }
}

/**
 * Retrieve list of operating expenses with filtering and summary totals
 */
async function getExpenses(req, res) {
  try {
    const { category, startDate, endDate, search, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (category) {
      conditions.push(`e.category = $${idx++}`);
      params.push(category);
    }

    if (startDate) {
      conditions.push(`e.expense_date >= $${idx++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`e.expense_date <= $${idx++}`);
      params.push(endDate);
    }

    if (search) {
      conditions.push(`(e.expense_code ILIKE $${idx} OR e.description ILIKE $${idx} OR e.category ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const listQuery = `
      SELECT
        e.*,
        u.full_name as recorded_by_name,
        u.email as recorded_by_email,
        s.sale_invoice_number
      FROM expenses e
      JOIN users u ON e.recorded_by = u.id
      LEFT JOIN sales s ON e.sale_id = s.id
      ${whereClause}
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countQuery = `
      SELECT
        COUNT(id) as total_count,
        COALESCE(SUM(amount), 0.00) as total_amount
      FROM expenses e
      ${whereClause}
    `;

    const [listRes, countRes] = await Promise.all([
      query(listQuery, [...params, parseInt(limit, 10), parseInt(offset, 10)]),
      query(countQuery, params)
    ]);

    // Also get breakdown by category
    const categoryBreakdownRes = await query(`
      SELECT category, COALESCE(SUM(amount), 0.00) as total
      FROM expenses
      GROUP BY category
      ORDER BY total DESC
    `);

    return res.json({
      success: true,
      totalCount: parseInt(countRes.rows[0].total_count, 10),
      totalAmount: formatCurrency(countRes.rows[0].total_amount),
      categories: categoryBreakdownRes.rows.map(r => ({
        category: r.category,
        total: formatCurrency(r.total)
      })),
      expenses: listRes.rows.map(r => ({
        ...r,
        amount: formatCurrency(r.amount)
      }))
    });
  } catch (err) {
    console.error('[GetExpenses Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve expenses.' });
  }
}

/**
 * Retrieve a single expense by ID
 */
async function getExpenseById(req, res) {
  try {
    const { id } = req.params;
    const expenseRes = await query(`
      SELECT
        e.*,
        u.full_name as recorded_by_name,
        u.email as recorded_by_email,
        s.sale_invoice_number
      FROM expenses e
      JOIN users u ON e.recorded_by = u.id
      LEFT JOIN sales s ON e.sale_id = s.id
      WHERE e.id = $1
    `, [id]);

    if (expenseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found.' });
    }

    return res.json({
      success: true,
      expense: {
        ...expenseRes.rows[0],
        amount: formatCurrency(expenseRes.rows[0].amount)
      }
    });
  } catch (err) {
    console.error('[GetExpenseById Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve expense.' });
  }
}

/**
 * Traceably cancel/delete an expense (Admin only)
 */
async function deleteExpense(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Traceable cancellation reason is mandatory.' });
    }

    const expenseRes = await query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (expenseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found.' });
    }
    const expense = expenseRes.rows[0];

    await transaction(async (client) => {
      // Reversal in ledger: Debit Asset, Credit Expense
      const reversalDate = new Date().toISOString();
      await postLedgerLine(client, {
        entryDate: reversalDate,
        accountCategory: 'asset',
        entryType: 'DEBIT',
        amount: expense.amount,
        referenceType: 'expense_cancellation',
        referenceId: expense.id,
        description: `Reversal of expense ${expense.expense_code}: ${reason.trim()}`,
        recordedBy: req.user.id,
        isTraceableAdjustment: true
      });

      await postLedgerLine(client, {
        entryDate: reversalDate,
        accountCategory: 'expense',
        entryType: 'CREDIT',
        amount: expense.amount,
        referenceType: 'expense_cancellation',
        referenceId: expense.id,
        description: `Reversal of expense ${expense.expense_code}: ${reason.trim()}`,
        recordedBy: req.user.id,
        isTraceableAdjustment: true
      });

      // Remove expense record
      await client.query('DELETE FROM expenses WHERE id = $1', [id]);
    });

    // Audit log
    await logAudit({
      userId: req.user.id,
      action: 'EXPENSE_CANCELLED',
      entityType: 'expense',
      entityId: id,
      oldValues: expense,
      newValues: { cancelled_reason: reason.trim() },
      req
    });

    return res.json({
      success: true,
      message: `Expense ${expense.expense_code} traceably cancelled and reversed.`
    });
  } catch (err) {
    console.error('[DeleteExpense Error]', err);
    return res.status(500).json({ error: 'Failed to cancel expense: ' + err.message });
  }
}

module.exports = {
  createExpense,
  getExpenses,
  getExpenseById,
  deleteExpense
};
