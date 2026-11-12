// One full pass through the API the way two players would use it: register, save, search, trade, clean up.
// call(op, data, token) -> { status, body }. Used by the build check (in process) and the live check (over HTTP).
import { randomBytes } from 'node:crypto';

export async function runSmoke(call, log = () => {}) {
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
