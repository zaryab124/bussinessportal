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

  // Clean and prepare Product A matching Section 4 & 12 specs:
  // 10 units @ 1100.00, Min selling price: 2000.00, Max: 2500.00
  await query("DELETE FROM inventory_movements WHERE reference_type IN ('sale', 'sale_cancellation') AND reference_id IN (SELECT id FROM sales WHERE sale_invoice_number LIKE 'INV-TEST%')");
  await query("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE sale_invoice_number LIKE 'INV-TEST%')");
  await query("DELETE FROM sales WHERE sale_invoice_number LIKE 'INV-TEST%'");
  await query("DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-SALE-TEST')");
  await query("DELETE FROM sale_items WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-SALE-TEST')");
  await query("DELETE FROM purchase_items WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-SALE-TEST')");
  await query("DELETE FROM products WHERE sku = 'PROD-SALE-TEST'");

  const insertProd = await query(`
    INSERT INTO products (
      sku, name, purchase_cost_per_unit, quantity_purchased, quantity_available,
      min_selling_price, max_selling_price, status
    ) VALUES (
      'PROD-SALE-TEST', 'Sample Product A', 1100.00, 10, 10, 2000.00, 2500.00, 'Available'
    ) RETURNING id
  `);
  testProdId = insertProd.rows[0].id;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('RBAC: Owner cannot create sales or cancel sales, but can view sales', async () => {
  // Owner tries to create sale -> 403 Forbidden
  const createRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      items: [{ productId: testProdId, quantity: 1, unitSellingPrice: '2200.00' }]
    })
  });
  assert.equal(createRes.status, 403);

  // Owner tries to cancel non-existent sale -> 403 Forbidden
  const cancelRes = await fetch(`${baseUrl}/api/sales/99999/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ cancellationReason: 'Unauthorized test' })
  });
  assert.equal(cancelRes.status, 403);

  // Owner can view sales -> 200 OK
  const listRes = await fetch(`${baseUrl}/api/sales`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.success, true);
  assert.ok(Array.isArray(listData.sales));
});

test('Price Range Enforcement: Rejects sales outside min-max without approval and documented reason', async () => {
  // Below min selling price (Rs. 1,800 vs min Rs. 2,000)
  const belowRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      items: [{ productId: testProdId, quantity: 1, unitSellingPrice: '1800.00' }]
    })
  });
  assert.equal(belowRes.status, 400);
  const belowData = await belowRes.json();
  assert.match(belowData.message, /outside configured range/);

  // Above max selling price (Rs. 2,600 vs max Rs. 2,500)
  const aboveRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      items: [{ productId: testProdId, quantity: 1, unitSellingPrice: '2600.00' }]
    })
  });
  assert.equal(aboveRes.status, 400);
  const aboveData = await aboveRes.json();
  assert.match(aboveData.message, /outside configured range/);
});

test('Price Override: Permits price outside range with explicit authorization and reason', async () => {
  const overrideRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      priceOverrideApproved: true,
      priceOverrideReason: 'Special VIP promotional discount agreed in board meeting',
      items: [{ productId: testProdId, quantity: 1, unitSellingPrice: '1900.00' }]
    })
  });
  assert.equal(overrideRes.status, 201);
  const overrideData = await overrideRes.json();
  assert.equal(overrideData.success, true);
  assert.equal(overrideData.sale.price_override_approved, true);
  assert.equal(overrideData.sale.price_override_reason, 'Special VIP promotional discount agreed in board meeting');

  // Cancel this override sale to restore stock to 10 for Section 12 test
  const cancelRes = await fetch(`${baseUrl}/api/sales/${overrideData.sale.id}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ cancellationReason: 'Cleanup override test' })
  });
  assert.equal(cancelRes.status, 200);
});

