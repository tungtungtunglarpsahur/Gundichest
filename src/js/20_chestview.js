// Chest screen: OPEN flow, reveal card, legendary banner, auto opening --------------------------------
var ChestView = (function () {
  var busy = false, current = null, demo = false, revealShown = false, revealReady = false, revealSeq = 0, bannerTimer = 0, skipTimer = 0;
  var uiHome = null, dockH = 0;
  // auto opening: opens chest after chest, keeps or sells each pull by the rules picked when it was switched on
  var auto = false, autoTimer = 0, run = null, pullSold = false;
  var cardFinish = null;      // set while a card is filling in: a tap completes it at once
  var showCounters = null;    // set while a card is face down: lets the coin counter and inventory badge catch up

  function isFast() { return !!Store.s.settings.fast; }
  // Epics, legendaries and every mutated card take their time: Fast open does not hurry them (the chest opens and
  // the card turns at the normal pace), and auto opening stays on them for a good while.
  function special(item) { return !!item && (RARITY[item.rarity].tier >= 3 || !!item.mut); }
  function quick(item) { return isFast() && !special(item); }
  function fg() { return UI.view === 'chest'; }       // sounds, flashes and buzzes only while the chest is on screen
  function flash(color, strength, ms) {
    var f = $('#flash');
    f.style.background = 'radial-gradient(circle at 50% 42%, ' + color + ' 0%, ' + color + '99 22%, transparent 72%)';
    try { f.animate([{ opacity: strength }, { opacity: 0 }], { duration: ms || 600, easing: 'ease-out' }); } catch (e) {}
  }
  function initials(name) {
    var p = name.split(' '); return (p[p.length - 1] || name).charAt(0).toUpperCase();
  }
  function bigBtn(cls, label, fn) {
    var b = el('button', 'fn-btn ' + cls, '<span>' + label + '</span>'); b.type = 'button'; onTap(b, fn); return b;
  }
  function setButtons(mode) {
    var box = $('#chestUi');
    if (mode === 'home') {
      box.innerHTML = '';
      uiHome.forEach(function (n) { box.appendChild(n); });
      switches(true);
    } else if (mode === 'reveal') {
      box.innerHTML = '';
      if (demo) {
        box.appendChild(bigBtn('fn-grey', 'CLOSE PREVIEW', function () { Sfx.click(); close(); }));
      } else if (pullSold) {
        // the auto rules sold this pull already, so there is nothing left to decide
        box.appendChild(bigBtn('fn-yellow', 'OPEN AGAIN', function () { Sfx.click(); close().then(function () { open(); }); }));
        box.appendChild(bigBtn('fn-grey', 'CLOSE', function () { Sfx.click(); close(); }));
      } else {
        var item = current, row = el('div', 'fn-row');
        row.appendChild(bigBtn('fn-green', 'SELL +' + fmtShort(item.sell), function () {
          var g = Store.sell(item.id, 1);
          if (g) { Sfx.coin(3); UI.toast('<span class="coin-ic sm"></span> +' + fmt(g) + ' for ' + esc(item.name), 'win'); }
          close();
        }));
        row.appendChild(bigBtn('fn-grey', 'KEEP', function () { Sfx.click(); close(); }));
        box.appendChild(bigBtn('fn-yellow', 'OPEN AGAIN', function () { Sfx.click(); close().then(function () { open(); }); }));
        box.appendChild(row);
      }
    }
    box.classList.remove('hide');
  }
  function showBanner(item) {
    var host = $('#banner'); host.innerHTML = '';
    var b = el('div', 'banner', '<div class="b-top">★ LEGENDARY DROP ★</div><div class="b-name">' + esc(item.name) + '</div><div class="b-sub">1 in ' + Math.round(100 / item.chance) + ' chests · ' + fmtPct(item.chance) + '</div>');
    host.appendChild(b);
    requestAnimationFrame(function () { requestAnimationFrame(function () { b.classList.add('on'); }); });
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, 7000);
  }
  function hideBanner() {
    var b = $('#banner .banner'); if (!b) return;
    b.classList.remove('on'); setTimeout(function () { if (b.parentNode) b.remove(); }, 600);
  }

  // ---- auto opening ---------------------------------------------------------------------------------
  // How long a pull stays on screen before the next chest: rare pulls get more time, a legendary gets its banner.
  function autoPause(item) {
    var t = RARITY[item.rarity].tier;
    // the big ones leave plenty of time to look, with Fast open as well
    if (t >= 4) return 9000;
    if (t === 3) return 6500;
    if (item.mut) return item.mut.mult >= 8 ? 6500 : 4500;
    if (isFast()) return t === 2 ? 320 : 230;
    return t === 2 ? 1100 : 800;
  }
  function bar(ms) {            // thin line in the auto row that fills until the next chest
    var b = $('#autoBar'); if (!b) return;
    b.classList.remove('run'); b.style.transitionDuration = '0s'; void b.offsetWidth;
    if (ms > 0) { b.style.transitionDuration = ms + 'ms'; b.classList.add('run'); }
  }
  // Where the two switches (auto opening, fast open) are:
  //  - idle: above the big buttons
  //  - auto opening on: at the very bottom, where the big buttons were. The card then has the whole space above
  //    them and can never cover the switch that stops auto opening.
  //  - a chest opened by hand: out of the way until the card is closed; the card may use their space.
  function switches(show) { var g = $('#autoGroup'); if (g) g.classList.toggle('away', !show && !auto); }
  function dockMode() {
    var dock = $('#chestDock'), g = $('#autoGroup');
    if (!dock || !g || dock.classList.contains('auto') === auto) return;
    var before = g.getBoundingClientRect().top;
    dock.classList.toggle('auto', auto);
    if (auto) g.classList.remove('away');
    var moved = before - g.getBoundingClientRect().top;
    if (moved && !reducedMotion && g.animate) {
      try { g.animate([{ transform: 'translateY(' + moved + 'px)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2, .9, .25, 1)' }); } catch (e) {}
    }
    fitCard();
  }
  // The card takes the room between the top of the view and whatever sits at the bottom right now. Measured
  // instead of derived from the window height, which browsers with a collapsing toolbar report too large.
  function fitCard() {
    var host = $('#reveal'), view = $('#view-chest'), g = $('#autoGroup'), ui = $('#chestUi');
    if (!host || !view || !view.offsetHeight) return;
    var top = view.getBoundingClientRect().top;
    var floor = auto ? g.getBoundingClientRect().top - 8 : ui.getBoundingClientRect().top + (ui.classList.contains('hide') ? -16 : 0) + 4;
    host.style.setProperty('--room', Math.max(170, Math.round(floor - top)) + 'px');
    var card = $('.rcard', host);
    if (card) card.style.setProperty('--cw', (card.offsetWidth || 250) + 'px');      // type on the card scales with the card
  }
  function paintToggles() {
    var a = $('#autoPill'), f = $('#fastPill'), g = $('#autoGroup');
    if (a) { a.classList.toggle('on', auto); a.setAttribute('aria-checked', auto ? 'true' : 'false'); }
    if (g) g.classList.toggle('on', auto);
    paintBadge();
    if (f) { f.classList.toggle('on', isFast()); f.setAttribute('aria-checked', isFast() ? 'true' : 'false'); }
  }
  function paintBadge() {       // gold counter on the Chest tab: auto is running, this many chests so far
    var b = $('#autoBadge'); if (!b) return;
    var n = run ? run.n : 0;
    b.textContent = n > 999 ? '999+' : n; b.classList.toggle('on', auto);
  }
  function newRun() { return { t0: Date.now(), t1: 0, n: 0, kept: 0, sold: 0, coins: 0, news: 0, items: {} }; }
  function record(item, isNew, sold, gain) {
    if (!run) return;
    var it = run.items[item.id] || (run.items[item.id] = { n: 0, kept: 0, sold: 0 });
    run.n++; it.n++; if (isNew) run.news++;
    if (sold) { run.sold++; it.sold++; run.coins += gain; } else { run.kept++; it.kept++; }
  }
  function scheduleNext(ms) {
    clearTimeout(autoTimer); bar(ms);
    autoTimer = setTimeout(function () {
      bar(0);
      if (!auto || !busy) return;
      close();                                                       // close() opens the next chest while auto is on
    }, ms);
  }
  function setAuto(on) {
    on = !!on; if (on === auto) return;
    auto = on; Chest3D.keepAlive = auto; clearTimeout(autoTimer); bar(0);
    dockMode();
    if (!auto && busy) switches(false);                              // back to a chest opened by hand
    if (auto) {
      run = newRun(); paintToggles();
      if (!busy) open();
      else if (revealReady) { $('#chestUi').classList.add('hide'); scheduleNext(demo ? 500 : 900); }
      // otherwise a chest is mid-opening: its reveal schedules the next one
    } else {
      var r = run; run = null; paintToggles();
      if (busy && revealReady) setButtons('reveal');                 // switched off on a pull: hand the choice back
      if (r && r.n > 0) { r.t1 = Date.now(); Store.s.lastRun = r; Store.save(); RunSheet.open(r); }
      else UI.toast('Auto opening off');
    }
  }

  function showReveal(item) {
    if (revealShown) return; revealShown = true;
    var seq = ++revealSeq, fast = quick(item);
    var R = RARITY[item.rarity], isNew = false, viaAuto = auto && !demo, gain = 0;
    pullSold = false;
    if (!demo) {
      // The pull is booked now, and sold now if the auto rules say so. The coin counter and the inventory badge
      // wait until the card has turned: a jump by 1,500 would say "epic" while the card still shows its back.
      UI.hold();
      var holding = true;
      showCounters = function () { if (holding) { holding = false; showCounters = null; UI.release(); } };
      isNew = Store.grant(item);
      if (viaAuto) {
        var st = Store.s.stats, rules = Store.s.settings.autoSell || {};
        st.autoOpened = (st.autoOpened || 0) + 1;
        if (rules[item.id]) {
          gain = Store.sell(item.id, 1); pullSold = gain > 0;
          if (pullSold) { st.autoSold = (st.autoSold || 0) + 1; st.autoCoins = (st.autoCoins || 0) + gain; }
        }
        record(item, isNew, pullSold, gain); Store.save(); paintBadge();
        if (!fg() && R.tier >= 3) {            // a big pull while another tab is open: say so
          UI.toast('<i class="rdot" style="--rc:' + R.color + '"></i>' + R.name + ' · ' + esc(cardName(item)) + (pullSold ? ' sold +' + fmt(gain) : ' kept'), R.tier >= 4 ? 'win' : '', 3200);
          if (R.tier >= 4) Sfx.reveal(R.tier);
        }
      }
    }
    var host = $('#reveal'); host.innerHTML = '';
    var wrap = el('div', 'card-wrap');
    var card = el('div', 'rcard r-' + item.rarity + mutCls(item)), M = item.mut;
    // The face is built in pieces that come in one after another once the card has turned (--d = delay in ms):
    // ghost initial, "H. Name" / "F. Name", rarity, chance, worth, then the NEW ribbon and the auto tag.
    var tag = !viaAuto ? '' : pullSold ? '<div class="rtag sold so" style="--d:1000"><span class="coin-ic sm"></span>Sold +' + fmt(gain) + '</div>' : '<div class="rtag kept so" style="--d:1000">Kept</div>';
    card.innerHTML = '<div class="face back"><b>?</b></div>' +
      '<div class="face front"><div class="art">' + (M ? '<div class="mfx"></div><div class="mrib so" style="--d:420">' + M.icon + ' ' + M.name.toUpperCase() + ' <b>×' + M.mult + '</b></div>' : '') + '<div class="ghost">' + esc(initials(item.name)) + '</div>' +
      '<div class="who st" style="--d:180"><span>' + esc(shortName(item.name)) + '</span></div>' + (isNew ? '<div class="new so" style="--d:1000">NEW</div>' : '') + tag + '</div>' +
      '<div class="info"><div class="st" style="--d:520"><span class="rar">' + R.name.toUpperCase() + '</span></div>' +
      '<div class="stats"><div class="cell c1 st" style="--d:720"><small>Chance</small><b>' + fmtChance(item.chance) + '</b></div><i class="so" style="--d:720"></i>' +
      '<div class="cell st" style="--d:880"><small>Worth</small><b><span class="coin-ic sm"></span>' + fmt(item.sell) + '</b></div></div></div></div>';
    wrap.appendChild(card); host.appendChild(wrap);
    host.classList.toggle('with-banner', item.rarity === 'legendary'); host.classList.toggle('fast', fast); host.classList.add('on');
    fitCard();
    // long names shrink until "H. Weber-Hänel" fits on one line
    var who = card.querySelector('.who span'), room = card.querySelector('.art').clientWidth - 26;
    if (who && room > 40 && who.offsetWidth > room) {
      who.style.fontSize = Math.max(15, Math.floor(parseFloat(getComputedStyle(who).fontSize) * room / who.offsetWidth)) + 'px';
    }
    var sold = pullSold;
    // rise -> turn -> the face fills in -> buttons. Fast open compresses the same steps.
    var T = fast ? { flip: 70, face: 160, show: 190, ready: 380 } : { flip: 760, face: 1190, show: 1320, ready: 2570 };
    var timers = [], faced = false, done = false;
    function face() {                     // the front comes into view
      if (faced || seq !== revealSeq) return; faced = true;
      if (showCounters) showCounters();
      if (!demo) Feed.mine(item);                // an epic, a legendary or a rare mutation: everybody hears of it
      if (!fg()) return;
      Sfx.reveal(R.tier); haptic(R.tier >= 3 || M ? [30, 40, 60] : 20);
      if (sold) Sfx.coin(1);
      if (M) { Sfx.gem(4 + Math.min(18, M.mult)); flash(getComputedStyle(card).getPropertyValue('--m1').trim() || '#ffffff', 0.3, 500); }
      else if (R.tier >= 3) flash(R.color, 0.35, 500);
    }
    function ready() {
      if (done || seq !== revealSeq) return; done = true; cardFinish = null;
      if (showCounters) showCounters();
      if (item.rarity === 'legendary') showBanner(item);
      $('#skipHint').classList.remove('on');
      revealReady = true;
      if (auto) scheduleNext(demo ? 1400 : autoPause(item)); else setButtons('reveal');
    }
    timers.push(setTimeout(function () { if (seq === revealSeq) card.classList.add('flip'); }, T.flip));
    timers.push(setTimeout(face, T.face));
    timers.push(setTimeout(function () { if (seq === revealSeq) card.classList.add('show'); }, T.show));
    timers.push(setTimeout(ready, T.ready));
    cardFinish = function () {            // tap to skip: turn and fill the card right away
      if (done || seq !== revealSeq) return;
      timers.forEach(clearTimeout); cardFinish = null;
      host.classList.add('fast'); card.classList.add('flip'); face();
      setTimeout(function () { if (seq === revealSeq) card.classList.add('show'); }, 130);
      setTimeout(ready, 430);
    };
  }
  function open(forceRarity, isDemo) {
    if (busy) return;
    if (!Chest3D.renderer || Chest3D.state !== 'idle') return;
    busy = true; demo = !!isDemo; revealShown = false; revealReady = false; pullSold = false;
    // taps on the gem at the back of the chest decide this pull (Chest3D.takeSecret); a preview leaves them alone
    current = rollItem(forceRarity || (isDemo ? null : Chest3D.takeSecret()) || undefined);
    if (!isDemo) current = mutate(current, rollMutation());       // one chest in ten: the same card, mutated
    $('#chestUi').classList.add('hide');
    switches(false);
    hideBanner();
    if (fg()) { Sfx.unlock(); Sfx.click(); Sfx.rattle(0.8 + RARITY[current.rarity].tier * 0.08); }
    clearTimeout(skipTimer);
    skipTimer = setTimeout(function () { if (busy && !revealShown) $('#skipHint').classList.add('on'); }, 900);
    Chest3D.playOpen(current.rarity, { fast: quick(current) });
  }
  function close() {
    revealSeq++; revealReady = false; cardFinish = null; clearTimeout(autoTimer); bar(0);
    if (showCounters) showCounters();
    $('#reveal').classList.remove('on'); $('#reveal').innerHTML = '';
    $('#skipHint').classList.remove('on');
    $('#chestUi').classList.add('hide');
    hideBanner();
    return Chest3D.reset(false, current ? quick(current) : isFast()).then(function () {
      busy = false; current = null; pullSold = false; setButtons('home');
      if (auto) open();
    });
  }
  function init() {
    uiHome = Array.prototype.slice.call($('#chestUi').children);
    var fix = function () {
      var b = $('#chestUi'); b.style.minHeight = '';
      if (b.offsetHeight) { b.style.minHeight = b.offsetHeight + 'px'; dockH = $('#chestDock').offsetHeight; Chest3D.resize(); }
    };
    Chest3D.padBottom = function () { return Math.max(0, dockH - 8); };       // the chest is framed in the space above the dock
    // auto: switching on first asks what to keep and what to sell; switching off shows what the run brought
    onTap($('#autoPill'), function () {
      Sfx.unlock(); Sfx.click(); haptic(15);
      if (auto) setAuto(false); else AutoSheet.open(function () { setAuto(true); });
    });
    onTap($('#fastPill'), function () { Sfx.unlock(); Sfx.click(); haptic(15); Store.set('fast', !isFast()); });
    Store.on(function (what) { if (what === 'settings') { paintToggles(); Chest3D.setFast(busy && current ? quick(current) : isFast()); } });
    paintToggles();
    fix(); window.addEventListener('resize', function () { if (!busy) fix(); fitCard(); });
    onTap($('#btnOpen'), function () { open(); });
    onTap($('#btnIndex'), function () { Sfx.click(); IndexSheet.open(); });
    // a tap skips whatever is running: first the chest animation, then the card filling in
    var skip = function () {
      if (!busy) return;
      if (!revealShown) Chest3D.skip();
      else if (cardFinish) cardFinish();
    };
    onTap($('#skipHint'), skip);
    $('#gl').addEventListener('click', skip);
    Chest3D.hooks.onTier = function (tier, idx, seq) {
      if (!fg()) return;
      Sfx.tierUp(tier);
      if (idx > 0) { flash(Chest3D.TIER_COLORS[tier], 0.3 + 0.12 * idx, 450); haptic(25 + idx * 20); }
      if (idx === 0 && seq.tier >= 3) Sfx.riser((seq.chainT - 0.3) / seq.speed, seq.tier === 4 ? 1.2 : 0.8);
    };
    // The hidden trick on the back of the chest: nothing to see. A quiet tick (only with sound on) and a short buzz
    // (where the phone can) tell the one who knows that the tap counted.
    Chest3D.hooks.onGem = function () { if (!fg()) return; Sfx.unlock(); Sfx.tick(1); haptic(8); };
    Chest3D.hooks.onPhase = function (name, seq) {
      if (name === 'reveal') { showReveal(current); return; }
      if (!fg()) return;
      if (name === 'chain') { Sfx.chainBreak(seq.power); haptic(30); }
      else if (name === 'open') { Sfx.open(seq.tier); flash(seq.tier >= 3 ? '#ffffff' : Chest3D.TIER_COLORS[seq.tier], seq.tier === 4 ? 0.95 : seq.tier === 3 ? 0.7 : 0.3, seq.tier >= 3 ? 900 : 500); haptic(seq.tier >= 3 ? [40, 30, 90] : 35); }
    };
    UI.onView(function (v) {
      Chest3D.visible = (v === 'chest');
      if (v === 'chest') { Chest3D.resize(); fitCard(); }
    });
  }
  return { init: init, open: open, close: close, setAuto: setAuto, fit: fitCard, pause: autoPause, get busy() { return busy; }, get auto() { return auto; }, get run() { return run; } };
})();
