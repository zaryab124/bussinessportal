const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../src/server');
const { query } = require('../src/config/db');

let server;
let baseUrl;
let adminToken;
let ownerToken;
let testProdId;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Admin login
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@business.local', password: '549229044ktb' })
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;

  // Owner login
  const ownerRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1@business.local', password: '549229044ktb' })
  });
  const ownerData = await ownerRes.json();
  ownerToken = ownerData.token;

  // Cleanup any test items from previous runs
  await query("DELETE FROM financial_ledger WHERE description LIKE '%PHASE7%' OR reference_type LIKE '%phase7%'");
  await query("DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-LEDGER-TEST')");
  await query("DELETE FROM sale_items WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-LEDGER-TEST')");
  await query("DELETE FROM sales WHERE sale_invoice_number LIKE 'INV-LEDGER-%'");
  await query("DELETE FROM purchase_items WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-LEDGER-TEST')");
  await query("DELETE FROM stock_purchases WHERE purchase_order_number LIKE 'PO-LEDGER-%'");
  await query("DELETE FROM products WHERE sku = 'PROD-LEDGER-TEST'");

  // Insert fresh test product: 10 units @ 1100.00
  const insertProd = await query(`
    INSERT INTO products (
      sku, name, purchase_cost_per_unit, quantity_purchased, quantity_available,
      min_selling_price, max_selling_price, status
    ) VALUES (
      'PROD-LEDGER-TEST', 'Ledger Test Product', 1100.00, 10, 10, 2000.00, 2500.00, 'Available'
    ) RETURNING id
  `);
  testProdId = insertProd.rows[0].id;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. RBAC: Owner can view ledger and financial summary, but cannot record manual adjustments', async () => {
  // Owner view ledger
  const listRes = await fetch(`${baseUrl}/api/ledger`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.success, true);
  assert.ok(Array.isArray(listData.entries));

  // Owner view summary
  const summaryRes = await fetch(`${baseUrl}/api/ledger/summary`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert.equal(summaryRes.status, 200);
  const summaryData = await summaryRes.json();
  assert.equal(summaryData.success, true);
  assert.ok(summaryData.summary.trialBalance);

  // Owner attempts adjustment -> 403 Forbidden
  const adjRes = await fetch(`${baseUrl}/api/ledger/adjustment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      primaryAccountCategory: 'expense',
      primaryEntryType: 'DEBIT',
      counterAccountCategory: 'asset',
      counterEntryType: 'CREDIT',
      amount: '500.00',
      justification: 'Unauthorized test adjustment'
    })
  });
  assert.equal(adjRes.status, 403);
});

test('2. Purchase Order generates balanced double-entry lines in financial_ledger', async () => {
  const poRes = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      purchaseOrderNumber: 'PO-LEDGER-001',
      supplier: 'Ledger Vendor Ltd',
      purchaseDate: new Date().toISOString().slice(0, 10),
      items: [{ productId: testProdId, quantity: 5, unitCost: '1100.00' }]
    })
  });

  assert.equal(poRes.status, 201);
  const poData = await poRes.json();
  const poId = poData.purchase.id;

  // Total cost = 5 * 1100 = 5500.00
  // Check financial_ledger lines for this PO
  const ledgerLinesRes = await query(`
    SELECT * FROM financial_ledger
    WHERE reference_type = 'purchase' AND reference_id = $1
    ORDER BY id ASC
  `, [poId]);

  assert.equal(ledgerLinesRes.rows.length, 2);
  const [debitLine, creditLine] = ledgerLinesRes.rows;

  assert.equal(debitLine.account_category, 'asset');
  assert.equal(debitLine.entry_type, 'DEBIT');
  assert.equal(Number(debitLine.amount).toFixed(2), '5500.00');

  assert.equal(creditLine.account_category, 'liability');
  assert.equal(creditLine.entry_type, 'CREDIT');
  assert.equal(Number(creditLine.amount).toFixed(2), '5500.00');
});

test('3. Confirmed Sale generates balanced Revenue, COGS, and Direct Expense double-entry lines', async () => {
  // Sell 2 units @ Rs. 2,200 with direct expense Rs. 200
  const saleRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      saleInvoiceNumber: 'INV-LEDGER-001',
      directExpenses: '200.00',
      items: [{ productId: testProdId, quantity: 2, unitSellingPrice: '2200.00' }]
    })
  });

  assert.equal(saleRes.status, 201);
  const saleData = await saleRes.json();
  const saleId = saleData.sale.id;

  // Expect 6 ledger lines:
  // 1. DEBIT asset (Cash) 4,400.00
  // 2. CREDIT revenue (Sales) 4,400.00
  // 3. DEBIT expense (COGS) 2,200.00
  // 4. CREDIT asset (Inventory) 2,200.00
  // 5. DEBIT expense (Direct Expenses) 200.00
  // 6. CREDIT asset (Cash) 200.00
  const ledgerLinesRes = await query(`
    SELECT account_category, entry_type, amount, description
    FROM financial_ledger
    WHERE reference_type = 'sale' AND reference_id = $1
    ORDER BY id ASC
  `, [saleId]);

  assert.equal(ledgerLinesRes.rows.length, 6);

  // Check sum of debits == sum of credits for this sale
  let debits = 0;
  let credits = 0;
  for (const row of ledgerLinesRes.rows) {
    if (row.entry_type === 'DEBIT') debits += Number(row.amount);
    if (row.entry_type === 'CREDIT') credits += Number(row.amount);
  }
  assert.equal(debits.toFixed(2), credits.toFixed(2));
  assert.equal(debits.toFixed(2), '6800.00'); // 4400 + 2200 + 200
});

test('4. Sale Cancellation creates traceable balancing reversal entries with is_traceable_adjustment = true', async () => {
  const saleRes = await query("SELECT id FROM sales WHERE sale_invoice_number = 'INV-LEDGER-001'");
  const saleId = saleRes.rows[0].id;

  const cancelRes = await fetch(`${baseUrl}/api/sales/${saleId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ cancellationReason: 'PHASE7 ledger audit reversal test' })
  });

  assert.equal(cancelRes.status, 200);

  // Check reversal ledger lines
  const revRes = await query(`
    SELECT account_category, entry_type, amount, is_traceable_adjustment
    FROM financial_ledger
    WHERE reference_type = 'sale_cancellation' AND reference_id = $1
    ORDER BY id ASC
  `, [saleId]);

  assert.equal(revRes.rows.length, 6);
  for (const row of revRes.rows) {
    assert.equal(row.is_traceable_adjustment, true);
  }

  let debits = 0;
  let credits = 0;
  for (const row of revRes.rows) {
    if (row.entry_type === 'DEBIT') debits += Number(row.amount);
    if (row.entry_type === 'CREDIT') credits += Number(row.amount);
  }
  assert.equal(debits.toFixed(2), credits.toFixed(2));
  assert.equal(debits.toFixed(2), '6800.00');
});

