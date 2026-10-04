const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../src/server');
const { query } = require('../src/config/db');
const { hashPassword, comparePassword, generateToken, verifyToken } = require('../src/utils/security');
const { add, subtract, multiply, divide, percentageOf } = require('../src/utils/decimal');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Decimal Financial Arithmetic Precision', () => {
  // Test addition
  assert.equal(add('1100.50', '250.25'), '1350.75');

  // Test subtraction
  assert.equal(subtract('2500.00', '1100.00'), '1400.00');

  // Test multiplication
  assert.equal(multiply('1100.00', 10), '11000.00');

  // Test percentage distribution (Section 7: 33%, 33%, 34% of 1000 net profit)
  const profit = '1000.00';
  const owner1Share = percentageOf(profit, '33.00');
  const owner2Share = percentageOf(profit, '33.00');
  const reinvestmentShare = percentageOf(profit, '34.00');

  assert.equal(owner1Share, '330.00');
  assert.equal(owner2Share, '330.00');
  assert.equal(reinvestmentShare, '340.00');

  // Total of allocations must equal exact profit without floating point drift
  const totalAllocated = add(add(owner1Share, owner2Share), reinvestmentShare);
  assert.equal(totalAllocated, '1000.00');
});

test('2. Password Security and JWT Token Handling', async () => {
  const plain = 'SecretPassword@2026';
  const hash = await hashPassword(plain);

  assert.notEqual(hash, plain);
  const isValid = await comparePassword(plain, hash);
  assert.equal(isValid, true);

  const isInvalid = await comparePassword('WrongPassword', hash);
  assert.equal(isInvalid, false);

  // JWT Token generation and verification
  const token = generateToken({ userId: 1, role: 'super_admin' });
  const decoded = verifyToken(token);
  assert.equal(decoded.userId, 1);
  assert.equal(decoded.role, 'super_admin');

  // Invalid token verification
  const invalidDecoded = verifyToken('invalid.jwt.token');
  assert.equal(invalidDecoded, null);
});

test('3. Database Connectivity and Seeded Records Verification', async () => {
  const usersRes = await query('SELECT email, role, status FROM users ORDER BY id ASC');
  assert.ok(usersRes.rows.length >= 3, 'Should have at least admin and 2 owners');

  const emails = usersRes.rows.map(u => u.email);
  assert.ok(emails.includes('admin@business.local'));
  assert.ok(emails.includes('owner1@business.local'));
  assert.ok(emails.includes('owner2@business.local'));

  // Verify Profit Allocation Rule exists (33%, 33%, 34%)
  const ruleRes = await query('SELECT reinvestment_percentage FROM profit_allocation_rules WHERE is_active = TRUE LIMIT 1');
  assert.equal(Number(ruleRes.rows[0].reinvestment_percentage), 34.00);

  // Verify Sample Product A exists
  const prodRes = await query('SELECT sku, purchase_cost_per_unit, min_selling_price, max_selling_price FROM products WHERE sku = $1', ['PROD-SPA-001']);
  assert.equal(prodRes.rows.length, 1);
  assert.equal(Number(prodRes.rows[0].purchase_cost_per_unit), 1100.00);
  assert.equal(Number(prodRes.rows[0].min_selling_price), 2000.00);
  assert.equal(Number(prodRes.rows[0].max_selling_price), 2500.00);
});

test('4. API /api/health Endpoint', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'UP');
  assert.equal(data.database, 'connected');
});

test('5. Authentication: Rejection of Invalid Credentials', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@business.local', password: 'WrongPassword123' })
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('6. Authentication: Successful Login and Role Session Issuance', async () => {
  // Test Super Admin Login
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@business.local', password: '549229044ktb' })
  });

  assert.equal(adminRes.status, 200);
  const adminData = await adminRes.json();
  assert.equal(adminData.success, true);
  assert.ok(adminData.token, 'Should return JWT token');
  assert.equal(adminData.user.role, 'super_admin');

  // Test Business Owner Login
  const ownerRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1@business.local', password: '549229044ktb' })
  });

  assert.equal(ownerRes.status, 200);
  const ownerData = await ownerRes.json();
  assert.equal(ownerData.success, true);
  assert.equal(ownerData.user.role, 'business_owner');

  // Verify Audit Log entry created for login
  const auditRes = await query('SELECT action, entity_type FROM audit_logs WHERE action = $1 ORDER BY id DESC LIMIT 1', ['LOGIN_SUCCESS']);
  assert.equal(auditRes.rows.length, 1);
  assert.equal(auditRes.rows[0].entity_type, 'users');
});

test('7. Protected Profile Route /api/auth/me', async () => {
  // 1. Without Token
  const unauthRes = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(unauthRes.status, 401);

  // 2. With Valid Admin Token
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@business.local', password: '549229044ktb' })
  });
  const { token } = await loginRes.json();

  const authRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  assert.equal(authRes.status, 200);
  const meData = await authRes.json();
  assert.equal(meData.success, true);
  assert.equal(meData.user.email, 'admin@business.local');
  assert.equal(meData.user.role, 'super_admin');
  assert.ok(Array.isArray(meData.user.permissions), 'Permissions array should be present');
});
