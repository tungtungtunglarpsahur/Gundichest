// Auto opening: the rules sheet (what to keep, what to sell) and the overview of a finished run -------
var AutoSheet = (function () {
  var PRESETS = [
    ['Keep everything', function () { return false; }],
    ['Sell commons', function (it) { return it.rarity === 'common'; }],
    ['Sell up to rare', function (it) { return RARITY[it.rarity].tier <= 2; }]
  ];
  function rules() {
    var s = Store.s.settings; if (!s.autoSell || typeof s.autoSell !== 'object') s.autoSell = {};
    return s.autoSell;
  }
  function open(onStart) {
    var started = false;
    UI.sheet('Auto opening', function (body, close) {
      var sell = rules();
      body.appendChild(el('p', 'sub', 'Chests open one after another. Pick what is kept and what is sold for coins right away, by rarity or card by card.'));
      var presets = el('div', 'as-presets');
      PRESETS.forEach(function (p) {
        var b = el('button', 'chip', esc(p[0])); b.type = 'button';
        onTap(b, function () {
          Sfx.click();
          ITEMS.forEach(function (it) { if (p[1](it)) sell[it.id] = true; else delete sell[it.id]; });
          Store.set('autoSell', sell); paint();
        });
        presets.appendChild(b);
      });
      body.appendChild(presets);
      var groups = el('div', ''); body.appendChild(groups);
      var foot = el('div', 'sheet-foot'), sum = el('div', 'as-sum');
      var go = el('button', 'btn big block gold', 'Start auto opening'); go.type = 'button'; go.id = 'autoStart';
      onTap(go, function () { started = true; close(); });
      foot.appendChild(sum); foot.appendChild(go);
      body.parentNode.appendChild(foot);

      function paint() {
        groups.innerHTML = '';
        var nSellAll = 0;
        RARITY_ORDER.forEach(function (k) {
          var R = RARITY[k], items = ITEMS.filter(function (it) { return it.rarity === k; });
          var nSell = items.filter(function (it) { return sell[it.id]; }).length;
          var mode = nSell === 0 ? 'keep' : nSell === items.length ? 'sell' : 'mixed';
          nSellAll += nSell;
          var g = el('div', 'as-group r-' + k);
          var head = el('div', 'as-head', '<div class="grow"><div class="nm">' + R.name.toUpperCase() + '</div><div class="d">' + fmtPct(R.chance) + ' of chests · sells ' + fmt(R.sell) + (mode === 'mixed' ? ' · mixed' : '') + '</div></div>');
          var seg = el('div', 'seg ks');
          [['keep', 'Keep'], ['sell', 'Sell']].forEach(function (o) {
            var b = el('button', o[0] + (mode === o[0] ? ' on' : ''), o[1]); b.type = 'button'; b.dataset.r = k; b.dataset.m = o[0];
            b.setAttribute('aria-pressed', mode === o[0] ? 'true' : 'false');
            onTap(b, function () {
              Sfx.click();
              items.forEach(function (it) { if (o[0] === 'sell') sell[it.id] = true; else delete sell[it.id]; });
              Store.set('autoSell', sell); paint();
            });
            seg.appendChild(b);
          });
          head.appendChild(seg); g.appendChild(head);
          var cards = el('div', 'as-cards');
          items.forEach(function (it) {
            var s = !!sell[it.id];
            var c = el('button', 'as-card' + (s ? ' sell' : ''), '<span class="n">' + esc(it.name) + '</span><span class="s">' + (s ? 'Sell' : 'Keep') + '</span>');
            c.type = 'button'; c.dataset.id = it.id; c.setAttribute('aria-label', it.name + ': ' + (s ? 'sell' : 'keep'));
            onTap(c, function () {
              Sfx.click();
              if (sell[it.id]) delete sell[it.id]; else sell[it.id] = true;
              Store.set('autoSell', sell); paint();
            });
            cards.appendChild(c);
          });
          g.appendChild(cards); groups.appendChild(g);
        });
        var keep = ITEMS.length - nSellAll;
        sum.innerHTML = nSellAll === 0 ? 'Every pull is <b>kept</b>' : keep === 0 ? 'Every pull is <b>sold</b> for coins'
          : '<b>' + keep + '</b> card' + (keep === 1 ? '' : 's') + ' kept · <b>' + nSellAll + '</b> sold for coins';
      }
      paint();
    }, { onClose: function () { if (started && onStart) onStart(); } });
  }
  return { open: open };
})();