test('5. Traceable manual adjustment requires justification and balanced DEBIT/CREDIT', async () => {
  // Reject missing justification
  const noJustRes = await fetch(`${baseUrl}/api/ledger/adjustment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      primaryAccountCategory: 'expense',
      primaryEntryType: 'DEBIT',
      counterAccountCategory: 'asset',
      counterEntryType: 'CREDIT',
      amount: '150.00',
      justification: ''
    })
  });
  assert.equal(noJustRes.status, 400);

  // Reject unbalanced types (both DEBIT)
  const unbalanceRes = await fetch(`${baseUrl}/api/ledger/adjustment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      primaryAccountCategory: 'expense',
      primaryEntryType: 'DEBIT',
      counterAccountCategory: 'asset',
      counterEntryType: 'DEBIT',
      amount: '150.00',
      justification: 'PHASE7 test invalid unbalanced'
    })
  });
  assert.equal(unbalanceRes.status, 400);

  // Valid adjustment
  const validRes = await fetch(`${baseUrl}/api/ledger/adjustment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      primaryAccountCategory: 'expense',
      primaryEntryType: 'DEBIT',
      counterAccountCategory: 'asset',
      counterEntryType: 'CREDIT',
      amount: '150.00',
      justification: 'PHASE7 Office supplies traceable audit adjustment'
    })
  });
  assert.equal(validRes.status, 201);
  const validData = await validRes.json();
  assert.equal(validData.success, true);
  assert.equal(validData.entries.length, 2);
  assert.equal(validData.entries[0].is_traceable_adjustment, true);
  assert.equal(validData.entries[1].is_traceable_adjustment, true);
});

test('6. Financial Summary validates mathematical consistency and Trial Balance', async () => {
  const summaryRes = await fetch(`${baseUrl}/api/ledger/summary`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(summaryRes.status, 200);
  const { summary } = await summaryRes.json();

  assert.ok(summary.grossRevenue);
  assert.ok(summary.costOfGoodsSold);
  assert.ok(summary.grossProfit);
  assert.ok(summary.netDistributableProfit);
  assert.ok(summary.inventoryValuation);
  assert.ok(typeof summary.totalAvailableUnits === 'number');

  // Verify Trial Balance: Total Debits == Total Credits
  assert.equal(summary.trialBalance.isBalanced, true);
  assert.equal(summary.trialBalance.totalDebits, summary.trialBalance.totalCredits);
});
