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
      // mutations: the same for every card
      var mg = el('div', 'ix-group ix-mut');
      mg.innerHTML = '<div class="ix-head"><span class="nm">MUTATIONS</span><span class="tot">' + fmtPct(MUT_CHANCE) + '<small>of all chests · any card</small></span></div>';
      var ml = el('div', 'ix-list');
      MUTATIONS.forEach(function (m) {
        var have = 0, was = false, tail = '_' + m.key;
        Object.keys(S.inv).forEach(function (id) { if (id.slice(-tail.length) === tail) have += S.inv[id]; });
        Object.keys(S.found).forEach(function (id) { if (id.slice(-tail.length) === tail) was = true; });
        var row = el('div', 'ix-row m-' + m.key);
        row.innerHTML = '<i class="mdot">' + m.icon + '</i><div class="grow"><div class="nm">' + m.name + '</div><div class="own' + (have ? ' has' : '') + '">' +
          (have ? 'Owned ×' + have : was ? 'Found before' : 'Not found yet') + '</div></div>' +
          '<div class="ixp">' + fmtPct(m.chance) + '<small>1 in ' + fmt(Math.round(100 / m.chance)) + ' · worth ×' + m.mult + '</small></div>';
        ml.appendChild(row);
      });
      mg.appendChild(ml); body.appendChild(mg);
      body.appendChild(el('div', 'note', 'Every chest rolls its rarity first, then one item of that rarity. One chest in ten comes out mutated: the same card, worth more.'));
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
  // Small sheet with password fields: fields = [[id, label, autocomplete]], go(values) returns a promise.
  function passSheet(title, text, fields, okLabel, danger, go) {
    UI.sheet(title, function (body, close) {
      body.appendChild(el('p', 'sub', text));
      var form = el('form', 'pw-form'); form.setAttribute('novalidate', '');
      fields.forEach(function (f) {
        form.appendChild(el('label', 'field', '<span>' + esc(f[1]) + '</span><input id="' + f[0] + '" type="password" autocomplete="' + f[2] + '" maxlength="100">'));
      });
      var err = el('div', 'auth-err'); err.setAttribute('role', 'alert');
      var ok = el('button', 'btn big block ' + (danger ? 'red' : 'gold'), esc(okLabel)); ok.type = 'submit';
      form.appendChild(err); form.appendChild(ok); body.appendChild(form);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (ok.disabled) return;
        var vals = fields.map(function (f) { return $('#' + f[0], form).value; });
        if (vals.some(function (v) { return !v; })) { err.textContent = 'Fill in every field.'; err.classList.add('on'); return; }
        ok.disabled = true; err.classList.remove('on');
        go(vals).then(function () { close(); }, function (e) { ok.disabled = false; err.textContent = e.message || 'That did not work.'; err.classList.add('on'); });
      });
    });
  }
  function accountRows(body, close) {
    if (!Net.enabled) return;
    var u = Net.user;
    if (!u || GC.mode !== 'account') {
      var login = el('button', 'btn sm gold', 'Log in'); login.type = 'button';
      onTap(login, function () { location.reload(); });
      body.appendChild(row('No account', 'You are playing offline on this device. Trading needs an account.', login));
      return;
    }
    var out = el('button', 'btn sm', 'Log out'); out.type = 'button'; out.id = 'setLogout';
    onTap(out, function () { out.disabled = true; out.textContent = 'Saving\u2026'; Net.logout(); });
    body.appendChild(row('Logged in as ' + u.name, Net.online ? 'Your progress is saved to your account.' : 'Offline right now. Progress is saved once the server is back.', out));
    var more = el('div', 'set-row acct-more');
    var pw = el('button', 'btn sm', 'Change password'), del = el('button', 'btn sm', 'Delete account'); pw.type = del.type = 'button';
    onTap(pw, function () {
      Sfx.click();
      passSheet('Change password', 'Other devices are logged out and need the new password.', [['pwOld', 'Current password', 'current-password'], ['pwNew', 'New password (at least 6 characters)', 'new-password']], 'Change password', false, function (v) {
        return Net.call('account.password', { pass: v[0], next: v[1] }).then(function () { UI.toast('Password changed', 'win'); });
      });
    });
    onTap(del, function () {
      Sfx.click();
      passSheet('Delete account', 'This removes ' + esc(u.name) + ' with all cards, coins and trades for good. Enter your password to confirm.', [['pwDel', 'Password', 'current-password']], 'Delete my account', true, function (v) {
        return Net.deleteAccount(v[0]);
      });
    });
    more.appendChild(pw); more.appendChild(del); body.appendChild(more);
  }
  function open() {
    UI.sheet('Settings', function (body, close) {
      var S = Store.s.settings;
      accountRows(body, close);
      body.appendChild(row('Effects quality', 'Lower it if the chest stutters.', seg([['low', 'Low'], ['mid', 'Mid'], ['high', 'High']], Chest3D.quality, function (q) {
        Store.set('quality', q); Chest3D.setQuality(q);
      })));
      body.appendChild(row('Sound', 'Chest, coins and game effects.', toggle(S.snd, function (on) { Store.set('snd', on); if (on) Sfx.unlock(); })));
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
          if (!ok) return;
          if (Store.held.coins || Object.keys(Store.held.items).length) { UI.toast('Leave your open trade first.'); return; }
          if (ChestView.auto) ChestView.setAuto(false);
          Store.reset(); UI.toast('Progress reset'); close();
        });
      });
      body.appendChild(row('Start over', Net.user && GC.mode === 'account' ? 'Empties the game of your account.' : 'Saved in this browser only.', reset));
      body.appendChild(el('div', 'note', 'GundiChest uses play coins only. Nothing here costs or pays real money.'));
    });
  }
  return { open: open };
})();
