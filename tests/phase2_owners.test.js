const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const app = require('../src/server');
const { query } = require('../src/config/db');

let server;
let baseUrl;
let adminToken;
let owner1Token;
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

  // Clean up any test users from prior runs
  await query("DELETE FROM audit_logs WHERE entity_type = 'users' AND entity_id IN (SELECT id::text FROM users WHERE email LIKE 'newowner%')");
  await query("DELETE FROM users WHERE email LIKE 'newowner%' OR email LIKE 'test%'");

  // Log in as Super Admin
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@business.local', password: 'Admin@123456' })
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;

  // Log in as Owner 1
  const owner1Res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1@business.local', password: 'Owner1@123456' })
  });
  const owner1Data = await owner1Res.json();
  owner1Token = owner1Data.token;
  owner1Id = owner1Data.user.id;

  // Get Owner 2 ID
  const owner2Res = await query('SELECT id FROM users WHERE email = $1', ['owner2@business.local']);
  owner2Id = owner2Res.rows[0].id;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Super Admin can list all business owners without exposing password hashes', async () => {
  const res = await fetch(`${baseUrl}/api/users/owners`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.owners));
  assert.ok(data.owners.length >= 2);

  // Check no password hashes exposed
  for (const owner of data.owners) {
    assert.equal(owner.password_hash, undefined, 'Password hash must never be returned');
    assert.equal(owner.role, 'business_owner');
  }
});

test('2. Business Owner cannot list all other owners (RBAC protection)', async () => {
  const res = await fetch(`${baseUrl}/api/users/owners`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('3. Super Admin can create a new business owner account', async () => {
  const newOwnerPayload = {
    email: 'newowner@business.local',
    password: 'SecurePassword@2026',
    fullName: 'Partner Three',
    phone: '+92 300 1234567'
  };

  const res = await fetch(`${baseUrl}/api/users/owners`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify(newOwnerPayload)
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.owner.email, 'newowner@business.local');
  assert.equal(data.owner.role, 'business_owner');
  assert.equal(data.owner.status, 'active');
  assert.equal(data.owner.password_hash, undefined);
});

test('4. Cannot create duplicate owner account with existing email', async () => {
  const res = await fetch(`${baseUrl}/api/users/owners`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      email: 'newowner@business.local',
      password: 'AnotherPassword@2026',
      fullName: 'Duplicate Partner'
    })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('5. Non-admin cannot create a new owner', async () => {
  const res = await fetch(`${baseUrl}/api/users/owners`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${owner1Token}`
    },
    body: JSON.stringify({
      email: 'hacker@business.local',
      password: 'HackerPassword@2026',
      fullName: 'Unauthorized Creation'
    })
  });

  assert.equal(res.status, 403);
});

test('6. Strict Isolation: Owner 1 CANNOT view Owner 2 private details', async () => {
  const res = await fetch(`${baseUrl}/api/users/owners/${owner2Id}`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.message, /cannot view another owner's private account/i);
});

test('7. Owner 1 CAN view their own account details', async () => {
  const res = await fetch(`${baseUrl}/api/users/owners/${owner1Id}`, {
    headers: { 'Authorization': `Bearer ${owner1Token}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.owner.id, owner1Id);
  assert.equal(data.owner.password_hash, undefined);
});

test('8. Strict Isolation: Owner 1 CANNOT update Owner 2 account details', async () => {
  const res = await fetch(`${baseUrl}/api/users/owners/${owner2Id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${owner1Token}`
    },
    body: JSON.stringify({ fullName: 'Tampered Name' })
  });

  assert.equal(res.status, 403);
});

test('9. Super Admin can update owner status and suspended owner cannot log in', async () => {
  // Find test user newowner@business.local
  const userRes = await query('SELECT id FROM users WHERE email = $1', ['newowner@business.local']);
  const newOwnerId = userRes.rows[0].id;

  // Suspend owner
  const suspendRes = await fetch(`${baseUrl}/api/users/owners/${newOwnerId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ status: 'suspended' })
  });

  assert.equal(suspendRes.status, 200);
  const suspendData = await suspendRes.json();
  assert.equal(suspendData.success, true);
  assert.equal(suspendData.status, 'suspended');

  // Attempt login with suspended account
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newowner@business.local', password: 'SecurePassword@2026' })
  });

  assert.equal(loginRes.status, 403);
  const loginData = await loginRes.json();
  assert.match(loginData.message, /suspended/i);

  // Reactivate owner
  await fetch(`${baseUrl}/api/users/owners/${newOwnerId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ status: 'active' })
  });
});

test('10. Super Admin can reset owner password and audit log is recorded', async () => {
  const userRes = await query('SELECT id FROM users WHERE email = $1', ['newowner@business.local']);
  const newOwnerId = userRes.rows[0].id;

  const resetRes = await fetch(`${baseUrl}/api/users/owners/${newOwnerId}/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ newPassword: 'BrandNewPassword@2026' })
  });

  assert.equal(resetRes.status, 200);

  // Login with new password
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newowner@business.local', password: 'BrandNewPassword@2026' })
  });

  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.equal(loginData.success, true);

  // Check audit log
  const auditRes = await query(
    'SELECT action, entity_type FROM audit_logs WHERE action = $1 AND entity_id = $2',
    ['OWNER_PASSWORD_RESET', String(newOwnerId)]
  );
  assert.equal(auditRes.rows.length, 1);
});
