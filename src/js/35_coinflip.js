// Coinflip: call the side, win 1.96x, then keep flipping to stack it or cash out. ----------------------
Games.register({
  id: 'flip', title: 'Coinflip', icon: 'flip',
  mount: function (pane) {
    var STEP = 1.96, MAXS = 20, side = 'h', st = { on: false, bet: 0, streak: 0, busy: false, rot: 0, hist: [] };
    pane.innerHTML = '<div class="cf-stage"><div class="cf-streak" id="cfStreak"></div><div class="cf-coin" id="cfCoin"><div class="s hd">' + UI.ICON.crown + '</div><div class="s tl">' + UI.ICON.gem + '</div></div><div class="cf-shadow" id="cfShadow"></div><div class="cf-mult" id="cfMult">Pick a side · wins pay <b>1.96×</b></div></div>' +
      '<div class="cf-pick" id="cfPick"><button type="button" class="on" data-s="h"><i></i>CROWN</button><button type="button" class="t" data-s="t"><i></i>GEM</button></div>' +
      '<div class="two" id="cfActs"></div>' +
      '<div class="kv"><div class="stat"><div class="k">Streak</div><div class="v num" id="cfSt">0</div></div><div class="stat"><div class="k">Multiplier</div><div class="v num" id="cfMu">1.00×</div></div><div class="stat"><div class="k">Cash out</div><div class="v num" id="cfWin">0</div></div></div>' +
      '<div class="panel" id="cfBet"></div>' +
      '<div class="note">50 / 50 every flip. Each win multiplies your stake by 1.96.</div>';
    var bet = Games.BetCtl('flip', 20), coin = $('#cfCoin', pane);
    $('#cfBet', pane).appendChild(bet.el);
    function mult(n) { return Math.floor(Math.pow(STEP, n) * 100) / 100; }
    function paint() {
      var acts = $('#cfActs', pane);
      $('#cfSt', pane).textContent = st.streak; $('#cfMu', pane).textContent = fmtMult(st.streak ? mult(st.streak) : 1);
      $('#cfWin', pane).textContent = st.on && st.streak ? fmt(Math.floor(st.bet * mult(st.streak))) : '0';
      acts.innerHTML = '';
      if (!st.on) {
        acts.style.gridTemplateColumns = '1fr';
        var b = el('button', 'btn big green', 'Flip'); b.type = 'button'; b.disabled = st.busy; onTap(b, function () { start(); }); acts.appendChild(b);
      } else {
        acts.style.gridTemplateColumns = '1fr 1fr';
        var again = el('button', 'btn big green', 'Flip again · ' + fmtMult(mult(st.streak + 1))); again.type = 'button'; again.disabled = st.busy || st.streak >= MAXS; onTap(again, function () { flip(); });
        var co = el('button', 'btn big gold', 'Cash out +' + fmt(Math.floor(st.bet * mult(st.streak)))); co.type = 'button'; co.disabled = st.busy || !st.streak; onTap(co, cash);
        acts.appendChild(again); acts.appendChild(co);
      }
      bet.lock(st.on || st.busy);
      $('#cfPick', pane).classList.toggle('locked', st.busy);
      $('#cfStreak', pane).innerHTML = st.hist.slice(-14).map(function (h) { return '<i class="' + (h === 't' ? 't' : '') + '"></i>'; }).join('');
    }
    function start() {
      if (st.on || st.busy) return;
      Sfx.unlock();
      var took = bet.take(); if (!took) return;
      st.on = true; st.bet = took; st.streak = 0; st.hist = [];
      flip();
    }
    function flip() {
      if (!st.on || st.busy) return;
      st.busy = true; paint();
      var res = rand() < 0.5 ? 'h' : 't';
      var cur = st.rot, turns = 5 + randInt(3), target = Math.ceil(cur / 360) * 360 + turns * 360 + (res === 't' ? 180 : 0);
      st.rot = target; Sfx.flip();
      var dur = reducedMotion ? 300 : 1500;
      $('#cfMult', pane).innerHTML = 'Flipping…';
      try {
        coin.animate([{ transform: 'translateY(0) rotateY(' + cur + 'deg)' }, { transform: 'translateY(-78px) rotateY(' + (cur + (target - cur) * 0.55) + 'deg) scale(1.12)', offset: 0.45 }, { transform: 'translateY(0) rotateY(' + target + 'deg)' }], { duration: dur, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
        $('#cfShadow', pane).animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.55)', opacity: .45, offset: 0.45 }, { transform: 'scale(1)', opacity: 1 }], { duration: dur, easing: 'ease-in-out' });
      } catch (e) { coin.style.transform = 'rotateY(' + target + 'deg)'; }
      setTimeout(function () {
        st.busy = false; st.hist.push(res);
        if (res === side) {
          st.streak += 1; Sfx.win(st.streak >= 3); haptic(20);
          $('#cfMult', pane).innerHTML = (res === 'h' ? 'Crown' : 'Gem') + ' · you are at <b>' + fmtMult(mult(st.streak)) + '</b>';
          if (st.streak >= MAXS) { cash(); return; }
        } else {
          Sfx.lose(); haptic([50, 30, 80]);
          $('#cfMult', pane).innerHTML = (res === 'h' ? 'Crown' : 'Gem') + ' · <b style="color:var(--loss)">-' + fmt(st.bet) + '</b>';
          UI.toast('Wrong side · -' + fmt(st.bet), 'loss', 1500);
          st.on = false; st.streak = 0;
        }
        paint();
      }, dur + 40);
    }
    function cash() {
      if (!st.on || !st.streak || st.busy) return;
      var m = mult(st.streak), win = Math.floor(st.bet * m);
      Games.payout(win, m, fmtMult(m)); Sfx.coin(4); haptic(30);
      $('#cfMult', pane).innerHTML = 'Cashed out <b>+' + fmt(win) + '</b>';
      st.on = false; st.streak = 0; paint();
    }
    $$('#cfPick button', pane).forEach(function (b) {
      onTap(b, function () { if (st.busy) return; Sfx.click(); side = b.dataset.s; $$('#cfPick button', pane).forEach(function (x) { x.classList.toggle('on', x === b); }); });
    });
    paint();
    GC.flip = { get st() { return st; }, start: start, flip: flip, cash: cash, mult: mult };
    return {};
  }
});
