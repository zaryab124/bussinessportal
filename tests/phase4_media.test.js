const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../src/server');
const { query } = require('../src/config/db');

let server;
let baseUrl;
let adminToken;
let ownerToken;
let testProductId;

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

  // Ensure test product exists
  const prodRes = await query('SELECT id FROM products WHERE sku = $1', ['PROD-SPA-001']);
  testProductId = prodRes.rows[0].id;

  // Clean existing media for test product
  await query('DELETE FROM product_media WHERE product_id = $1', [testProductId]);
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test('1. Scenario 3 of Section 12: Upload multiple product images for a product', async () => {
  const formData = new FormData();

  // Create fake image buffers
  const img1Blob = new Blob([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])], { type: 'image/jpeg' });
  const img2Blob = new Blob([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A])], { type: 'image/png' });

  formData.append('files', img1Blob, 'product_front.jpg');
  formData.append('files', img2Blob, 'product_angle.png');

  const res = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: formData
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.media.length, 2);

  // Check first image is automatically set as primary
  assert.equal(data.media[0].is_primary, true);
  assert.equal(data.media[0].media_type, 'image');
  assert.equal(data.media[1].is_primary, false);

  // Verify file was saved to disk
  const diskPath1 = path.resolve(process.cwd(), data.media[0].file_url.replace(/^\//, ''));
  assert.ok(fs.existsSync(diskPath1), 'File 1 must exist on disk');
});

test('2. Upload product video (MP4) and verify media_type is video', async () => {
  const formData = new FormData();
  const videoBlob = new Blob([Buffer.from('fake mp4 video content')], { type: 'video/mp4' });
  formData.append('files', videoBlob, 'product_demo.mp4');

  const res = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: formData
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.media[0].media_type, 'video');
  assert.equal(data.media[0].is_primary, false);
});

test('3. Security: Rejection of unsupported or dangerous MIME types', async () => {
  const formData = new FormData();
  const scriptBlob = new Blob([Buffer.from('alert("xss")')], { type: 'application/javascript' });
  formData.append('files', scriptBlob, 'malicious.js');

  const res = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: formData
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.message, /not supported/i);
});

test('4. Super Admin can change primary showcase image', async () => {
  // Get current media
  const listRes = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const listData = await listRes.json();
  const images = listData.media.filter(m => m.media_type === 'image');
  assert.ok(images.length >= 2);

  const newPrimary = images[1];

  const patchRes = await fetch(`${baseUrl}/api/products/${testProductId}/media/${newPrimary.id}/primary`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  assert.equal(patchRes.status, 200);

  // Verify updated primary
  const verifyRes = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const verifyData = await verifyRes.json();
  const updatedPrimary = verifyData.media.find(m => m.id === newPrimary.id);
  assert.equal(updatedPrimary.is_primary, true);
});

test('5. RBAC: Business Owner cannot upload or delete media', async () => {
  const formData = new FormData();
  const imgBlob = new Blob([Buffer.from([0xFF, 0xD8])], { type: 'image/jpeg' });
  formData.append('files', imgBlob, 'owner_attempt.jpg');

  // Attempt upload by owner
  const uploadRes = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ownerToken}` },
    body: formData
  });
  assert.equal(uploadRes.status, 403);

  // Attempt delete by owner
  const delRes = await fetch(`${baseUrl}/api/products/${testProductId}/media/1`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert.equal(delRes.status, 403);
});

test('6. Business Owner CAN view product media gallery', async () => {
  const res = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.media));
  assert.ok(data.media.length >= 2);
});

test('7. Super Admin can delete a media item and clean up physical storage', async () => {
  const listRes = await fetch(`${baseUrl}/api/products/${testProductId}/media`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const listData = await listRes.json();
  const target = listData.media[0];

  const diskPath = path.resolve(process.cwd(), target.file_url.replace(/^\//, ''));
  assert.ok(fs.existsSync(diskPath), 'Physical file should exist before delete');

  const delRes = await fetch(`${baseUrl}/api/products/${testProductId}/media/${target.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  assert.equal(delRes.status, 200);
  assert.ok(!fs.existsSync(diskPath), 'Physical file must be unlinked after delete');

  // Check audit log
  const auditRes = await query(
    'SELECT action, entity_type FROM audit_logs WHERE action = $1 AND entity_id = $2',
    ['PRODUCT_MEDIA_DELETED', String(target.id)]
  );
  assert.equal(auditRes.rows.length, 1);
});
