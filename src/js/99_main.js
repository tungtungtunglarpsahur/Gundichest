// Boot ------------------------------------------------------------------------------------------------
// Loader (0 to 100%) while the chest and, on the website, the login are being fetched; then the login
// screen if nobody is logged in; then the game.
(function () {
  Store.load();
  var pctEl = $('#ld-pct'), fill = $('#ld-fill'), shown = 0, target = 0, finished = false, after = null;
  function setP(p) { target = Math.max(target, p); }
  (function anim() {
    shown += Math.max(0.004, (target - shown) * 0.16); if (shown > target) shown = target;
    var v = Math.round(shown * 100); pctEl.textContent = v + '%'; fill.style.width = v + '%';
    if (finished && v >= 100) { $('#loader').classList.add('done'); setTimeout(function () { var l = $('#loader'); if (l) l.remove(); }, 1200); after(); return; }
    requestAnimationFrame(anim);
  })();
  function enter(how) {
    GC.mode = how.mode;                                         // 'account' or 'local'
    $('#app').classList.toggle('solo', !Net.enabled);           // the single-file build has no trading
    // the save that is loaded now may carry its own settings
    var q = Store.s.settings.quality || Store.s.settings.autoQ;
    if (q && q !== Chest3D.quality) Chest3D.setQuality(q);
    Chest3D.setFast(!!Store.s.settings.fast);
    $('#app').classList.add('on'); $('#app').removeAttribute('aria-hidden');
    Chest3D.resize(); Chest3D.start();
    Net.start();
    setTimeout(function () {
      GC.ready = true;
      Upgrader.settle();
      if (how.created) UI.toast('Welcome, ' + esc(how.user.name) + '! Your account is ready.', 'win', 3200);
      else if (how.offline) UI.toast('Offline. Your progress is kept on this device and saved once the server is back.', '', 4200);
    }, 260);
  }
  UI.initShell();
  onTap($('#btnSettings'), function () { Sfx.click(); SettingsSheet.open(); });
  Inventory.init();
  Games.init();
  Trade.init();
  document.addEventListener('pointerdown', function unlock() { Sfx.unlock(); document.removeEventListener('pointerdown', unlock); }, { passive: true });

  var who = Net.enabled ? Net.resume() : Promise.resolve({ mode: 'local' });
  var assets = Chest3D.load(setP), known = false;
  who.then(function () { known = true; });
  // the chest is there but the server has not answered yet (it may be waking up): say what the wait is for
  assets.then(function () { setTimeout(function () { if (!known) $('#ld-note').textContent = 'Logging in\u2026'; }, 700); });
  Promise.all([assets, who]).then(function (res) {
    $('#ld-note').textContent = '';
    var how = res[1];
    // quality: what the player picked, else what this device settled on last time, else a guess
    var quality = Store.s.settings.quality || Store.s.settings.autoQ || ((navigator.hardwareConcurrency || 4) >= 6 || /iPhone|iPad/.test(navigator.userAgent) ? 'high' : 'mid');
    Chest3D.init($('#gl'), quality, setP);
    ChestView.init();
    $('#view-chest').classList.add('on');
    Chest3D.resize();
    // steps the effects down when the device cannot hold the frame rate (never overrides a choice made in Settings)
    var slow = 0;
    Chest3D.hooks.onFps = function (fps) {
      if (Store.s.settings.quality || UI.view !== 'chest') { slow = 0; return; }
      if (fps < (Chest3D.state === 'idle' ? 26 : 21)) slow++; else slow = 0;
      if (slow >= 2 && Chest3D.quality !== 'low') {
        var q = Chest3D.quality === 'high' ? 'mid' : 'low'; slow = 0;
        Chest3D.setQuality(q); Store.set('autoQ', q); UI.toast('Effects set to ' + q + ' for a smoother chest');
      }
    };
    window.addEventListener('resize', function () { Chest3D.resize(); });
    after = function () {
      if (how.mode === 'ask') { GC.auth = true; Auth.show(how).then(function (r) { GC.auth = false; enter(r); }); }
      else enter(how);
    };
    setP(1); finished = true;
  }).catch(function (e) {
    $('#ld-note').textContent = 'The 3D chest could not load. Check your connection and reopen the page.';
    try { console.error(e); } catch (er) {}
  });
  GC.chest = Chest3D; GC.store = Store; GC.ui = UI; GC.view = ChestView; GC.games = Games; GC.items = ITEMS; GC.roll = rollItem; GC.net = Net; GC.trade = Trade; GC.upgrader = Upgrader;
})();
