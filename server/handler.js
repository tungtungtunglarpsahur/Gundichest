// The GundiChest API: one endpoint, POST /api/rpc with {"op": "...", ...}.
// GET answers a health check (add ?deep=1 to include a database round trip).
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const trades = require('./trades');
const crash = require('./crash');
const { ITEMS, RARITIES, MUTATIONS, isItem } = require('./items');
const { cleanState, applyTrade, applyCoins } = require('./state');
const { ApiError, bad, exact, isObj } = require('./util');

const WRONG = 'Wrong username or password.';
const ipKey = (ip) => crypto.createHash('sha256').update('gc:' + String(ip || 'unknown')).digest('hex').slice(0, 20);
const publicUser = (u) => ({ id: u.id, name: u.name });

// ---- no login needed ---------------------------------------------------------------------------------
const open = {
  async register(body, req) {
    const name = auth.cleanName(body.name), pass = auth.cleanPass(body.pass);
    await auth.limit('reg:' + ipKey(req.ip), 60, 3600, 'Too many new accounts from this network. Try again in an hour.');
    const taken = await db.q(`SELECT 1 FROM gc_users WHERE name_lc = $1`, [auth.nameKey(name)]);
    if (taken.length) throw new ApiError(409, 'taken', 'That name is taken. Try another one.');
    const state = cleanState(body.seed);                 // progress made on this device before the account existed
    const hash = await auth.hashPassword(pass);
    let rows;
    try {
      rows = await db.q(`INSERT INTO gc_users (name, name_lc, pass, state) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, name, rev`,
        [name, auth.nameKey(name), hash, JSON.stringify(state)]);
    } catch (e) {
      if (e && e.code === '23505') throw new ApiError(409, 'taken', 'That name is taken. Try another one.');
      throw e;
    }
    const token = await auth.createSession(rows[0].id);
    return { ok: true, token, user: publicUser(rows[0]), rev: rows[0].rev, state };
  },

  async login(body, req) {
    const name = String(body.name == null ? '' : body.name).normalize('NFKC').trim();
    const pass = typeof body.pass === 'string' ? body.pass : '';
    if (!name || !pass || name.length > 40 || pass.length > 200) throw new ApiError(401, 'login', WRONG);
    const key = auth.nameKey(name);
    await auth.limit('login:' + ipKey(req.ip), 150, 600);
    await auth.limit('name:' + key, 15, 600, 'Too many tries for this name. Wait 10 minutes and try again.');
    const rows = await db.q(`SELECT id, name, pass, rev, state FROM gc_users WHERE name_lc = $1`, [key]);
    if (!rows.length) { await auth.fakeVerify(pass); throw new ApiError(401, 'login', WRONG); }
    if (!(await auth.verifyPassword(pass, rows[0].pass))) throw new ApiError(401, 'login', WRONG);
    await auth.unlimit('name:' + key);
    if (Math.random() < 0.05) db.q(`DELETE FROM gc_sessions WHERE seen_at < now() - make_interval(days => $1)`, [auth.SESSION_DAYS]).catch(() => {});
    const token = await auth.createSession(rows[0].id);
    let u = rows[0];
    if (await crash.settleAll(u.id)) u = (await db.q(`SELECT id, name, rev, state FROM gc_users WHERE id = $1`, [u.id]))[0];     // a round that ended meanwhile
    return { ok: true, token, user: publicUser(u), rev: u.rev, state: cleanState(u.state) };
  },
};

// ---- what everybody gets told ---------------------------------------------------------------------------
// Worth telling: an epic or a legendary, or one of the rarest mutations on any card.
const announceWorthy = (id) => isItem(id) && (RARITIES[ITEMS[id].rarity].tier >= 3 || (ITEMS[id].mut && MUTATIONS[ITEMS[id].mut] >= 8));
// since = the last announcement this page has seen; a page that has seen none yet only learns where the list ends
async function feedSince(me, since) {
  if (since < 0) {
    const top = await db.qSafe(`SELECT COALESCE(MAX(id), 0)::float8 AS id FROM gc_feed`);
    return { feedAt: top[0].id, feed: [] };
  }
  const rows = await db.qSafe(`SELECT id::float8 AS id, name, item FROM gc_feed WHERE id > $1 AND user_id <> $2 AND created_at > now() - interval '2 minutes' ORDER BY id LIMIT 6`, [since, me.id]);
  if (rows.length) return { feedAt: rows[rows.length - 1].id, feed: rows.filter((r) => isItem(r.item)) };
  const top = await db.qSafe(`SELECT COALESCE(MAX(id), 0)::float8 AS id FROM gc_feed`);          // skip what is too old or my own
  return { feedAt: Math.max(since, top[0].id), feed: [] };
}

