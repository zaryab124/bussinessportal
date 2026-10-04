const { query, closeDb } = require('../config/db');
const { hashPassword } = require('../utils/security');
const { runMigrations } = require('./migrate');

async function seed() {
  console.log('[Seed] Running migrations first...');
  await runMigrations();

  console.log('[Seed] Seeding initial data...');

  // 1. Roles & Permissions
  const permissions = [
    { role: 'super_admin', perm: 'manage_users' },
    { role: 'super_admin', perm: 'manage_stock' },
    { role: 'super_admin', perm: 'manage_sales' },
    { role: 'super_admin', perm: 'manage_finances' },
    { role: 'super_admin', perm: 'manage_rules' },
    { role: 'super_admin', perm: 'view_audit_logs' },
    { role: 'business_owner', perm: 'view_dashboard' },
    { role: 'business_owner', perm: 'view_own_financials' },
    { role: 'business_owner', perm: 'view_stock' },
    { role: 'business_owner', perm: 'view_reports' }
  ];

  for (const p of permissions) {
    await query(`
      INSERT INTO roles_permissions (role, permission)
      VALUES ($1, $2)
      ON CONFLICT (role, permission) DO NOTHING
    `, [p.role, p.perm]);
  }

  // 2. Users (Admin + 2 Owners) with password: 549229044ktb
  const securePassword = await hashPassword('549229044ktb');

  // Insert or update Admin
  let adminRes = await query(`
    INSERT INTO users (email, password_hash, full_name, role, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (email) DO UPDATE SET 
      full_name = EXCLUDED.full_name,
      password_hash = EXCLUDED.password_hash
    RETURNING id, email, role
  `, ['admin@business.local', securePassword, 'Super Business Administrator', 'super_admin', 'active']);
  const adminId = adminRes.rows[0].id;

  // Insert or update Owner 1
  let owner1Res = await query(`
    INSERT INTO users (email, password_hash, full_name, role, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (email) DO UPDATE SET 
      full_name = EXCLUDED.full_name,
      password_hash = EXCLUDED.password_hash
    RETURNING id, email, role
  `, ['owner1@business.local', securePassword, 'Business Partner One', 'business_owner', 'active']);
  const owner1Id = owner1Res.rows[0].id;

  // Insert or update Owner 2
  let owner2Res = await query(`
    INSERT INTO users (email, password_hash, full_name, role, status)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (email) DO UPDATE SET 
      full_name = EXCLUDED.full_name,
      password_hash = EXCLUDED.password_hash
    RETURNING id, email, role
  `, ['owner2@business.local', securePassword, 'Business Partner Two', 'business_owner', 'active']);
  const owner2Id = owner2Res.rows[0].id;

  // Explicitly ensure all accounts have the new password
  await query(`
    UPDATE users SET password_hash = $1 
    WHERE email IN ('admin@business.local', 'owner1@business.local', 'owner2@business.local')
  `, [securePassword]);

  // 3. Profit Allocation Rules (33% Owner 1, 33% Owner 2, 34% Brand Reinvestment)
  const ruleCheck = await query('SELECT id FROM profit_allocation_rules WHERE is_active = TRUE LIMIT 1');
  if (ruleCheck.rows.length === 0) {
    const ruleRes = await query(`
      INSERT INTO profit_allocation_rules (
        version, is_active, rule_name, reinvestment_percentage, deduct_reinvestment_before_distribution, effective_from, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [1, true, 'Default 33-33-34 Rule', 34.00, false, '2026-01-01', 'Initial agreed baseline profit-sharing distribution', adminId]);

    const ruleId = ruleRes.rows[0].id;

    await query(`
      INSERT INTO profit_allocation_rule_owners (rule_id, owner_id, percentage)
      VALUES ($1, $2, $3), ($1, $4, $5)
      ON CONFLICT (rule_id, owner_id) DO NOTHING
    `, [ruleId, owner1Id, 33.00, owner2Id, 33.00]);
    console.log('[Seed] Created default 33% - 33% - 34% profit allocation rule.');
  }

  // 4. Sample Product A (as documented in Section 4 & 12)
  const prodCheck = await query('SELECT id FROM products WHERE sku = $1', ['PROD-SPA-001']);
  if (prodCheck.rows.length === 0) {
    await query(`
      INSERT INTO products (
        sku, name, category, description, condition, location, supplier,
        purchase_date, purchase_cost_per_unit, quantity_purchased, quantity_available,
        min_selling_price, max_selling_price, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14
      )
    `, [
      'PROD-SPA-001',
      'Sample Product A',
      'Trading Goods',
      'High-grade trade inventory verified for test workflows',
      'New',
      'Central Warehouse Bay 1',
      'Apex Supplies Ltd',
      '2026-01-10',
      1100.00,
      10,
      10,
      2000.00,
      2500.00,
      'Available'
    ]);
    console.log('[Seed] Created initial Sample Product A.');
  }

  console.log('[Seed] Seeding completed successfully!');
  console.log('--- SYSTEM ACCOUNTS CONFIGURED ---');
  console.log('Super Admin:      admin@business.local');
  console.log('Business Owner 1: owner1@business.local');
  console.log('Business Owner 2: owner2@business.local');
  console.log('----------------------------------');
}

if (require.main === module) {
  seed()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[Seed Error]', err);
      await closeDb();
      process.exit(1);
    });
}

module.exports = { seed };
