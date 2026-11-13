// The saved game of a player as the server understands it: coins and cards matter for trading,
// the rest is kept for the player and only checked for shape and size.
const { ITEMS } = require('./items');
const { int, isObj } = require('./util');

const STAT_KEYS = ['sold', 'earned', 'wagered', 'won', 'bestWin', 'bestMult', 'legend', 'epic', 'autoOpened', 'autoSold', 'autoCoins', 'upTried', 'upWon', 'traded'];
const MAX_COINS = 1e12, MAX_COUNT = 1e6;

function cleanState(x) {
  const s = isObj(x) ? x : {};
  const out = { coins: int(s.coins, 0, MAX_COINS, 0), inv: {}, found: {}, opened: int(s.opened, 0, 1e9, 0), stats: {}, rugHistory: [] };
  if (isObj(s.inv)) for (const id of Object.keys(ITEMS)) { const n = int(s.inv[id], 0, MAX_COUNT, 0); if (n > 0) out.inv[id] = n; }
  if (isObj(s.found)) for (const id of Object.keys(ITEMS)) if (s.found[id]) out.found[id] = true;
  for (const id of Object.keys(out.inv)) out.found[id] = true;
  if (isObj(s.stats)) for (const k of STAT_KEYS) {
    const v = Number(s.stats[k]);
    if (Number.isFinite(v) && v > 0) out.stats[k] = Math.min(1e15, k === 'bestMult' ? Math.round(v * 100) / 100 : Math.floor(v));
  }
  if (Array.isArray(s.rugHistory)) out.rugHistory = s.rugHistory.slice(-20).map(Number).filter((v) => Number.isFinite(v) && v >= 0 && v < 1e9).map((v) => Math.round(v * 100) / 100);
  return out;
}
// One side of a trade: {"items": {"i3": 2}, "coins": 150}
function cleanOffer(x) {
  const o = isObj(x) ? x : {};
  const out = { items: {}, coins: int(o.coins, 0, MAX_COINS, 0) };
  if (isObj(o.items)) for (const id of Object.keys(ITEMS)) { const n = int(o.items[id], 0, MAX_COUNT, 0); if (n > 0) out.items[id] = n; }
  return out;
}
function sameOffer(a, b) {
  if ((a.coins || 0) !== (b.coins || 0)) return false;
  const ka = Object.keys(a.items || {}), kb = Object.keys(b.items || {});
  return ka.length === kb.length && ka.every((id) => a.items[id] === (b.items || {})[id]);
}
const isEmptyOffer = (o) => !(o && (o.coins > 0 || Object.keys(o.items || {}).length));
// Does this saved game hold everything in the offer?
function covers(state, offer) {
  if ((state.coins || 0) < (offer.coins || 0)) return false;
  for (const id of Object.keys(offer.items || {})) if (((state.inv || {})[id] || 0) < offer.items[id]) return false;
  return true;
}
// Books one side of a finished trade: what was given leaves, what was received arrives.
function applyTrade(state, give, get) {
  state.coins = Math.min(MAX_COINS, Math.max(0, (state.coins || 0) - (give.coins || 0)) + (get.coins || 0));
  for (const id of Object.keys(give.items || {})) {
    const left = Math.max(0, (state.inv[id] || 0) - give.items[id]);
    if (left) state.inv[id] = left; else delete state.inv[id];
  }
  for (const id of Object.keys(get.items || {})) {
    state.inv[id] = Math.min(MAX_COUNT, (state.inv[id] || 0) + get.items[id]);
    state.found[id] = true;
  }
  state.stats.traded = (state.stats.traded || 0) + 1;
  return state;
}

// Books coins the server moved itself (a bet, a payout): {coins: -50, wager: 50} or {coins: 120, won: 120, mult: 2.4}.
function applyCoins(state, e) {
  state.coins = Math.min(MAX_COINS, Math.max(0, (state.coins || 0) + (e.coins || 0)));
  const st = state.stats || (state.stats = {});
  if (e.wager) st.wagered = Math.max(0, (st.wagered || 0) + e.wager);
  if (e.won) { st.won = (st.won || 0) + e.won; if (e.won > (st.bestWin || 0)) st.bestWin = e.won; }
  if (e.mult && e.mult > (st.bestMult || 0)) st.bestMult = e.mult;
  return state;
}

module.exports = { cleanState, cleanOffer, sameOffer, isEmptyOffer, covers, applyTrade, applyCoins, STAT_KEYS, MAX_COINS };
