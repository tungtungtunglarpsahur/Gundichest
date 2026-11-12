// Saved state (one browser, localStorage; the app works without it) ----------------------------------
var Store = (function () {
  var KEY = 'gundichest.save.v1';
  var def = function () {
    return {
      v: 1, coins: 0, inv: {}, found: {}, opened: 0,
      stats: { sold: 0, earned: 0, wagered: 0, won: 0, bestWin: 0, bestMult: 0, legend: 0, epic: 0, autoOpened: 0, autoSold: 0, autoCoins: 0 },
      settings: { quality: null, sound: true, fast: false, haptics: true, autoSell: {} },     // autoSell: item id -> true
      rugHistory: [], lastRun: null
    };
  };
  var state = def();
  var listeners = [];
  var timer = null;
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.v === 1) {
          var d = def();
          state = Object.assign(d, s);
          state.stats = Object.assign(d.stats, s.stats || {});
          state.settings = Object.assign(d.settings, s.settings || {});
          state.coins = Math.max(0, Math.floor(+state.coins || 0));
        }
      }
    } catch (e) { /* storage unavailable: keep defaults */ }
  }
  function saveNow() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function save() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; saveNow(); }, 250);
  }
  function emit(what) { listeners.forEach(function (fn) { try { fn(what); } catch (e) { try { console.error(e); } catch (er) {} } }); }
  return {
    get s() { return state; },
    load: load, save: save, saveNow: saveNow,
    on: function (fn) { listeners.push(fn); },
    addCoins: function (n, why) {
      state.coins = Math.max(0, Math.round(state.coins + n));
      if (why === 'win') { state.stats.won += n; if (n > state.stats.bestWin) state.stats.bestWin = n; }
      save(); emit('coins');
    },
    spend: function (n) {
      n = Math.round(n);
      if (n <= 0 || n > state.coins) return false;
      state.coins -= n; state.stats.wagered += n; save(); emit('coins'); return true;
    },
    grant: function (item) {
      state.inv[item.id] = (state.inv[item.id] || 0) + 1;
      var isNew = !state.found[item.id];
      state.found[item.id] = true; state.opened += 1;
      if (item.rarity === 'legendary') state.stats.legend += 1;
      if (item.rarity === 'epic') state.stats.epic += 1;
      save(); emit('inv'); return isNew;
    },
    sell: function (id, n) {
      var have = state.inv[id] || 0; n = Math.min(n, have);
      if (n <= 0) return 0;
      state.inv[id] = have - n; if (!state.inv[id]) delete state.inv[id];
      var gain = ITEM_BY_ID[id].sell * n;
      state.coins += gain; state.stats.sold += n; state.stats.earned += gain;
      save(); emit('inv'); emit('coins'); return gain;
    },
    reset: function () { state = def(); saveNow(); emit('inv'); emit('coins'); emit('settings'); },
    set: function (k, v) { state.settings[k] = v; save(); emit('settings'); }
  };
})();
