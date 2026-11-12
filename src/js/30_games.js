// Games shell: tabs, shared bet control ---------------------------------------------------------------
var Games = (function () {
  var list = [], active = null, host, tabs, mounted = {};
  var ICONS = {
    rug: '<svg viewBox="0 0 24 24"><path d="M3 17.500l5.500-6 4 3.500 7-8.500V11h1.500V4H14v1.500h3.900l-5.600 6.800-4-3.500L2 15.800z"/><path d="M3 20h18v1.500H3z"/></svg>',
    chicken: '<svg viewBox="0 0 24 24"><path d="M13 3c1 0 1.800.600 2.100 1.500.700-.300 1.600.100 1.900.900.300.800-.100 1.500-.700 1.900C18.500 8.400 20 10.700 20 13.500 20 17.600 16.600 20 12.500 20c-.400 0-.800 0-1.200-.100L11 22H9.500l.300-2.400C7 18.700 5 16.300 5 13.500c0-1 .200-1.900.600-2.700L3 10l2.500-1.500C6.800 6.500 9 5.200 11.300 5 11.300 3.900 12 3 13 3zm-2.500 6a1.200 1.200 0 1 0 0 2.400 1.200 1.200 0 0 0 0-2.400z"/></svg>',
    mines: '<svg viewBox="0 0 24 24"><circle cx="11" cy="14" r="7"/><path d="M15.500 8.500l2-2 1.500 1.500-2 2zM19 3l.700 1.800L21.500 5.500l-1.800.700L19 8l-.700-1.800L16.500 5.500l1.800-.700z"/></svg>',
    bj: '<svg viewBox="0 0 24 24"><path d="M5 3.500h9A1.500 1.500 0 0 1 15.500 5v12A1.500 1.500 0 0 1 14 18.500H5A1.500 1.500 0 0 1 3.500 17V5A1.500 1.500 0 0 1 5 3.500zm4.500 4.200c-1.700 1.600-3 2.700-3 4.100 0 1 .800 1.700 1.700 1.700.500 0 1-.200 1.300-.600V14h.0v.500H8.500v1h3v-1h-1v-1.600c.300.400.800.600 1.300.600.900 0 1.700-.700 1.700-1.700 0-1.400-1.300-2.500-3-4.100z"/><path d="M17 6.200l2.700.700a1.500 1.500 0 0 1 1.100 1.800l-2.900 11.200a1.500 1.500 0 0 1-1.800 1.100L9.500 19.500H14A3 3 0 0 0 17 16.500z"/></svg>',
    flip: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6.500v11M9.500 9h3.700a1.800 1.800 0 0 1 0 3.600H10.700a1.800 1.800 0 0 0 0 3.600h3.800" fill="none" stroke="#0b0a10" stroke-width="1.600" stroke-linecap="round"/></svg>'
  };
  function show(id) {
    if (active === id) return;
    if (active && mounted[active] && mounted[active].hide) mounted[active].hide();
    active = id;
    $$('button', tabs).forEach(function (b) { b.classList.toggle('on', b.dataset.g === id); });
    $$('.game', host).forEach(function (g) { g.classList.toggle('on', g.dataset.g === id); });
    var def = list.filter(function (g) { return g.id === id; })[0];
    if (!mounted[id]) { var pane = $('.game[data-g="' + id + '"]', host); mounted[id] = def.mount(pane) || {}; }
    if (mounted[id].show) mounted[id].show();
    var tb = $('button[data-g="' + id + '"]', tabs);
    if (tb && tb.scrollIntoView) { try { tb.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } catch (e) {} }
  }
  // Shared bet input with half / double / max.
  function BetCtl(key, start) {
    var value = start || 10, locked = false;
    var wrap = el('div', 'bet');
    wrap.innerHTML = '<div class="lbl"><span>Bet amount</span><span class="num" data-bal></span></div>' +
      '<div class="bet-in"><span class="coin-ic"></span><input type="text" inputmode="numeric" autocomplete="off" id="bet-' + key + '" aria-label="Bet amount">' +
      '<button type="button" data-a="half">½</button><button type="button" data-a="dbl">2×</button><button type="button" data-a="max">MAX</button></div>';
    var input = $('input', wrap), bal = $('[data-bal]', wrap);
    function paint() { input.value = fmt(value); bal.textContent = 'Balance ' + fmt(Store.s.coins); }
    function set(v) { value = Math.max(1, Math.min(Math.floor(v) || 1, Math.max(1, Store.s.coins))); paint(); }
    input.addEventListener('input', function () { var n = parseInt(input.value.replace(/[^0-9]/g, ''), 10); value = Math.max(1, n || 1); });
    input.addEventListener('blur', function () { set(value); });
    input.addEventListener('focus', function () { input.select(); });
    $$('button', wrap).forEach(function (b) {
      onTap(b, function () {
        if (locked) return; Sfx.click();
        if (b.dataset.a === 'half') set(value / 2); else if (b.dataset.a === 'dbl') set(value * 2); else set(Store.s.coins);
      });
    });
    Store.on(function (w) { if (w === 'coins') bal.textContent = 'Balance ' + fmt(Store.s.coins); });
    paint();
    return {
      el: wrap,
      get: function () { return Math.max(1, Math.floor(value)); },
      set: set,
      lock: function (on) { locked = on; wrap.classList.toggle('locked', on); input.disabled = on; },
      // Takes the stake from the balance; explains itself when that is not possible.
      take: function () {
        var v = Math.max(1, Math.floor(value));
        if (Store.s.coins <= 0) { Sfx.deny(); UI.toast('No coins yet. Sell items from your inventory.'); return 0; }
        if (v > Store.s.coins) { Sfx.deny(); UI.toast('Not enough coins. Your balance is ' + fmt(Store.s.coins) + '.'); set(Store.s.coins); return 0; }
        return Store.spend(v) ? v : 0;
      }
    };
  }
  function payout(amount, mult, label) {
    Store.addCoins(amount, 'win');
    if (mult > Store.s.stats.bestMult) { Store.s.stats.bestMult = mult; Store.save(); }
    UI.toast('<span class="coin-ic sm"></span> +' + fmt(amount) + (label ? ' · ' + label : ''), 'win');
  }
  return {
    BetCtl: BetCtl, payout: payout,
    register: function (def) { list.push(def); },
    init: function () {
      var root = $('#view-games');
      tabs = el('div', 'game-tabs'); tabs.setAttribute('role', 'tablist');
      host = el('div', 'game-host');
      list.forEach(function (g) {
        var b = el('button', '', ICONS[g.icon] + '<span>' + esc(g.title) + '</span>'); b.type = 'button'; b.dataset.g = g.id; b.setAttribute('role', 'tab');
        onTap(b, function () { Sfx.tab(); show(g.id); });
        tabs.appendChild(b);
        var pane = el('div', 'game'); pane.dataset.g = g.id; host.appendChild(pane);
      });
      root.appendChild(tabs); root.appendChild(host);
      UI.onView(function (v) {
        if (v === 'games') { if (!active) show(list[0].id); else if (mounted[active] && mounted[active].show) mounted[active].show(); }
        else if (active && mounted[active] && mounted[active].hide) mounted[active].hide();
      });
    },
    get active() { return active; }, show: show
  };
})();
