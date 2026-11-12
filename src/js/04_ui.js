// UI plumbing: navigation, sheets, toasts, coin display ----------------------------------------------
var UI = (function () {
  var view = 'chest', listeners = [], shownCoins = 0, coinAnim = 0, openedEl = null;
  var ICON = {
    gem: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h20l10 13-20 23L4 19z" fill="#b65cff"/><path d="M14 6l-10 13h12zM34 6l10 13H32zM16 19h16l-8 23z" fill="#d9a8ff"/><path d="M14 6h20l-2 13H16z" fill="#f1dcff"/><path d="M4 19h12l8 23zM44 19H32l-8 23z" fill="#8a2be2" opacity=".55"/></svg>',
    skull: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c10.500 0 18 7 18 16.500 0 5.500-2.500 9.500-6 12V38a3 3 0 0 1-3 3h-2v-5h-3v5h-4v-5h-3v5h-3a3 3 0 0 1-3-3v-5.500c-3.500-2.500-6-6.500-6-12C6 11 13.500 4 24 4z" fill="#f4f2fa"/><circle cx="16.500" cy="21" r="5" fill="#1b1522"/><circle cx="31.500" cy="21" r="5" fill="#1b1522"/><path d="M24 26l3 6h-6z" fill="#1b1522"/></svg>',
    crown: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 36l-2-22 11 9 9-15 9 15 11-9-2 22z" fill="#7a4a08"/><rect x="6" y="38" width="36" height="5" rx="2" fill="#7a4a08"/></svg>'
  };
  function go(v) {
    if (v === view) return;
    view = v;
    $$('.view').forEach(function (s) { s.classList.toggle('on', s.dataset.view === v); });
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.go === v); });
    listeners.forEach(function (fn) { fn(v); });
  }
  function toast(html, kind, ms) {
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), html);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); }, ms || 2200);
  }
  function sheet(title, build, opt) {
    opt = opt || {};
    var bg = el('div', 'sheet-bg'), sh = el('div', 'sheet');
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
    var head = el('div', 'sheet-head', '<h2 class="h1">' + esc(title) + '</h2>');
    var x = el('button', 'x-btn', '&times;'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); head.appendChild(x);
    var body = el('div', 'sheet-body');
    sh.appendChild(head); sh.appendChild(body);
    var host = $('#sheets'); host.appendChild(bg); host.appendChild(sh);
    var closed = false;
    function close() {
      if (closed) return; closed = true;
      bg.classList.remove('on'); sh.classList.remove('on');
      setTimeout(function () { bg.remove(); sh.remove(); }, 400);
      if (opt.onClose) opt.onClose();
    }
    onTap(x, function () { Sfx.click(); close(); }); onTap(bg, close);
    build(body, close);
    requestAnimationFrame(function () { requestAnimationFrame(function () { bg.classList.add('on'); sh.classList.add('on'); }); });
    return { close: close, body: body };
  }
  function confirm(title, text, okLabel, danger) {
    return new Promise(function (res) {
      var done = false;
      sheet(title, function (body, close) {
        body.appendChild(el('p', 'sub', text));
        var row = el('div', 'row'); row.style.marginTop = '14px';
        var no = el('button', 'btn grow', 'Cancel'), yes = el('button', 'btn grow ' + (danger ? 'red' : 'gold'), esc(okLabel || 'OK'));
        no.type = yes.type = 'button';
        onTap(no, function () { close(); });
        onTap(yes, function () { done = true; close(); });
        row.appendChild(no); row.appendChild(yes); body.appendChild(row);
      }, { onClose: function () { res(done); } });
    });
  }
  function renderCoins() {
    var target = Store.s.coins, from = shownCoins, t0 = performance.now(), dur = Math.abs(target - from) > 0 ? 420 : 0, node = $('#coinAmt');
    cancelAnimationFrame(coinAnim);
    (function step(now) {
      var k = dur ? sat((now - t0) / dur) : 1; shownCoins = Math.round(lerp(from, target, ease.outCubic(k)));
      node.textContent = fmtShort(shownCoins);
      if (k < 1) coinAnim = requestAnimationFrame(step);
    })(t0);
    if (target !== from) { var p = $('#coinPill'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
  }
  function renderBadge() {
    var n = 0, inv = Store.s.inv; for (var k in inv) n += inv[k];
    var b = $('#invBadge'); b.textContent = n > 99 ? '99+' : n; b.classList.toggle('on', n > 0);
    if (!openedEl) openedEl = $('#openedCount');     // kept by reference: the node is detached while a reveal is on screen
    if (openedEl) openedEl.textContent = fmt(Store.s.opened);
  }
  return {
    ICON: ICON, go: go, toast: toast, sheet: sheet, confirm: confirm, renderCoins: renderCoins, renderBadge: renderBadge,
    get view() { return view; },
    onView: function (fn) { listeners.push(fn); },
    initShell: function () {
      $$('#nav button').forEach(function (b) { onTap(b, function () { Sfx.tab(); go(b.dataset.go); }); });
      onTap($('#coinPill'), function () { Sfx.click(); go('inv'); });
      shownCoins = Store.s.coins; $('#coinAmt').textContent = fmtShort(shownCoins); renderBadge();
      // sound switch in the top bar: off until the player turns it on
      var sb = $('#btnSound');
      var paintSound = function () {
        var on = !!Store.s.settings.snd;
        sb.classList.toggle('on', on); sb.setAttribute('aria-pressed', on ? 'true' : 'false'); sb.setAttribute('aria-label', on ? 'Sound is on' : 'Sound is off');
        Sfx.setEnabled(on);
      };
      onTap(sb, function () {
        var on = !Store.s.settings.snd;
        Store.set('snd', on);
        if (on) { Sfx.unlock(); Sfx.click(); }
        toast(on ? 'Sound on' : 'Sound off', '', 1100);
      });
      paintSound();
      Store.on(function (what) {
        if (what === 'coins') renderCoins();
        if (what === 'inv') renderBadge();
        if (what === 'settings') paintSound();
      });
    }
  };
})();
