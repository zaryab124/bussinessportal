const { query, transaction } = require('../config/db');
const { formatCurrency, toDecimal } = require('../utils/decimal');
const { recordInvestmentLedger } = require('../services/ledgerService');
const { logAudit } = require('../utils/auditLogger');

/**
 * Record a capital investment contributed by an owner (Admin only)
 */
async function createInvestment(req, res) {
  try {
    const { owner_id, amount, investment_date, investment_type = 'additional', notes } = req.body;

    if (!owner_id) {
      return res.status(400).json({ error: 'Owner ID is required.' });
    }

    if (!amount || toDecimal(amount).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Investment amount must be greater than zero.' });
    }

    const validTypes = ['initial', 'additional', 'working_capital'];
    if (!validTypes.includes(investment_type)) {
      return res.status(400).json({
        error: `Invalid investment type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Verify target owner
    const ownerRes = await query('SELECT id, full_name, email, role FROM users WHERE id = $1', [owner_id]);
    if (ownerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Target owner user not found.' });
    }
    const targetOwner = ownerRes.rows[0];
    if (targetOwner.role !== 'business_owner') {
      return res.status(400).json({ error: 'Investments can only be assigned to a business owner.' });
    }

    const decAmount = toDecimal(amount);
    const formattedAmount = decAmount.toFixed(2);
    const invDate = investment_date ? new Date(investment_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    const createdInvestment = await transaction(async (client) => {
      // 1. Insert investment record
      const insRes = await client.query(`
        INSERT INTO owner_investments (
          owner_id, amount, investment_date, investment_type, notes, recorded_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        owner_id,
        formattedAmount,
        invDate,
        investment_type,
        notes ? notes.trim() : null,
        req.user.id
      ]);

      const inv = insRes.rows[0];

      // 2. Post balanced double-entry lines into financial_ledger
      await recordInvestmentLedger(client, inv, req.user.id);

      return inv;
    });

    // 3. Audit log
    await logAudit({
      userId: req.user.id,
      action: 'OWNER_INVESTMENT_RECORDED',
      entityType: 'owner_investment',
      entityId: createdInvestment.id,
      newValues: {
        owner_id: createdInvestment.owner_id,
        amount: createdInvestment.amount,
        investment_type: createdInvestment.investment_type,
        investment_date: createdInvestment.investment_date
      },
      req
    });

    return res.status(201).json({
      success: true,
      message: `Capital investment of Rs. ${formattedAmount} for ${targetOwner.full_name} recorded successfully.`,
      investment: {
        ...createdInvestment,
        amount: formatCurrency(createdInvestment.amount)
      },
      owner: {
        id: targetOwner.id,
        name: targetOwner.full_name,
        email: targetOwner.email
      }
    });
  } catch (err) {
    console.error('[CreateInvestment Error]', err);
    return res.status(500).json({ error: 'Failed to record investment: ' + err.message });
  }
}

/**
 * Get investments with strict owner isolation
 */
async function getInvestments(req, res) {
  try {
    const { owner_id, type, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    // Strict horizontal isolation for business owners
    if (req.user.role === 'business_owner') {
      conditions.push(`inv.owner_id = $${idx++}`);
      params.push(req.user.id);
    } else if (owner_id) {
      conditions.push(`inv.owner_id = $${idx++}`);
      params.push(owner_id);
    }

    if (type) {
      conditions.push(`inv.investment_type = $${idx++}`);
      params.push(type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const listQuery = `
      SELECT
        inv.*,
        o.full_name as owner_name,
        o.email as owner_email,
        u.full_name as recorded_by_name
      FROM owner_investments inv
      JOIN users o ON inv.owner_id = o.id
      JOIN users u ON inv.recorded_by = u.id
      ${whereClause}
      ORDER BY inv.investment_date DESC, inv.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countQuery = `
      SELECT
        COUNT(inv.id) as total_count,
        COALESCE(SUM(inv.amount), 0.00) as total_amount
      FROM owner_investments inv
      ${whereClause}
    `;

    const [listRes, countRes] = await Promise.all([
      query(listQuery, [...params, parseInt(limit, 10), parseInt(offset, 10)]),
      query(countQuery, params)
    ]);

    return res.json({
      success: true,
      totalCount: parseInt(countRes.rows[0].total_count, 10),
      totalAmount: formatCurrency(countRes.rows[0].total_amount),
      investments: listRes.rows.map(r => ({
        ...r,
        amount: formatCurrency(r.amount)
      }))
    });
  } catch (err) {
    console.error('[GetInvestments Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve investments.' });
  }
}

module.exports = {
  createInvestment,
  getInvestments
};
