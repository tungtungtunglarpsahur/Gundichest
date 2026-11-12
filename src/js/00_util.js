// Shared helpers ---------------------------------------------------------------------------------
var GC = window.__GC = { ready: false, debug: {} };
var $ = function (sel, root) { return (root || document).querySelector(sel); };
var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
var lerp = function (a, b, t) { return a + (b - a) * t; };
var sat = function (x) { return clamp(x, 0, 1); };
var smooth = function (a, b, x) { var t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
var ease = {
  outCubic: function (t) { t = sat(t); return 1 - Math.pow(1 - t, 3); },
  inCubic: function (t) { t = sat(t); return t * t * t; },
  inOut: function (t) { t = sat(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  outBack: function (t, s) { t = sat(t); s = s === undefined ? 1.70158 : s; var u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; },
  outElastic: function (t) { t = sat(t); if (t === 0 || t === 1) return t; return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
  outQuint: function (t) { t = sat(t); return 1 - Math.pow(1 - t, 5); }
};

// Crypto-backed random numbers (falls back to Math.random)
var rand = function () {
  try {
    var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296;
  } catch (e) { return Math.random(); }
};
var randInt = function (n) { return Math.floor(rand() * n); };
var randRange = function (a, b) { return a + (b - a) * Math.random(); };
var shuffle = function (arr) {
  for (var i = arr.length - 1; i > 0; i--) { var j = randInt(i + 1); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
};

var fmt = function (n) {
  n = Math.floor(n + 1e-9);
  return n.toLocaleString('en-US');
};
var fmtShort = function (n) {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
  return fmt(n);
};
var fmtMult = function (m) { return (m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2)) + '×'; };
var fmtPct = function (p) {
  var t = p >= 10 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toFixed(3);
  return t.replace(/\.?0+$/, '') + '%';
};
var el = function (tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var hexToRgb = function (hex) {
  var n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
var onTap = function (node, fn) {
  node.addEventListener('click', function (e) { fn(e); });
};
var reducedMotion = (function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
