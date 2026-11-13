// Checks the deployed site from the outside: the page, its files, the database, and one full trade between
// two throwaway players over the real API. Runs in GitHub Actions after every push to main; by hand:
//   GC_BASE_URL=https://gundichest.vercel.app node tools/livecheck.mjs
// GC_EXPECT_COMMIT (a commit sha) makes it wait until that commit is the one being served.
import { runSmoke } from './smoke.mjs';

const BASE = (process.env.GC_BASE_URL || 'https://gundichest.vercel.app').replace(/\/+$/, '');
const EXPECT = (process.env.GC_EXPECT_COMMIT || '').slice(0, 12);
const WAIT_MS = Number(process.env.GC_WAIT_MS || 420000);
const inActions = !!process.env.GITHUB_ACTIONS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (title, text) => console.log(inActions ? `::notice title=${title}::${text}` : `${title}: ${text}`);
const fail = (title, text) => { console.log(inActions ? `::error title=${title}::${text}` : `FAILED ${title}: ${text}`); process.exitCode = 1; };

async function get(path) {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: { 'user-agent': 'gundichest-livecheck' } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, type: res.headers.get('content-type') || '', text, json, location: res.headers.get('location') || '' };
}
async function call(op, data, token) {
  const res = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ op, ...data }) });
  let body = null;
  try { body = await res.json(); } catch (e) { body = { error: 'not JSON' }; }
  return { status: res.status, body };
}

try {
  // 1. wait for the deployment of this commit
  const t0 = Date.now();
  let health = null;
  for (;;) {
    try { health = await get('/api/rpc'); } catch (e) { health = { status: 0, text: String(e.message) }; }
    const commit = health.json && health.json.commit;
    if (!EXPECT || (commit && EXPECT.startsWith(commit.slice(0, 7)))) break;
    // a site that does not report its commit cannot be waited for: give the deployment two minutes, then look
    if (health.json && !commit && Date.now() - t0 > 120000) { note('Deployment', 'the site does not report which commit it serves; checking what is live now'); break; }
    if (Date.now() - t0 > WAIT_MS) { note('Deployment', `still serving ${commit || 'an unknown commit'} after ${Math.round(WAIT_MS / 1000)} s, expected ${EXPECT}. Checking what is live.`); break; }
    await sleep(10000);
  }
  if (health.status === 401 || health.status === 302 || health.status === 307 || /vercel\.com\/(sso|login)/.test(health.location + health.text)) {
    fail('Site is not public', `The address answers with a Vercel login (HTTP ${health.status}). Turn off Vercel Authentication under Settings > Deployment Protection so players can open the site.`);
  } else if (health.status !== 200 || !health.json) {
    fail('API', `GET /api/rpc answered HTTP ${health.status}: ${String(health.text).slice(0, 160)}`);
  } else {
    note('Deployment', `commit ${health.json.commit || 'unknown'} is live, function region ${health.json.region || '?'}, database region ${health.json.dbRegion || '?'}, ${health.json.node}`);

    // 2. the page and its files
    const page = await get('/');
    if (page.status !== 200 || !page.text.includes('GundiChest') || !page.text.includes('__GC_BUILD')) fail('Page', `GET / answered HTTP ${page.status}`);
    else note('Page', `index.html ${Math.round(page.text.length / 1024)} KB`);
    for (const [path, type] of [['/assets/model.json', 'json'], ['/assets/three.min.js', 'javascript'], ['/favicon.svg', 'svg'], ['/favicon.ico', 'icon'], ['/apple-touch-icon.png', 'png'], ['/icon-512.png', 'png'], ['/site.webmanifest', 'json'], ['/og.png', 'png']]) {
      // right after a deployment a file can answer 404 for a moment while the address switches over
      let r = await get(path);
      for (let again = 0; again < 3 && (r.status !== 200 || !r.type.includes(type)); again++) { await sleep(5000); r = await get(path); }
      if (r.status !== 200 || !r.type.includes(type)) fail('File', `${path} answered HTTP ${r.status} (${r.type})`);
    }

    // 3. the database
    const deep = await get('/api/rpc?deep=1');
    if (deep.status !== 200 || !deep.json || deep.json.db !== 'ok') fail('Database', `not reachable from the site: ${JSON.stringify(deep.json || deep.text).slice(0, 200)}`);
    else {
      note('Database', `reachable, first round trip ${deep.json.dbMs} ms`);
      // 4. two players, one trade
      const steps = [];
      await runSmoke(call, (line) => steps.push(line), { wait: true });
      const waited = steps.filter((l) => l.includes('waited') || l.includes('kept open')).map((l) => l.trim()).join('; ');
      note('Trade test', `passed (${steps.length} steps): register, login, save, search, request, offers, accept twice each, swap, history, announcement, a round of Rocket on the server${waited ? ' (' + waited + ')' : ''}, cleanup`);
      const times = [];
      for (let i = 0; i < 5; i++) { const s = Date.now(); await get('/api/rpc?deep=1'); times.push(Date.now() - s); }
      note('Speed', `API with database from here: ${times.sort((a, b) => a - b)[2]} ms (median of 5)`);
    }
  }
} catch (e) {
  fail('Live check', e && e.message ? e.message : String(e));
}
