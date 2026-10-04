const { query } = require('../config/db');
const { formatCurrency, subtract, toDecimal } = require('../utils/decimal');
const { getFinancialMetrics } = require('../services/ledgerService');
const { getActiveRule, getOwnerFinancialSummary } = require('../services/profitEngine');

// Administrator Dashboard Metrics
async function getAdminDashboardStats(req, res) {
  try {
    const finSummary = await getFinancialMetrics();

    // Inventory breakdown by status
    const statusAggRes = await query(`
      SELECT status, COUNT(*) as count
      FROM products
      GROUP BY status
    `);
    const statusCounts = {};
    for (const r of statusAggRes.rows) {
      statusCounts[r.status] = parseInt(r.count, 10);
    }

    // Monthly performance aggregated from confirmed sales
    const monthlyRes = await query(`
      SELECT
        TO_CHAR(sale_date, 'YYYY-MM') as month,
        COUNT(id) as sale_count,
        COALESCE(SUM(total_revenue), 0.00) as revenue,
        COALESCE(SUM(total_cost_of_goods), 0.00) as cogs,
        COALESCE(SUM(total_direct_expenses), 0.00) as expenses,
        COALESCE(SUM(net_profit), 0.00) as net_profit
      FROM sales
      WHERE status = 'confirmed'
      GROUP BY TO_CHAR(sale_date, 'YYYY-MM')
      ORDER BY month DESC
      LIMIT 12
    `);

    // Top selling products by profit
    const topProdRes = await query(`
      SELECT p.id, p.sku, p.name,
             SUM(si.quantity) as units_sold,
             SUM(si.subtotal_revenue) as total_revenue,
             SUM(si.subtotal_cogs) as total_cogs,
             SUM(si.subtotal_profit) as total_profit
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.status = 'confirmed'
      GROUP BY p.id, p.sku, p.name
      ORDER BY total_profit DESC
      LIMIT 5
    `);

    // Recent 5 sales
    const recentSalesRes = await query(`
      SELECT s.id, s.sale_invoice_number, s.sale_date, s.total_revenue, s.net_profit, s.status,
             u.full_name as recorder_name
      FROM sales s
      LEFT JOIN users u ON s.recorded_by = u.id
      ORDER BY s.id DESC
      LIMIT 5
    `);

    // Active profit rule
    let activeRule = null;
    try {
      activeRule = await getActiveRule();
    } catch {
      activeRule = null;
    }

    return res.json({
      success: true,
      stats: {
        ...finSummary,
        productStatusCounts: {
          available: statusCounts['Available'] || 0,
          partiallySold: statusCounts['Partially Sold'] || 0,
          soldOut: statusCounts['Sold Out'] || 0,
          archived: statusCounts['Archived'] || 0
        },
        activeRule,
        monthlyPerformance: monthlyRes.rows.map(m => ({
          month: m.month,
          saleCount: parseInt(m.sale_count, 10),
          revenue: formatCurrency(m.revenue),
          cogs: formatCurrency(m.cogs),
          expenses: formatCurrency(m.expenses),
          netProfit: formatCurrency(m.net_profit)
        })),
        topProducts: topProdRes.rows.map(tp => ({
          id: tp.id,
          sku: tp.sku,
          name: tp.name,
          unitsSold: parseInt(tp.units_sold, 10),
          totalRevenue: formatCurrency(tp.total_revenue),
          totalCogs: formatCurrency(tp.total_cogs),
          totalProfit: formatCurrency(tp.total_profit)
        })),
        recentSales: recentSalesRes.rows.map(rs => ({
          ...rs,
          total_revenue: formatCurrency(rs.total_revenue),
          net_profit: formatCurrency(rs.net_profit)
        }))
      }
    });
  } catch (err) {
    console.error('[AdminDashboardStats Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to load administrator dashboard metrics.'
    });
  }
}

