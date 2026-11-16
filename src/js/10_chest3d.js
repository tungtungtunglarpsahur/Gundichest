// 3D chest: loading, materials, effects and the opening timeline -----------------------------------
var Chest3D = (function () {
  var T = null;                       // THREE namespace once loaded
  var THREE_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
    'https://unpkg.com/three@0.160.0/build/three.min.js'
  ];
  function loadScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url; s.async = true; if (/^https?:/.test(url)) s.crossOrigin = 'anonymous';
      s.onload = function () { window.THREE ? res() : rej(new Error('no THREE')); };
      s.onerror = function () { s.remove(); rej(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }
  // Two builds share this file. The site build keeps model, textures and the 3D engine as separate files under
  // assets/ (cached by the browser, real download progress); the single-file build carries them inside the page.
  var BUILD = window.__GC_BUILD || { mode: 'single' };
  function assetUrl(name) { return (BUILD.assets || 'assets/') + name + (BUILD.v && BUILD.v[name] ? '?v=' + BUILD.v[name] : ''); }
  function inlined(id) { return document.getElementById(id); }
  function loadThree() {
    if (window.THREE) { T = window.THREE; return Promise.resolve(); }
    var warn = console.warn; console.warn = function () {};      // the UMD build prints a deprecation note
    var urls = (BUILD.mode === 'site' ? [assetUrl('three.min.js')] : []).concat(THREE_URLS), i = 0;
    function next() {
      if (i >= urls.length) return Promise.reject(new Error('3D engine could not be loaded'));
      return loadScript(urls[i++]).catch(next);
    }
    return next().then(function () { T = window.THREE; console.warn = warn; }, function (e) { console.warn = warn; throw e; });
  }
  function b64ToBytes(str) {
    var bin = atob(str), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function loadImage(name, file) {
    return new Promise(function (res, rej) {
      var node = inlined('asset-tex-' + name);
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('texture ' + name)); };
      if (node) { img.src = 'data:' + (node.getAttribute('data-mime') || 'image/jpeg') + ';base64,' + node.textContent.trim(); node.textContent = ''; }
      else img.src = assetUrl(file);
    });
  }
  // Downloads a binary file and reports how much has arrived (0..1) when the server says how big it is.
  function fetchBytes(url, onPart) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('download failed: ' + url);
      var total = +r.headers.get('content-length') || 0;
      if (!r.body || !r.body.getReader || !total) return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      var reader = r.body.getReader(), parts = [], got = 0;
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) { var out = new Uint8Array(got), o = 0; parts.forEach(function (c) { out.set(c, o); o += c.length; }); return out; }
          parts.push(x.value); got += x.value.length; if (onPart) onPart(Math.min(1, got / total));
          return pump();
        });
      }
      return pump();
    });
  }
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  // ---------------------------------------------------------------------------------------------
  var C = {
    canvas: null, renderer: null, scene: null, camera: null,
    quality: 'high', Q: null, time: 0, running: false, visible: true,
    state: 'idle',                 // idle | opening | open | closing
    anim: null, userYaw: 0, userPitch: 0, yawVel: 0, dragging: false, lastInput: -10,
    hooks: {}                     // onFlash(color, strength), onShake(amount), onTier(tier), onPhase(name)
  };
  var QUALITY = {
    low: { dpr: 1.0, particles: 0.35, bloom: false, rays: 8, coins: 18, aniso: 1 },
    mid: { dpr: 1.5, particles: 0.7, bloom: false, rays: 14, coins: 36, aniso: 4 },
    high: { dpr: 2.0, particles: 1.0, bloom: true, rays: 20, coins: 60, aniso: 8 }
  };
  var TIER_COLORS = ['#a3acb8', '#45d86b', '#3d9dff', '#b65cff', '#ffc531'];
  var HOT = ['#dfe6ee', '#c9ffd6', '#cfe6ff', '#ecd2ff', '#fff1c2'];

  function makeGeometry(p, bin, opt) {
    var g = new T.BufferGeometry();
    var q = new Uint16Array(bin.buffer, p.pos[0], p.pos[1]);
    var pos = new Float32Array(q.length), lo = p.lo, sz = p.size;
    for (var i = 0; i < q.length; i += 3) {
      pos[i] = lo[0] + q[i] / 65535 * sz[0]; pos[i + 1] = lo[1] + q[i + 1] / 65535 * sz[1]; pos[i + 2] = lo[2] + q[i + 2] / 65535 * sz[2];
    }
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    if (p.uv) {
      var uq = new Uint16Array(bin.buffer, p.uv[0], p.uv[1]);
      var uv = new Float32Array(uq.length);
      for (var j = 0; j < uq.length; j++) uv[j] = uq[j] / 65535;
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    }
    if (p.nrm) {
      var nq = new Int8Array(bin.buffer, p.nrm[0], p.nrm[1]);
      var nr = new Float32Array(nq.length / 4 * 3);
      for (var k = 0, m = 0; k < nq.length; k += 4, m += 3) { nr[m] = nq[k] / 127; nr[m + 1] = nq[k + 1] / 127; nr[m + 2] = nq[k + 2] / 127; }
      g.setAttribute('normal', new T.BufferAttribute(nr, 3));
    }
    var idx = p.idx32 ? new Uint32Array(bin.buffer, p.idx[0], p.idx[1]) : new Uint16Array(bin.buffer, p.idx[0], p.idx[1]);
    g.setIndex(new T.BufferAttribute(idx.slice(), 1));
    if (!p.nrm) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  function subGeometry(full, start, count, center) {
    var idx = full.index.array, pos = full.attributes.position.array, nrm = full.attributes.normal.array;
    var map = new Map(), P = [], N = [], I = new Uint16Array(count);
    for (var i = 0; i < count; i++) {
      var v = idx[start + i], nv = map.get(v);
      if (nv === undefined) {
        nv = P.length / 3; map.set(v, nv);
        P.push(pos[v * 3] - center[0], pos[v * 3 + 1] - center[1], pos[v * 3 + 2] - center[2]);
        N.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      }
      I[i] = nv;
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(N), 3));
    g.setIndex(new T.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    return g;
  }
  function tex(img, srgb, aniso) {
    var t = new T.Texture(img);
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    t.anisotropy = aniso || 1; t.generateMipmaps = true;
    t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter;
    t.needsUpdate = true;
    return t;
  }
  function radialTexture(size, stops) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  // Studio environment rendered once into a PMREM cube: soft boxes on a dim gradient dome.
  function buildEnvironment(renderer) {
    var s = new T.Scene();
    var dome = new T.Mesh(new T.SphereGeometry(40, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.50,0.52,0.60); vec3 mid = vec3(0.16,0.15,0.17); vec3 bot = vec3(0.035,0.03,0.03);' +
        ' vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.7)) : mix(mid, bot, pow(-h, 0.45)); gl_FragColor = vec4(c, 1.0); }'
    }));
    s.add(dome);
    function box(w, h, pos, col, k) {
      var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(col[0] * k, col[1] * k, col[2] * k), side: T.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0.6, 0); s.add(m);
    }
    box(9, 6, [-7, 9, 8], [1.0, 0.96, 0.9], 9);           // key, front-left above
    box(12, 2.2, [0, 13, 1], [1.0, 1.0, 1.0], 7);         // overhead strip
    box(5, 8, [11, 4, -5], [0.75, 0.86, 1.0], 6);         // cool rim, back-right
    box(6, 5, [9, 2.5, 8], [1.0, 0.86, 0.7], 2.2);        // warm fill, front-right
    box(7, 4, [-11, 3, -6], [1.0, 0.8, 0.6], 2.6);        // warm kicker, back-left
    box(18, 3, [0, -1.5, 12], [1.0, 0.9, 0.8], 0.55);     // low front bounce
    var pm = new T.PMREMGenerator(renderer);
    var rt = pm.fromScene(s, 0.035);
    pm.dispose();
    s.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return rt.texture;
  }

  // ---- particles (GPU ballistic) ------------------------------------------------------------------
  function Particles(max) {
    this.max = max; this.head = 0;
    var g = new T.BufferGeometry();
    this.aPos = new T.BufferAttribute(new Float32Array(max * 3), 3);
    this.aVel = new T.BufferAttribute(new Float32Array(max * 3), 3);
    this.aTime = new T.BufferAttribute(new Float32Array(max * 2), 2);        // birth, life
    this.aCol = new T.BufferAttribute(new Float32Array(max * 3), 3);
    this.aPar = new T.BufferAttribute(new Float32Array(max * 4), 4);        // size, gravity, drag, seed
    for (var i = 0; i < max; i++) this.aTime.array[i * 2] = -1e6;
    g.setAttribute('position', this.aPos); g.setAttribute('aVel', this.aVel); g.setAttribute('aTime', this.aTime);
    g.setAttribute('aCol', this.aCol); g.setAttribute('aPar', this.aPar);
    g.boundingSphere = new T.Sphere(new T.Vector3(0, 2, 0), 60);
    this.mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
      vertexShader: [
        'attribute vec3 aVel; attribute vec2 aTime; attribute vec3 aCol; attribute vec4 aPar;',
        'uniform float uTime; uniform float uScale; varying vec4 vCol;',
        'void main(){',
        '  float age = uTime - aTime.x; float life = aTime.y; float k = age / life;',
        '  if (age < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }',
        '  float d = max(aPar.z, 0.001);',
        '  vec3 p = position + aVel * (1.0 - exp(-d * age)) / d;',
        '  p.y -= 0.5 * aPar.y * age * age;',
        '  float tw = 0.7 + 0.3 * sin(aPar.w * 40.0 + uTime * (9.0 + aPar.w * 14.0));',
        '  float fade = smoothstep(0.0, 0.07, k) * (1.0 - smoothstep(0.55, 1.0, k));',
        '  vCol = vec4(aCol * tw, fade);',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  gl_PointSize = aPar.x * uScale * (1.0 - 0.45 * k) / max(0.1, -mv.z);',
        '}'].join('\n'),
      fragmentShader: [
        'varying vec4 vCol;',
        'void main(){',
        '  vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);',
        '  if (r2 > 1.0) discard;',
        '  float core = exp(-r2 * 9.0); float halo = exp(-r2 * 2.6) * 0.45;',
        '  float a = (core + halo) * vCol.a;',
        '  gl_FragColor = vec4(vCol.rgb * a + vec3(core * vCol.a * 0.55), a);',
        '}'].join('\n')
    });
    this.points = new T.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }
  Particles.prototype.emit = function (n, time, fn) {
    var o = { p: [0, 0, 0], v: [0, 0, 0], life: 1, size: 0.1, c: [1, 1, 1], g: 0, drag: 1 };
    for (var i = 0; i < n; i++) {
      fn(o, i);
      var h = this.head; this.head = (h + 1) % this.max;
      this.aPos.array.set(o.p, h * 3); this.aVel.array.set(o.v, h * 3);
      this.aTime.array[h * 2] = time + (o.delay || 0); this.aTime.array[h * 2 + 1] = o.life;
      this.aCol.array.set(o.c, h * 3);
      this.aPar.array[h * 4] = o.size; this.aPar.array[h * 4 + 1] = o.g; this.aPar.array[h * 4 + 2] = o.drag; this.aPar.array[h * 4 + 3] = Math.random();
      o.delay = 0;
    }
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aTime.needsUpdate = this.aCol.needsUpdate = this.aPar.needsUpdate = true;
  };
  Particles.prototype.clear = function () {
    for (var i = 0; i < this.max; i++) this.aTime.array[i * 2] = -1e6;
    this.aTime.needsUpdate = true;
  };

  // ---- bloom (dual-filter down/up sampling), used on High ----------------------------------------
  function Bloom(renderer) {
    this.renderer = renderer; this.levels = 5; this.rts = []; this.strength = 0.34;
    var tri = new T.BufferGeometry();
    tri.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new T.Mesh(tri, null); this.quad.frustumCulled = false;
    this.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.sceneQ = new T.Scene(); this.sceneQ.add(this.quad);
    var vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.mPre = new T.ShaderMaterial({ uniforms: { tMap: { value: null }, uThr: { value: 1.45 } }, vertexShader: vs, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tMap; uniform float uThr; varying vec2 vUv; void main(){ vec3 c = texture2D(tMap, vUv).rgb; float l = max(c.r, max(c.g, c.b)); float k = max(l - uThr, 0.0) / max(l, 1e-4); gl_FragColor = vec4(min(c * k, vec3(24.0)), 1.0); }' });
    this.mDown = new T.ShaderMaterial({ uniforms: { tMap: { value: null }, uTexel: { value: new T.Vector2() } }, vertexShader: vs, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv; void main(){ vec3 c = texture2D(tMap, vUv).rgb * 4.0;' +
        ' c += texture2D(tMap, vUv + uTexel).rgb; c += texture2D(tMap, vUv - uTexel).rgb; c += texture2D(tMap, vUv + vec2(uTexel.x, -uTexel.y)).rgb; c += texture2D(tMap, vUv + vec2(-uTexel.x, uTexel.y)).rgb; gl_FragColor = vec4(c / 8.0, 1.0); }' });
    this.mUp = new T.ShaderMaterial({ uniforms: { tMap: { value: null }, uTexel: { value: new T.Vector2() } }, vertexShader: vs, depthTest: false, depthWrite: false,
      blending: T.AdditiveBlending, transparent: true,
      fragmentShader: 'uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv; void main(){ vec3 c = texture2D(tMap, vUv + vec2(-uTexel.x * 2.0, 0.0)).rgb + texture2D(tMap, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb + texture2D(tMap, vUv + vec2(0.0, uTexel.y * 2.0)).rgb + texture2D(tMap, vUv + vec2(0.0, -uTexel.y * 2.0)).rgb;' +
        ' c += 2.0 * (texture2D(tMap, vUv + uTexel).rgb + texture2D(tMap, vUv - uTexel).rgb + texture2D(tMap, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tMap, vUv + vec2(-uTexel.x, uTexel.y)).rgb); gl_FragColor = vec4(c / 12.0, 1.0); }' });
    this.mFinal = new T.ShaderMaterial({ uniforms: { tScene: { value: null }, tBloom: { value: null }, uStrength: { value: 0.9 } }, vertexShader: vs, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uStrength; varying vec2 vUv;\n#include <common>\nvoid main(){ vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uStrength; gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' });
  }
  Bloom.prototype.setSize = function (w, h) {
    this.dispose();
    var type = T.HalfFloatType;
    this.main = new T.WebGLRenderTarget(w, h, { type: type, samples: 4, depthBuffer: true });
    this.rts = [];
    var cw = Math.max(2, w >> 1), ch = Math.max(2, h >> 1);
    for (var i = 0; i < this.levels; i++) {
      this.rts.push(new T.WebGLRenderTarget(cw, ch, { type: type, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter }));
      cw = Math.max(2, cw >> 1); ch = Math.max(2, ch >> 1);
    }
  };
  Bloom.prototype.dispose = function () {
    if (this.main) this.main.dispose();
    this.rts.forEach(function (r) { r.dispose(); }); this.rts = []; this.main = null;
  };
  Bloom.prototype.pass = function (mat, target) {
    this.quad.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(this.sceneQ, this.cam);
  };
  Bloom.prototype.render = function (scene, camera) {
    var r = this.renderer, i;
    r.setRenderTarget(this.main); r.clear(); r.render(scene, camera);
    this.mPre.uniforms.tMap.value = this.main.texture; this.pass(this.mPre, this.rts[0]);
    for (i = 1; i < this.levels; i++) {
      this.mDown.uniforms.tMap.value = this.rts[i - 1].texture;
      this.mDown.uniforms.uTexel.value.set(1 / this.rts[i - 1].width, 1 / this.rts[i - 1].height);
      this.pass(this.mDown, this.rts[i]);
    }
    r.autoClear = false;
    for (i = this.levels - 1; i > 0; i--) {
      this.mUp.uniforms.tMap.value = this.rts[i].texture;
      this.mUp.uniforms.uTexel.value.set(1 / this.rts[i].width, 1 / this.rts[i].height);
      this.pass(this.mUp, this.rts[i - 1]);
    }
    r.autoClear = true;
    this.mFinal.uniforms.tScene.value = this.main.texture; this.mFinal.uniforms.tBloom.value = this.rts[0].texture;
    this.mFinal.uniforms.uStrength.value = this.strength;
    this.pass(this.mFinal, null);
  };

  // ---------------------------------------------------------------------------------------------
  C.load = function (onProgress) {
    var manifest, bin, imgs = {};
    onProgress(0.04, 'engine');
    return loadThree().then(function () {
      onProgress(0.22, 'model'); return tick();
    }).then(function () {
      var node = inlined('asset-model');
      if (node) {
        manifest = JSON.parse(inlined('asset-manifest').textContent);
        bin = b64ToBytes(node.textContent.trim()); node.textContent = '';
        return null;
      }
      return fetch(assetUrl('model.json')).then(function (r) { if (!r.ok) throw new Error('model'); return r.json(); }).then(function (m) {
        manifest = m;
        return fetchBytes(assetUrl('model.bin'), function (k) { onProgress(0.22 + 0.18 * k, 'model'); });
      }).then(function (bytes) { bin = bytes; });
    }).then(function () {
      onProgress(0.4, 'textures'); return tick();
    }).then(function () {
      var files = { albedo: 'albedo.webp', normal: 'normal.jpg', mat: 'mat.jpg', ao: 'ao.jpg' }, names = Object.keys(files), done = 0;
      return Promise.all(names.map(function (n) {
        return loadImage(n, files[n]).then(function (img) { imgs[n] = img; done++; onProgress(0.4 + 0.3 * done / names.length, 'textures'); });
      }));
    }).then(function () {
      C.assets = { manifest: manifest, bin: bin, imgs: imgs };
      onProgress(0.72, 'scene'); return tick();
    });
  };

  C.init = function (canvas, quality, onProgress) {
    var A = C.assets, M = A.manifest;
    C.canvas = canvas; C.quality = quality; C.Q = QUALITY[quality];
    var renderer = C.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    var scene = C.scene = new T.Scene();
    var camera = C.camera = new T.PerspectiveCamera(BASE_FOV, 1, 0.5, 80);
    scene.environment = buildEnvironment(renderer);
    // a phone may drop the graphics context while the page sits in the background: rebuild what lived only on the GPU
    canvas.addEventListener('webglcontextrestored', function () {
      setTimeout(function () {
        try { scene.environment = buildEnvironment(renderer); if (C.bloomOK) C.bloomOK = null; C.resize(); C.renderFrame(); } catch (e) { /* the next frame retries */ }
      }, 60);
    });
    onProgress(0.8, 'scene');

    var maxAniso = renderer.capabilities.getMaxAnisotropy();
    var tAlb = tex(A.imgs.albedo, true, Math.min(maxAniso, 8)), tNrm = tex(A.imgs.normal, false, Math.min(maxAniso, 4));
    var tMat = tex(A.imgs.mat, false, 2), tAo = tex(A.imgs.ao, false, 2);
    C.textures = [tAlb, tNrm, tMat, tAo];
    var U = C.U = {
      uAoTex: { value: tAo }, uChain: { value: 1 }, uOpen: { value: 0 },
      uGlow: { value: 0.55 }, uGlowMix: { value: 0 }, uGlowColor: { value: new T.Color('#ffffff') },
      uSeam: { value: 0 }, uSeamY: { value: M.seamY }, uInner: { value: 0 }
    };
    var body = C.bodyMat = new T.MeshStandardMaterial({
      map: tAlb, normalMap: tNrm, normalMapType: T.ObjectSpaceNormalMap, roughnessMap: tMat, metalnessMap: tMat,
      roughness: 1, metalness: 1, envMapIntensity: 0.9
    });
    body.onBeforeCompile = function (sh) {
      for (var k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nuniform sampler2D uAoTex; uniform float uChain; uniform float uOpen; uniform float uGlow; uniform float uGlowMix; uniform vec3 uGlowColor; uniform float uSeam; uniform float uSeamY; uniform float uInner;')
        .replace('#include <emissivemap_fragment>', [
          '#include <emissivemap_fragment>',
          'vec3 gcMat = texture2D( roughnessMap, vRoughnessMapUv ).rgb;',
          'vec3 gcAo3 = texture2D( uAoTex, vMapUv ).rgb;',
          'float gcLum = dot( diffuseColor.rgb, vec3( 0.3, 0.5, 0.2 ) );',
          'vec3 gcGem = mix( diffuseColor.rgb, uGlowColor * ( 0.3 + 0.9 * gcLum ), uGlowMix );',
          'totalEmissiveRadiance += gcGem * gcMat.r * uGlow;',
          'float gcBand = exp( - pow( ( vObjPos.y - uSeamY + 0.06 ) / 0.13, 2.0 ) );',
          'totalEmissiveRadiance += uGlowColor * uSeam * gcBand * mix( 0.25, 1.6, 1.0 - gcAo3.g ) * ( 1.0 - uOpen * 0.7 );'
        ].join('\n'))
        .replace('#include <aomap_fragment>', [
          'float ambientOcclusion = pow( mix( mix( gcAo3.g, gcAo3.r, uChain ), gcAo3.b, uOpen ), 1.35 );',
          'reflectedLight.indirectDiffuse *= ambientOcclusion;',
          'reflectedLight.directDiffuse *= mix( 1.0, ambientOcclusion, 0.75 );',
          'reflectedLight.directSpecular *= mix( 1.0, ambientOcclusion, 0.6 );',
          '#if defined( USE_ENVMAP ) && defined( STANDARD )',
          '  float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );',
          '  reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );',
          '#endif'
        ].join('\n'));
    };
    body.customProgramCacheKey = function () { return 'gc-body'; };

    var root = C.root = new T.Group(); scene.add(root);
    var yawG = C.yawG = new T.Group(); root.add(yawG);
    var gBase = makeGeometry(M.parts.base, A.bin), gLid = makeGeometry(M.parts.lid, A.bin);
    C.base = new T.Mesh(gBase, body); yawG.add(C.base);
    var hinge = C.hinge = new T.Vector3(M.hinge[0], M.hinge[1], M.hinge[2]);
    C.lidPivot = new T.Group(); C.lidPivot.position.copy(hinge); yawG.add(C.lidPivot);
    C.lid = new T.Mesh(gLid, body); C.lid.position.copy(hinge).multiplyScalar(-1); C.lidPivot.add(C.lid);

    var gold = C.goldMat = new T.MeshStandardMaterial({ color: new T.Color('#f6bc4c'), metalness: 1, roughness: 0.3, envMapIntensity: 1.05 });
    var gChain = makeGeometry(M.parts.chain, A.bin);
    C.chain = new T.Mesh(gChain, gold); yawG.add(C.chain);
    var gFr = makeGeometry(M.parts.frags, A.bin);
    C.fragG = new T.Group(); C.fragG.visible = false; yawG.add(C.fragG);
    C.frags = M.frags.map(function (f) {
      var m = new T.Mesh(subGeometry(gFr, f.start, f.count, f.center), gold);
      m.position.set(f.center[0], f.center[1], f.center[2]);
      m.userData = { home: new T.Vector3(f.center[0], f.center[1], f.center[2]), v: new T.Vector3(), w: new T.Vector3(), strand: f.strand };
      C.fragG.add(m); return m;
    });
    gFr.dispose();
    onProgress(0.86, 'scene');

    // lights
    var key = new T.DirectionalLight(0xfff1dc, 2.9); key.position.set(-4.5, 7.5, 6.0); scene.add(key);
    var rim = new T.DirectionalLight(0xbfd6ff, 1.3); rim.position.set(6, 4, -7); scene.add(rim);
    C.innerLight = new T.PointLight(0xffffff, 0, 9, 1.6); C.innerLight.position.set(0, 0.55, 0); yawG.add(C.innerLight);
    C.frontLight = new T.PointLight(0xffffff, 0, 10, 1.8); C.frontLight.position.set(0, 1.1, 3.2); yawG.add(C.frontLight);

    // glow helpers
    var glowTex = C.glowTex = radialTexture(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
    var addMat = function (o) { return new T.MeshBasicMaterial(Object.assign({ map: glowTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: true }, o || {})); };
    C.halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0 }));
    C.halo.scale.set(7.5, 7.5, 1); C.halo.position.set(0, 1.0, -1.6); root.add(C.halo);
    C.gemGlows = M.gems.map(function (g) {
      var s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0, depthTest: true }));
      var p = new T.Vector3(g.pos[0], g.pos[1], g.pos[2]).addScaledVector(new T.Vector3(g.axis[0], g.axis[1], g.axis[2]), 0.06);
      var sc = g.r * (g.kind === 'blue' ? 2.4 : 4.2); s.scale.set(sc, sc, 1);
      if (g.part === 'lid') { s.position.copy(p).sub(hinge); C.lidPivot.add(s); } else { s.position.copy(p); yawG.add(s); }
      s.userData = { kind: g.kind, base: new T.Color({ purple: '#dc4fe0', orange: '#ff8a2a', blue: '#6f93e6' }[g.kind]) };
      return s;
    });
    // A hidden trick: turn the chest round and tap the purple gem at the top left of its back. Tapped twice, the
    // next chest holds an epic; tapped four times, a legendary. Nothing lights up while tapping. See C.takeSecret.
    C.secretGem = -1; C.secretTaps = 0;
    M.gems.forEach(function (g, i) {              // seen from behind, the upper gem with the larger x is the one on the left
      if (g.kind === 'purple' && g.part === 'lid' && g.pos[2] < 0 && (C.secretGem < 0 || g.pos[0] > M.gems[C.secretGem].pos[0])) C.secretGem = i;
    });
    var cav = M.cavity, cw = Math.abs(cav.max[0] - cav.min[0]), cd = Math.abs(cav.max[2] - cav.min[2]);
    C.inner = new T.Mesh(new T.PlaneGeometry(cw * 1.02, cd * 1.02), addMat({ side: T.DoubleSide }));
    C.inner.rotation.x = -Math.PI / 2; C.inner.position.set(0, M.seamY - 0.16, (cav.min[2] + cav.max[2]) / 2); yawG.add(C.inner);
    C.flare = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0 }));
    C.flare.position.set(0, M.seamY, 1.25); yawG.add(C.flare);
    C.floor = new T.Mesh(new T.PlaneGeometry(9, 9), addMat({}));
    C.floor.rotation.x = -Math.PI / 2; C.floor.position.set(0, -0.02, 0); root.add(C.floor);

    // beam (two nested open cylinders, soft edges via view angle)
    var beamMat = function () {
      return new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uColor: { value: new T.Color('#ffffff') }, uOpacity: { value: 0 }, uTime: { value: 0 }, uSoft: { value: 1.6 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uSoft; varying vec3 vN; varying vec3 vV; varying vec2 vUv;' +
          ' void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), uSoft); float h = pow(1.0 - vUv.y, 1.7); float st = 0.72 + 0.28 * sin(vUv.x * 50.0 + uTime * 2.0) * sin(vUv.x * 23.0 - uTime * 1.3 + vUv.y * 4.0);' +
          ' float a = edge * h * st * uOpacity; gl_FragColor = vec4(uColor * a, a); }'
      });
    };
    var mkBeam = function (r0, r1, h) {
      var g = new T.CylinderGeometry(r1, r0, h, 40, 1, true); g.translate(0, h / 2, 0);
      var m = new T.Mesh(g, beamMat()); m.position.set(0, M.seamY - 0.2, (cav.min[2] + cav.max[2]) / 2); m.visible = false; m.renderOrder = 10; yawG.add(m); return m;
    };
    C.beamOuter = mkBeam(0.78, 1.5, 9); C.beamCore = mkBeam(0.34, 0.5, 11);

    // god rays: thin triangles fanning out of the chest
    (function () {
      var n = 22, pos = [], col = [];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, tilt = 0.25 + Math.random() * 0.75, len = 4.5 + Math.random() * 4.5, w = 0.1 + Math.random() * 0.22;
        var dx = Math.cos(a) * tilt, dz = Math.sin(a) * tilt, dy = 1.0, l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        var px = -dz, pz = dx, pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
        pos.push(0, 0, 0, dx * len + px * w * len * 0.5, dy * len, dz * len + pz * w * len * 0.5, dx * len - px * w * len * 0.5, dy * len, dz * len - pz * w * len * 0.5);
        var b = 0.5 + Math.random() * 0.5; col.push(b, b, b, 0, 0, 0, 0, 0, 0);
      }
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('color', new T.BufferAttribute(new Float32Array(col), 3));
      C.raysN = n;
      C.rays = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, opacity: 0 }));
      C.rays.position.set(0, M.seamY - 0.25, (cav.min[2] + cav.max[2]) / 2); C.rays.visible = false; C.rays.renderOrder = 9; yawG.add(C.rays);
    })();

    // shock rings
    C.rings = [0, 1, 2].map(function () {
      var m = new T.Mesh(new T.RingGeometry(0.82, 1, 64), new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uColor: { value: new T.Color('#ffffff') }, uOpacity: { value: 0 } },
        vertexShader: 'varying float vR; void main(){ vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vR; void main(){ float k = clamp((vR - 0.82) / 0.18, 0.0, 1.0); float a = pow(smoothstep(0.0, 0.9, k), 2.6) * smoothstep(1.0, 0.9, k) * uOpacity; gl_FragColor = vec4(uColor * a, a); }'
      }));
      m.rotation.x = -Math.PI / 2; m.position.set(0, M.seamY, 0); m.visible = false; m.userData = { t0: -9, dur: 1, max: 6 }; root.add(m); return m;
    });

    // coins (legendary fountain)
    (function () {
      var g = new T.CylinderGeometry(0.105, 0.105, 0.028, 16);
      C.coinMax = 60;
      C.coins = new T.InstancedMesh(g, new T.MeshStandardMaterial({ color: new T.Color('#ffc94f'), metalness: 1, roughness: 0.22, envMapIntensity: 1.25 }), C.coinMax);
      C.coins.count = 0; C.coins.frustumCulled = false; root.add(C.coins);
      C.coinData = [];
    })();

    C.parts = new Particles(1600);
    root.add(C.parts.points);
    C.bloom = new Bloom(renderer);
    if (!renderer.capabilities.isWebGL2 || !(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))) C.bloomOK = false;
    C.M = M;
    onProgress(0.9, 'scene');

    // pointer: dragging turns the chest, a short touch that does not move is a tap
    var px = 0, py = 0, travel = 0, downAt = 0;
    canvas.addEventListener('pointerdown', function (e) { C.dragging = true; px = e.clientX; py = e.clientY; travel = 0; downAt = performance.now(); C.yawVel = 0; try { canvas.setPointerCapture(e.pointerId); } catch (er) {} });
    canvas.addEventListener('pointermove', function (e) {
      if (!C.dragging) return;
      var dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      travel += Math.abs(dx) + Math.abs(dy);
      C.userYaw += dx * 0.009; C.yawVel = dx * 0.009 * 60;
      C.userPitch = clamp(C.userPitch + dy * 0.004, -0.22, 0.42);
      C.lastInput = C.time;
    });
    var up = function (e) {
      var tapped = C.dragging && e.type === 'pointerup' && travel < 12 && performance.now() - downAt < 500;
      C.dragging = false; C.lastInput = C.time;
      if (tapped) { C.yawVel = 0; C.tap(e.clientX, e.clientY); }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

    // Which gem lies under a point of the screen (-1 for none). Only gems that face the viewer count, so a gem on
    // the far side cannot be hit through the chest.
    var gv = new T.Vector3(), gn = new T.Vector3(), ge = new T.Vector3(), gq = new T.Quaternion();
    C.gemAt = function (cx, cy) {
      var rect = canvas.getBoundingClientRect(), best = -1, bestD = 1e9;
      C.root.updateMatrixWorld(true); C.camera.updateMatrixWorld(true);
      for (var i = 0; i < M.gems.length; i++) {
        var g = M.gems[i], s = C.gemGlows[i];
        s.getWorldPosition(gv);
        s.parent.getWorldQuaternion(gq);
        gn.set(g.axis[0], g.axis[1], g.axis[2]).applyQuaternion(gq);
        if (gn.dot(ge.copy(C.camera.position).sub(gv).normalize()) < 0.3) continue;
        // its size on screen: the centre and a point one radius to the side, both projected
        ge.set(1, 0, 0).applyQuaternion(C.camera.quaternion).multiplyScalar(g.r).add(gv).project(C.camera);
        gv.project(C.camera);
        var sx = rect.left + (gv.x * 0.5 + 0.5) * rect.width, sy = rect.top + (0.5 - gv.y * 0.5) * rect.height;
        var rpx = Math.abs(ge.x - gv.x) * 0.5 * rect.width, d = Math.hypot(cx - sx, cy - sy);
        if (d < Math.max(24, rpx * 1.6) && d < bestD) { best = i; bestD = d; }
      }
      return best;
    };
    C.tap = function (cx, cy) {
      if (true || C.state !== 'idle' || C.secretGem < 0 || C.gemAt(cx, cy) !== C.secretGem) return;
      C.secretTaps++;
      if (C.hooks.onGem) C.hooks.onGem(C.secretTaps, C.secret());
    };
    // What the taps so far are worth: 'legendary' (four or more), 'epic' (two or three) or null.
    C.secret = function () { return C.secretTaps >= 4 ? 'legendary' : C.secretTaps >= 2 ? 'epic' : null; };
    // Called when a chest is opened: returns what the taps are worth and starts counting from nothing again.
    C.takeSecret = function () { var s = C.secret(); C.secretTaps = 0; return s; };

    C.setQuality(quality);
    C.resize();
    C.applyPose(0);
    // warm up: upload textures and compile programs while the loader is still up
    C.textures.forEach(function (t) { renderer.initTexture(t); });
    C.fragG.visible = true; C.beamOuter.visible = C.beamCore.visible = C.rays.visible = true; C.coins.count = 1;
    renderer.compile(scene, camera);
    C.renderFrame();
    C.fragG.visible = false; C.beamOuter.visible = C.beamCore.visible = C.rays.visible = false; C.coins.count = 0;
    onProgress(0.97, 'scene');
  };

  C.setQuality = function (q) {
    C.quality = q; C.Q = QUALITY[q];
    if (!C.renderer) return;
    C.textures[0].anisotropy = Math.min(C.renderer.capabilities.getMaxAnisotropy(), C.Q.aniso); C.textures[0].needsUpdate = true;
    C.rays.geometry.setDrawRange(0, Math.min(C.raysN, C.Q.rays) * 3);
    C.resize();
  };
  C.resize = function () {
    if (!C.renderer) return;
    var w = C.canvas.clientWidth || 300, h = C.canvas.clientHeight || 300;
    var dpr = Math.min(window.devicePixelRatio || 1, C.Q.dpr);
    C.renderer.setPixelRatio(dpr); C.renderer.setSize(w, h, false);
    // The canvas runs behind the buttons: keep the chest framed in the free area above them and let the
    // glow carry on underneath, instead of ending in a hard line where the buttons start.
    var pad = C.padBottom ? Math.max(0, Math.min(C.padBottom(), h * 0.45)) : 0, hUse = h - pad;
    C.fitAspect = w / hUse;
    C.camera.fov = 2 * Math.atan(Math.tan(BASE_FOV * Math.PI / 360) * h / hUse) * 180 / Math.PI;
    C.camera.aspect = w / h;
    if (pad > 0) C.camera.setViewOffset(w, h, 0, pad / 2, w, h); else C.camera.clearViewOffset();
    C.camera.updateProjectionMatrix();
    C.viewW = w; C.viewH = h; C.dpr = dpr;
    C.parts.mat.uniforms.uScale.value = h * dpr / (2 * Math.tan(C.camera.fov * Math.PI / 360));
    if (C.Q.bloom && C.bloomOK !== false) C.bloom.setSize(Math.round(w * dpr), Math.round(h * dpr)); else C.bloom.dispose();
  };

  // ---- camera -----------------------------------------------------------------------------------
  var camState = { push: 0, lift: 0, shake: 0, sx: 0, sy: 0 };
  var BASE_FOV = 30, FAST_SPEED = 6, SKIP_SPEED = 14;        // how much faster the opening plays with Fast open, and after a tap to skip
  C.updateCamera = function () {
    var cam = C.camera, asp = C.fitAspect || cam.aspect;
    var vf = Math.tan(BASE_FOV * Math.PI / 360);
    // fit a 3.9 wide x 3.3 tall box
    var dist = Math.max(1.72 / (vf * asp), 1.7 / vf) + 1.25;
    dist *= (1 - 0.1 * camState.push);
    var yaw = -0.3, pitch = 0.16 + C.userPitch * 0.6;
    var ty = 1.18 + camState.lift;
    cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist + camState.sx, ty + Math.sin(pitch) * dist + camState.sy, Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(camState.sx * 0.5, ty + camState.sy * 0.5, 0);
  };

  // ---- opening choreography ---------------------------------------------------------------------
  function seqFor(rarityKey, fast, brisk) {
    var tier = RARITY[rarityKey].tier, s;
    if (tier <= 2) s = { tiers: [[0.3, tier]], chainT: 0.42, openT: 0.95, openDur: 0.55, revealT: 1.3, end: 1.75, power: 0.55 + tier * 0.12 };
    else if (tier === 3) s = { tiers: [[0.3, 2], [1.25, 3]], chainT: 1.55, openT: 2.0, openDur: 0.6, revealT: 2.45, end: 3.0, power: 1.0 };
    else s = { tiers: [[0.3, 2], [1.2, 3], [2.35, 4]], chainT: 3.1, openT: 3.65, openDur: 0.7, revealT: 4.25, end: 4.9, power: 1.35 };
    s.tier = tier; s.key = rarityKey; s.speed = fast ? FAST_SPEED : brisk ? 1.9 : 1;      // brisk: an everyday card, no need to linger
    return s;
  }
  var colA = null, colB = null;
  function tierColorAt(seq, t, out) {
    var cur = -1, since = 0;
    for (var i = 0; i < seq.tiers.length; i++) if (t >= seq.tiers[i][0]) { cur = i; since = t - seq.tiers[i][0]; }
    if (cur < 0) { out.color.set('#ffffff'); out.k = 0; out.since = 99; out.tier = -1; return out; }
    var c1 = TIER_COLORS[seq.tiers[cur][1]];
    if (cur > 0 && since < 0.18) { colA.set(TIER_COLORS[seq.tiers[cur - 1][1]]); colB.set(c1); out.color.copy(colA).lerp(colB, since / 0.18); }
    else out.color.set(c1);
    out.k = cur === 0 ? sat(since / 0.3) : 1; out.since = since; out.tier = seq.tiers[cur][1]; out.idx = cur;
    return out;
  }

  C.playOpen = function (rarityKey, opt) {
    opt = opt || {};
    if (C.state !== 'idle') return Promise.resolve(false);
    var seq = seqFor(rarityKey, !!opt.fast, !!opt.brisk);
    C.state = 'opening';
    C.anim = { seq: seq, t: 0, fired: {}, tc: { color: new T.Color(), k: 0, since: 0, tier: -1 }, done: null, lastEmit: 0, coinsLeft: 0 };
    return new Promise(function (res) { C.anim.done = res; });
  };
  C.skip = function () {
    if (C.state === 'opening' && C.anim) { C.anim.seq.skipped = true; C.anim.seq.speed = SKIP_SPEED; }
  };
  C.setFast = function (on) {       // applies to the chest that is opening right now as well
    if (C.state === 'opening' && C.anim && !C.anim.seq.skipped) C.anim.seq.speed = on ? FAST_SPEED : 1;
  };
  C.reset = function (instant, quick) {
    if (C.state === 'idle' || C.state === 'closing') return Promise.resolve();
    C.state = 'closing';
    var a = C.anim; a.closeT = 0; a.closeDur = instant ? 0.001 : quick ? 0.1 : 0.42;
    return new Promise(function (res) { a.closed = res; });
  };

  function burstChain(power) {
    C.chain.visible = false; C.fragG.visible = true;
    C.frags.forEach(function (m) {
      var u = m.userData, h = u.home;
      m.position.copy(h); m.rotation.set(0, 0, 0); m.scale.setScalar(1);
      var out = new T.Vector3(h.x, 0, h.z); var l = out.length() || 1; out.multiplyScalar(1 / l);
      var sp = (2.2 + Math.random() * 3.2) * (0.75 + 0.5 * power);
      u.v.set(out.x * sp + (Math.random() - 0.5) * 1.6, 1.4 + Math.random() * 3.4 * power, out.z * sp + (Math.random() - 0.5) * 1.6);
      u.w.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      u.t = 0; u.life = 0.85 + Math.random() * 0.35;
    });
  }
  function restoreChain() {
    C.fragG.visible = false; C.chain.visible = true; C.chain.scale.setScalar(1);
  }
  function ring(color, t, dur, max) {
    for (var i = 0; i < C.rings.length; i++) {
      var r = C.rings[i];
      if (C.time - r.userData.t0 > r.userData.dur) { r.userData.t0 = C.time; r.userData.dur = dur; r.userData.max = max; r.material.uniforms.uColor.value.set(color); r.visible = true; return; }
    }
  }
  function spawnCoins(n) {
    var cav = C.M.cavity, cz = (cav.min[2] + cav.max[2]) / 2;
    for (var i = 0; i < n && C.coinData.length < Math.min(C.coinMax, C.Q.coins); i++) {
      var a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 2.1;
      C.coinData.push({ p: new T.Vector3((Math.random() - 0.5) * 0.8, C.M.seamY, cz + (Math.random() - 0.5) * 0.6), v: new T.Vector3(Math.cos(a) * sp, 5.2 + Math.random() * 3.6, Math.sin(a) * sp * 0.8 + 0.5),
        r: new T.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new T.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18), t: 0, life: 2.3 });
    }
  }
  var dummy = null;
  function updateCoins(dt) {
    if (!dummy) dummy = new T.Object3D();
    var arr = C.coinData, n = 0;
    for (var i = arr.length - 1; i >= 0; i--) {
      var c = arr[i]; c.t += dt;
      if (c.t > c.life) { arr.splice(i, 1); continue; }
      c.v.y -= 10.5 * dt; c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
    }
    for (var j = 0; j < arr.length; j++) {
      var d = arr[j]; dummy.position.copy(d.p); dummy.rotation.copy(d.r);
      var s = sat(d.t / 0.12) * (1 - smooth(d.life - 0.35, d.life, d.t)); dummy.scale.setScalar(s);
      dummy.updateMatrix(); C.coins.setMatrixAt(n++, dummy.matrix);
    }
    C.coins.count = n; C.coins.instanceMatrix.needsUpdate = true;
  }
  var tmpC = null;
  function sparkColor(o, tier, hotMix) {
    if (!tmpC) tmpC = new T.Color();
    tmpC.set(TIER_COLORS[tier]); if (hotMix) tmpC.lerp(colB.set(HOT[tier]), hotMix);
    o.c[0] = tmpC.r * 1.6; o.c[1] = tmpC.g * 1.6; o.c[2] = tmpC.b * 1.6;
  }

  // Sets every animated value from the timeline position (so skipping or stepping stays consistent).
  C.applyPose = function (dt) {
    if (!colA) { colA = new T.Color(); colB = new T.Color(); }
    var U = C.U, a = C.anim, time = C.time, M = C.M;
    var glow = 0.3 + 0.07 * Math.sin(time * 1.7), glowMix = 0, seam = 0, lidAng = 0, shake = 0, squash = 1, inner = 0, beam = 0, rays = 0, halo = 0, flare = 0, floor = 0;
    var open01 = 0, chain = 1, push = 0, lift = 0, frontL = 0;
    var color = colA.set('#ffffff'), tier = -1;
    if (a) {
      var s = a.seq;
      if (C.state === 'opening') a.t += dt * s.speed;
      var t = a.t, tc = tierColorAt(s, t, a.tc);
      color = tc.color; tier = tc.tier;
      var P = s.power, pre = sat(t / s.chainT);
      if (tc.tier >= 0) {
        var punch = Math.exp(-tc.since * 7);
        glowMix = tc.k; glow = 0.6 + 0.75 * tc.k * (0.5 + 0.5 * pre) * P + 1.1 * punch * (tc.idx > 0 ? 1 : 0.4);
        seam = (0.3 + 1.0 * pre * P) * tc.k + 1.3 * punch * (tc.idx > 0 ? 1 : 0.3);
        halo = (0.05 + 0.13 * pre * P) * tc.k + 0.16 * punch * (tc.idx > 0 ? 1 : 0);
        frontL = (0.6 + 2.0 * pre) * tc.k * P;
        if (tc.idx !== a.fired.tier) {
          a.fired.tier = tc.idx;
          if (C.hooks.onTier) C.hooks.onTier(tc.tier, tc.idx, s);
          if (tc.idx > 0) { ring(TIER_COLORS[tc.tier], t, 0.7, 5.5); camState.shake = Math.max(camState.shake, 0.5 + 0.25 * tc.idx); }
          var nb = Math.round((tc.idx > 0 ? 70 : 26) * C.Q.particles * (0.6 + 0.4 * P)), tt = tc.tier;
          C.parts.emit(nb, time, function (o) {
            var an = Math.random() * Math.PI * 2, r = 1.25 + Math.random() * 0.4, sp = 1.2 + Math.random() * 2.6;
            o.p[0] = Math.cos(an) * r; o.p[1] = M.seamY + (Math.random() - 0.5) * 0.25; o.p[2] = Math.sin(an) * r * 0.86;
            o.v[0] = Math.cos(an) * sp; o.v[1] = 0.6 + Math.random() * 2.4; o.v[2] = Math.sin(an) * sp;
            o.life = 0.5 + Math.random() * 0.6; o.size = 0.05 + Math.random() * 0.08; o.g = 1.5; o.drag = 2.4; sparkColor(o, tt, 0.3);
          });
        }
      }
      // build-up shake (grows until the chain snaps)
      if (t < s.openT) shake = (0.25 + 0.75 * pre * pre) * (0.5 + 0.5 * P) * (t < s.chainT ? 1 : 0.5);
      squash = 1 - 0.035 * Math.sin(sat(t / 0.3) * Math.PI) - (t < s.chainT ? 0.012 * pre : 0);
      push = ease.inOut(sat(t / s.openT)) * (0.55 + 0.35 * P);
      // swirl of sparks while charging (epic / legendary)
      if (s.tier >= 3 && t > s.tiers[1][0] && t < s.openT && C.state === 'opening') {
        a.lastEmit += dt * s.speed;
        var rate = (s.tier === 4 && t > s.tiers[2][0] ? 150 : 70) * C.Q.particles, cnt = Math.floor(a.lastEmit * rate);
        if (cnt > 0) {
          a.lastEmit -= cnt / rate; var tt2 = tc.tier;
          C.parts.emit(cnt, time, function (o) {
            var an = Math.random() * Math.PI * 2, r = 1.7 + Math.random() * 0.9;
            o.p[0] = Math.cos(an) * r; o.p[1] = 0.1 + Math.random() * 1.9; o.p[2] = Math.sin(an) * r;
            o.v[0] = -Math.sin(an) * 2.4 - Math.cos(an) * 1.5; o.v[1] = 0.5 + Math.random() * 1.3; o.v[2] = Math.cos(an) * 2.4 - Math.sin(an) * 1.5;
            o.life = 0.45 + Math.random() * 0.4; o.size = 0.035 + Math.random() * 0.06; o.g = -0.6; o.drag = 1.6; sparkColor(o, tt2, 0.45);
          });
        }
      }
      // chain snaps
      if (t >= s.chainT) {
        chain = 1 - sat((t - s.chainT) / 0.15);
        if (!a.fired.chain) {
          a.fired.chain = true; burstChain(P);
          ring(tier >= 0 ? TIER_COLORS[tier] : '#ffffff', t, 0.55, 4.5 + P);
          camState.shake = Math.max(camState.shake, 0.6 + 0.5 * P);
          if (C.hooks.onPhase) C.hooks.onPhase('chain', s);
          var tt3 = Math.max(tier, 0);
          C.parts.emit(Math.round(60 * C.Q.particles), time, function (o) {
            var an = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
            o.p[0] = Math.cos(an) * 1.5; o.p[1] = 0.55 + Math.random() * 0.4; o.p[2] = Math.sin(an) * 1.3;
            o.v[0] = Math.cos(an) * sp; o.v[1] = 1 + Math.random() * 3; o.v[2] = Math.sin(an) * sp;
            o.life = 0.35 + Math.random() * 0.45; o.size = 0.022 + Math.random() * 0.03; o.g = 6; o.drag = 1.2; o.c[0] = 1.5; o.c[1] = 1.15; o.c[2] = 0.5;
          });
        }
      }
      // lid opens
      if (t >= s.openT) {
        var k = sat((t - s.openT) / s.openDur);
        open01 = ease.outBack(k, 1.25);
        lidAng = -1.88 * open01;
        flare = Math.sin(sat(k * 2.1) * Math.PI) * (1.0 + P);
        inner = sat(k * 2.5) * (0.55 + 0.35 * P);
        beam = ease.outCubic(sat((t - s.openT - 0.05) / 0.45)) * (s.tier >= 3 ? 1 : s.tier === 2 ? 0.62 : 0.4);
        rays = s.tier >= 2 ? ease.outCubic(sat((t - s.openT - 0.1) / 0.5)) * (s.tier === 4 ? 1 : s.tier === 3 ? 0.7 : 0.35) : 0;
        halo = Math.max(halo, 0.1 + 0.1 * P) + 0.35 * Math.exp(-(t - s.openT) * 3) * P;
        floor = (0.07 + 0.07 * P) * sat(k * 2);
        seam = seam * (1 - k) + 0.35;
        glow = 0.95 + 0.25 * P + 0.15 * Math.sin(time * 3.2) + 1.2 * Math.exp(-(t - s.openT) * 4);
        squash = 1 + 0.06 * Math.sin(sat(k) * Math.PI) * (0.5 + 0.5 * P);
        push = lerp(push, -0.25, ease.inOut(sat((t - s.openT) / 0.8)));
        lift = 0.5 * ease.inOut(sat((t - s.openT) / 0.9));
        frontL = lerp(frontL, 0.9, k);
        if (!a.fired.open) {
          a.fired.open = true;
          camState.shake = Math.max(camState.shake, 0.8 + 0.9 * P);
          ring(TIER_COLORS[s.tier], t, 0.8, 5.2 + 1.2 * P); if (s.tier >= 3) ring(HOT[s.tier], t, 1.15, 7.6);
          if (C.hooks.onPhase) C.hooks.onPhase('open', s);
          var n1 = Math.round((70 + 90 * P + (s.tier === 4 ? 240 : s.tier === 3 ? 120 : 0)) * C.Q.particles), tt4 = s.tier;
          C.parts.emit(n1, time, function (o) {
            var an = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * (2.6 + 2.2 * P), upv = 3.5 + Math.random() * (4.5 + 4 * P);
            o.p[0] = (Math.random() - 0.5) * 1.3; o.p[1] = M.seamY; o.p[2] = (Math.random() - 0.5) * 1.0;
            o.v[0] = Math.cos(an) * sp; o.v[1] = upv; o.v[2] = Math.sin(an) * sp;
            o.life = 0.8 + Math.random() * 1.1; o.size = 0.05 + Math.random() * 0.11; o.g = 4.2; o.drag = 0.9; sparkColor(o, tt4, Math.random() * 0.6);
          });
          if (s.tier === 4) a.coinsLeft = C.Q.coins;
        }
        if (a.coinsLeft > 0 && C.state === 'opening') { var nc = Math.min(a.coinsLeft, Math.ceil(dt * 90)); spawnCoins(nc); a.coinsLeft -= nc; }
      }
      if (t >= s.revealT && !a.fired.reveal) { a.fired.reveal = true; if (C.hooks.onPhase) C.hooks.onPhase('reveal', s); }
      if (C.state === 'opening' && t >= s.end) { C.state = 'open'; var d = a.done; a.done = null; if (d) d(true); }
      // steady glitter while the chest stays open
      if ((C.state === 'open' || (C.state === 'opening' && t > s.openT + 0.4)) && dt > 0) {
        a.lastEmit += dt;
        var rate2 = (8 + 16 * P + (s.tier === 4 ? 46 : s.tier === 3 ? 22 : 0)) * C.Q.particles, c2 = Math.floor(a.lastEmit * rate2);
        if (c2 > 0) {
          a.lastEmit -= c2 / rate2; var tt5 = s.tier;
          C.parts.emit(c2, time, function (o) {
            o.p[0] = (Math.random() - 0.5) * 1.5; o.p[1] = M.seamY - 0.1; o.p[2] = (Math.random() - 0.5) * 1.2;
            o.v[0] = (Math.random() - 0.5) * 0.9; o.v[1] = 1.2 + Math.random() * 2.4 * (0.6 + 0.4 * P); o.v[2] = (Math.random() - 0.5) * 0.9;
            o.life = 1.1 + Math.random() * 1.3; o.size = 0.035 + Math.random() * 0.07; o.g = -0.25; o.drag = 0.6; sparkColor(o, tt5, Math.random() * 0.5);
          });
        }
      }
      if (C.state === 'closing') {
        a.closeT += dt;
        var ck = sat(a.closeT / a.closeDur), inv = 1 - ease.inOut(ck);
        lidAng *= inv; open01 *= inv; inner *= inv; beam *= inv * inv; rays *= inv * inv; halo *= inv; floor *= inv; flare = 0; seam *= inv; glowMix *= inv;
        glow = lerp(0.3, glow, inv); lift *= inv; push *= inv; frontL *= inv; chain = ck;
        if (ck > 0.55 && !a.fired.restore) { a.fired.restore = true; restoreChain(); C.coinData.length = 0; }
        if (a.fired.restore) C.chain.scale.setScalar(0.9 + 0.1 * ease.outBack(sat((ck - 0.55) / 0.45)));
        if (ck >= 1) { C.state = 'idle'; var cb = a.closed; C.anim = null; restoreChain(); if (cb) cb(); }
      }
    }
    // uniforms and objects
    U.uGlow.value = glow; U.uGlowMix.value = glowMix; U.uGlowColor.value.copy(color); U.uSeam.value = seam; U.uOpen.value = sat(open01); U.uChain.value = chain;
    C.lidPivot.rotation.x = lidAng;
    var idle = C.state === 'idle';
    var yawIdle = Math.sin(time * 0.45) * 0.1;
    if (!C.dragging) {
      C.userYaw += C.yawVel * dt; C.yawVel *= Math.pow(0.02, dt);
      if (time - C.lastInput > 2.5 || !idle) { var kk = 1 - Math.pow(0.12, dt); C.userYaw = lerp(C.userYaw, 0, kk * (idle ? 0.5 : 2.5)); C.userPitch = lerp(C.userPitch, 0, kk * (idle ? 0.5 : 2.5)); }
    }
    C.yawG.rotation.y = (idle ? yawIdle : yawIdle * 0.3) + C.userYaw;
    var sh = shake * 0.02;
    C.root.position.set(Math.sin(time * 61.3) * sh, (idle ? Math.sin(time * 1.3) * 0.035 : 0) + Math.abs(Math.sin(time * 47.7)) * sh * 1.2, Math.sin(time * 53.9) * sh * 0.6);
    C.root.rotation.z = Math.sin(time * 43.1) * sh * 0.9; C.root.rotation.x = Math.sin(time * 37.7) * sh * 0.5;
    C.root.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
    C.innerLight.color.copy(color); C.innerLight.intensity = inner * 7;
    C.frontLight.color.copy(color); C.frontLight.intensity = frontL;
    C.inner.material.color.copy(color).lerp(colB.set('#ffffff'), 0.45); C.inner.material.opacity = sat(inner * 0.7);
    C.halo.material.color.copy(color); C.halo.material.opacity = sat(halo);
    C.flare.material.color.copy(color).lerp(colB.set('#ffffff'), 0.5); C.flare.material.opacity = sat(flare * 0.3); C.flare.scale.set(6.5 * (0.6 + flare * 0.4), 0.9 + flare * 0.9, 1);
    C.floor.material.color.copy(color); C.floor.material.opacity = sat(floor);
    var bo = C.beamOuter, bc = C.beamCore;
    bo.visible = bc.visible = beam > 0.002;
    if (bo.visible) {
      bo.material.uniforms.uColor.value.copy(color); bo.material.uniforms.uOpacity.value = beam * 0.42; bo.material.uniforms.uTime.value = time;
      bc.material.uniforms.uColor.value.copy(color).lerp(colB.set('#ffffff'), 0.6); bc.material.uniforms.uOpacity.value = beam * 0.7; bc.material.uniforms.uTime.value = time * 1.7;
      var bs = 0.6 + 0.4 * beam; bo.scale.set(bs, 0.35 + 0.65 * beam, bs); bc.scale.set(bs, 0.35 + 0.65 * beam, bs);
    }
    C.rays.visible = rays > 0.002;
    if (C.rays.visible) { C.rays.material.color.copy(color).lerp(colB.set('#ffffff'), 0.3); C.rays.material.opacity = rays * 0.22; C.rays.rotation.y = time * 0.35; }
    for (var gi = 0; gi < C.gemGlows.length; gi++) {
      var gs = C.gemGlows[gi]; gs.material.color.copy(gs.userData.base).lerp(color, glowMix);
      gs.material.opacity = sat(0.05 + 0.025 * Math.sin(time * 1.7 + gi) + (glow - 0.3) * 0.2);
    }
    // chain fragments
    if (C.fragG.visible) {
      for (var fi = 0; fi < C.frags.length; fi++) {
        var m = C.frags[fi], u = m.userData; u.t += dt;
        u.v.y -= 11 * dt; m.position.addScaledVector(u.v, dt);
        m.rotation.x += u.w.x * dt; m.rotation.y += u.w.y * dt; m.rotation.z += u.w.z * dt;
        m.scale.setScalar(1 - smooth(u.life - 0.3, u.life, u.t));
      }
    }
    for (var ri = 0; ri < C.rings.length; ri++) {
      var rg = C.rings[ri], rk = (time - rg.userData.t0) / rg.userData.dur;
      if (rk >= 0 && rk <= 1) { var rs = 1.2 + (rg.userData.max - 1.2) * ease.outCubic(rk); rg.scale.set(rs, rs, 1); rg.material.uniforms.uOpacity.value = Math.pow(1 - rk, 2.4) * 0.8; rg.visible = true; }
      else rg.visible = false;
    }
    updateCoins(dt);
    camState.push = push; camState.lift = lift;
    camState.shake *= Math.pow(0.004, dt);
    camState.sx = Math.sin(time * 71.0) * camState.shake * 0.06; camState.sy = Math.sin(time * 83.0 + 1.3) * camState.shake * 0.06;
    C.parts.mat.uniforms.uTime.value = time;
    C.updateCamera();
  };

  // Bloom needs float render targets. Where a device cannot draw into them the frame comes out black, so the
  // first bloom frame is checked once and the plain renderer takes over if the chest is not on it.
  C.bloomOK = null;
  function chestOnScreen() {
    var gl = C.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4);
    if (w < 60 || h < 60) return null;
    for (var i = 0; i < 9; i++) {
      gl.readPixels(Math.floor(w * (0.3 + 0.05 * i)), Math.floor(h * 0.6), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] + px[1] + px[2] > 12) return true;
    }
    return false;
  }
  function plainFrame() { C.renderer.setRenderTarget(null); C.renderer.render(C.scene, C.camera); }
  C.renderFrame = function () {
    if (C.Q.bloom && C.bloomOK !== false && C.bloom.main) {
      C.bloom.render(C.scene, C.camera);
      if (C.bloomOK === null) {
        var seen = null; try { seen = chestOnScreen(); } catch (e) { seen = false; }
        if (seen !== null) C.bloomOK = seen;
        if (seen === false) { C.bloom.dispose(); plainFrame(); }
      }
    } else plainFrame();
  };
  var last = 0, raf = 0, fpsAcc = 0, fpsN = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    if (!C.visible) {
      // another tab of the app is open: auto opening still needs the clock, so the pose advances without a draw call
      if (C.keepAlive) { var d0 = Math.min(0.05, (now - last) / 1000 || 0.016); C.time += d0; C.applyPose(d0); }
      last = now; return;
    }
    var raw = (now - last) / 1000 || 0.016, dt = Math.min(0.05, raw); last = now;
    C.step(dt);
    if (raw < 1.5) { fpsAcc += raw; fpsN++; }      // real time between frames, so slow devices are measured honestly
    if (fpsAcc >= 2) { C.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (C.hooks.onFps) C.hooks.onFps(C.fps); }
  }
  C.step = function (dt) { C.time += dt; C.applyPose(dt); C.renderFrame(); };
  C.start = function () { if (C.running) return; C.running = true; last = performance.now(); raf = requestAnimationFrame(loop); };
  C.stop = function () { C.running = false; cancelAnimationFrame(raf); };
  // screen position (CSS px) of a point above the open chest, for anchoring the reveal card
  C.anchor = function () {
    var v = new T.Vector3(0, C.M.seamY + 0.4, 0).applyMatrix4(C.yawG.matrixWorld).project(C.camera);
    return { x: (v.x * 0.5 + 0.5) * C.viewW, y: (-v.y * 0.5 + 0.5) * C.viewH };
  };
  C.TIER_COLORS = TIER_COLORS;
  return C;
})();
