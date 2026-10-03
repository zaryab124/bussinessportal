const { query } = require('../config/db');
const { formatCurrency, add, subtract, toDecimal } = require('../utils/decimal');

function generateEntryNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `LED-${dateStr}-${rand}`;
}

/**
 * Insert a single ledger line entry into financial_ledger.
 * Must be called as part of a balanced double-entry transaction.
 */
async function postLedgerLine(client, {
  entryDate = new Date().toISOString(),
  accountCategory,
  entryType,
  amount,
  referenceType,
  referenceId,
  description,
  recordedBy,
  isTraceableAdjustment = false
}) {
  const amt = toDecimal(amount).toFixed(2);
  if (toDecimal(amt).lessThanOrEqualTo(0)) {
    throw new Error('Ledger entry amount must be greater than zero.');
  }

  const entryNumber = generateEntryNumber();

  const res = await client.query(`
    INSERT INTO financial_ledger (
      entry_number, entry_date, account_category, entry_type, amount,
      reference_type, reference_id, description, recorded_by, is_traceable_adjustment
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    entryNumber,
    entryDate,
    accountCategory,
    entryType,
    amt,
    referenceType,
    referenceId,
    description,
    recordedBy,
    isTraceableAdjustment
  ]);

  return res.rows[0];
}

/**
 * Record balanced double-entry lines for a confirmed sale:
 * 1. Revenue: DEBIT Cash/Receivables (asset) & CREDIT Sales (revenue)
 * 2. Inventory: DEBIT COGS (expense) & CREDIT Inventory On-Hand (asset)
 * 3. Direct Expenses (if any): DEBIT Direct Expenses (expense) & CREDIT Cash (asset)
 */
async function recordSaleLedger(client, sale, recordedBy) {
  const lines = [];
  const saleId = sale.id;
  const invoice = sale.sale_invoice_number;
  const saleDate = sale.sale_date || new Date().toISOString();

  // 1. Revenue
  if (toDecimal(sale.total_revenue).greaterThan(0)) {
    // Debit Asset (Cash / Bank Receivables)
    lines.push(await postLedgerLine(client, {
      entryDate: saleDate,
      accountCategory: 'asset',
      entryType: 'DEBIT',
      amount: sale.total_revenue,
      referenceType: 'sale',
      referenceId: saleId,
      description: `Cash/Receivable received for Sale ${invoice}`,
      recordedBy
    }));

    // Credit Revenue (Sales Revenue)
    lines.push(await postLedgerLine(client, {
      entryDate: saleDate,
      accountCategory: 'revenue',
      entryType: 'CREDIT',
      amount: sale.total_revenue,
      referenceType: 'sale',
      referenceId: saleId,
      description: `Sales Revenue recognized for Sale ${invoice}`,
      recordedBy
    }));
  }

  // 2. Cost of Goods Sold (COGS)
  if (toDecimal(sale.total_cost_of_goods).greaterThan(0)) {
    // Debit Expense (Cost of Goods Sold)
    lines.push(await postLedgerLine(client, {
      entryDate: saleDate,
      accountCategory: 'expense',
      entryType: 'DEBIT',
      amount: sale.total_cost_of_goods,
      referenceType: 'sale',
      referenceId: saleId,
      description: `Cost of Goods Sold (COGS) for Sale ${invoice}`,
      recordedBy
    }));

    // Credit Asset (Inventory On Hand reduction)
    lines.push(await postLedgerLine(client, {
      entryDate: saleDate,
      accountCategory: 'asset',
      entryType: 'CREDIT',
      amount: sale.total_cost_of_goods,
      referenceType: 'sale',
      referenceId: saleId,
      description: `Inventory reduction for Sale ${invoice}`,
      recordedBy
    }));
  }

  // 3. Direct Expenses (packaging, courier, handling)
  if (toDecimal(sale.total_direct_expenses).greaterThan(0)) {
    // Debit Expense (Direct Sales Expenses)
    lines.push(await postLedgerLine(client, {
      entryDate: saleDate,
      accountCategory: 'expense',
      entryType: 'DEBIT',
      amount: sale.total_direct_expenses,
      referenceType: 'sale',
      referenceId: saleId,
      description: `Direct Selling Expenses for Sale ${invoice}`,
      recordedBy
    }));

    // Credit Asset (Cash Outflow)
    lines.push(await postLedgerLine(client, {
      entryDate: saleDate,
      accountCategory: 'asset',
      entryType: 'CREDIT',
      amount: sale.total_direct_expenses,
      referenceType: 'sale',
      referenceId: saleId,
      description: `Cash outflow for Direct Selling Expenses for Sale ${invoice}`,
      recordedBy
    }));
  }

  return lines;
}

/**
 * Reverse ledger lines for a cancelled sale traceably
 */
async function reverseSaleLedger(client, sale, recordedBy, reason) {
  const lines = [];
  const saleId = sale.id;
  const invoice = sale.sale_invoice_number;
  const reversalDate = new Date().toISOString();

  // 1. Reversal of Revenue
  if (toDecimal(sale.total_revenue).greaterThan(0)) {
    // Debit Revenue (Reversal)
    lines.push(await postLedgerLine(client, {
      entryDate: reversalDate,
      accountCategory: 'revenue',
      entryType: 'DEBIT',
      amount: sale.total_revenue,
      referenceType: 'sale_cancellation',
      referenceId: saleId,
      description: `Reversal of Revenue for cancelled Sale ${invoice}: ${reason}`,
      recordedBy,
      isTraceableAdjustment: true
    }));

    // Credit Asset (Cash refund / receivable reversal)
    lines.push(await postLedgerLine(client, {
      entryDate: reversalDate,
      accountCategory: 'asset',
      entryType: 'CREDIT',
      amount: sale.total_revenue,
      referenceType: 'sale_cancellation',
      referenceId: saleId,
      description: `Reversal of Cash/Receivable for cancelled Sale ${invoice}: ${reason}`,
      recordedBy,
      isTraceableAdjustment: true
    }));
  }

  // 2. Reversal of COGS (Stock restored to asset)
  if (toDecimal(sale.total_cost_of_goods).greaterThan(0)) {
    // Debit Asset (Inventory restored)
    lines.push(await postLedgerLine(client, {
      entryDate: reversalDate,
      accountCategory: 'asset',
      entryType: 'DEBIT',
      amount: sale.total_cost_of_goods,
      referenceType: 'sale_cancellation',
      referenceId: saleId,
      description: `Restoration of Inventory Asset for cancelled Sale ${invoice}: ${reason}`,
      recordedBy,
      isTraceableAdjustment: true
    }));

    // Credit Expense (COGS reversed)
    lines.push(await postLedgerLine(client, {
      entryDate: reversalDate,
      accountCategory: 'expense',
      entryType: 'CREDIT',
      amount: sale.total_cost_of_goods,
      referenceType: 'sale_cancellation',
      referenceId: saleId,
      description: `Reversal of COGS for cancelled Sale ${invoice}: ${reason}`,
      recordedBy,
      isTraceableAdjustment: true
    }));
  }

  // 3. Reversal of Direct Expenses (if applicable)
  if (toDecimal(sale.total_direct_expenses).greaterThan(0)) {
    // Debit Asset (Cash recovery)
    lines.push(await postLedgerLine(client, {
      entryDate: reversalDate,
      accountCategory: 'asset',
      entryType: 'DEBIT',
      amount: sale.total_direct_expenses,
      referenceType: 'sale_cancellation',
      referenceId: saleId,
      description: `Reversal of Direct Expenses cash outflow for cancelled Sale ${invoice}: ${reason}`,
      recordedBy,
      isTraceableAdjustment: true
    }));

    // Credit Expense (Direct expense reversed)
    lines.push(await postLedgerLine(client, {
      entryDate: reversalDate,
      accountCategory: 'expense',
      entryType: 'CREDIT',
      amount: sale.total_direct_expenses,
      referenceType: 'sale_cancellation',
      referenceId: saleId,
      description: `Reversal of Direct Expenses for cancelled Sale ${invoice}: ${reason}`,
      recordedBy,
      isTraceableAdjustment: true
    }));
  }

  return lines;
}

/**
 * Record balanced double-entry lines for a purchase order:
 * DEBIT Asset (Inventory Inbound) & CREDIT Liability (Accounts Payable / Supplier)
 */
async function recordPurchaseLedger(client, purchase, recordedBy) {
  const lines = [];
  const poId = purchase.id;
  const poNumber = purchase.po_number;
  const poDate = purchase.purchase_date ? new Date(purchase.purchase_date).toISOString() : new Date().toISOString();

  if (toDecimal(purchase.total_cost).greaterThan(0)) {
    // Debit Asset (Inventory Inbound)
    lines.push(await postLedgerLine(client, {
      entryDate: poDate,
      accountCategory: 'asset',
      entryType: 'DEBIT',
      amount: purchase.total_cost,
      referenceType: 'purchase',
      referenceId: poId,
      description: `Inbound Inventory asset received from PO ${poNumber}`,
      recordedBy
    }));

    // Credit Liability (Accounts Payable / Vendor)
    lines.push(await postLedgerLine(client, {
      entryDate: poDate,
      accountCategory: 'liability',
      entryType: 'CREDIT',
      amount: purchase.total_cost,
      referenceType: 'purchase',
      referenceId: poId,
      description: `Accounts Payable owed to supplier for PO ${poNumber}`,
      recordedBy
    }));
  }

  return lines;
}

/**
 * Compute business financial metrics using exact fixed-precision calculations.
 */
async function getFinancialMetrics() {
  // 1. Confirmed Sales totals
  const salesAggRes = await query(`
    SELECT
      COALESCE(SUM(total_revenue), 0.00) as gross_revenue,
      COALESCE(SUM(total_cost_of_goods), 0.00) as total_cogs,
      COALESCE(SUM(total_direct_expenses), 0.00) as total_direct_expenses,
      COALESCE(SUM(net_profit), 0.00) as sales_net_profit,
      COUNT(id) as total_confirmed_sales
    FROM sales
    WHERE status = 'confirmed'
  `);
  const salesAgg = salesAggRes.rows[0];

  // 2. General operating expenses
  const expAggRes = await query(`
    SELECT COALESCE(SUM(amount), 0.00) as total_operating_expenses, COUNT(id) as expense_count
    FROM expenses
    WHERE sale_id IS NULL
  `);
  const expAgg = expAggRes.rows[0];

  // 3. Inventory asset valuation (on-hand sellable units * moving average purchase cost)
  const invRes = await query(`
    SELECT
      COALESCE(SUM(quantity_available * purchase_cost_per_unit), 0.00) as inventory_valuation,
      COALESCE(SUM(quantity_available), 0) as total_available_units
    FROM products
    WHERE status != 'Archived'
  `);
  const invAgg = invRes.rows[0];

  // 4. Owner contributed capital
  const investRes = await query(`
    SELECT COALESCE(SUM(amount), 0.00) as total_contributed_capital
    FROM owner_investments
  `);
  const totalInvested = investRes.rows[0].total_contributed_capital;

  // 5. Total settlements already distributed to owners
  const settleRes = await query(`
    SELECT COALESCE(SUM(amount), 0.00) as total_distributed_profit
    FROM owner_settlements
  `);
  const totalDistributed = settleRes.rows[0].total_distributed_profit;

  // 6. Retained brand reinvestment reserves
  const reserveRes = await query(`
    SELECT COALESCE(SUM(amount), 0.00) as total_reinvestment_reserve
    FROM reinvestment_reserves
  `);
  const totalReserve = reserveRes.rows[0].total_reinvestment_reserve;

  // 7. Trial balance verification from financial_ledger (Debits must balance Credits)
  const ledgerBalanceRes = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE 0 END), 0.00) as total_debits,
      COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE 0 END), 0.00) as total_credits
    FROM financial_ledger
  `);
  const { total_debits, total_credits } = ledgerBalanceRes.rows[0];

  // Net Profit formula: Gross Revenue - COGS - Direct Expenses - General Operating Expenses
  const grossRevenue = toDecimal(salesAgg.gross_revenue);
  const cogs = toDecimal(salesAgg.total_cogs);
  const directExpenses = toDecimal(salesAgg.total_direct_expenses);
  const operatingExpenses = toDecimal(expAgg.total_operating_expenses);

  const grossProfit = grossRevenue.minus(cogs);
  const totalExpenses = directExpenses.plus(operatingExpenses);
  const netDistributableProfit = grossProfit.minus(totalExpenses);

  return {
    grossRevenue: formatCurrency(grossRevenue),
    costOfGoodsSold: formatCurrency(cogs),
    grossProfit: formatCurrency(grossProfit),
    directSalesExpenses: formatCurrency(directExpenses),
    operatingExpenses: formatCurrency(operatingExpenses),
    totalBusinessExpenses: formatCurrency(totalExpenses),
    netDistributableProfit: formatCurrency(netDistributableProfit),
    inventoryValuation: formatCurrency(invAgg.inventory_valuation),
    totalAvailableUnits: parseInt(invAgg.total_available_units, 10),
    totalContributedCapital: formatCurrency(totalInvested),
    totalDistributedProfit: formatCurrency(totalDistributed),
    totalReinvestmentReserve: formatCurrency(totalReserve),
    totalConfirmedSales: parseInt(salesAgg.total_confirmed_sales, 10),
    trialBalance: {
      totalDebits: formatCurrency(total_debits),
      totalCredits: formatCurrency(total_credits),
      isBalanced: toDecimal(total_debits).equals(toDecimal(total_credits))
    }
  };
}

module.exports = {
  generateEntryNumber,
  postLedgerLine,
  recordSaleLedger,
  reverseSaleLedger,
  recordPurchaseLedger,
  getFinancialMetrics
};
