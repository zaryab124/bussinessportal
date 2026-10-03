const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../src/server');
const { query } = require('../src/config/db');

let server;
let baseUrl;
let adminToken;
let owner1Token;
let owner2Token;
let owner1Id;
let owner2Id;
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
    body: JSON.stringify({ email: 'admin@business.local', password: 'Admin@123456' })
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;

  // Owner 1 login
  const owner1Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1@business.local', password: 'Owner1@123456' })
  });
  const owner1Data = await owner1Res.json();
  owner1Token = owner1Data.token;
  owner1Id = owner1Data.user.id;

  // Owner 2 login
  const owner2Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner2@business.local', password: 'Owner2@123456' })
  });
  const owner2Data = await owner2Res.json();
  owner2Token = owner2Data.token;
  owner2Id = owner2Data.user.id;

  // Cleanup test sales, rules, movements, and products from previous test runs
  await query("DELETE FROM reinvestment_reserves WHERE source_sale_id IN (SELECT id FROM sales WHERE sale_invoice_number LIKE 'INV-PHASE8%')");
  await query("DELETE FROM profit_allocations WHERE sale_id IN (SELECT id FROM sales WHERE sale_invoice_number LIKE 'INV-PHASE8%')");
  await query("DELETE FROM financial_ledger WHERE reference_id IN (SELECT id FROM sales WHERE sale_invoice_number LIKE 'INV-PHASE8%')");
  await query("DELETE FROM inventory_movements WHERE reference_id IN (SELECT id FROM sales WHERE sale_invoice_number LIKE 'INV-PHASE8%')");
  await query("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE sale_invoice_number LIKE 'INV-PHASE8%')");
  await query("DELETE FROM sales WHERE sale_invoice_number LIKE 'INV-PHASE8%'");
  await query("DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-P8-TEST')");
  await query("DELETE FROM products WHERE sku = 'PROD-P8-TEST'");

  // Reset rules: ensure version 1 is active (33/33/34)
  await query("DELETE FROM profit_allocation_rule_owners WHERE rule_id IN (SELECT id FROM profit_allocation_rules WHERE version > 1)");
  await query("DELETE FROM profit_allocation_rules WHERE version > 1");
  await query("UPDATE profit_allocation_rules SET is_active = TRUE WHERE version = 1");

  // Insert test product: 10 units @ 1100.00, selling range 2000-2500
  const insertProd = await query(`
    INSERT INTO products (
      sku, name, purchase_cost_per_unit, quantity_purchased, quantity_available,
      min_selling_price, max_selling_price, status
    ) VALUES (
      'PROD-P8-TEST', 'Profit Test Product', 1100.00, 10, 10, 2000.00, 2500.00, 'Available'
    ) RETURNING id
  `);
  testProdId = insertProd.rows[0].id;
});

test.after(async () => {
  // Clean up created rules and restore baseline version 1 (33/33/34)
  await query("DELETE FROM profit_allocation_rule_owners WHERE rule_id IN (SELECT id FROM profit_allocation_rules WHERE version > 1)");
  await query("DELETE FROM profit_allocation_rules WHERE version > 1");
  await query("UPDATE profit_allocation_rules SET is_active = TRUE WHERE version = 1");

  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Active Rule Verification: Initial seeded rule is 33% Owner 1, 33% Owner 2, 34% Brand Reinvestment', async () => {
  const res = await fetch(`${baseUrl}/api/profit/rules/active`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.rule.version, 1);
  assert.equal(data.rule.reinvestment_percentage, '34.00');
  assert.equal(data.rule.owners.length, 2);

  const o1 = data.rule.owners.find(o => o.owner_id === owner1Id);
  const o2 = data.rule.owners.find(o => o.owner_id === owner2Id);
  assert.equal(o1.percentage, '33.00');
  assert.equal(o2.percentage, '33.00');
});