test('Section 12 Scenario: Sale of 2 units @ Rs. 2,200, COGS Rs. 2,200, Expenses Rs. 200, Net Profit Rs. 2,000', async () => {
  const saleRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      saleInvoiceNumber: 'INV-TEST-SEC12',
      customerReference: 'Customer VIP',
      directExpenses: '200.00',
      items: [
        {
          productId: testProdId,
          quantity: 2,
          unitSellingPrice: '2200.00'
        }
      ]
    })
  });

  assert.equal(saleRes.status, 201);
  const saleData = await saleRes.json();
  assert.equal(saleData.success, true);
  const sale = saleData.sale;

  // Verify financial formulas:
  // Revenue = 2 * 2200 = 4,400.00
  // COGS = 2 * 1100 = 2,200.00
  // Expenses = 200.00
  // Net Profit = 4400 - 2200 - 200 = 2,000.00
  assert.equal(sale.total_revenue, '4400.00');
  assert.equal(sale.total_cost_of_goods, '2200.00');
  assert.equal(sale.total_direct_expenses, '200.00');
  assert.equal(sale.net_profit, '2000.00');

  // Verify stock deduction in products table
  const prodCheck = await query('SELECT * FROM products WHERE id = $1', [testProdId]);
  const updatedProd = prodCheck.rows[0];
  assert.equal(updatedProd.quantity_available, 8);
  assert.equal(updatedProd.status, 'Partially Sold');

  // Verify inventory movement
  const mvtRes = await query(`
    SELECT * FROM inventory_movements
    WHERE product_id = $1 AND movement_type = 'sale_out' AND reference_id = $2
  `, [testProdId, sale.id]);
  assert.equal(mvtRes.rows.length, 1);
  assert.equal(mvtRes.rows[0].quantity, 2);
  assert.equal(Number(mvtRes.rows[0].unit_cost).toFixed(2), '1100.00');
});

test('Duplicate invoice number rejected with 409 Conflict', async () => {
  const dupRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      saleInvoiceNumber: 'INV-TEST-SEC12',
      items: [{ productId: testProdId, quantity: 1, unitSellingPrice: '2200.00' }]
    })
  });

  assert.equal(dupRes.status, 409);
  const dupData = await dupRes.json();
  assert.match(dupData.message, /already exists/);
});

test('Overselling Prevention: Rejects sale exceeding available inventory', async () => {
  // Current available is 8 units. Attempt to sell 9 units.
  const overRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      items: [{ productId: testProdId, quantity: 9, unitSellingPrice: '2200.00' }]
    })
  });

  assert.equal(overRes.status, 400);
  const overData = await overRes.json();
  assert.match(overData.message, /Insufficient stock/);

  // Verify inventory remains at 8
  const prodCheck = await query('SELECT quantity_available FROM products WHERE id = $1', [testProdId]);
  assert.equal(prodCheck.rows[0].quantity_available, 8);
});

test('Sell Out Transition: Selling all remaining units marks product as Sold Out', async () => {
  // Sell the remaining 8 units @ Rs. 2,300.00
  const selloutRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      items: [{ productId: testProdId, quantity: 8, unitSellingPrice: '2300.00' }]
    })
  });

  assert.equal(selloutRes.status, 201);

  // Check product status
  const prodCheck = await query('SELECT quantity_available, status FROM products WHERE id = $1', [testProdId]);
  assert.equal(prodCheck.rows[0].quantity_available, 0);
  assert.equal(prodCheck.rows[0].status, 'Sold Out');
});

test('Sale Cancellation: Traceably cancels sale, restores inventory, and logs sale_return_in', async () => {
  // Get the first sale (2 units sold)
  const saleRes = await query("SELECT id FROM sales WHERE sale_invoice_number = 'INV-TEST-SEC12'");
  const saleId = saleRes.rows[0].id;

  const cancelRes = await fetch(`${baseUrl}/api/sales/${saleId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      cancellationReason: 'Customer return due to order change'
    })
  });

  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.equal(cancelData.success, true);
  assert.equal(cancelData.sale.status, 'cancelled');

  // Verify stock is restored from 0 to 2
  const prodCheck = await query('SELECT quantity_available, status FROM products WHERE id = $1', [testProdId]);
  assert.equal(prodCheck.rows[0].quantity_available, 2);
  assert.equal(prodCheck.rows[0].status, 'Partially Sold');

  // Verify return movement logged
  const mvtRes = await query(`
    SELECT * FROM inventory_movements
    WHERE product_id = $1 AND movement_type = 'sale_return_in' AND reference_id = $2
  `, [testProdId, saleId]);
  assert.equal(mvtRes.rows.length, 1);
  assert.equal(mvtRes.rows[0].quantity, 2);
});
