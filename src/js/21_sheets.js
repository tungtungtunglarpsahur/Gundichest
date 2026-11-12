// Index and settings sheets -------------------------------------------------------------------------
var IndexSheet = (function () {
  function open() {
    UI.sheet('Index', function (body) {
      var S = Store.s, found = 0;
      ITEMS.forEach(function (it) { if (S.found[it.id]) found++; });
      // how many chests so far, and how many of them auto opening did
      var st = S.stats, last = S.lastRun;
      var nums = el('div', 'kv'); nums.style.marginBottom = '10px';
      nums.innerHTML = '<div class="stat"><div class="k">Opened</div><div class="v num" id="ixOpened">' + fmt(S.opened) + '</div></div>' +
        '<div class="stat"><div class="k">With auto</div><div class="v num" id="ixAuto">' + fmt(st.autoOpened || 0) + '</div></div>' +
        '<div class="stat"><div class="k">Found</div><div class="v num">' + found + ' / ' + ITEMS.length + '</div></div>';
      body.appendChild(nums);
      if ((st.autoOpened || 0) > 0) {
        body.appendChild(el('div', 'run-sub', 'Auto opening sold ' + fmt(st.autoSold || 0) + ' pull' + ((st.autoSold || 0) === 1 ? '' : 's') + ' for ' + fmt(st.autoCoins || 0) + ' coins so far.'));
      }
      if (last && last.n) {
        var lb = el('button', 'ix-last', '<span>Last auto run<small>' + fmt(last.n) + ' chest' + (last.n === 1 ? '' : 's') + ' · ' + fmt(last.kept) + ' kept · +' + fmt(last.coins) + ' coins</small></span><span class="go">Overview</span>');
        lb.type = 'button'; lb.id = 'ixLastRun'; lb.style.marginBottom = '10px';
        onTap(lb, function () { Sfx.click(); RunSheet.open(last); });
        body.appendChild(lb);
      }
      var top = el('div', 'panel');
      var bar = '<div class="ix-bar">' + RARITY_ORDER.slice().reverse().map(function (k) { return '<i style="width:' + RARITY[k].chance + '%;background:' + RARITY[k].color + '"></i>'; }).join('') + '</div>';
      var legend = '<div class="ix-legend">' + RARITY_ORDER.map(function (k) { return '<span><i class="rdot" style="--rc:' + RARITY[k].color + '"></i>' + RARITY[k].name + ' ' + fmtPct(RARITY[k].chance) + '</span>'; }).join('') + '</div>';
      top.innerHTML = '<div class="lbl" style="margin:0">Drop chances per chest</div>' + bar + legend;
      body.appendChild(top);
      RARITY_ORDER.forEach(function (k) {
        var R = RARITY[k], g = el('div', 'ix-group r-' + k);
        g.innerHTML = '<div class="ix-head"><span class="nm">' + R.name.toUpperCase() + '</span><span class="tot">' + fmtPct(R.chance) + '<small>total · ' + R.count + ' items</small></span></div>';
        var list = el('div', 'ix-list');
        ITEMS.filter(function (it) { return it.rarity === k; }).forEach(function (it) {
          var have = S.inv[it.id] || 0, was = S.found[it.id];
          var row = el('div', 'ix-row');
          row.innerHTML = '<i class="rdot"></i><div class="grow"><div class="nm">' + esc(it.name) + '</div><div class="own' + (have ? ' has' : '') + '">' +
            (have ? 'Owned ×' + have : was ? 'Found before' : 'Not found yet') + '</div></div>' +
            '<div class="ixp">' + fmtPct(it.chance) + '<small>1 in ' + fmt(Math.round(100 / it.chance)) + ' · sells ' + fmt(it.sell) + '</small></div>';
          list.appendChild(row);
        });
        g.appendChild(list); body.appendChild(g);
      });
      body.appendChild(el('div', 'note', 'Every chest rolls its rarity first, then one item of that rarity.'));
    });
  }
  return { open: open };
})();

