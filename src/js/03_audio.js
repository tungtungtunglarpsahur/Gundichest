// Tiny WebAudio synth: every sound is generated, nothing is downloaded ------------------------------
var Sfx = (function () {
  var ctx = null, master = null, noiseBuf = null, enabled = false;
  function ensure() {
    if (!enabled) return false;          // sound is off: no audio context at all, so music from another app keeps playing
    if (ctx) { if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} } return true; }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = enabled ? 0.55 : 0;
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ctx.destination);
      var len = ctx.sampleRate * 1.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { ctx = null; return false; }
  }
  function tone(freq, dur, opt) {
    if (!ctx || !enabled) return;
    opt = opt || {};
    var t = ctx.currentTime + (opt.when || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t + dur);
    var v = opt.vol === undefined ? 0.2 : opt.vol, a = opt.attack === undefined ? 0.005 : opt.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, opt) {
    if (!ctx || !enabled) return;
    opt = opt || {};
    var t = ctx.currentTime + (opt.when || 0);
    var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    var f = ctx.createBiquadFilter(); f.type = opt.filter || 'bandpass';
    f.frequency.setValueAtTime(opt.freq || 1200, t);
    if (opt.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, opt.to), t + dur);
    f.Q.value = opt.q === undefined ? 0.9 : opt.q;
    var g = ctx.createGain(), v = opt.vol === undefined ? 0.2 : opt.vol, a = opt.attack === undefined ? 0.004 : opt.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random()); s.stop(t + dur + 0.03);
  }
  function chord(freqs, dur, opt) {
    opt = opt || {};
    freqs.forEach(function (f, i) { tone(f, dur, { type: opt.type || 'triangle', vol: (opt.vol || 0.12), when: (opt.when || 0) + i * (opt.strum || 0), attack: opt.attack }); });
  }
  var N = function (semi) { return 261.63 * Math.pow(2, semi / 12); };       // semitones from middle C
  var api = {
    unlock: function () { ensure(); },
    setEnabled: function (on) {
      enabled = !!on;
      if (master) master.gain.value = enabled ? 0.55 : 0;
      if (ctx && !enabled && ctx.state === 'running') { try { ctx.suspend(); } catch (e) {} }
    },
    click: function () { ensure(); tone(660, 0.05, { type: 'triangle', vol: 0.08 }); noise(0.03, { freq: 3200, vol: 0.04 }); },
    tab: function () { ensure(); tone(520, 0.06, { type: 'sine', vol: 0.07, to: 760 }); },
    deny: function () { ensure(); tone(180, 0.14, { type: 'square', vol: 0.07, to: 120 }); },
    rattle: function (amt) {
      ensure(); amt = amt || 1;
      for (var i = 0; i < 5; i++) noise(0.05, { when: i * 0.055 + Math.random() * 0.02, freq: 1800 + Math.random() * 2600, q: 3, vol: 0.07 * amt });
      tone(92, 0.3, { type: 'sine', vol: 0.12 * amt, to: 70 });
    },
    chainBreak: function (power) {
      ensure(); power = power || 1;
      noise(0.22, { freq: 5200, to: 1400, q: 0.7, vol: 0.3 * power });
      [1870, 2710, 3530, 4410, 5290].forEach(function (f, i) { tone(f * (0.96 + Math.random() * 0.08), 0.35 + Math.random() * 0.25, { type: 'square', vol: 0.035 * power, when: i * 0.012 }); });
      tone(140, 0.22, { type: 'sine', vol: 0.22 * power, to: 55 });
    },
    tierUp: function (tier) {
      ensure();
      var base = [0, 4, 7, 12, 16][tier] || 0;
      tone(N(base + 12), 0.28, { type: 'triangle', vol: 0.16 });
      tone(N(base + 19), 0.34, { type: 'sine', vol: 0.1, when: 0.04 });
      noise(0.18, { freq: 2400 + tier * 900, q: 1.5, vol: 0.06 + tier * 0.02 });
      if (tier >= 3) tone(60, 0.5, { type: 'sine', vol: 0.3, to: 38 });
    },
    riser: function (dur, power) {
      ensure(); power = power || 1;
      tone(70, dur, { type: 'sawtooth', vol: 0.05 * power, to: 420, attack: dur * 0.6 });
      noise(dur, { freq: 300, to: 6000, q: 0.8, vol: 0.12 * power, attack: dur * 0.85 });
    },
    open: function (tier) {
      ensure();
      noise(0.5, { freq: 500, to: 5200, q: 0.6, vol: 0.2, attack: 0.02 });
      tone(120, 0.4, { type: 'sine', vol: 0.3, to: 46 });
      var chords = [[0, 7, 12], [0, 4, 7, 12], [0, 4, 7, 11, 14], [0, 3, 7, 10, 15, 19], [0, 4, 7, 12, 16, 19, 24]][tier];
      chord(chords.map(function (s) { return N(s + (tier >= 3 ? 0 : 5)); }), 0.9 + tier * 0.35, { vol: 0.08 + tier * 0.012, strum: 0.035, type: tier >= 3 ? 'sawtooth' : 'triangle' });
      if (tier >= 3) {
        for (var i = 0; i < 10 + tier * 4; i++) tone(N(24 + [0, 4, 7, 12, 16][i % 5]) * (1 + Math.random() * 0.01), 0.25, { vol: 0.035, when: 0.15 + i * 0.07, type: 'sine' });
        tone(48, 1.1, { type: 'sine', vol: 0.34, to: 30 });
      }
    },
    reveal: function (tier) {
      ensure();
      [0, 7, 12, 19].forEach(function (s, i) { tone(N(s + 12 + tier * 2), 0.22, { vol: 0.09, when: i * 0.05, type: 'triangle' }); });
    },
    coin: function (n) {
      ensure(); n = Math.min(n || 1, 6);
      for (var i = 0; i < n; i++) { tone(1568 + Math.random() * 180, 0.09, { vol: 0.09, when: i * 0.055, type: 'square' }); tone(2349 + Math.random() * 180, 0.16, { vol: 0.07, when: i * 0.055 + 0.03 }); }
    },
    win: function (big) {
      ensure();
      var seq = big ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12];
      seq.forEach(function (s, i) { tone(N(s + 12), 0.2, { vol: 0.11, when: i * 0.07, type: 'triangle' }); });
      if (big) { tone(55, 0.8, { type: 'sine', vol: 0.25, to: 36 }); noise(0.7, { freq: 6000, q: 0.5, vol: 0.05, when: 0.2 }); }
    },
    lose: function () { ensure(); tone(220, 0.3, { type: 'sawtooth', vol: 0.09, to: 82 }); noise(0.2, { freq: 400, vol: 0.1, to: 120 }); },
    rugged: function () {
      ensure();
      tone(520, 0.7, { type: 'sawtooth', vol: 0.16, to: 40 });
      noise(0.6, { freq: 2600, to: 90, q: 0.6, vol: 0.28 });
      tone(70, 0.6, { type: 'sine', vol: 0.3, to: 30 });
    },
    tick: function (pitch) { ensure(); tone(700 + (pitch || 0) * 40, 0.03, { vol: 0.03, type: 'square' }); },
    card: function () { ensure(); noise(0.07, { freq: 3800, to: 1500, q: 0.8, vol: 0.12 }); },
    // the whirr of a turning coin over dur seconds: quick at first, slower while it comes down, a clink where it lands
    flip: function (dur) {
      ensure(); dur = dur || 0.55;
      for (var t = 0, i = 0; t < dur * 0.8 && i < 60; i++) { noise(0.045, { when: t, freq: 2700 - 1300 * (t / dur), q: 2, vol: 0.065 }); t += 0.075 + 0.11 * Math.pow(t / dur, 1.5); }
      if (dur > 1) { tone(2100, 0.07, { type: 'triangle', vol: 0.09, when: dur * 0.84 }); noise(0.05, { when: dur * 0.84, freq: 4200, q: 3, vol: 0.09 }); tone(2400, 0.05, { type: 'triangle', vol: 0.05, when: dur * 0.985 }); }
    },
    gem: function (k) { ensure(); tone(N(12 + Math.min(k, 24)), 0.22, { vol: 0.13, type: 'triangle' }); tone(N(24 + Math.min(k, 24)), 0.3, { vol: 0.06, when: 0.03 }); },
    boom: function () { ensure(); noise(0.7, { freq: 900, to: 60, q: 0.5, vol: 0.4, filter: 'lowpass' }); tone(90, 0.6, { type: 'sine', vol: 0.4, to: 28 }); },
    hop: function (k) { ensure(); tone(420 + (k || 0) * 30, 0.09, { vol: 0.1, type: 'square', to: 760 + (k || 0) * 30 }); },
    squawk: function () { ensure(); tone(900, 0.18, { type: 'sawtooth', vol: 0.13, to: 300 }); noise(0.25, { freq: 700, to: 100, vol: 0.3, filter: 'lowpass' }); },
    whoosh: function () { ensure(); noise(0.3, { freq: 400, to: 3000, q: 0.7, vol: 0.12, attack: 0.1 }); }
  };
  return api;
})();
var haptic = function (ms) { try { if (Store.s.settings.haptics && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };
