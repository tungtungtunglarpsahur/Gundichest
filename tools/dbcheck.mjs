// Runs as part of the build on Vercel: creates the tables if needed and plays one full trade between two
// throwaway players against the real database. A build that passes this has a working login and trading.
//   node tools/dbcheck.mjs
// Without a database variable it only says so (locally) or stops the build (on Vercel), because the site
// cannot log anyone in without one. Set GC_SKIP_DBCHECK=1 to build anyway.
import { createRequire } from 'node:module';
import { runSmoke } from './smoke.mjs';

const require = createRequire(import.meta.url);
const db = require('../server/db.js');
const { handle } = require('../server/handler.js');
const onVercel = !!process.env.VERCEL;

if (process.env.GC_SKIP_DBCHECK === '1') { console.log('dbcheck: skipped (GC_SKIP_DBCHECK=1)'); process.exit(0); }
if (!db.configured()) {
  const msg = 'dbcheck: no database connection variable found (DATABASE_URL or POSTGRES_URL).';
  if (!onVercel) { console.log(msg + ' Skipping.'); process.exit(0); }
  console.error(msg + '\nConnect a Postgres database to this project: Vercel dashboard -> Storage -> Create Database -> Neon, then redeploy.');
  process.exit(1);
}

const call = async (op, data, token) => handle({ method: 'POST', body: { op, ...data }, headers: token ? { authorization: 'Bearer ' + token } : {}, ip: 'build-check', query: {} });
const t0 = Date.now();
try {
  await db.ensureSchema();
  console.log(`dbcheck: database reachable${db.region() ? ' (' + db.region() + ')' : ''}, tables ready (${Date.now() - t0} ms)`);
  await runSmoke(call, (line) => console.log('dbcheck: ' + line));
  console.log(`dbcheck: passed in ${Date.now() - t0} ms`);
} catch (e) {
  console.error('dbcheck: FAILED - ' + (e && e.message ? e.message : e));
  if (e && e.code) console.error('dbcheck: database error code ' + e.code);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
