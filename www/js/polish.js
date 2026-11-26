// polish.js: the polishing mini-game ("Whetstone strokes") and its result screen.
// Design: docs/redesign/02-polishing.md. Contract: docs/redesign/05-implementation.md section 8.3.
//
// window.PolishUI = { open(el, o), showResult(el, out), close() }
//   open       fills the empty div `el` with the game. Resolves { samples } when the player finishes, or null on cancel.
//   showResult shows the server's answer in the same div with a Continue button. Resolves on Continue.
//   close      ends whatever is open (open resolves null, showResult resolves). The div is left empty.
//
// This file never saves anything, never talks to the server and never makes sound itself: it only calls o.sfx(event, value).
// The scoring itself lives in rules.js (window.AMR), so what the player sees wiping away is exactly what the server counts.
(function () {
  'use strict';

  // ------------------------------------------------------------------ small helpers
  const AMR = () => window.AMR;                       // read at call time, never at load time
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // A fixed "random" number 0..1 from up to three whole numbers. Same input, same output: used so dither
  // pixels and scratch lines stay where they are from frame to frame.
  function hash(a, b, c) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul((c | 0) + 7, 1013904223);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16) || 0);
  const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a === undefined ? 1 : a})`;
  const coins = (n) => Math.round(n).toLocaleString('en-US') + 'c';
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Colours from the design (02 section 8)
  const COL = {
    bg: '#1b1816',
    grime: [rgb('#4a3b2a'), rgb('#5c4a30')],
    rust: [rgb('#7a3f1e'), rgb('#8f5226')],
    stain: [rgb('#5a3818'), rgb('#6e4520')],
    scratch: rgb('#e9e4da'),
    orange: rgb('#ff9a3a'),
    red: rgb('#ff3b2b'),
    outline: rgb('#141110'),
  };
  const METER_MAX = 2.5;                              // the speed meter runs 0..2.5 tracks a second
  const SCRATCH_SEEN = 0.02;                          // a strip shows a scratch line for every 0.02 scratch

  // ------------------------------------------------------------------ styles (injected once, every class starts with pui-)
  const CSS = `