var SettingsSheet = (function () {
  function seg(options, value, onPick, cls) {
    var s = el('div', 'seg' + (cls ? ' ' + cls : ''));
    options.forEach(function (o) {
      var b = el('button', o[0] === value ? 'on' : '', esc(o[1])); b.type = 'button';
      onTap(b, function () { Sfx.click(); $$('button', s).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); onPick(o[0]); });
      s.appendChild(b);
    });
    return s;
  }
  function toggle(on, onChange) {
    var t = el('button', 'toggle' + (on ? ' on' : '')); t.type = 'button'; t.setAttribute('role', 'switch'); t.setAttribute('aria-checked', on ? 'true' : 'false');
    onTap(t, function () { on = !on; t.classList.toggle('on', on); t.setAttribute('aria-checked', on ? 'true' : 'false'); onChange(on); Sfx.click(); });
    return t;
  }
  function row(title, desc, control) {
    var r = el('div', 'set-row', '<div class="grow"><div class="t">' + esc(title) + '</div>' + (desc ? '<div class="d">' + esc(desc) + '</div>' : '') + '</div>');
    if (control) r.appendChild(control);
    return r;
  }
  function open() {
    UI.sheet('Settings', function (body, close) {
      var S = Store.s.settings;
      body.appendChild(row('Effects quality', 'Lower it if the chest stutters.', seg([['low', 'Low'], ['mid', 'Mid'], ['high', 'High']], Chest3D.quality, function (q) {
        Store.set('quality', q); Chest3D.setQuality(q);
      })));
      body.appendChild(row('Sound', 'Chest, coins and game effects.', toggle(S.sound, function (on) { Store.set('sound', on); Sfx.setEnabled(on); if (on) Sfx.unlock(); })));
      body.appendChild(row('Fast opening', 'Shorter chest animation.', toggle(S.fast, function (on) { Store.set('fast', on); })));
      if (navigator.vibrate) body.appendChild(row('Vibration', '', toggle(S.haptics, function (on) { Store.set('haptics', on); })));
      var fx = el('div', 'set-row'); fx.style.display = 'block';
      fx.innerHTML = '<div class="t">Preview an opening</div><div class="d">Plays the effect only. Nothing is added to your inventory.</div>';
      var grid = el('div', 'fx-grid');
      RARITY_ORDER.slice().reverse().forEach(function (k) {
        var b = el('button', 'r-' + k, RARITY[k].name.toUpperCase()); b.type = 'button'; b.style.setProperty('--rc', RARITY[k].color);
        onTap(b, function () {
          if (ChestView.auto) ChestView.setAuto(false);
          if (ChestView.busy) { UI.toast('Finish the current chest first'); return; }
          close(); UI.go('chest'); setTimeout(function () { ChestView.open(k, true); }, 420);
        });
        grid.appendChild(b);
      });
      fx.appendChild(grid); body.appendChild(fx);
      var st = Store.s.stats;
      var stats = el('div', 'set-row'); stats.style.display = 'block';
      stats.innerHTML = '<div class="t">Your numbers</div><div class="kv" style="margin-top:8px">' +
        '<div class="stat"><div class="k">Opened</div><div class="v">' + fmt(Store.s.opened) + '</div></div>' +
        '<div class="stat"><div class="k">Legendary</div><div class="v">' + fmt(st.legend) + '</div></div>' +
        '<div class="stat"><div class="k">Best win</div><div class="v">' + fmtShort(st.bestWin) + '</div></div></div>';
      body.appendChild(stats);
      var reset = el('button', 'btn red sm', 'Reset progress'); reset.type = 'button';
      onTap(reset, function () {
        UI.confirm('Reset everything?', 'Your coins, inventory and stats are deleted. This cannot be undone.', 'Reset', true).then(function (ok) {
          if (ok) { var q = Store.s.settings.quality, snd = Store.s.settings.sound; Store.reset(); Store.set('quality', q); Store.set('sound', snd); UI.toast('Progress reset'); close(); }
        });
      });
      body.appendChild(row('Start over', 'Saved in this browser only.', reset));
      body.appendChild(el('div', 'note', 'GundiChest uses play coins only. Nothing here costs or pays real money.'));
    });
  }
  return { open: open };
})();
