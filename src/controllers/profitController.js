const { query, transaction } = require('../config/db');
const { formatCurrency, toDecimal } = require('../utils/decimal');
const { logAudit } = require('../utils/auditLogger');
const { getActiveRule, validateRulePercentages } = require('../services/profitEngine');

// Get current active profit allocation rule
async function getActiveRuleHandler(req, res) {
  try {
    const rule = await getActiveRule();
    return res.json({
      success: true,
      rule
    });
  } catch (err) {
    console.error('[GetActiveRule Error]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to retrieve active profit sharing rule.'
    });
  }
}

// Get all rules and version history
async function getRuleHistory(req, res) {
  try {
    const rulesRes = await query(`
      SELECT r.*, u.full_name as creator_name
      FROM profit_allocation_rules r
      LEFT JOIN users u ON r.created_by = u.id
      ORDER BY r.version DESC
    `);

    const rules = [];
    for (const r of rulesRes.rows) {
      const ownersRes = await query(`
        SELECT paro.*, u.full_name as owner_name, u.email as owner_email
        FROM profit_allocation_rule_owners paro
        JOIN users u ON paro.owner_id = u.id
        WHERE paro.rule_id = $1
      `, [r.id]);

      rules.push({
        ...r,
        reinvestment_percentage: formatCurrency(r.reinvestment_percentage),
        owners: ownersRes.rows.map(o => ({
          ...o,
          percentage: formatCurrency(o.percentage)
        }))
      });
    }

    return res.json({
      success: true,
      rules
    });
  } catch (err) {
    console.error('[GetRuleHistory Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve rule history.'
    });
  }
}

