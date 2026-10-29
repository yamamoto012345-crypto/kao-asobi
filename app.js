'use strict';
/* かおあそび — じぶんの顔写真をバネのメッシュ変形で遊ぶ。写真は端末内のみ（localStorage）。
   調整は SLEEP_MS と、step() の係数（A/S/sig）・STILL_R を触る。 */

const SIZE = 720;                       // 写真テクスチャの一辺(px)
const N = 36;                           // メッシュ分割数
const SLEEP_MS = 3 * 60 * 1000;         // あそび続けて眠るまで
const WAKE_WAIT = 15;                   // 眠ってから「おきる」が押せるまで(秒)
const LS = { last: 'kaoasobi_last', sleep: 'kaoasobi_sleep', sound: 'kaoasobi_sound' };

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても遊べる */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } },
};
let soundOn = store.get(LS.sound, '1') === '1';
let sleepOn = store.get(LS.sleep, '1') === '1';

/* ---------- 画面切替・小物 ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'play') { playing = true; layout(); last = performance.now(); } else { playing = false; }
}
let toastTimer = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- おと ---------- */
let actx = null;
function audio() {
  if (!soundOn) return null;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { return null; }
  return actx;
}
function tone(f0, f1, dur, type, vol, delay) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol || 0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  poke() { tone(620, 300, 0.1, 'sine', 0.14); },
  boing() { tone(420, 110, 0.4, 'triangle', 0.18); tone(300, 80, 0.5, 'sine', 0.1, 0.07); },
  grow() { [262, 330, 392, 523, 659].forEach((f, i) => tone(f, f * 1.02, 0.1, 'square', 0.07, i * 0.07)); },
  star() { [1046, 1318, 1568, 2093].forEach((f, i) => tone(f, f * 1.01, 0.18, 'sine', 0.1, i * 0.09)); },
  baa() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f * 1.01, 0.16, 'triangle', 0.16, i * 0.08)); },
  hands() { tone(300, 500, 0.3, 'sine', 0.08); },
};

/* ---------- 写真の取り込み ---------- */
const photoCanvas = document.createElement('canvas');
photoCanvas.width = photoCanvas.height = SIZE;

let stream = null, facing = 'user';
function stopCam() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  $('video').srcObject = null;
}
async function startCam() {
  stopCam();
  $('camMsg').textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false,
    });
    const v = $('video');
    v.srcObject = stream;
    v.classList.toggle('mirror', facing === 'user');
    await v.play();
  } catch (e) {
    $('camMsg').textContent = 'カメラが つかえません。「しゃしんを えらぶ」で えらんでね';
  }
}
function shoot() {
  const v = $('video');
  if (!v.videoWidth) { toast('カメラの じゅんびちゅう…'); return; }
  const s = Math.min(v.videoWidth, v.videoHeight);
  const g = photoCanvas.getContext('2d');
  g.save();
  if (facing === 'user') { g.translate(SIZE, 0); g.scale(-1, 1); }   // じぶん側カメラは鏡と同じ向き
  g.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, SIZE, SIZE);
  g.restore();
  $('flash').classList.remove('go'); void $('flash').offsetWidth; $('flash').classList.add('go');
  sfx.poke();
  stopCam();
  startPlay(true);
}
async function loadFile(file) {
  if (!file) return;
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    try {
      img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    } catch (e2) { toast('しゃしんを ひらけませんでした'); return; }
  }
  const w = img.width, h = img.height, s = Math.min(w, h);
  const g = photoCanvas.getContext('2d');
  g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIZE, SIZE);
  stopCam();
  startPlay(true);
}
function saveLast() {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    c.getContext('2d').drawImage(photoCanvas, 0, 0, 512, 512);
    store.set(LS.last, c.toDataURL('image/jpeg', 0.8));
  } catch (e) { /* noop */ }
}
function refreshHome() {
  const d = store.get(LS.last, '');
  $('btnResume').hidden = !d;
  if (d) $('thumb').src = d;
}
function resumeLast() {
  const d = store.get(LS.last, '');
  if (!d) return;
  const im = new Image();
  im.onload = () => { photoCanvas.getContext('2d').drawImage(im, 0, 0, SIZE, SIZE); startPlay(false); };
  im.src = d;
}