test('2. Percentage Validation: Rejects rule not summing to exactly 100.00%', async () => {
  // 30% + 30% + 30% = 90% (Not 100%)
  const failRes = await fetch(`${baseUrl}/api/profit/rules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      ruleName: 'Invalid Sum Rule',
      reinvestmentPercentage: '30.00',
      owners: [
        { ownerId: owner1Id, percentage: '30.00' },
        { ownerId: owner2Id, percentage: '30.00' }
      ]
    })
  });

  assert.equal(failRes.status, 400);
  const failData = await failRes.json();
  assert.match(failData.message, /must equal exactly 100.00%/);
});

test('3. RBAC: Business Owner cannot configure profit-sharing rules', async () => {
  const failRes = await fetch(`${baseUrl}/api/profit/rules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${owner1Token}`
    },
    body: JSON.stringify({
      ruleName: 'Owner Attempt Rule',
      reinvestmentPercentage: '34.00',
      owners: [
        { ownerId: owner1Id, percentage: '33.00' },
        { ownerId: owner2Id, percentage: '33.00' }
      ]
    })
  });

  assert.equal(failRes.status, 403);
});

test('4. Automated Profit Allocation on Sale: Net Profit Rs. 2,000 -> Rs. 660, Rs. 660, Rs. 680', async () => {
  // Confirm sale: 2 units @ Rs. 2,200 with Rs. 200 direct expenses
  // Gross Revenue = 4,400.00
  // COGS = 2 * 1,100 = 2,200.00
  // Direct Expenses = 200.00
  // Net Profit = 4400 - 2200 - 200 = 2,000.00
  const saleRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      saleInvoiceNumber: 'INV-PHASE8-001',
      directExpenses: '200.00',
      items: [{ productId: testProdId, quantity: 2, unitSellingPrice: '2200.00' }]
    })
  });

  assert.equal(saleRes.status, 201);
  const saleData = await saleRes.json();
  const saleId = saleData.sale.id;
  assert.equal(saleData.sale.net_profit, '2000.00');

  // Verify profit allocations in DB:
  // Owner 1: 33% of 2000 = 660.00
  // Owner 2: 33% of 2000 = 660.00
  // Brand Reinvestment: 34% of 2000 = 680.00
  const allocsRes = await query(`
    SELECT * FROM profit_allocations
    WHERE sale_id = $1
    ORDER BY owner_id ASC NULLS LAST
  `, [saleId]);

  assert.equal(allocsRes.rows.length, 3);

  const allocO1 = allocsRes.rows.find(a => a.owner_id === owner1Id);
  const allocO2 = allocsRes.rows.find(a => a.owner_id === owner2Id);
  const allocReinv = allocsRes.rows.find(a => a.allocation_type === 'brand_reinvestment');

  assert.equal(Number(allocO1.allocated_amount).toFixed(2), '660.00');
  assert.equal(allocO1.status, 'allocated');

  assert.equal(Number(allocO2.allocated_amount).toFixed(2), '660.00');
  assert.equal(allocO2.status, 'allocated');

  assert.equal(Number(allocReinv.allocated_amount).toFixed(2), '680.00');
  assert.equal(allocReinv.status, 'retained');

  // Verify reinvestment_reserves record
  const reinvRes = await query(`
    SELECT * FROM reinvestment_reserves WHERE source_sale_id = $1
  `, [saleId]);
  assert.equal(reinvRes.rows.length, 1);
  assert.equal(Number(reinvRes.rows[0].amount).toFixed(2), '680.00');
});

test('5. Strict Owner Horizontal Isolation: Owner 1 cannot see Owner 2 allocations', async () => {
  // Owner 1 fetches allocations
  const o1Res = await fetch(`${baseUrl}/api/profit/allocations`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(o1Res.status, 200);
  const o1Data = await o1Res.json();

  // All allocations returned to Owner 1 MUST have owner_id == owner1Id
  for (const alloc of o1Data.allocations) {
    assert.equal(alloc.owner_id, owner1Id);
  }

  // Owner 2 fetches allocations
  const o2Res = await fetch(`${baseUrl}/api/profit/allocations`, {
    headers: { 'Authorization': `Bearer ${owner2Token}` }
  });
  assert.equal(o2Res.status, 200);
  const o2Data = await o2Res.json();

  for (const alloc of o2Data.allocations) {
    assert.equal(alloc.owner_id, owner2Id);
  }

  // Super Admin can view all
  const adminListRes = await fetch(`${baseUrl}/api/profit/allocations`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminListRes.status, 200);
  const adminListData = await adminListRes.json();
  assert.ok(adminListData.allocations.length >= 3);
});

test('6. Versioning: Creating a new rule increments version and deactivates prior rule', async () => {
  // Create Version 2: 35% / 35% / 30%
  const createRes = await fetch(`${baseUrl}/api/profit/rules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      ruleName: '2026 Q2 Adjusted Sharing',
      reinvestmentPercentage: '30.00',
      notes: 'Updated partner percentage distribution',
      owners: [
        { ownerId: owner1Id, percentage: '35.00' },
        { ownerId: owner2Id, percentage: '35.00' }
      ]
    })
  });

  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.equal(createData.rule.version, 2);
  assert.equal(createData.rule.is_active, true);

  // Check that Version 1 is now inactive
  const v1Check = await query('SELECT is_active FROM profit_allocation_rules WHERE version = 1');
  assert.equal(v1Check.rows[0].is_active, false);

  // Active endpoint returns version 2
  const activeRes = await fetch(`${baseUrl}/api/profit/rules/active`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const activeData = await activeRes.json();
  assert.equal(activeData.rule.version, 2);
});

test('7. Sale Cancellation: Traceably reverses allocations and reinvestment reserve', async () => {
  const saleRes = await query("SELECT id FROM sales WHERE sale_invoice_number = 'INV-PHASE8-001'");
  const saleId = saleRes.rows[0].id;

  const cancelRes = await fetch(`${baseUrl}/api/sales/${saleId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ cancellationReason: 'Phase 8 test cancellation' })
  });

  assert.equal(cancelRes.status, 200);

  // Verify allocations for this sale are removed/reversed
  const allocCheck = await query('SELECT * FROM profit_allocations WHERE sale_id = $1', [saleId]);
  assert.equal(allocCheck.rows.length, 0);

  const reinvCheck = await query('SELECT * FROM reinvestment_reserves WHERE source_sale_id = $1', [saleId]);
  assert.equal(reinvCheck.rows.length, 0);
});
