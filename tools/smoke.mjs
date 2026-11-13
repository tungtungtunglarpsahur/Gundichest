// One full pass through the API the way two players would use it: register, save, search, trade, an announcement,
// a round of Rocket, clean up.
// call(op, data, token) -> { status, body }. Used by the build check (in process) and the live check (over HTTP).
import { randomBytes } from 'node:crypto';

export async function runSmoke(call, log = () => {}, opt = {}) {
  const tag = randomBytes(4).toString('hex');
  const A = { name: 'zz_ci_a' + tag, pass: randomBytes(9).toString('base64url') };
  const B = { name: 'zz_ci_b' + tag, pass: randomBytes(9).toString('base64url') };
  const made = [];
  let step = 'start';
  const must = async (label, op, data, token, want = 200) => {
    step = label;
    const r = await call(op, data, token);
    if (r.status !== want) throw new Error(`${label}: expected HTTP ${want}, got ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    log('ok   ' + label);
    return r.body;
  };
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  try {
    const ra = await must('register first player', 'register', { ...A, seed: { coins: 500, inv: { i17: 3, i7: 1 } } });
    made.push({ ...A, token: ra.token });
    const rb = await must('register second player', 'register', { ...B, seed: { coins: 100, inv: { i14: 2 } } });
    made.push({ ...B, token: rb.token });
    A.token = ra.token; B.token = rb.token; A.id = ra.user.id; B.id = rb.user.id;
    await must('name already taken', 'register', { name: A.name.toUpperCase(), pass: 'whatever1' }, null, 409);
    await must('request without login', 'me', {}, null, 401);
    await must('wrong password', 'login', { name: A.name, pass: A.pass + 'x' }, null, 401);
    const li = await must('log in', 'login', { name: A.name, pass: A.pass });
    eq('login returns the saved game', li.state.coins, 500);
    await must('log out that session', 'logout', {}, li.token);
    await must('logged-out session is refused', 'me', {}, li.token, 401);

    const me0 = await must('who am I', 'me', { rev: 0 }, A.token);
    eq('no state when the rev matches', me0.state, undefined);
    const s1 = await must('save the game', 'sync', { rev: 0, state: { coins: 600, inv: { i17: 3, i7: 1 }, opened: 4 } }, A.token);
    eq('rev after saving', s1.rev, 1);
    await must('stale save is refused', 'sync', { rev: 0, state: { coins: 1 } }, A.token, 409);

    const found = await must('search players', 'users.search', { q: B.name.slice(0, 9) }, A.token);
    if (!found.users.some((u) => u.id === B.id)) throw new Error('search did not find the second player');
    const req = await must('ask for a trade', 'trade.request', { to: B.id }, A.token);
    const T = req.trade.id;
    const pb = await must('request shows up for the other player', 'poll', {}, B.token);
    if (!pb.inbox.some((r) => r.id === T && r.with.name === A.name)) throw new Error('request missing from the inbox');
    await must('accept the request', 'trade.respond', { id: T, accept: true }, B.token);
    const pa = await must('room is open for the first player', 'poll', { trade: { id: T, ver: -1 } }, A.token);
    eq('open trade', pa.open && pa.open.id, T);

    await must('offer more than owned', 'trade.offer', { id: T, items: { i17: 9 } }, A.token, 409);
    const oa = await must('first offer', 'trade.offer', { id: T, items: { i17: 2 }, coins: 50 }, A.token);
    const ob = await must('second offer', 'trade.offer', { id: T, items: { i14: 1 } }, B.token);
    await must('accept with an outdated offer', 'trade.step', { id: T, step: 1, ov: oa.trade.ov }, A.token, 409);
    await must('confirm before accepting', 'trade.step', { id: T, step: 2, ov: ob.trade.ov }, A.token, 409);
    await must('first accept', 'trade.step', { id: T, step: 1, ov: ob.trade.ov }, A.token);
    await must('second accept', 'trade.step', { id: T, step: 1, ov: ob.trade.ov }, B.token);
    const c1 = await must('first confirm', 'trade.step', { id: T, step: 2, ov: ob.trade.ov }, A.token);
    eq('still open after one confirm', c1.trade.status, 'open');
    const c2 = await must('second confirm', 'trade.step', { id: T, step: 2, ov: ob.trade.ov }, B.token);
    eq('trade is done', c2.trade.status, 'done');

    // the first player kept playing meanwhile: the save is taken and the trade booked on top
    const s2 = await must('save after the trade', 'sync', { rev: 1, state: { coins: 640, inv: { i17: 3, i7: 1, i20: 1 }, opened: 5 } }, A.token);
    eq('trade handed back to the page', (s2.trades || []).map((t) => t.id), [T]);
    const fa = await must('first player after the trade', 'me', { rev: -1 }, A.token);
    eq('coins of the first player', fa.state.coins, 590);
    eq('cards of the first player', fa.state.inv, { i7: 1, i14: 1, i17: 1, i20: 1 });
    const fb = await must('second player after the trade', 'me', { rev: -1 }, B.token);
    eq('coins of the second player', fb.state.coins, 150);
    eq('cards of the second player', fb.state.inv, { i14: 1, i17: 2 });
    const hist = await must('trade history', 'trade.history', {}, A.token);
    eq('history holds the trade', hist.trades.filter((t) => t.id === T).map((t) => t.status), ['done']);

    // everybody hears of a big pull, nobody of a small one
    await must('announce a big pull', 'announce', { item: 'i3_gold' }, A.token);
    const pf = await must('the other player hears of it', 'poll', { feed: pb.feedAt }, B.token);
    if (!(pf.feed || []).some((f) => f.name === A.name && f.item === 'i3_gold')) throw new Error('announcement missing from the feed');
    await must('a common is not announced', 'announce', { item: 'i17' }, A.token, 400);

    // one round of Rocket: the server takes the bet, keeps the end to itself and pays by its own clock
    const bet = await must('bet on a round of Rocket', 'crash.bet', { game: 'rocket', bet: 10, auto: 0, startIn: 0 }, A.token);
    if ('crash' in bet.round || 'crashIn' in bet.round) throw new Error('the end of a running round was sent to the page');
    eq('the bet is booked', bet.book.map((e) => e.coins), [-10]);
    await new Promise((r) => setTimeout(r, 400));
    const out = await must('cash out', 'crash.cashout', { id: bet.round.id }, A.token);
    if (out.round.status !== 'cashed' && out.round.status !== 'rugged') throw new Error('round neither paid nor over: ' + out.round.status);
    const paid = out.round.status === 'cashed' ? out.round.paid : 0;
    if (opt.wait && (out.round.status === 'rugged' || out.round.crashIn < 12000)) {
      const w0 = Date.now();
      const w = await must('the open request answers when the round ends', 'crash.wait', { id: bet.round.id }, A.token);
      eq('round as the waiting page sees it', [w.round.status, w.round.crash], [out.round.status, out.round.crash]);
      log('     waited ' + (Date.now() - w0) + ' ms for a round that had ' + Math.max(0, Math.round(out.round.crashIn)) + ' ms to go');
    }
    const s3 = await must('a save that missed the round', 'sync', { rev: s2.rev, state: fa.state }, A.token);
    eq('bet and payout handed back to the page', (s3.coins || []).map((e) => e.coins), paid ? [-10, paid] : [-10]);
    const fc = await must('first player after the round', 'me', { rev: -1 }, A.token);
    eq('coins after the round', fc.state.coins, 590 - 10 + paid);
    if (opt.wait) {
      // with a bet in play the server keeps the request open until the round is over (15 s at most per request)
      const b2 = await must('bet on a round of Rugpull', 'crash.bet', { game: 'rug', bet: 1, auto: 0, startIn: 1500 }, A.token);
      const h0 = Date.now();
      const h = await must('the server keeps a request open while the round runs', 'crash.wait', { id: b2.round.id }, A.token);
      const held = Date.now() - h0;
      if (held < 1200) throw new Error('the open request came back after ' + held + ' ms, before the round had even started');
      if (!h.live && h.round.status !== 'rugged') throw new Error('the open request came back with a round that is ' + h.round.status);
      log('     kept open for ' + held + ' ms, ' + (h.live ? 'round still running' : 'until the round ended at ' + h.round.crash + '×'));
    }
    step = 'clean up';
  } finally {
    for (const u of made) {
      try {
        const r = await call('account.delete', { pass: u.pass }, u.token);
        if (r.status !== 200) log('note: could not remove test player ' + u.name + ' (HTTP ' + r.status + ')');
      } catch (e) { log('note: could not remove test player ' + u.name + ': ' + e.message); }
    }
  }
  const gone = await call('login', { name: A.name, pass: A.pass });
  if (gone.status !== 401) throw new Error('test player still exists after cleanup (HTTP ' + gone.status + ')');
  log('ok   test players removed');
  return { players: [A.name, B.name] };
}
