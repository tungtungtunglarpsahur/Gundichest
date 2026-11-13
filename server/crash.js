// Rugpull and Rocket, decided here: the server rolls where a round ends, keeps the clock, takes the bet from
// the saved game and pays a cash-out into it. The page only draws. It learns where a round ended when it has
// ended, never before.
//
// A round belongs to one player and exists only when there is a bet on it. Everything that happens to it is
// worked out from what is stored (start time, end time, auto cash-out), so a round also finishes properly when
// the page is closed half way: the next request settles it.
const crypto = require('crypto');
const db = require('./db');
const CrashMath = require('./crashmath');
const { cleanState, cleanOffer, applyCoins, MAX_COINS } = require('./state');
const { ApiError, bad, exact } = require('./util');

const HOLD_MS = 15000;                 // longest time one "wait" request is kept open
const MAX_START_MS = 12000;            // a bet is placed at most this long before its round starts
const MAX_ID = 9007199254740991;
// tests put their own clock and their own dice here
const hooks = { now: () => Date.now(), roll: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u01 = () => crypto.randomInt(0, 4294967296) / 4294967296;

function gameOf(key) {
  const g = Object.prototype.hasOwnProperty.call(CrashMath.games, key) ? CrashMath.games[key] : null;
  if (!g) throw bad('game', 'Unknown game.');
  return g;
}
const pathOf = (r) => CrashMath.games[r.game].path(r.seed);
// An auto cash-out as the page sends it (2.5) -> times 100 (250); 0 = off.
function cleanAuto(v, g) {
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 101 || n > g.max * 100) throw bad('auto', 'Auto cash out goes from 1.01× to ' + g.max + '×.');
  return n;
}
// What the page may know about a round. While the bet is in play that is everything except where it ends.
function view(r, now) {
  const o = { id: Number(r.id), game: r.game, bet: Number(r.bet), auto: r.auto / 100, seed: r.seed, status: r.status, startIn: Number(r.start_at) - now };
  if (r.status === 'cashed') { o.mult = r.cash / 100; o.paid = Number(r.paid); }
  if (r.status === 'cashed' || r.status === 'rugged') { o.crash = r.crash / 100; o.crashIn = Number(r.crash_at) - now; }
  return o;
}
const entryOut = (e) => ({ rev: e.rev, coins: e.coins, wager: e.wager || 0, won: e.won || 0, mult: e.mult || 0, why: e.why });

// Books a coin change on the locked saved game and notes it with the new rev.
async function book(run, userId, state, e, roundId) {
  applyCoins(state, e);
  const up = await run(`UPDATE gc_users SET state = $2::jsonb, rev = rev + 1 WHERE id = $1 RETURNING rev`, [userId, JSON.stringify(state)]);
  e.rev = up[0].rev;
  await run(`INSERT INTO gc_ledger (user_id, rev, coins, wager, won, mult, why, round_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, e.rev, e.coins, e.wager || 0, e.won || 0, Math.round((e.mult || 0) * 100), e.why, roundId || null]);
  return e;
}
// What a later save has missed since rev (see handler.sync).
async function ledgerSince(userId, rev, run) {
  const rows = await run(`SELECT rev, coins, wager, won, mult, why FROM gc_ledger WHERE user_id = $1 AND rev > $2 ORDER BY rev`, [userId, rev]);
  return rows.map((r) => ({ rev: r.rev, coins: Number(r.coins), wager: Number(r.wager), won: Number(r.won), mult: r.mult / 100, why: r.why }));
}
async function cash(run, userId, state, r, mult100) {
  const paid = Math.min(MAX_COINS, Math.floor(Number(r.bet) * mult100 / 100));
  const e = await book(run, userId, state, { coins: paid, won: paid, mult: mult100 / 100, why: 'cashout' }, r.id);
  await run(`UPDATE gc_rounds SET status = 'cashed', cash = $2, paid = $3 WHERE id = $1`, [r.id, mult100, paid]);
  r.status = 'cashed'; r.cash = mult100; r.paid = paid;
  return e;
}
// Brings a round up to the clock: an auto cash-out that was reached is paid, a round past its end is over.
// Returns the coin entry when something was paid.
async function settle(run, userId, state, r, now) {
  if (r.status !== 'live') return null;
  const start = Number(r.start_at), end = Number(r.crash_at);
  if (r.auto > 0 && r.auto <= r.crash) {
    const autoAt = start + Math.ceil(pathOf(r).timeAt(r.auto / 100) * 1000);
    if (now >= autoAt) return cash(run, userId, state, r, r.auto);
  }
  if (now >= end) {
    await run(`UPDATE gc_rounds SET status = 'rugged' WHERE id = $1`, [r.id]);
    r.status = 'rugged';
  }
  return null;
}
const lockUser = async (run, id) => {
  const rows = await run(`SELECT rev, state FROM gc_users WHERE id = $1 FOR UPDATE`, [id]);
  return { rev: rows[0].rev, state: cleanState(rows[0].state) };
};
const lockRound = async (run, id, userId) => {
  const rows = await run(`SELECT * FROM gc_rounds WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId]);
  if (!rows.length) throw new ApiError(404, 'round', 'That round does not exist.');
  return rows[0];
};
const roundId = (v) => { const id = exact(v, 1, MAX_ID, 0); if (!id) throw bad('round', 'Which round?'); return id; };
// Coins lying in an open trade offer are not for betting.
async function heldCoins(run, userId) {
  const rows = await run(`SELECT a_id, a_offer, b_offer FROM gc_trades WHERE (a_id = $1 OR b_id = $1) AND status = 'open'`, [userId]);
  let held = 0;
  for (const t of rows) held += cleanOffer(t.a_id === userId ? t.a_offer : t.b_offer).coins;
  return held;
}
const answer = (u, entries, extra) => Object.assign({ ok: true, rev: entries.length ? entries[entries.length - 1].rev : u.rev, book: entries.map(entryOut) }, extra);

