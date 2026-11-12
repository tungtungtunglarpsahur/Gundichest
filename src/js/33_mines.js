// Mines: 5x5 board, pick gems, avoid the skulls, cash out whenever you like. ---------------------------
Games.register({
  id: 'mines', title: 'Mines', icon: 'mines',
  mount: function (pane) {
    var N = 25, EDGE = 0.99, mines = 3, st = { on: false, bet: 0, board: [], open: [], found: 0 };
    pane.innerHTML = '<div class="kv"><div class="stat"><div class="k">Gems</div><div class="v num" id="mnGems">0</div></div><div class="stat"><div class="k">Multiplier</div><div class="v num" id="mnMult">1.00×</div></div><div class="stat"><div class="k">Next</div><div class="v num" id="mnNext">—</div></div></div>' +
      '<div class="mines-grid" id="mnGrid"></div>' +
      '<div class="two" id="mnActs"></div>' +
      '<div class="panel"><div id="mnBet"></div><div class="lbl" style="margin-top:12px"><span>Mines</span><span id="mnInfo"></span></div>' +
      '<div class="mines-set"><button class="step" type="button" id="mnMinus" aria-label="Fewer mines">−</button><input type="range" min="1" max="24" value="3" id="mnRange" aria-label="Number of mines"><button class="step" type="button" id="mnPlus" aria-label="More mines">+</button><div class="mc" id="mnCount">3</div></div>' +
      '<div class="auto-row" id="mnQuick"></div></div>' +
      '<div class="note">Skulls are hidden when the round starts. Every gem raises the multiplier.</div>';
    var grid = $('#mnGrid', pane), bet = Games.BetCtl('mines', 20);
    $('#mnBet', pane).appendChild(bet.el);
    // multiplier after k safe picks with m mines: 0.99 * C(25,k) / C(25-m,k)
    function mult(k, m) { var x = 1; for (var i = 0; i < k; i++) x *= (N - i) / (N - m - i); return k === 0 ? 1 : Math.floor(EDGE * x * 100) / 100; }
    for (var i = 0; i < N; i++) {
      (function (i) {
        var t = el('button', 'mt'); t.type = 'button'; t.setAttribute('aria-label', 'Tile ' + (i + 1));
        onTap(t, function () { pick(i); });
        grid.appendChild(t);
      })(i);
    }
    var tiles = $$('.mt', grid);
    function setMines(m) {
      if (st.on) return;
      mines = clamp(Math.round(m), 1, 24);
      $('#mnRange', pane).value = mines; $('#mnCount', pane).textContent = mines;
      $('#mnInfo', pane).textContent = (N - mines) + ' gems · first pick ' + fmtMult(mult(1, mines));
      $$('#mnQuick .chip', pane).forEach(function (c) { c.classList.toggle('on', +c.dataset.m === mines); });
    }
    function paint() {
      var acts = $('#mnActs', pane);
      $('#mnGems', pane).textContent = st.found + ' / ' + (N - mines);
      $('#mnMult', pane).textContent = fmtMult(mult(st.found, mines));
      $('#mnNext', pane).textContent = st.on && st.found < N - mines ? fmtMult(mult(st.found + 1, mines)) : '—';
      acts.innerHTML = '';
      if (!st.on) {
        acts.style.gridTemplateColumns = '1fr';
        var b = el('button', 'btn big green', 'Bet'); b.type = 'button'; onTap(b, start); acts.appendChild(b);
      } else {
        acts.style.gridTemplateColumns = '1fr 1fr';
        var r = el('button', 'btn big', 'Pick random'); r.type = 'button'; onTap(r, function () { var left = []; for (var i = 0; i < N; i++) if (!st.open[i]) left.push(i); if (left.length) pick(left[randInt(left.length)]); });
        var c = el('button', 'btn big gold', st.found ? 'Cash out +' + fmt(Math.floor(st.bet * mult(st.found, mines))) : 'Cash out'); c.type = 'button'; c.disabled = !st.found; onTap(c, cash);
        acts.appendChild(r); acts.appendChild(c);
      }
      bet.lock(st.on);
      ['#mnMinus', '#mnPlus', '#mnRange'].forEach(function (s) { $(s, pane).disabled = st.on; });
      $('.mines-set', pane).style.opacity = st.on ? 0.5 : 1;
    }
    function start() {
      Sfx.unlock();
      var took = bet.take(); if (!took) return;
      var idx = []; for (var i = 0; i < N; i++) idx.push(i); shuffle(idx);
      var board = new Array(N).fill(0); for (var j = 0; j < mines; j++) board[idx[j]] = 1;
      st = { on: true, bet: took, board: board, open: new Array(N).fill(false), found: 0 };
      tiles.forEach(function (t) { t.className = 'mt live'; t.innerHTML = ''; });
      Sfx.coin(1); paint();
    }
    function reveal(i, dim) {
      var t = tiles[i], bomb = st.board[i] === 1;
      t.innerHTML = bomb ? UI.ICON.skull : UI.ICON.gem;
      void t.offsetWidth;
      t.className = 'mt ' + (bomb ? 'bomb' : 'gem') + (dim ? ' dim' : '');
    }
    function finish(hit) {
      st.on = false;
      for (var i = 0; i < N; i++) if (!st.open[i]) reveal(i, true);
      if (hit !== undefined) tiles[hit].classList.add('boom');
      paint();
    }
    function pick(i) {
      if (!st.on || st.open[i]) return;
      st.open[i] = true;
      if (st.board[i] === 1) {
        reveal(i, false); Sfx.boom(); haptic([70, 40, 120]);
        UI.toast('Skull! -' + fmt(st.bet), 'loss');
        finish(i); return;
      }
      st.found += 1; reveal(i, false); Sfx.gem(st.found); haptic(12);
      if (st.found >= N - mines) { cash(true); return; }
      paint();
    }
    function cash(all) {
      if (!st.on || !st.found) return;
      var m = mult(st.found, mines), win = Math.floor(st.bet * m);
      Games.payout(win, m, fmtMult(m) + (all === true ? ' · board cleared' : ''));
      Sfx.win(m >= 5 || all === true); haptic(30);
      finish();
    }
    onTap($('#mnMinus', pane), function () { Sfx.click(); setMines(mines - 1); });
    onTap($('#mnPlus', pane), function () { Sfx.click(); setMines(mines + 1); });
    $('#mnRange', pane).addEventListener('input', function (e) { setMines(+e.target.value); });
    var quick = $('#mnQuick', pane);
    [1, 3, 5, 10, 24].forEach(function (m) {
      var c = el('button', 'chip', m + (m === 1 ? ' mine' : ' mines')); c.type = 'button'; c.dataset.m = m;
      onTap(c, function () { if (st.on) return; Sfx.click(); setMines(m); });
      quick.appendChild(c);
    });
    tiles.forEach(function (t) { t.className = 'mt'; });
    setMines(3); paint();
    GC.mines = { get st() { return st; }, mult: mult, pick: pick, cash: cash, start: start, setMines: setMines };
    return {};
  }
});
