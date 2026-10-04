const { query, transaction } = require('../config/db');
const { formatCurrency, toDecimal, subtract } = require('../utils/decimal');
const { recordSettlementLedger } = require('../services/ledgerService');
const { logAudit } = require('../utils/auditLogger');

function generateSettlementCode() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SET-${dateStr}-${rand}`;
}

/**
 * Record an owner profit payout settlement (Admin only)
 */
async function createSettlement(req, res) {
  try {
    const {
      owner_id,
      amount,
      settlement_date,
      payment_method,
      reference_note,
      force_override = false,
      override_reason = null
    } = req.body;

    if (!owner_id) {
      return res.status(400).json({ error: 'Owner ID is required.' });
    }

    if (!amount || toDecimal(amount).lessThanOrEqualTo(0)) {
      return res.status(400).json({ error: 'Settlement amount must be greater than zero.' });
    }

    if (!payment_method || !payment_method.trim()) {
      return res.status(400).json({ error: 'Payment method is required (e.g. Bank Transfer, Cash, Cheque).' });
    }

    // Verify owner exists and is an active business_owner
    const ownerRes = await query('SELECT id, full_name, email, role, status FROM users WHERE id = $1', [owner_id]);
    if (ownerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Target owner user not found.' });
    }
    const targetOwner = ownerRes.rows[0];
    if (targetOwner.role !== 'business_owner') {
      return res.status(400).json({ error: 'Settlement can only be issued to a business owner account.' });
    }

    const decAmount = toDecimal(amount);
    const formattedAmount = decAmount.toFixed(2);
    const settlementDate = settlement_date ? new Date(settlement_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    // Calculate owner's total allocated share and already settled amount
    const allocRes = await query(`
      SELECT COALESCE(SUM(allocated_amount), 0.00) as total_allocated
      FROM profit_allocations
      WHERE owner_id = $1 AND allocation_type = 'owner_share'
    `, [owner_id]);
    const totalAllocated = toDecimal(allocRes.rows[0].total_allocated);

    const prevSettleRes = await query(`
      SELECT COALESCE(SUM(amount), 0.00) as total_settled
      FROM owner_settlements
      WHERE owner_id = $1
    `, [owner_id]);
    const totalSettled = toDecimal(prevSettleRes.rows[0].total_settled);

    const outstandingPayable = totalAllocated.minus(totalSettled);

    if (decAmount.greaterThan(outstandingPayable)) {
      if (!force_override) {
        return res.status(400).json({
          error: `Settlement amount (Rs. ${formattedAmount}) exceeds outstanding payable profit (Rs. ${formatCurrency(outstandingPayable)}) for ${targetOwner.name}.`,
          outstandingPayable: formatCurrency(outstandingPayable),
          totalAllocated: formatCurrency(totalAllocated),
          totalSettled: formatCurrency(totalSettled)
        });
      }

      if (!override_reason || !override_reason.trim()) {
        return res.status(400).json({
          error: 'An override reason is mandatory when settling an amount exceeding outstanding payable profit.'
        });
      }
    }

    const settlementCode = generateSettlementCode();

    const createdSettlement = await transaction(async (client) => {
      // 1. Insert settlement record
      const insRes = await client.query(`
        INSERT INTO owner_settlements (
          settlement_code, owner_id, amount, settlement_date, payment_method, reference_note, recorded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        settlementCode,
        owner_id,
        formattedAmount,
        settlementDate,
        payment_method.trim(),
        reference_note ? reference_note.trim() : null,
        req.user.id
      ]);

      const settlement = insRes.rows[0];

      // 2. Post balanced double-entry lines into financial_ledger
      await recordSettlementLedger(client, settlement, req.user.id);

      return settlement;
    });

    // 3. Log audit action
    await logAudit({
      userId: req.user.id,
      action: 'OWNER_SETTLEMENT_RECORDED',
      entityType: 'owner_settlement',
      entityId: createdSettlement.id,
      newValues: {
        settlement_code: createdSettlement.settlement_code,
        owner_id: createdSettlement.owner_id,
        amount: createdSettlement.amount,
        payment_method: createdSettlement.payment_method,
        outstanding_before: formatCurrency(outstandingPayable),
        is_override: force_override,
        override_reason: override_reason || null
      },
      req
    });

    const newOutstanding = outstandingPayable.minus(decAmount);

    return res.status(201).json({
      success: true,
      message: `Settlement of Rs. ${formattedAmount} paid to ${targetOwner.full_name} recorded successfully.`,
      settlement: {
        ...createdSettlement,
        amount: formatCurrency(createdSettlement.amount)
      },
      owner: {
        id: targetOwner.id,
        name: targetOwner.full_name,
        email: targetOwner.email
      },
      financialStatus: {
        totalAllocated: formatCurrency(totalAllocated),
        totalSettled: formatCurrency(totalSettled.plus(decAmount)),
        outstandingPayable: formatCurrency(newOutstanding)
      }
    });
  } catch (err) {
    console.error('[CreateSettlement Error]', err);
    return res.status(500).json({ error: 'Failed to record settlement: ' + err.message });
  }
}

