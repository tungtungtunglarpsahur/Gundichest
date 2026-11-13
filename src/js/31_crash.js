// Rugpull and Rocket: the multiplier climbs until the round ends, cash out before that. ------------------
// Both are the same game with a different face, so they share this file: CrashGame() runs the rounds, a skin
// draws them (candles for Rugpull, a flying rocket for Rocket).
//
// With an account, every round that has a bet on it is played on the server (server/crash.js): the page sends the
// bet, the server rolls where the round ends, keeps the clock, and pays a cash-out at the multiplier of its own
// clock. The page learns where a round ended when it has ended. Rounds nobody bet on, and the single-file
// version of the game, are rolled right here.
function CrashGame(cfg) {
  Games.register({
    id: cfg.id, title: cfg.title, icon: cfg.icon,
    mount: function (pane) {
      var G = CrashMath.games[cfg.key], P = cfg.id, WAIT = 6, SHOW = 2.6, LAG = 0.08;
      var online = function () { return Net.enabled && !!Net.user; };
      // t: clock of the phase in seconds, lt: seconds the round has been live (stays where the round ended)
      var st = { phase: 'wait', t: 0, lt: 0, mult: 1, crash: 1, path: G.path(randInt(2147483647)), bet: 0, cashed: 0, cashMult: 0, scheduled: 0, bots: [], marks: [], rugT: 0,
        round: null, placing: false, cashing: false, t0: 0, startAt: 0 };
      var visible = false, lastTs = performance.now(), raf = 0, autoTarget = 0, lastStep = -1;
      var histKey = cfg.id === 'rug' ? 'rugHistory' : cfg.id + 'History';
      pane.innerHTML = '<div class="rug-hist" id="' + P + 'Hist"></div>' +
        '<div class="rug-stage ' + P + '-stage"><canvas id="' + P + 'Cv"></canvas><div class="rug-mult num" id="' + P + 'Mult">1.00×</div><div class="rug-play" id="' + P + 'Play"></div>' +
        '<div class="rug-count" id="' + P + 'Count"><div class="cl">Next round starting in</div><div class="ct num" id="' + P + 'Ct">6.0s</div><div class="bar"><i id="' + P + 'Bar"></i></div></div>' +
        '<div class="rug-rugged" id="' + P + 'Rugged">' + cfg.over + '</div><div class="rug-flash" id="' + P + 'Flash"></div></div>' +
        '<button class="btn big block green" id="' + P + 'Btn" type="button">Bet</button>' +
        '<div class="panel" id="' + P + 'BetBox"></div>' +
        '<div class="panel players" id="' + P + 'Players"></div>' +
        '<div class="note">' + cfg.note + '</div>';
      var q = function (name) { return $('#' + P + name, pane); };
      var bet = Games.BetCtl(P, 25);
      var box = q('BetBox'); box.appendChild(bet.el);
      var auto = el('div', '', '<div class="lbl" style="margin-top:12px"><span>Auto cash out</span><span id="' + P + 'AutoLbl">Off</span></div>');
      var chips = el('div', 'auto-row');
      function showAuto(m) {
        $$('.chip', chips).forEach(function (x) { x.classList.toggle('on', +x.dataset.m === m); });
        q('AutoLbl').textContent = m ? 'at ' + m.toFixed(2) + '×' : 'Off';
      }
      [0, 1.5, 2, 3, 5, 10].forEach(function (m) {
        var c = el('button', 'chip' + (m === 0 ? ' on' : ''), m ? m + '×' : 'Off'); c.type = 'button'; c.dataset.m = m;
        onTap(c, function () {
          Sfx.click(); autoTarget = m; showAuto(m);
          // a bet that is already with the server: the server has to know, and may say it is too late
          var rd = st.round;
          if (rd && !st.cashed && st.phase !== 'rugged' && rd.auto !== m) {
            Net.call('crash.auto', { id: rd.id, auto: m }).then(function (r) { if (st.round !== rd) return; Net.book(r); rd.auto = r.round.auto; settle(r.round); },
              function (e) { if (st.round !== rd) return; UI.toast(esc(e.message)); autoTarget = rd.auto; showAuto(rd.auto); });
          }
        });
        chips.appendChild(c);
      });
      auto.appendChild(chips); box.appendChild(auto);
      var cv = q('Cv'), g = cv.getContext('2d'), btn = q('Btn'), multEl = q('Mult'), playEl = q('Play');
      var W = 300, H = 250, dpr = 1;
      function size() {
        var r = cv.getBoundingClientRect(); if (!r.width) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height;
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      }
      var skin = cfg.skin(st, G);
      function newBots() {
        var n = 3 + randInt(4), arr = [];
        for (var i = 0; i < n; i++) {
          var r = Math.random();
          arr.push({ name: 'Player ' + (1000 + randInt(9000)), bet: Math.round(Math.pow(10, 1 + Math.random() * 2.3) / 5) * 5, target: r < 0.5 ? 1.1 + Math.random() * 0.9 : r < 0.85 ? 2 + Math.random() * 3 : 5 + Math.random() * 15, state: 'joined' });
        }
        return arr;
      }
      function renderPlayers() {
        var rows = st.bots.slice();
        var html = '<div class="lbl" style="margin:0 0 4px"><span>' + (rows.length + (st.bet ? 1 : 0)) + ' playing</span><span>this round</span></div>';
        if (st.bet) {
          html += '<div class="p me"><span class="a">YOU</span><span class="grow">You · ' + fmt(st.bet) + '</span>' +
            (st.cashed ? '<span class="st c">CASHED ' + st.cashMult.toFixed(2) + '×<br>+' + fmt(st.cashed) + '</span>' : st.phase === 'rugged' ? '<span class="st r">' + cfg.lost + '<br>-' + fmt(st.bet) + '</span>' : '<span class="st j">' + (st.phase === 'wait' ? 'READY' : 'IN PLAY') + '</span>') + '</div>';
        }
        rows.forEach(function (b) {
          html += '<div class="p"><span class="a">' + b.name.slice(-2) + '</span><span class="grow">' + b.name + ' · ' + fmt(b.bet) + '</span>' +
            (b.state === 'cashed' ? '<span class="st c">CASHED ' + b.at.toFixed(2) + '×<br>+' + fmt(Math.floor(b.bet * b.at)) + '</span>' : b.state === 'rugged' ? '<span class="st r">' + cfg.lost + '</span>' : '<span class="st j">' + (st.phase === 'wait' ? 'READY' : 'IN PLAY') + '</span>') + '</div>';
        });
        q('Players').innerHTML = html;
      }
      function renderHist() {
        var h = Store.s[histKey] || [];
        q('Hist').innerHTML = h.length ? h.slice(0, 9).map(function (m) { return '<span class="h' + (m >= 10 ? ' gold' : m >= 2 ? ' g' : '') + '">' + m.toFixed(2) + '×</span>'; }).join('') : '<span class="h0">Last rounds show up here</span>';
      }
      function paintBtn() {
        var c = 'btn big block ', t, off = false;
        if (st.phase === 'live' && st.bet && !st.cashed) { c += 'gold'; t = st.cashing ? 'Cashing out…' : 'Cash out +' + fmt(Math.floor(st.bet * st.mult)); off = st.cashing; }
        else if (st.phase === 'wait') {
          if (st.placing) { c += 'green'; t = 'Placing bet…'; off = true; }
          else if (st.bet) { c += 'red'; t = 'Cancel bet'; } else { c += 'green'; t = 'Bet this round'; }
        } else { if (st.scheduled) { c += 'red'; t = 'Cancel next round bet'; } else { c += 'green'; t = 'Bet next round'; } }
        btn.className = c; btn.textContent = t; btn.disabled = off;
        bet.lock(st.placing || !!(st.bet && st.phase !== 'wait' && !st.cashed) || (st.phase === 'wait' && !!st.bet));
      }

      // ---- a bet -------------------------------------------------------------------------------------------
      function place(v) {
        if (!online()) {                              // this device plays alone: the coins leave the balance right here
          bet.set(v);
          var took = bet.take(); if (took) { st.bet = took; Sfx.coin(1); }
          return;
        }
        bet.set(v);
        v = bet.check(); if (!v) return;
        st.placing = true; paintBtn();
        var sent = 0;
        // the server takes the bet from its copy of the game, so that copy has to be up to date first
        Net.syncNow().catch(function () {}).then(function () {
          sent = performance.now();
          return Net.call('crash.bet', { game: cfg.key, bet: v, auto: autoTarget, startIn: Math.max(0, Math.round((WAIT - st.t) * 1000)) });
        }).then(function (r) {
          st.placing = false;
          Net.book(r);
          var now = performance.now(), rd = r.round;
          st.round = rd; st.bet = rd.bet; st.path = G.path(rd.seed);
          // my clock for this round: the server's, less half the way the answer took, a touch behind
          st.startAt = now + rd.startIn - (now - sent) / 2 + LAG * 1000;
          if (st.phase === 'wait') st.t = WAIT - (st.startAt - now) / 1000;
          Sfx.coin(1); watch(rd);
          renderPlayers(); paintBtn();
        }, function (e) {
          st.placing = false;
          Sfx.deny(); UI.toast(esc(e.message || 'The bet could not be placed.'));
          if (e.code === 'busy') resume();
          renderPlayers(); paintBtn();
        });
      }
      function unbet() {
        var rd = st.round;
        if (!rd) { Store.addCoins(st.bet); Store.s.stats.wagered -= st.bet; st.bet = 0; Sfx.click(); return; }
        st.placing = true; paintBtn();
        Net.call('crash.cancel', { id: rd.id }).then(function (r) {
          st.placing = false; Net.book(r);
          if (st.round === rd && r.round.status === 'cancelled') { st.round = null; st.bet = 0; st.path = G.path(randInt(2147483647)); Sfx.click(); }
          renderPlayers(); paintBtn();
        }, function (e) { st.placing = false; if (e.code !== 'started') UI.toast(esc(e.message)); renderPlayers(); paintBtn(); });
      }
      // The server answers this request when the round has ended: that is how the page hears of it.
      function watch(rd) {
        Net.call('crash.wait', { id: rd.id }, { timeout: 40000 }).then(function (r) {
          if (st.round !== rd) return;
          Net.book(r);
          if (r.live) { if (!st.cashed) watch(rd); return; }
          settle(r.round);
        }, function (e) {
          if (st.round !== rd) return;
          if (e.code === 'round') { settle({ id: rd.id, status: 'rugged', crash: Math.max(1, Math.floor(st.mult * 100) / 100) }); return; }
          setTimeout(function () { if (st.round === rd && !st.cashed) watch(rd); }, 1500);
        });
      }
      // What the server says about my round: paid out, or over.
      function settle(rd) {
        if (!st.round || rd.id !== st.round.id) return;
        if (rd.status === 'cashed' && !st.cashed) {
          st.cashed = rd.paid; st.cashMult = rd.mult; st.crash = rd.crash;       // from here on the page knows the end and plays it out itself
          paid(rd.paid, rd.mult, st.round.auto && Math.abs(st.round.auto - rd.mult) < 0.005);
        } else if (rd.status === 'rugged') {
          st.crash = rd.crash;
          if (st.phase === 'live') rug();
          else if (st.phase === 'wait') { st.lt = 0; startLive(); rug(); }
        } else if (rd.status === 'cashed') st.crash = rd.crash;
      }
      function paid(amount, m, isAuto) {
        UI.toast('<span class="coin-ic sm"></span> +' + fmt(amount) + ' · ' + m.toFixed(2) + '×' + (isAuto ? ' auto' : ''), 'win');
        Sfx.win(m >= 5); haptic(30);
        st.marks.push({ label: 'YOU ' + m.toFixed(2) + '×', m: m, t: st.lt, me: true });
        playEl.classList.remove('on'); renderPlayers(); paintBtn();
      }
      // After a reload: is a round of mine still running on the server?
      function resume() {
        if (!online()) return;
        Net.call('crash.state').then(function (r) {
          Net.book(r);
          var rd = (r.rounds || []).filter(function (x) { return x.game === cfg.key; })[0];
          if (!rd || st.round) return;
          if (st.bet && !online()) return;
          var now = performance.now();
          st.round = rd; st.bet = rd.bet; st.cashed = 0; st.cashMult = 0; st.scheduled = 0; st.path = G.path(rd.seed);
          st.startAt = now + rd.startIn + LAG * 1000;
          autoTarget = rd.auto; showAuto(rd.auto);
          if (rd.startIn > 0) { if (st.phase !== 'wait') startWait(true); st.t = WAIT - (st.startAt - now) / 1000; }
          else { if (st.phase !== 'wait') startWait(true); startLive(); }
          watch(rd); renderPlayers(); paintBtn();
        }, function () {});
      }

      // ---- the round ------------------------------------------------------------------------------------------
      function startWait(keep) {
        st.phase = 'wait'; st.t = 0; st.lt = 0; st.bet = 0; st.cashed = 0; st.cashMult = 0; st.mult = 1; st.marks = []; st.bots = newBots();
        st.round = null; st.placing = false; st.cashing = false; st.path = G.path(randInt(2147483647)); lastStep = -1;
        skin.reset();
        q('Rugged').classList.remove('on'); q('Count').classList.add('on'); multEl.style.display = 'none'; playEl.classList.remove('on');
        if (st.scheduled && !keep) { var want = st.scheduled; st.scheduled = 0; place(want); }
        renderPlayers(); paintBtn();
      }
      function startLive() {
        st.phase = 'live'; st.t = 0; st.lt = 0; st.mult = 1; lastStep = -1;
        st.crash = st.round ? Infinity : CrashMath.crashPoint(rand(), G.edge, G.max);      // with a bet on the server only the server knows
        st.t0 = st.round ? st.startAt : performance.now();
        q('Count').classList.remove('on'); multEl.style.display = ''; multEl.className = 'rug-mult num';
        if (st.bet) playEl.classList.add('on');
        renderPlayers(); paintBtn();
      }
      function cashOut(m, isAuto) {
        if (!st.bet || st.cashed || st.phase !== 'live') return;
        if (st.round) {                               // the server decides: its clock, its multiplier
          if (st.cashing) return;
          var rd = st.round;
          st.cashing = true; paintBtn();
          Net.call('crash.cashout', { id: rd.id }).then(function (r) { st.cashing = false; if (st.round !== rd) return; Net.book(r); settle(r.round); paintBtn(); },
            function (e) { st.cashing = false; if (st.round !== rd) return; if (e.code !== 'early') UI.toast(esc(e.message)); paintBtn(); });
          return;
        }
        st.cashed = Math.floor(st.bet * m); st.cashMult = m;
        Store.addCoins(st.cashed, 'win');
        if (m > Store.s.stats.bestMult) { Store.s.stats.bestMult = m; Store.save(); }
        paid(st.cashed, m, isAuto);
      }
      function rug() {
        st.phase = 'rugged'; st.t = 0; st.mult = st.crash; st.rugT = 0;
        var h = Store.s[histKey] || (Store.s[histKey] = []); h.unshift(st.crash); if (h.length > 14) h.length = 14; Store.save();
        st.bots.forEach(function (b) { if (b.state !== 'cashed') b.state = 'rugged'; });
        multEl.className = 'rug-mult num dead'; multEl.textContent = st.crash.toFixed(2) + '×';
        q('Rugged').classList.add('on'); playEl.classList.remove('on');
        var f = q('Flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
        if (visible || (st.bet && !st.cashed)) cfg.sound();
        if (st.bet && !st.cashed) { haptic([60, 40, 120]); UI.toast(cfg.lostAt + ' ' + st.crash.toFixed(2) + '× · -' + fmt(st.bet), 'loss'); }
        skin.rugged();
        renderHist(); renderPlayers(); paintBtn();
      }
      function advance(dt) {
        var now = performance.now();
        if (st.phase === 'wait') {
          // with a bet on the server the countdown follows the round's start time there
          if (st.round) st.t = WAIT - (st.startAt - now) / 1000; else st.t += dt;
          if (st.placing) st.t = Math.min(st.t, WAIT - 0.25);
          var left = Math.max(0, WAIT - st.t);
          q('Ct').textContent = left.toFixed(1) + 's'; q('Bar').style.width = (left / WAIT * 100) + '%';
          if (st.t >= WAIT) startLive();
        } else if (st.phase === 'live') {
          st.t += dt;
          st.lt = st.round ? Math.max(0, (now - st.t0) / 1000) : st.lt + dt;
          var m = Math.min(G.max, st.path.multAt(st.lt));
          if (m >= st.crash) { rug(); return; }
          st.mult = m;
          var step = skin.step(st.lt);
          if (step !== lastStep) { lastStep = step; if (visible && step > 0) Sfx.tick(Math.min(20, step)); }
          st.bots.forEach(function (b) {
            if (b.state === 'joined' && m >= b.target) { b.state = 'cashed'; b.at = b.target; st.marks.push({ label: b.name + ' ' + b.target.toFixed(2) + '×', m: b.target, t: st.lt }); renderPlayers(); }
          });
          var target = st.round ? st.round.auto : autoTarget;
          if (st.bet && !st.cashed && target >= 1.01 && m >= target) cashOut(target, true);
          multEl.textContent = m.toFixed(2) + '×';
          var cls = 'rug-mult num' + (m >= 6 ? ' gold' : m >= 3.5 ? ' hot' : ''); if (multEl.className !== cls) multEl.className = cls;
          if (st.bet && !st.cashed) { playEl.textContent = 'IN PLAY: +' + fmt(Math.floor(st.bet * m)); if (!st.cashing) btn.textContent = 'Cash out +' + fmt(Math.floor(st.bet * m)); }
        } else if (st.phase === 'rugged') {
          st.t += dt; st.rugT += dt;
          if (st.t >= SHOW) startWait();
        }
      }
      function draw() { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); skin.draw(g, W, H); }
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
        if (st.placing || st.cashing) return;
        if (st.phase === 'live' && st.bet && !st.cashed) { cashOut(st.mult, false); return; }
        if (st.phase === 'wait') {
          if (st.bet) unbet(); else place(bet.get());
        } else {
          if (st.scheduled) { st.scheduled = 0; Sfx.click(); }
          else { var v = bet.check(); if (v) { st.scheduled = v; Sfx.click(); UI.toast('Bet of ' + fmt(v) + ' set for the next round'); } }
        }
        renderPlayers(); paintBtn();
      });
      window.addEventListener('resize', function () { if (visible) size(); });
      renderHist(); startWait(); resume();
      GC[cfg.id] = { st: st, advance: advance, draw: draw, force: function (m) { st.crash = m; } };
      return {
        show: function () { visible = true; size(); lastTs = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
        hide: function () { visible = false; cancelAnimationFrame(raf); lastTs = performance.now(); }
      };
    }
  });
}

