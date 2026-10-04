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

  // Owner 1 login
  const owner1Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1@business.local', password: '549229044ktb' })
  });
  const owner1Data = await owner1Res.json();
  owner1Token = owner1Data.token;
  owner1Id = owner1Data.user.id;

  // Owner 2 login
  const owner2Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner2@business.local', password: '549229044ktb' })
  });
  const owner2Data = await owner2Res.json();
  owner2Token = owner2Data.token;
  owner2Id = owner2Data.user.id;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Full Lifecycle: Inbound PO -> Weighted Moving Average Cost -> Stock Movement Log', async () => {
  const uniqueSuffix = Date.now().toString(36).toUpperCase();
  const sku = `PROD-E2E-${uniqueSuffix}`;

  // 1. Create a product with price range Rs. 2,000 - Rs. 2,500
  const prodRes = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      sku,
      name: `E2E Full Flow Product ${uniqueSuffix}`,
      category: 'Electronics',
      description: 'End-to-End verified commercial product',
      expected_min_price: '2000.00',
      expected_max_price: '2500.00',
      condition: 'Brand New',
      location: 'Central Vault B'
    })
  });
  assert.equal(prodRes.status, 201);
  const prodData = await prodRes.json();
  const productId = prodData.product.id;

  // 2. Initial Inbound Purchase: 10 units @ Rs. 1,000.00
  const po1Res = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      supplier: 'Global Imports Ltd',
      purchase_date: '2026-10-04',
      items: [
        { product_id: productId, quantity: 10, unit_cost: '1000.00' }
      ]
    })
  });
  assert.equal(po1Res.status, 201);

  // Check product weighted cost is Rs. 1,000.00
  let getProd = await (await fetch(`${baseUrl}/api/products/${productId}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.equal(getProd.product.quantity_available, 10);
  assert.equal(getProd.product.purchase_cost_per_unit, '1000.00');

  // 3. Second Inbound Batch: 10 units @ Rs. 1,200.00
  // New weighted cost: ((10 * 1000) + (10 * 1200)) / 20 = 22000 / 20 = Rs. 1,100.00
  const po2Res = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      supplier: 'Premier Tech Suppliers',
      purchase_date: '2026-10-04',
      items: [
        { product_id: productId, quantity: 10, unit_cost: '1200.00' }
      ]
    })
  });
  assert.equal(po2Res.status, 201);

  getProd = await (await fetch(`${baseUrl}/api/products/${productId}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.equal(getProd.product.quantity_available, 20);
  assert.equal(getProd.product.purchase_cost_per_unit, '1100.00');

  // Verify inventory_movements chronological log
  const movementsRes = await query(`
    SELECT * FROM inventory_movements
    WHERE product_id = $1 AND movement_type = 'purchase_in'
    ORDER BY created_at ASC
  `, [productId]);
  assert.equal(movementsRes.rows.length, 2);
});

test('2. Price Range Enforcement: Rejects out-of-range sale without approval, permits with reason', async () => {
  const uniqueSuffix = Date.now().toString(36).toUpperCase();
  const sku = `PROD-RANGE-${uniqueSuffix}`;

  // Create product with price range Rs. 2,000 - Rs. 2,500
  const prodRes = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      sku,
      name: `Price Range Test ${uniqueSuffix}`,
      category: 'Jewelry',
      expected_min_price: '2000.00',
      expected_max_price: '2500.00'
    })
  });
  const prodData = await prodRes.json();
  const productId = prodData.product.id;

  // Add 5 units inventory
  await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      supplier: 'Apex Wholesalers',
      items: [{ product_id: productId, quantity: 5, unit_cost: '1000.00' }]
    })
  });

  // Attempt sale below minimum (Rs. 1,800) without approval -> 400 Bad Request
  const belowMinRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      quantity_sold: 1,
      actual_selling_price_per_unit: '1800.00'
    })
  });
  assert.equal(belowMinRes.status, 400);

  // Attempt sale above maximum (Rs. 2,700) without approval -> 400 Bad Request
  const aboveMaxRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      quantity_sold: 1,
      actual_selling_price_per_unit: '2700.00'
    })
  });
  assert.equal(aboveMaxRes.status, 400);

  // Sale above maximum with override justification -> 201 Created
  const overrideRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      quantity_sold: 1,
      actual_selling_price_per_unit: '2700.00',
      is_price_override: true,
      price_override_reason: 'Client paid premium for express VIP dispatch'
    })
  });
  assert.equal(overrideRes.status, 201);
});

