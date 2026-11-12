// Rugpull: a live candle chart climbs until it gets rugged. Cash out before that. ----------------------
Games.register({
  id: 'rug', title: 'Rugpull', icon: 'rug',
  mount: function (pane) {
    var RATE = 0.068, WAIT = 6, SHOW = 2.6, EDGE = 0.97, CANDLE = 0.85;
    var st = { phase: 'wait', t: 0, g: 0, pace: 1, crash: 1, mult: 1, candles: [], bet: 0, cashed: 0, cashMult: 0, scheduled: 0, bots: [], marks: [], yLo: 1, yHi: 1.3, rugT: 0 };
    var visible = false, lastTs = performance.now(), raf = 0, autoTarget = 0;
    pane.innerHTML = '<div class="rug-hist" id="rugHist"></div>' +
      '<div class="rug-stage"><canvas id="rugCv"></canvas><div class="rug-mult num" id="rugMult">1.00×</div><div class="rug-play" id="rugPlay"></div>' +
      '<div class="rug-count" id="rugCount"><div class="cl">Next round starting in</div><div class="ct num" id="rugCt">6.0s</div><div class="bar"><i id="rugBar"></i></div></div>' +
      '<div class="rug-rugged" id="rugRugged">RUGGED!</div><div class="rug-flash" id="rugFlash"></div></div>' +
      '<button class="btn big block green" id="rugBtn" type="button">Bet</button>' +
      '<div class="panel" id="rugBetBox"></div>' +
      '<div class="panel players" id="rugPlayers"></div>' +
      '<div class="note">The chart can be rugged at any moment, even at 1.00×. Play coins only.</div>';
    var bet = Games.BetCtl('rug', 25);
    var box = $('#rugBetBox', pane); box.appendChild(bet.el);
    var auto = el('div', '', '<div class="lbl" style="margin-top:12px"><span>Auto cash out</span><span id="rugAutoLbl">Off</span></div>');
    var chips = el('div', 'auto-row');
    [0, 1.5, 2, 3, 5, 10].forEach(function (m) {
      var c = el('button', 'chip' + (m === 0 ? ' on' : ''), m ? m + '×' : 'Off'); c.type = 'button';
      onTap(c, function () { Sfx.click(); autoTarget = m; $$('.chip', chips).forEach(function (x) { x.classList.remove('on'); }); c.classList.add('on'); $('#rugAutoLbl', pane).textContent = m ? 'at ' + m.toFixed(2) + '×' : 'Off'; });
      chips.appendChild(c);
    });
    auto.appendChild(chips); box.appendChild(auto);
    var cv = $('#rugCv', pane), g = cv.getContext('2d'), btn = $('#rugBtn', pane), multEl = $('#rugMult', pane), playEl = $('#rugPlay', pane);
    var W = 300, H = 250, dpr = 1;
    function size() {
      var r = cv.getBoundingClientRect(); if (!r.width) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    // P(crash >= x) = 0.97 / x; anything below 1 is an instant rug at 1.00x (3% of rounds)
    function crashPoint() {
      var m = EDGE / (1 - rand());
      return m < 1 ? 1 : Math.min(500, Math.floor(m * 100) / 100);
    }
    function newBots() {
      var n = 3 + randInt(4), arr = [];
      for (var i = 0; i < n; i++) {
        var r = Math.random();
        arr.push({ name: 'Player ' + (1000 + randInt(9000)), bet: Math.round(Math.pow(10, 1 + Math.random() * 2.3) / 5) * 5, target: r < 0.5 ? 1.1 + Math.random() * 0.9 : r < 0.85 ? 2 + Math.random() * 3 : 5 + Math.random() * 15, state: 'joined', at: 0 });
      }
      return arr;
    }
    function renderPlayers() {
      var rows = st.bots.slice();
      var html = '<div class="lbl" style="margin:0 0 4px"><span>' + (rows.length + (st.bet ? 1 : 0)) + ' playing</span><span>this round</span></div>';
      if (st.bet) {
        html += '<div class="p me"><span class="a">YOU</span><span class="grow">You · ' + fmt(st.bet) + '</span>' +
          (st.cashed ? '<span class="st c">CASHED ' + st.cashMult.toFixed(2) + '×<br>+' + fmt(st.cashed) + '</span>' : st.phase === 'rugged' ? '<span class="st r">RUGGED<br>-' + fmt(st.bet) + '</span>' : '<span class="st j">' + (st.phase === 'wait' ? 'JOINED' : 'IN PLAY') + '</span>') + '</div>';
      }
      rows.forEach(function (b) {
        html += '<div class="p"><span class="a">' + b.name.slice(-2) + '</span><span class="grow">' + b.name + ' · ' + fmt(b.bet) + '</span>' +
          (b.state === 'cashed' ? '<span class="st c">CASHED ' + b.at.toFixed(2) + '×<br>+' + fmt(Math.floor(b.bet * b.at)) + '</span>' : b.state === 'rugged' ? '<span class="st r">RUGGED</span>' : '<span class="st j">' + (st.phase === 'wait' ? 'JOINED' : 'IN PLAY') + '</span>') + '</div>';
      });
      $('#rugPlayers', pane).innerHTML = html;
    }
    function renderHist() {
      var h = Store.s.rugHistory || [];
      $('#rugHist', pane).innerHTML = h.length ? h.slice(0, 9).map(function (m) { return '<span class="h' + (m >= 10 ? ' gold' : m >= 2 ? ' g' : '') + '">' + m.toFixed(2) + '×</span>'; }).join('') : '<span class="h0">Last rounds show up here</span>';
    }
    function paintBtn() {
      var c = 'btn big block ', t;
      if (st.phase === 'live' && st.bet && !st.cashed) { c += 'gold'; t = 'Cash out +' + fmt(Math.floor(st.bet * st.mult)); }
      else if (st.phase === 'wait') { if (st.bet) { c += 'red'; t = 'Cancel bet'; } else { c += 'green'; t = 'Bet this round'; } }
      else { if (st.scheduled) { c += 'red'; t = 'Cancel next round bet'; } else { c += 'green'; t = 'Bet next round'; } }
      btn.className = c; btn.textContent = t;
      bet.lock(!!(st.bet && st.phase !== 'wait' && !st.cashed) || (st.phase === 'wait' && !!st.bet));
    }
    function startWait() {
      st.phase = 'wait'; st.t = 0; st.bet = 0; st.cashed = 0; st.cashMult = 0; st.mult = 1; st.candles = []; st.marks = []; st.bots = newBots(); st.yLo = 1; st.yHi = 1.3;
      $('#rugRugged', pane).classList.remove('on'); $('#rugCount', pane).classList.add('on'); multEl.style.display = 'none'; playEl.classList.remove('on');
      if (st.scheduled) {
        var want = st.scheduled; st.scheduled = 0; bet.set(want);
        var took = bet.take(); if (took) st.bet = took;
      }
      renderPlayers(); paintBtn();
    }
    function startLive() {
      st.phase = 'live'; st.t = 0; st.g = 0; st.pace = 1; st.crash = crashPoint(); st.mult = 1; st.candles = [{ o: 1, c: 1, h: 1, l: 1, t0: 0 }];
      $('#rugCount', pane).classList.remove('on'); multEl.style.display = ''; multEl.className = 'rug-mult num';
      if (st.bet) playEl.classList.add('on');
      renderPlayers(); paintBtn();
    }
    function cashOut(m, isAuto) {
      if (!st.bet || st.cashed || st.phase !== 'live') return;
      st.cashed = Math.floor(st.bet * m); st.cashMult = m;
      Games.payout(st.cashed, m, m.toFixed(2) + '×' + (isAuto ? ' auto' : ''));
      Sfx.win(m >= 5); haptic(30);
      st.marks.push({ label: 'YOU ' + m.toFixed(2) + '×', m: m, t: st.t, me: true });
      playEl.classList.remove('on'); renderPlayers(); paintBtn();
    }
    function rug() {
      st.phase = 'rugged'; st.t = 0; st.mult = st.crash; st.rugT = 0;
      var h = Store.s.rugHistory || (Store.s.rugHistory = []); h.unshift(st.crash); if (h.length > 14) h.length = 14; Store.save();
      st.bots.forEach(function (b) { if (b.state !== 'cashed') b.state = 'rugged'; });
      multEl.className = 'rug-mult num dead'; multEl.textContent = st.crash.toFixed(2) + '×';
      $('#rugRugged', pane).classList.add('on'); playEl.classList.remove('on');
      var f = $('#rugFlash', pane); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
      if (visible || (st.bet && !st.cashed)) { Sfx.rugged(); }
      if (st.bet && !st.cashed) { haptic([60, 40, 120]); UI.toast('Rugged at ' + st.crash.toFixed(2) + '× · -' + fmt(st.bet), 'loss'); }
      renderHist(); renderPlayers(); paintBtn();
    }
    function advance(dt) {
      st.t += dt;
      if (st.phase === 'wait') {
        var left = Math.max(0, WAIT - st.t);
        $('#rugCt', pane).textContent = left.toFixed(1) + 's'; $('#rugBar', pane).style.width = (left / WAIT * 100) + '%';
        if (st.t >= WAIT) startLive();
      } else if (st.phase === 'live') {
        st.g += dt * RATE * (1 + st.t * 0.008) * st.pace;
        var m = Math.exp(st.g);
        if (m >= st.crash) { rug(); return; }
        st.mult = m;
        var c = st.candles[st.candles.length - 1];
        if (st.t - c.t0 >= CANDLE) {
          c.c = m; c.h = Math.max(c.h, m);
          st.pace = 0.28 + 1.75 * Math.pow(Math.random(), 1.7);
          c = { o: m, c: m, h: m, l: m * (1 - Math.random() * Math.random() * 0.012), t0: st.t }; st.candles.push(c); if (st.candles.length > 40) st.candles.shift();
          if (visible) Sfx.tick(Math.min(20, Math.round(st.t / CANDLE)));
        }
        c.c = m; c.h = Math.max(c.h, m * (1 + Math.random() * 0.002));
        st.bots.forEach(function (b) {
          if (b.state === 'joined' && m >= b.target) { b.state = 'cashed'; b.at = b.target; st.marks.push({ label: b.name + ' ' + b.target.toFixed(2) + '×', m: b.target, t: st.t }); renderPlayers(); }
        });
        if (st.bet && !st.cashed && autoTarget >= 1.01 && m >= autoTarget) cashOut(autoTarget, true);
        multEl.textContent = m.toFixed(2) + '×';
        var cls = 'rug-mult num' + (m >= 6 ? ' gold' : m >= 3.5 ? ' hot' : ''); if (multEl.className !== cls) multEl.className = cls;
        if (st.bet && !st.cashed) { playEl.textContent = 'IN PLAY: +' + fmt(Math.floor(st.bet * m)); btn.textContent = 'Cash out +' + fmt(Math.floor(st.bet * m)); }
      } else if (st.phase === 'rugged') {
        st.rugT += dt;
        if (st.t >= SHOW) startWait();
      }
    }
    function rr(x, y, w, h, r) { r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function draw() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (st.phase === 'wait') return;
      var padR = 46, top = 112, bot = H - 16, cs = st.candles, n = cs.length, show = 6;
      var first = Math.max(0, n - show), lo = Infinity, hi = st.mult;
      for (var i = first; i < n; i++) { lo = Math.min(lo, cs[i].o, cs[i].l); hi = Math.max(hi, cs[i].h); }
      if (!isFinite(lo)) lo = 1;
      var span = Math.max(hi - lo, 0.05); lo -= span * 0.2; hi += span * 0.16;
      st.yLo += (lo - st.yLo) * 0.12; st.yHi += (hi - st.yHi) * 0.12;
      var Y = function (v) { return bot - (v - st.yLo) / (st.yHi - st.yLo) * (bot - top); };
      // grid + axis labels
      g.font = '600 10.5px Outfit, system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
      for (var k = 0; k <= 4; k++) {
        var v = st.yLo + (st.yHi - st.yLo) * k / 4, y = Y(v);
        g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR + 6, y); g.stroke();
        g.fillStyle = 'rgba(190,184,214,0.55)'; g.fillText(v.toFixed(2) + '×', W - 6, y);
      }
      var slot = (W - padR - 20) / (show + 1.3), cw = Math.min(30, slot * 0.6), x0 = 14;
      var rugged = st.phase === 'rugged', lastX = x0;
      for (var j = first; j < n; j++) {
        var c = cs[j], x = x0 + (j - first + (n < show ? 0 : 0)) * slot + slot * 0.5; lastX = x;
        var yo = Y(c.o), yc = Y(c.c), yh = Y(c.h), yl = Y(c.l);
        g.globalAlpha = rugged ? 0.35 : 1;
        g.strokeStyle = '#2fe579'; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, yh); g.lineTo(x, yl); g.stroke();
        g.fillStyle = '#2fe579'; g.shadowColor = 'rgba(47,229,121,0.75)'; g.shadowBlur = rugged ? 0 : 14;
        var hgt = Math.max(6, yo - yc); rr(x - cw / 2, yo - hgt, cw, hgt, 6); g.fill();
        g.shadowBlur = 0; g.globalAlpha = 1;
      }
      if (!rugged) {
        var yy = Y(st.mult);
        g.setLineDash([5, 5]); g.strokeStyle = 'rgba(47,229,121,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(lastX + cw / 2 + 3, yy); g.lineTo(W - padR + 4, yy); g.stroke(); g.setLineDash([]);
        // cash-out tags
        g.textAlign = 'left'; g.font = '700 10px Outfit, system-ui, sans-serif';
        st.marks.forEach(function (mk) {
          var age = st.t - mk.t; if (age > 3.2 || mk.m < st.yLo) return;
          var a = 1 - smooth(2.4, 3.2, age), my = Y(mk.m), tw = g.measureText(mk.label).width + 14, mx = Math.max(6, Math.min(W - padR - tw, lastX - tw - 8));
          g.globalAlpha = a; g.fillStyle = 'rgba(10,26,18,0.92)'; rr(mx, my - 10, tw, 20, 6); g.fill();
          g.strokeStyle = mk.me ? '#ffc531' : '#2fe579'; g.lineWidth = 1.2; g.stroke();
          g.fillStyle = mk.me ? '#ffc531' : '#bff7d4'; g.fillText(mk.label, mx + 7, my + 0.5); g.globalAlpha = 1;
        });
      } else {
        var k2 = ease.outCubic(sat(st.rugT / 0.28)), y1 = Y(st.mult), y2 = lerp(y1, H + 20, k2);
        g.fillStyle = '#ff3b52'; g.shadowColor = 'rgba(255,60,80,0.9)'; g.shadowBlur = 26;
        rr(lastX - cw * 0.7, y1, cw * 1.4, y2 - y1, 6); g.fill(); g.shadowBlur = 0;
      }
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.25, (now - lastTs) / 1000); lastTs = now;
      advance(dt); if (visible) draw();
    }
    // keeps a running bet alive while this tab is hidden
    setInterval(function () {
      var now = performance.now();
      if (!visible && now - lastTs > 300 && (st.bet || st.scheduled || st.phase !== 'wait')) { var dt = Math.min(1.5, (now - lastTs) / 1000); lastTs = now; advance(dt); }
    }, 250);
    onTap(btn, function () {
      Sfx.unlock();
      if (st.phase === 'live' && st.bet && !st.cashed) { cashOut(st.mult, false); return; }
      if (st.phase === 'wait') {
        if (st.bet) { Store.addCoins(st.bet); Store.s.stats.wagered -= st.bet; st.bet = 0; Sfx.click(); }
        else { var took = bet.take(); if (took) { st.bet = took; Sfx.coin(1); } }
      } else {
        if (st.scheduled) { st.scheduled = 0; Sfx.click(); }
        else {
          var v = bet.get();
          if (Store.s.coins <= 0) { Sfx.deny(); UI.toast('No coins yet. Sell items from your inventory.'); }
          else if (v > Store.s.coins) { Sfx.deny(); UI.toast('Not enough coins. Your balance is ' + fmt(Store.s.coins) + '.'); bet.set(Store.s.coins); }
          else { st.scheduled = v; Sfx.click(); UI.toast('Bet of ' + fmt(v) + ' set for the next round'); }
        }
      }
      renderPlayers(); paintBtn();
    });
    window.addEventListener('resize', function () { if (visible) size(); });
    renderHist(); startWait();
    GC.rug = { st: st, advance: advance, draw: draw, force: function (m) { st.crash = m; } };
    return {
      show: function () { visible = true; size(); lastTs = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
      hide: function () { visible = false; cancelAnimationFrame(raf); lastTs = performance.now(); }
    };
  }
});
