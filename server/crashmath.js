// The two crash games in numbers: how the multiplier climbs over time, and where a round ends.
// The server and the page use this same file (tools/build.mjs puts it into the page as it is), so both
// draw the same curve from the same seed. Where a round ends is rolled on the server and never sent early.
var CrashMath = (function () {
  // small seeded generator (mulberry32): the same seed gives the same numbers everywhere
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // u is uniform in 0..1. P(end >= x) = edge / x; anything below 1 ends at once, at 1.00.
  function crashPoint(u, edge, max) {
    var m = edge / (1 - u);
    return m < 1 ? 1 : Math.min(max, Math.floor(m * 100) / 100);
  }
  // Rugpull: a candle every 0.85 s, each with its own pace, so the chart climbs in fits and starts.
  var RUG = { key: 'rug', max: 500, edge: 0.97, RATE: 0.068, ACC: 0.004, CANDLE: 0.85 };
  RUG.path = function (seed) {
    var next = rng(seed), pace = [], wick = [], G = [0], C = RUG.CANDLE, R = RUG.RATE, A = RUG.ACC;
    function grow(k) {
      while (pace.length <= k) {
        var j = pace.length, t0 = j * C, t1 = t0 + C;
        var p = j === 0 ? 1 : 0.28 + 1.75 * Math.pow(next(), 1.7);
        pace.push(p); wick.push(next());
        G.push(G[j] + R * p * (C + A * (t1 * t1 - t0 * t0)));
      }
    }
    function gAt(t) {
      if (!(t > 0)) return 0;
      var k = Math.floor(t / C); grow(k);
      var t0 = k * C;
      return G[k] + R * pace[k] * ((t - t0) + A * (t * t - t0 * t0));
    }
    return {
      multAt: function (t) { return Math.exp(gAt(t)); },
      // seconds until the multiplier reaches m
      timeAt: function (m) {
        var target = Math.log(m);
        if (!(target > 0)) return 0;
        var k = 0; grow(0);
        while (G[k + 1] < target && k < 5000) { k++; grow(k); }
        var t0 = k * C, K = t0 + A * t0 * t0 + (target - G[k]) / (R * pace[k]);
        return (-1 + Math.sqrt(1 + 4 * A * K)) / (2 * A);
      },
      wick: function (k) { grow(k); return wick[k]; }
    };
  };
  // Rocket: one smooth curve that keeps getting steeper.
  var ROCKET = { key: 'rocket', max: 1000, edge: 0.97, A: 0.07, B: 0.003 };
  ROCKET.path = function () {
    var A = ROCKET.A, B = ROCKET.B;
    return {
      multAt: function (t) { return t > 0 ? Math.exp(A * t + B * t * t) : 1; },
      timeAt: function (m) { var L = Math.log(m); return L > 0 ? (-A + Math.sqrt(A * A + 4 * B * L)) / (2 * B) : 0; }
    };
  };
  return { rng: rng, crashPoint: crashPoint, games: { rug: RUG, rocket: ROCKET } };
})();
if (typeof module === 'object' && module && module.exports) module.exports = CrashMath;
