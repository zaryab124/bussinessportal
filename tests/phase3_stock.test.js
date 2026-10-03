const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../src/server');
const { query } = require('../src/config/db');

let server;
let baseUrl;
let adminToken;
let ownerToken;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Clean up test products from prior runs
  await query("DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'PROD-TEST%')");
  await query("DELETE FROM audit_logs WHERE entity_type = 'products' AND entity_id IN (SELECT id::text FROM products WHERE sku LIKE 'PROD-TEST%')");
  await query("DELETE FROM products WHERE sku LIKE 'PROD-TEST%'");

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
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Section 12 Requirement: Create a product with purchase cost Rs. 1,100 & selling range Rs. 2,000–Rs. 2,500', async () => {
  const payload = {
    sku: 'PROD-TEST-1100',
    name: 'Standard Trading Unit X',
    category: 'Electronics',
    description: 'Verified test item for pricing and profit engine',
    condition: 'Brand New',
    location: 'Zone A',
    supplier: 'Apex Tech Imports',
    purchaseDate: '2026-02-01',
    purchaseCostPerUnit: 1100.00,
    quantityPurchased: 10,
    minSellingPrice: 2000.00,
    maxSellingPrice: 2500.00
  };

  const res = await fetch(`${baseUrl}/api/products`, {
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
  assert.equal(data.product.sku, 'PROD-TEST-1100');
  assert.equal(data.product.purchase_cost_per_unit, '1100.00');
  assert.equal(data.product.min_selling_price, '2000.00');
  assert.equal(data.product.max_selling_price, '2500.00');
  assert.equal(data.product.quantity_available, 10);
  assert.equal(data.product.status, 'Available');

  // Verify inventory_movements record created for purchase_in
  const movementRes = await query(
    'SELECT movement_type, quantity, unit_cost FROM inventory_movements WHERE product_id = $1',
    [data.product.id]
  );
  assert.equal(movementRes.rows.length, 1);
  assert.equal(movementRes.rows[0].movement_type, 'purchase_in');
  assert.equal(movementRes.rows[0].quantity, 10);
  assert.equal(Number(movementRes.rows[0].unit_cost), 1100.00);
});

test('2. Price range validation: Max selling price cannot be lower than min selling price', async () => {
  const invalidPayload = {
    sku: 'PROD-INVALID-PRICE',
    name: 'Invalid Price Item',
    purchaseCostPerUnit: 1000.00,
    quantityPurchased: 5,
    minSellingPrice: 2500.00,
    maxSellingPrice: 2000.00 // Less than min selling price
  };

  const res = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(invalidPayload)
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.message, /maximum selling price cannot be lower/i);
});

test('3. Duplicate SKU is rejected with 409 Conflict', async () => {
  const duplicatePayload = {
    sku: 'PROD-TEST-1100', // Already exists
    name: 'Duplicate SKU Product',
    purchaseCostPerUnit: 1100.00,
    quantityPurchased: 5,
    minSellingPrice: 2000.00,
    maxSellingPrice: 2500.00
  };

  const res = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(duplicatePayload)
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('4. RBAC: Business Owner cannot create or edit products', async () => {
  const res = await fetch(`${baseUrl}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerToken}`
    },
    body: JSON.stringify({
      sku: 'PROD-OWNER-ATTEMPT',
      name: 'Unauthorized Product',
      purchaseCostPerUnit: 500,
      quantityPurchased: 1,
      minSellingPrice: 1000,
      maxSellingPrice: 1500
    })
  });

  assert.equal(res.status, 403);
});

test('5. Business Owner CAN view stock listings and expected price ranges', async () => {
  const res = await fetch(`${baseUrl}/api/products`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.products));

  const testProd = data.products.find(p => p.sku === 'PROD-TEST-1100');
  assert.ok(testProd, 'Owner should see test product');
  assert.equal(testProd.min_selling_price, '2000.00');
  assert.equal(testProd.max_selling_price, '2500.00');
});

test('6. Traceable stock adjustment: deduct stock and transition status to Partially Sold', async () => {
  const prodRes = await query('SELECT id FROM products WHERE sku = $1', ['PROD-TEST-1100']);
  const prodId = prodRes.rows[0].id;

  const adjustRes = await fetch(`${baseUrl}/api/products/${prodId}/adjust`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      adjustmentType: 'adjustment_subtract',
      quantity: 3,
      reason: 'Physical inventory audit variance check'
    })
  });

  assert.equal(adjustRes.status, 200);
  const adjustData = await adjustRes.json();
  assert.equal(adjustData.success, true);
  assert.equal(adjustData.product.quantity_available, 7);
  assert.equal(adjustData.product.status, 'Partially Sold');

  // Verify inventory_movements record
  const movementRes = await query(
    'SELECT movement_type, quantity, notes FROM inventory_movements WHERE product_id = $1 AND movement_type = $2',
    [prodId, 'adjustment_subtract']
  );
  assert.equal(movementRes.rows.length, 1);
  assert.equal(movementRes.rows[0].quantity, 3);
  assert.match(movementRes.rows[0].notes, /Physical inventory audit/);
});

test('7. Stock adjustment: reduce stock to 0 and verify transition to Sold Out', async () => {
  const prodRes = await query('SELECT id FROM products WHERE sku = $1', ['PROD-TEST-1100']);
  const prodId = prodRes.rows[0].id;

  const adjustRes = await fetch(`${baseUrl}/api/products/${prodId}/adjust`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      adjustmentType: 'damage_loss',
      quantity: 7,
      reason: 'Batch write-off for damaged units'
    })
  });

  assert.equal(adjustRes.status, 200);
  const adjustData = await adjustRes.json();
  assert.equal(adjustData.product.quantity_available, 0);
  assert.equal(adjustData.product.status, 'Sold Out');
});

test('8. Product archiving sets status to Archived', async () => {
  const prodRes = await query('SELECT id FROM products WHERE sku = $1', ['PROD-TEST-1100']);
  const prodId = prodRes.rows[0].id;

  const res = await fetch(`${baseUrl}/api/products/${prodId}/archive`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);

  const check = await query('SELECT status FROM products WHERE id = $1', [prodId]);
  assert.equal(check.rows[0].status, 'Archived');
});

test('9. Inventory Stats calculates accurate valuation and metrics', async () => {
  const res = await fetch(`${baseUrl}/api/products/stats`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.stats.totalItems >= 2);
  assert.ok(typeof data.stats.totalInventoryValuation === 'string');
});
