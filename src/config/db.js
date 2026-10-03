const path = require('path');
const fs = require('fs');
const config = require('./index');

let pool = null;
let pglite = null;

async function getDb() {
  if (config.databaseUrl) {
    if (!pool) {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false
      });
    }
    return { type: 'pg', client: pool };
  } else {
    if (!pglite) {
      const { PGlite } = require('@electric-sql/pglite');
      const resolvedDir = path.resolve(process.cwd(), config.dataDir);
      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true });
      }
      pglite = new PGlite(resolvedDir);
    }
    return { type: 'pglite', client: pglite };
  }
}

async function query(text, params = []) {
  const { type, client } = await getDb();
  if (type === 'pg') {
    const res = await client.query(text, params);
    return {
      rows: res.rows,
      rowCount: res.rowCount,
      fields: res.fields
    };
  } else {
    const res = await client.query(text, params);
    return {
      rows: res.rows || [],
      rowCount: res.affectedRows ?? (res.rows ? res.rows.length : 0),
      fields: res.fields
    };
  }
}

async function exec(sql) {
  const { type, client } = await getDb();
  if (type === 'pg') {
    await client.query(sql);
  } else {
    await client.exec(sql);
  }
}

async function transaction(callback) {
  const { type, client } = await getDb();
  if (type === 'pg') {
    const conn = await client.connect();
    try {
      await conn.query('BEGIN');
      const clientWrapper = {
        query: async (text, params = []) => {
          const res = await conn.query(text, params);
          return {
            rows: res.rows,
            rowCount: res.rowCount,
            fields: res.fields
          };
        }
      };
      const result = await callback(clientWrapper);
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    } finally {
      conn.release();
    }
  } else {
    // PGlite transaction
    try {
      await client.query('BEGIN');
      const clientWrapper = {
        query: async (text, params = []) => {
          const res = await client.query(text, params);
          return {
            rows: res.rows || [],
            rowCount: res.affectedRows ?? (res.rows ? res.rows.length : 0),
            fields: res.fields
          };
        }
      };
      const result = await callback(clientWrapper);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (pglite) {
    await pglite.close();
    pglite = null;
  }
}

module.exports = {
  getDb,
  query,
  exec,
  transaction,
  closeDb
};
