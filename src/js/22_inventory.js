// Inventory: list, filters, selling ------------------------------------------------------------------
var Inventory = (function () {
  var root, filter = 'all', dirty = true, shownKey = '', liveTimer = 0;
  function totals() {
    var n = 0, val = 0, kinds = 0, inv = Store.s.inv;
    for (var id in inv) { n += inv[id]; val += inv[id] * ITEM_BY_ID[id].sell; kinds++; }
    return { n: n, val: val, kinds: kinds };
  }
  // howMany(item, count) -> number of copies to sell
  function sellMany(howMany, label) {
    var inv = Store.s.inv, plan = [], gain = 0, cnt = 0;
    Object.keys(inv).forEach(function (id) {
      var free = Store.free(id);                                   // copies in a trade offer stay where they are
      var n = Math.min(free, Math.max(0, howMany(ITEM_BY_ID[id], free) | 0));
      if (n > 0) { plan.push([id, n]); cnt += n; gain += n * ITEM_BY_ID[id].sell; }
    });
    if (!cnt) { UI.toast('Nothing to sell'); Sfx.deny(); return; }
    UI.confirm(label, 'Sell ' + fmt(cnt) + ' item' + (cnt > 1 ? 's' : '') + ' for ' + fmt(gain) + ' coins?', 'Sell').then(function (ok) {
      if (!ok) return;
      var got = 0;
      plan.forEach(function (p) { got += Store.sell(p[0], p[1]); });
      Sfx.coin(5); UI.toast('<span class="coin-ic sm"></span> +' + fmt(got), 'win');
    });
  }
  function render(live) {
    if (!root) return;
    dirty = false;
    var key = filter + '|' + JSON.stringify(Store.s.inv) + '|' + Object.keys(Store.s.found).length + '|' + JSON.stringify(Store.held.items);
    if (live && key === shownKey) return;          // e.g. a pull that auto opening sold straight away
    shownKey = key;
    root.classList.toggle('quiet', !!live);
    var T = totals(), inv = Store.s.inv;
    var html = '<div class="scroll">' +
      '<div class="inv-top"><div><h1 class="h1">Inventory</h1><div class="sub" style="margin-top:6px">Sell what you pull to get coins for the games.</div></div></div>' +
      '<div class="inv-stats"><div class="stat"><div class="k">Items</div><div class="v">' + fmt(T.n) + '</div></div>' +
      '<div class="stat"><div class="k">Worth</div><div class="v"><span class="coin-ic sm"></span>' + fmtShort(T.val) + '</div></div>' +
      '<div class="stat"><div class="k">Found</div><div class="v">' + ITEMS.filter(function (it) { return Store.s.found[it.id]; }).length + '/' + ITEMS.length + '</div></div></div>';
    if (!T.n) {
      html += '<div class="empty"><b>Nothing here yet</b>Open a chest and your pulls land here.<div style="margin-top:16px"><button class="btn gold" type="button" id="invGo">Open a chest</button></div></div></div>';
      root.innerHTML = html;
      onTap($('#invGo', root), function () { Sfx.click(); UI.go('chest'); });
      return;
    }
    html += '<div class="filters" id="invFilters"><button type="button" class="chip' + (filter === 'all' ? ' on' : '') + '" data-f="all">All</button>' +
      '<button type="button" class="chip' + (filter === 'mut' ? ' on' : '') + '" data-f="mut">✨ Mutated</button>' +
      RARITY_ORDER.map(function (k) { return '<button type="button" class="chip' + (filter === k ? ' on' : '') + '" data-f="' + k + '"><i class="rdot" style="--rc:' + RARITY[k].color + '"></i>' + RARITY[k].name + '</button>'; }).join('') + '</div>' +
      '<div class="row" style="margin-bottom:12px"><button class="btn sm grow" type="button" id="sellDupes">Sell duplicates</button><button class="btn sm grow" type="button" id="sellCommon">Sell commons</button><button class="btn sm grow red" type="button" id="sellAll">Sell all</button></div><div id="invList">';
    var shown = 0;
    ALL_CARDS.forEach(function (it) {
      var n = inv[it.id]; if (!n) return;
      if (filter === 'mut' ? !it.mut : filter !== 'all' && it.rarity !== filter) return;
      shown++;
      var R = RARITY[it.rarity], last = it.name.split(' ').pop(), free = Store.free(it.id), held = n - free;
      html += '<div class="inv-item r-' + it.rarity + mutCls(it) + '" style="animation-delay:' + Math.min(shown * 18, 240) + 'ms"><div class="av">' + esc(last.charAt(0)) + '</div>' +
        '<div class="grow"><div class="nm">' + esc(it.name) + '</div><div class="meta"><b>' + R.name + '</b>' + (it.mut ? mutTag(it) : '<span>' + fmtPct(it.chance) + '</span>') + '<span class="cnt">×' + n + '</span>' +
        (held ? '<span class="held">' + held + ' in a trade</span>' : '') + '</div></div>' +
        '<div class="inv-acts"><button class="btn sm" type="button" data-sell="' + it.id + '" data-n="1"' + (free ? '' : ' disabled') + '><span class="coin-ic sm"></span>' + fmtShort(it.sell) + '</button>' +
        (free > 1 ? '<button class="btn sm gold" type="button" data-sell="' + it.id + '" data-n="' + free + '">All ' + fmtShort(it.sell * free) + '</button>' : '') + '</div></div>';
    });
    if (!shown) html += '<div class="empty"><b>No ' + (filter === 'mut' ? 'mutated' : RARITY[filter].name.toLowerCase()) + ' items</b>' + (filter === 'mut' ? 'One chest in ten comes out mutated.' : 'Try another filter.') + '</div>';
    html += '</div><div class="note">Selling is instant and final.</div></div>';
    var sc = $('.scroll', root), top = sc ? sc.scrollTop : 0;
    root.innerHTML = html;
    $('.scroll', root).scrollTop = top;
    $$('#invFilters .chip', root).forEach(function (c) { onTap(c, function () { Sfx.click(); filter = c.dataset.f; render(); }); });
    $$('[data-sell]', root).forEach(function (b) {
      onTap(b, function () {
        var id = b.dataset.sell, n = +b.dataset.n, g = Store.sell(id, n);
        if (g) { Sfx.coin(Math.min(n, 4)); UI.toast('<span class="coin-ic sm"></span> +' + fmt(g), 'win', 1300); }
      });
    });
    onTap($('#sellDupes', root), function () { sellMany(function (it, n) { return n - 1; }, 'Sell duplicates'); });
    onTap($('#sellCommon', root), function () { sellMany(function (it, n) { return it.rarity === 'common' && !it.mut ? n : 0; }, 'Sell commons'); });
    onTap($('#sellAll', root), function () { sellMany(function (it, n) { return n; }, 'Sell everything'); });
  }
  return {
    init: function () {
      root = $('#view-inv');
      Store.on(function (what) {
        if (what !== 'inv') return;
        if (UI.view !== 'inv') { dirty = true; return; }
        clearTimeout(liveTimer); liveTimer = setTimeout(function () { render(true); }, 120);     // grant + sell arrive as two events
      });
      UI.onView(function (v) { if (v === 'inv') render(); });
    }
  };
})();