.pui{max-width:720px;margin:0 auto;color:var(--ash);font:400 16px/1.4 var(--body);user-select:none;-webkit-user-select:none}
.pui-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px}
.pui-title{font-weight:700;font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pui-time{color:var(--mute);font-size:15px;white-space:nowrap}
.pui-tbar{height:6px;background:#1c1917;border:2px solid var(--ink,#141110);margin-bottom:8px}
.pui-tbar i{display:block;height:100%;width:100%;background:var(--straw)}
.pui-tbar.low i{background:var(--red)}
.pui-stage{position:relative;border:3px solid var(--ink,#141110);box-shadow:inset 3px 3px 0 rgba(255,255,255,.06),inset -3px -3px 0 rgba(0,0,0,.3);background:#1b1816;overflow:hidden}
.pui-cv{display:block;width:100%;height:180px;image-rendering:pixelated;image-rendering:crisp-edges;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;cursor:grab}
.pui-cv.down{cursor:grabbing}
.pui-hint{position:absolute;left:0;right:0;bottom:8px;text-align:center;pointer-events:none;color:var(--straw);font-size:15px;text-shadow:0 2px 0 #000}
.pui-hint.gone{display:none}
.pui-meter{position:relative;height:16px;margin:10px 0 2px;background:#1c1917;border:2px solid var(--ink,#141110);display:flex}
.pui-meter b{display:block;height:100%}
.pui-zslow{background:#4b453e}.pui-zgood{background:var(--verd)}.pui-zfast{background:var(--red);flex:1}
.pui-needle{position:absolute;top:-5px;bottom:-5px;width:4px;margin-left:-2px;background:var(--ash);box-shadow:0 0 0 2px var(--ink,#141110)}
.pui-mlab{display:flex;justify-content:space-between;font-size:13px;color:var(--dim)}
.pui-mlab span.on{color:var(--ash);font-weight:700}
.pui-mlab span.on.fast{color:var(--red)}
.pui-mlab span.on.good{color:var(--verd)}
.pui-row{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;margin-top:10px}
.pui-stat{font-size:17px}.pui-stat b{font-weight:700}
.pui-stat.bad b{color:var(--red)}
.pui-btns{margin-left:auto;display:flex;gap:8px}
.pui-btn{background:var(--plate2);color:var(--ash);border:3px solid var(--ink,#141110);box-shadow:inset 3px 3px 0 rgba(255,255,255,.12),inset -3px -3px 0 rgba(0,0,0,.3);padding:8px 16px;font:600 15px/1.2 var(--body);cursor:pointer;min-height:44px}
.pui-btn:hover{filter:brightness(1.12)}
.pui-btn:active:not(:disabled){transform:translateY(2px)}
.pui-btn:disabled{opacity:.4;cursor:not-allowed}
.pui-btn.go{background:var(--straw);color:#2a2018;box-shadow:inset 3px 3px 0 #fbe7a1,inset -3px -3px 0 #a8742c}
.pui-btn.ghost{background:rgba(0,0,0,.18)}
.pui-btn[data-armed]{color:#ffbcb0;background:rgba(224,101,79,.18);border-color:var(--red)}
.pui-res{text-align:center}
.pui-res .pui-stage{margin-bottom:12px}
.pui-line{color:var(--mute);font-size:15px;margin:2px 0 10px}
.pui-qwrap{position:relative;height:22px;background:#1c1917;border:3px solid var(--ink,#141110);margin:0 0 4px}
.pui-qfill{height:100%;width:0;background:var(--straw)}
.pui-qtick{position:absolute;top:0;bottom:0;width:2px;background:rgba(0,0,0,.55)}
.pui-qnum{position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:14px;font-weight:700;text-shadow:0 1px 0 #000}
.pui-qnum.dark{color:#1b1816;text-shadow:none}
.pui-qlab{display:grid;grid-template-columns:repeat(4,1fr);text-align:center;font-size:12px;color:var(--dim);margin-bottom:10px}
.pui-name{font:400 34px/1.1 var(--display);margin:6px 0 2px;min-height:38px;visibility:hidden}
.pui-worth{font-size:18px;min-height:26px;visibility:hidden}
.pui-worth b{font-weight:700}
.pui-worth .down{color:var(--red)}.pui-worth .up{color:var(--verd)}
.pui-flav{color:var(--mute);font-size:14px;min-height:20px;visibility:hidden}
.pui-show{visibility:visible}
.pui-badge{display:inline-block;border:2px solid #9ef0ff;color:#e8fbff;padding:0 8px;font:700 14px/1.6 var(--body);margin-left:6px;vertical-align:middle;background:rgba(158,240,255,.12)}
.pui-res .pui-btns{margin:14px auto 0;justify-content:center}
.pui-flash{position:absolute;inset:0;background:#fff;pointer-events:none;opacity:0;animation:pui-flash .7s ease-out}
@keyframes pui-flash{0%{opacity:0}15%{opacity:.55}100%{opacity:0}}
@media (max-width:560px){.pui-name{font-size:28px}.pui-stat{font-size:16px}.pui-btn{padding:8px 12px}}
@media (prefers-reduced-motion:reduce){.pui-flash{display:none}}
`;
  function injectCss() {
    if (document.getElementById('pui-css')) return;
    const s = document.createElement('style'); s.id = 'pui-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ the blade picture
  // Loads o.img (a data URL of the rack sprite: grip left, point right) and trims the transparent border.
  // Resolves { cv, w, h } (the trimmed sprite) or null (no picture, or it failed to load: we draw a plain bar).
  function loadPicture(src) {
    if (!src) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth, H = img.naturalHeight;
          if (!W || !H) return resolve(null);
          const c = document.createElement('canvas'); c.width = W; c.height = H;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0);
          const p = x.getImageData(0, 0, W, H).data;
          let x0 = W, y0 = H, x1 = -1, y1 = -1;                  // the box around the opaque pixels
          for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
            if (p[(y * W + i) * 4 + 3] >= 120) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          if (x1 < 0) return resolve(null);
          const w = x1 - x0 + 1, hh = y1 - y0 + 1, t = document.createElement('canvas'); t.width = w; t.height = hh;
          t.getContext('2d').drawImage(c, x0, y0, w, hh, 0, 0, w, hh);
          resolve({ cv: t, w, h: hh });
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // A Scene owns one canvas: it lays the blade over track 50..950 and draws grime, shine, scratches and the stone.
  // The canvas works in "art pixels" (a small bitmap) and CSS scales it up with image-rendering: pixelated.
  function Scene(cv, opt) {
    const R = AMR(), P = R.POLISH;
    const sc = { cv, ctx: cv.getContext('2d'), pic: null, W: 0, H: 0, cssW: 0, ready: false, opt };
    const ov = document.createElement('canvas'), octx = ov.getContext('2d');   // the grime overlay
    let odata = null;

    // Work out the art size from the canvas's CSS width, then draw the clean blade once into an offscreen canvas.
    sc.layout = function () {
      const cssW = Math.max(1, Math.round(cv.getBoundingClientRect().width || cv.clientWidth || 320));
      const cssH = cssW < 560 ? 140 : 180;
      sc.cssW = cssW; cv.style.height = cssH + 'px';
      let W = Math.round(cssW / (cssW < 560 ? 2 : 3));
      if (sc.pic) {                                 // if the sprite's own pixel size fits nicely, use it: crisper art
        const nat = Math.round(sc.pic.w / ((P.B - P.A) / 1000)), k = cssW / nat;
        if (k >= 1.5 && k <= 5) W = nat;
      }
      const H = Math.max(30, Math.round(W * cssH / cssW));
      sc.W = W; sc.H = H; cv.width = W; cv.height = H; ov.width = W; ov.height = H;
      sc.scale = cssW / W;                          // CSS pixels per art pixel
      odata = octx.createImageData(W, H);
      buildBlade();
      sc.ready = true;
    };

    function buildBlade() {
      const W = sc.W, H = sc.H, b = document.createElement('canvas'); b.width = W; b.height = H;
      const x = b.getContext('2d'); x.imageSmoothingEnabled = false;
      const x0 = Math.round(P.A / 1000 * W), x1 = Math.round(P.B / 1000 * W), span = x1 - x0;
      let dh;
      if (sc.pic) {                                 // the rack sprite, stretched over the steel span
        dh = clamp(Math.round(sc.pic.h * span / sc.pic.w), 3, Math.round(H * 0.5));
        const y0 = Math.round((H - dh) / 2);
        x.drawImage(sc.pic.cv, 0, 0, sc.pic.w, sc.pic.h, x0, y0, span, dh);
      } else {                                      // no picture: a plain grey steel bar with a grip and a point
        dh = Math.max(5, Math.round(H * 0.24));
        const mid = Math.round(H / 2), gx = x0 + Math.round(span * 0.14);
        x.fillStyle = '#5a3826'; x.fillRect(x0, mid - Math.round(dh * 0.3), gx - x0, Math.round(dh * 0.6));
        x.fillStyle = '#7a5236'; x.fillRect(x0, mid - Math.round(dh * 0.3), gx - x0, 1);
        x.fillStyle = '#b9773f'; x.fillRect(gx, mid - Math.round(dh / 2) - 2, 2, dh + 4);
        for (let i = gx + 2; i < x1; i++) {         // the blade, tapering to a point over the last dh pixels
          const taper = i > x1 - dh ? (x1 - i) / dh : 1, hh = Math.max(1, Math.round(dh * taper));
          const top = mid - Math.round(dh / 2);
          x.fillStyle = '#a9adb2'; x.fillRect(i, top, 1, hh);
          x.fillStyle = '#d8dadc'; x.fillRect(i, top, 1, 1);
          if (hh > 2) { x.fillStyle = '#7d8288'; x.fillRect(i, top + hh - 1, 1, 1); }
        }
      }
      sc.blade = b; sc.x0 = x0; sc.x1 = x1;
      // the mask: which art pixels are blade, and the top/bottom of the blade in each column
      const p = x.getImageData(0, 0, W, H).data, mask = new Uint8Array(W * H);
      const top = new Int16Array(W).fill(-1), bot = new Int16Array(W).fill(-1);
      let ymin = H, ymax = 0;
      for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
        if (p[(y * W + i) * 4 + 3] < 120) continue;
        mask[y * W + i] = 1; if (top[i] < 0) top[i] = y; bot[i] = y;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      }
      sc.mask = mask; sc.top = top; sc.bot = bot; sc.ymin = ymin; sc.ymax = ymax;
      // One entry per blade pixel inside the steel: which strips it sits between, and its fixed random thresholds.
      const segW = (P.B - P.A) / P.SEG, idx = [], si = [], sf = [], thr = [], rth = [], shade = [];
      for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
        if (!mask[y * W + i]) continue;
        const tx = (i + 0.5) / W * 1000;
        if (tx < P.A || tx >= P.B) continue;
        const u = (tx - P.A) / segW - 0.5, k = Math.floor(u);   // between strip k and k+1 (smooth edges)
        idx.push(y * W + i); si.push(k); sf.push(u - k);
        thr.push(hash(i, y, 1)); rth.push(hash(i, y, 2)); shade.push(hash(i, y, 3) < 0.5 ? 0 : 1);
      }
      sc.px = { idx, si, sf, thr, rth, shade, n: idx.length };
    }

    // How much of strip i is still dirty, 0 (clean) .. 1 (as dirty as at the start)
    const ratio = (st, i) => { i = clamp(i, 0, P.SEG - 1); return st.t0[i] > 0 ? st.t[i] / st.t0[i] : 0; };
    const stripX = (i) => sc.x0 + (i + 0.5) * (sc.x1 - sc.x0) / P.SEG;    // art x of a strip's middle

    // Draw one frame. st = the polish state from AMR.polishInit / polishTick. f = extras:
    //   { stoneX, stoneUp, stoneY, over, glint, drops, stain: {k, r}, sweep, sparkle, t }
    sc.draw = function (st, f) {
      const ctx = sc.ctx, W = sc.W, H = sc.H;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
      if (!sc.ready) return;
      ctx.fillStyle = 'rgba(0,0,0,.2)';                        // a faint groove along the track the stone runs on
      ctx.fillRect(0, sc.ymin - 2, W, sc.ymax - sc.ymin + 5);
      ctx.drawImage(sc.blade, 0, 0);
      const SEG = P.SEG, r = new Array(SEG + 2), spot = new Array(SEG + 2);
      for (let i = -1; i <= SEG; i++) {                        // per strip: dirt left, and how much was rust
        r[i + 1] = ratio(st, i);
        const t0 = st.t0[clamp(i, 0, SEG - 1)];
        spot[i + 1] = clamp((t0 - P.GRIME) / (P.SPOT[0] + P.SPOT[1]), 0, 1);
      }
      // shine: a soft white highlight along the spine of clean steel
      for (let i = sc.x0; i < sc.x1; i++) {
        if (sc.top[i] < 0) continue;
        const k = Math.floor(((i + 0.5) / W * 1000 - P.A) / ((P.B - P.A) / SEG));
        const cl = clamp((0.4 - r[clamp(k, 0, SEG - 1) + 1]) / 0.4, 0, 1);
        if (cl <= 0) continue;
        ctx.fillStyle = `rgba(255,255,255,${(0.42 * cl).toFixed(3)})`;
        ctx.fillRect(i, sc.top[i] + 1, 1, 1);
      }
      // grime: each pixel shows while the dirt left is above its own random threshold (the scratch-off look)
      const d = odata.data; d.fill(0);
      const px = sc.px;
      for (let n = 0; n < px.n; n++) {
        const a = px.si[n] + 1, fr = px.sf[n];
        const left = r[a] + (r[a + 1] - r[a]) * fr;           // dirt left here, blended between two strips
        if (left <= 0.03 + 0.97 * px.thr[n]) continue;          // 3% or less left counts as clean: nothing shows
        const sp = spot[a] + (spot[a + 1] - spot[a]) * fr;
        const c = (px.rth[n] < sp * 1.15 ? COL.rust : COL.grime)[px.shade[n]];
        const o = px.idx[n] * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
      // a stain (result screen only): a brown blotch growing from one strip
      if (f && f.stain) {
        const cx = stripX(f.stain.k), cy = (sc.ymin + sc.ymax) / 2;
        for (let n = 0; n < px.n; n++) {
          const i = px.idx[n] % W, y = (px.idx[n] / W) | 0;
          const dist = Math.abs(i - cx) * 0.8 + Math.abs(y - cy) * 1.6 + px.thr[n] * 4;
          if (dist > f.stain.r) continue;
          const c = COL.stain[px.shade[n]], o = px.idx[n] * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 235;
        }
      }
      octx.putImageData(odata, 0, 0);
      ctx.drawImage(ov, 0, 0);
      // scratches: thin bright diagonal lines, min(6, scratch / 0.02) per strip, always in the same places
      ctx.fillStyle = rgba(COL.scratch, 0.9);
      const segPx = (sc.x1 - sc.x0) / SEG;
      for (let s = 0; s < SEG; s++) {
        const n = Math.min(6, Math.floor(st.scr[s] / SCRATCH_SEEN));
        for (let k = 0; k < n; k++) {
          const sx = Math.floor(sc.x0 + (s + hash(s, k, 7)) * segPx);
          if (sx < 0 || sx >= W || sc.top[sx] < 0) continue;
          const span = sc.bot[sx] - sc.top[sx];
          const sy = sc.top[sx] + 1 + Math.floor(hash(s, k, 11) * Math.max(1, span - 2));
          const len = 3 + Math.floor(hash(s, k, 13) * 3), dir = hash(s, k, 17) < 0.5 ? 1 : -1;
          for (let j = 0; j < len; j++) {
            const xx = sx + j * dir, yy = sy + j;
            if (xx >= 0 && xx < W && yy < H && sc.mask[yy * W + xx]) ctx.fillRect(xx, yy, 1, 1);
          }
        }
      }
      if (!f) return;
      // Mirror polish: a white glint sweeping the whole blade, and sparkles
      if (f.sweep != null) {
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        const sw = f.sweep * (W + H) - H * 0.6;
        for (let n = 0; n < px.n; n++) {
          const i = px.idx[n] % W, y = (px.idx[n] / W) | 0;
          if (Math.abs(i - y * 0.6 - sw) < 2.5) ctx.fillRect(i, y, 1, 1);
        }
      }
      if (f.sparkle) drawSparkles(ctx, f.t || 0, f.still);
      // the glint that follows the stone across clean steel
      if (f.glint && f.stoneX != null) {
        const gx = Math.round(f.stoneX / 1000 * W), k = R.polishStrip(clamp(f.stoneX, P.A, P.B - 1));
        const cl = clamp((0.4 - ratio(st, k)) / 0.4, 0, 1);
        if (cl > 0) for (let i = gx - 4; i <= gx + 4; i++) {
          if (i < 0 || i >= W || sc.top[i] < 0) continue;
          ctx.fillStyle = `rgba(255,255,255,${(0.9 * cl * (1 - Math.abs(i - gx) / 5)).toFixed(3)})`;
          ctx.fillRect(i, sc.top[i] + 1, 1, 1);
        }
      }
      // liquid droplets trailing the stone
      if (f.drops) for (const p of f.drops) {
        ctx.fillStyle = p.fizz ? (((f.t / 60) | 0) % 2 ? '#f2ffd0' : rgba(p.c, 0.6)) : rgba(p.c, clamp(p.life * 2, 0, 0.9));
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      if (f.stoneX != null) drawStone(ctx, f);
    };

    // The stone: a small 12 x 7 block in the stone's colour, turning orange then red when going too fast.
    function drawStone(ctx, f) {
      const sw = 12, shh = 7, W = sc.W;
      const cx = Math.round(f.stoneX / 1000 * W), mid = Math.round((sc.ymin + sc.ymax) / 2);
      let y = mid - Math.floor(shh / 2);
      if (f.stoneY != null) y = clamp(Math.round(f.stoneY) - Math.floor(shh / 2), 1, sc.H - shh - 1);
      const x = cx - sw / 2;
      const stones = R.STONES || [], st = stones[opt.stone] || stones[0] || {};
      let base = rgb(st.c || '#9a9288');
      const ov = clamp(f.over || 0, 0, 1);
      if (ov > 0) base = ov < 0.5 ? mix(base, COL.orange, ov * 2) : mix(COL.orange, COL.red, (ov - 0.5) * 2);
      const a = f.stoneUp ? 0.55 : 1;                           // a lifted stone is drawn faded
      if (f.stoneY != null && !f.stoneUp) {                     // touch: the stone floats above the finger, a dotted line shows where it touches
        ctx.fillStyle = 'rgba(233,228,218,.35)';
        for (let yy = y + shh + 1; yy < mid; yy += 2) ctx.fillRect(cx, yy, 1, 1);
      }
      if (ov > 0 && !f.stoneUp) { ctx.fillStyle = rgba(COL.red, 0.35 * ov); ctx.fillRect(x - 2, y - 2, sw + 4, shh + 4); }
      ctx.fillStyle = rgba(COL.outline, a); ctx.fillRect(x - 1, y - 1, sw + 2, shh + 2);
      ctx.fillStyle = rgba(base, a); ctx.fillRect(x, y, sw, shh);
      ctx.fillStyle = rgba(mix(base, [255, 255, 255], 0.35), a); ctx.fillRect(x, y, sw, 1); ctx.fillRect(x, y, 1, shh);
      ctx.fillStyle = rgba(mix(base, [0, 0, 0], 0.35), a); ctx.fillRect(x, y + shh - 1, sw, 1); ctx.fillRect(x + sw - 1, y, 1, shh);
      ctx.fillStyle = rgba(mix(base, [0, 0, 0], 0.18), a);      // a little grain in the stone
      for (let k = 0; k < 5; k++) ctx.fillRect(x + 2 + Math.floor(hash(opt.stone, k, 3) * (sw - 4)), y + 2 + Math.floor(hash(opt.stone, k, 5) * (shh - 4)), 1, 1);
      if (opt.stone >= 3 && ((f.t / 400) | 0) % 3 === 0) {     // Moonstone and Starstone twinkle
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 2, y + 2, 3, 1); ctx.fillRect(x + 3, y + 1, 1, 3);
      }
    }

    // Sparkles for a Mirror polish: little 4-pointed stars that twinkle around the blade
    function drawSparkles(ctx, t, still) {
      for (let k = 0; k < 9; k++) {
        const x = Math.round(sc.x0 + hash(k, 1, 9) * (sc.x1 - sc.x0));
        const y = Math.round(sc.ymin - 3 + hash(k, 2, 9) * (sc.ymax - sc.ymin + 6));
        const ph = still ? 0.8 : (Math.sin(t / 260 + k * 1.7) + 1) / 2;
        if (ph < 0.25) continue;
        const c = k % 3 ? '255,255,255' : '158,240,255';
        ctx.fillStyle = `rgba(${c},${ph.toFixed(2)})`;
        ctx.fillRect(x, y, 1, 1);
        if (ph > 0.55) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
        if (ph > 0.85) { ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x, y - 2, 1, 5); }
      }
    }
    return sc;
  }

  // ------------------------------------------------------------------ what is open right now
  let cur = null;          // { end(value) } for the open game or result screen
  let memo = null;         // the last game's picture, state and sfx, so the result screen shows the same blade

  function close() { if (cur) cur.end(); }

  // ------------------------------------------------------------------ open: the mini-game
  function open(el, o) {
    close();                                                     // only one thing open at a time
    injectCss();
    o = o || {};
    const R = AMR(), P = R.POLISH;
    const sfx = (ev, v) => { try { if (typeof o.sfx === 'function') o.sfx(ev, v); } catch (e) { /* a sound bug must never break the game */ } };
    const liq = R.LIQUIDS[o.liq] ? o.liq : 'spring';
    const LIMIT = P.MAX_TICKS + 1;                               // 401 samples at most: the first press + 400 ticks

    // ---- the page
    const root = h('div', 'pui');
    const top = h('div', 'pui-top'), title = h('div', 'pui-title', o.title || 'Polish'), timeTxt = h('div', 'pui-time');
    top.append(title, timeTxt);
    const tbar = h('div', 'pui-tbar'), tfill = h('i'); tbar.appendChild(tfill);
    const stage = h('div', 'pui-stage'), cv = h('canvas', 'pui-cv');
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'The blade. Press and rub the stone left and right to polish it.');
    const hint = h('div', 'pui-hint', 'Press and rub the stone along the blade');
    stage.append(cv, hint);
    const meter = h('div', 'pui-meter'), zSlow = h('b', 'pui-zslow'), zGood = h('b', 'pui-zgood'), zFast = h('b', 'pui-zfast'), needle = h('i', 'pui-needle');
    meter.append(zSlow, zGood, zFast, needle);
    const mlab = h('div', 'pui-mlab'), lSlow = h('span', 'slow', 'Too slow'), lGood = h('span', 'good', 'Good'), lFast = h('span', 'fast', 'Too fast!');
    mlab.append(lSlow, lGood, lFast);
    const row = h('div', 'pui-row');
    const cleanTxt = h('div', 'pui-stat pui-clean'), scrTxt = h('div', 'pui-stat pui-scr');
    const btns = h('div', 'pui-btns');
    const bCancel = h('button', 'pui-btn ghost', 'Cancel'), bDone = h('button', 'pui-btn go', 'Done');
    bCancel.type = 'button'; bDone.type = 'button';
    btns.append(bCancel, bDone);
    row.append(cleanTxt, scrTxt, btns);
    root.append(top, tbar, stage, meter, mlab, row);
    el.replaceChildren(root);

    // ---- the game state (like F for the forge)
    const S = {
      st: R.polishInit(o.seed >>> 0), fx: R.polishFx(liq),
      samples: [], started: false, ended: false,
      x: 500, down: false, pid: null, touchY: null,             // the stone: track position 0..1000, pressed or not
      acc: 0, last: 0, speed: 0, over: 0, glow: 0,
      cleanStrip: new Array(P.SEG).fill(false), drops: [], lastScrape: -1e9, finishing: false,
    };
    const scene = Scene(cv, { stone: o.stone | 0 });
    const liqCol = rgb((R.LIQUIDS[liq] && R.LIQUIDS[liq].c) || '#9fd3ff');

    // ---- input: one pointer only, captured so the stone keeps moving (clamped) when it leaves the canvas
    const trackX = (e) => { const r = cv.getBoundingClientRect(); return clamp(Math.round((e.clientX - r.left) / r.width * 1000), 0, 1000); };
    const artY = (e) => { const r = cv.getBoundingClientRect(); return (e.clientY - r.top) / r.height * scene.H; };
    function onDown(e) {
      if (S.ended || S.finishing || S.pid !== null) return;
      if (e.button !== undefined && e.button > 0) return;      // left button / finger / pen only
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      S.pid = e.pointerId; S.down = true; S.x = trackX(e);
      S.touchY = e.pointerType === 'touch' ? artY(e) - 40 / (scene.scale || 1) : null;   // draw the stone 40 px above a finger
      cv.classList.add('down');
      if (!S.started) {                                          // the timer starts at the first press
        S.started = true; S.last = performance.now(); S.acc = 0;
        hint.classList.add('gone');
        pushSample();                                            // the first sample is where the first press landed
      }
    }
    function onMove(e) {
      if (S.pid === null) { if (e.pointerType === 'mouse' && !S.ended) S.x = trackX(e); return; }   // a hovering mouse moves the faded stone
      if (e.pointerId !== S.pid) return;
      e.preventDefault();
      S.x = trackX(e);
      if (e.pointerType === 'touch') S.touchY = artY(e) - 40 / (scene.scale || 1);
    }
    function onUp(e) {
      if (e.pointerId !== S.pid) return;
      lift();
    }
    function lift() {
      if (S.pid !== null) { try { cv.releasePointerCapture(S.pid); } catch (err) { /* already released */ } }
      S.pid = null; S.down = false; cv.classList.remove('down');
    }
    function onKey(e) {
      if (S.ended) return;
      if (e.key === 'Escape') { e.preventDefault(); end(null); }
      else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();                                      // don't scroll, don't press a focused button
        if (S.started && !e.repeat) finish();
      }
    }
    function onVis() { if (document.hidden) lift(); }            // hidden tab: the stone is lifted, -1 samples fill the gap on return
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('lostpointercapture', onUp);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', lift);
    document.addEventListener('visibilitychange', onVis);
    bDone.addEventListener('click', () => finish());
    let armT = 0;
    bCancel.addEventListener('click', () => {                   // Cancel asks once: the grit is already spent
      if (bCancel.hasAttribute('data-armed')) { end(null); return; }
      bCancel.setAttribute('data-armed', ''); bCancel.textContent = 'Give up? Grit is lost';
      clearTimeout(armT);
      armT = setTimeout(() => { bCancel.removeAttribute('data-armed'); bCancel.textContent = 'Cancel'; }, 2500);
    });

    // ---- one 50 ms tick: write a sample, then run exactly the rules' scoring on it
    function pushSample() {
      const s = S.samples;
      s.push(S.down ? clamp(Math.round(S.x), 0, 1000) : -1);
      const n = s.length;
      let over = 0;
      if (n >= 2) over = R.polishTick(S.st, n >= 3 ? s[n - 3] : -1, s[n - 2], s[n - 1], S.fx);
      // speed, the same two-tick average the rules use (0 when lifted or still)
      let v = 0;
      if (n >= 2 && s[n - 1] >= 0 && s[n - 2] >= 0 && s[n - 1] !== s[n - 2]) {
        const move = n >= 3 && s[n - 3] >= 0 ? (Math.abs(s[n - 1] - s[n - 2]) + Math.abs(s[n - 2] - s[n - 3])) / 2 : Math.abs(s[n - 1] - s[n - 2]);
        v = move / 50;
      }
      S.speed = v; S.over = over;
      sfx('rub', v);
      const now = performance.now();
      if (over > 0 && now - S.lastScrape >= 120) { S.lastScrape = now; sfx('scrape', over); }
      for (let i = 0; i < P.SEG; i++) {                          // a strip just came clean?
        const done = S.st.t0[i] > 0 && (1 - S.st.t[i] / S.st.t0[i]) / 0.97 >= 1;
        if (done && !S.cleanStrip[i]) { S.cleanStrip[i] = true; sfx('clean'); }
      }
    }

    // ---- the animation frame: the time accumulator writes one sample per 50 ms that passed
    let raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      if (S.started && !S.finishing && !S.ended) {
        S.acc += now - S.last; S.last = now;
        while (S.acc >= P.TICK && S.samples.length < LIMIT) { S.acc -= P.TICK; pushSample(); }
        const res = R.polishResult(S.st);
        if (res.clean >= 1) { sfx('done'); autoEnd(); }          // spotless: end early
        else if (S.samples.length >= LIMIT) autoEnd();           // 20 seconds are up
      }
      paint(now);
    }
    // A short pause on the finished blade before handing back the samples (the samples are already final).
    function autoEnd() {
      if (S.finishing) return;
      S.finishing = true; lift(); sfx('rub', 0);
      bDone.disabled = true; bCancel.disabled = true;
      setTimeout(() => finish(), 350);
    }

    // ---- drawing and read-outs
    function paint(now) {
      // droplets of the liquid trailing the stone
      const dt = Math.min(0.05, (now - (S.pt || now)) / 1000); S.pt = now;
      if (S.down && S.speed > 0 && scene.ready && Math.random() < 0.6) {
        const dir = S.samples.length >= 2 && S.samples[S.samples.length - 1] < S.samples[S.samples.length - 2] ? 1 : -1;
        const sx = S.x / 1000 * scene.W + dir * 6, sy = (scene.ymin + scene.ymax) / 2 + (Math.random() * 4 - 2);
        S.drops.push({ x: sx, y: sy, vx: dir * (6 + Math.random() * 10), vy: -4 - Math.random() * 6, life: 0.4 + Math.random() * 0.4, c: liqCol, fizz: liq === 'acid' && Math.random() < 0.12 });
      }
      for (const p of S.drops) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt; p.life -= dt; }
      S.drops = S.drops.filter((p) => p.life > 0).slice(-40);
      S.glow = Math.max(S.over, S.glow * 0.88);                 // the red glow fades out smoothly
      scene.draw(S.st, {
        stoneX: S.x, stoneUp: !S.down, stoneY: S.down && S.touchY != null ? S.touchY : null,
        over: S.glow, glint: S.down, drops: S.drops, t: now,
      });
      // time left
      const ticks = Math.max(0, S.samples.length - 1) + (S.started && !S.finishing ? S.acc / P.TICK : 0);
      const left = Math.max(0, (P.MAX_TICKS - ticks) * P.TICK / 1000);
      timeTxt.textContent = left.toFixed(1) + ' s';
      tfill.style.width = (left / (P.MAX_TICKS * P.TICK / 1000) * 100).toFixed(2) + '%';
      tbar.classList.toggle('low', left < 4);
      // clean and scratches
      const res = R.polishResult(S.st);
      cleanTxt.innerHTML = `Clean <b>${Math.floor(res.clean * 100)}%</b>`;
      cleanTxt.dataset.v = String(res.clean);                   // the exact number, for tests
      let scr = 0; for (let i = 0; i < P.SEG; i++) if (S.st.scr[i] >= SCRATCH_SEEN) scr++;
      scrTxt.innerHTML = `Scratches <b>${scr}</b>`;
      scrTxt.classList.toggle('bad', scr > 0);
      // the speed meter: grey up to 0.4, green up to the speed limit of the strip under the stone, red above
      let k = R.polishStrip(S.x);
      if (k < 0) k = S.x < P.A ? 0 : P.SEG - 1;                  // off the steel: use the nearest strip
      const lim = R.polishLimit(S.st, k);
      const pSlow = P.SLOW / METER_MAX * 100, pGood = clamp(lim / METER_MAX * 100, pSlow, 100);
      zSlow.style.width = pSlow + '%'; zGood.style.width = (pGood - pSlow) + '%';
      needle.style.left = clamp(S.speed / METER_MAX * 100, 0, 100) + '%';
      const zone = !S.down || S.speed <= 0 ? '' : S.speed < P.SLOW ? 'slow' : S.speed > lim ? 'fast' : 'good';
      lSlow.classList.toggle('on', zone === 'slow'); lGood.classList.toggle('on', zone === 'good'); lFast.classList.toggle('on', zone === 'fast');
    }

    // ---- sizing: follow the div's width (phones get a 140 px canvas, wider screens 180 px)
    let lastW = -1;
    function relayout() {
      const w = Math.round(cv.getBoundingClientRect().width);
      if (w === lastW || w <= 0) return;
      lastW = w; scene.layout();
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null;
    if (ro) ro.observe(stage); else window.addEventListener('resize', relayout);

    // ---- the end: hand back the samples (Done, Space, spotless or 20 s) or null (Cancel, Escape, close())
    let resolveFn;
    const promise = new Promise((res) => { resolveFn = res; });
    function finish() { if (!S.ended) end({ samples: S.samples.slice() }); }
    function end(value) {
      if (S.ended) return;
      S.ended = true;
      cancelAnimationFrame(raf); clearTimeout(armT);
      lift(); sfx('rub', 0);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', relayout);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', lift);
      document.removeEventListener('visibilitychange', onVis);
      memo = { pic: scene.pic, st: S.st, stone: o.stone | 0, seed: o.seed >>> 0, liq, sfx: o.sfx, title: o.title };
      el.replaceChildren();                                       // leave the div empty
      if (cur && cur.end === end) cur = null;
      resolveFn(value === undefined ? null : value);
    }
    cur = { end };

    // ---- go: lay out now (a plain bar until the picture loads), then swap in the sprite
    scene.layout(); lastW = Math.round(cv.getBoundingClientRect().width);
    raf = requestAnimationFrame(frame);
    loadPicture(o.img).then((pic) => {
      if (S.ended || !pic) return;
      scene.pic = pic; lastW = -1; relayout();
    });
    return promise;
  }

  // ------------------------------------------------------------------ showResult: the server's answer
  // out = { polish: {q, m, s, stone, liq, mirror?, stain?}, name, clean, finish, s, before, after }
  function showResult(el, out) {
    close();
    injectCss();
    out = out || {};
    const R = AMR(), P = R.POLISH;
    const pol = out.polish || {};
    const q = clamp(Math.round(+pol.q || 0), 0, 100), mirror = !!pol.mirror, stain = !!pol.stain;
    const m = +pol.m || 1, still = reducedMotion();
    const keep = memo; memo = null;
    const sfx = (ev, v) => { try { if (keep && typeof keep.sfx === 'function') keep.sfx(ev, v); } catch (e) { /* ignore */ } };
    const tier = mirror ? 4 : q >= 75 ? 3 : q >= 50 ? 2 : q >= 25 ? 1 : 0;   // Dull, Bright, Gleaming, Radiant, Mirror
    const tierCol = stain ? '#b07a45' : ['var(--mute)', 'var(--ash)', 'var(--straw)', '#f0c35a', '#e8fbff'][tier];
    const pct = (v) => Math.round(clamp(+v || 0, 0, 1) * 100) + '%';

    // ---- the page
    const root = h('div', 'pui pui-res');
    const top = h('div', 'pui-top'); top.appendChild(h('div', 'pui-title', (keep && keep.title) || 'Polished'));
    const stage = h('div', 'pui-stage'), cv = h('canvas', 'pui-cv');
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'The polished blade');
    cv.style.cursor = 'default';
    stage.appendChild(cv);
    const line = h('div', 'pui-line', `Clean ${pct(out.clean)} · Finish ${pct(out.finish)} · Skill ${(+out.s || +pol.s || 0).toFixed(2)}`);
    const qwrap = h('div', 'pui-qwrap'), qfill = h('div', 'pui-qfill'), qnum = h('span', 'pui-qnum', '0');
    qfill.style.background = stain ? '#6e4520' : tierCol;
    qwrap.appendChild(qfill);
    for (const t of [25, 50, 75]) { const k = h('i', 'pui-qtick'); k.style.left = t + '%'; qwrap.appendChild(k); }
    qwrap.appendChild(qnum);
    const qlab = h('div', 'pui-qlab');
    for (const t of ['Dull', 'Bright', 'Gleaming', 'Radiant']) qlab.appendChild(h('span', null, t));
    const name = h('div', 'pui-name', out.name || (stain ? 'Stained' : mirror ? 'Mirror polish' : 'Polished'));
    name.style.color = tierCol;
    if (mirror) name.appendChild(h('span', 'pui-badge', '✦ Mirror'));
    const worth = h('div', 'pui-worth');
    worth.appendChild(document.createTextNode('Worth '));
    worth.appendChild(h('b', stain ? 'down' : '', '×' + m.toFixed(2)));
    if (out.before != null && out.after != null) {
      worth.appendChild(document.createTextNode(`: ${coins(out.before)} → `));
      worth.appendChild(h('b', +out.after < +out.before ? 'down' : 'up', coins(out.after)));
    }
    const flav = h('div', 'pui-flav', stain ? (pol.liq === 'acid' ? 'The acid bit too deep.' : 'The oil left a stain on the steel.') : mirror ? 'You can see your face in it.' : '');
    const btns = h('div', 'pui-btns'), bGo = h('button', 'pui-btn go', 'Continue');
    bGo.type = 'button'; bGo.disabled = true; btns.appendChild(bGo);
    root.append(top, stage, line, qwrap, qlab, name, worth, flav, btns);
    el.replaceChildren(root);

    // ---- the blade: the one just polished (with its scratches), or a clean one if we never ran the game
    const st = keep ? keep.st : (() => { const s = R.polishInit(1); s.t = s.t.map(() => 0); return s; })();
    const scene = Scene(cv, { stone: keep ? keep.stone : (pol.stone | 0) });
    scene.pic = keep ? keep.pic : null;
    const stainK = Math.floor(hash((keep && keep.seed) | 0, 5, 5) * P.SEG);
    let lastW = -1;
    function relayout() { const w = Math.round(cv.getBoundingClientRect().width); if (w !== lastW && w > 0) { lastW = w; scene.layout(); } }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null;
    if (ro) ro.observe(stage); else window.addEventListener('resize', relayout);
    scene.layout(); lastW = Math.round(cv.getBoundingClientRect().width);

    // ---- the reveal: the bar fills up to q, then the name and the worth appear
    const t0 = performance.now(), FILL = still ? 0 : 1100;
    let revealed = false, raf = 0, ended = false;
    function frame() {
      raf = requestAnimationFrame(frame);
      const now = performance.now(), e = now - t0;
      const f = FILL ? clamp(e / FILL, 0, 1) : 1, ease = 1 - Math.pow(1 - f, 3);
      const shown = Math.round(q * ease);
      qfill.style.width = shown + '%'; qnum.textContent = stain ? '–' : String(shown);
      qnum.classList.toggle('dark', shown >= 90);                 // dark digits once the bar runs under them
      if (f >= 1 && !revealed) reveal(now);
      const after = revealed ? now - revealT : 0, fx = { t: now };
      const blot = Math.max(8, (scene.x1 - scene.x0) * 0.2);       // how far the stain spreads, in art pixels
      if (stain && revealed) fx.stain = { k: stainK, r: still ? blot : clamp(after / 500, 0, 1) * blot };
      if (mirror && revealed) {
        fx.sparkle = true; fx.still = still;
        if (!still) { const c = (after % 2600) / 900; if (c <= 1) fx.sweep = c; }
      }
      scene.draw(st, fx);
    }
    let revealT = 0;
    function reveal(now) {
      revealed = true; revealT = now;
      name.classList.add('pui-show'); worth.classList.add('pui-show'); flav.classList.add('pui-show');
      sfx('reveal', tier);
      if (mirror) { sfx('mirror'); if (!still) stage.appendChild(h('div', 'pui-flash')); }
      if (stain) sfx('stain');
      setTimeout(() => { if (!ended) { bGo.disabled = false; try { bGo.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }, still ? 150 : 450);
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); end(); } }

    let resolveFn;
    const promise = new Promise((res) => { resolveFn = res; });
    function end() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', relayout);
      window.removeEventListener('keydown', onKey, true);
      el.replaceChildren();
      if (cur && cur.end === end) cur = null;
      resolveFn();
    }
    bGo.addEventListener('click', end);
    window.addEventListener('keydown', onKey, true);
    cur = { end };
    raf = requestAnimationFrame(frame);
    return promise;
  }

  window.PolishUI = { open, showResult, close };
})();
