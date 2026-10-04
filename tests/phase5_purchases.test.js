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
    body: JSON.stringify({ email: 'admin@business.local', password: 'Admin@123456' })
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;

  // Owner login
  const ownerRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1@business.local', password: 'Owner1@123456' })
  });
  const ownerData = await ownerRes.json();
  ownerToken = ownerData.token;

  // Create clean product for weighted cost testing: 10 units @ 1100.00
  await query("DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-COST-TEST')");
  await query("DELETE FROM purchase_items WHERE product_id IN (SELECT id FROM products WHERE sku = 'PROD-COST-TEST')");
  await query("DELETE FROM products WHERE sku = 'PROD-COST-TEST'");

  const insertProd = await query(`
    INSERT INTO products (
      sku, name, purchase_cost_per_unit, quantity_purchased, quantity_available, min_selling_price, max_selling_price, status
    ) VALUES (
      'PROD-COST-TEST', 'Cost Test Product', 1100.00, 10, 10, 2000.00, 2500.00, 'Available'
    ) RETURNING id
  `);
  testProdId = insertProd.rows[0].id;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Record a purchase order and verify stock_purchases, purchase_items, and inventory_movements', async () => {
  const payload = {
    supplierName: 'Premier Wholesale Ltd',
    purchaseDate: '2026-03-01',
    notes: 'Restock shipment batch #44',
    items: [
      {
        productId: testProdId,
        quantity: 5,
        unitCost: 1100.00
      }
    ]
  };

  const res = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(payload)
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.purchase.purchase_order_number.startsWith('PO-'));
  assert.equal(data.purchase.total_cost, '5500.00');

  // Verify inventory_movements record
  const movementRes = await query(
    "SELECT movement_type, quantity, reference_type FROM inventory_movements WHERE reference_type = 'purchase_order' AND reference_id = $1",
    [data.purchase.id]
  );
  assert.equal(movementRes.rows.length, 1);
  assert.equal(movementRes.rows[0].movement_type, 'purchase_in');
  assert.equal(movementRes.rows[0].reference_type, 'purchase_order');
  assert.equal(movementRes.rows[0].quantity, 5);
});

test('2. Verify Moving Average / Weighted Unit Cost Arithmetic', async () => {
  // Currently: 15 units in hand (10 initial @ 1100 + 5 from test 1 @ 1100) -> 15 units @ 1100.00 = 16,500.00
  // Now purchase: 15 units @ 1300.00 -> 15 * 1300 = 19,500.00
  // Total value = 16,500 + 19,500 = 36,000.00
  // Total units = 15 + 15 = 30
  // Expected weighted unit cost = 36,000.00 / 30 = 1200.00 exactly!

  const payload = {
    supplierName: 'Premier Wholesale Ltd',
    purchaseDate: '2026-03-05',
    items: [
      {
        productId: testProdId,
        quantity: 15,
        unitCost: 1300.00
      }
    ]
  };

  const res = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(payload)
  });

  assert.equal(res.status, 201);

  // Check product in database
  const prodRes = await query('SELECT purchase_cost_per_unit, quantity_available FROM products WHERE id = $1', [testProdId]);
  const product = prodRes.rows[0];

  assert.equal(Number(product.purchase_cost_per_unit), 1200.00, 'Weighted unit cost must equal exactly 1200.00');
  assert.equal(product.quantity_available, 30, 'Quantity available must be exactly 30');
});

test('3. Inbound purchase transitions Sold Out product back to Available', async () => {
  // Manually set product to Sold Out (0 units)
  await query("UPDATE products SET quantity_available = 0, status = 'Sold Out' WHERE id = $1", [testProdId]);

  const payload = {
    supplierName: 'Emergency Restock',
    items: [
      {
        productId: testProdId,
        quantity: 10,
        unitCost: 1250.00
      }
    ]
  };

  const res = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(payload)
  });

  assert.equal(res.status, 201);

  const prodRes = await query('SELECT quantity_available, status, purchase_cost_per_unit FROM products WHERE id = $1', [testProdId]);
  assert.equal(prodRes.rows[0].quantity_available, 10);
  assert.equal(prodRes.rows[0].status, 'Available');
  assert.equal(Number(prodRes.rows[0].purchase_cost_per_unit), 1250.00);
});

test('4. Validation: Cannot create purchase order without items or with negative values', async () => {
  // No items
  const res1 = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ items: [] })
  });
  assert.equal(res1.status, 400);

  // Negative quantity
  const res2 = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      items: [{ productId: testProdId, quantity: -5, unitCost: 100 }]
    })
  });
  assert.equal(res2.status, 400);
});

test('5. RBAC: Business Owner cannot record a purchase order', async () => {
  const res = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      items: [{ productId: testProdId, quantity: 5, unitCost: 100 }]
    })
  });
  assert.equal(res.status, 403);
});

test('6. Business Owner CAN view purchase orders and inventory movement logs', async () => {
  const poRes = await fetch(`${baseUrl}/api/purchases`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert.equal(poRes.status, 200);
  const poData = await poRes.json();
  assert.ok(Array.isArray(poData.purchases));

  const movRes = await fetch(`${baseUrl}/api/purchases/movements/all`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert.equal(movRes.status, 200);
  const movData = await movRes.json();
  assert.ok(Array.isArray(movData.movements));
  assert.ok(movData.movements.length > 0);
});

test('7. Audit log verification for purchase order creation', async () => {
  const auditRes = await query(
    'SELECT action, entity_type FROM audit_logs WHERE action = $1 ORDER BY id DESC LIMIT 1',
    ['PURCHASE_ORDER_RECORDED']
  );
  assert.equal(auditRes.rows.length, 1);
  assert.equal(auditRes.rows[0].entity_type, 'stock_purchases');
});
