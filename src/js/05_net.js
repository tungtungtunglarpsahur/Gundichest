// Accounts and the server copy of the game. Only the website build talks to a server; the single-file
// build plays on this device alone and never comes here.
//
// How a save travels: the game changes the local save first (always), then this file sends the progress to
// the server a few seconds later. The server answers with a rev number. When the server's copy moved on
// without this page (a finished trade, or another device), the next save either gets the trades handed
// back to book locally, or the server's copy replaces the local one.
var Net = (function () {
  var BUILD = window.__GC_BUILD || { mode: 'single' };
  var enabled = BUILD.mode === 'site';
  var API = BUILD.api || 'api/rpc';
  var SKEY = 'gundichest.session.v1';
  var session = null;            // { token, user: { id, name } }
  var online = true;             // false while the server cannot be reached
  var started = false, listeners = [];
  var syncing = null, syncTimer = 0, firstDirty = 0;
  var pollTimer = 0, polling = false, pollFails = 0, lastActive = Date.now(), watch = null, lastPoll = null;

  function emit(what, data) { listeners.forEach(function (fn) { try { fn(what, data); } catch (e) { try { console.error(e); } catch (er) {} } }); }
  function saveKey(id) { return 'gundichest.u' + id + '.v1'; }
  function readSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SKEY) || 'null');
      return s && typeof s.token === 'string' && s.user && s.user.id ? s : null;
    } catch (e) { return null; }
  }
  function writeSession(s) {
    session = s;
    try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch (e) {}
  }
  function setOnline(on) {
    if (on === online) return;
    online = on; emit('online', on);
  }

  // One request. Resolves with the answer; rejects with { code, message, status, body }.
  // code 'net' = the server could not be reached at all.
  function call(op, data, opt) {
    opt = opt || {};
    var body = Object.assign({ op: op }, data || {});
    var headers = { 'content-type': 'application/json' };
    var token = opt.token || (session && session.token);
    if (token) headers.authorization = 'Bearer ' + token;
    var ctl = null, timer = 0;
    try { ctl = new AbortController(); timer = setTimeout(function () { ctl.abort(); }, opt.timeout || 15000); } catch (e) {}
    return fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(body), cache: 'no-store', signal: ctl ? ctl.signal : undefined, keepalive: !!opt.keepalive })
      .then(function (res) {
        return res.text().then(function (text) {
          clearTimeout(timer);
          var json = null;
          try { json = JSON.parse(text); } catch (e) {}
          // anything that is not our JSON (an error page, a proxy) counts as "server not reachable"
          if (!json || typeof json !== 'object') { setOnline(false); throw { code: 'net', status: res.status, message: 'The server is not answering properly right now.' }; }
          if (res.ok && json.ok !== false) { setOnline(true); return json; }
          var err = { code: json.error || 'server', status: res.status, message: json.message || 'Something went wrong.', body: json };
          if (err.code === 'db_down' || err.code === 'no_db') err.down = true;
          setOnline(!err.down);
          if (err.code === 'auth' && !opt.token && session && token === session.token) lostSession(err.message);
          throw err;
        });
      }, function () {
        clearTimeout(timer); setOnline(false);
        throw { code: 'net', status: 0, message: 'Cannot reach the server. Check your connection.' };
      });
  }
  function isDown(e) { return !!e && (e.code === 'net' || e.down); }

  // The server no longer knows this session: back to the login screen.
  function lostSession(message) {
    if (!session) return;
    writeSession(null); stop();
    try { sessionStorage.setItem('gundichest.notice', message || 'Please log in again.'); } catch (e) {}
    emit('logout');
    setTimeout(function () { location.reload(); }, 50);
  }

  // ---- saving ----------------------------------------------------------------------------------------
  // Puts the local save in line with what the server has, right after logging in or coming back.
  function reconcile(rev, state) {
    var sync = Store.sync;
    if (Store.fresh || (!sync.dirty && sync.rev !== rev)) { if (state) Store.adopt(state, rev); return Promise.resolve(); }
    if (sync.rev === rev && !sync.dirty) return Promise.resolve();
    return syncNow(true).catch(function () {});       // local changes the server has not seen: send them (or get told to drop them)
  }
  function scheduleSync(ms) {
    if (!session || !started) return;
    var now = Date.now(), idle = now - lastActive;
    if (!firstDirty) firstDirty = now;
    // a few seconds after the last change, but never more than 20 s after the first one. When nobody has touched
    // the page for a while (auto opening left running) saves get rarer, so the database can go to sleep in between.
    var cap = idle > 480000 ? 600000 : idle > 120000 ? 60000 : 20000;
    var wait = Math.max(0, Math.min(idle > 120000 ? cap : ms, firstDirty + cap - now));
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow().catch(function () {}); }, wait);
  }
  // Sends the progress if there is anything new. force also sends an unchanged save (to pick up trades).
  function syncNow(force, opt) {
    if (!session) return Promise.resolve(false);
    if (syncing) return syncing.then(function () { return Store.sync.dirty || force ? syncNow(force, opt) : true; }, function () { return syncNow(force, opt); });
    if (!force && !Store.sync.dirty) return Promise.resolve(true);
    clearTimeout(syncTimer); firstDirty = 0;
    var seq = Store.seq, rev = Store.sync.rev;
    syncing = call('sync', { rev: rev, state: Store.progress() }, opt).then(function (r) {
      syncing = null;
      (r.trades || []).forEach(function (t) { Store.applyTrade(t.give, t.get); });
      Store.markSynced(r.rev, Store.seq !== seq);
      if (r.trades && r.trades.length) emit('booked', r.trades);
      if (Store.sync.dirty) scheduleSync(4000);
      return true;
    }, function (e) {
      syncing = null;
      if (e.code === 'conflict' && e.body && e.body.state) {
        Store.adopt(e.body.state, e.body.rev);
        emit('replaced');
        return true;
      }
      if (isDown(e)) scheduleSync(15000);
      throw e;
    });
    return syncing;
  }
  // Last chance when the page is being put away: the browser finishes this request even if the page is gone.
  function flush() {
    if (!session || !started || !Store.sync.dirty || syncing) return;
    Store.saveNow();
    syncNow(false, { keepalive: true, timeout: 8000 }).catch(function () {});
  }

  // ---- the heartbeat ----------------------------------------------------------------------------------
  // How often to ask the server what is new. Slower when nobody touches the page, not at all in the background.
  function interval() {
    if (document.hidden) return 0;
    var idle = Date.now() - lastActive;
    if (watch) return idle > 600000 ? 8000 : UI.view === 'trade' ? 1500 : 4000;
    if (idle > 480000) return 0;
    if (idle > 120000) return 20000;
    return UI.view === 'trade' ? 4000 : 8000;
  }
  function loop(ms) {
    clearTimeout(pollTimer); pollTimer = 0;
    if (!session || !started) return;
    if (ms == null) { ms = interval(); if (!ms) return; if (pollFails) ms = Math.min(60000, ms * Math.pow(2, Math.min(pollFails, 4))); }
    pollTimer = setTimeout(tick, ms);
  }
  function tick() {
    pollTimer = 0;
    if (!session || !started) return;
    if (polling) return;
    polling = true;
    call('poll', watch ? { trade: watch } : {}).then(function (r) {
      polling = false; pollFails = 0; lastPoll = r;
      emit('poll', r);
      if (r.rev > Store.sync.rev && !syncing) syncNow(true).catch(function () {});          // a trade was booked, or another device saved
      else if (Store.sync.dirty && !syncTimer) scheduleSync(3000);
      loop();
    }, function (e) {
      polling = false;
      if (isDown(e)) pollFails++;
      loop();
    });
  }
  function touch() {
    var slept = !pollTimer && !polling, wasIdle = Date.now() - lastActive > 120000;
    lastActive = Date.now();
    if (slept) loop(200);
    if (wasIdle && Store.sync.dirty) scheduleSync(1500);
  }
  function start() {
    if (!enabled || !session || started) return;
    started = true;
    Store.onSave(function () { scheduleSync(6000); });
    ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, touch, { passive: true, capture: true }); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearTimeout(pollTimer); pollTimer = 0; flush(); } else { lastActive = Date.now(); loop(100); }
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', function () { loop(100); });
    UI.onView(function () { loop(UI.view === 'trade' ? 100 : null); });
    if (Store.sync.dirty) scheduleSync(1500);
    loop(300);
  }
  function stop() { started = false; clearTimeout(pollTimer); clearTimeout(syncTimer); pollTimer = syncTimer = 0; }

  // ---- logging in and out ------------------------------------------------------------------------------
  function signedIn(r) {
    writeSession({ token: r.token, user: r.user });
    Store.use(saveKey(r.user.id));
    return reconcile(r.rev, r.state).then(function () { return r.user; });
  }
  return {
    enabled: enabled,
    get user() { return session ? session.user : null; },
    get online() { return online; },
    get lastPoll() { return lastPoll; },
    on: function (fn) { listeners.push(fn); },
    call: call, isDown: isDown,

    // At page load: is there a login to pick up? Resolves with what to do next:
    //   { mode: 'account' }                     logged in (offline: true when the server could not be asked)
    //   { mode: 'ask', down: bool, notice }     show the login screen
    resume: function () {
      var notice = '';
      try { notice = sessionStorage.getItem('gundichest.notice') || ''; sessionStorage.removeItem('gundichest.notice'); } catch (e) {}
      var s = readSession();
      if (!s) return Promise.resolve({ mode: 'ask', notice: notice });
      Store.use(saveKey(s.user.id));
      return call('me', { rev: Store.fresh ? -1 : Store.sync.rev }, { timeout: 12000, token: s.token }).then(function (r) {
        session = r.user && r.user.name !== s.user.name ? { token: s.token, user: r.user } : s;
        writeSession(session);
        return reconcile(r.rev, r.state).then(function () { return { mode: 'account' }; });
      }, function (e) {
        if (isDown(e) && !Store.fresh) { session = s; return { mode: 'account', offline: true }; }       // keep playing with the save on this device
        if (!isDown(e)) writeSession(null);                 // the server does not know this login any more
        Store.use(Store.DEVICE);
        return { mode: 'ask', down: isDown(e), notice: isDown(e) ? notice : (e.code === 'auth' ? e.message : notice) };
      });
    },
    login: function (name, pass) {
      return call('login', { name: name, pass: pass }).then(signedIn);
    },
    // A new account starts with what was played on this device without one.
    register: function (name, pass) {
      var seed = Store.key === Store.DEVICE && Store.hasProgress() ? Store.progress() : null;
      return call('register', { name: name, pass: pass, seed: seed }).then(function (r) {
        if (seed) Store.adopt(null);                       // that progress now belongs to the account
        return signedIn(r);
      });
    },
    // Saves once more, ends the session and starts the page again at the login screen.
    logout: function () {
      var done = function () { writeSession(null); stop(); location.reload(); };
      var bye = function () { return call('logout', {}, { timeout: 5000 }).then(done, done); };
      return syncNow(false, { timeout: 6000 }).then(bye, bye);
    },
    deleteAccount: function (pass) {
      return call('account.delete', { pass: pass }).then(function () {
        try { localStorage.removeItem(saveKey(session.user.id)); } catch (e) {}
        writeSession(null); stop(); Store.use(Store.DEVICE); location.reload();
      });
    },
    start: start, syncNow: syncNow, flush: flush,
    // The trade room the page is in: the heartbeat then also carries its changes. null when there is none.
    watch: function (w) { var was = watch; watch = w ? { id: w.id, ver: w.ver } : null; if ((!was) !== (!watch) || (w && was && was.id !== w.id)) loop(300); },
    pollNow: function () { loop(0); },
    touch: touch
  };
})();
