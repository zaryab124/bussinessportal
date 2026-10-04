const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// Ensure test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '5012';

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
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('1. Production Healthcheck Endpoint: Reports UP status and database connection', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'UP');
  assert.equal(data.database, 'connected');
  assert.ok(data.timestamp);
});

test('2. Unauthenticated Export Access: All export routes reject unauthenticated requests with 401', async () => {
  const routes = [
    '/api/export/products',
    '/api/export/sales',
    '/api/export/purchases',
    '/api/export/expenses',
    '/api/export/ledger',
    '/api/export/settlements',
    '/api/export/owner/allocations',
    '/api/export/owner/settlements'
  ];

  for (const r of routes) {
    const res = await fetch(`${baseUrl}${r}`);
    assert.equal(res.status, 401, `Route ${r} must return 401 Unauthorized`);
  }
});

test('3. RBAC on Admin Exports: Business Owner cannot export admin-only financial records (403)', async () => {
  const adminRoutes = [
    '/api/export/products',
    '/api/export/sales',
    '/api/export/purchases',
    '/api/export/expenses',
    '/api/export/ledger',
    '/api/export/settlements'
  ];

  for (const r of adminRoutes) {
    const res = await fetch(`${baseUrl}${r}`, {
      headers: { 'Authorization': `Bearer ${owner1Token}` }
    });
    assert.equal(res.status, 403, `Route ${r} must reject business owner with 403 Forbidden`);
  }
});

test('4. Super Admin Inventory Export: Produces compliant RFC 4180 CSV with headers and data', async () => {
  const res = await fetch(`${baseUrl}/api/export/products`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('text/csv'));
  assert.ok(res.headers.get('content-disposition').includes('inventory-products.csv'));

  const text = await res.text();
  assert.ok(text.startsWith('Product ID,SKU,Product Name,Category'));
  const lines = text.split('\r\n');
  assert.ok(lines.length >= 2, 'CSV should have at least header and rows');
});

test('5. Super Admin Sales, Ledger, Expenses, and Settlements CSV Exports', async () => {
  // Sales export
  const salesRes = await fetch(`${baseUrl}/api/export/sales`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(salesRes.status, 200);
  assert.ok(salesRes.headers.get('content-disposition').includes('sales-report.csv'));
  const salesText = await salesRes.text();
  assert.ok(salesText.includes('Sale ID,Invoice Number,Sale Date,SKU,Product Name'));

  // Ledger export
  const ledgerRes = await fetch(`${baseUrl}/api/export/ledger`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(ledgerRes.status, 200);
  assert.ok(ledgerRes.headers.get('content-disposition').includes('financial-ledger.csv'));
  const ledgerText = await ledgerRes.text();
  assert.ok(ledgerText.includes('Entry ID,Entry Number,Transaction Date,Account Name'));

  // Expenses export
  const expRes = await fetch(`${baseUrl}/api/export/expenses`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(expRes.status, 200);
  assert.ok(expRes.headers.get('content-disposition').includes('operating-expenses.csv'));
  const expText = await expRes.text();
  assert.ok(expText.includes('Expense ID,Expense Code,Category,Description,Amount'));

  // Settlements export
  const setRes = await fetch(`${baseUrl}/api/export/settlements`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(setRes.status, 200);
  assert.ok(setRes.headers.get('content-disposition').includes('owner-settlements.csv'));
  const setText = await setRes.text();
  assert.ok(setText.includes('Settlement ID,Settlement Code,Owner Name,Amount Paid'));
});

test('6. Owner Allocations & Settlements CSV Export with Strict Horizontal Isolation', async () => {
  // Owner 1 exports their own profit allocations
  const o1AllocRes = await fetch(`${baseUrl}/api/export/owner/allocations`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(o1AllocRes.status, 200);
  assert.ok(o1AllocRes.headers.get('content-type').includes('text/csv'));
  const o1Text = await o1AllocRes.text();
  assert.ok(o1Text.includes('Allocation ID,Sale ID,Product Name,SKU,Allocated Amount'));

  // Owner 1 attempts to pass ?owner_id=<owner2Id> to read Owner 2 allocations
  const tamperedRes = await fetch(`${baseUrl}/api/export/owner/allocations?owner_id=${owner2Id}`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(tamperedRes.status, 200);
  const tamperedText = await tamperedRes.text();
  // Ensure tampered output is still Owner 1's data, identical to o1Text
  assert.equal(tamperedText, o1Text, 'Tampered query param must be ignored for business_owner role');

  // Owner 1 exports settlements
  const o1SetRes = await fetch(`${baseUrl}/api/export/owner/settlements`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(o1SetRes.status, 200);
  const o1SetText = await o1SetRes.text();
  assert.ok(o1SetText.includes('Settlement ID,Settlement Code,Amount Paid,Settlement Date'));
});
