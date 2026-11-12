// Upgrader: put in cards you own, pick a card worth more, spin. Win and the cards turn into the target;
// miss and they are gone. The chance is 95% of (value put in / value of the target), at most 90%.
var Upgrader = (function () {
  var EDGE = 0.95, CAP = 0.90;
  function chance(valueIn, valueOut) {
    if (!(valueIn > 0) || !(valueOut > 0)) return 0;
    return Math.min(CAP, EDGE * valueIn / valueOut);
  }
  // A win that was rolled but not handed out yet (the page was closed mid-spin) is handed out on the next visit.
  function settle() {
    var s = Store.s;
    if (s.upWin && ITEM_BY_ID[s.upWin]) {
      var it = ITEM_BY_ID[s.upWin]; s.upWin = null;
      Store.give(it.id, 1); s.stats.upWon = (s.stats.upWon || 0) + 1; Store.save();
      UI.toast('Your last upgrade came through: ' + esc(shortName(it.name)), 'win', 3600);
    }
  }
  return { chance: chance, settle: settle, EDGE: EDGE, CAP: CAP };
})();

Games.register({
  id: 'up', title: 'Upgrader', icon: 'up',
  mount: function (pane) {
    var R = 84, C = 2 * Math.PI * R;
    var st = { inId: null, qty: 1, outId: null, busy: false, angle: 0, last: null };
    pane.innerHTML =
      '<div class="up-stage" id="upStage">' +
        '<button type="button" class="up-card" id="upIn" aria-label="Choose your card"></button>' +
        '<div class="up-ring">' +
          '<svg viewBox="0 0 200 200" aria-hidden="true">' +
            '<defs><linearGradient id="upArcG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dffb0"/><stop offset="1" stop-color="#18c964"/></linearGradient></defs>' +
            '<circle cx="100" cy="100" r="' + R + '" class="up-track"/>' +
            '<circle cx="100" cy="100" r="' + R + '" class="up-arc" id="upArc" transform="rotate(-90 100 100)" stroke="url(#upArcG)" stroke-dasharray="0 ' + C.toFixed(2) + '"/>' +
            '<g id="upNeedle"><path d="M100 4.500V27.500" class="up-tick"/><path d="M100 11.500l-7.500-11h15z" class="up-pin"/></g>' +
          '</svg>' +
          '<div class="up-mid"><b id="upPct" class="num">0%</b><small id="upSub">chance</small></div>' +
        '</div>' +
        '<button type="button" class="up-card" id="upOut" aria-label="Choose the card you want"></button>' +
      '</div>' +
      '<div class="panel up-qty" id="upQty"><div class="grow"><div class="t">Cards you put in</div><div class="d" id="upQtyD"></div></div>' +
        '<div class="stepper"><button type="button" id="upLess" aria-label="One less">−</button><b class="num" id="upN">1</b><button type="button" id="upMore" aria-label="One more">+</button></div></div>' +
      '<button class="btn big green" type="button" id="upGo">Upgrade</button>' +
      '<div class="kv"><div class="stat"><div class="k">You put in</div><div class="v num" id="upVin">0</div></div><div class="stat"><div class="k">You can get</div><div class="v num" id="upVout">0</div></div><div class="stat"><div class="k">Won</div><div class="v num" id="upWon">0 / 0</div></div></div>' +
      '<div class="note">Win and your cards turn into the card you picked. Miss and they are gone. Your chance is 95% of what you put in compared to the target, and never more than 90%.</div>';
    var needle = $('#upNeedle', pane), arc = $('#upArc', pane), pctEl = $('#upPct', pane), subEl = $('#upSub', pane), stage = $('#upStage', pane);

    function valueIn() { return st.inId ? ITEM_BY_ID[st.inId].sell * st.qty : 0; }
    function odds() { return st.inId && st.outId ? Upgrader.chance(valueIn(), ITEM_BY_ID[st.outId].sell) : 0; }
    // most copies that still raise the chance
    function maxQty() {
      if (!st.inId) return 1;
      var have = Store.free(st.inId), each = ITEM_BY_ID[st.inId].sell;
      if (!st.outId) return Math.max(1, have);
      var need = Math.ceil(Upgrader.CAP / Upgrader.EDGE * ITEM_BY_ID[st.outId].sell / each - 1e-9);
      return Math.max(1, Math.min(have, need));
    }
    function cardHtml(id, n, emptyTop, emptyText) {
      if (!id) return '<span class="up-plus">+</span><span class="up-empty"><b>' + emptyTop + '</b>' + emptyText + '</span>';
      var it = ITEM_BY_ID[id], last = it.name.split(' ').pop();
      return '<span class="up-art r-' + it.rarity + '"><i>' + esc(last.charAt(0)) + '</i>' + (n > 1 ? '<em>×' + n + '</em>' : '') + '</span>' +
        '<span class="up-name">' + esc(shortName(it.name)) + '</span><span class="up-val"><span class="coin-ic sm"></span>' + fmtShort(it.sell * (n || 1)) + '</span>';
    }
    function setNeedle(deg) { st.angle = deg; needle.setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 100 100)'); }
    function paint() {
      if (!st.busy) {
        // keep the choice valid: the card may have been sold or put into a trade meanwhile.
        // Not during a spin: the stake is already taken then, and the ring has to keep showing what was staked.
        if (st.inId && Store.free(st.inId) < 1) { st.inId = null; st.qty = 1; }
        if (st.inId && st.outId && ITEM_BY_ID[st.outId].sell <= ITEM_BY_ID[st.inId].sell) st.outId = null;
        st.qty = Math.max(1, Math.min(st.qty, maxQty()));
      }
      var p = odds(), inEl = $('#upIn', pane), outEl = $('#upOut', pane);
      inEl.innerHTML = cardHtml(st.inId, st.qty, 'Your card', 'Tap to choose'); inEl.className = 'up-card' + (st.inId ? ' set r-' + ITEM_BY_ID[st.inId].rarity : '');
      outEl.innerHTML = cardHtml(st.outId, 1, 'Target', 'Tap to choose'); outEl.className = 'up-card' + (st.outId ? ' set r-' + ITEM_BY_ID[st.outId].rarity : '');
      arc.setAttribute('stroke-dasharray', (C * p).toFixed(2) + ' ' + C.toFixed(2));
      if (!st.busy) {
        pctEl.textContent = p ? fmtPct(p * 100) : '0%';
        subEl.textContent = !st.inId ? 'pick your card' : !st.outId ? 'pick a target' : 'chance';
        pctEl.className = 'num';
      }
      var have = st.inId ? Store.free(st.inId) : 0, held = st.inId ? (Store.held.items[st.inId] || 0) : 0;
      $('#upQty', pane).classList.toggle('off', !st.inId);
      $('#upN', pane).textContent = st.qty;
      $('#upQtyD', pane).textContent = !st.inId ? 'More copies raise the chance.' : 'You have ' + have + (held ? ' free (' + held + ' in a trade)' : '') + '. More copies raise the chance.';
      $('#upLess', pane).disabled = st.busy || !st.inId || st.qty <= 1;
      $('#upMore', pane).disabled = st.busy || !st.inId || st.qty >= maxQty();
      var go = $('#upGo', pane);
      go.disabled = st.busy || !st.inId || !st.outId;
      go.textContent = st.busy ? 'Spinning…' : st.inId && st.outId ? 'Upgrade · ' + fmtPct(p * 100) : 'Upgrade';
      inEl.disabled = outEl.disabled = st.busy;
      if (st.busy) return;                                          // the numbers below wait for the result
      $('#upVin', pane).innerHTML = '<span class="coin-ic sm"></span>' + fmtShort(valueIn());
      $('#upVout', pane).innerHTML = '<span class="coin-ic sm"></span>' + fmtShort(st.outId ? ITEM_BY_ID[st.outId].sell : 0);
      var s = Store.s.stats;
      $('#upWon', pane).textContent = fmt(s.upWon || 0) + ' / ' + fmt(s.upTried || 0);
    }
    function pick(which) {
      if (st.busy) return;
      UI.sheet(which === 'in' ? 'Your card' : 'Upgrade to', function (body, close) {
        var html = '', any = false;
        ITEMS.forEach(function (it) {
          var have = Store.free(it.id), row = '';
          if (which === 'in') {
            if (have < 1) return;
            if (it.rarity === 'legendary') return;                       // nothing is worth more than a legendary
            row = '<span class="cnt">×' + have + '</span>';
          } else {
            var base = st.inId ? ITEM_BY_ID[st.inId].sell : 0;
            if (it.sell <= base || it.rarity === 'common') return;
            row = st.inId ? '<span class="up-odds">' + fmtPct(Upgrader.chance(base * st.qty, it.sell) * 100) + '</span>' : '';
          }
          any = true;
          var last = it.name.split(' ').pop(), on = (which === 'in' ? st.inId : st.outId) === it.id;
          html += '<button type="button" class="inv-item r-' + it.rarity + (on ? ' picked' : '') + '" data-id="' + it.id + '" style="animation:none;width:100%;text-align:left"><div class="av">' + esc(last.charAt(0)) + '</div>' +
            '<div class="grow"><div class="nm">' + esc(it.name) + '</div><div class="meta"><b>' + RARITY[it.rarity].name + '</b><span class="worth"><span class="coin-ic sm"></span>' + fmt(it.sell) + '</span>' +
            (which === 'out' && !Store.s.found[it.id] ? '<span>not found yet</span>' : '') + '</div></div>' + row + '</button>';
        });
        if (!any) {
          html = which === 'in' ? '<div class="empty"><b>No cards to upgrade</b>Open a chest first. Legendary cards are already the top.</div>'
            : '<div class="empty"><b>Nothing above this card</b>Pick a cheaper card to upgrade.</div>';
        } else if (which === 'out' && st.inId) html = '<p class="sub" style="margin:0 2px 10px">The percentage is your chance with what you put in right now.</p>' + html;
        body.innerHTML = html;
        body.addEventListener('click', function (ev) {
          var b = ev.target.closest ? ev.target.closest('button[data-id]') : null;
          if (!b) return;
          Sfx.click();
          if (which === 'in') { st.inId = b.dataset.id; st.qty = 1; } else st.outId = b.dataset.id;
          close(); paint();
        });
      });
    }
    function spin() {
      if (st.busy || !st.inId || !st.outId) return;
      var inId = st.inId, outId = st.outId, n = st.qty, p = odds();
      if (!(p > 0) || Store.free(inId) < n) { Sfx.deny(); UI.toast('Those cards are not available right now.'); paint(); return; }
      st.busy = true;                                              // from here on the ring keeps showing this stake
      Store.take(inId, n);
      Sfx.unlock();
      var roll = rand(), win = roll < p, S = Store.s;
      S.stats.upTried = (S.stats.upTried || 0) + 1;
      if (win) S.upWin = outId;                                    // handed out when the spin ends (or on the next visit)
      Store.save();
      stage.className = 'up-stage spin'; paint();
      // where the pointer stops: the same roll, drawn on the ring (the green arc starts at the top, clockwise)
      var edge = 0.004, shown = win ? Math.min(Math.max(roll, edge), Math.max(edge, p - edge)) : Math.min(Math.max(roll, p + edge), 1 - edge);
      var from = st.angle % 360, to = 360 * (reducedMotion ? 1 : Store.s.settings.fast ? 3 : 6) + shown * 360;
      var dur = reducedMotion ? 500 : Store.s.settings.fast ? 1500 : 3600, t0 = performance.now(), lastTick = 0;
      Sfx.whoosh();
      (function step(now) {
        var k = sat((now - t0) / dur), a = from + (to - from) * ease.outQuint(k);
        setNeedle(a);
        var seg = Math.floor(a / 30);
        if (seg !== lastTick) { lastTick = seg; if (UI.view === 'games' && Games.active === 'up') Sfx.tick(k * 6); }
        if (k < 1) { requestAnimationFrame(step); return; }
        setNeedle(to % 360); finish();
      })(t0);
      function finish() {
        var target = ITEM_BY_ID[outId], isNew = false;
        if (win) {
          S.upWin = null; isNew = Store.give(outId, 1);
          S.stats.upWon = (S.stats.upWon || 0) + 1; Store.save();
          Sfx.win(RARITY[target.rarity].tier >= 3); haptic([30, 40, 70]);
          UI.toast('<i class="rdot" style="--rc:' + RARITY[target.rarity].color + '"></i>Upgraded to ' + esc(shortName(target.name)) + (isNew ? ' · new' : ''), 'win', 2800);
        } else { Sfx.lose(); haptic([50, 30, 80]); }
        stage.className = 'up-stage ' + (win ? 'won' : 'lost');
        pctEl.textContent = win ? 'WIN' : 'MISS'; pctEl.className = 'num ' + (win ? 'w' : 'l');
        subEl.textContent = win ? 'upgraded' : 'cards lost';
        st.last = { win: win, roll: roll, p: p };
        setTimeout(function () { st.busy = false; stage.className = 'up-stage'; paint(); }, reducedMotion ? 700 : 1500);
      }
    }
    onTap($('#upIn', pane), function () { Sfx.click(); pick('in'); });
    onTap($('#upOut', pane), function () { Sfx.click(); pick('out'); });
    onTap($('#upLess', pane), function () { Sfx.click(); st.qty--; paint(); });
    onTap($('#upMore', pane), function () { Sfx.click(); st.qty++; paint(); });
    onTap($('#upGo', pane), spin);
    Store.on(function (what) { if (what === 'inv' && !st.busy && Games.active === 'up') paint(); });
    setNeedle(0); paint();
    GC.up = { get st() { return st; }, spin: spin, paint: paint, odds: odds, set: function (inId, qty, outId) { st.inId = inId; st.qty = qty || 1; st.outId = outId; paint(); } };
    return { show: function () { Upgrader.settle(); paint(); } };
  }
});