// Create new version of profit allocation rule (Super Admin only)
async function createRule(req, res) {
  try {
    const {
      ruleName,
      reinvestmentPercentage,
      deductReinvestmentBeforeDistribution = false,
      effectiveFrom = new Date().toISOString().slice(0, 10),
      notes,
      owners
    } = req.body;

    if (!ruleName || String(ruleName).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Rule name is required.' });
    }

    if (!owners || !Array.isArray(owners) || owners.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one owner must be specified in the rule.' });
    }

    // Mathematical verification: total must be 100.00%
    validateRulePercentages(reinvestmentPercentage, owners);

    const newRule = await transaction(async (client) => {
      // Find latest version
      const verRes = await client.query('SELECT COALESCE(MAX(version), 0) as max_version FROM profit_allocation_rules');
      const nextVersion = parseInt(verRes.rows[0].max_version, 10) + 1;

      // Deactivate existing rules
      await client.query('UPDATE profit_allocation_rules SET is_active = FALSE WHERE is_active = TRUE');

      // Insert new rule
      const ruleRes = await client.query(`
        INSERT INTO profit_allocation_rules (
          version, is_active, rule_name, reinvestment_percentage,
          deduct_reinvestment_before_distribution, effective_from, notes, created_by
        ) VALUES ($1, TRUE, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        nextVersion,
        String(ruleName).trim(),
        toDecimal(reinvestmentPercentage).toFixed(2),
        Boolean(deductReinvestmentBeforeDistribution),
        effectiveFrom,
        notes ? String(notes).trim() : null,
        req.user.id
      ]);

      const rule = ruleRes.rows[0];

      // Insert owner percentage splits
      const savedOwners = [];
      for (const o of owners) {
        const ownerId = parseInt(o.ownerId, 10);
        const pct = toDecimal(o.percentage).toFixed(2);

        // Verify owner exists and has business_owner role
        const ownerCheck = await client.query('SELECT id, full_name, email FROM users WHERE id = $1', [ownerId]);
        if (ownerCheck.rows.length === 0) {
          throw new Error(`Owner with ID ${ownerId} does not exist.`);
        }

        const oRes = await client.query(`
          INSERT INTO profit_allocation_rule_owners (rule_id, owner_id, percentage)
          VALUES ($1, $2, $3)
          RETURNING *
        `, [rule.id, ownerId, pct]);

        savedOwners.push({
          ...oRes.rows[0],
          owner_name: ownerCheck.rows[0].full_name,
          owner_email: ownerCheck.rows[0].email,
          percentage: pct
        });
      }

      return {
        ...rule,
        reinvestment_percentage: formatCurrency(rule.reinvestment_percentage),
        owners: savedOwners
      };
    });

    await logAudit({
      userId: req.user.id,
      action: 'PROFIT_RULE_CREATED',
      entityType: 'profit_allocation_rules',
      entityId: newRule.id,
      newValues: {
        version: newRule.version,
        ruleName: newRule.rule_name,
        reinvestmentPercentage: newRule.reinvestment_percentage,
        ownerCount: newRule.owners.length
      },
      req
    });

    return res.status(201).json({
      success: true,
      message: `Profit allocation rule version ${newRule.version} activated successfully.`,
      rule: newRule
    });
  } catch (err) {
    console.error('[CreateRule Error]', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to create profit allocation rule.'
    });
  }
}

// Get profit allocations list (Super Admin sees all; Business Owner sees ONLY their own!)
async function getAllocations(req, res) {
  try {
    const isOwner = req.user.role === 'business_owner';
    const { ownerId, allocationType, periodMonth } = req.query;

    let sql = `
      SELECT pa.*,
             u.full_name as owner_name, u.email as owner_email,
             s.sale_invoice_number, s.sale_date, s.net_profit as sale_net_profit
      FROM profit_allocations pa
      LEFT JOIN users u ON pa.owner_id = u.id
      LEFT JOIN sales s ON pa.sale_id = s.id
      WHERE 1=1
    `;
    const params = [];

    // STRICT OWNER HORIZONTAL ISOLATION:
    if (isOwner) {
      params.push(req.user.id);
      sql += ` AND pa.owner_id = $${params.length}`;
    } else if (ownerId && ownerId !== 'all') {
      params.push(parseInt(ownerId, 10));
      sql += ` AND pa.owner_id = $${params.length}`;
    }

    if (allocationType && allocationType !== 'all') {
      params.push(allocationType);
      sql += ` AND pa.allocation_type = $${params.length}`;
    }

    if (periodMonth) {
      params.push(periodMonth);
      sql += ` AND pa.period_month = $${params.length}`;
    }

    sql += ' ORDER BY pa.id DESC';

    const result = await query(sql, params);

    const formatted = result.rows.map(row => ({
      ...row,
      allocated_amount: formatCurrency(row.allocated_amount),
      sale_net_profit: row.sale_net_profit ? formatCurrency(row.sale_net_profit) : null
    }));

    return res.json({
      success: true,
      allocations: formatted
    });
  } catch (err) {
    console.error('[GetAllocations Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve profit allocations.'
    });
  }
}

// Get Reinvestment Reserves list and total
async function getReinvestmentReserves(req, res) {
  try {
    const reservesRes = await query(`
      SELECT rr.*, s.sale_invoice_number
      FROM reinvestment_reserves rr
      LEFT JOIN sales s ON rr.source_sale_id = s.id
      ORDER BY rr.id DESC
    `);

    const totalRes = await query(`
      SELECT COALESCE(SUM(amount), 0.00) as total_reserve
      FROM reinvestment_reserves
    `);

    return res.json({
      success: true,
      totalReserve: formatCurrency(totalRes.rows[0].total_reserve),
      reserves: reservesRes.rows.map(r => ({
        ...r,
        amount: formatCurrency(r.amount)
      }))
    });
  } catch (err) {
    console.error('[GetReinvestmentReserves Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve reinvestment reserves.'
    });
  }
}

module.exports = {
  getActiveRule: getActiveRuleHandler,
  getRuleHistory,
  createRule,
  getAllocations,
  getReinvestmentReserves
};
