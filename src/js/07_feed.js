// What everybody gets told: "Mia got Frau Hübner in Epic!" slides in under the top bar, on every tab.
// Announced are epics, legendaries and the rarest mutations (Diamond and up) on any card.
var Feed = (function () {
  var host = null, queue = [], showing = false;
  function worthy(item) { return RARITY[item.rarity].tier >= 3 || !!(item.mut && item.mut.mult >= 8); }
  function next() {
    if (showing || !queue.length) return;
    showing = true;
    var a = queue.shift(), it = a.item, R = RARITY[it.rarity];
    if (!host) { host = el('div', 'feed'); host.id = 'feed'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    var b = el('div', 'ann r-' + it.rarity + mutCls(it),
      '<span class="ann-ic">' + (it.mut ? it.mut.icon : '★') + '</span><span class="ann-t"><b class="who">' + esc(a.name) + '</b> got <b>' + esc(cardName(it, true)) + '</b> in <b class="rar">' + R.name + '</b>!</span>');
    host.appendChild(b);
    void b.offsetWidth; b.classList.add('on');
    if (!a.mine) Sfx.gem(R.tier >= 4 ? 14 : 9);
    setTimeout(function () {
      b.classList.remove('on');
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); showing = false; next(); }, 360);
    }, a.mine ? 3400 : 4800);
  }
  function show(name, item, mine) {
    if (!item) return;
    queue.push({ name: name, item: item, mine: !!mine });
    if (queue.length > 5) queue.shift();
    next();
  }
  return {
    worthy: worthy, show: show,
    // my own pull: shown here at once, and sent to everybody else
    mine: function (item) {
      if (!Net.enabled || !Net.user || !worthy(item)) return;
      Net.announce(item); show(Net.user.name, item, true);
    },
    init: function () {
      Net.on(function (what, f) { if (what === 'feed' && f && ITEM_BY_ID[f.item]) show(String(f.name || 'Somebody'), ITEM_BY_ID[f.item], false); });
    }
  };
})();
