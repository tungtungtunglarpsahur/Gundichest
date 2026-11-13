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
      // a high toss: many turns on the way up, slower ones while it comes down, and a small bounce on landing
      var cur = st.rot, turns = 11 + randInt(4), target = Math.ceil(cur / 360) * 360 + turns * 360 + (res === 't' ? 180 : 0);
      st.rot = target;
      var dur = reducedMotion ? 300 : 3400;
      Sfx.flip(dur / 1000);
      $('#cfMult', pane).innerHTML = 'Flipping…';
      try {
        var span = target - cur, at = function (y, part, sc) { return 'translateY(' + y + 'px) rotateY(' + (cur + span * part) + 'deg) scale(' + sc + ')'; };
        coin.animate([
          { transform: at(0, 0, 1), easing: 'cubic-bezier(.2,.6,.3,1)' },
          { transform: at(-72, 0.5, 1.1), offset: 0.4, easing: 'cubic-bezier(.6,0,.75,.5)' },
          { transform: at(0, 0.965, 1), offset: 0.84, easing: 'ease-out' },
          { transform: at(-9, 0.992, 1.02), offset: 0.92, easing: 'ease-in' },
          { transform: at(0, 1, 1) }
        ], { duration: dur, fill: 'forwards' });
        $('#cfShadow', pane).animate([
          { transform: 'scale(1)', opacity: 1, easing: 'cubic-bezier(.2,.6,.3,1)' }, { transform: 'scale(.42)', opacity: .35, offset: 0.4, easing: 'cubic-bezier(.6,0,.75,.5)' },
          { transform: 'scale(1)', opacity: 1, offset: 0.84 }, { transform: 'scale(.93)', opacity: .9, offset: 0.92 }, { transform: 'scale(1)', opacity: 1 }
        ], { duration: dur });
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
