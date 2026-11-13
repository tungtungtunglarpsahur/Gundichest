// API tests against a real Postgres database (see tests/helpers.js for how to point them at one).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { load, skipReason } = require('./helpers');

describe('GundiChest API', { skip: skipReason || false }, () => {
  let T;
  before(async () => { T = load(); await T.reset(); });
  after(async () => { if (T) await T.db.end(); });

  const sql = (text, params) => T.db.q(text, params);
  const status = async (want, op, data, token) => {
    const r = await T.call(op, data, token);
    assert.equal(r.status, want, op + ' -> ' + JSON.stringify(r.body));
    return r.body;
  };

  describe('health', () => {
    it('answers GET without touching the database', async () => {
      const r = await T.handle({ method: 'GET', query: {}, headers: {} });
      assert.equal(r.status, 200);
      assert.equal(r.body.db, 'configured');
    });
    it('reports a working database with ?deep=1', async () => {
      const r = await T.handle({ method: 'GET', query: { deep: '1' }, headers: {} });
      assert.equal(r.body.db, 'ok');
    });
    it('rejects other methods and unknown requests', async () => {
      assert.equal((await T.handle({ method: 'PUT', headers: {} })).status, 405);
      await status(400, 'nope');
      assert.equal((await T.handle({ method: 'POST', body: '{broken', headers: {} })).status, 400);
      assert.equal((await T.handle({ method: 'POST', body: '[1,2]', headers: {} })).status, 400);
    });
    it('reads a JSON string body the same as a parsed one', async () => {
      const r = await T.handle({ method: 'POST', body: JSON.stringify({ op: 'me' }), headers: {} });
      assert.equal(r.status, 401);
    });
  });

  describe('accounts', () => {
    it('registers and returns a session', async () => {
      const r = await status(200, 'register', { name: 'Maxi', pass: 'geheim12' });
      assert.equal(r.user.name, 'Maxi');
      assert.ok(r.token.length > 30);
      assert.equal(r.rev, 0);
      assert.deepEqual(r.state, { coins: 0, inv: {}, found: {}, opened: 0, stats: {}, rugHistory: [] });
      const me = await status(200, 'me', { rev: 0 }, r.token);
      assert.equal(me.user.name, 'Maxi');
      assert.equal(me.state, undefined);
    });
    it('does not store the password itself', async () => {
      const rows = await sql(`SELECT pass FROM gc_users WHERE name_lc = 'maxi'`);
      assert.match(rows[0].pass, /^s1\$16384\$8\$1\$/);
      assert.ok(!rows[0].pass.includes('geheim12'));
      const s = await sql(`SELECT token_hash FROM gc_sessions`);
      assert.match(s[0].token_hash, /^[0-9a-f]{64}$/);
    });
    it('treats names as taken regardless of case', async () => {
      const r = await status(409, 'register', { name: 'MAXI', pass: 'geheim12' });
      assert.equal(r.error, 'taken');
    });
    it('accepts umlauts and trims spaces', async () => {
      const r = await status(200, 'register', { name: '  Jürgen_07 ', pass: 'geheim12' });
      assert.equal(r.user.name, 'Jürgen_07');
    });
    it('rejects names and passwords that break the rules', async () => {
      for (const name of ['ab', 'a'.repeat(17), 'has space', '<b>x</b>', '_start', 'semi;colon', '', null, 'a/b']) {
        const r = await status(400, 'register', { name, pass: 'geheim12' });
        assert.equal(r.error, 'name', String(name));
      }
      for (const pass of ['12345', '', null, 'x'.repeat(101), 123456]) {
        const r = await status(400, 'register', { name: 'okname', pass });
        assert.equal(r.error, 'pass', String(pass));
      }
    });
    it('takes the progress made before registering, cleaned up', async () => {
      const r = await status(200, 'register', { name: 'seeded', pass: 'geheim12', seed: { coins: 77.9, inv: { i3: 2, bogus: 5, i4: -1 }, opened: 9, stats: { won: 5, hack: 1 }, settings: { quality: 'low' } } });
      assert.deepEqual(r.state, { coins: 77, inv: { i3: 2 }, found: { i3: true }, opened: 9, stats: { won: 5 }, rugHistory: [] });
    });
    it('logs in with the right password only, in any case of the name', async () => {
      const good = await status(200, 'login', { name: 'maxi', pass: 'geheim12' });
      assert.equal(good.user.name, 'Maxi');
      assert.equal((await status(401, 'login', { name: 'Maxi', pass: 'geheim13' })).error, 'login');
      assert.equal((await status(401, 'login', { name: 'nobody', pass: 'geheim12' })).error, 'login');
      assert.equal((await status(401, 'login', { name: '', pass: '' })).error, 'login');
    });
    it('needs a valid session for everything else', async () => {
      assert.equal((await status(401, 'me', {})).error, 'auth');
      assert.equal((await status(401, 'poll', {}, 'x'.repeat(43))).error, 'auth');
      assert.equal((await status(401, 'sync', { rev: 0, state: {} }, 'short')).error, 'auth');
    });
    it('ends the session on logout', async () => {
      const r = await T.ok('login', { name: 'maxi', pass: 'geheim12' });
      await status(200, 'logout', {}, r.token);
      await status(401, 'me', {}, r.token);
    });
    it('drops sessions that were not used for months', async () => {
      const r = await T.ok('login', { name: 'maxi', pass: 'geheim12' });
      await sql(`UPDATE gc_sessions SET seen_at = now() - interval '121 days' WHERE user_id = $1`, [r.user.id]);
      await status(401, 'me', {}, r.token);
    });
    it('locks a name for a while after many wrong passwords', async () => {
      const p = await T.player();
      for (let i = 0; i < 15; i++) await status(401, 'login', { name: p.name, pass: 'wrong-' + i });
      const r = await status(429, 'login', { name: p.name, pass: p.pass });
      assert.equal(r.error, 'slow_down');
      await sql(`DELETE FROM gc_limits`);
      await status(200, 'login', { name: p.name, pass: p.pass });
    });
    it('limits new accounts per network', async () => {
      await sql(`DELETE FROM gc_limits`);
      const ip = '203.0.113.9';
      await T.call('register', { name: 'net_first', pass: 'geheim12' }, null, ip);
      await sql(`UPDATE gc_limits SET hits = 60 WHERE key LIKE 'reg:%'`);
      const r = await T.call('register', { name: 'net_second', pass: 'geheim12' }, null, ip);
      assert.equal(r.status, 429);
      const other = await T.call('register', { name: 'net_third', pass: 'geheim12' }, null, '203.0.113.10');
      assert.equal(other.status, 200);
      await sql(`DELETE FROM gc_limits`);
    });
    it('changes the password and logs other devices out', async () => {
      const p = await T.player();
      const second = await T.ok('login', { name: p.name, pass: p.pass });
      assert.equal((await status(403, 'account.password', { pass: 'nope', next: 'brandnew1' }, p.token)).error, 'pass');
      assert.equal((await status(400, 'account.password', { pass: p.pass, next: '123' }, p.token)).error, 'pass');
      await status(200, 'account.password', { pass: p.pass, next: 'brandnew1' }, p.token);
      await status(200, 'me', {}, p.token);
      await status(401, 'me', {}, second.token);
      await status(401, 'login', { name: p.name, pass: p.pass });
      await status(200, 'login', { name: p.name, pass: 'brandnew1' });
    });
    it('deletes an account with its sessions and trades', async () => {
      const { a, b, id } = await T.room({ coins: 5 }, { coins: 5 });
      assert.equal((await status(403, 'account.delete', { pass: 'nope' }, a.token)).error, 'pass');
      await status(200, 'account.delete', { pass: a.pass }, a.token);
      await status(401, 'me', {}, a.token);
      await status(401, 'login', { name: a.name, pass: a.pass });
      const p = await T.ok('poll', { trade: { id, ver: 0 } }, b.token);
      assert.equal(p.trade.status, 'gone');
      assert.equal(p.open, null);
      assert.equal((await sql(`SELECT count(*)::int AS n FROM gc_trades WHERE id = $1`, [id]))[0].n, 0);
    });
  });

  describe('saving the game', () => {
    it('stores a save and counts the rev up', async () => {
      const p = await T.player();
      const r = await T.ok('sync', { rev: 0, state: { coins: 120, inv: { i17: 2 }, opened: 3 } }, p.token);
      assert.equal(r.rev, 1);
      assert.equal(r.trades, undefined);
      const s = await T.stateOf(p);
      assert.equal(s.coins, 120);
      assert.deepEqual(s.inv, { i17: 2 });
      assert.deepEqual(s.found, { i17: true });
      const me = await T.ok('me', { rev: 1 }, p.token);
      assert.equal(me.state, undefined);
    });
    it('keeps only what a save may contain', async () => {
      const p = await T.player();
      await T.ok('sync', { rev: 0, state: {
        coins: -50, inv: { i0: 3.7, i99: 4, i1: 'x', i2: 2e9, __proto__: 1 }, found: { i5: 1, nope: true }, opened: 1e12,
        stats: { won: 10, bestMult: 12.345, evil: 5, sold: -3, earned: Infinity }, rugHistory: [1.234, 'a', -1, 2], settings: { x: 1 }, extra: 'x'.repeat(1000),
      } }, p.token);
      const s = await T.stateOf(p);
      assert.deepEqual(s, { coins: 0, inv: { i0: 3, i2: 1000000 }, found: { i0: true, i2: true, i5: true }, opened: 1e9, stats: { won: 10, bestMult: 12.35 }, rugHistory: [1.23, 2] });
    });
    it('refuses a save that is not an object', async () => {
      const p = await T.player();
      for (const state of [null, 'text', 5, [1]]) await status(400, 'sync', { rev: 0, state }, p.token);
    });
    it('answers a stale save with the stored game', async () => {
      const p = await T.player();
      await T.ok('sync', { rev: 0, state: { coins: 10 } }, p.token);
      const r = await status(409, 'sync', { rev: 0, state: { coins: 999 } }, p.token);
      assert.equal(r.error, 'conflict');
      assert.equal(r.rev, 1);
      assert.equal(r.state.coins, 10);
      assert.equal((await T.stateOf(p)).coins, 10);
      assert.equal((await status(409, 'sync', { rev: 5, state: { coins: 999 } }, p.token)).rev, 1);
      assert.equal((await status(409, 'sync', { state: { coins: 999 } }, p.token)).rev, 1);
    });
    it('lets exactly one of two saves from the same rev through', async () => {
      const p = await T.player();
      const rs = await Promise.all([1, 2, 3, 4].map((n) => T.call('sync', { rev: 0, state: { coins: n } }, p.token)));
      assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409, 409, 409]);
      const won = rs.find((r) => r.status === 200), s = await T.stateOf(p);
      assert.equal(won.body.rev, 1);
      assert.ok(s.coins >= 1 && s.coins <= 4);
    });
  });

  describe('finding players', () => {
    it('finds by part of the name, best match first, never yourself', async () => {
      const me = await T.player({}, 'Finder');
      await T.player({}, 'Anna');
      await T.player({}, 'Hanna');
      await T.player({}, 'Annabel');
      const r = await T.ok('users.search', { q: 'ANN' }, me.token);
      assert.deepEqual(r.users.map((u) => u.name).slice(0, 3).sort(), ['Anna', 'Annabel', 'Hanna']);
      assert.equal((await T.ok('users.search', { q: 'anna' }, me.token)).users[0].name, 'Anna');
      assert.ok(r.users.every((u) => u.online === true));
      assert.deepEqual((await T.ok('users.search', { q: 'finder' }, me.token)).users, []);
    });
    it('treats % and _ as plain characters', async () => {
      const me = await T.player();
      await T.player({}, 'under_score');
      assert.deepEqual((await T.ok('users.search', { q: '%' }, me.token)).users, []);
      assert.deepEqual((await T.ok('users.search', { q: 'r_s' }, me.token)).users.map((u) => u.name), ['under_score']);
      assert.deepEqual((await T.ok('users.search', { q: 'rXs' }, me.token)).users, []);
    });
    it('lists recently active players for an empty search and marks who is offline', async () => {
      const me = await T.player();
      const idle = await T.player();
      await sql(`UPDATE gc_users SET seen_at = now() - interval '10 minutes' WHERE id = $1`, [idle.id]);
      const fresh = await T.player();
      const r = await T.ok('users.search', {}, me.token);
      assert.ok(r.users.length >= 2 && r.users.length <= 20);
      assert.equal(r.users[0].id, fresh.id);                                   // most recently active first
      assert.ok(r.users.every((u) => u.id !== me.id));
      const hit = (await T.ok('users.search', { q: idle.name }, me.token)).users[0];
      assert.equal(hit.online, false);
      assert.ok(hit.idle >= 599);
      const pos = r.users.findIndex((u) => u.id === idle.id);
      if (pos >= 0) assert.ok(r.users.slice(pos).every((u) => !u.online));     // nobody online is listed after someone offline
    });
    it('marks a player online again once they are active', async () => {
      const me = await T.player(), other = await T.player();
      await sql(`UPDATE gc_users SET seen_at = now() - interval '10 minutes' WHERE id = $1`, [other.id]);
      await T.ok('poll', {}, other.token);
      assert.equal((await T.ok('users.search', { q: other.name }, me.token)).users[0].online, true);
    });
  });

  describe('trade requests', () => {
    it('sends a request the other player sees', async () => {
      const a = await T.player(), b = await T.player();
      const r = await T.ok('trade.request', { to: b.id }, a.token);
      assert.equal(r.trade.status, 'pending');
      assert.equal(r.trade.asked, true);
      assert.equal(r.trade.with.name, b.name);
      const pa = await T.ok('poll', {}, a.token), pb = await T.ok('poll', {}, b.token);
      assert.deepEqual(pa.sent.map((x) => x.with.name), [b.name]);
      assert.deepEqual(pa.inbox, []);
      assert.deepEqual(pb.inbox.map((x) => [x.id, x.with.name, x.with.online]), [[r.trade.id, a.name, true]]);
      assert.equal(pb.open, null);
    });
    it('refuses yourself, unknown players and nonsense', async () => {
      const a = await T.player();
      assert.equal((await status(400, 'trade.request', { to: a.id }, a.token)).error, 'target');
      assert.equal((await status(404, 'trade.request', { to: 999999 }, a.token)).error, 'no_user');
      for (const to of [null, 'abc', -1, 0, 1.5, 1.5e12, '1', [1], {}]) await status(400, 'trade.request', { to }, a.token);
    });
    it('does not stack requests between the same two players', async () => {
      const a = await T.player(), b = await T.player();
      const first = await T.ok('trade.request', { to: b.id }, a.token);
      const again = await T.ok('trade.request', { to: b.id }, a.token);
      assert.equal(again.already, true);
      assert.equal(again.trade.id, first.trade.id);
      assert.equal((await sql(`SELECT count(*)::int AS n FROM gc_trades WHERE a_id = $1`, [a.id]))[0].n, 1);
    });
    it('opens the trade when both ask each other', async () => {
      const a = await T.player(), b = await T.player();
      const first = await T.ok('trade.request', { to: b.id }, a.token);
      const back = await T.ok('trade.request', { to: a.id }, b.token);
      assert.equal(back.trade.id, first.trade.id);
      assert.equal(back.trade.status, 'open');
    });
    it('survives both asking at the very same moment', async () => {
      const a = await T.player(), b = await T.player();
      const rs = await Promise.all([T.call('trade.request', { to: b.id }, a.token), T.call('trade.request', { to: a.id }, b.token)]);
      assert.deepEqual(rs.map((r) => r.status), [200, 200]);
      const rows = await sql(`SELECT status FROM gc_trades WHERE a_id IN ($1, $2)`, [a.id, b.id]);
      assert.equal(rows.length, 1);
    });
    it('caps how many requests one player can have waiting', async () => {
      const a = await T.player();
      const others = [];
      for (let i = 0; i < 21; i++) others.push(await T.player());
      for (let i = 0; i < 20; i++) await T.ok('trade.request', { to: others[i].id }, a.token);
      assert.equal((await status(429, 'trade.request', { to: others[20].id }, a.token)).error, 'too_many');
    });
    it('lets only the asked player answer', async () => {
      const a = await T.player(), b = await T.player(), c = await T.player();
      const t = (await T.ok('trade.request', { to: b.id }, a.token)).trade;
      assert.equal((await status(403, 'trade.respond', { id: t.id, accept: true }, a.token)).error, 'not_yours');
      assert.equal((await status(404, 'trade.respond', { id: t.id, accept: true }, c.token)).error, 'no_trade');
      assert.equal((await status(404, 'trade.get', { id: t.id }, c.token)).error, 'no_trade');
      await status(400, 'trade.respond', { id: 'x', accept: true }, b.token);
    });
    it('declines', async () => {
      const a = await T.player(), b = await T.player();
      const t = (await T.ok('trade.request', { to: b.id }, a.token)).trade;
      const r = await T.ok('trade.respond', { id: t.id, accept: false }, b.token);
      assert.equal(r.trade.status, 'declined');
      assert.equal(r.trade.endedBy, 'me');
      assert.equal((await T.ok('trade.get', { id: t.id }, a.token)).trade.endedBy, 'them');
      assert.equal((await status(409, 'trade.respond', { id: t.id, accept: true }, b.token)).error, 'gone');
      assert.deepEqual((await T.ok('poll', {}, b.token)).inbox, []);
      assert.equal((await T.ok('trade.request', { to: b.id }, a.token)).trade.status, 'pending');     // may ask again
    });
    it('takes a request back, and treats a cancel by the asked player as a decline', async () => {
      const a = await T.player(), b = await T.player(), c = await T.player();
      const t1 = (await T.ok('trade.request', { to: b.id }, a.token)).trade;
      assert.equal((await T.ok('trade.cancel', { id: t1.id }, a.token)).trade.status, 'cancelled');
      assert.equal((await T.ok('trade.cancel', { id: t1.id }, a.token)).trade.status, 'cancelled');     // again is harmless
      const t2 = (await T.ok('trade.request', { to: c.id }, a.token)).trade;
      assert.equal((await T.ok('trade.cancel', { id: t2.id }, c.token)).trade.status, 'declined');
      await status(404, 'trade.cancel', { id: t2.id }, b.token);
    });
    it('keeps a player in one trade room at a time', async () => {
      const a = await T.player(), b = await T.player(), c = await T.player();
      const ab = (await T.ok('trade.request', { to: b.id }, a.token)).trade;
      const ac = (await T.ok('trade.request', { to: c.id }, a.token)).trade;
      const cb = (await T.ok('trade.request', { to: b.id }, c.token)).trade;
      await T.ok('trade.respond', { id: ab.id, accept: true }, b.token);
      const r1 = await status(409, 'trade.respond', { id: ac.id, accept: true }, c.token);
      assert.equal(r1.error, 'busy');
      assert.match(r1.message, new RegExp(a.name));
      const r2 = await status(409, 'trade.respond', { id: cb.id, accept: true }, b.token);
      assert.match(r2.message, /your current trade/);
      await T.ok('trade.cancel', { id: ab.id }, a.token);
      assert.equal((await T.ok('trade.respond', { id: ac.id, accept: true }, c.token)).trade.status, 'open');
    });
    it('opens only one room when two requests are accepted at once', async () => {
      const a = await T.player(), b = await T.player(), c = await T.player();
      const ba = (await T.ok('trade.request', { to: a.id }, b.token)).trade;
      const ca = (await T.ok('trade.request', { to: a.id }, c.token)).trade;
      const rs = await Promise.all([T.call('trade.respond', { id: ba.id, accept: true }, a.token), T.call('trade.respond', { id: ca.id, accept: true }, a.token)]);
      assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await sql(`SELECT count(*)::int AS n FROM gc_trades WHERE status = 'open' AND b_id = $1`, [a.id]))[0].n, 1);
    });
    it('expires requests after a day and idle rooms after half an hour', async () => {
      const a = await T.player(), b = await T.player(), c = await T.player();
      const t1 = (await T.ok('trade.request', { to: b.id }, a.token)).trade;
      await sql(`UPDATE gc_trades SET created_at = now() - interval '25 hours' WHERE id = $1`, [t1.id]);
      const again = await T.ok('trade.request', { to: b.id }, a.token);
      assert.notEqual(again.trade.id, t1.id);
      assert.equal((await T.ok('trade.get', { id: t1.id }, a.token)).trade.status, 'expired');
      await T.ok('trade.respond', { id: again.trade.id, accept: true }, b.token);
      await sql(`UPDATE gc_trades SET updated_at = now() - interval '31 minutes' WHERE id = $1`, [again.trade.id]);
      // b is free again: accepting another request closes the stale room first
      const t3 = (await T.ok('trade.request', { to: b.id }, c.token)).trade;
      assert.equal((await T.ok('trade.respond', { id: t3.id, accept: true }, b.token)).trade.status, 'open');
      assert.equal((await T.ok('trade.get', { id: again.trade.id }, a.token)).trade.status, 'expired');
    });
  });

  describe('offers', () => {
    it('sets an offer the other player sees and counts the versions', async () => {
      const { a, b, id } = await T.room({ coins: 300, inv: { i17: 3, i7: 1 } }, { coins: 40, inv: { i14: 2 } });
      const before = (await T.ok('trade.get', { id }, a.token)).trade;
      const r = await T.ok('trade.offer', { id, items: { i17: 2, i7: 1 }, coins: 120 }, a.token);
      assert.deepEqual(r.trade.me.offer, { items: { i7: 1, i17: 2 }, coins: 120 });
      assert.equal(r.trade.ov, before.ov + 1);
      assert.equal(r.trade.ver, before.ver + 1);
      const seen = (await T.ok('trade.get', { id }, b.token)).trade;
      assert.deepEqual(seen.them.offer, { items: { i7: 1, i17: 2 }, coins: 120 });
      assert.deepEqual(seen.me.offer, { items: {}, coins: 0 });
      assert.equal(seen.with.name, a.name);
    });
    it('only accepts what the saved game really holds', async () => {
      const { a, id } = await T.room({ coins: 300, inv: { i17: 3 } }, {});
      assert.equal((await status(409, 'trade.offer', { id, items: { i17: 4 } }, a.token)).error, 'missing');
      assert.equal((await status(409, 'trade.offer', { id, items: { i3: 1 } }, a.token)).error, 'missing');
      assert.equal((await status(409, 'trade.offer', { id, coins: 301 }, a.token)).error, 'missing');
      const r = await T.ok('trade.offer', { id, items: { i17: 3, bogus: 2, i5: 0, i6: -4 }, coins: 300.9 }, a.token);
      assert.deepEqual(r.trade.me.offer, { items: { i17: 3 }, coins: 300 });
    });
    it('takes back every accept when an offer changes, but not when it stays the same', async () => {
      const { a, b, id } = await T.room({ coins: 300, inv: { i17: 3 } }, { coins: 50 });
      let t = (await T.ok('trade.offer', { id, items: { i17: 1 } }, a.token)).trade;
      await T.ok('trade.step', { id, step: 1, ov: t.ov }, a.token);
      await T.ok('trade.step', { id, step: 1, ov: t.ov }, b.token);
      const same = (await T.ok('trade.offer', { id, items: { i17: 1 }, coins: 0 }, a.token)).trade;
      assert.equal(same.ov, t.ov);
      assert.deepEqual([same.me.step, same.them.step], [1, 1]);
      t = (await T.ok('trade.offer', { id, coins: 10 }, b.token)).trade;
      assert.deepEqual([t.me.step, t.them.step], [0, 0]);
      assert.equal(t.ov, same.ov + 1);
    });
    it('is closed to outsiders and to finished trades', async () => {
      const { a, id } = await T.room({ coins: 5 }, {});
      const c = await T.player({ coins: 5 });
      await status(404, 'trade.offer', { id, coins: 1 }, c.token);
      await status(404, 'trade.step', { id, step: 1, ov: 0 }, c.token);
      await T.ok('trade.cancel', { id }, a.token);
      assert.equal((await status(409, 'trade.offer', { id, coins: 1 }, a.token)).error, 'gone');
      assert.equal((await status(409, 'trade.step', { id, step: 1, ov: 0 }, a.token)).error, 'gone');
    });
  });

  describe('accepting', () => {
    const offers = async (r, ao, bo) => {
      await T.ok('trade.offer', Object.assign({ id: r.id }, ao), r.a.token);
      return (await T.ok('trade.offer', Object.assign({ id: r.id }, bo), r.b.token)).trade.ov;
    };
    it('needs both to accept and then both to confirm', async () => {
      const r = await T.room({ coins: 300, inv: { i17: 3 } }, { coins: 50, inv: { i14: 1 } });
      const ov = await offers(r, { items: { i17: 2 } }, { items: { i14: 1 }, coins: 20 });
      assert.equal((await status(409, 'trade.step', { id: r.id, step: 2, ov }, r.a.token)).error, 'order');
      let t = (await T.ok('trade.step', { id: r.id, step: 1, ov }, r.a.token)).trade;
      assert.deepEqual([t.me.step, t.them.step, t.status], [1, 0, 'open']);
      assert.equal((await status(409, 'trade.step', { id: r.id, step: 2, ov }, r.a.token)).error, 'order');     // b has not accepted yet
      t = (await T.ok('trade.step', { id: r.id, step: 1, ov }, r.b.token)).trade;
      assert.deepEqual([t.me.step, t.them.step], [1, 1]);
      t = (await T.ok('trade.step', { id: r.id, step: 2, ov }, r.b.token)).trade;
      assert.deepEqual([t.me.step, t.them.step, t.status], [2, 1, 'open']);
      t = (await T.ok('trade.step', { id: r.id, step: 2, ov }, r.a.token)).trade;
      assert.deepEqual([t.me.step, t.them.step, t.status], [2, 2, 'done']);
      assert.ok(t.done > 0);
      const sa = await T.stateOf(r.a), sb = await T.stateOf(r.b);
      assert.deepEqual([sa.coins, sa.inv], [320, { i14: 1, i17: 1 }]);
      assert.deepEqual([sb.coins, sb.inv], [30, { i17: 2 }]);
      assert.equal(sa.found.i14, true);
      assert.equal(sb.found.i17, true);
      assert.equal(sa.stats.traded, 1);
      const row = (await sql(`SELECT a_rev, b_rev FROM gc_trades WHERE id = $1`, [r.id]))[0];
      assert.deepEqual([row.a_rev, row.b_rev], [1, 1]);
      assert.equal((await T.ok('poll', {}, r.a.token)).rev, 1);
    });
    it('refuses an accept for an offer the player has not seen', async () => {
      const r = await T.room({ coins: 300 }, { coins: 50 });
      const ov = await offers(r, { coins: 10 }, { coins: 5 });
      await T.ok('trade.offer', { id: r.id, coins: 1 }, r.a.token);
      const res = await status(409, 'trade.step', { id: r.id, step: 1, ov }, r.b.token);
      assert.equal(res.error, 'changed');
      assert.equal(res.trade.ov, ov + 1);
      await status(409, 'trade.step', { id: r.id, step: 1 }, r.b.token);
      await T.ok('trade.step', { id: r.id, step: 1, ov: ov + 1 }, r.b.token);
    });
    it('refuses to accept an empty trade', async () => {
      const r = await T.room({ coins: 5 }, { coins: 5 });
      assert.equal((await status(400, 'trade.step', { id: r.id, step: 1, ov: 0 }, r.a.token)).error, 'empty');
    });
    it('allows a gift: one side gives, the other nothing', async () => {
      const r = await T.room({ inv: { i0: 1 } }, {});
      const ov = (await T.ok('trade.offer', { id: r.id, items: { i0: 1 } }, r.a.token)).trade.ov;
      for (const s of [1, 2]) { await T.ok('trade.step', { id: r.id, step: s, ov }, r.a.token); await T.ok('trade.step', { id: r.id, step: s, ov }, r.b.token); }
      assert.deepEqual((await T.stateOf(r.a)).inv, {});
      assert.deepEqual((await T.stateOf(r.b)).inv, { i0: 1 });
    });
    it('lets a player take an accept back, which also undoes the other confirm', async () => {
      const r = await T.room({ coins: 300 }, { coins: 50 });
      const ov = await offers(r, { coins: 10 }, { coins: 5 });
      await T.ok('trade.step', { id: r.id, step: 1, ov }, r.a.token);
      await T.ok('trade.step', { id: r.id, step: 1, ov }, r.b.token);
      await T.ok('trade.step', { id: r.id, step: 2, ov }, r.a.token);
      const t = (await T.ok('trade.step', { id: r.id, step: 0 }, r.b.token)).trade;
      assert.deepEqual([t.me.step, t.them.step], [0, 1]);
      assert.equal((await status(409, 'trade.step', { id: r.id, step: 2, ov }, r.a.token)).error, 'order');
      assert.equal((await T.stateOf(r.a)).coins, 300);
    });
    it('repeating a step changes nothing', async () => {
      const r = await T.room({ coins: 300 }, { coins: 50 });
      const ov = await offers(r, { coins: 10 }, { coins: 5 });
      const one = (await T.ok('trade.step', { id: r.id, step: 1, ov }, r.a.token)).trade;
      const two = (await T.ok('trade.step', { id: r.id, step: 1, ov }, r.a.token)).trade;
      assert.equal(two.ver, one.ver);
      await T.ok('trade.step', { id: r.id, step: 1, ov }, r.b.token);
      await T.ok('trade.step', { id: r.id, step: 2, ov }, r.b.token);
      await T.ok('trade.step', { id: r.id, step: 2, ov }, r.a.token);
      const again = await T.ok('trade.step', { id: r.id, step: 2, ov }, r.a.token);        // after it is done
      assert.equal(again.trade.status, 'done');
      assert.equal((await T.stateOf(r.a)).coins, 295);
    });
    it('books the swap once when both confirm at the same moment', async () => {
      const r = await T.room({ coins: 300, inv: { i17: 3 } }, { coins: 50, inv: { i14: 1 } });
      const ov = await offers(r, { items: { i17: 2 }, coins: 100 }, { items: { i14: 1 } });
      await Promise.all([T.ok('trade.step', { id: r.id, step: 1, ov }, r.a.token), T.ok('trade.step', { id: r.id, step: 1, ov }, r.b.token)]);
      const rs = await Promise.all([T.call('trade.step', { id: r.id, step: 2, ov }, r.a.token), T.call('trade.step', { id: r.id, step: 2, ov }, r.b.token),
        T.call('trade.step', { id: r.id, step: 2, ov }, r.a.token), T.call('trade.step', { id: r.id, step: 2, ov }, r.b.token)]);
      assert.deepEqual(rs.map((x) => x.status), [200, 200, 200, 200]);
      const sa = await T.stateOf(r.a), sb = await T.stateOf(r.b);
      assert.deepEqual([sa.coins, sa.inv, sb.coins, sb.inv], [200, { i14: 1, i17: 1 }, 150, { i17: 2 }]);
      assert.equal((await T.ok('poll', {}, r.a.token)).rev, 1);
      assert.equal((await T.ok('poll', {}, r.b.token)).rev, 1);
    });
    it('stops and resets when a player no longer has what they offered', async () => {
      const r = await T.room({ coins: 300, inv: { i17: 3 } }, { coins: 50 });
      const ov = await offers(r, { items: { i17: 2 } }, { coins: 50 });
      await T.ok('trade.step', { id: r.id, step: 1, ov }, r.a.token);
      await T.ok('trade.step', { id: r.id, step: 1, ov }, r.b.token);
      await T.ok('trade.step', { id: r.id, step: 2, ov }, r.a.token);
      await T.ok('sync', { rev: 0, state: { coins: 500, inv: { i17: 1 } } }, r.a.token);       // a sold two of the three elsewhere
      const res = await status(409, 'trade.step', { id: r.id, step: 2, ov }, r.b.token);
      assert.equal(res.error, 'missing');
      assert.match(res.message, /other player/);
      assert.deepEqual([res.trade.me.step, res.trade.them.step, res.trade.status], [0, 0, 'open']);
      assert.equal((await T.stateOf(r.b)).coins, 50);
      const mine = await status(409, 'trade.step', { id: r.id, step: 1, ov }, r.a.token);
      assert.match(mine.message, /You no longer/);
    });
    it('leaving ends the trade for both and frees them for the next one', async () => {
      const r = await T.room({ coins: 300 }, { coins: 50 });
      await offers(r, { coins: 10 }, { coins: 5 });
      const left = (await T.ok('trade.cancel', { id: r.id }, r.b.token)).trade;
      assert.deepEqual([left.status, left.endedBy], ['cancelled', 'me']);
      const p = await T.ok('poll', { trade: { id: r.id, ver: 0 } }, r.a.token);
      assert.deepEqual([p.trade.status, p.trade.endedBy, p.open], ['cancelled', 'them', null]);
      assert.equal((await T.stateOf(r.a)).coins, 300);
      const next = await T.ok('trade.request', { to: r.b.id }, r.a.token);
      assert.equal(next.trade.status, 'pending');
    });
    it('cannot be cancelled once it is done', async () => {
      const r = await T.room({ coins: 300 }, { coins: 50 });
      const ov = await offers(r, { coins: 10 }, { coins: 5 });
      for (const s of [1, 2]) { await T.ok('trade.step', { id: r.id, step: s, ov }, r.a.token); await T.ok('trade.step', { id: r.id, step: s, ov }, r.b.token); }
      assert.equal((await status(409, 'trade.cancel', { id: r.id }, r.a.token)).error, 'done');
      assert.equal((await T.stateOf(r.a)).coins, 295);
    });
  });

  describe('a finished trade and the saved game', () => {
    const swap = async (seedA, seedB, ao, bo) => {
      const r = await T.room(seedA, seedB);
      await T.ok('trade.offer', Object.assign({ id: r.id }, ao), r.a.token);
      const ov = (await T.ok('trade.offer', Object.assign({ id: r.id }, bo), r.b.token)).trade.ov;
      for (const s of [1, 2]) { await T.ok('trade.step', { id: r.id, step: s, ov }, r.a.token); await T.ok('trade.step', { id: r.id, step: s, ov }, r.b.token); }
      return r;
    };
    it('books the trade on top of what the page saved meanwhile, exactly once', async () => {
      const r = await swap({ coins: 300, inv: { i17: 3 } }, { coins: 50, inv: { i14: 1 } }, { items: { i17: 2 } }, { items: { i14: 1 }, coins: 20 });
      // a kept opening chests on its page: one more card, some coins from a sale
      const s = await T.ok('sync', { rev: 0, state: { coins: 310, inv: { i17: 3, i20: 1 }, opened: 2 } }, r.a.token);
      assert.equal(s.rev, 2);
      assert.deepEqual(s.trades, [{ id: r.id, rev: 1, give: { items: { i17: 2 }, coins: 0 }, get: { items: { i14: 1 }, coins: 20 } }]);
      const st = await T.stateOf(r.a);
      assert.deepEqual([st.coins, st.inv, st.opened], [330, { i14: 1, i17: 1, i20: 1 }, 2]);
      const next = await T.ok('sync', { rev: 2, state: st }, r.a.token);
      assert.equal(next.trades, undefined);
      assert.deepEqual((await T.stateOf(r.a)).inv, { i14: 1, i17: 1, i20: 1 });
    });
    it('hands the stored game to a page that is behind for another reason', async () => {
      const r = await swap({ coins: 300 }, { coins: 50 }, { coins: 100 }, { coins: 1 });
      const other = await T.ok('login', { name: r.a.name, pass: r.a.pass });       // a second device takes the stored game ...
      await T.ok('sync', { rev: other.rev, state: Object.assign(other.state, { coins: 1000 }) }, other.token);     // ... and saves
      const res = await status(409, 'sync', { rev: 0, state: { coins: 300 } }, r.a.token);
      assert.equal(res.error, 'conflict');
      assert.equal(res.state.coins, 1000);
      assert.equal(res.rev, 2);
    });
    it('books several trades in order', async () => {
      const a = await T.player({ coins: 100, inv: { i17: 4 } }), b = await T.player({ coins: 100 }), c = await T.player({ inv: { i0: 1 } });
      const run = async (x, y, xo, yo) => {
        const t = (await T.ok('trade.request', { to: y.id }, x.token)).trade;
        await T.ok('trade.respond', { id: t.id, accept: true }, y.token);
        await T.ok('trade.offer', Object.assign({ id: t.id }, xo), x.token);
        const ov = (await T.ok('trade.offer', Object.assign({ id: t.id }, yo), y.token)).trade.ov;
        for (const s of [1, 2]) { await T.ok('trade.step', { id: t.id, step: s, ov }, x.token); await T.ok('trade.step', { id: t.id, step: s, ov }, y.token); }
        return t.id;
      };
      const t1 = await run(a, b, { items: { i17: 1 } }, { coins: 30 });
      const t2 = await run(c, a, { items: { i0: 1 } }, { coins: 130 });
      const s = await T.ok('sync', { rev: 0, state: { coins: 100, inv: { i17: 4 } } }, a.token);
      assert.deepEqual(s.trades.map((t) => t.id), [t1, t2]);
      assert.equal(s.rev, 3);
      assert.deepEqual(await T.stateOf(a).then((x) => [x.coins, x.inv]), [0, { i0: 1, i17: 3 }]);
    });
    it('never creates or loses coins and cards, whatever is traded', async () => {
      const seeds = [{ coins: 5000, inv: { i0: 2, i7: 5, i17: 9 } }, { coins: 800, inv: { i3: 1, i14: 4, i17: 2 } }, { coins: 0, inv: { i20: 6, i7: 1 } }];
      const ps = [];
      for (const s of seeds) ps.push(await T.player(s));
      const total = async () => {
        const sum = { coins: 0 };
        for (const p of ps) { const s = await T.stateOf(p); sum.coins += s.coins; for (const id of Object.keys(s.inv)) sum[id] = (sum[id] || 0) + s.inv[id]; }
        return sum;
      };
      const before = await total();
      let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
      const pick = (s) => {
        const o = { items: {}, coins: s.coins ? rnd(s.coins + 1) : 0 };
        for (const id of Object.keys(s.inv)) { const n = rnd(s.inv[id] + 1); if (n) o.items[id] = n; }
        return o;
      };
      let done = 0;
      for (let i = 0; i < 12; i++) {
        const x = ps[rnd(3)], y = ps.filter((p) => p !== x)[rnd(2)];
        const t = (await T.ok('trade.request', { to: y.id }, x.token)).trade;
        await T.ok('trade.respond', { id: t.id, accept: true }, y.token);
        await T.ok('trade.offer', Object.assign({ id: t.id }, pick(await T.stateOf(x))), x.token);
        const ov = (await T.ok('trade.offer', Object.assign({ id: t.id }, pick(await T.stateOf(y))), y.token)).trade.ov;
        const first = await T.call('trade.step', { id: t.id, step: 1, ov }, x.token);
        if (first.status !== 200) { assert.equal(first.body.error, 'empty'); await T.ok('trade.cancel', { id: t.id }, x.token); continue; }
        await T.ok('trade.step', { id: t.id, step: 1, ov }, y.token);
        await T.ok('trade.step', { id: t.id, step: 2, ov }, y.token);
        await T.ok('trade.step', { id: t.id, step: 2, ov }, x.token);
        done++;
      }
      assert.ok(done >= 8);
      assert.deepEqual(await total(), before);
    });
    it('lists finished trades in the history, newest first', async () => {
      const r = await swap({ coins: 300 }, { coins: 50 }, { coins: 100 }, { coins: 1 });
      const t2 = (await T.ok('trade.request', { to: r.b.id }, r.a.token)).trade;
      await T.ok('trade.respond', { id: t2.id, accept: false }, r.b.token);
      const pending = (await T.ok('trade.request', { to: r.b.id }, r.a.token)).trade;
      const h = (await T.ok('trade.history', {}, r.a.token)).trades;
      assert.deepEqual(h.map((t) => [t.id, t.status]), [[t2.id, 'declined'], [r.id, 'done']]);
      assert.deepEqual(h[1].me.offer, { items: {}, coins: 100 });
      assert.deepEqual(h[1].them.offer, { items: {}, coins: 1 });
      assert.equal(h[1].with.name, r.b.name);
      assert.ok(!h.some((t) => t.id === pending.id));
      const hb = (await T.ok('trade.history', {}, r.b.token)).trades;
      assert.deepEqual(hb[1].me.offer, { items: {}, coins: 1 });
    });
  });

  describe('the heartbeat', () => {
    it('sends the room only when it changed', async () => {
      const { a, b, id } = await T.room({ coins: 30 }, { coins: 5 });
      const first = await T.ok('poll', { trade: { id, ver: -1 } }, a.token);
      assert.equal(first.trade.id, id);
      assert.deepEqual(first.open, { id, ver: first.trade.ver, with: { id: b.id, name: b.name, online: true } });
      const quiet = await T.ok('poll', { trade: { id, ver: first.trade.ver } }, a.token);
      assert.equal(quiet.trade, undefined);
      await T.ok('trade.offer', { id, coins: 5 }, b.token);
      const changed = await T.ok('poll', { trade: { id, ver: first.trade.ver } }, a.token);
      assert.equal(changed.trade.them.offer.coins, 5);
      assert.equal(changed.open.ver, changed.trade.ver);
    });
    it('does not show trades of other players', async () => {
      const { id } = await T.room({}, {});
      const c = await T.player();
      const p = await T.ok('poll', { trade: { id, ver: -1 } }, c.token);
      assert.equal(p.trade.status, 'gone');
      assert.deepEqual([p.inbox, p.sent, p.open], [[], [], null]);
    });
    it('tells the page when the saved game moved on', async () => {
      const p = await T.player();
      assert.equal((await T.ok('poll', {}, p.token)).rev, 0);
      await T.ok('sync', { rev: 0, state: { coins: 1 } }, p.token);
      assert.equal((await T.ok('poll', {}, p.token)).rev, 1);
    });
  });

  describe('mutations', () => {
    it('keeps mutated cards in a saved game and drops what does not exist', async () => {
      const p = await T.player();
      await T.ok('sync', { rev: 0, state: { inv: { i17: 1, i17_gold: 2, i3_rainbow: 1, i17_nope: 3, i99_gold: 1, i17_gold_gold: 1 } } }, p.token);
      const s = await T.stateOf(p);
      assert.deepEqual(s.inv, { i17: 1, i17_gold: 2, i3_rainbow: 1 });
      assert.deepEqual(Object.keys(s.found).sort(), ['i17', 'i17_gold', 'i3_rainbow']);
    });
    it('values a mutated card at its multiple in a trade', () => {
      const { offerValue, ITEMS, MUTATIONS } = require('../server/items');
      assert.equal(offerValue({ items: { i17_gold: 1, i17: 1 }, coins: 5 }), 10 * 2 + 10 + 5);
      assert.equal(ITEMS.i0_rainbow.sell, 10000 * 30);
      assert.equal(Object.keys(ITEMS).length, 26 * (1 + Object.keys(MUTATIONS).length));
    });
    it('trades them like any other card', async () => {
      const { a, b, id } = await T.room({ inv: { i17_lava: 1 } }, { coins: 50 });
      await T.ok('trade.offer', { id, items: { i17_lava: 1 } }, a.token);
      const t = (await T.ok('trade.offer', { id, coins: 30 }, b.token)).trade;
      for (const step of [1, 2]) for (const who of [a, b]) await T.ok('trade.step', { id, step, ov: t.ov }, who.token);
      assert.deepEqual((await T.stateOf(b)).inv, { i17_lava: 1 });
      assert.equal((await T.stateOf(a)).coins, 30);
    });
  });

  describe('announcements', () => {
    it('tells everybody else about an epic, once', async () => {
      const a = await T.player(), b = await T.player();
      const p0 = await T.ok('poll', {}, b.token);
      assert.deepEqual(p0.feed, []);
      assert.equal(typeof p0.feedAt, 'number');
      await T.ok('announce', { item: 'i3' }, a.token);
      const p1 = await T.ok('poll', { feed: p0.feedAt }, b.token);
      assert.deepEqual(p1.feed.map((f) => [f.name, f.item]), [[a.name, 'i3']]);
      assert.ok(p1.feedAt > p0.feedAt);
      assert.deepEqual((await T.ok('poll', { feed: p1.feedAt }, b.token)).feed, []);
      const own = await T.ok('poll', { feed: p0.feedAt }, a.token);
      assert.deepEqual(own.feed, []);                       // nobody is told about their own pull
      assert.equal(own.feedAt, p1.feedAt);
    });
    it('does not replay old announcements to a page that just opened', async () => {
      const a = await T.player(), b = await T.player();
      await T.ok('announce', { item: 'i0' }, a.token);
      assert.deepEqual((await T.ok('poll', {}, b.token)).feed, []);
    });
    it('is for the big pulls only', async () => {
      const a = await T.player();
      for (const item of ['i17', 'i7', 'i17_gold', 'i17_neon', 'nope', '', null]) await status(400, 'announce', { item }, a.token);
      for (const item of ['i25', 'i1', 'i17_diamond', 'i17_rainbow']) await status(200, 'announce', { item }, a.token);
    });
    it('stops a flood', async () => {
      const a = await T.player();
      for (let i = 0; i < 8; i++) await status(200, 'announce', { item: 'i3' }, a.token);
      await status(429, 'announce', { item: 'i3' }, a.token);
    });
  });

  describe('Rugpull and Rocket on the server', () => {
    const crash = require('../server/crash');
    const CrashMath = require('../server/crashmath');
    const rocket = CrashMath.games.rocket.path();
    const T0 = 1700000000000;
    let now = T0;
    const msTo = (m, path) => Math.ceil((path || rocket).timeAt(m) * 1000);
    before(() => { crash.hooks.now = () => now; });
    after(() => { crash.hooks.now = () => Date.now(); crash.hooks.roll = null; });
    const start = async (p, roll, opt) => {
      crash.hooks.roll = () => roll; now = T0;
      return T.ok('crash.bet', Object.assign({ game: 'rocket', bet: 200, auto: 0, startIn: 5000 }, opt), p.token);
    };

    it('takes the bet from the saved game and does not say where the round ends', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 3);
      assert.equal(r.rev, 1);
      assert.deepEqual(r.book, [{ rev: 1, coins: -200, wager: 200, won: 0, mult: 0, why: 'bet' }]);
      assert.deepEqual([r.round.game, r.round.bet, r.round.status, r.round.startIn], ['rocket', 200, 'live', 5000]);
      assert.ok(!('crash' in r.round) && !('crashIn' in r.round), 'the end of a running round is not sent');
      const s = await T.stateOf(p);
      assert.deepEqual([s.coins, s.stats.wagered], [800, 200]);
      const live = await T.ok('crash.state', {}, p.token);
      assert.equal(live.rounds.length, 1);
      assert.ok(!JSON.stringify(live).includes('crash'), 'not after a reload either');
    });
    it('pays a cash-out at the multiplier of the server clock', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 3);
      now = T0 + 5000 + msTo(2);
      const c = await T.ok('crash.cashout', { id: r.round.id }, p.token);
      assert.deepEqual([c.round.status, c.round.mult, c.round.paid, c.round.crash], ['cashed', 2, 400, 3]);
      assert.ok(c.round.crashIn > 0, 'the page is told how long the chart keeps climbing');
      assert.deepEqual(c.book, [{ rev: 2, coins: 400, wager: 0, won: 400, mult: 2, why: 'cashout' }]);
      const s = await T.stateOf(p);
      assert.deepEqual([s.coins, s.stats.won, s.stats.bestWin, s.stats.bestMult], [1200, 400, 400, 2]);
      const again = await T.ok('crash.cashout', { id: r.round.id }, p.token);
      assert.deepEqual([again.book, again.round.paid], [[], 400], 'a second cash-out pays nothing');
      assert.equal((await T.stateOf(p)).coins, 1200);
    });
    it('is too late once the round has ended, however the page asks', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 3);
      now = T0 + 5000 + msTo(3);
      const c = await T.ok('crash.cashout', { id: r.round.id }, p.token);
      assert.deepEqual([c.round.status, c.round.crash, c.book], ['rugged', 3, []]);
      assert.equal((await T.stateOf(p)).coins, 800);
      await status(400, 'crash.cashout', { id: r.round.id, at: 2, mult: 2, now: T0 }, p.token).catch(() => {});
      assert.equal((await T.stateOf(p)).coins, 800);
    });
    it('cannot cash out before the round has started', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 3);
      now = T0 + 4999;
      assert.equal((await status(409, 'crash.cashout', { id: r.round.id }, p.token)).error, 'early');
    });
    it('ends some rounds at 1.00 before anybody can get out', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 1);
      now = T0 + 5000;
      assert.equal((await T.ok('crash.cashout', { id: r.round.id }, p.token)).round.status, 'rugged');
    });
    it('pays an auto cash-out even when the page is gone', async () => {
      const p = await T.player({ coins: 1000 });
      await start(p, 3, { auto: 1.5 });
      now = T0 + 3600000;
      const me = await T.ok('me', { rev: 1 }, p.token);
      assert.equal(me.rev, 2);
      assert.equal(me.state.coins, 800 + 300);
      assert.deepEqual((await T.ok('crash.state', {}, p.token)).rounds, []);
    });
    it('an auto cash-out at the very end still wins, one above it loses', async () => {
      const a = await T.player({ coins: 1000 }), b = await T.player({ coins: 1000 });
      const ra = await start(a, 3, { auto: 3 }), rb = await start(b, 3, { auto: 3.01 });
      now = T0 + 5000 + msTo(3) + 1;
      assert.deepEqual([(await T.ok('crash.wait', { id: ra.round.id }, a.token)).round.status, (await T.ok('crash.wait', { id: rb.round.id }, b.token)).round.status], ['cashed', 'rugged']);
      assert.deepEqual([(await T.stateOf(a)).coins, (await T.stateOf(b)).coins], [1400, 800]);
    });
    it('lets the auto cash-out be changed only to a point not passed yet', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 10, { auto: 5 });
      now = T0 + 5000 + msTo(2);
      assert.equal((await status(409, 'crash.auto', { id: r.round.id, auto: 1.5 }, p.token)).error, 'late');
      assert.equal((await T.ok('crash.auto', { id: r.round.id, auto: 2.5 }, p.token)).round.auto, 2.5);
      now = T0 + 5000 + msTo(2.5);
      const c = await T.ok('crash.cashout', { id: r.round.id }, p.token);
      assert.deepEqual([c.round.status, c.round.mult, c.round.paid], ['cashed', 2.5, 500]);
    });
    it('gives the bet back when it is cancelled before the start, not after', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 3);
      now = T0 + 2000;
      const c = await T.ok('crash.cancel', { id: r.round.id }, p.token);
      assert.deepEqual([c.round.status, c.book[0].coins, c.book[0].wager], ['cancelled', 200, -200]);
      const s = await T.stateOf(p);
      assert.deepEqual([s.coins, s.stats.wagered || 0], [1000, 0]);
      const r2 = await start(p, 3);
      now = T0 + 5000;
      assert.equal((await status(409, 'crash.cancel', { id: r2.round.id }, p.token)).error, 'started');
    });
    it('runs one round per game at a time, and both games side by side', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 3);
      assert.equal((await status(409, 'crash.bet', { game: 'rocket', bet: 10, startIn: 0 }, p.token)).error, 'busy');
      const rug = await T.ok('crash.bet', { game: 'rug', bet: 10, startIn: 0 }, p.token);
      assert.equal(rug.round.game, 'rug');
      const path = CrashMath.games.rug.path(rug.round.seed);
      now = T0 + msTo(1.5, path);
      const c = await T.ok('crash.cashout', { id: rug.round.id }, p.token);
      assert.deepEqual([c.round.status, c.round.mult, c.round.paid], ['cashed', 1.5, 15]);
      now = T0 + 5000 + msTo(3);
      assert.equal((await T.ok('crash.bet', { game: 'rocket', bet: 10, startIn: 0 }, p.token)).round.id > r.round.id, true, 'the next round can start once the last one is over');
    });
    it('only bets coins that are there and not in a trade offer', async () => {
      const p = await T.player({ coins: 100 });
      crash.hooks.roll = () => 3; now = T0;
      assert.equal((await status(409, 'crash.bet', { game: 'rug', bet: 101, startIn: 0 }, p.token)).error, 'coins');
      const { a, id } = await T.room({ coins: 100 }, {});
      await T.ok('trade.offer', { id, coins: 80 }, a.token);
      const no = await status(409, 'crash.bet', { game: 'rug', bet: 21, startIn: 0 }, a.token);
      assert.deepEqual([no.error, no.coins], ['coins', 20]);
      await T.ok('crash.bet', { game: 'rug', bet: 20, startIn: 0 }, a.token);
    });
    it('refuses nonsense and other players\' rounds', async () => {
      const p = await T.player({ coins: 100 }), q = await T.player({ coins: 100 });
      crash.hooks.roll = () => 3; now = T0;
      for (const bad of [{ game: 'nope', bet: 5 }, { game: 'rug', bet: 0 }, { game: 'rug', bet: 1.5 }, { game: 'rug', bet: '5' }, { game: 'rug', bet: -5 }, { game: 'rug', bet: 5, auto: 1.001 }, { game: 'rug', bet: 5, auto: 501 }]) {
        await status(400, 'crash.bet', bad, p.token);
      }
      assert.equal((await T.stateOf(p)).coins, 100);
      const r = await T.ok('crash.bet', { game: 'rug', bet: 5, startIn: 0 }, p.token);
      for (const op of ['crash.cashout', 'crash.cancel', 'crash.wait', 'crash.auto']) await status(404, op, { id: r.round.id, auto: 2 }, q.token);
      await status(400, 'crash.cashout', { id: 'x' }, p.token);
      await status(401, 'crash.bet', { game: 'rug', bet: 5 });
    });
    it('brings a later save from the page up to date with bet and payout', async () => {
      const p = await T.player({ coins: 1000 });
      const r = await start(p, 3);
      now = T0 + 5000 + msTo(2);
      await T.ok('crash.cashout', { id: r.round.id }, p.token);
      // the page never saw the two answers and still holds rev 0 with 1000 coins and a card it pulled meanwhile
      const s = await T.ok('sync', { rev: 0, state: { coins: 1000, inv: { i17: 1 } } }, p.token);
      assert.equal(s.rev, 3);
      assert.deepEqual(s.coins.map((e) => [e.rev, e.coins, e.why]), [[1, -200, 'bet'], [2, 400, 'cashout']]);
      const st = await T.stateOf(p);
      assert.deepEqual([st.coins, st.inv], [1200, { i17: 1 }]);
    });
    it('still treats a save from another device as a conflict', async () => {
      const p = await T.player({ coins: 1000 });
      await T.ok('sync', { rev: 0, state: { coins: 900 } }, p.token);
      await start(p, 3);
      const r = await status(409, 'sync', { rev: 0, state: { coins: 5000 } }, p.token);
      assert.deepEqual([r.error, r.rev, r.state.coins], ['conflict', 2, 700]);
    });
    it('answers a waiting page the moment the round ends', async () => {
      crash.hooks.now = () => Date.now(); crash.hooks.roll = () => 1;
      const p = await T.player({ coins: 100 });
      const r = await T.ok('crash.bet', { game: 'rocket', bet: 10, startIn: 400 }, p.token);
      const t0 = Date.now();
      const w = await T.ok('crash.wait', { id: r.round.id }, p.token);
      const took = Date.now() - t0;
      assert.deepEqual([w.round.status, w.round.crash], ['rugged', 1]);
      assert.ok(took >= 300 && took < 2500, 'waited ' + took + ' ms');
      crash.hooks.now = () => now;
    });
    it('rolls ends that leave the house 3 percent', () => {
      const g = CrashMath.games.rocket, n = 200000;
      let instant = 0, over2 = 0, over10 = 0;
      for (let i = 0; i < n; i++) { const c = CrashMath.crashPoint((i + 0.5) / n, g.edge, g.max); if (c === 1) instant++; if (c >= 2) over2++; if (c >= 10) over10++; }
      // 3% end below 1.00, and with those that end before 1.01 it is 1 - 0.97 / 1.01 that show "1.00"
      assert.ok(Math.abs(instant / n - (1 - 0.97 / 1.01)) < 0.001 && Math.abs(over2 / n - 0.485) < 0.001 && Math.abs(over10 / n - 0.097) < 0.001, [instant / n, over2 / n, over10 / n].join(' '));
    });
    it('draws the same Rugpull chart from the same seed, and finds the time of a multiplier', () => {
      const a = CrashMath.games.rug.path(12345), b = CrashMath.games.rug.path(12345), c = CrashMath.games.rug.path(54321);
      assert.equal(a.multAt(17.3), b.multAt(17.3));
      assert.notEqual(a.multAt(17.3), c.multAt(17.3));
      for (const m of [1.01, 1.5, 2, 7.77, 50, 500]) assert.ok(Math.abs(a.multAt(a.timeAt(m)) - m) < 1e-6 * m, 'rug ' + m);
      for (const m of [1.01, 2, 10, 1000]) assert.ok(Math.abs(rocket.multAt(rocket.timeAt(m)) - m) < 1e-6 * m, 'rocket ' + m);
      assert.ok(a.multAt(5) > a.multAt(4.9) && a.multAt(0) === 1);
    });
  });
});
