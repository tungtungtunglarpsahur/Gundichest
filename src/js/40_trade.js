// Trade tab: find players, send and answer requests, the trade room, the history.
// Also the bar under the top bar that shows a waiting request on every tab.
//
// A trade: one player asks, the other accepts the request, a room opens. Each puts cards and coins on their
// side. Both press ACCEPT, then both press CONFIRM; the server swaps everything in one go. Any change to an
// offer takes all accepts back.
var Trade = (function () {
  var root, bar;
  var inbox = [], sent = [], open = null;          // from the heartbeat: requests for me, my requests, my open trade
  var cur = null;                                  // the trade the room shows: open, or the one that just finished
  var screen = 'lobby';                            // 'lobby' | 'room' | 'done'
  var draft = null, draftTimer = 0, sending = false, stepping = false;
  var lockUntil = 0, lockTimer = 0, notice = '';
  var people = [], query = '', searchTimer = 0, searchSeq = 0, loadedPeople = false, searchFailed = false, pending = {};
  var built = '';                                  // which screen the DOM currently holds
  var seenInbox = {}, firstPoll = true;

  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function offerValue(o) {
    var v = (o && o.coins) || 0;
    Object.keys((o && o.items) || {}).forEach(function (id) { if (ITEM_BY_ID[id]) v += ITEM_BY_ID[id].sell * o.items[id]; });
    return v;
  }
  function offerCount(o) { var n = 0; Object.keys((o && o.items) || {}).forEach(function (id) { n += o.items[id]; }); return n; }
  function sameOffer(a, b) { return offerKey(a) === offerKey(b); }
  function offerKey(o) { return ITEMS.map(function (it) { return (o.items || {})[it.id] || 0; }).join(',') + '|' + (o.coins || 0); }
  // How good the trade is for the side that gives `give` and gets `get`, in percent of what they give.
  function fairness(give, get) {
    if (give <= 0) return get > 0 ? Infinity : 0;
    return (get - give) / give * 100;
  }
  function fmtFair(p) {
    if (p === Infinity) return '+∞';
    var r = Math.round(p);
    if (r > 999) return '+999%';
    return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r) + '%';
  }
  function fairClass(p) { return p > 5 ? 'good' : p < -5 ? 'bad' : 'even'; }
  function hue(name) { var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; }
  function avatar(name, cls) { return '<span class="ava' + (cls ? ' ' + cls : '') + '" style="--h:' + hue(name) + '" aria-hidden="true">' + esc(name.charAt(0).toUpperCase()) + '</span>'; }
  function ago(sec) {
    if (sec < 90) return '1 min ago';
    if (sec < 3600) return Math.round(sec / 60) + ' min ago';
    if (sec < 86400) return Math.round(sec / 3600) + ' h ago';
    return Math.round(sec / 86400) + ' d ago';
  }
  function when(ms) {
    try { return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function presence(u) { return '<span class="pres' + (u.online ? ' on' : '') + '"><i></i>' + (u.online ? 'online' : u.idle != null ? ago(u.idle) : 'offline') + '</span>'; }
  function chips(o, emptyText) {
    var html = '';
    ITEMS.forEach(function (it) {
      var n = (o.items || {})[it.id]; if (!n) return;
      html += '<span class="tchip r-' + it.rarity + '"><b>' + esc(shortName(it.name)) + '</b>' + (n > 1 ? '<i>×' + n + '</i>' : '') + '</span>';
    });
    if (o.coins) html += '<span class="tchip coins"><span class="coin-ic sm"></span><b>' + fmt(o.coins) + '</b></span>';
    return html || '<span class="tr-none">' + esc(emptyText || 'Nothing') + '</span>';
  }

  // ---- what my offer holds back in the rest of the game -------------------------------------------------
  function hold() {
    if (!cur || cur.status !== 'open') { Store.hold(null); return; }
    var a = cur.me.offer, b = draft || a, items = {};
    ITEMS.forEach(function (it) { var n = Math.max((a.items || {})[it.id] || 0, (b.items || {})[it.id] || 0); if (n) items[it.id] = n; });
    Store.hold({ items: items, coins: Math.max(a.coins || 0, b.coins || 0) });
  }
  function watch() {
    if (cur && cur.status === 'open') Net.watch({ id: cur.id, ver: cur.ver });
    else if (open) Net.watch({ id: open.id, ver: -1 });
    else Net.watch(null);
  }

  // ---- requests -----------------------------------------------------------------------------------------
  function ask(user, btn) {
    if (pending['u' + user.id]) return;
    pending['u' + user.id] = true; if (btn) btn.disabled = true;
    Net.call('trade.request', { to: user.id }).then(function (r) {
      delete pending['u' + user.id];
      Sfx.click();
      if (r.trade.status === 'open') { UI.toast('Trade with ' + esc(r.trade.with.name) + ' is open', 'win'); enter(r.trade); }
      else {
        sentIds[r.trade.id] = true;
        if (!sent.some(function (s) { return s.id === r.trade.id; })) sent.unshift({ id: r.trade.id, with: r.trade.with, at: r.trade.created });
        UI.toast(r.already ? 'You already asked ' + esc(user.name) : 'Request sent to ' + esc(user.name));
        paintLobby(); Net.pollNow();
      }
    }, function (e) { delete pending['u' + user.id]; if (btn) btn.disabled = false; Sfx.deny(); UI.toast(esc(e.message), 'loss'); });
  }
  function answer(req, accept, btn) {
    if (pending['t' + req.id]) return;
    pending['t' + req.id] = true; if (btn) btn.disabled = true;
    Net.call('trade.respond', { id: req.id, accept: accept }).then(function (r) {
      delete pending['t' + req.id];
      inbox = inbox.filter(function (x) { return x.id !== req.id; });
      if (accept) { Sfx.tierUp(1); enter(r.trade); } else { Sfx.click(); UI.toast('Request from ' + esc(req.with.name) + ' declined'); }
      paintBar(); paintLobby(); Net.pollNow();
    }, function (e) {
      delete pending['t' + req.id]; if (btn) btn.disabled = false;
      if (e.code === 'gone') inbox = inbox.filter(function (x) { return x.id !== req.id; });
      Sfx.deny(); UI.toast(esc(e.message), 'loss'); paintBar(); paintLobby(); Net.pollNow();
    });
  }
  function takeBack(req, btn) {
    if (btn) btn.disabled = true;
    Net.call('trade.cancel', { id: req.id }).then(function () {
      sent = sent.filter(function (x) { return x.id !== req.id; });
      Sfx.click(); UI.toast('Request to ' + esc(req.with.name) + ' cancelled'); paintLobby();
    }, function (e) { if (btn) btn.disabled = false; UI.toast(esc(e.message), 'loss'); Net.pollNow(); });
  }
  // Puts the page into the room of this trade.
  function enter(t) {
    onTrade(t);
    if (UI.view !== 'trade') UI.go('trade');
  }

  // ---- the room -------------------------------------------------------------------------------------------
  function onTrade(t) {
    var prev = cur && cur.id === t.id ? cur : null;
    if (t.status === 'gone') {
      if (cur && cur.id === t.id && cur.status === 'open') { cur = null; draft = null; screen = 'lobby'; UI.toast('That trade no longer exists.'); }
      open = null; hold(); watch(); render(); return;
    }
    if (cur && cur.id !== t.id && screen === 'done' && t.status !== 'open') return;       // still looking at the last result
    if (prev && (t.ver < prev.ver || (prev.ver === t.ver && prev.status === t.status))) return;       // nothing new, or an answer that arrived late
    if (t.status === 'open') {
      if (prev && prev.status === 'open' && !sameOffer(prev.them.offer, t.them.offer)) {
        lockUntil = Date.now() + 1800; notice = esc(t.with.name) + ' changed the offer. Check it before you accept.';
        clearTimeout(lockTimer); lockTimer = setTimeout(function () { paintRoom(); }, 1850);
        if (UI.view === 'trade') { Sfx.tick(3); haptic(20); }
      } else if (prev && prev.status === 'open' && prev.ov !== t.ov) {
        notice = prev.me.step || prev.them.step ? 'The offer changed, so the accepts were taken back.' : '';
      } else if (prev && prev.status === 'open' && prev.them.step > 0 && t.them.step === 0 && prev.ov === t.ov) notice = esc(t.with.name) + ' took the accept back.';
      if (prev && prev.status === 'open' && prev.me.step === 1 && prev.them.step < 1 && t.them.step >= 1 && t.me.step === 1) {
        lockUntil = Date.now() + 1200; clearTimeout(lockTimer); lockTimer = setTimeout(function () { paintRoom(); }, 1250);       // no confirming by a stray double tap
      }
      if (!prev) { draft = null; notice = ''; }
      cur = t; screen = 'room';
      if (draft && sameOffer(draft, t.me.offer)) draft = null;
    } else if (t.status === 'done') {
      var was = prev && prev.status === 'open';
      cur = t; draft = null; open = null; screen = 'done';
      Net.syncNow(true).catch(function () {});               // books the cards and coins into the local save
      if (was || !prev) {
        Sfx.win(true); haptic([30, 40, 80]);
        if (UI.view !== 'trade') UI.toast('Trade with ' + esc(t.with.name) + ' complete', 'win', 3200);
      }
    } else {
      // cancelled, declined or timed out
      if (prev && prev.status === 'open') {
        UI.toast(t.status === 'expired' ? 'The trade with ' + esc(t.with.name) + ' timed out.' : t.endedBy === 'me' ? 'You left the trade.' : esc(t.with.name) + ' left the trade.');
      }
      if (cur && cur.id === t.id) { cur = null; draft = null; screen = 'lobby'; }
      open = null;
    }
    hold(); watch(); render();
  }
  function editOffer(change) {
    if (!cur || cur.status !== 'open') return;
    if (!draft) draft = copy(cur.me.offer);
    change(draft);
    // never more than the player has
    Object.keys(draft.items).forEach(function (id) {
      var n = Math.max(0, Math.min(draft.items[id] | 0, Store.s.inv[id] || 0));
      if (n) draft.items[id] = n; else delete draft.items[id];
    });
    draft.coins = Math.max(0, Math.min(Math.floor(draft.coins) || 0, Store.s.coins));
    if (sameOffer(draft, cur.me.offer) && !sending) { draft = null; clearTimeout(draftTimer); }
    else { clearTimeout(draftTimer); draftTimer = setTimeout(pushOffer, 450); }
    hold(); paintRoom();
  }
  function pushOffer() {
    clearTimeout(draftTimer);
    if (!draft || !cur || cur.status !== 'open') return Promise.resolve();
    if (sending) return sending;
    var d = copy(draft), id = cur.id;
    sending = Net.syncNow().catch(function () {}).then(function () {
      return Net.call('trade.offer', { id: id, items: d.items, coins: d.coins });
    }).then(function (r) {
      sending = false;
      if (draft && sameOffer(draft, d)) draft = null;
      onTrade(r.trade); paintRoom();
      if (draft) return pushOffer();
    }, function (e) {
      sending = false; draft = null;
      if (e.body && e.body.trade) onTrade(e.body.trade);
      UI.toast(esc(e.message), 'loss'); hold(); paintRoom(); Net.pollNow();
    });
    return sending;
  }
  function doStep(step) {
    if (!cur || cur.status !== 'open' || stepping) return;
    stepping = true; paintRoom();
    var id = cur.id;
    pushOffer().then(function () { return Net.syncNow().catch(function () {}); }).then(function () {
      if (!cur || cur.id !== id) throw { message: 'This trade is no longer open.' };
      return Net.call('trade.step', { id: id, step: step, ov: cur.ov });
    }).then(function (r) {
      stepping = false;
      if (step === 1) { Sfx.tierUp(1); haptic(20); notice = ''; } else if (step === 0) { Sfx.click(); notice = ''; }
      onTrade(r.trade); paintRoom();
    }, function (e) {
      stepping = false;
      if (e.body && e.body.trade) onTrade(e.body.trade);
      Sfx.deny(); UI.toast(esc(e.message || 'That did not work.'), 'loss'); paintRoom(); Net.pollNow();
    });
  }
  function leave() {
    if (!cur) return;
    var t = cur;
    UI.confirm('Leave this trade?', 'Nothing changes hands. ' + esc(t.with.name) + ' is told that you left.', 'Leave', true).then(function (ok) {
      if (!ok || !cur || cur.id !== t.id) return;
      Net.call('trade.cancel', { id: t.id }).then(function (r) { onTrade(r.trade); }, function (e) {
        if (e.body && e.body.trade) onTrade(e.body.trade); else UI.toast(esc(e.message), 'loss');
        Net.pollNow();
      });
    });
  }

  function buildRoom() {
    var t = cur;
    root.innerHTML =
      '<div class="tr-room">' +
        '<div class="tr-head"><button class="btn sm" type="button" id="trLeave">Leave</button>' +
          '<div class="tr-with"><div class="tr-who"><b>' + esc(t.with.name) + '</b><div id="trPres"></div></div>' + avatar(t.with.name) + '</div></div>' +
        '<div class="tr-body">' +
          '<section class="tr-side" aria-label="' + esc(t.with.name) + ' gives"><header><span>' + esc(t.with.name) + ' gives</span><b class="num" id="trTheirVal"></b></header><div class="tr-cards" id="trTheirs"></div></section>' +
          '<div class="tr-mid">' +
            '<div class="tr-fair"><div class="tf" id="trFairMe"><small>For you</small><b>0%</b></div>' +
              '<div class="tf-mid"><div class="tf-bar" id="trBar"><i></i><i></i></div><div class="tf-say" id="trSay"></div></div>' +
              '<div class="tf" id="trFairThem"><small>For ' + esc(t.with.name) + '</small><b>0%</b></div></div>' +
            '<div class="tr-acc"><div class="tr-pips" id="trPipsMe"><span><i></i><i></i></span><small>You</small></div>' +
              '<button class="fn-btn fn-green" type="button" id="trAccept"><span>ACCEPT</span></button>' +
              '<div class="tr-pips" id="trPipsThem"><span><i></i><i></i></span><small>' + esc(t.with.name) + '</small></div></div>' +
            '<div class="tr-hint" id="trHint" aria-live="polite"></div>' +
          '</div>' +
          '<section class="tr-side mine" aria-label="You give"><header><span>You give</span><b class="num" id="trMyVal"></b></header><div class="tr-cards" id="trMine"></div>' +
            '<div class="tr-edit"><button class="btn sm gold" type="button" id="trAdd">Add cards</button>' +
              '<label class="tr-coins"><span class="coin-ic sm"></span><input id="trCoins" type="text" inputmode="numeric" autocomplete="off" placeholder="Coins" aria-label="Coins you give"><button type="button" id="trCoinsMax">MAX</button></label></div>' +
          '</section>' +
          '<div class="note">Both players accept, then both confirm. Only then cards and coins change hands.</div>' +
        '</div>' +
      '</div>';
    built = 'room:' + t.id;
    onTap($('#trLeave', root), function () { Sfx.click(); leave(); });
    onTap($('#trAdd', root), function () { Sfx.click(); picker(); });
    onTap($('#trAccept', root), function () {
      if (!cur) return;
      var me = cur.me.step, them = cur.them.step;
      if (me === 0) doStep(1); else if (me === 1 && them >= 1) doStep(2);
    });
    var coins = $('#trCoins', root);
    coins.addEventListener('input', function () {
      var n = parseInt(coins.value.replace(/[^0-9]/g, ''), 10) || 0;
      editOffer(function (d) { d.coins = n; });
    });
    coins.addEventListener('blur', function () { paintRoom(); });
    coins.addEventListener('focus', function () { coins.select(); });
    onTap($('#trCoinsMax', root), function () { Sfx.click(); editOffer(function (d) { d.coins = Store.s.coins; }); });
    $('#trMine', root).addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-rm]') : null;
      if (!b) return;
      Sfx.click(); editOffer(function (d) { if (b.dataset.rm === 'coins') d.coins = 0; else delete d.items[b.dataset.rm]; });
    });
    $('#trHint', root).addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'trUndo') doStep(0);
    });
  }
  function paintRoom() {
    if (screen !== 'room' || !cur || UI.view !== 'trade') return;
    if (built !== 'room:' + cur.id) buildRoom();
    var t = cur, mine = draft || t.me.offer, theirs = t.them.offer;
    var give = offerValue(mine), get = offerValue(theirs);
    $('#trPres', root).innerHTML = presence(t.with);
    $('#trTheirVal', root).innerHTML = '<span class="coin-ic sm"></span>' + fmt(get);
    $('#trMyVal', root).innerHTML = '<span class="coin-ic sm"></span>' + fmt(give);
    $('#trTheirs', root).innerHTML = chips(theirs, t.with.name + ' has not added anything yet');
    // my side: every chip can be removed
    var html = '';
    ITEMS.forEach(function (it) {
      var n = (mine.items || {})[it.id]; if (!n) return;
      html += '<button type="button" class="tchip r-' + it.rarity + '" data-rm="' + it.id + '" aria-label="Remove ' + esc(it.name) + '"><b>' + esc(shortName(it.name)) + '</b>' + (n > 1 ? '<i>×' + n + '</i>' : '') + '<u>×</u></button>';
    });
    if (mine.coins) html += '<button type="button" class="tchip coins" data-rm="coins" aria-label="Remove coins"><span class="coin-ic sm"></span><b>' + fmt(mine.coins) + '</b><u>×</u></button>';
    $('#trMine', root).innerHTML = html || '<span class="tr-none">Add cards or coins you want to give</span>';
    var coins = $('#trCoins', root);
    if (document.activeElement !== coins) coins.value = mine.coins ? fmt(mine.coins) : '';
    // fairness: each side's gain or loss in percent of what that side gives
    var fm = fairness(give, get), ft = fairness(get, give), me = $('#trFairMe', root), th = $('#trFairThem', root);
    me.className = 'tf ' + fairClass(fm); th.className = 'tf ' + fairClass(ft);
    $('b', me).textContent = fmtFair(fm); $('b', th).textContent = fmtFair(ft);
    var total = give + get, barEl = $('#trBar', root);
    barEl.classList.toggle('empty', !total);
    barEl.children[0].style.width = (total ? give / total * 100 : 50) + '%';
    barEl.children[1].style.width = (total ? get / total * 100 : 50) + '%';
    $('#trSay', root).textContent = !total ? 'Nothing on the table yet' : give === 0 ? 'A gift from ' + t.with.name : get === 0 ? 'A gift from you'
      : Math.abs(fm) <= 5 ? 'About even' : fm > 0 ? 'Better for you' : 'Better for ' + t.with.name;
    // accept state
    var ms = t.me.step, ts = t.them.step, btn = $('#trAccept', root), label = $('span', btn), hint = $('#trHint', root);
    [['#trPipsMe', ms], ['#trPipsThem', ts]].forEach(function (p) {
      var dots = $$('i', $(p[0], root));
      dots[0].className = p[1] >= 1 ? 'on' : ''; dots[1].className = p[1] >= 2 ? 'on' : '';
    });
    var locked = Date.now() < lockUntil, saving = !!draft || !!sending, empty = !total;
    var undo = ' <button type="button" class="link" id="trUndo">Take it back</button>';
    btn.className = 'fn-btn ' + (ms === 1 && ts >= 1 ? 'fn-yellow' : 'fn-green');
    if (ms === 0) {
      label.textContent = 'ACCEPT';
      btn.disabled = empty || saving || locked || stepping;
      hint.innerHTML = empty ? 'Put cards or coins on the table to start.' : saving ? 'Saving your offer…' : notice || (ts >= 1 ? esc(t.with.name) + ' accepted. Your turn.' : 'Accept when the trade looks right to you.');
    } else if (ms === 1 && ts < 1) {
      label.textContent = 'WAITING'; btn.disabled = true;
      hint.innerHTML = 'You accepted. Waiting for ' + esc(t.with.name) + '.' + undo;
    } else if (ms === 1) {
      label.textContent = 'CONFIRM'; btn.disabled = locked || stepping || saving;
      hint.innerHTML = (ts === 2 ? esc(t.with.name) + ' confirmed. ' : 'Both accepted. ') + 'Confirm to make the trade.' + undo;
    } else {
      label.textContent = 'WAITING'; btn.disabled = true;
      hint.innerHTML = 'You confirmed. Waiting for ' + esc(t.with.name) + '.' + undo;
    }
  }
  // Sheet for choosing cards: every card the player owns with a count stepper.
  function picker() {
    if (!cur || cur.status !== 'open') return;
    UI.sheet('Add cards', function (body, close) {
      var list = el('div', ''), foot = el('div', 'sheet-foot'), sum = el('div', 'as-sum');
      var done = el('button', 'btn big block gold', 'Done'); done.type = 'button'; done.id = 'trPickDone';
      onTap(done, function () { Sfx.click(); close(); });
      foot.appendChild(sum); foot.appendChild(done);
      body.appendChild(list); body.parentNode.appendChild(foot);
      function paint() {
        var o = draft || (cur ? cur.me.offer : { items: {}, coins: 0 }), inv = Store.s.inv, html = '', any = false;
        ITEMS.forEach(function (it) {
          var have = inv[it.id] || 0; if (!have) return;
          any = true;
          var n = (o.items || {})[it.id] || 0, last = it.name.split(' ').pop();
          html += '<div class="inv-item r-' + it.rarity + (n ? ' picked' : '') + '" style="animation:none"><div class="av">' + esc(last.charAt(0)) + '</div>' +
            '<div class="grow"><div class="nm">' + esc(it.name) + '</div><div class="meta"><b>' + RARITY[it.rarity].name + '</b><span class="worth"><span class="coin-ic sm"></span>' + fmt(it.sell) + '</span></div></div>' +
            '<div class="stepper"><button type="button" data-id="' + it.id + '" data-d="-1" aria-label="One less"' + (n ? '' : ' disabled') + '>−</button><b class="num" aria-label="' + n + ' of ' + have + '">' + n + '<small>/' + have + '</small></b>' +
            '<button type="button" data-id="' + it.id + '" data-d="1" aria-label="One more"' + (n >= have ? ' disabled' : '') + '>+</button></div></div>';
        });
        list.innerHTML = any ? html : '<div class="empty"><b>No cards yet</b>Open a chest first. You can still trade coins.</div>';
        var cnt = offerCount(o);
        sum.innerHTML = cnt ? '<b>' + cnt + '</b> card' + (cnt === 1 ? '' : 's') + ' in your offer, worth <b>' + fmt(offerValue({ items: o.items })) + '</b>' : 'Tap + to add a card to your offer';
      }
      list.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('button[data-id]') : null;
        if (!b || b.disabled) return;
        Sfx.click();
        editOffer(function (d) { d.items[b.dataset.id] = (d.items[b.dataset.id] || 0) + (+b.dataset.d); });
        paint();
      });
      paint();
    });
  }
  function paintDone() {
    var t = cur, give = offerValue(t.me.offer), get = offerValue(t.them.offer), fm = fairness(give, get), ft = fairness(get, give);
    root.innerHTML = '<div class="scroll"><div class="tr-done">' +
      '<div class="tr-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.500l4.500 4.500L19 7.500" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
      '<h1 class="h1">Trade complete</h1><p class="sub">You traded with ' + esc(t.with.name) + '.</p>' +
      '<section class="tr-side"><header><span>You got</span><b class="num"><span class="coin-ic sm"></span>' + fmt(get) + '</b></header><div class="tr-cards">' + chips(t.them.offer) + '</div></section>' +
      '<section class="tr-side"><header><span>You gave</span><b class="num"><span class="coin-ic sm"></span>' + fmt(give) + '</b></header><div class="tr-cards">' + chips(t.me.offer) + '</div></section>' +
      '<div class="tr-fair done"><div class="tf ' + fairClass(fm) + '"><small>For you</small><b>' + fmtFair(fm) + '</b></div><div class="tf ' + fairClass(ft) + '"><small>For ' + esc(t.with.name) + '</small><b>' + fmtFair(ft) + '</b></div></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn grow" type="button" id="trToInv">Inventory</button><button class="btn grow gold" type="button" id="trDone">Done</button></div>' +
      '</div></div>';
    built = 'done:' + t.id;
    var back = function () { cur = null; screen = 'lobby'; hold(); watch(); render(); Net.pollNow(); };
    onTap($('#trDone', root), function () { Sfx.click(); back(); });
    onTap($('#trToInv', root), function () { Sfx.click(); back(); UI.go('inv'); });
  }

  // ---- the lobby ------------------------------------------------------------------------------------------
  function search(now) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var seq = ++searchSeq, q = query;
      Net.call('users.search', { q: q }).then(function (r) {
        if (seq !== searchSeq) return;
        people = r.users; loadedPeople = true; searchFailed = false; paintPeople();
      }, function () { if (seq === searchSeq) { loadedPeople = true; searchFailed = true; paintPeople(); } });
    }, now ? 0 : 280);
  }
  function buildLobby() {
    var me = Net.user;
    root.innerHTML = '<div class="scroll">' +
      '<div class="inv-top"><div><h1 class="h1">Trade</h1><div class="sub" style="margin-top:6px">Swap cards and coins with other players.</div></div>' +
        '<button class="btn sm" type="button" id="trHist">History</button></div>' +
      '<div class="tr-you">' + avatar(me.name, 'sm') + '<span>You are <b>' + esc(me.name) + '</b></span><span id="trNet"></span></div>' +
      '<div id="trOpen"></div><div id="trInbox"></div><div id="trSent"></div>' +
      '<label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.500 4a6.500 6.500 0 0 1 5.200 10.400l4 4-1.400 1.400-4-4A6.500 6.500 0 1 1 10.500 4zm0 2a4.500 4.500 0 1 0 0 9 4.500 4.500 0 0 0 0-9z"/></svg>' +
        '<input id="trSearch" type="search" placeholder="Find a player by name" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="16" enterkeyhint="search" aria-label="Find a player by name"></label>' +
      '<div id="trPeople"></div>' +
      '<div class="note">A trade only happens after both players accepted and confirmed.</div></div>';
    built = 'lobby';
    var input = $('#trSearch', root);
    input.value = query;
    input.addEventListener('input', function () { query = input.value.trim(); search(); });
    onTap($('#trHist', root), function () { Sfx.click(); history(); });
    var lists = $('.scroll', root);
    lists.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if (!b || b.disabled) return;
      var id = +b.dataset.id, act = b.dataset.act;
      if (act === 'open') { Sfx.click(); if (cur && cur.status === 'open') { screen = 'room'; render(); } else Net.pollNow(); return; }
      if (act === 'ask') { var u = people.filter(function (p) { return p.id === id; })[0]; if (u) ask(u, b); return; }
      var req = inbox.concat(sent).filter(function (r) { return r.id === id; })[0];
      if (!req) return;
      if (act === 'yes') answer(req, true, b); else if (act === 'no') answer(req, false, b); else if (act === 'cancel') takeBack(req, b);
    });
  }
  function reqRow(r, kind) {
    return '<div class="tr-row">' + avatar(r.with.name) + '<div class="grow"><div class="nm">' + esc(r.with.name) + '</div>' + presence(r.with) + '</div>' +
      (kind === 'in' ? '<button class="btn sm" type="button" data-act="no" data-id="' + r.id + '">Decline</button><button class="btn sm gold" type="button" data-act="yes" data-id="' + r.id + '">Accept</button>'
        : '<button class="btn sm" type="button" data-act="cancel" data-id="' + r.id + '">Cancel</button>') + '</div>';
  }
  function paintLists() {
    if (built !== 'lobby') return;
    $('#trNet', root).innerHTML = Net.online ? '' : '<span class="pres">offline, reconnecting…</span>';
    $('#trOpen', root).innerHTML = open ? '<div class="tr-row open">' + avatar(open.with.name) + '<div class="grow"><div class="nm">Trade with ' + esc(open.with.name) + '</div>' + presence(open.with) + '</div>' +
      '<button class="btn sm gold" type="button" data-act="open" data-id="' + open.id + '">Open</button></div>' : '';
    $('#trInbox', root).innerHTML = inbox.length ? '<h2 class="tr-h">Requests for you</h2>' + inbox.map(function (r) { return reqRow(r, 'in'); }).join('') : '';
    $('#trSent', root).innerHTML = sent.length ? '<h2 class="tr-h">Waiting for an answer</h2>' + sent.map(function (r) { return reqRow(r, 'out'); }).join('') : '';
  }
  function paintPeople() {
    if (built !== 'lobby') return;
    var host = $('#trPeople', root), html = '<h2 class="tr-h">' + (query ? 'Players matching “' + esc(query) + '”' : 'Players') + '</h2>';
    if (!loadedPeople) html += '<div class="tr-none pad">Looking for players…</div>';
    else if (searchFailed) html += '<div class="tr-none pad">The player list could not be loaded. It comes back once the server answers again.</div>';
    else if (!people.length) html += '<div class="tr-none pad">' + (query ? 'Nobody with that name. Check the spelling.' : 'No other players yet. Tell a friend to create an account.') + '</div>';
    else people.forEach(function (u) {
      var out = sent.filter(function (r) { return r.with.id === u.id; })[0], inc = inbox.filter(function (r) { return r.with.id === u.id; })[0];
      var act = open && open.with.id === u.id ? '<button class="btn sm gold" type="button" data-act="open" data-id="' + open.id + '">Open</button>'
        : inc ? '<button class="btn sm gold" type="button" data-act="yes" data-id="' + inc.id + '">Accept</button>'
          : out ? '<button class="btn sm" type="button" disabled>Asked</button>'
            : '<button class="btn sm" type="button" data-act="ask" data-id="' + u.id + '"' + (pending['u' + u.id] ? ' disabled' : '') + '>Trade</button>';
      html += '<div class="tr-row">' + avatar(u.name) + '<div class="grow"><div class="nm">' + esc(u.name) + '</div>' + presence(u) + '</div>' + act + '</div>';
    });
    host.innerHTML = html;
  }
  function paintLobby() { paintLists(); paintPeople(); }
  function history() {
    UI.sheet('Trade history', function (body) {
      body.innerHTML = '<div class="tr-none pad">Loading…</div>';
      Net.call('trade.history', {}).then(function (r) {
        if (!r.trades.length) { body.innerHTML = '<div class="empty"><b>No trades yet</b>Finished, declined and cancelled trades show up here.</div>'; return; }
        var LABEL = { done: 'Done', declined: 'Declined', cancelled: 'Cancelled', expired: 'Timed out' };
        body.innerHTML = r.trades.map(function (t) {
          var give = offerValue(t.me.offer), get = offerValue(t.them.offer), fm = fairness(give, get);
          var head = '<div class="th-top">' + avatar(t.with.name, 'sm') + '<div class="grow"><b>' + esc(t.with.name) + '</b><small>' + esc(when(t.done || t.updated)) + '</small></div><span class="th-st ' + t.status + '">' + LABEL[t.status] + '</span></div>';
          if (t.status !== 'done') {
            var who = t.status === 'expired' ? 'Nobody finished it in time.' : t.status === 'declined' ? (t.endedBy === 'me' ? 'You declined the request.' : esc(t.with.name) + ' declined your request.') : (t.endedBy === 'me' ? 'You left.' : esc(t.with.name) + ' left.');
            return '<div class="th">' + head + '<div class="th-note">' + who + '</div></div>';
          }
          return '<div class="th">' + head +
            '<div class="th-line"><span>You got</span><div class="tr-cards">' + chips(t.them.offer) + '</div></div>' +
            '<div class="th-line"><span>You gave</span><div class="tr-cards">' + chips(t.me.offer) + '</div></div>' +
            '<div class="th-fair ' + fairClass(fm) + '">For you ' + fmtFair(fm) + '<small>' + fmt(get) + ' in, ' + fmt(give) + ' out</small></div></div>';
        }).join('');
      }, function (e) { body.innerHTML = '<div class="empty"><b>Could not load the history</b>' + esc(e.message) + '</div>'; });
    });
  }
  function paintGate() {
    var local = GC.mode !== 'account';
    root.innerHTML = '<div class="scroll"><div class="empty"><b>' + (local ? 'Trading needs an account' : 'Offline') + '</b>' +
      (local ? 'You are playing without one. Log in or create an account to trade with other players.<div style="margin-top:16px"><button class="btn gold" type="button" id="trLogin">Log in or create account</button></div>'
        : 'The server cannot be reached right now. Trading comes back on its own once it can.') + '</div></div>';
    built = 'gate';
    var b = $('#trLogin', root); if (b) onTap(b, function () { location.reload(); });
  }
  function render() {
    paintBar();
    if (!root || UI.view !== 'trade') return;
    if (!Net.user) { paintGate(); return; }
    if (screen === 'room' && cur && cur.status === 'open') { paintRoom(); return; }
    if (screen === 'done' && cur) { if (built !== 'done:' + cur.id) paintDone(); return; }
    screen = 'lobby';
    if (built !== 'lobby') { buildLobby(); if (!loadedPeople) search(true); }
    paintLobby();
  }

  // ---- the bar on top of every tab ------------------------------------------------------------------------
  function paintBar() {
    if (!bar) return;
    var html = '', key = '';
    var first = inbox[0];
    if (cur && cur.status === 'open' && UI.view !== 'trade') {
      key = 'open' + cur.id;
      html = '<div class="tbar open">' + avatar(cur.with.name, 'sm') + '<div class="grow">Trade with <b>' + esc(cur.with.name) + '</b> is open</div><button class="btn sm gold" type="button" data-act="goto">Open</button></div>';
    } else if (first && UI.view !== 'trade' && !(cur && cur.status === 'open')) {
      key = 'req' + first.id + ':' + inbox.length;
      html = '<div class="tbar">' + avatar(first.with.name, 'sm') + '<div class="grow"><b>' + esc(first.with.name) + '</b> wants to trade' + (inbox.length > 1 ? '<small>+' + (inbox.length - 1) + ' more</small>' : '') + '</div>' +
        '<button class="btn sm" type="button" data-act="no">Decline</button><button class="btn sm gold" type="button" data-act="yes">Accept</button></div>';
    }
    if (bar.dataset.key !== key) {
      bar.dataset.key = key; bar.innerHTML = html; bar.classList.toggle('on', !!html);
      setTimeout(function () { try { Chest3D.resize(); } catch (e) {} }, 30);
      setTimeout(function () { try { Chest3D.resize(); } catch (e) {} }, 320);
    }
    var b = $('#tradeBadge'), n = inbox.length + (open ? 1 : 0);
    if (b) { b.textContent = n > 9 ? '9+' : n; b.classList.toggle('on', n > 0 && UI.view !== 'trade'); }
  }

  function onPoll(r) {
    var newcomer = null;
    r.inbox.forEach(function (x) { if (!seenInbox[x.id]) { seenInbox[x.id] = true; if (!firstPoll) newcomer = x; } });
    firstPoll = false;
    inbox = r.inbox; sent = r.sent;
    var hadOpen = open;
    open = r.open;
    if (newcomer && !(cur && cur.status === 'open')) { Sfx.tierUp(2); haptic([20, 40, 20]); }
    if (r.trade) onTrade(r.trade);
    else if (open && cur && cur.id === open.id && cur.status === 'open') { cur.with = open.with; }
    else if (open && (!cur || cur.status !== 'open')) {
      // a request of mine was accepted (or the page was reloaded during a trade): fetch the room
      if (!hadOpen && sentHad(open.id)) UI.toast(esc(open.with.name) + ' accepted. Your trade is open.', 'win', 3000);
      watch(); Net.pollNow();
    } else if (!open && cur && cur.status === 'open') {
      Net.call('trade.get', { id: cur.id }).then(function (g) { onTrade(g.trade); }, function () { onTrade({ id: cur.id, status: 'gone' }); });
    }
    watch(); render();
  }
  var sentIds = {};
  function sentHad(id) { return !!sentIds[id]; }

  return {
    init: function () {
      root = $('#view-trade'); bar = $('#tradeBar');
      if (!Net.enabled) return;
      Net.on(function (what, data) {
        if (what === 'poll') { data.sent.forEach(function (s) { sentIds[s.id] = true; }); onPoll(data); }
        else if (what === 'online') {
          if (built === 'gate') built = '';
          if (data && searchFailed && built === 'lobby') search(true);
          render();
        }
        else if (what === 'replaced') UI.toast('This account was saved on another device. You now see that save.', '', 4200);
        else if (what === 'booked' && screen !== 'done') UI.toast('A trade was added to your inventory', 'win');
      });
      Store.on(function (what) { if ((what === 'inv' || what === 'coins') && draft && screen === 'room') editOffer(function () {}); });
      bar.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
        if (!b || b.disabled) { if (ev.target.closest && ev.target.closest('.tbar')) UI.go('trade'); return; }
        if (b.dataset.act === 'goto') { Sfx.click(); screen = 'room'; UI.go('trade'); return; }
        var req = inbox[0]; if (!req) return;
        answer(req, b.dataset.act === 'yes', b);
      });
      UI.onView(function (v) {
        if (v === 'trade') { if (built === 'lobby') search(true); built = built.indexOf('room') === 0 ? '' : built; render(); Net.pollNow(); }
        else paintBar();
      });
    },
    get state() { return { screen: screen, cur: cur, draft: draft, inbox: inbox, sent: sent, open: open, people: people }; },
    fairness: fairness, fmtFair: fmtFair, offerValue: offerValue
  };
})();