/* ---------- WebGL メッシュ ---------- */
const glc = $('glc'), ovc = $('ovc'), octx = ovc.getContext('2d');
const gl = glc.getContext('webgl', { preserveDrawingBuffer: true, antialias: true }) || glc.getContext('experimental-webgl', { preserveDrawingBuffer: true });
const V = (N + 1) * (N + 1);
const rest = new Float32Array(V * 2), disp = new Float32Array(V * 2), vel = new Float32Array(V * 2), pos = new Float32Array(V * 2);
let prog, posBuf, tex, uTint;

function initGL() {
  if (!gl) return false;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = (j * (N + 1) + i) * 2; rest[k] = i / N; rest[k + 1] = j / N;
  }
  const idx = new Uint16Array(N * N * 6); let p = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx[p++] = a; idx[p++] = b; idx[p++] = c; idx[p++] = b; idx[p++] = d; idx[p++] = c;
  }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER,
    'attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv;' +
    'void main(){ vUv = aUv; gl_Position = vec4(aPos.x*2.0-1.0, 1.0-aPos.y*2.0, 0.0, 1.0); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER,
    'precision mediump float; uniform sampler2D uTex; uniform vec3 uTint; varying vec2 vUv;' +
    'void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uTint, 1.0); }'));
  gl.linkProgram(prog); gl.useProgram(prog);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, rest, gl.STATIC_DRAW);
  const aUv = gl.getAttribLocation(prog, 'aUv'); gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

  posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos.byteLength, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);
  uTint = gl.getUniformLocation(prog, 'uTint');
  gl.clearColor(1, 0.965, 0.878, 1);
  return true;
}
const glOK = initGL();

function uploadTexture() {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photoCanvas);
}

/* ---------- レイアウト ---------- */
let side = 300;
function layout() {
  const W = window.innerWidth, H = window.innerHeight;
  const wide = W / H >= 1.3;
  side = Math.max(160, Math.floor(wide ? Math.min(H, W - 210) : Math.min(W, H - 190)));
  const st = $('stage'); st.style.width = st.style.height = side + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2), px = Math.round(side * dpr);
  glc.width = glc.height = ovc.width = ovc.height = px;
  if (gl) gl.viewport(0, 0, px, px);
}
window.addEventListener('resize', () => { if (playing) layout(); });
window.addEventListener('orientationchange', () => setTimeout(() => { if (playing) layout(); }, 200));

/* ---------- あそびの状態 ---------- */
let playing = false, last = 0, big = false, starUntil = 0, sleeping = false, sleepAt = 0, playMs = 0;
const ptrs = new Map();                 // 触れている指 id→{x,y}
let ptr = null;                         // 操作状態 {mode:'one'|'two', ...}
const parts = [];                       // 飛び散る絵文字
let baa = null;                         // いないいないばあの進行 {t0, fired}

function startPlay(save) {
  if (!glOK) { toast('このたんまつでは あそべません'); return; }
  if (save) saveLast();
  uploadTexture();
  disp.fill(0); vel.fill(0);
  big = false; starUntil = 0; sleeping = false; playMs = 0; ptr = null; ptrs.clear(); baa = null; parts.length = 0;
  $('actMush').classList.remove('on'); $('sleep').hidden = true;
  show('play');
}

function impulse(cx, cy, sigma, k) {      // 中心から外へ(+)／内へ(-)の速度を与える
  const s2 = 2 * sigma * sigma;
  for (let i = 0; i < V; i++) {
    const dx = rest[2 * i] - cx, dy = rest[2 * i + 1] - cy;
    const f = Math.exp(-(dx * dx + dy * dy) / s2);
    vel[2 * i] += dx * f * k; vel[2 * i + 1] += dy * f * k;
  }
}
function burst(ch, n, cx, cy, size) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.25 + Math.random() * 0.5;
    parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.2, life: 0, max: 1.1 + Math.random() * 0.6, ch, size: size * (0.7 + Math.random() * 0.6) });
  }
}

/* ---------- ポインタ（触り方で操作が自動で決まる） ----------
   指1本：なぞる＝つまむ／押しっぱなし＝ふくらむ／円をかく＝ぐるぐる
   指2本：近づける＝ぎゅー／広げる＝ふくらむ／ひねる＝ぐるぐる */