// ---- the requests ----------------------------------------------------------------------------------------
// A bet on a round that starts in startIn ms. The coins leave the saved game now.
async function bet(me, body) {
  const g = gameOf(body.game);
  const amount = exact(body.bet, 1, MAX_COINS, 0);
  if (!amount) throw bad('bet', 'Choose a bet.');
  const auto = cleanAuto(body.auto, g);
  const startIn = Math.min(MAX_START_MS, Math.max(0, Math.floor(Number(body.startIn) || 0)));
  return db.tx(async (run) => {
    const u = await lockUser(run, me.id), now = hooks.now(), entries = [];
    const open = await run(`SELECT * FROM gc_rounds WHERE user_id = $1 AND status = 'live' ORDER BY id FOR UPDATE`, [me.id]);
    for (const r of open) { const e = await settle(run, me.id, u.state, r, now); if (e) entries.push(e); }
    if (open.some((r) => r.status === 'live' && r.game === g.key)) throw new ApiError(409, 'busy', 'Your last round is still running.');
    const have = u.state.coins - await heldCoins(run, me.id);
    if (have < amount) throw new ApiError(409, 'coins', have > 0 ? 'Not enough coins. Your balance is ' + have + '.' : 'No coins to bet.', { coins: Math.max(0, have) });
    const seed = crypto.randomInt(0, 2147483647);
    const rolled = hooks.roll ? hooks.roll(g) : CrashMath.crashPoint(u01(), g.edge, g.max);
    const crash = Math.min(g.max * 100, Math.max(100, Math.round(rolled * 100)));
    const startAt = now + startIn, crashAt = startAt + Math.floor(g.path(seed).timeAt(crash / 100) * 1000);
    entries.push(await book(run, me.id, u.state, { coins: -amount, wager: amount, why: 'bet' }));
    const rows = await run(`INSERT INTO gc_rounds (user_id, game, bet, auto, seed, crash, start_at, crash_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [me.id, g.key, amount, auto, seed, crash, startAt, crashAt]);
    if (Math.random() < 0.02) {          // old rounds and entries are of no use to anybody
      await run(`DELETE FROM gc_rounds WHERE created_at < now() - interval '30 days'`);
      await run(`DELETE FROM gc_ledger WHERE created_at < now() - interval '30 days'`);
    }
    return answer(u, entries, { round: view(rows[0], now) });
  });
}
// Takes a bet back before its round has started.
async function cancel(me, body) {
  const id = roundId(body.id);
  return db.tx(async (run) => {
    const u = await lockUser(run, me.id), r = await lockRound(run, id, me.id), now = hooks.now(), entries = [];
    if (r.status === 'live') {
      if (now >= Number(r.start_at)) throw new ApiError(409, 'started', 'The round has started.', { round: view(r, now) });
      entries.push(await book(run, me.id, u.state, { coins: Number(r.bet), wager: -Number(r.bet), why: 'cancel' }, r.id));
      await run(`UPDATE gc_rounds SET status = 'cancelled' WHERE id = $1`, [r.id]);
      r.status = 'cancelled';
    }
    return answer(u, entries, { round: view(r, now) });
  });
}
// Cash out now. "Now" is this server's clock when the request arrives.
async function cashout(me, body) {
  const id = roundId(body.id);
  return db.tx(async (run) => {
    const u = await lockUser(run, me.id), r = await lockRound(run, id, me.id), now = hooks.now(), entries = [];
    const e = await settle(run, me.id, u.state, r, now);
    if (e) entries.push(e);
    if (r.status === 'live') {
      const start = Number(r.start_at);
      if (now < start) throw new ApiError(409, 'early', 'The round has not started yet.');
      const m = Math.min(r.crash, Math.max(100, Math.floor(pathOf(r).multAt((now - start) / 1000) * 100)));
      entries.push(await cash(run, me.id, u.state, r, m));
    }
    return answer(u, entries, { round: view(r, now) });
  });
}
// Changes the auto cash-out of a running round. Only to a point the round has not passed yet.
async function setAuto(me, body) {
  const id = roundId(body.id);
  return db.tx(async (run) => {
    const u = await lockUser(run, me.id), r = await lockRound(run, id, me.id), now = hooks.now(), entries = [];
    const auto = cleanAuto(body.auto, gameOf(r.game));
    const e = await settle(run, me.id, u.state, r, now);
    if (e) entries.push(e);
    if (r.status === 'live' && auto !== r.auto) {
      const start = Number(r.start_at);
      if (auto > 0 && now >= start && auto <= Math.floor(pathOf(r).multAt((now - start) / 1000) * 100)) throw new ApiError(409, 'late', 'The round is already past that.');
      await run(`UPDATE gc_rounds SET auto = $2 WHERE id = $1`, [r.id, auto]);
      r.auto = auto;
    }
    return answer(u, entries, { round: view(r, now) });
  });
}
async function settleNow(userId, id) {
  return db.tx(async (run) => {
    const u = await lockUser(run, userId), r = await lockRound(run, id, userId), now = hooks.now(), entries = [];
    const e = await settle(run, userId, u.state, r, now);
    if (e) entries.push(e);
    return answer(u, entries, r.status === 'live' ? { live: true, round: view(r, now) } : { round: view(r, now) });
  });
}
// Kept open until the round has ended (at most HOLD_MS, then the page asks again): this is how the page hears
// of the end the moment it happens, and not a moment earlier.
async function wait(me, body) {
  const id = roundId(body.id);
  const rows = await db.qSafe(`SELECT status, crash_at FROM gc_rounds WHERE id = $1 AND user_id = $2`, [id, me.id]);
  if (!rows.length) throw new ApiError(404, 'round', 'That round does not exist.');
  if (rows[0].status === 'live') {
    const left = Number(rows[0].crash_at) - hooks.now();
    if (left > 0) await sleep(Math.min(HOLD_MS, left + 5));
  }
  return settleNow(me.id, id);
}
// Rounds that are still running (after a reload), and everything that ended while the page was away.
async function state(me) {
  return db.tx(async (run) => {
    const u = await lockUser(run, me.id), now = hooks.now(), entries = [];
    const open = await run(`SELECT * FROM gc_rounds WHERE user_id = $1 AND status = 'live' ORDER BY id FOR UPDATE`, [me.id]);
    for (const r of open) { const e = await settle(run, me.id, u.state, r, now); if (e) entries.push(e); }
    return answer(u, entries, { rounds: open.filter((r) => r.status === 'live').map((r) => view(r, now)) });
  });
}
// For "me" and "login": pays out what ended while nobody was looking. True when the saved game changed.
async function settleAll(userId) {
  const any = await db.qSafe(`SELECT 1 FROM gc_rounds WHERE user_id = $1 AND status = 'live' LIMIT 1`, [userId]);
  if (!any.length) return false;
  const out = await state({ id: userId });
  return out.book.length > 0;
}

module.exports = { bet, cancel, cashout, setAuto, wait, state, settleAll, ledgerSince, hooks, HOLD_MS };
