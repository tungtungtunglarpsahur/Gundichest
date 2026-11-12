// Chicken Road: hop lane by lane, each lane multiplies the bet, a car ends the run. --------------------
Games.register({
  id: 'chicken', title: 'Chicken Road', icon: 'chicken',
  mount: function (pane) {
    var MODES = {
      easy: { name: 'Easy', p: 0.92, lanes: 20 },
      medium: { name: 'Medium', p: 0.85, lanes: 18 },
      hard: { name: 'Hard', p: 0.75, lanes: 15 },
      dare: { name: 'Daredevil', p: 0.60, lanes: 10 }
    };
    var EDGE = 0.98, mode = 'easy', st = { on: false, lane: 0, bet: 0, busy: false, dead: false };
    var BIRD = '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="30" cy="38" rx="19" ry="17" fill="#fff"/><circle cx="43" cy="22" r="12" fill="#fff"/><path d="M39 9c1-4 6-4 6 0 2-3 6-1 4 3 3-1 5 3 1 5H38z" fill="#ff4d61"/><path d="M54 21l8 3-8 4z" fill="#ffb21e"/><path d="M52 28c2 3 1 7-2 7z" fill="#ff4d61"/><circle cx="46" cy="20" r="2.300" fill="#17131f"/><path d="M18 34c5-4 14-3 16 4-5 5-13 4-16-4z" fill="#e6e2f0"/><path d="M24 54v6M34 54v6M21 60h7M31 60h7" stroke="#ffb21e" stroke-width="3" stroke-linecap="round" fill="none"/></svg>';
    pane.innerHTML = '<div class="ck-stage"><div class="ck-banner" id="ckBanner">Pick a difficulty and bet</div><div class="ck-road" id="ckRoad"></div></div>' +
      '<div class="two" id="ckActs"></div>' +
      '<div class="seg wide" id="ckModes"></div>' +
      '<div class="kv"><div class="stat"><div class="k">Lane</div><div class="v num" id="ckLane">0</div></div><div class="stat"><div class="k">Multiplier</div><div class="v num" id="ckMult">1.00×</div></div><div class="stat"><div class="k">Cash out</div><div class="v num" id="ckWin">0</div></div></div>' +
      '<div class="panel" id="ckBet"></div>' +
      '<div class="note" id="ckNote"></div>';
    var road = $('#ckRoad', pane), bet = Games.BetCtl('chicken', 20);
    $('#ckBet', pane).appendChild(bet.el);
    var bird = null;
    function mult(k) { var M = MODES[mode]; return k <= 0 ? 1 : Math.floor(EDGE / Math.pow(M.p, k) * 100) / 100; }
    function build() {
      var M = MODES[mode], html = '<div class="ck-lane start"></div>';
      for (var i = 1; i <= M.lanes; i++) html += '<div class="ck-lane" data-l="' + i + '"><div class="cap">' + fmtMult(mult(i)) + '</div></div>';
      html += '<div class="ck-lane end"></div>';
      road.innerHTML = html;
      bird = el('div', 'ck-bird', BIRD); road.appendChild(bird);
      place(false);
      $('#ckNote', pane).textContent = M.name + ': each lane is safe ' + Math.round(M.p * 100) + '% of the time, ' + M.lanes + ' lanes, top prize ' + fmtMult(mult(M.lanes)) + '.';
    }
    function laneX(k) { return k === 0 ? 0 : 84 + (k - 1) * 78 + 12; }
    function place(anim) {
      var x = st.lane === 0 ? 0 : laneX(st.lane) - 15 + 0;
      bird.style.transform = 'translateX(' + x + 'px)';
      var stageW = $('.ck-stage', pane).clientWidth || 340;
      var shift = Math.max(0, Math.min(laneX(st.lane) - stageW * 0.3, road.scrollWidth - stageW));
      road.style.transform = 'translateX(' + (-shift) + 'px)';
      $$('.ck-lane[data-l]', road).forEach(function (l) {
        var n = +l.dataset.l;
        l.classList.toggle('done', n <= st.lane && !(st.dead && n === st.lane));
        l.classList.toggle('next', st.on && !st.dead && n === st.lane + 1);
        l.classList.toggle('dead', st.dead && n === st.lane);
      });
    }
    function paint() {
      var acts = $('#ckActs', pane), M = MODES[mode];
      $('#ckLane', pane).textContent = st.lane + ' / ' + M.lanes;
      $('#ckMult', pane).textContent = fmtMult(mult(st.lane));
      $('#ckWin', pane).textContent = st.on && st.lane > 0 ? fmt(Math.floor(st.bet * mult(st.lane))) : '0';
      acts.innerHTML = '';
      if (!st.on) {
        acts.style.gridTemplateColumns = '1fr';
        var b = el('button', 'btn big green', 'Bet'); b.type = 'button'; onTap(b, start); acts.appendChild(b);
      } else {
        acts.style.gridTemplateColumns = '1fr 1fr';
        var go = el('button', 'btn big green', 'Go · ' + fmtMult(mult(st.lane + 1))); go.type = 'button'; onTap(go, hop);
        var co = el('button', 'btn big gold', 'Cash out'); co.type = 'button'; if (st.lane === 0) co.disabled = true; onTap(co, cash);
        acts.appendChild(go); acts.appendChild(co);
      }
      bet.lock(st.on);
      $$('#ckModes button', pane).forEach(function (x) { x.disabled = st.on; x.style.opacity = st.on ? 0.5 : 1; });
    }
    function car(lane, hit) {
      var l = $('.ck-lane[data-l="' + lane + '"]', road); if (!l) return;
      var c = el('div', 'ck-car ' + ['', 'b', 'y', 'w'][randInt(4)] + (hit ? ' hit' : ' go'));
      if (!hit) c.style.setProperty('--d', (0.7 + Math.random() * 0.6) + 's');
      l.appendChild(c);
      if (!hit) setTimeout(function () { c.remove(); }, 1500);
    }
    function ambient() {
      if (!pane.classList.contains('on')) return;
      var M = MODES[mode], lane = st.lane + 2 + randInt(4);
      if (lane <= M.lanes && !st.busy) car(lane, false);
    }
    function start() {
      Sfx.unlock();
      var took = bet.take(); if (!took) return;
      $$('.ck-car', road).forEach(function (c) { c.remove(); });
      st = { on: true, lane: 0, bet: took, busy: false, dead: false };
      bird.className = 'ck-bird'; $('#ckBanner', pane).innerHTML = 'Bet <b>' + fmt(took) + '</b> · tap Go';
      Sfx.coin(1); place(true); paint();
    }
    function hop() {
      if (!st.on || st.busy) return;
      var M = MODES[mode]; st.busy = true;
      var safe = rand() < M.p;
      st.lane += 1; bird.classList.remove('hop'); void bird.offsetWidth; bird.classList.add('hop');
      place(true); Sfx.hop(st.lane);
      if (!safe) {
        car(st.lane, true);
        setTimeout(function () {
          st.dead = true; st.on = false; st.busy = false; bird.classList.add('dead'); Sfx.squawk(); haptic([50, 30, 90]);
          $('#ckBanner', pane).innerHTML = 'Hit on lane ' + st.lane + ' · <b style="color:var(--loss)">-' + fmt(st.bet) + '</b>';
          UI.toast('The chicken got hit · -' + fmt(st.bet), 'loss');
          place(false); paint();
        }, 330);
        return;
      }
      setTimeout(function () {
        st.busy = false;
        $('#ckBanner', pane).innerHTML = 'Lane ' + st.lane + ' · <b>' + fmtMult(mult(st.lane)) + '</b>';
        if (st.lane >= M.lanes) { cash(true); return; }
        paint(); place(false);
      }, 300);
      paint();
    }
    function cash(all) {
      if (!st.on || st.lane === 0 || st.busy) return;
      var m = mult(st.lane), win = Math.floor(st.bet * m);
      st.on = false; Games.payout(win, m, fmtMult(m) + (all === true ? ' · full road' : ''));
      Sfx.win(m >= 5 || all === true); haptic(30); bird.classList.add('win');
      $('#ckBanner', pane).innerHTML = 'Cashed out at <b>' + fmtMult(m) + '</b> · +' + fmt(win);
      paint(); place(false);
    }
    var seg = $('#ckModes', pane);
    Object.keys(MODES).forEach(function (k) {
      var b = el('button', k === mode ? 'on' : '', MODES[k].name); b.type = 'button';
      onTap(b, function () { if (st.on) return; Sfx.click(); mode = k; $$('button', seg).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); st.lane = 0; st.dead = false; build(); paint(); });
      seg.appendChild(b);
    });
    build(); paint();
    setInterval(ambient, 900);
    GC.chicken = { get st() { return st; }, hop: hop, cash: cash, start: start, mult: mult, MODES: MODES };
    return { show: function () { place(false); } };
  }
});