const STILL_R = 0.045;                  // これ以上動いたら「なぞる」
function pt(e) {
  const r = glc.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
}
function startOne(id, x, y) {
  ptr = { mode: 'one', id, x0: x, y0: y, x, y, t: 0, still: true, turn: 0, lx: x, ly: y, dvx: 0, dvy: 0, cx: x, cy: y, swirling: false };
}
function twoPts() {
  const it = ptrs.values(), a = it.next().value, b = it.next().value;
  return [a, b];
}
function startTwo() {
  const [a, b] = twoPts();
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ptr = { mode: 'two', t: 0, d0: Math.max(0.06, Math.hypot(b.x - a.x, b.y - a.y)), mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2,
    mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: 0, aPrev: ang, aAcc: 0 };
  ptr.d = ptr.d0;
}
glc.addEventListener('pointerdown', (e) => {
  if (sleeping || ptrs.size >= 2) return;
  const [x, y] = pt(e);
  ptrs.set(e.pointerId, { x, y });
  try { glc.setPointerCapture(e.pointerId); } catch (er) { /* noop */ }
  if (ptrs.size === 1) { startOne(e.pointerId, x, y); impulse(x, y, 0.14, -4.5); sfx.poke(); }   // ぷにっと凹む
  else startTwo();
});
glc.addEventListener('pointermove', (e) => {
  const q = ptrs.get(e.pointerId); if (!q || !ptr) return;
  [q.x, q.y] = pt(e);
  if (ptr.mode === 'two') {
    const [a, b] = twoPts();
    ptr.mx = (a.x + b.x) / 2; ptr.my = (a.y + b.y) / 2; ptr.d = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    let da = ang - ptr.aPrev; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    ptr.aAcc += da; ptr.aPrev = ang;
    return;
  }
  ptr.x = q.x; ptr.y = q.y;
  if (Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0) > STILL_R) ptr.still = false;
  const dx = ptr.x - ptr.lx, dy = ptr.y - ptr.ly;
  if (Math.hypot(dx, dy) > 0.012) {                     // 進む向きの変化を足し込む＝円をかいているか
    if (ptr.dvx || ptr.dvy) ptr.turn += Math.atan2(ptr.dvx * dy - ptr.dvy * dx, ptr.dvx * dx + ptr.dvy * dy);
    ptr.dvx = dx; ptr.dvy = dy; ptr.lx = ptr.x; ptr.ly = ptr.y;
  }
  ptr.turn *= 0.992;
  ptr.cx += (ptr.x - ptr.cx) * 0.1; ptr.cy += (ptr.y - ptr.cy) * 0.1;
  if (!ptr.swirling && Math.abs(ptr.turn) > 2.4) ptr.swirling = true;
  else if (ptr.swirling && Math.abs(ptr.turn) < 0.8) ptr.swirling = false;
});
function release(e) {
  if (!ptrs.delete(e.pointerId) || !ptr) return;
  if (ptrs.size === 0) {
    const moved = ptr.mode === 'one' ? Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0) : 0;
    if (moved > 0.08 || ptr.t > 0.4) sfx.boing();
    ptr = null;
  } else {                                              // 2本→1本：残った指で改めて始める
    const [id, q] = ptrs.entries().next().value;
    startOne(id, q.x, q.y);
  }
}
glc.addEventListener('pointerup', release);
glc.addEventListener('pointercancel', release);
glc.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- 物理 ---------- */
function step(dt, now) {
  const held = !!ptr && !sleeping;
  if (held) ptr.t += dt;
  const k = held ? 170 : 80, c = held ? 20 : 3.2;
  // 場のパラメータ：fx,fy=引っ張り量／A=ふくらみ(+)・ぎゅー(-)／S=ねじれ角
  let fx = 0, fy = 0, A = 0, S = 0, cx = 0, cy = 0, sig = 0.17;
  if (held && ptr.mode === 'one') {
    cx = ptr.x0; cy = ptr.y0;
    if (ptr.swirling) { cx = ptr.cx; cy = ptr.cy; S = Math.max(-5, Math.min(5, ptr.turn * 0.7)); sig = 0.2; }
    else if (!ptr.still) { fx = ptr.x - ptr.x0; fy = ptr.y - ptr.y0; }
    else if (ptr.t > 0.2) { A = Math.min(1.1, 0.3 + (ptr.t - 0.2) * 0.9); sig = 0.15; }
  } else if (held && ptr.mode === 'two') {
    cx = ptr.mx; cy = ptr.my; sig = Math.max(0.14, Math.min(0.3, ptr.d0 * 0.9));
    fx = ptr.mx - ptr.mx0; fy = ptr.my - ptr.my0;
    A = Math.max(-0.8, Math.min(1.1, (ptr.d / ptr.d0 - 1) * 1.8));
    S = Math.max(-5, Math.min(5, ptr.aAcc * 1.5));
  }
  const active = held && (fx || fy || A || S);
  const s2 = 2 * sig * sig, cut = 9 * sig * sig;
  for (let i = 0; i < V; i++) {
    const rx = rest[2 * i], ry = rest[2 * i + 1];
    let tx = 0, ty = 0;
    if (big) { tx = (rx - 0.5) * 0.3; ty = (ry - 0.5) * 0.3; }
    if (active) {
      const dx = rx - cx, dy = ry - cy, r2 = dx * dx + dy * dy;
      if (r2 < cut) {
        const f = Math.exp(-r2 / s2);
        tx += fx * f + dx * A * f; ty += fy * f + dy * A * f;
        if (S) {
          const th = S * f, co = Math.cos(th), si = Math.sin(th);
          tx += dx * co - dy * si - dx; ty += dx * si + dy * co - dy;
        }
      }
    }
    for (let q = 0; q < 2; q++) {
      const j = 2 * i + q, target = q ? ty : tx;
      vel[j] += (k * (target - disp[j]) - c * vel[j]) * dt;
      disp[j] += vel[j] * dt;
    }
  }
}

