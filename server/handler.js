// Request router. Filled in with accounts, saved progress and trading; this first version only reports health.
function dbUrl() {
  const env = process.env;
  return env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || '';
}
async function handle(req) {
  return { status: 200, body: { ok: true, service: 'gundichest', db: dbUrl() ? 'configured' : 'missing', time: Date.now() } };
}
module.exports = { handle };