var RunSheet = (function () {
  function dur(ms) {
    var s = Math.max(1, Math.round(ms / 1000)), m = Math.floor(s / 60);
    return m ? m + ' min ' + (s % 60) + ' s' : s + ' s';
  }
  function open(r) {
    if (!r || !r.n) return;
    UI.sheet('Auto run', function (body, close) {
      var top = el('div', 'kv');
      top.innerHTML = '<div class="stat"><div class="k">Chests</div><div class="v num">' + fmt(r.n) + '</div></div>' +
        '<div class="stat"><div class="k">Kept</div><div class="v num">' + fmt(r.kept) + '</div></div>' +
        '<div class="stat"><div class="k">Coins</div><div class="v num"><span class="coin-ic sm"></span>+' + fmtShort(r.coins) + '</div></div>';
      body.appendChild(top);
      var bits = [];
      if (r.sold) bits.push(fmt(r.sold) + ' sold');
      if (r.news) bits.push(r.news + ' new for your index');
      if (r.t1 && r.t0) bits.push(dur(r.t1 - r.t0));
      if (bits.length) body.appendChild(el('div', 'run-sub', bits.join(' · ')));

      // by rarity
      var byR = {}, most = 1;
      RARITY_ORDER.forEach(function (k) { byR[k] = 0; });
      Object.keys(r.items).forEach(function (id) { var it = ITEM_BY_ID[id]; if (it) byR[it.rarity] += r.items[id].n; });
      RARITY_ORDER.forEach(function (k) { most = Math.max(most, byR[k]); });
      body.appendChild(el('div', 'run-h', 'By rarity'));
      var panel = el('div', 'panel'); panel.style.padding = '6px 10px';
      RARITY_ORDER.forEach(function (k) {
        var n = byR[k], R = RARITY[k];
        var row = el('div', 'rr r-' + k + (n ? '' : ' zero'), '<div class="nm"><i class="rdot"></i>' + R.name + '</div><div class="barw"><i style="width:' + (n / most * 100).toFixed(1) + '%"></i></div>' +
          '<div class="c">' + fmt(n) + '<small>' + fmtPct(n / r.n * 100) + '</small></div>');
        panel.appendChild(row);
      });
      body.appendChild(panel);

      // every card of the run
      body.appendChild(el('div', 'run-h', 'What you got'));
      var list = el('div', '');
      ITEMS.forEach(function (it) {
        var x = r.items[it.id]; if (!x) return;
        var R = RARITY[it.rarity], last = it.name.split(' ').pop();
        var row = el('div', 'inv-item r-' + it.rarity, '<div class="av">' + esc(last.charAt(0)) + '</div>' +
          '<div class="grow"><div class="nm">' + esc(it.name) + '</div><div class="meta"><b>' + R.name + '</b><span class="cnt">×' + x.n + '</span></div></div>' +
          '<div class="run-st">' + (x.kept ? '<span class="k">Kept ×' + x.kept + '</span>' : '') + (x.sold ? '<span class="s">Sold ×' + x.sold + ' · +' + fmtShort(x.sold * it.sell) + '</span>' : '') + '</div>');
        row.style.animation = 'none';
        list.appendChild(row);
      });
      body.appendChild(list);
      var foot = el('div', 'sheet-foot'), row2 = el('div', 'row');
      var inv = el('button', 'btn grow', 'Inventory'), ok = el('button', 'btn grow gold', 'Done'); inv.type = ok.type = 'button'; ok.id = 'runDone';
      onTap(inv, function () { Sfx.click(); close(); UI.go('inv'); });
      onTap(ok, function () { Sfx.click(); close(); });
      row2.appendChild(inv); row2.appendChild(ok); foot.appendChild(row2);
      body.parentNode.appendChild(foot);
    });
  }
  return { open: open };
})();