function draw(now) {
  for (let i = 0; i < V * 2; i++) pos[i] = rest[i] + disp[i];
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
  let r = 1, g = 1, b = 1;
  if (now < starUntil) {                // きらきら：虹色にゆれる
    const t = now / 1000;
    r = 1 + 0.22 * Math.sin(t * 7); g = 1 + 0.22 * Math.sin(t * 7 + 2.1); b = 1 + 0.22 * Math.sin(t * 7 + 4.2);
  }
  if (sleeping) { r *= 0.55; g *= 0.6; b *= 0.8; }
  gl.uniform3f(uTint, r, g, b);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, N * N * 6, gl.UNSIGNED_SHORT, 0);
}

/* ---------- オーバーレイ（パーティクル・手・文字） ---------- */
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
function drawOverlay(now, dt) {
  const W = ovc.width;
  octx.clearRect(0, 0, W, W);
  octx.textAlign = 'center'; octx.textBaseline = 'middle';

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life += dt;
    if (p.life > p.max) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.5 * dt;
    octx.globalAlpha = 1 - p.life / p.max;
    octx.font = Math.round(p.size * W) + 'px ' + EMOJI;
    octx.fillText(p.ch, p.x * W, p.y * W);
  }
  octx.globalAlpha = 1;

  if (baa) {
    const t = (now - baa.t0) / 1000;
    let off;                                                    // 手の中心からの距離(幅比)
    if (t < 0.5) off = 0.7 - 0.56 * ease(t / 0.5);
    else if (t < 1.6) off = 0.14 + Math.sin(t * 40) * 0.005;
    else off = 0.14 + 0.62 * ease((t - 1.6) / 0.4);
    if (t >= 1.6 && !baa.fired) {
      baa.fired = true; sfx.baa(); impulse(0.5, 0.5, 0.3, 2.6); burst('⭐', 8, 0.5, 0.5, 0.12); burst('✨', 8, 0.5, 0.5, 0.1);
    }
    if (t < 2.0) {
      octx.font = Math.round(W * 0.55) + 'px ' + EMOJI;
      octx.save(); octx.translate((0.5 - off) * W, 0.5 * W); octx.rotate(0.15); octx.fillText('✋', 0, 0); octx.restore();
      octx.save(); octx.translate((0.5 + off) * W, 0.5 * W); octx.rotate(-0.15); octx.scale(-1, 1); octx.fillText('✋', 0, 0); octx.restore();
    }
    if (t >= 1.6 && t < 2.8) {
      const s = 0.6 + 0.4 * ease((t - 1.6) / 0.25);
      octx.globalAlpha = t > 2.4 ? 1 - (t - 2.4) / 0.4 : 1;
      octx.font = 'bold ' + Math.round(W * 0.2 * s) + 'px sans-serif';
      octx.lineWidth = W * 0.02; octx.strokeStyle = '#fff'; octx.fillStyle = '#ff5c8a';
      octx.strokeText('ばあ！', W * 0.5, W * 0.18); octx.fillText('ばあ！', W * 0.5, W * 0.18);
      octx.globalAlpha = 1;
    }
    if (t >= 2.8) baa = null;
  }

  if (sleeping) {
    const s = (now - sleepAt) / 1000;
    octx.font = Math.round(W * 0.12) + 'px ' + EMOJI;
    for (let i = 0; i < 3; i++) {
      const u = ((s * 0.35 + i / 3) % 1);
      octx.globalAlpha = Math.sin(u * Math.PI);
      octx.fillText('💤', W * (0.62 + u * 0.18), W * (0.35 - u * 0.2));
    }
    octx.globalAlpha = 1;
  }
}