// ---- for a logged-in player ----------------------------------------------------------------------------
const authed = {
  async logout(me) {
    await db.q(`DELETE FROM gc_sessions WHERE token_hash = $1`, [me.tokenHash]);
    return { ok: true };
  },

  // Who am I, and has my saved game changed since the rev I hold?
  async me(me, body) {
    let rev = me.rev;
    if (await crash.settleAll(me.id)) rev = (await db.q(`SELECT rev FROM gc_users WHERE id = $1`, [me.id]))[0].rev;      // a round that ended meanwhile
    const out = { ok: true, user: publicUser(me), rev };
    if (exact(body.rev, 0, 2147483647, -1) !== rev) {
      const rows = await db.q(`SELECT rev, state FROM gc_users WHERE id = $1`, [me.id]);
      out.rev = rows[0].rev; out.state = cleanState(rows[0].state);
    }
    return out;
  },

  // Stores the game as the page has it. rev is the server rev the page last agreed on:
  //  - same as now: stored, rev + 1
  //  - behind, and everything in between was the server's own doing (a finished trade, a bet or a payout of
  //    Rugpull / Rocket): those are booked on top of what the page sent and listed in "trades" and "coins"
  //    so the page books them too
  //  - anything else (another device saved in between): 409 with the server's copy; the page takes that
  async sync(me, body) {
    if (!isObj(body.state)) throw bad('state', 'Nothing to save.');
    const base = exact(body.rev, 0, 2147483647, -1);
    const incoming = cleanState(body.state);
    return db.tx(async (run) => {
      const rows = await run(`SELECT rev, state FROM gc_users WHERE id = $1 FOR UPDATE`, [me.id]);
      const cur = rows[0];
      let booked = null, coins = null;
      if (base !== cur.rev) {
        const behind = base >= 0 && base < cur.rev;
        const missed = behind ? await trades.bookedSince(me.id, base, run) : [];
        const moved = behind ? await crash.ledgerSince(me.id, base, run) : [];
        if (!behind || missed.length + moved.length !== cur.rev - base) {
          return { status: 409, ok: false, error: 'conflict', message: 'Your game was saved from another device. This one now shows the saved game.', rev: cur.rev, state: cleanState(cur.state) };
        }
        const all = missed.map((t) => ({ rev: t.rev, t })).concat(moved.map((e) => ({ rev: e.rev, e }))).sort((x, y) => x.rev - y.rev);
        for (const x of all) { if (x.t) applyTrade(incoming, x.t.give, x.t.get); else applyCoins(incoming, x.e); }
        booked = missed; coins = moved;
      }
      const up = await run(`UPDATE gc_users SET state = $2::jsonb, rev = rev + 1 WHERE id = $1 RETURNING rev`, [me.id, JSON.stringify(incoming)]);
      const out = { ok: true, rev: up[0].rev };
      if (booked && booked.length) out.trades = booked;
      if (coins && coins.length) out.coins = coins;
      return out;
    });
  },

  // The heartbeat: trade requests and the open trade, plus what there is to announce since the last one.
  async poll(me, body) {
    const [out, feed] = await Promise.all([trades.poll(me, body), feedSince(me, exact(body.feed, 0, 9007199254740991, -1))]);
    return Object.assign(out, feed);
  },
  // "I pulled this": told to everybody who is online. Only for the big ones, and not in a flood.
  async announce(me, body) {
    const item = typeof body.item === 'string' ? body.item : '';
    if (!announceWorthy(item)) throw bad('item', 'Nothing to announce.');
    await auth.limit('ann:' + me.id, 8, 60, 'That is a lot of luck for one minute.');
    await db.q(`INSERT INTO gc_feed (user_id, name, item) VALUES ($1, $2, $3)`, [me.id, me.name, item]);
    if (Math.random() < 0.05) db.q(`DELETE FROM gc_feed WHERE created_at < now() - interval '1 day'`).catch(() => {});
    return { ok: true };
  },
  // Rugpull and Rocket: every round with a bet is played on the server (see crash.js)
  'crash.bet': (me, body) => crash.bet(me, body),
  'crash.cancel': (me, body) => crash.cancel(me, body),
  'crash.cashout': (me, body) => crash.cashout(me, body),
  'crash.auto': (me, body) => crash.setAuto(me, body),
  'crash.wait': (me, body) => crash.wait(me, body),
  'crash.state': (me) => crash.state(me),
  'users.search': (me, body) => trades.search(me, body),
  'trade.request': async (me, body) => {
    await auth.limit('treq:' + me.id, 40, 300, 'That is a lot of requests. Give it a few minutes.');
    return trades.request(me, body);
  },
  'trade.respond': (me, body) => trades.respond(me, body),
  'trade.cancel': (me, body) => trades.cancel(me, body),
  'trade.offer': (me, body) => trades.offer(me, body),
  'trade.step': (me, body) => trades.step(me, body),
  'trade.get': (me, body) => trades.get(me, body),
  'trade.history': (me) => trades.history(me),

  async 'account.password'(me, body) {
    const next = auth.cleanPass(body.next);
    await auth.limit('pw:' + me.id, 10, 600);
    const rows = await db.q(`SELECT pass FROM gc_users WHERE id = $1`, [me.id]);
    if (!(await auth.verifyPassword(typeof body.pass === 'string' ? body.pass : '', rows[0].pass))) throw new ApiError(403, 'pass', 'That is not your current password.');
    await db.q(`UPDATE gc_users SET pass = $2 WHERE id = $1`, [me.id, await auth.hashPassword(next)]);
    await db.q(`DELETE FROM gc_sessions WHERE user_id = $1 AND token_hash <> $2`, [me.id, me.tokenHash]);   // other devices log in again
    return { ok: true };
  },

  async 'account.delete'(me, body) {
    await auth.limit('pw:' + me.id, 10, 600);
    const rows = await db.q(`SELECT pass FROM gc_users WHERE id = $1`, [me.id]);
    if (!(await auth.verifyPassword(typeof body.pass === 'string' ? body.pass : '', rows[0].pass))) throw new ApiError(403, 'pass', 'That is not your password.');
    await db.q(`DELETE FROM gc_users WHERE id = $1`, [me.id]);       // sessions and trades go with it
    return { ok: true };
  },
};