/**
 * Get list of settlements with strict owner isolation
 */
async function getSettlements(req, res) {
  try {
    const { owner_id, startDate, endDate, limit = 50, offset = 0 } = req.query;

    const conditions = [];
    const params = [];
    let idx = 1;

    // Strict horizontal isolation: business owners can ONLY see their own settlements
    if (req.user.role === 'business_owner') {
      conditions.push(`s.owner_id = $${idx++}`);
      params.push(req.user.id);
    } else if (owner_id) {
      conditions.push(`s.owner_id = $${idx++}`);
      params.push(owner_id);
    }

    if (startDate) {
      conditions.push(`s.settlement_date >= $${idx++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`s.settlement_date <= $${idx++}`);
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const listQuery = `
      SELECT
        s.*,
        o.full_name as owner_name,
        o.email as owner_email,
        u.full_name as recorded_by_name
      FROM owner_settlements s
      JOIN users o ON s.owner_id = o.id
      JOIN users u ON s.recorded_by = u.id
      ${whereClause}
      ORDER BY s.settlement_date DESC, s.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countQuery = `
      SELECT
        COUNT(s.id) as total_count,
        COALESCE(SUM(s.amount), 0.00) as total_amount
      FROM owner_settlements s
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
      settlements: listRes.rows.map(r => ({
        ...r,
        amount: formatCurrency(r.amount)
      }))
    });
  } catch (err) {
    console.error('[GetSettlements Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve settlements.' });
  }
}

/**
 * Get balances for all owners (Admin) or current owner (Business Owner)
 */
async function getOwnerBalances(req, res) {
  try {
    let ownerFilterClause = "WHERE role = 'business_owner'";
    const params = [];

    if (req.user.role === 'business_owner') {
      ownerFilterClause += ' AND id = $1';
      params.push(req.user.id);
    }

    const ownersRes = await query(`
      SELECT id, full_name, email, phone, status
      FROM users
      ${ownerFilterClause}
      ORDER BY full_name ASC
    `, params);

    const balances = await Promise.all(ownersRes.rows.map(async (owner) => {
      const [allocRes, settleRes, investRes] = await Promise.all([
        query(`
          SELECT COALESCE(SUM(allocated_amount), 0.00) as total_allocated
          FROM profit_allocations
          WHERE owner_id = $1 AND allocation_type = 'owner_share'
        `, [owner.id]),
        query(`
          SELECT COALESCE(SUM(amount), 0.00) as total_settled
          FROM owner_settlements
          WHERE owner_id = $1
        `, [owner.id]),
        query(`
          SELECT COALESCE(SUM(amount), 0.00) as total_invested
          FROM owner_investments
          WHERE owner_id = $1
        `, [owner.id])
      ]);

      const totalAllocated = toDecimal(allocRes.rows[0].total_allocated);
      const totalSettled = toDecimal(settleRes.rows[0].total_settled);
      const outstanding = totalAllocated.minus(totalSettled);
      const totalInvested = toDecimal(investRes.rows[0].total_invested);

      return {
        ownerId: owner.id,
        name: owner.full_name,
        email: owner.email,
        phone: owner.phone,
        status: owner.status,
        totalInvested: formatCurrency(totalInvested),
        totalAllocated: formatCurrency(totalAllocated),
        totalSettled: formatCurrency(totalSettled),
        outstandingPayable: formatCurrency(outstanding)
      };
    }));

    return res.json({
      success: true,
      balances
    });
  } catch (err) {
    console.error('[GetOwnerBalances Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve owner balances.' });
  }
}

module.exports = {
  createSettlement,
  getSettlements,
  getOwnerBalances
};
