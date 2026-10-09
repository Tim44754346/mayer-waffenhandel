(function (global) {
  'use strict';

  const RAD = Math.PI / 180;
  const FOV = 26 * RAD;
  const TAN_HALF = Math.tan(FOV / 2);
  const LIGHT = [-0.35, 0.6, 0.72];
  const MAX_DPR = 2;

  const STYLE = `
.w3d{position:relative;overflow:hidden;background:transparent;-webkit-user-select:none;user-select:none}
.w3d canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.w3d canvas:active{cursor:grabbing}
.w3d-msg{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:var(--muted,#a6a49d);font:.85rem/1.4 "Segoe UI",Arial,sans-serif;pointer-events:none}
.w3d[data-state="ready"] .w3d-msg{display:none}
.w3d-hint{position:absolute;left:10px;bottom:8px;color:var(--muted,#a6a49d);font:.72rem/1.3 "Segoe UI",Arial,sans-serif;pointer-events:none}
.w3d-bar{position:absolute;right:8px;top:8px;display:flex;gap:6px}
.w3d-btn{min-height:40px;padding:6px 11px;border:1px solid rgba(197,154,85,.5);background:rgba(23,24,23,.75);color:var(--gold-light,#e2bd7a);font:.74rem "Segoe UI",Arial,sans-serif;cursor:pointer}
.w3d-btn[aria-pressed="true"]{background:rgba(197,154,85,.22)}
.w3d-btn:focus-visible{outline:2px solid var(--gold-light,#e2bd7a);outline-offset:2px}
.w3d:not([data-state="ready"]) .w3d-bar,.w3d:not([data-state="ready"]) .w3d-hint{display:none}
`;
  let styleDone = false;
  function injectStyle() {
    if (styleDone) return;
    styleDone = true;
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  /* ---------- Mathe ---------- */
  // Zeilenweise 3x3-Drehung R = Rx(pitch) * Ry(yaw)
  function rotation(yawDeg, pitchDeg) {
    const cy = Math.cos(yawDeg * RAD), sy = Math.sin(yawDeg * RAD);
    const cp = Math.cos(pitchDeg * RAD), sp = Math.sin(pitchDeg * RAD);
    return [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy];
  }
  function mul4(a, b) { // spaltenweise 4x4: a * b
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
  }
  function perspective(aspect, near, far) {
    const f = 1 / TAN_HALF;
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  }
  function cameraFor(state, mesh, w, h) {
    const aspect = w / h;
    const halfMin = Math.atan(Math.min(TAN_HALF, TAN_HALF * aspect));
    const e = mesh.ext;
    const need = Math.max(e.h / TAN_HALF, e.w / (TAN_HALF * aspect)) * 1.12 + e.z;
    const sphere = mesh.radius / Math.sin(halfMin) * 1.04;
    const dist = Math.max(need, sphere * 0.55) / state.zoom;
    return { dist, aspect, near: Math.max(dist * 0.04, 0.01), far: dist + mesh.radius * 2 };
  }

  /* ---------- Mesh vorbereiten ---------- */
  function prepareMesh(m) {
    const n = Math.floor(m.i.length / 3);
    const v = m.v, t = m.t, idx = m.i;
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < v.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        if (v[k + a] < mn[a]) mn[a] = v[k + a];
        if (v[k + a] > mx[a]) mx[a] = v[k + a];
      }
    }
    const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const pos = new Float32Array(n * 9), uv = new Float32Array(n * 6), nor = new Float32Array(n * 3);
    let r2 = 0;
    for (let f = 0; f < n; f++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx[f * 3 + k];
        for (let a = 0; a < 3; a++) pos[f * 9 + k * 3 + a] = v[vi * 3 + a] - c[a];
        uv[f * 6 + k * 2] = t[vi * 2];
        uv[f * 6 + k * 2 + 1] = t[vi * 2 + 1];
        const x = pos[f * 9 + k * 3], y = pos[f * 9 + k * 3 + 1], z = pos[f * 9 + k * 3 + 2];
        const d = x * x + y * y + z * z;
        if (d > r2) r2 = d;
      }
      const o = f * 9;
      const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
      const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nor[f * 3] = nx / l; nor[f * 3 + 1] = ny / l; nor[f * 3 + 2] = nz / l;
    }
    const view = m.view || { yaw: -28, pitch: 14 };
    const R = rotation(view.yaw, view.pitch);
    const ext = { w: 0, h: 0, z: 0 };
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      ext.w = Math.max(ext.w, Math.abs(R[0] * x + R[1] * y + R[2] * z));
      ext.h = Math.max(ext.h, Math.abs(R[3] * x + R[4] * y + R[5] * z));
      ext.z = Math.max(ext.z, Math.abs(R[6] * x + R[7] * y + R[8] * z));
    }
    return { n, pos, uv, nor, radius: Math.sqrt(r2) || 1, view, ext };
  }

  /* ---------- WebGL-Renderer ---------- */
  function createGL(canvas, mesh, image) {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true }) ||
               canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('kein WebGL');
    function shader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER,
      'attribute vec3 aPos;attribute vec3 aNor;attribute vec2 aUv;' +
      'uniform mat4 uMvp;uniform mat3 uRot;varying vec3 vNor;varying vec2 vUv;' +
      'void main(){vNor=uRot*aNor;vUv=aUv;gl_Position=uMvp*vec4(aPos,1.0);}'));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER,
      'precision mediump float;uniform sampler2D uTex;varying vec3 vNor;varying vec2 vUv;' +
      'void main(){vec4 c=texture2D(uTex,vUv);if(c.a<0.5)discard;' +
      'vec3 n=normalize(vNor);if(n.z<0.0)n=-n;' +
      'float d=max(dot(n,vec3(' + LIGHT.map(function (x) { return x.toFixed(4); }).join(',') + ')),0.0);' +
      'gl_FragColor=vec4(min(c.rgb*(0.62+0.5*d),vec3(1.0)),1.0);}'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Programm: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const n3 = mesh.n * 3, data = new Float32Array(n3 * 8);
    for (let f = 0; f < mesh.n; f++) {
      for (let k = 0; k < 3; k++) {
        const o = (f * 3 + k) * 8;
        data[o] = mesh.pos[f * 9 + k * 3]; data[o + 1] = mesh.pos[f * 9 + k * 3 + 1]; data[o + 2] = mesh.pos[f * 9 + k * 3 + 2];
        data[o + 3] = mesh.nor[f * 3]; data[o + 4] = mesh.nor[f * 3 + 1]; data[o + 5] = mesh.nor[f * 3 + 2];
        data[o + 6] = mesh.uv[f * 6 + k * 2]; data[o + 7] = mesh.uv[f * 6 + k * 2 + 1];
      }
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    [['aPos', 3, 0], ['aNor', 3, 12], ['aUv', 2, 24]].forEach(function (a) {
      const loc = gl.getAttribLocation(prog, a[0]);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, a[1], gl.FLOAT, false, 32, a[2]);
    });

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const pot = function (x) { return (x & (x - 1)) === 0; };
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (pot(image.width) && pot(image.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
    const uMvp = gl.getUniformLocation(prog, 'uMvp'), uRot = gl.getUniformLocation(prog, 'uRot');
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    let rendererName = '';
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      rendererName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    } catch (e) {}
    return {
      name: 'webgl',
      gpuName: rendererName,
      software: /swiftshader|llvmpipe|software|basic render/i.test(rendererName),
      draw: function (state, w, h) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const R = rotation(state.yaw, state.pitch);
        const cam = cameraFor(state, mesh, w, h);
        const mv = new Float32Array([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, -cam.dist, 1]);
        gl.uniformMatrix4fv(uMvp, false, mul4(perspective(cam.aspect, cam.near, cam.far), mv));
        gl.uniformMatrix3fv(uRot, false, new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]));
        gl.drawArrays(gl.TRIANGLES, 0, mesh.n * 3);
      },
      destroy: function () {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };
  }

  /* ---------- Software-Renderer (Canvas 2D mit Tiefenpuffer) ---------- */
  function createSoft(canvas, mesh, image) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('kein Canvas');
    // Texturpixel einmal auslesen, um pro Dreieck eine Farbe zu bestimmen
    const off = document.createElement('canvas');
    off.width = image.width; off.height = image.height;
    const octx = off.getContext('2d');
    octx.drawImage(image, 0, 0);
    const px = octx.getImageData(0, 0, off.width, off.height).data;
    const n = mesh.n, tw = off.width, th = off.height;
    const base = new Uint8Array(n * 3), valid = new Uint8Array(n);
    for (let f = 0; f < n; f++) {
      const u = (mesh.uv[f * 6] + mesh.uv[f * 6 + 2] + mesh.uv[f * 6 + 4]) / 3;
      const v = (mesh.uv[f * 6 + 1] + mesh.uv[f * 6 + 3] + mesh.uv[f * 6 + 5]) / 3;
      const x = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)));
      const y = Math.min(th - 1, Math.max(0, Math.floor((1 - v) * th)));
      const p = (y * tw + x) * 4;
      if (px[p + 3] < 128) continue;
      valid[f] = 1; base[f * 3] = px[p]; base[f * 3 + 1] = px[p + 1]; base[f * 3 + 2] = px[p + 2];
    }
    let img = null, zb = null, bw = 0, bh = 0;
    const X = new Float32Array(3), Y = new Float32Array(3), Z = new Float32Array(3);

    return {
      name: 'canvas',
      draw: function (state, w, h) {
        const W = canvas.width, H = canvas.height;
        if (W !== bw || H !== bh) { img = ctx.createImageData(W, H); zb = new Float32Array(W * H); bw = W; bh = H; }
        const data = img.data;
        data.fill(0); zb.fill(0);
        const R = rotation(state.yaw, state.pitch);
        const cam = cameraFor(state, mesh, w, h);
        const k = (H / 2) / TAN_HALF, cx = W / 2, cy = H / 2;
        const pos = mesh.pos, nor = mesh.nor, L = LIGHT;
        for (let f = 0; f < n; f++) {
          if (!valid[f]) continue;
          let ok = true;
          for (let q = 0; q < 3; q++) {
            const o = f * 9 + q * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
            const vx = R[0] * x + R[1] * y + R[2] * z;
            const vy = R[3] * x + R[4] * y + R[5] * z;
            const vz = R[6] * x + R[7] * y + R[8] * z;
            const d = cam.dist - vz;
            if (d <= cam.near) { ok = false; break; }
            const s = k / d;
            X[q] = cx + vx * s; Y[q] = cy - vy * s; Z[q] = 1 / d;
          }
          if (!ok) continue;
          const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
          if (area > -1e-4 && area < 1e-4) continue;
          // Schattierung (zweiseitig)
          const nx = nor[f * 3], ny = nor[f * 3 + 1], nz = nor[f * 3 + 2];
          let rx = R[0] * nx + R[1] * ny + R[2] * nz, ry = R[3] * nx + R[4] * ny + R[5] * nz, rz = R[6] * nx + R[7] * ny + R[8] * nz;
          if (rz < 0) { rx = -rx; ry = -ry; rz = -rz; }
          const m = 0.62 + 0.5 * Math.max(rx * L[0] + ry * L[1] + rz * L[2], 0);
          const cr = Math.min(255, base[f * 3] * m), cg = Math.min(255, base[f * 3 + 1] * m), cb = Math.min(255, base[f * 3 + 2] * m);
          let x0 = Math.floor(Math.min(X[0], X[1], X[2])), x1 = Math.ceil(Math.max(X[0], X[1], X[2]));
          let y0 = Math.floor(Math.min(Y[0], Y[1], Y[2])), y1 = Math.ceil(Math.max(Y[0], Y[1], Y[2]));
          if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > W - 1) x1 = W - 1; if (y1 > H - 1) y1 = H - 1;
          if (x1 < x0 || y1 < y0) continue;
          const inv = 1 / area;
          const ax = (Y[2] - Y[0]) * inv, bx = -(Y[1] - Y[0]) * inv;     // Änderung von w1 / w2 pro Pixel in x
          const ay = -(X[2] - X[0]) * inv, by = (X[1] - X[0]) * inv;     // Änderung pro Pixel in y
          const z0 = Z[0], z1 = Z[1], z2 = Z[2];
          for (let y = y0; y <= y1; y++) {
            const py = y + 0.5, px0 = x0 + 0.5;
            let w1 = (px0 - X[0]) * ax + (py - Y[0]) * ay;
            let w2 = (px0 - X[0]) * bx + (py - Y[0]) * by;
            let i = y * W + x0;
            for (let x = x0; x <= x1; x++, i++, w1 += ax, w2 += bx) {
              const w0 = 1 - w1 - w2;
              if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;
              const z = w0 * z0 + w1 * z1 + w2 * z2;
              if (z <= zb[i]) continue;
              zb[i] = z;
              const o = i * 4;
              data[o] = cr; data[o + 1] = cg; data[o + 2] = cb; data[o + 3] = 255;
            }
          }
        }
        ctx.putImageData(img, 0, 0);
      },
      destroy: function () {}
    };
  }

  /* ---------- Betrachter ---------- */
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Textur konnte nicht geladen werden')); };
      img.src = url;
    });
  }

  function mount(el, opts) {
    injectStyle();
    opts = opts || {};
    const ds = el.dataset;
    const cfg = {
      src: opts.src || ds.model,
      texture: opts.texture || ds.texture || '',
      autorotate: opts.autorotate !== undefined ? opts.autorotate : ds.autorotate !== 'false',
      renderer: opts.renderer || ds.renderer || 'auto',
      yaw: opts.yaw !== undefined ? opts.yaw : (ds.yaw !== undefined ? parseFloat(ds.yaw) : null),
      pitch: opts.pitch !== undefined ? opts.pitch : (ds.pitch !== undefined ? parseFloat(ds.pitch) : null),
      zoom: opts.zoom !== undefined ? opts.zoom : (ds.zoom !== undefined ? parseFloat(ds.zoom) : 1)
    };
    if (!cfg.src) throw new Error('Waffen3D: data-model fehlt');
    if (reducedMotion()) cfg.autorotate = false;

    el.classList.add('w3d');
    el.dataset.state = 'loading';
    const msg = document.createElement('div');
    msg.className = 'w3d-msg';
    msg.textContent = '3D-Modell wird geladen …';
    el.appendChild(msg);

    let canvas = null, backend = null, mesh = null, image = null;
    let started = false, destroyed = false, visible = false, raf = 0, last = 0;
    let w = 0, h = 0, dpr = 1, scale = 1, ema = 0, emaN = 0, interacting = false, idleUntil = 0, dirty = true, autorot = cfg.autorotate;
    const state = { yaw: 0, pitch: 0, zoom: 1 };
    const pointers = new Map();
    let pinch = 0, lastTap = 0;
    let barAuto = null, hint = null;

    function resetView() {
      const v = mesh ? mesh.view : { yaw: -28, pitch: 14 };
      state.yaw = cfg.yaw !== null ? cfg.yaw : v.yaw;
      state.pitch = cfg.pitch !== null ? cfg.pitch : v.pitch;
      state.zoom = cfg.zoom || 1;
      dirty = true; schedule();
    }

    function fail(err) {
      if (destroyed) return;
      el.dataset.state = 'failed';
      msg.textContent = '3D-Ansicht ist hier nicht verfügbar.';
      msg.style.display = 'block';
      el.dispatchEvent(new CustomEvent('waffen3d:error', { detail: err }));
      if (global.console) console.warn('Waffen3D:', err);
    }

    function fit() {
      const cw = el.clientWidth, ch = el.clientHeight;
      const nowVisible = cw > 0 && ch > 0;
      if (!nowVisible) { visible = false; return; }
      if (cw !== w || ch !== h || !visible) {
        w = cw; h = ch;
        sizeCanvas();
      }
      visible = true;
      if (!started) start();
      schedule();
    }

    function sizeCanvas() {
      const cap = backend && backend.name === 'canvas' ? 1.25 : MAX_DPR;
      dpr = Math.min(global.devicePixelRatio || 1, cap) * scale;
      if (canvas) { canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr)); }
      dirty = true;
    }

    function makeCanvas() {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', opts.label || ds.label || '3D-Ansicht, zum Drehen ziehen');
      return c;
    }

    function useBackend(kind) {
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (backend) backend.destroy();
      canvas = makeCanvas();
      el.insertBefore(canvas, el.firstChild);
      backend = kind === 'webgl' ? createGL(canvas, mesh, image) : createSoft(canvas, mesh, image);
      // Läuft WebGL nur in Software (kein Grafikchip), ist der eigene Renderer schneller und flüssiger
      if (kind === 'webgl' && cfg.renderer === 'auto' && backend.software) throw new Error('WebGL nur in Software');
      el.dataset.rendererUsed = backend.name;
      bindEvents(canvas);
      dirty = true;
    }

    function start() {
      started = true;
      const base = new URL(cfg.src, document.baseURI);
      fetch(base.href).then(function (r) {
        if (!r.ok) throw new Error('Modell nicht gefunden (' + r.status + ')');
        return r.json();
      }).then(function (json) {
        mesh = prepareMesh(json);
        const tex = cfg.texture ? new URL(cfg.texture, document.baseURI) : new URL(json.texture, base);
        return loadImage(tex.href);
      }).then(function (img) {
        if (destroyed) return;
        image = img;
        const order = cfg.renderer === 'canvas' ? ['canvas'] : cfg.renderer === 'webgl' ? ['webgl'] : ['webgl', 'canvas'];
        let lastErr = null;
        for (let i = 0; i < order.length; i++) {
          try { useBackend(order[i]); lastErr = null; break; } catch (e) { lastErr = e; }
        }
        if (lastErr) throw lastErr;
        resetView();
        buildUi();
        el.dataset.state = 'ready';
        el.dispatchEvent(new CustomEvent('waffen3d:ready', { detail: { renderer: backend.name } }));
        fit();
      }).catch(fail);
    }

    function buildUi() {
      const bar = document.createElement('div');
      bar.className = 'w3d-bar';
      barAuto = document.createElement('button');
      barAuto.type = 'button'; barAuto.className = 'w3d-btn';
      barAuto.textContent = 'Auto-Drehung';
      barAuto.setAttribute('aria-pressed', autorot ? 'true' : 'false');
      barAuto.addEventListener('click', function () { setAutorotate(!autorot); });
      const rb = document.createElement('button');
      rb.type = 'button'; rb.className = 'w3d-btn'; rb.textContent = 'Zurücksetzen';
      rb.addEventListener('click', resetView);
      bar.appendChild(barAuto); bar.appendChild(rb);
      el.appendChild(bar);
      hint = document.createElement('div');
      hint.className = 'w3d-hint';
      hint.textContent = 'Ziehen zum Drehen · zwei Finger zum Zoomen';
      el.appendChild(hint);
    }

    function setAutorotate(on) {
      autorot = !!on;
      idleUntil = 0;
      if (barAuto) barAuto.setAttribute('aria-pressed', autorot ? 'true' : 'false');
      schedule();
    }

    function touched() {
      if (hint) hint.style.display = 'none';
      idleUntil = performance.now() + 4000;
    }

    function bindEvents(c) {
      c.addEventListener('pointerdown', function (e) {
        c.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        interacting = true; touched();
        if (pointers.size === 2) pinch = pinchDist();
        const now = performance.now();
        if (pointers.size === 1 && now - lastTap < 320) { resetView(); }
        if (pointers.size === 1) lastTap = now;
      });
      c.addEventListener('pointermove', function (e) {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (pointers.size === 1) {
          state.yaw += dx * 0.45;
          state.pitch = Math.max(-89, Math.min(89, state.pitch + dy * 0.45));
        } else if (pointers.size === 2) {
          const d = pinchDist();
          if (pinch > 0 && d > 0) state.zoom = Math.max(0.5, Math.min(4, state.zoom * d / pinch));
          pinch = d;
        }
        touched(); dirty = true; schedule();
      });
      function up(e) {
        pointers.delete(e.pointerId);
        pinch = pointers.size === 2 ? pinchDist() : 0;
        if (pointers.size === 0) interacting = false;
        touched();
      }
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('wheel', function (e) {
        e.preventDefault();
        state.zoom = Math.max(0.5, Math.min(4, state.zoom * Math.exp(-e.deltaY * 0.0015)));
        touched(); dirty = true; schedule();
      }, { passive: false });
      c.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        try { useBackend('canvas'); schedule(); } catch (err) { fail(err); }
      });
    }
    function pinchDist() {
      const a = Array.from(pointers.values());
      if (a.length < 2) return 0;
      return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    }

    function schedule() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }

    function frame(t) {
      raf = 0;
      if (destroyed || !backend || !visible) { last = 0; return; }
      const raw = last ? (t - last) : 0;
      const dt = Math.min(0.1, raw / 1000);
      last = t;
      const spinning = autorot && !interacting && performance.now() >= idleUntil;
      if (spinning) { state.yaw += 22 * dt; dirty = true; }
      // zu langsam? dann Auflösung schrittweise senken
      if (raw > 0 && (spinning || interacting)) {
        ema = emaN ? ema * 0.9 + raw * 0.1 : raw; emaN++;
        if (emaN > 20 && ema > 60 && scale > 0.5) { scale = Math.max(0.5, scale * 0.8); emaN = 0; sizeCanvas(); }
      }
      if (dirty) {
        dirty = false;
        try { backend.draw(state, w, h); } catch (e) {
          if (backend.name === 'webgl') { try { useBackend('canvas'); dirty = true; } catch (e2) { fail(e2); return; } }
          else { fail(e); return; }
        }
      }
      if (spinning || dirty || (autorot && !interacting)) schedule(); else last = 0;
    }

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el); else global.addEventListener('resize', fit);
    fit();

    function destroy() {
      destroyed = true;
      if (ro) ro.disconnect(); else global.removeEventListener('resize', fit);
      if (raf) cancelAnimationFrame(raf);
      if (backend) backend.destroy();
      el.innerHTML = '';
      el.classList.remove('w3d');
      delete el.dataset.state; delete el.dataset.rendererUsed;
    }

    return {
      element: el,
      reset: resetView,
      setAutorotate: setAutorotate,
      destroy: destroy,
      get renderer() { return backend ? backend.name : null; },
      get frameMs() { return Math.round(ema); },
      get scale() { return scale; }
    };
  }

  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function auto(root) {
    const list = (root || document).querySelectorAll('.waffen3d[data-model]');
    const out = [];
    list.forEach(function (el) {
      if (el.dataset.w3dMounted) return;
      el.dataset.w3dMounted = '1';
      try { out.push(mount(el)); } catch (e) { if (global.console) console.warn(e); }
    });
    return out;
  }

  global.Waffen3D = { mount: mount, auto: auto, version: '1.0' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { auto(); });
  else auto();
})(window);
