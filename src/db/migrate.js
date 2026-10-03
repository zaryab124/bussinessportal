const fs = require('fs');
const path = require('path');
const { query, exec, closeDb } = require('../config/db');

async function runMigrations() {
  console.log('[Migration] Starting database migrations...');
  
  // Ensure schema_migrations table exists
  await exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const existing = await query('SELECT migration_name FROM schema_migrations WHERE migration_name = $1', [file]);
    if (existing.rows.length === 0) {
      console.log(`[Migration] Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      // Execute multi-statement migration script
      await exec(sql);
      
      // Record applied migration
      await query('INSERT INTO schema_migrations (migration_name) VALUES ($1)', [file]);
      console.log(`[Migration] Successfully applied ${file}`);
    } else {
      console.log(`[Migration] Skipping ${file} (already applied)`);
    }
  }

  console.log('[Migration] All migrations completed successfully.');
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[Migration Error]', err);
      await closeDb();
      process.exit(1);
    });
}

module.exports = { runMigrations };
