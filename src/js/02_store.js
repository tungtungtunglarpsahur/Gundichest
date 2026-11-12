// Saved game. It lives in this browser (localStorage); with an account the progress part is also kept on
// the server (see 05_net.js). One save per player on this device: the device's own save for playing without
// an account, and one per account that has logged in here.
var Store = (function () {
  var DEVICE = 'gundichest.save.v1';
  var key = DEVICE;
  var def = function () {
    return {
      v: 1, coins: 0, inv: {}, found: {}, opened: 0,
      stats: { sold: 0, earned: 0, wagered: 0, won: 0, bestWin: 0, bestMult: 0, legend: 0, epic: 0, autoOpened: 0, autoSold: 0, autoCoins: 0, upTried: 0, upWon: 0, traded: 0 },
      settings: { quality: null, snd: false, fast: false, haptics: true, autoSell: {} },     // autoSell: item id -> true
      rugHistory: [], lastRun: null,
      sync: { rev: 0, dirty: false }           // account saves only: the server rev this save agrees with
    };
  };
  var PROGRESS = ['coins', 'inv', 'found', 'opened', 'stats', 'rugHistory'];      // what an account stores on the server
  var state = def();
  var listeners = [], saveListeners = [];
  var timer = null, fresh = true, seq = 0;
  var held = { items: {}, coins: 0 };          // what an open trade offer holds back: not for selling, betting or upgrading

  function read(k) {
    try {
      var raw = localStorage.getItem(k);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      var d = def(), out = Object.assign(d, s);
      out.stats = Object.assign(def().stats, s.stats || {});
      out.settings = Object.assign(def().settings, s.settings || {});
      out.sync = Object.assign(def().sync, s.sync || {});
      out.coins = Math.max(0, Math.floor(+out.coins || 0));
      if (!out.inv || typeof out.inv !== 'object') out.inv = {};
      if (!out.found || typeof out.found !== 'object') out.found = {};
      Object.keys(out.inv).forEach(function (id) { if (!ITEM_BY_ID[id] || !(out.inv[id] > 0)) delete out.inv[id]; });
      return out;
    } catch (e) { return null; }           // storage unavailable or unreadable: start from defaults
  }
  function persist() {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function saveNow() { clearTimeout(timer); timer = null; persist(); }
  // Every change of the game ends here: written to this device shortly after, and reported to whoever keeps a copy.
  function save() {
    seq++; state.sync.dirty = true;
    if (!timer) timer = setTimeout(function () { timer = null; persist(); }, 250);
    saveListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function emit(what) { listeners.forEach(function (fn) { try { fn(what); } catch (e) { try { console.error(e); } catch (er) {} } }); }
  function emitAll() { emit('inv'); emit('coins'); emit('settings'); }
  function free(id) { return Math.max(0, (state.inv[id] || 0) - (held.items[id] || 0)); }
  function avail() { return Math.max(0, state.coins - held.coins); }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }

  return {
    get s() { return state; },
    get key() { return key; },
    get seq() { return seq; },
    get sync() { return state.sync; },
    get fresh() { return fresh; },               // true when this save was just created (nothing was stored under its key)
    DEVICE: DEVICE,
    load: function () { var s = read(key); fresh = !s; state = s || def(); },
    // Switches to another save. A save that does not exist yet starts empty, with this device's settings.
    use: function (newKey) {
      if (newKey === key) return;
      saveNow();
      var settings = copy(state.settings);
      key = newKey; held = { items: {}, coins: 0 };
      var s = read(key); fresh = !s;
      state = s || def();
      if (fresh) state.settings = Object.assign(def().settings, settings);
      emitAll();
    },
    save: save, saveNow: saveNow,
    on: function (fn) { listeners.push(fn); },
    onSave: function (fn) { saveListeners.push(fn); },

    // ---- the part an account keeps on the server ----
    progress: function () { var p = {}; PROGRESS.forEach(function (k) { p[k] = copy(state[k]); }); return p; },
    hasProgress: function () { return state.opened > 0 || state.coins > 0 || Object.keys(state.inv).length > 0; },
    // Replaces the progress with a copy from the server; settings stay as they are on this device.
    adopt: function (p, rev) {
      var d = def();
      PROGRESS.forEach(function (k) { state[k] = p && p[k] != null ? copy(p[k]) : d[k]; });
      state.stats = Object.assign(d.stats, state.stats);
      state.coins = Math.max(0, Math.floor(+state.coins || 0));
      if (rev != null) state.sync = { rev: rev, dirty: false };
      seq++; saveNow(); emitAll();
    },
    markSynced: function (rev, dirty) { state.sync = { rev: rev, dirty: !!dirty }; persist(); },
    // Books a finished trade: what was given leaves, what was received arrives. The server has booked the same.
    applyTrade: function (give, get) {
      state.coins = Math.max(0, state.coins - (give.coins || 0)) + (get.coins || 0);
      Object.keys(give.items || {}).forEach(function (id) {
        var left = Math.max(0, (state.inv[id] || 0) - give.items[id]);
        if (left) state.inv[id] = left; else delete state.inv[id];
      });
      Object.keys(get.items || {}).forEach(function (id) {
        if (!ITEM_BY_ID[id]) return;
        state.inv[id] = (state.inv[id] || 0) + get.items[id]; state.found[id] = true;
      });
      state.stats.traded = (state.stats.traded || 0) + 1;
      persist(); emit('inv'); emit('coins');
    },

    // ---- what a trade offer holds back ----
    hold: function (offer) {
      var next = { items: Object.assign({}, (offer && offer.items) || {}), coins: (offer && offer.coins) || 0 };
      if (JSON.stringify(next) === JSON.stringify(held)) return;
      held = next; emit('inv'); emit('coins');
    },
    get held() { return held; },
    free: free, avail: avail,

    addCoins: function (n, why) {
      state.coins = Math.max(0, Math.round(state.coins + n));
      if (why === 'win') { state.stats.won += n; if (n > state.stats.bestWin) state.stats.bestWin = n; }
      save(); emit('coins');
    },
    spend: function (n) {
      n = Math.round(n);
      if (n <= 0 || n > avail()) return false;
      state.coins -= n; state.stats.wagered += n; save(); emit('coins'); return true;
    },
    // A card from a chest.
    grant: function (item) {
      state.inv[item.id] = (state.inv[item.id] || 0) + 1;
      var isNew = !state.found[item.id];
      state.found[item.id] = true; state.opened += 1;
      if (item.rarity === 'legendary') state.stats.legend += 1;
      if (item.rarity === 'epic') state.stats.epic += 1;
      save(); emit('inv'); return isNew;
    },
    // A card from anywhere else (an upgrade): no chest is counted. Returns true when the card is new for the index.
    give: function (id, n) {
      var isNew = !state.found[id];
      state.inv[id] = (state.inv[id] || 0) + (n || 1); state.found[id] = true;
      save(); emit('inv'); return isNew;
    },
    // Removes cards that are not held by a trade. Returns how many were taken.
    take: function (id, n) {
      n = Math.min(n, free(id));
      if (n <= 0) return 0;
      state.inv[id] -= n; if (!state.inv[id]) delete state.inv[id];
      save(); emit('inv'); return n;
    },
    sell: function (id, n) {
      n = Math.min(n, free(id));
      if (n <= 0) return 0;
      state.inv[id] -= n; if (!state.inv[id]) delete state.inv[id];
      var gain = ITEM_BY_ID[id].sell * n;
      state.coins += gain; state.stats.sold += n; state.stats.earned += gain;
      save(); emit('inv'); emit('coins'); return gain;
    },
    // Starts the game over. Settings stay; an account keeps its place in line with the server.
    reset: function () {
      var d = def(); d.settings = state.settings; d.sync = { rev: state.sync.rev, dirty: true };
      state = d; held = { items: {}, coins: 0 }; seq++; saveNow();
      saveListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
      emitAll();
    },
    set: function (k, v) { state.settings[k] = v; save(); emit('settings'); }
  };
})();