// ---- Rugpull: a candle chart ---------------------------------------------------------------------------------
CrashGame({
  id: 'rug', key: 'rug', title: 'Rugpull', icon: 'rug', over: 'RUGGED!', lost: 'RUGGED', lostAt: 'Rugged at',
  note: 'The chart can be rugged at any moment, even at 1.00×. Play coins only.',
  sound: function () { Sfx.rugged(); },
  skin: function (st, G) {
    var C = G.CANDLE, yLo = 1, yHi = 1.3;
    function rr(g, x, y, w, h, r) { r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    // the candles up to now come straight from the round's curve, so a reload draws the same chart
    function candles(show) {
      var n = Math.floor(st.lt / C) + 1, out = [];
      for (var k = Math.max(0, n - show); k < n; k++) {
        var o = st.path.multAt(k * C), c = k === n - 1 ? Math.max(o, Math.min(st.mult, st.path.multAt((k + 1) * C))) : st.path.multAt((k + 1) * C), w = st.path.wick(k);
        out.push({ o: o, c: c, h: c * 1.0015, l: o * (1 - w * w * 0.012) });
      }
      return out;
    }
    return {
      reset: function () { yLo = 1; yHi = 1.3; },
      rugged: function () {},
      step: function (lt) { return Math.floor(lt / C); },
      draw: function (g, W, H) {
        if (st.phase === 'wait') return;
        var padR = 46, top = 112, bot = H - 16, show = 6, cs = candles(show), n = cs.length, rugged = st.phase === 'rugged';
        var lo = Infinity, hi = rugged ? cs[n - 1].c : st.mult, i;
        for (i = 0; i < n; i++) { lo = Math.min(lo, cs[i].o, cs[i].l); hi = Math.max(hi, cs[i].h); }
        if (!isFinite(lo)) lo = 1;
        var span = Math.max(hi - lo, 0.05); lo -= span * 0.2; hi += span * 0.16;
        yLo += (lo - yLo) * 0.12; yHi += (hi - yHi) * 0.12;
        var Y = function (v) { return bot - (v - yLo) / (yHi - yLo) * (bot - top); };
        g.font = '600 10.5px Outfit, system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
        for (var k = 0; k <= 4; k++) {
          var v = yLo + (yHi - yLo) * k / 4, y = Y(v);
          g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR + 6, y); g.stroke();
          g.fillStyle = 'rgba(190,184,214,0.55)'; g.fillText(v.toFixed(2) + '×', W - 6, y);
        }
        var slot = (W - padR - 20) / (show + 1.3), cw = Math.min(30, slot * 0.6), x0 = 14, lastX = x0;
        for (var j = 0; j < n; j++) {
          var c = cs[j], x = x0 + j * slot + slot * 0.5; lastX = x;
          var yo = Y(c.o), yc = Y(c.c), yh = Y(c.h), yl = Y(c.l);
          g.globalAlpha = rugged ? 0.35 : 1;
          g.strokeStyle = '#2fe579'; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, yh); g.lineTo(x, yl); g.stroke();
          g.fillStyle = '#2fe579'; g.shadowColor = 'rgba(47,229,121,0.75)'; g.shadowBlur = rugged ? 0 : 14;
          var hgt = Math.max(6, yo - yc); rr(g, x - cw / 2, yo - hgt, cw, hgt, 6); g.fill();
          g.shadowBlur = 0; g.globalAlpha = 1;
        }
        if (!rugged) {
          var yy = Y(st.mult);
          g.setLineDash([5, 5]); g.strokeStyle = 'rgba(47,229,121,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(lastX + cw / 2 + 3, yy); g.lineTo(W - padR + 4, yy); g.stroke(); g.setLineDash([]);
          g.textAlign = 'left'; g.font = '700 10px Outfit, system-ui, sans-serif';
          st.marks.forEach(function (mk) {
            var age = st.lt - mk.t; if (age > 3.2 || mk.m < yLo) return;
            var a = 1 - smooth(2.4, 3.2, age), my = Y(mk.m), tw = g.measureText(mk.label).width + 14, mx = Math.max(6, Math.min(W - padR - tw, lastX - tw - 8));
            g.globalAlpha = a; g.fillStyle = 'rgba(10,26,18,0.92)'; rr(g, mx, my - 10, tw, 20, 6); g.fill();
            g.strokeStyle = mk.me ? '#ffc531' : '#2fe579'; g.lineWidth = 1.2; g.stroke();
            g.fillStyle = mk.me ? '#ffc531' : '#bff7d4'; g.fillText(mk.label, mx + 7, my + 0.5); g.globalAlpha = 1;
          });
        } else {
          var k2 = ease.outCubic(sat(st.rugT / 0.28)), y1 = Y(cs[n - 1].c), y2 = lerp(y1, H + 20, k2);
          g.fillStyle = '#ff3b52'; g.shadowColor = 'rgba(255,60,80,0.9)'; g.shadowBlur = 26;
          rr(g, lastX - cw * 0.7, y1, cw * 1.4, y2 - y1, 6); g.fill(); g.shadowBlur = 0;
        }
      }
    };
  }
});

