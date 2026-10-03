const { query } = require('../config/db');
const { formatCurrency, add, subtract, multiply, divide, toDecimal } = require('../utils/decimal');

/**
 * Get currently active profit allocation rule with participating owner allocations
 */
async function getActiveRule(client = null) {
  const runQuery = (sql, params) => {
    if (client && typeof client.query === 'function') {
      return client.query(sql, params);
    }
    return query(sql, params);
  };

  const ruleRes = await runQuery(`
    SELECT * FROM profit_allocation_rules
    WHERE is_active = TRUE
    ORDER BY version DESC
    LIMIT 1
  `);

  if (ruleRes.rows.length === 0) {
    throw new Error('No active profit allocation rule found in the system.');
  }

  const rule = ruleRes.rows[0];

  const ownersRes = await runQuery(`
    SELECT paro.*, u.full_name as owner_name, u.email as owner_email
    FROM profit_allocation_rule_owners paro
    JOIN users u ON paro.owner_id = u.id
    WHERE paro.rule_id = $1
    ORDER BY paro.owner_id ASC
  `, [rule.id]);

  return {
    ...rule,
    reinvestment_percentage: formatCurrency(rule.reinvestment_percentage),
    owners: ownersRes.rows.map(o => ({
      ...o,
      percentage: formatCurrency(o.percentage)
    }))
  };
}

/**
 * Validates that reinvestment + sum of owner percentages == 100.00%
 */
function validateRulePercentages(reinvestmentPercentage, ownerPercentages) {
  const reinvestmentDec = toDecimal(reinvestmentPercentage);
  if (reinvestmentDec.lessThan(0) || reinvestmentDec.greaterThan(100)) {
    throw new Error('Reinvestment percentage must be between 0.00% and 100.00%.');
  }

  let totalDec = reinvestmentDec;
  for (const op of ownerPercentages) {
    const pDec = toDecimal(op.percentage);
    if (pDec.lessThan(0) || pDec.greaterThan(100)) {
      throw new Error(`Owner percentage must be between 0.00% and 100.00%.`);
    }
    totalDec = totalDec.plus(pDec);
  }

  if (!totalDec.equals(toDecimal('100.00'))) {
    throw new Error(`Total profit sharing percentages must equal exactly 100.00%. Current total: ${totalDec.toFixed(2)}%.`);
  }
}

/**
 * Automatically distribute net profit of a confirmed sale according to active rule
 */
async function allocateSaleProfit(client, saleId, netProfitAmount, recordedBy) {
  const netProfitDec = toDecimal(netProfitAmount);
  if (netProfitDec.lessThanOrEqualTo(0)) {
    // If net profit is 0 or negative (loss), no distributable profit to allocate
    return [];
  }

  const activeRule = await getActiveRule(client);
  const allocations = [];
  let allocatedSum = toDecimal('0.00');

  // 1. Calculate each owner's share
  for (const owner of activeRule.owners) {
    const ownerPctDec = toDecimal(owner.percentage).dividedBy(100);
    const ownerShare = netProfitDec.times(ownerPctDec).toDecimalPlaces(2, 4); // round half-up
    allocatedSum = allocatedSum.plus(ownerShare);

    const allocRes = await client.query(`
      INSERT INTO profit_allocations (
        sale_id, owner_id, allocated_amount, allocation_type, status
      ) VALUES ($1, $2, $3, 'owner_share', 'allocated')
      RETURNING *
    `, [saleId, owner.owner_id, ownerShare.toFixed(2)]);

    allocations.push({
      ...allocRes.rows[0],
      ownerName: owner.owner_name,
      percentage: owner.percentage
    });
  }

  // 2. Brand Reinvestment Share (takes the configured % plus any remainder for penny balancing)
  const remainingProfit = netProfitDec.minus(allocatedSum);
  const reinvestmentAmount = remainingProfit.toFixed(2);

  const reinvAllocRes = await client.query(`
    INSERT INTO profit_allocations (
      sale_id, owner_id, allocated_amount, allocation_type, status
    ) VALUES ($1, NULL, $2, 'brand_reinvestment', 'retained')
    RETURNING *
  `, [saleId, reinvestmentAmount]);

  // Record in reinvestment_reserves table
  await client.query(`
    INSERT INTO reinvestment_reserves (
      amount, source_sale_id, reason
    ) VALUES ($1, $2, $3)
  `, [
    reinvestmentAmount,
    saleId,
    `Brand Reinvestment (${activeRule.reinvestment_percentage}%) from Sale #${saleId}`
  ]);

  allocations.push({
    ...reinvAllocRes.rows[0],
    ownerName: 'Brand Reinvestment Reserve',
    percentage: activeRule.reinvestment_percentage
  });

  return allocations;
}

/**
 * Reverse profit allocations if a sale is cancelled
 */
async function reverseSaleProfitAllocations(client, saleId) {
  await client.query(`
    DELETE FROM reinvestment_reserves WHERE source_sale_id = $1
  `, [saleId]);

  await client.query(`
    DELETE FROM profit_allocations WHERE sale_id = $1
  `, [saleId]);
}

/**
 * Get profit and settlement statistics for a specific business owner
 */
async function getOwnerFinancialSummary(ownerId) {
  const allocRes = await query(`
    SELECT COALESCE(SUM(allocated_amount), 0.00) as total_allocated
    FROM profit_allocations
    WHERE owner_id = $1
  `, [ownerId]);

  const settledRes = await query(`
    SELECT COALESCE(SUM(amount), 0.00) as total_settled
    FROM owner_settlements
    WHERE owner_id = $1
  `, [ownerId]);

  const investRes = await query(`
    SELECT COALESCE(SUM(amount), 0.00) as total_invested
    FROM owner_investments
    WHERE owner_id = $1
  `, [ownerId]);

  const totalAllocated = toDecimal(allocRes.rows[0].total_allocated);
  const totalSettled = toDecimal(settledRes.rows[0].total_settled);
  const totalInvested = toDecimal(investRes.rows[0].total_invested);
  const pendingSettlement = totalAllocated.minus(totalSettled);

  return {
    totalAllocatedProfit: formatCurrency(totalAllocated),
    totalSettledProfit: formatCurrency(totalSettled),
    pendingSettlement: formatCurrency(pendingSettlement),
    totalInvestedCapital: formatCurrency(totalInvested)
  };
}

module.exports = {
  getActiveRule,
  validateRulePercentages,
  allocateSaleProfit,
  reverseSaleProfitAllocations,
  getOwnerFinancialSummary
};