function parseBody(raw) {
  if (raw == null || raw === '') return {};
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    if (raw.length > 300000) throw new ApiError(413, 'too_big', 'That request is too large.');
    try { raw = JSON.parse(raw); } catch (e) { throw bad('json', 'The request could not be read.'); }
  }
  if (!isObj(raw)) throw bad('json', 'The request could not be read.');
  return raw;
}

async function health(req) {
  const body = {
    ok: true, service: 'gundichest', db: db.configured() ? 'configured' : 'missing',
    commit: String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || null,
    region: process.env.VERCEL_REGION || null, dbRegion: db.region() || null, node: process.version, time: Date.now(),
  };
  if (req.query && req.query.deep && db.configured()) {
    const t0 = Date.now();
    try {
      await db.ensureSchema();
      await db.qSafe(`SELECT 1`);
      body.db = 'ok'; body.dbMs = Date.now() - t0;
    } catch (e) {
      body.ok = false; body.db = 'error'; body.dbError = String((e && e.code) || 'unknown');
      console.error('health: database check failed', e && e.message);
      return { status: 503, body };
    }
  }
  return { status: 200, body };
}

async function handle(req) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return await health(req);
    if (method !== 'POST') throw new ApiError(405, 'method', 'Use POST.');
    const body = parseBody(req.body);
    const op = typeof body.op === 'string' ? body.op : '';
    const isOpen = Object.prototype.hasOwnProperty.call(open, op), isAuthed = Object.prototype.hasOwnProperty.call(authed, op);
    if (!isOpen && !isAuthed) throw bad('op', 'Unknown request.');
    if (!db.configured()) throw new ApiError(503, 'no_db', 'The server has no database connected yet.');
    await db.ensureSchema();
    let out;
    if (isOpen) out = await open[op](body, req);
    else out = await authed[op](await auth.userFromRequest(req.headers), body, req);
    const status = out.status || 200;
    if (out.status) { out = Object.assign({}, out); delete out.status; }
    return { status, body: out };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: Object.assign({ ok: false, error: e.code, message: e.message }, e.extra || {}) };
    if (e && e.code === 'GC_NO_DB') return { status: 503, body: { ok: false, error: 'no_db', message: 'The server has no database connected yet.' } };
    if (db.isConnError(e)) {
      console.error('database unreachable', e && e.message);
      return { status: 503, body: { ok: false, error: 'db_down', message: 'The server cannot reach its database right now. Try again in a moment.' } };
    }
    console.error('request failed', e);
    return { status: 500, body: { ok: false, error: 'server', message: 'Something went wrong on the server.' } };
  }
}

module.exports = { handle };
