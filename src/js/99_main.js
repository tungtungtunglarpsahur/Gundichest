// Boot ------------------------------------------------------------------------------------------------
(function () {
  Store.load();
  Sfx.setEnabled(Store.s.settings.sound);
  var pctEl = $('#ld-pct'), fill = $('#ld-fill'), shown = 0, target = 0, finished = false;
  function setP(p) { target = Math.max(target, p); }
  (function anim() {
    shown += Math.max(0.004, (target - shown) * 0.16); if (shown > target) shown = target;
    var v = Math.round(shown * 100); pctEl.textContent = v + '%'; fill.style.width = v + '%';
    if (finished && v >= 100) { done(); return; }
    requestAnimationFrame(anim);
  })();
  function done() {
    $('#app').classList.add('on'); $('#app').removeAttribute('aria-hidden');
    setTimeout(function () { $('#loader').classList.add('done'); GC.ready = true; }, 260);
    setTimeout(function () { var l = $('#loader'); if (l) l.remove(); }, 1200);
  }
  UI.initShell();
  onTap($('#btnSettings'), function () { Sfx.click(); SettingsSheet.open(); });
  Inventory.init();
  Games.init();
  document.addEventListener('pointerdown', function unlock() { Sfx.unlock(); document.removeEventListener('pointerdown', unlock); }, { passive: true });

  // quality: what the user picked, else what this device settled on last time, else a guess
  var quality = Store.s.settings.quality || Store.s.settings.autoQ || ((navigator.hardwareConcurrency || 4) >= 6 || /iPhone|iPad/.test(navigator.userAgent) ? 'high' : 'mid');
  Chest3D.load(setP).then(function () {
    Chest3D.init($('#gl'), quality, setP);
    ChestView.init();
    $('#view-chest').classList.add('on');
    Chest3D.resize();
    Chest3D.start();
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
    setP(1); finished = true;
  }).catch(function (e) {
    $('#ld-note').textContent = 'The 3D chest could not load. Check your connection and reopen the page.';
    try { console.error(e); } catch (er) {}
  });
  GC.chest = Chest3D; GC.store = Store; GC.ui = UI; GC.view = ChestView; GC.games = Games; GC.items = ITEMS; GC.roll = rollItem;
})();
