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
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Super Admin Dashboard: Returns aggregate business KPIs and monthly breakdown', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/admin`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.stats);

  const s = data.stats;
  assert.ok(s.grossRevenue !== undefined);
  assert.ok(s.costOfGoodsSold !== undefined);
  assert.ok(s.netDistributableProfit !== undefined);
  assert.ok(s.inventoryValuation !== undefined);
  assert.ok(s.productStatusCounts);
  assert.ok(Array.isArray(s.monthlyPerformance));
  assert.ok(Array.isArray(s.topProducts));
  assert.ok(Array.isArray(s.recentSales));
});

test('2. RBAC: Business Owner cannot access admin dashboard endpoint', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/admin`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(res.status, 403);
});

test('3. Owner Dashboard: Returns private owner financial stats, investments, and shares', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/owner`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);

  const s = data.stats;
  // Business level figures visible to partner
  assert.ok(s.businessSalesRevenue !== undefined);
  assert.ok(s.businessNetProfit !== undefined);
  assert.ok(s.businessInventoryValuation !== undefined);
  assert.ok(s.reinvestmentReservePool !== undefined);

  // Private owner financial numbers
  assert.equal(s.ownerSharePercentage, '33.00');
  assert.ok(s.allocatedProfit !== undefined);
  assert.ok(s.settledProfit !== undefined);
  assert.ok(s.outstandingPayable !== undefined);
  assert.ok(s.contributedCapital !== undefined);
  assert.ok(Array.isArray(s.monthlyPerformance));
  assert.ok(Array.isArray(s.recentAllocations));
  assert.ok(Array.isArray(s.investments));
  assert.ok(Array.isArray(s.settlements));
  assert.ok(Array.isArray(s.soldOutProducts));

  // Verify that any recent allocations belong ONLY to this owner
  for (const alloc of s.recentAllocations) {
    assert.equal(alloc.owner_id, owner1Id);
  }
});

test('4. Strict Owner Horizontal Isolation: Owner 1 and Owner 2 receive isolated dashboards', async () => {
  // Add a unique test investment for Owner 1 only
  await query(`
    INSERT INTO owner_investments (owner_id, amount, investment_date, investment_type, notes, recorded_by)
    VALUES ($1, '50000.00', '2026-01-15', 'initial', 'Owner 1 Seed Capital', 1)
  `, [owner1Id]);

  // Fetch Owner 1 dashboard
  const o1Res = await fetch(`${baseUrl}/api/dashboard/owner`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });
  const o1Data = await o1Res.json();

  // Fetch Owner 2 dashboard
  const o2Res = await fetch(`${baseUrl}/api/dashboard/owner`, {
    headers: { 'Authorization': `Bearer ${owner2Token}` }
  });
  const o2Data = await o2Res.json();

  // Owner 1 must see their 50,000 investment
  const o1HasInv = o1Data.stats.investments.some(i => i.amount === '50000.00');
  assert.equal(o1HasInv, true);

  // Owner 2 MUST NOT see Owner 1's investment
  const o2HasInv = o2Data.stats.investments.some(i => i.amount === '50000.00');
  assert.equal(o2HasInv, false);

  // Cleanup test investment
  await query("DELETE FROM owner_investments WHERE notes = 'Owner 1 Seed Capital'");
});
