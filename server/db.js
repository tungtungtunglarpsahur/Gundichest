// Postgres access. Works with the variables the Vercel + Neon integration sets; no other configuration.
const { Pool } = require('pg');

const URL_RE = /^postgres(ql)?:\/\//;
function findUrl(env = process.env) {
  // Pooled connection first: serverless functions open many short connections.
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING']) {
    if (env[k] && URL_RE.test(env[k])) return env[k];
  }
  // The integration can be installed with a custom prefix (STORAGE_DATABASE_URL and the like).
  const keys = Object.keys(env).filter((k) => /(DATABASE_URL|POSTGRES_URL)$/.test(k) && URL_RE.test(env[k] || ''));
  keys.sort((a, b) => /UNPOOLED|NON_POOLING|NO_SSL/.test(a) - /UNPOOLED|NON_POOLING|NO_SSL/.test(b));
  return keys.length ? env[keys[0]] : '';
}
const configured = () => !!findUrl();
// Where the database runs, read from its host name ("us-east-1"); empty when the name does not say.
function region() {
  try {
    const m = /\.([a-z]{2}-[a-z]+-\d)\./.exec(new URL(findUrl()).hostname);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

let pool = null;
function getPool() {
  if (pool) return pool;
  const url = findUrl();
  if (!url) throw Object.assign(new Error('no database configured'), { code: 'GC_NO_DB' });
  pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 5000, connectionTimeoutMillis: 9000, allowExitOnIdle: true });
  pool.on('error', (e) => console.error('pg pool error', e && e.message));
  // On Vercel this lets idle connections close before the function is paused, so none is found dead later.
  try { require('@vercel/functions/db-connections').attachDatabasePool(pool); } catch (e) { /* not on Vercel, or the helper is missing */ }
  return pool;
}

// A connection that died while the function was paused shows up as one of these on first use.
const CONN_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08004', '53300']);
function isConnError(e) {
  if (!e) return false;
  if (e.code && CONN_CODES.has(e.code)) return true;
  return /Connection terminated|connection timeout|timeout exceeded when trying to connect|Client has encountered a connection error|ECONNRESET|socket hang up/i.test(String(e.message || ''));
}

async function q(text, params) {
  const r = await getPool().query(text, params);
  return r.rows;
}
// For statements that are safe to send twice (reads, counters): one more try on a dead connection.
async function qSafe(text, params) {
  try { return await q(text, params); } catch (e) {
    if (!isConnError(e)) throw e;
    return q(text, params);
  }
}
// Runs fn inside one transaction. Starts over when Postgres asks for it (deadlock, serialization failure)
// or when the connection turns out to be dead before anything was sent.
async function tx(fn, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    let client = null, began = false;
    try {
      client = await getPool().connect();
      await client.query('BEGIN');
      began = true;
      const out = await fn((text, params) => client.query(text, params).then((r) => r.rows));
      await client.query('COMMIT');
      client.release();
      return out;
    } catch (e) {
      if (client) {
        let broken = isConnError(e);
        if (!broken) { try { await client.query('ROLLBACK'); } catch (_) { broken = true; } }
        client.release(broken ? e : undefined);            // a broken connection is thrown away, not reused
      }
      const again = e && (e.code === '40001' || e.code === '40P01' || (!began && isConnError(e)));
      if (attempt < tries && again) continue;
      throw e;
    }
  }
}
async function end() { if (pool) { const p = pool; pool = null; schemaReady = null; await p.end(); } }

// ---- schema ---------------------------------------------------------------------------------------
// gc_users.state is the saved game of a player; rev counts every change the server stores.
// gc_trades: a asked b. Offers are {"items":{"i3":1},"coins":0}; step is 0 (open), 1 (accepted), 2 (confirmed).
// ver goes up with every change of a trade, ov only when an offer changes. a_rev / b_rev hold the
// player's rev right after a finished trade was booked, which is how a later sync knows what it missed.
const SCHEMA_VERSION = '1';
const DDL = [
  `CREATE TABLE IF NOT EXISTS gc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gc_users (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     name_lc TEXT NOT NULL UNIQUE,
     pass TEXT NOT NULL,
     state JSONB NOT NULL DEFAULT '{}'::jsonb,
     rev INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS gc_users_seen ON gc_users (seen_at DESC)`,
  `CREATE TABLE IF NOT EXISTS gc_sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES gc_users(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS gc_sessions_user ON gc_sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS gc_trades (
     id SERIAL PRIMARY KEY,
     a_id INTEGER NOT NULL REFERENCES gc_users(id) ON DELETE CASCADE,
     b_id INTEGER NOT NULL REFERENCES gc_users(id) ON DELETE CASCADE,
     status TEXT NOT NULL DEFAULT 'pending',
     a_offer JSONB NOT NULL DEFAULT '{"items":{},"coins":0}'::jsonb,
     b_offer JSONB NOT NULL DEFAULT '{"items":{},"coins":0}'::jsonb,
     a_step SMALLINT NOT NULL DEFAULT 0,
     b_step SMALLINT NOT NULL DEFAULT 0,
     ver INTEGER NOT NULL DEFAULT 0,
     ov INTEGER NOT NULL DEFAULT 0,
     a_rev INTEGER,
     b_rev INTEGER,
     ended_by INTEGER,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     done_at TIMESTAMPTZ,
     CHECK (a_id <> b_id)
   )`,
  `CREATE INDEX IF NOT EXISTS gc_trades_a ON gc_trades (a_id, status)`,
  `CREATE INDEX IF NOT EXISTS gc_trades_b ON gc_trades (b_id, status)`,
  // two players can have one request or one open trade between them, not several
  `CREATE UNIQUE INDEX IF NOT EXISTS gc_trades_pair ON gc_trades (LEAST(a_id, b_id), GREATEST(a_id, b_id)) WHERE status IN ('pending', 'open')`,
  `CREATE TABLE IF NOT EXISTS gc_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, reset_at TIMESTAMPTZ NOT NULL)`,
];
async function migrate() {
  for (let attempt = 1; ; attempt++) {
    try {
      for (const sql of DDL) await q(sql);
      await q(`INSERT INTO gc_meta (key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [SCHEMA_VERSION]);
      return;
    } catch (e) {
      // two cold starts creating the same table at once collide in the catalog; the next try finds it there
      if (attempt < 4 && e && (e.code === '23505' || e.code === '42P07' || e.code === '40P01' || e.code === '42710' || isConnError(e))) continue;
      throw e;
    }
  }
}
let schemaReady = null;
// One cheap query per cold start once the tables exist; creates them on the very first request.
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        const rows = await qSafe(`SELECT value FROM gc_meta WHERE key = 'schema'`);
        if (rows.length && rows[0].value === SCHEMA_VERSION) return;
      } catch (e) {
        if (!e || e.code !== '42P01') throw e;       // 42P01: gc_meta does not exist yet
      }
      await migrate();
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

module.exports = { q, qSafe, tx, end, configured, region, ensureSchema, migrate, findUrl, isConnError, SCHEMA_VERSION };
