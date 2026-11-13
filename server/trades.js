// Trading between two players: request -> open room -> offers -> accept twice each -> swap.
const { q, qSafe, tx } = require('./db');
const { ApiError, bad, exact, likeEscape } = require('./util');
const { cleanState, cleanOffer, sameOffer, isEmptyOffer, covers, applyTrade } = require('./state');

const ONLINE_SEC = 45;          // seen this recently = online
const PENDING_HOURS = 24;       // an unanswered request is dropped after this
const OPEN_MINUTES = 30;        // an open trade nobody touches is closed after this
const MAX_REQUESTS = 20;
const MAX_ID = 2147483647;

const COLS = `t.id, t.a_id, t.b_id, t.status, t.a_offer, t.b_offer, t.a_step, t.b_step, t.ver, t.ov, t.ended_by,
  (extract(epoch FROM t.created_at) * 1000)::float8 AS created,
  (extract(epoch FROM t.updated_at) * 1000)::float8 AS updated,
  (extract(epoch FROM t.done_at) * 1000)::float8 AS done,
  ua.name AS a_name, ub.name AS b_name,
  (extract(epoch FROM now() - ua.seen_at))::float8 AS a_idle,
  (extract(epoch FROM now() - ub.seen_at))::float8 AS b_idle`;
const FROM = `gc_trades t JOIN gc_users ua ON ua.id = t.a_id JOIN gc_users ub ON ub.id = t.b_id`;
const gone = () => new ApiError(409, 'gone', 'This trade is no longer open.');

// The trade as one of its two players sees it.
function view(t, me) {
  const mine = t.a_id === me ? 'a' : 'b', theirs = mine === 'a' ? 'b' : 'a';
  return {
    id: t.id, status: t.status, ver: t.ver, ov: t.ov,
    with: { id: t[theirs + '_id'], name: t[theirs + '_name'], online: t[theirs + '_idle'] < ONLINE_SEC },
    asked: mine === 'a',                                   // true when I sent the request
    me: { offer: cleanOffer(t[mine + '_offer']), step: t[mine + '_step'] },
    them: { offer: cleanOffer(t[theirs + '_offer']), step: t[theirs + '_step'] },
    endedBy: t.ended_by == null ? null : t.ended_by === me ? 'me' : 'them',
    created: t.created, updated: t.updated, done: t.done,
  };
}
async function loadRow(id, run) {
  const rows = await (run || q)(`SELECT ${COLS} FROM ${FROM} WHERE t.id = $1`, [id]);
  return rows[0] || null;
}
// The trade row if the player is part of it; otherwise it does not exist as far as they are concerned.
async function loadMine(id, me, run) {
  const t = await loadRow(id, run);
  if (!t || (t.a_id !== me && t.b_id !== me)) throw new ApiError(404, 'no_trade', 'That trade does not exist.');
  return t;
}
const tradeId = (v) => {
  const id = exact(v, 1, MAX_ID, 0);
  if (!id) throw bad('id', 'That trade does not exist.');
  return id;
};

// Requests nobody answered and rooms nobody touched are closed, so they stop blocking new ones.
const STALE = `((status = 'pending' AND created_at < now() - interval '${PENDING_HOURS} hours')
            OR (status = 'open' AND updated_at < now() - interval '${OPEN_MINUTES} minutes'))`;
function expire(ids, run) {
  return (run || q)(`UPDATE gc_trades SET status = 'expired', ver = ver + 1, updated_at = now()
                      WHERE (a_id = ANY($1) OR b_id = ANY($1)) AND ${STALE}`, [ids]);
}

