const { query, transaction } = require('../config/db');
const { formatCurrency, toDecimal } = require('../utils/decimal');
const { logAudit } = require('../utils/auditLogger');
const { postLedgerLine, getFinancialMetrics } = require('../services/ledgerService');

// Get filtered financial ledger entries
async function getLedgerEntries(req, res) {
  try {
    const {
      accountCategory,
      entryType,
      referenceType,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = req.query;

    let sql = `
      SELECT fl.*, u.full_name as recorder_name
      FROM financial_ledger fl
      LEFT JOIN users u ON fl.recorded_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (accountCategory && accountCategory !== 'all') {
      params.push(accountCategory);
      sql += ` AND fl.account_category = $${params.length}`;
    }

    if (entryType && entryType !== 'all') {
      params.push(entryType.toUpperCase());
      sql += ` AND fl.entry_type = $${params.length}`;
    }

    if (referenceType && referenceType !== 'all') {
      params.push(referenceType);
      sql += ` AND fl.reference_type = $${params.length}`;
    }

    if (startDate) {
      params.push(new Date(startDate).toISOString());
      sql += ` AND fl.entry_date >= $${params.length}`;
    }

    if (endDate) {
      params.push(new Date(endDate).toISOString());
      sql += ` AND fl.entry_date <= $${params.length}`;
    }

    sql += ` ORDER BY fl.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await query(sql, params);

    const formatted = result.rows.map(row => ({
      ...row,
      amount: formatCurrency(row.amount)
    }));

    // Get total count
    let countSql = `SELECT COUNT(*) as total FROM financial_ledger WHERE 1=1`;
    const countParams = [];
    if (accountCategory && accountCategory !== 'all') {
      countParams.push(accountCategory);
      countSql += ` AND account_category = $${countParams.length}`;
    }
    if (entryType && entryType !== 'all') {
      countParams.push(entryType.toUpperCase());
      countSql += ` AND entry_type = $${countParams.length}`;
    }
    if (referenceType && referenceType !== 'all') {
      countParams.push(referenceType);
      countSql += ` AND reference_type = $${countParams.length}`;
    }
    const countRes = await query(countSql, countParams);

    return res.json({
      success: true,
      total: parseInt(countRes.rows[0].total, 10),
      entries: formatted
    });
  } catch (err) {
    console.error('[GetLedgerEntries Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve financial ledger entries.'
    });
  }
}

// Get comprehensive financial metrics and net profit calculation
async function getFinancialSummary(req, res) {
  try {
    const summary = await getFinancialMetrics();
    return res.json({
      success: true,
      summary
    });
  } catch (err) {
    console.error('[GetFinancialSummary Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate financial metrics.'
    });
  }
}

// Record an authorized traceable adjustment (Super Admin only)
async function recordTraceableAdjustment(req, res) {
  try {
    const {
      primaryAccountCategory,
      primaryEntryType,
      counterAccountCategory,
      counterEntryType,
      amount,
      justification,
      referenceType = 'manual_traceable_adjustment',
      referenceId = 0
    } = req.body;

    const amt = toDecimal(amount);
    if (amt.lessThanOrEqualTo(0)) {
      return res.status(400).json({
        success: false,
        message: 'Adjustment amount must be greater than zero.'
      });
    }

    if (!justification || String(justification).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A documented justification is mandatory for any traceable financial adjustment.'
      });
    }

    const validCategories = ['asset', 'liability', 'equity', 'revenue', 'expense', 'distribution'];
    if (!validCategories.includes(primaryAccountCategory) || !validCategories.includes(counterAccountCategory)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account category. Must be one of: ' + validCategories.join(', ')
      });
    }

    const pType = String(primaryEntryType).toUpperCase();
    const cType = String(counterEntryType).toUpperCase();

    if (!['DEBIT', 'CREDIT'].includes(pType) || !['DEBIT', 'CREDIT'].includes(cType)) {
      return res.status(400).json({
        success: false,
        message: 'Entry types must be either DEBIT or CREDIT.'
      });
    }

    // Double entry must balance: one DEBIT, one CREDIT
    if (pType === cType) {
      return res.status(400).json({
        success: false,
        message: 'A balanced double-entry adjustment requires one DEBIT and one CREDIT.'
      });
    }

    const adjustmentResult = await transaction(async (client) => {
      const now = new Date().toISOString();

      const line1 = await postLedgerLine(client, {
        entryDate: now,
        accountCategory: primaryAccountCategory,
        entryType: pType,
        amount: amt.toFixed(2),
        referenceType,
        referenceId: parseInt(referenceId, 10) || 0,
        description: `Traceable Adjustment: ${String(justification).trim()}`,
        recordedBy: req.user.id,
        isTraceableAdjustment: true
      });

      const line2 = await postLedgerLine(client, {
        entryDate: now,
        accountCategory: counterAccountCategory,
        entryType: cType,
        amount: amt.toFixed(2),
        referenceType,
        referenceId: parseInt(referenceId, 10) || 0,
        description: `Traceable Adjustment Balancing Line: ${String(justification).trim()}`,
        recordedBy: req.user.id,
        isTraceableAdjustment: true
      });

      return [line1, line2];
    });

    await logAudit({
      userId: req.user.id,
      action: 'TRACEABLE_ADJUSTMENT_RECORDED',
      entityType: 'financial_ledger',
      entityId: adjustmentResult[0].id,
      newValues: {
        amount: amt.toFixed(2),
        justification,
        primaryAccount: primaryAccountCategory,
        primaryType: pType,
        counterAccount: counterAccountCategory,
        counterType: cType
      },
      req
    });

    return res.status(201).json({
      success: true,
      message: 'Traceable financial adjustment recorded successfully.',
      entries: adjustmentResult.map(e => ({
        ...e,
        amount: formatCurrency(e.amount)
      }))
    });
  } catch (err) {
    console.error('[TraceableAdjustment Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to record traceable adjustment.'
    });
  }
}

module.exports = {
  getLedgerEntries,
  getFinancialSummary,
  recordTraceableAdjustment
};