// Business Owner Dashboard Metrics (Enforcing strict owner isolation)
async function getOwnerDashboardStats(req, res) {
  try {
    const ownerId = req.user.id;

    // 1. Business-level aggregates (Section 8: "Total sales revenue for the business, Business net profit")
    const finSummary = await getFinancialMetrics();

    // 2. Owner-specific profit and investment financials
    const ownerSummary = await getOwnerFinancialSummary(ownerId);

    // 3. Active rule percentage for this specific owner
    let activeRule = null;
    let ownerPercentage = '0.00';
    try {
      activeRule = await getActiveRule();
      const ownerEntry = activeRule.owners.find(o => o.owner_id === ownerId);
      if (ownerEntry) {
        ownerPercentage = ownerEntry.percentage;
      }
    } catch {
      activeRule = null;
    }

    // 4. Owner's monthly allocated profits
    const monthlyAllocRes = await query(`
      SELECT
        TO_CHAR(pa.created_at, 'YYYY-MM') as month,
        COUNT(pa.id) as allocation_count,
        COALESCE(SUM(pa.allocated_amount), 0.00) as allocated_profit
      FROM profit_allocations pa
      WHERE pa.owner_id = $1
      GROUP BY TO_CHAR(pa.created_at, 'YYYY-MM')
      ORDER BY month DESC
      LIMIT 12
    `, [ownerId]);

    // 5. Owner's recent profit allocations
    const recentAllocRes = await query(`
      SELECT pa.id, pa.owner_id, pa.allocated_amount, pa.status, pa.created_at,
             s.sale_invoice_number, s.sale_date, s.total_revenue, s.net_profit as sale_net_profit
      FROM profit_allocations pa
      LEFT JOIN sales s ON pa.sale_id = s.id
      WHERE pa.owner_id = $1
      ORDER BY pa.id DESC
      LIMIT 10
    `, [ownerId]);

    // 6. Owner's investment contributions history
    const investHistoryRes = await query(`
      SELECT id, amount, investment_date, investment_type, notes, created_at
      FROM owner_investments
      WHERE owner_id = $1
      ORDER BY investment_date DESC
    `, [ownerId]);

    // 7. Owner's settlement payout history
    const settlementsRes = await query(`
      SELECT id, settlement_code, amount, settlement_date, payment_method, reference_note
      FROM owner_settlements
      WHERE owner_id = $1
      ORDER BY settlement_date DESC
    `, [ownerId]);

    // 8. Sold-out products list
    const soldOutRes = await query(`
      SELECT id, sku, name, purchase_cost_per_unit, quantity_purchased
      FROM products
      WHERE status = 'Sold Out'
      ORDER BY updated_at DESC
      LIMIT 5
    `);

    return res.json({
      success: true,
      stats: {
        businessSalesRevenue: finSummary.grossRevenue,
        businessNetProfit: finSummary.netDistributableProfit,
        businessInventoryValuation: finSummary.inventoryValuation,
        reinvestmentReservePool: finSummary.totalReinvestmentReserve,
        ownerSharePercentage: ownerPercentage,
        allocatedProfit: ownerSummary.totalAllocatedProfit,
        settledProfit: ownerSummary.totalSettledProfit,
        outstandingPayable: ownerSummary.pendingSettlement,
        contributedCapital: ownerSummary.totalInvestedCapital,
        monthlyPerformance: monthlyAllocRes.rows.map(m => ({
          month: m.month,
          allocationCount: parseInt(m.allocation_count, 10),
          allocatedProfit: formatCurrency(m.allocated_profit)
        })),
        recentAllocations: recentAllocRes.rows.map(a => ({
          ...a,
          allocated_amount: formatCurrency(a.allocated_amount),
          total_revenue: a.total_revenue ? formatCurrency(a.total_revenue) : null,
          sale_net_profit: a.sale_net_profit ? formatCurrency(a.sale_net_profit) : null
        })),
        investments: investHistoryRes.rows.map(inv => ({
          ...inv,
          amount: formatCurrency(inv.amount)
        })),
        settlements: settlementsRes.rows.map(s => ({
          ...s,
          amount: formatCurrency(s.amount)
        })),
        soldOutProducts: soldOutRes.rows.map(sp => ({
          ...sp,
          purchase_cost_per_unit: formatCurrency(sp.purchase_cost_per_unit)
        }))
      }
    });
  } catch (err) {
    console.error('[OwnerDashboardStats Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to load owner private dashboard metrics.'
    });
  }
}

module.exports = {
  getAdminDashboardStats,
  getOwnerDashboardStats
};