async function request(me, body) {
  const to = exact(body.to, 1, MAX_ID, 0);
  if (!to || to === me.id) throw bad('target', 'Pick another player to trade with.');
  const target = await q(`SELECT id FROM gc_users WHERE id = $1`, [to]);
  if (!target.length) throw new ApiError(404, 'no_user', 'That player does not exist.');
  await expire([me.id, to]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const live = await q(
      `SELECT id, a_id, status FROM gc_trades
        WHERE LEAST(a_id, b_id) = LEAST($1::int, $2::int) AND GREATEST(a_id, b_id) = GREATEST($1::int, $2::int)
          AND status IN ('pending', 'open')`, [me.id, to]);
    if (live.length) {
      const t = live[0];
      // they asked me first: asking back is a yes
      if (t.status === 'pending' && t.a_id !== me.id) return respond(me, { id: t.id, accept: true });
      return { ok: true, already: true, trade: view(await loadRow(t.id), me.id) };
    }
    const mine = await q(`SELECT count(*)::int AS n FROM gc_trades WHERE a_id = $1 AND status = 'pending'`, [me.id]);
    if (mine[0].n >= MAX_REQUESTS) throw new ApiError(429, 'too_many', 'You have a lot of open requests. Cancel some first.');
    try {
      const rows = await q(`INSERT INTO gc_trades (a_id, b_id) VALUES ($1, $2) RETURNING id`, [me.id, to]);
      return { ok: true, trade: view(await loadRow(rows[0].id), me.id) };
    } catch (e) {
      if (!e || e.code !== '23505') throw e;         // both asked at the same moment: look again
    }
  }
  throw new ApiError(409, 'again', 'Please try that again.');
}