/* ---------- アクション ---------- */
$('actMush').addEventListener('click', () => {
  big = !big; $('actMush').classList.toggle('on', big);
  if (big) { sfx.grow(); burst('🍄', 5, 0.5, 0.5, 0.1); impulse(0.5, 0.5, 0.35, 1.8); }
  else { sfx.boing(); impulse(0.5, 0.5, 0.35, -1.5); }
});
$('actStar').addEventListener('click', () => {
  starUntil = performance.now() + 3500; sfx.star();
  burst('⭐', 10, 0.5, 0.5, 0.11); burst('✨', 10, 0.5, 0.5, 0.09); impulse(0.5, 0.5, 0.35, 1.2);
});
$('actBaa').addEventListener('click', () => {
  if (baa || sleeping) return;
  baa = { t0: performance.now(), fired: false }; sfx.hands();
});

/* ---------- おやすみ ---------- */
function fallAsleep(now) {
  sleeping = true; sleepAt = now; ptr = null; ptrs.clear(); baa = null;
  $('sleep').hidden = false; $('wake').disabled = true;
  $('wake').textContent = 'おきる (' + WAKE_WAIT + ')';
}
function sleepTick(now) {
  if (!sleeping) return;
  const left = Math.ceil(WAKE_WAIT - (now - sleepAt) / 1000);
  if (left > 0) $('wake').textContent = 'おきる (' + left + ')';
  else { $('wake').disabled = false; $('wake').textContent = 'おきる'; }
}
$('wake').addEventListener('click', () => {
  sleeping = false; playMs = 0; $('sleep').hidden = true; sfx.star();
  burst('☀️', 4, 0.5, 0.4, 0.12);
});

/* ---------- ほぞん ---------- */
$('save').addEventListener('click', () => {
  const c = document.createElement('canvas'); c.width = c.height = glc.width;
  const g = c.getContext('2d'); g.drawImage(glc, 0, 0); g.drawImage(ovc, 0, 0);
  c.toBlob(async (blob) => {
    if (!blob) { toast('ほぞんできませんでした'); return; }
    const file = new File([blob], 'kaoasobi.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'kaoasobi_' + Date.now() + '.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('しゃしんを ほぞんしました');
  }, 'image/png');
});

/* ---------- ボタン配線 ---------- */
$('btnCam').addEventListener('click', () => { audio(); show('cam'); startCam(); });
$('btnPick').addEventListener('click', () => $('file').click());
$('camPick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; loadFile(f); });
$('btnResume').addEventListener('click', () => { audio(); resumeLast(); });
$('camBack').addEventListener('click', () => { stopCam(); refreshHome(); show('home'); });
$('camFlip').addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; startCam(); });
$('shutter').addEventListener('click', shoot);
$('back').addEventListener('click', () => { refreshHome(); show('home'); });

function openSettings() {
  $('optSleep').checked = sleepOn; $('optSound').checked = soundOn; $('settings').hidden = false;
}
$('gearHome').addEventListener('click', openSettings);
$('gearPlay').addEventListener('click', openSettings);
$('closeSet').addEventListener('click', () => { $('settings').hidden = true; });
$('optSleep').addEventListener('change', (e) => { sleepOn = e.target.checked; store.set(LS.sleep, sleepOn ? '1' : '0'); playMs = 0; });
$('optSound').addEventListener('change', (e) => { soundOn = e.target.checked; store.set(LS.sound, soundOn ? '1' : '0'); });
$('delPhoto').addEventListener('click', () => { store.del(LS.last); refreshHome(); toast('けしました'); });

/* ---------- メインループ ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (!playing || !glOK) return;
  const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
  if (!$('settings').hidden) return;
  step(dt, now); draw(now); drawOverlay(now, dt);
  if (sleepOn && !sleeping) { playMs += dt * 1000; if (playMs >= SLEEP_MS) fallAsleep(now); }
  sleepTick(now);
}
requestAnimationFrame(frame);

refreshHome();
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも動く */ });
}
