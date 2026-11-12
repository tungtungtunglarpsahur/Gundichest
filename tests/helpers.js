// Test setup. The API tests need a throwaway Postgres database:
//   GC_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/gc_test npm test
// Every run wipes that database, so it has to be local and its name has to end in "_test".
const TEST_URL = process.env.GC_TEST_DATABASE_URL || '';

function checkUrl() {
  if (!TEST_URL) return 'GC_TEST_DATABASE_URL is not set';
  let u;
  try { u = new URL(TEST_URL); } catch (e) { return 'GC_TEST_DATABASE_URL is not a URL'; }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) return 'the test database must be on this machine';
  if (!/_test$/.test(u.pathname)) return 'the test database name must end in _test';
  return '';
}
const skipReason = checkUrl();

let api = null;
function load() {
  if (api) return api;
  if (skipReason) throw new Error(skipReason);
  for (const k of Object.keys(process.env)) if (/(DATABASE_URL|POSTGRES_URL)/.test(k) && k !== 'GC_TEST_DATABASE_URL') delete process.env[k];
  process.env.DATABASE_URL = TEST_URL;
  const db = require('../server/db');
  const { handle } = require('../server/handler');
  let ipn = 0;
  // call('op', {...}, token) -> { status, body }
  const call = (op, data, token, ip) => handle({ method: 'POST', body: Object.assign({ op }, data || {}), headers: token ? { authorization: 'Bearer ' + token } : {}, ip: ip || '10.0.0.' + (ipn++ % 250), query: {} });
  const ok = async (op, data, token) => {
    const r = await call(op, data, token);
    if (r.status !== 200) throw new Error(op + ' -> HTTP ' + r.status + ' ' + JSON.stringify(r.body));
    return r.body;
  };
  async function reset() {
    await db.q(`DROP TABLE IF EXISTS gc_trades, gc_sessions, gc_limits, gc_users, gc_meta CASCADE`);
    await db.end();                      // also forgets that the schema was there
    await db.ensureSchema();
  }
  let n = 0;
  // A fresh player with a saved game: player({ coins: 100, inv: { i17: 2 } })
  async function player(seed, name) {
    name = name || 'p' + (++n) + '_' + Math.random().toString(36).slice(2, 7);
    const pass = 'pw-' + name;
    const r = await ok('register', { name, pass, seed: seed || {} });
    return { id: r.user.id, name, pass, token: r.token, rev: r.rev };
  }
  const stateOf = async (p) => (await ok('me', { rev: -1 }, p.token)).state;
  // Two players with an open trade between them.
  async function room(seedA, seedB) {
    const a = await player(seedA), b = await player(seedB);
    const t = (await ok('trade.request', { to: b.id }, a.token)).trade;
    await ok('trade.respond', { id: t.id, accept: true }, b.token);
    return { a, b, id: t.id };
  }
  api = { db, handle, call, ok, reset, player, stateOf, room };
  return api;
}
module.exports = { load, skipReason };