async function respond(me, body) {
  const id = tradeId(body.id);
  const t0 = await loadMine(id, me.id);
  if (t0.b_id !== me.id) throw new ApiError(403, 'not_yours', 'Only the player who was asked can answer a request.');
  if (!body.accept) {
    const rows = await q(`UPDATE gc_trades SET status = 'declined', ended_by = $2, ver = ver + 1, updated_at = now()
                           WHERE id = $1 AND status = 'pending' RETURNING id`, [id, me.id]);
    if (!rows.length) throw gone();
    return { ok: true, trade: view(await loadRow(id), me.id) };
  }
  // A player is in one trade room at a time. Both player rows are locked so two accepts cannot both pass the check.
  await tx(async (run) => {
    await run(`SELECT id FROM gc_users WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [[t0.a_id, t0.b_id]]);
    await expire([t0.a_id, t0.b_id], run);
    const cur = await run(`SELECT status FROM gc_trades WHERE id = $1 FOR UPDATE`, [id]);
    if (!cur.length || cur[0].status !== 'pending') throw gone();
    const busy = await run(`SELECT a_id, b_id FROM gc_trades WHERE status = 'open' AND (a_id = ANY($1) OR b_id = ANY($1)) LIMIT 1`, [[t0.a_id, t0.b_id]]);
    if (busy.length) {
      const mine = busy[0].a_id === me.id || busy[0].b_id === me.id;
      throw new ApiError(409, 'busy', mine ? 'Finish or leave your current trade first.' : t0.a_name + ' is in another trade right now.');
    }
    await run(`UPDATE gc_trades SET status = 'open', ver = ver + 1, updated_at = now() WHERE id = $1`, [id]);
  });
  return { ok: true, trade: view(await loadRow(id), me.id) };
}

// Leaves an open trade, takes back a request, or (for the player who was asked) turns one down.
async function cancel(me, body) {
  const id = tradeId(body.id);
  const t0 = await loadMine(id, me.id);
  const rows = await q(
    `UPDATE gc_trades SET status = CASE WHEN status = 'pending' AND b_id = $2 THEN 'declined' ELSE 'cancelled' END,
            ended_by = $2, a_step = 0, b_step = 0, ver = ver + 1, updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'open') RETURNING id`, [id, me.id]);
  if (!rows.length && t0.status === 'done') throw new ApiError(409, 'done', 'This trade is already complete.');
  return { ok: true, trade: view(await loadRow(id), me.id) };
}

async function offer(me, body) {
  const id = tradeId(body.id);
  const want = cleanOffer(body);
  const t0 = await loadMine(id, me.id);
  if (t0.status !== 'open') throw gone();
  const side = t0.a_id === me.id ? 'a' : 'b';
  if (sameOffer(want, cleanOffer(t0[side + '_offer']))) return { ok: true, trade: view(t0, me.id) };
  const u = await q(`SELECT state FROM gc_users WHERE id = $1`, [me.id]);
  if (!covers(cleanState(u[0].state), want)) throw new ApiError(409, 'missing', 'You do not have everything in that offer.', { trade: view(t0, me.id) });
  // a changed offer takes back every accept, so nobody confirms something they have not seen
  const rows = await q(`UPDATE gc_trades SET ${side}_offer = $2::jsonb, a_step = 0, b_step = 0, ov = ov + 1, ver = ver + 1, updated_at = now()
                         WHERE id = $1 AND status = 'open' RETURNING id`, [id, JSON.stringify(want)]);
  if (!rows.length) throw gone();
  return { ok: true, trade: view(await loadRow(id), me.id) };
}

// step 1 = accept, 2 = confirm, 0 = take it back. Both accept, then both confirm; the second confirm books the swap.
async function step(me, body) {
  const id = tradeId(body.id);
  const want = exact(body.step, 0, 2, -1);
  if (want < 0) throw bad('step', 'Unknown step.');
  const seen = exact(body.ov, 0, MAX_ID, -1);
  const t0 = await loadMine(id, me.id);
  const out = await tx(async (run) => {
    // players first, then the trade: every writer takes the locks in this order
    const users = await run(`SELECT id, state FROM gc_users WHERE id = ANY($1) ORDER BY id FOR UPDATE`, [[t0.a_id, t0.b_id]]);
    const rows = await run(`SELECT * FROM gc_trades WHERE id = $1 FOR UPDATE`, [id]);
    const t = rows[0];
    if (!t || t.status !== 'open') return { error: t && t.status === 'done' ? null : gone() };
    const side = t.a_id === me.id ? 'a' : 'b', other = side === 'a' ? 'b' : 'a';
    const stateOf = (uid) => cleanState((users.find((u) => u.id === uid) || {}).state);
    let mine = t[side + '_step'], theirs = t[other + '_step'];
    if (want === 0) {
      if (mine === 0) return {};
      mine = 0; theirs = Math.min(theirs, 1);
    } else {
      if (seen !== t.ov) return { error: new ApiError(409, 'changed', 'The offer changed. Check it and accept again.') };
      if (want === 1) {
        if (mine >= 1) return {};
        if (isEmptyOffer(cleanOffer(t.a_offer)) && isEmptyOffer(cleanOffer(t.b_offer))) return { error: bad('empty', 'Add something to the trade first.') };
        if (!covers(stateOf(me.id), cleanOffer(t[side + '_offer']))) return { error: new ApiError(409, 'missing', 'You no longer have everything you offered.') };
        mine = 1;
      } else {
        if (mine === 2) return {};
        if (mine < 1 || theirs < 1) return { error: new ApiError(409, 'order', 'Both players accept first, then both confirm.') };
        mine = 2;
      }
    }
    if (mine === 2 && theirs === 2) {
      const ao = cleanOffer(t.a_offer), bo = cleanOffer(t.b_offer);
      const sa = stateOf(t.a_id), sb = stateOf(t.b_id);
      const okA = covers(sa, ao), okB = covers(sb, bo);
      if (!okA || !okB) {
        await run(`UPDATE gc_trades SET a_step = 0, b_step = 0, ver = ver + 1, updated_at = now() WHERE id = $1`, [id]);
        const meShort = side === 'a' ? !okA : !okB;
        return { error: new ApiError(409, 'missing', meShort ? 'You no longer have everything you offered.' : 'The other player no longer has everything they offered.') };
      }
      applyTrade(sa, ao, bo); applyTrade(sb, bo, ao);
      const ra = await run(`UPDATE gc_users SET state = $2::jsonb, rev = rev + 1 WHERE id = $1 RETURNING rev`, [t.a_id, JSON.stringify(sa)]);
      const rb = await run(`UPDATE gc_users SET state = $2::jsonb, rev = rev + 1 WHERE id = $1 RETURNING rev`, [t.b_id, JSON.stringify(sb)]);
      await run(`UPDATE gc_trades SET status = 'done', a_step = 2, b_step = 2, a_rev = $2, b_rev = $3, ver = ver + 1, updated_at = now(), done_at = now() WHERE id = $1`,
        [id, ra[0].rev, rb[0].rev]);
      return {};
    }
    await run(`UPDATE gc_trades SET ${side}_step = $2, ${other}_step = $3, ver = ver + 1, updated_at = now() WHERE id = $1`, [id, mine, theirs]);
    return {};
  });
  const trade = view(await loadRow(id), me.id);
  if (out.error) { out.error.extra = Object.assign({}, out.error.extra, { trade }); throw out.error; }
  return { ok: true, trade };
}

async function get(me, body) {
  return { ok: true, trade: view(await loadMine(tradeId(body.id), me.id), me.id) };
}

async function history(me) {
  const rows = await q(`SELECT ${COLS} FROM ${FROM}
                         WHERE (t.a_id = $1 OR t.b_id = $1) AND t.status NOT IN ('pending', 'open')
                         ORDER BY t.updated_at DESC, t.id DESC LIMIT 40`, [me.id]);
  return { ok: true, trades: rows.map((t) => view(t, me.id)) };
}

// Finished trades of this player that were booked after the given rev, oldest first.
async function bookedSince(userId, rev, run) {
  const rows = await run(
    `SELECT id, a_id, a_offer, b_offer, a_rev, b_rev FROM gc_trades
      WHERE status = 'done' AND ((a_id = $1 AND a_rev > $2) OR (b_id = $1 AND b_rev > $2))
      ORDER BY done_at, id`, [userId, rev]);
  return rows.map((t) => {
    const a = cleanOffer(t.a_offer), b = cleanOffer(t.b_offer);
    return t.a_id === userId ? { id: t.id, rev: t.a_rev, give: a, get: b } : { id: t.id, rev: t.b_rev, give: b, get: a };
  });
}

async function search(me, body) {
  const text = String(body.q == null ? '' : body.q).normalize('NFKC').trim().toLowerCase().slice(0, 16);
  const cols = `id, name, (extract(epoch FROM now() - seen_at))::float8 AS idle`;
  const rows = text
    ? await q(`SELECT ${cols} FROM gc_users WHERE id <> $1 AND name_lc LIKE $2 ESCAPE '\\'
                ORDER BY (name_lc = $3) DESC, (name_lc LIKE $4 ESCAPE '\\') DESC, seen_at DESC LIMIT 20`,
      [me.id, '%' + likeEscape(text) + '%', text, likeEscape(text) + '%'])
    : await q(`SELECT ${cols} FROM gc_users WHERE id <> $1 ORDER BY seen_at DESC LIMIT 20`, [me.id]);
  return { ok: true, q: text, users: rows.map((u) => ({ id: u.id, name: u.name, online: u.idle < ONLINE_SEC, idle: Math.round(u.idle) })) };
}

// The heartbeat: what a logged-in page needs to stay current. Cheap on purpose, it runs every few seconds.
const lastExpire = new Map();
async function poll(me, body) {
  const now = Date.now();
  if (now - (lastExpire.get(me.id) || 0) > 60000) {
    if (lastExpire.size > 5000) lastExpire.clear();
    lastExpire.set(me.id, now);
    await expire([me.id]);
  }
  const rows = await qSafe(`SELECT ${COLS} FROM ${FROM}
                             WHERE (t.a_id = $1 OR t.b_id = $1) AND t.status IN ('pending', 'open')
                             ORDER BY t.id DESC LIMIT 80`, [me.id]);
  const out = { ok: true, rev: me.rev, inbox: [], sent: [], open: null };
  for (const t of rows) {
    const v = view(t, me.id);
    const brief = { id: v.id, with: v.with, at: v.created };
    if (t.status === 'open') { if (!out.open) out.open = { id: v.id, ver: v.ver, with: v.with }; }
    else if (v.asked) out.sent.push(brief);
    else out.inbox.push(brief);
  }
  // the room this page is showing: sent in full only when something changed
  const watching = body.trade && exact(body.trade.id, 1, MAX_ID, 0);
  if (watching) {
    const t = rows.find((r) => r.id === watching) || await loadRow(watching);
    if (!t || (t.a_id !== me.id && t.b_id !== me.id)) out.trade = { id: watching, status: 'gone' };
    else if (t.ver !== exact(body.trade.ver, 0, MAX_ID, -1)) out.trade = view(t, me.id);
  }
  return out;
}

module.exports = { request, respond, cancel, offer, step, get, history, search, poll, bookedSince, view, ONLINE_SEC };
