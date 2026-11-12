// Blackjack: 6 decks, dealer stands on 17, blackjack pays 3 to 2, double and one split. ---------------
Games.register({
  id: 'bj', title: 'Blackjack', icon: 'bj',
  mount: function (pane) {
    var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'], SUITS = ['♠', '♥', '♦', '♣'];
    var shoe = [], st = { phase: 'idle', dealer: [], hands: [], active: 0, busy: false };
    pane.innerHTML = '<div class="bj-table"><div class="bj-hand" id="bjDealer"><div class="bj-label">Dealer <b id="bjDv">0</b></div><div class="bj-cards" id="bjDc"></div></div>' +
      '<div class="bj-msg" id="bjMsg"></div><div class="bj-hands" id="bjHands"></div></div>' +
      '<div class="bj-acts" id="bjActs"><button class="btn" type="button" data-a="hit">Hit</button><button class="btn" type="button" data-a="stand">Stand</button><button class="btn" type="button" data-a="double">Double</button><button class="btn" type="button" data-a="split">Split</button></div>' +
      '<button class="btn big block green" type="button" id="bjDeal">Deal</button><div class="panel" id="bjBet"></div>' +
      '<div class="note">Closest to 21 wins. Aces count 1 or 11, face cards 10.</div>';
    var bet = Games.BetCtl('bj', 20);
    $('#bjBet', pane).appendChild(bet.el);
    function fresh() { shoe = []; for (var d = 0; d < 6; d++) RANKS.forEach(function (r) { SUITS.forEach(function (s) { shoe.push({ r: r, s: s }); }); }); shuffle(shoe); }
    function draw() { if (shoe.length < 60) fresh(); return shoe.pop(); }
    function val(c) { return c.r === 'A' ? 11 : (c.r === 'K' || c.r === 'Q' || c.r === 'J') ? 10 : +c.r; }
    function score(cards) {
      var t = 0, a = 0; cards.forEach(function (c) { t += val(c); if (c.r === 'A') a++; });
      while (t > 21 && a > 0) { t -= 10; a--; }
      return { total: t, soft: a > 0 };
    }
    function isBJ(cards) { return cards.length === 2 && score(cards).total === 21; }
    function cardEl(c, down) {
      var red = c.s === '♥' || c.s === '♦';
      var e = el('div', 'pc' + (red ? ' red' : '') + (down ? ' down' : ''), '<div class="f">' + c.r + '<small>' + c.s + '</small><span class="big">' + c.s + '</span></div><div class="bk"></div>');
      return e;
    }
    function handEl(i) {
      var h = el('div', 'bj-hand', '<div class="bj-cards"></div><div class="bj-label"><span class="hn">' + (st.hands.length > 1 ? 'Hand ' + (i + 1) : 'You') + '</span> <b>0</b></div>');
      return h;
    }
    function renderHands() {
      var host = $('#bjHands', pane); host.innerHTML = '';
      st.hands.forEach(function (h, i) { h.el = handEl(i); host.appendChild(h.el); h.cards.forEach(function (c) { var e = cardEl(c); e.style.animation = 'none'; $('.bj-cards', h.el).appendChild(e); }); });
      labels();
    }
    function labels() {
      st.hands.forEach(function (h, i) {
        if (!h.el) return;
        var s = score(h.cards), b = $('b', h.el);
        b.textContent = s.total; b.className = s.total > 21 ? 'bust' : (isBJ(h.cards) && !h.split) ? 'bj' : '';
        $('.hn', h.el).textContent = (st.hands.length > 1 ? 'Hand ' + (i + 1) : 'You') + ' · ' + fmt(h.bet);
        h.el.classList.toggle('act', st.phase === 'player' && i === st.active && st.hands.length > 1);
        h.el.classList.toggle('dimh', st.phase === 'player' && i !== st.active && st.hands.length > 1);
      });
      var hidden = st.dealer.length && st.holeDown;
      var dv = $('#bjDv', pane), ds = hidden ? score([st.dealer[0]]) : score(st.dealer);
      dv.textContent = st.dealer.length ? ds.total : 0; dv.className = !hidden && ds.total > 21 ? 'bust' : '';
    }
    function give(target, card, down) {
      var host = target === 'dealer' ? $('#bjDc', pane) : $('.bj-cards', target.el);
      var e = cardEl(card, down); host.appendChild(e); Sfx.card(); labels(); return e;
    }
    function msg(text, kind) {
      var m = $('#bjMsg', pane); m.textContent = text; m.className = 'bj-msg on ' + (kind || '');
    }
    function paint() {
      var acts = $$('#bjActs .btn', pane), h = st.hands[st.active], playing = st.phase === 'player' && !st.busy;
      acts[0].disabled = !playing; acts[1].disabled = !playing;
      acts[2].disabled = !(playing && h && h.cards.length === 2 && Store.avail() >= h.bet);
      acts[3].disabled = !(playing && h && st.hands.length === 1 && h.cards.length === 2 && h.cards[0].r === h.cards[1].r && Store.avail() >= h.bet);
      $('#bjDeal', pane).disabled = st.phase !== 'idle';
      $('#bjDeal', pane).style.display = st.phase === 'idle' ? '' : 'none';
      $('#bjActs', pane).style.display = st.phase === 'idle' ? 'none' : '';
      bet.lock(st.phase !== 'idle');
    }
    function deal() {
      if (st.phase !== 'idle') return;
      Sfx.unlock();
      var took = bet.take(); if (!took) return;
      st = { phase: 'dealing', dealer: [], hands: [{ cards: [], bet: took }], active: 0, busy: true, holeDown: true };
      $('#bjDc', pane).innerHTML = ''; $('#bjMsg', pane).className = 'bj-msg'; renderHands(); paint();
      var h = st.hands[0], hole;
      var c1 = draw(), c2 = draw(), c3 = draw(), c4 = draw();
      h.cards.push(c1); give(h, c1);
      wait(260).then(function () { st.dealer.push(c2); give('dealer', c2); return wait(260); })
        .then(function () { h.cards.push(c3); give(h, c3); return wait(260); })
        .then(function () { st.dealer.push(c4); hole = give('dealer', c4, true); st.holeEl = hole; return wait(320); })
        .then(function () {
          var pBJ = isBJ(h.cards), up = val(st.dealer[0]);
          if ((up === 11 || up === 10) && isBJ(st.dealer)) { revealHole(); return wait(350).then(function () { settle(); }); }
          if (pBJ) { revealHole(); return wait(350).then(function () { settle(); }); }
          st.phase = 'player'; st.busy = false; labels(); paint();
        });
    }
    function revealHole() { st.holeDown = false; if (st.holeEl) st.holeEl.classList.remove('down'); Sfx.card(); labels(); }
    function nextHand() {
      if (st.active < st.hands.length - 1) {
        st.active += 1; var h = st.hands[st.active];
        if (h.cards.length === 1) { var c = draw(); h.cards.push(c); give(h, c); }
        labels(); paint();
        if (h.aces || score(h.cards).total === 21) { st.busy = true; wait(350).then(function () { st.busy = false; nextHand(); }); }
        return;
      }
      dealerPlay();
    }
    function dealerPlay() {
      st.phase = 'dealer'; st.busy = true; paint();
      var allBust = st.hands.every(function (h) { return score(h.cards).total > 21; });
      revealHole();
      function step() {
        var s = score(st.dealer);
        if (!allBust && s.total < 17) { var c = draw(); st.dealer.push(c); give('dealer', c); return wait(420).then(step); }
        return wait(300).then(settle);
      }
      wait(420).then(step);
    }
    function settle() {
      var d = score(st.dealer).total, dBJ = isBJ(st.dealer), pay = 0, staked = 0, best = '';
      st.hands.forEach(function (h) {
        var s = score(h.cards).total, pBJ = isBJ(h.cards) && !h.split, r;
        staked += h.bet;
        if (s > 21) r = 'bust';
        else if (pBJ && !dBJ) { r = 'bj'; pay += Math.floor(h.bet * 2.5); }
        else if (dBJ && !pBJ) r = 'lose';
        else if (d > 21 || s > d) { r = 'win'; pay += h.bet * 2; }
        else if (s === d) { r = 'push'; pay += h.bet; }
        else r = 'lose';
        h.result = r;
        if (h.el) { var b = $('b', h.el); if (r === 'win' || r === 'bj') b.className = r === 'bj' ? 'bj' : 'w'; }
      });
      st.phase = 'idle'; st.busy = false; labels();
      var net = pay - staked;
      if (pay > 0 && net > 0) { Games.payout(pay, pay / staked, st.hands.some(function (h) { return h.result === 'bj'; }) ? 'Blackjack' : 'Win'); Sfx.win(net >= staked * 1.4); haptic(30); }
      else if (pay > 0) { Store.addCoins(pay); Store.s.stats.wagered -= pay; }
      if (st.hands.some(function (h) { return h.result === 'bj'; })) msg('BLACKJACK +' + fmt(net), 'win');
      else if (net > 0) msg('YOU WIN +' + fmt(net), 'win');
      else if (net === 0) msg(st.hands.length > 1 && st.hands[0].result !== 'push' ? 'EVEN' : 'PUSH', 'push');
      else { msg(st.hands.every(function (h) { return h.result === 'bust'; }) ? 'BUST' : 'DEALER WINS', 'loss'); Sfx.lose(); }
      paint();
    }
    function act(a) {
      if (st.phase !== 'player' || st.busy) return;
      var h = st.hands[st.active], c;
      if (a === 'hit') {
        c = draw(); h.cards.push(c); give(h, c);
        var s = score(h.cards).total;
        if (s >= 21) { st.busy = true; paint(); wait(380).then(function () { st.busy = false; nextHand(); }); } else paint();
      } else if (a === 'stand') { Sfx.click(); nextHand(); }
      else if (a === 'double') {
        if (!Store.spend(h.bet)) { Sfx.deny(); return; }
        h.bet *= 2; c = draw(); h.cards.push(c); give(h, c); st.busy = true; paint();
        wait(420).then(function () { st.busy = false; nextHand(); });
      } else if (a === 'split') {
        if (!Store.spend(h.bet)) { Sfx.deny(); return; }
        var aces = h.cards[0].r === 'A';
        st.hands = [{ cards: [h.cards[0]], bet: h.bet, split: true, aces: aces }, { cards: [h.cards[1]], bet: h.bet, split: true, aces: aces }];
        st.active = 0; renderHands();
        c = draw(); st.hands[0].cards.push(c); give(st.hands[0], c); labels(); paint();
        if (aces || score(st.hands[0].cards).total === 21) { st.busy = true; paint(); wait(420).then(function () { st.busy = false; nextHand(); }); }
      }
    }
    $$('#bjActs .btn', pane).forEach(function (b) { onTap(b, function () { act(b.dataset.a); }); });
    onTap($('#bjDeal', pane), deal);
    fresh(); paint();
    // rig() stacks the next cards to be drawn (first in the list is dealt first); used by the tests
    GC.bj = { get st() { return st; }, score: score, deal: deal, act: act, rig: function (cards) { if (shoe.length < 80) fresh(); for (var i = cards.length - 1; i >= 0; i--) shoe.push(cards[i]); } };
    return {};
  }
});