// ---- Rocket: it flies until it blows up ----------------------------------------------------------------------
CrashGame({
  id: 'rocket', key: 'rocket', title: 'Rocket', icon: 'rocket', over: 'BOOM!', lost: 'CRASHED', lostAt: 'Crashed at',
  note: 'The rocket can blow up at any moment, even on the pad. Play coins only.',
  sound: function () { Sfx.boom(); },
  skin: function (st) {
    var stars = [], sparks = [], smoke = 0, i;
    for (i = 0; i < 46; i++) stars.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7 });
    function ship(g, x, y, ang, s, burn) {
      g.save(); g.translate(x, y); g.rotate(ang); g.scale(s, s);
      if (burn) {                                 // the flame flickers behind it
        var f = 16 + Math.random() * 12;
        var fl = g.createLinearGradient(-14, 0, -14 - f, 0); fl.addColorStop(0, '#fff3b0'); fl.addColorStop(0.4, '#ffb02e'); fl.addColorStop(1, 'rgba(255,60,20,0)');
        g.fillStyle = fl; g.beginPath(); g.moveTo(-13, -6); g.quadraticCurveTo(-14 - f * 0.6, -3, -14 - f, 0); g.quadraticCurveTo(-14 - f * 0.6, 3, -13, 6); g.closePath(); g.fill();
      }
      g.fillStyle = '#ff4d5e'; g.beginPath(); g.moveTo(-12, -7); g.lineTo(-20, -14); g.lineTo(-4, -8); g.closePath(); g.fill();          // fins
      g.beginPath(); g.moveTo(-12, 7); g.lineTo(-20, 14); g.lineTo(-4, 8); g.closePath(); g.fill();
      var body = g.createLinearGradient(0, -9, 0, 9); body.addColorStop(0, '#ffffff'); body.addColorStop(1, '#b9bfd6');
      g.fillStyle = body; g.beginPath(); g.moveTo(-14, -8); g.lineTo(6, -8); g.quadraticCurveTo(20, -5, 25, 0); g.quadraticCurveTo(20, 5, 6, 8); g.lineTo(-14, 8); g.closePath(); g.fill();
      g.fillStyle = '#ff4d5e'; g.beginPath(); g.moveTo(12, -6.6); g.quadraticCurveTo(21, -4, 25, 0); g.quadraticCurveTo(21, 4, 12, 6.6); g.closePath(); g.fill();   // nose
      g.fillStyle = '#16c8ff'; g.strokeStyle = '#0b2a45'; g.lineWidth = 1.6; g.beginPath(); g.arc(2, 0, 4.2, 0, 6.2832); g.fill(); g.stroke();
      g.restore();
    }
    return {
      reset: function () { sparks = []; smoke = 0; },
      rugged: function () {
        sparks = [];
        for (var k = 0; k < 46; k++) { var a = Math.random() * 6.2832, v = 60 + Math.random() * 260; sparks.push({ x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 4, c: ['#fff3b0', '#ffb02e', '#ff5a3c', '#ffffff'][k % 4] }); }
      },
      step: function (lt) { return Math.floor(lt / 1.5); },
      draw: function (g, W, H) {
        var live = st.phase === 'live', over = st.phase === 'rugged', t = st.lt, k;
        // space, drifting faster the faster it climbs
        var speed = st.phase === 'wait' ? 0.004 : 0.02 + Math.min(0.25, Math.log(Math.max(1, st.mult)) * 0.05);
        g.fillStyle = '#fff';
        for (k = 0; k < stars.length; k++) {
          var s = stars[k];
          if (!over) { s.x -= speed * s.z * 0.016; s.y += speed * s.z * 0.012; if (s.x < 0) s.x += 1; if (s.y > 1) s.y -= 1; }
          g.globalAlpha = 0.25 + s.z * 0.6; g.fillRect(s.x * W, s.y * H, s.z * 2, s.z * 2);
        }
        g.globalAlpha = 1;
        var padL = 26, padB = 26, top = 104, x0 = padL, y0 = H - padB, x1 = W - 54, y1 = top;
        if (st.phase === 'wait') { ship(g, x0 + 12, y0 - 14, -Math.PI / 2, 1.25, false); return; }
        // the flight path so far: time to the right, multiplier (log) upwards, both stretching as it goes
        var tMax = Math.max(8, t * 1.12), lMax = Math.max(Math.log(1.8), Math.log(Math.max(1, st.mult)) * 1.18);
        var X = function (tt) { return x0 + (x1 - x0) * tt / tMax; }, Y = function (m) { return y0 - (y0 - y1) * Math.log(Math.max(1, m)) / lMax; };
        g.font = '600 10.5px Outfit, system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
        for (k = 1; k <= 3; k++) {
          var mv = Math.exp(lMax * k / 3.3), gy = Y(mv);
          g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, gy); g.lineTo(W - 44, gy); g.stroke();
          g.fillStyle = 'rgba(190,184,214,0.5)'; g.fillText(mv.toFixed(2) + '×', W - 6, gy);
        }
        var n = 44, px = x0, py = y0;
        g.beginPath(); g.moveTo(x0, y0);
        for (k = 1; k <= n; k++) { var tt = t * k / n; px = X(tt); py = Y(st.path.multAt(tt)); g.lineTo(px, py); }
        var trail = g.createLinearGradient(x0, 0, px, 0); trail.addColorStop(0, 'rgba(255,120,60,0)'); trail.addColorStop(1, over ? 'rgba(255,90,70,.55)' : '#ffb02e');
        g.strokeStyle = trail; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.shadowColor = 'rgba(255,150,40,.8)'; g.shadowBlur = over ? 0 : 16; g.stroke(); g.shadowBlur = 0;
        g.lineTo(px, y0); g.closePath();
        var fill = g.createLinearGradient(0, y1, 0, y0); fill.addColorStop(0, 'rgba(255,150,40,.20)'); fill.addColorStop(1, 'rgba(255,150,40,0)');
        g.fillStyle = fill; g.fill();
        // cash-out tags
        g.textAlign = 'left'; g.font = '700 10px Outfit, system-ui, sans-serif';
        if (live) st.marks.forEach(function (mk) {
          var age = t - mk.t; if (age > 3.2) return;
          var a = 1 - smooth(2.4, 3.2, age), mx0 = X(mk.t), my = Y(mk.m), tw = g.measureText(mk.label).width + 14, mx = Math.max(6, Math.min(W - 50 - tw, mx0 - tw - 8));
          g.globalAlpha = a; g.fillStyle = 'rgba(26,18,10,0.92)'; g.beginPath(); g.rect(mx, my - 10, tw, 20); g.fill();
          g.strokeStyle = mk.me ? '#ffc531' : '#ffb02e'; g.lineWidth = 1.2; g.stroke();
          g.fillStyle = mk.me ? '#ffc531' : '#ffe0b0'; g.fillText(mk.label, mx + 7, my + 0.5); g.globalAlpha = 1;
        });
        if (live) {
          var back = Math.max(0, t - 0.25), ang = Math.atan2(Y(st.path.multAt(t)) - Y(st.path.multAt(back)), X(t) - X(back) || 1);
          ship(g, px, py, t < 0.3 ? -Math.PI / 2 + (ang + Math.PI / 2) * (t / 0.3) : ang, 1.25, true);
        } else if (over) {
          // it blows up where it was
          var e = st.rugT, a2 = Math.max(0, 1 - e / 1.1);
          g.globalAlpha = a2 * 0.9; g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(px, py, 14 + e * 150, 0, 6.2832); g.fill();
          g.globalAlpha = a2; g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(px, py, 8 + e * 70, 0, 6.2832); g.fill();
          sparks.forEach(function (p) {
            var sx = px + p.vx * e, sy = py + p.vy * e + 160 * e * e;
            g.globalAlpha = Math.max(0, 1 - e / 1.5); g.fillStyle = p.c; g.beginPath(); g.arc(sx, sy, p.r * Math.max(0.2, 1 - e / 1.6), 0, 6.2832); g.fill();
          });
          g.globalAlpha = 1;
        }
      }
    };
  }
});