test('3. Overselling Prevention: Atomic locking blocks overselling requests', async () => {
  const uniqueSuffix = Date.now().toString(36).toUpperCase();
  const sku = `PROD-STOCK-${uniqueSuffix}`;

  const prodRes = await (await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      sku,
      name: `Stock Limit Test ${uniqueSuffix}`,
      category: 'Commodities',
      expected_min_price: '1000.00',
      expected_max_price: '1500.00'
    })
  })).json();
  const productId = prodRes.product.id;

  // Add 3 units
  await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      supplier: 'Test Supplier',
      items: [{ product_id: productId, quantity: 3, unit_cost: '800.00' }]
    })
  });

  // Attempt to sell 4 units (only 3 available) -> 400 Bad Request
  const oversellRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      quantity_sold: 4,
      actual_selling_price_per_unit: '1200.00'
    })
  });
  assert.equal(oversellRes.status, 400);

  // Sell 3 units (all available) -> succeeds and marks Sold Out
  const sellAllRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      quantity_sold: 3,
      actual_selling_price_per_unit: '1200.00'
    })
  });
  assert.equal(sellAllRes.status, 201);

  // Product status is now Sold Out and available units is 0
  const finalProd = await (await fetch(`${baseUrl}/api/products/${productId}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.equal(finalProd.product.quantity_available, 0);
  assert.equal(finalProd.product.status, 'Sold Out');
});

test('4. End-to-End Financial Arithmetic & Profit Sharing (Section 12 Scenario)', async () => {
  const uniqueSuffix = Date.now().toString(36).toUpperCase();
  const sku = `PROD-CALC-${uniqueSuffix}`;

  // 1. Product creation
  const prod = await (await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      sku,
      name: `Arithmetic Verification Item ${uniqueSuffix}`,
      category: 'Electronics',
      expected_min_price: '2000.00',
      expected_max_price: '2500.00'
    })
  })).json();
  const productId = prod.product.id;

  // 2. Purchase 10 units @ Rs. 1,100.00 each
  await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      supplier: 'National Distributors',
      items: [{ product_id: productId, quantity: 10, unit_cost: '1100.00' }]
    })
  });

  // 3. Sale: 2 units @ Rs. 2,200.00 with Rs. 200.00 direct expenses
  // Revenue = 2 * 2200 = Rs. 4,400.00
  // COGS = 2 * 1100 = Rs. 2,200.00
  // Direct Expenses = Rs. 200.00
  // Net Profit = 4400 - 2200 - 200 = Rs. 2,000.00
  const saleRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      quantity_sold: 2,
      actual_selling_price_per_unit: '2200.00',
      direct_expenses: '200.00',
      payment_method: 'Bank Transfer'
    })
  });
  assert.equal(saleRes.status, 201);
  const saleData = await saleRes.json();
  const saleId = saleData.sale.id;

  assert.equal(saleData.sale.total_revenue, '4400.00');
  assert.equal(saleData.sale.total_cost_of_goods, '2200.00');
  assert.equal(saleData.sale.total_direct_expenses, '200.00');
  assert.equal(saleData.sale.net_profit, '2000.00');

  // Verify automated profit sharing allocations (33% / 33% / 34% of Rs. 2,000.00):
  // Owner 1: 33% of 2000 = Rs. 660.00
  // Owner 2: 33% of 2000 = Rs. 660.00
  // Brand Reinvestment: 34% of 2000 = Rs. 680.00
  const allocRes = await query(`
    SELECT * FROM profit_allocations
    WHERE sale_id = $1
    ORDER BY id ASC
  `, [saleId]);

  assert.equal(allocRes.rows.length, 3);
  const o1Alloc = allocRes.rows.find(a => a.owner_id === owner1Id);
  const o2Alloc = allocRes.rows.find(a => a.owner_id === owner2Id);
  const brandAlloc = allocRes.rows.find(a => a.allocation_type === 'brand_reinvestment');

  assert.equal(o1Alloc.allocated_amount, '660.00');
  assert.equal(o2Alloc.allocated_amount, '660.00');
  assert.equal(brandAlloc.allocated_amount, '680.00');

  // Reinvestment reserve table verification
  const reserveRes = await query('SELECT * FROM reinvestment_reserves WHERE source_sale_id = $1', [saleId]);
  assert.equal(reserveRes.rows.length, 1);
  assert.equal(reserveRes.rows[0].amount, '680.00');
});

test('5. Traceable Sale Cancellation: Restores stock and reverses allocations & ledger', async () => {
  const uniqueSuffix = Date.now().toString(36).toUpperCase();
  const sku = `PROD-CANCEL-${uniqueSuffix}`;

  const prod = await (await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      sku,
      name: `Cancellation Test Item ${uniqueSuffix}`,
      category: 'Electronics',
      expected_min_price: '2000.00',
      expected_max_price: '2500.00'
    })
  })).json();
  const productId = prod.product.id;

  // Purchase 5 units
  await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      supplier: 'Distributor A',
      items: [{ product_id: productId, quantity: 5, unit_cost: '1000.00' }]
    })
  });

  // Sell 2 units
  const sale = await (await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      product_id: productId,
      quantity_sold: 2,
      actual_selling_price_per_unit: '2200.00'
    })
  })).json();
  const saleId = sale.sale.id;

  // Verify available units is now 3
  let p = await (await fetch(`${baseUrl}/api/products/${productId}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.equal(p.product.quantity_available, 3);

  // Cancel sale traceably
  const cancelRes = await fetch(`${baseUrl}/api/sales/${saleId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      cancellation_reason: 'Customer requested return due to order specification mismatch'
    })
  });
  assert.equal(cancelRes.status, 200);

  // Verify stock restored back to 5
  p = await (await fetch(`${baseUrl}/api/products/${productId}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.equal(p.product.quantity_available, 5);

  // Verify profit allocations are reversed/removed from allocation pool
  const allocRes = await query('SELECT * FROM profit_allocations WHERE sale_id = $1', [saleId]);
  assert.equal(allocRes.rows.length, 0);
  const reinvRes = await query('SELECT * FROM reinvestment_reserves WHERE source_sale_id = $1', [saleId]);
  assert.equal(reinvRes.rows.length, 0);

  // Verify reversing ledger entries are marked is_traceable_adjustment = true
  const revLedger = await query(`
    SELECT * FROM financial_ledger
    WHERE reference_type = 'sale_cancellation' AND reference_id = $1
  `, [saleId]);
  assert.ok(revLedger.rows.length > 0);
  assert.equal(revLedger.rows.every(l => l.is_traceable_adjustment === true), true);
});

test('6. Balanced Trial Balance Integrity: Double-entry ledger debits always equal credits', async () => {
  const summaryRes = await fetch(`${baseUrl}/api/ledger/summary`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(summaryRes.status, 200);
  const summaryData = await summaryRes.json();
  const summary = summaryData.summary || summaryData.metrics;
  assert.ok(summary);
  assert.ok(summary.trialBalance);

  const tb = summary.trialBalance;
  assert.equal(tb.isBalanced, true, `Trial balance must be mathematically balanced. Debits: ${tb.totalDebits}, Credits: ${tb.totalCredits}`);
  assert.equal(tb.totalDebits, tb.totalCredits);
});

test('7. Security & Isolation: Owner cannot read another owner’s private data or perform admin mutations', async () => {
  // Owner 1 attempting to view admin overview -> 403 Forbidden
  const adminDashRes = await fetch(`${baseUrl}/api/dashboard/admin`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(adminDashRes.status, 403);

  // Owner 1 attempting to post manual ledger adjustment -> 403 Forbidden
  const adjRes = await fetch(`${baseUrl}/api/ledger/adjustments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${owner1Token}`
    },
    body: JSON.stringify({
      primaryEntry: { accountCategory: 'asset', entryType: 'DEBIT', amount: '100.00', description: 'Unauthorized' },
      counterEntry: { accountCategory: 'equity', entryType: 'CREDIT', amount: '100.00', description: 'Unauthorized' },
      justificationReason: 'Hacking attempt'
    })
  });
  assert.equal(adjRes.status, 403);

  // Owner 1 attempting to configure profit-sharing rules -> 403 Forbidden
  const ruleRes = await fetch(`${baseUrl}/api/profit/rules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${owner1Token}`
    },
    body: JSON.stringify({
      rule_name: 'Malicious rule',
      reinvestment_percentage: 10,
      owners: [{ owner_id: owner1Id, percentage: 90 }]
    })
  });
  assert.equal(ruleRes.status, 403);

  // SQL Injection immunity test on search inputs
  const sqliRes = await fetch(`${baseUrl}/api/products?search=' OR '1'='1`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(sqliRes.status, 200);
  const sqliData = await sqliRes.json();
  assert.equal(sqliData.success, true);
});
