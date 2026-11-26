// EnchantUI: the rune-carving mini-game (design: docs/redesign/03-enchanting.md, contract: 05-implementation.md 8.4).
// A plain script (no modules). It sets window.EnchantUI and reads window.AMR (the shared rules) only when called.
//
//   EnchantUI.open(el, o)          shows the plate; resolves { strokes, tEnd } once a carving started and ended,
//                                  or null if it never started
//   EnchantUI.showResult(el, out)  shows what the server rolled; resolves when the player presses Continue
//   EnchantUI.close()              ends whatever is open (see the notes on open below)
//
// It only ever touches the <div> it is given, and leaves it empty when its promise settles.
// It never calls the server and never changes the save: index.html does that with what we resolve.
(function () {
  'use strict';

  // ------------------------------------------------------------------ numbers
  const ART = 120;               // the plate's picture is 120 x 120 pixels, scaled up with sharp pixels
  const U = ART / 1000;          // plate units (0..1000) -> art pixels
  const MIN_GAP = 10;            // keep a point only when it is 10 plate units from the stroke's last kept point
  const READ_MS = 100;           // the live "Rune strength" readout updates about 10 times a second
  const TRAIL_MS = 260;          // the bright fresh line fades into the pixel groove over this long
  const CHISEL_EVERY = 60;       // a 'chisel' sound about every 60 units of line
  const FAST = 700;              // carving at 700 units/s or more counts as full speed for the chisel sound
  const LOW = 0.2;               // below 20% mana the bar pulses and ticks
  const FILL_MS = 600;           // the reveal: the groove fills with light over 0.6 s
  const STEEL = [96, 102, 112];  // plain steel colour when there is no blade picture

  let live = null;               // what is open right now: { close() }, or null
  let last = null;               // the carving just finished, so showResult can redraw its groove
  let lastSfx = null;            // the sound callback from the last open(), so the reveal can play sounds too

  // ------------------------------------------------------------------ small helpers
  const R = () => window.AMR || {};
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pct = (v) => Math.round(clamp(v || 0, 0, 1) * 100) + '%';
  const fmt = (n) => (R().fmtN ? R().fmtN(n) : Math.round(n).toLocaleString('en-US'));
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0xcccccc; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, f) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f));
  const css = (c, a) => (a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };
  // credit for being d units from the guide, exactly as the scoring uses it
  const credit = (d, tol) => (R().nearCredit ? R().nearCredit(d, tol) : Math.max(0, 1 - (d / (3 * tol)) ** 2));
  // distance from point (x, y) to the segment a-b
  function segDist(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const u = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
    return Math.hypot(ax + u * dx - x, ay + u * dy - y);
  }
  // a rune's guide lines as segments [ax, ay, bx, by]
  function segsOf(lines) {
    const out = [];
    for (const l of lines) for (let i = 1; i < l.length; i++) out.push([l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]]);
    return out;
  }
  const nearest = (x, y, segs) => segs.reduce((best, s) => Math.min(best, segDist(x, y, s[0], s[1], s[2], s[3])), Infinity);
  // make an element: h('div', 'eui-x', 'text')
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sfx(fn, ev, v) { try { if (fn) fn(ev, v); } catch (e) { /* a sound must never break the game */ } }

  // ------------------------------------------------------------------ styles (injected once)
  function injectCss() {
    if (document.getElementById('eui-css')) return;
    const s = document.createElement('style');
    s.id = 'eui-css';
    s.textContent = `
.eui-wrap{--eui-ink:var(--ink,#141110);max-width:380px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--ash,#ede5d8);font:400 15px/1.4 var(--body,system-ui,sans-serif);text-align:center;user-select:none;-webkit-user-select:none}
.eui-head{display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap}
.eui-glyph{font-size:30px;line-height:1;color:var(--eui-glow);text-shadow:0 0 8px var(--eui-glow)}
.eui-name{font:400 26px/1 var(--display,Georgia,serif);color:var(--straw,#e2c275)}
.eui-sub{width:100%;color:var(--mute,#ab9f90);font-size:13px}
.eui-plate{position:relative;width:min(88vw,360px);max-width:100%;aspect-ratio:1;border:3px solid var(--eui-ink);background:#141118;box-shadow:inset 3px 3px 0 rgba(255,255,255,.08),inset -3px -3px 0 rgba(0,0,0,.35)}
.eui-plate canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.eui-ink{cursor:crosshair}
.eui-mana{position:relative;width:min(88vw,360px);max-width:100%;height:18px;border:3px solid var(--eui-ink);background:#1b1817;box-sizing:content-box}
.eui-fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:var(--eui-con);box-shadow:inset 0 3px 0 rgba(255,255,255,.28),inset 0 -3px 0 rgba(0,0,0,.25)}
.eui-low .eui-fill{animation:eui-pulse .5s steps(2,jump-none) infinite}
.eui-notch{position:absolute;left:40%;top:-6px;bottom:-6px;width:2px;background:var(--straw,#e2c275);box-shadow:0 0 0 1px var(--eui-ink)}
.eui-manalbl{position:relative;width:min(88vw,360px);max-width:100%;height:16px;font-size:12px;line-height:16px;color:var(--dim,#837869);margin-top:-6px}
.eui-manalbl span{position:absolute;left:0;top:0}
.eui-manalbl .eui-fc{left:40%;transform:translateX(-50%);white-space:nowrap;color:var(--straw,#e2c275)}
.eui-manalbl .eui-secs{left:auto;right:0;color:var(--ash,#ede5d8)}
.eui-read{min-height:52px}
.eui-read b{display:block;font-size:20px;font-weight:700;color:var(--ash,#ede5d8)}
.eui-read small{color:var(--mute,#ab9f90);font-size:13px}
.eui-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:4px}
.eui-btn{background:var(--plate2,#3c3833);color:var(--ash,#ede5d8);border:3px solid var(--eui-ink);box-shadow:inset 3px 3px 0 rgba(255,255,255,.12),inset -3px -3px 0 rgba(0,0,0,.3);padding:9px 18px;font:600 15px/1.2 var(--body,system-ui,sans-serif);letter-spacing:.02em;cursor:pointer;min-width:120px}
.eui-btn:hover:not(:disabled){filter:brightness(1.12)}
.eui-btn:active:not(:disabled){transform:translateY(2px);box-shadow:inset 3px 3px 0 rgba(0,0,0,.3)}
.eui-btn:disabled{opacity:.4;cursor:not-allowed}
.eui-go{background:var(--straw,#e2c275);color:#2a2018;box-shadow:inset 3px 3px 0 #fbe7a1,inset -3px -3px 0 #a8742c}
.eui-banner{min-height:92px;opacity:0;transition:opacity .25s}
.eui-banner.eui-in{opacity:1}
.eui-banner h3{margin:0 0 4px;font:700 22px/1.2 var(--body,system-ui,sans-serif);color:var(--straw,#e2c275)}
.eui-banner p{margin:0;color:var(--ash,#ede5d8)}
.eui-banner small{display:block;margin-top:4px;color:var(--mute,#ab9f90);font-size:13px}
.eui-banner.eui-bad h3{color:var(--red,#e0654f)}
.eui-banner.eui-meh h3{color:var(--mute,#ab9f90)}
.eui-banner.eui-res h3{background:linear-gradient(90deg,#fff,#ffd6f4,#cfeaff,#fff6c8,#fff);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 12px rgba(255,255,255,.35)}
.eui-fx{position:absolute;inset:0;pointer-events:none}
.eui-flash{background:rgba(230,60,40,.6);animation:eui-flash .55s ease-out forwards}
.eui-shimmer{background:linear-gradient(115deg,transparent 30%,rgba(255,214,244,.45) 42%,rgba(207,234,255,.55) 50%,rgba(255,246,200,.45) 58%,transparent 70%);background-size:300% 100%;mix-blend-mode:screen;animation:eui-sweep 1.8s ease-in-out infinite}
.eui-shake{animation:eui-shake .4s linear}
@keyframes eui-pulse{50%{filter:brightness(1.7) saturate(.6)}}
@keyframes eui-flash{to{opacity:0}}
@keyframes eui-sweep{from{background-position:100% 0}to{background-position:0 0}}
@keyframes eui-shake{20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
@media (prefers-reduced-motion:reduce){.eui-low .eui-fill,.eui-shimmer,.eui-shake,.eui-flash{animation:none!important}.eui-flash{display:none}}
`;
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ the plate picture
  // half the steel's width (art pixels) at row y: a point at the top, full width (x 150..850 units) from y 200 down
  const halfW = (y) => (y >= 24 ? 42 : Math.round(42 * y / 24));

  // Stone, the steel band and (if we have it) the blade's sprite stood on its point, into a 120 x 120 canvas.
  function drawBase(cv, steel, img) {
    const c = cv.getContext('2d'), d = c.createImageData(ART, ART), px = d.data;
    const put = (x, y, col) => { const i = (y * ART + x) * 4; px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255; };
    for (let y = 0; y < ART; y++) {
      const hw = halfW(y), L = 60 - hw, Rt = 60 + hw;      // the steel runs from L to Rt - 1 on this row
      for (let x = 0; x < ART; x++) {
        const n = hash(x, y);
        if (x < L - 1 || x > Rt || hw === 0) {              // dark stone behind the blade, a little speckled
          const v = n % 9 === 0 ? 8 : n % 5 === 0 ? -5 : 0;
          put(x, y, [27 + v, 23 + v, 31 + v]);
        } else if (x === L - 1 || x === Rt) {               // a crisp dark outline
          put(x, y, [13, 11, 14]);
        } else {
          let k = 0;
          if (x - L < 2) k = 46;                            // a light bevel down the left edge...
          else if (Rt - 1 - x < 2) k = -34;                 // ...and a shadow down the right one
          else if (((x + y * 0.5) % 46) < 5) k = 10;        // soft diagonal sheen
          if (n % 7 === 0) k += 6; else if (n % 11 === 0) k -= 6;   // dithered grain
          put(x, y, steel.map((v) => clamp(v + k, 0, 255)));
        }
      }
    }
    c.putImageData(d, 0, 0);
    if (img) {                                              // the blade's own sprite, point up, as a faint etching
      const s = (ART - 8) / img.width, w = img.width * s, hh = img.height * s;
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.12;
      c.translate(60, ART / 2);
      c.rotate(-Math.PI / 2);
      c.drawImage(img, -w / 2, -hh / 2, w, hh);
      c.restore();
    }
  }

  // the average colour of a sprite's opaque pixels, nudged into a dark steel tone so every rune colour reads on it
  function steelOf(img) {
    try {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
      const d = c.getImageData(0, 0, cv.width, cv.height).data; let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      if (!n) return STEEL;
      const avg = mix([r / n, g / n, b / n], STEEL, 0.45), lum = (avg[0] + avg[1] + avg[2]) / 3;
      return avg.map((v) => clamp(Math.round(v * 103 / Math.max(1, lum)), 0, 255));
    } catch (e) { return STEEL; }
  }

  // the guide as art pixels along its lines, in drawing order (k counts along the line, for the dotted look)
  function guidePixels(lines) {
    const out = [], seen = new Set();
    for (const l of lines) {
      let k = 0;
      for (let i = 1; i < l.length; i++) {
        const [ax, ay] = l[i - 1], [bx, by] = l[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * U));
        for (let j = 0; j <= n; j++) {
          const ux = ax + (bx - ax) * j / n, uy = ay + (by - ay) * j / n;
          const x = clamp(Math.floor(ux * U), 0, ART - 1), y = clamp(Math.floor(uy * U), 0, ART - 1), key = x + y * ART;
          if (seen.has(key)) continue;
          seen.add(key); out.push({ x, y, ux, uy, k: k++, cov: false });
        }
      }
    }
    return out;
  }

  // Draw one frame of the plate. look = { fill, fade, dim } for the reveal (all 0..1), or {} while carving.
  function drawPlate(c, st, look) {
    const glow = st.glow, maxO = Math.max(1, st.inkLen), fill = look.fill == null ? 1 : look.fill, fade = look.fade || 0;
    c.clearRect(0, 0, ART, ART);
    c.drawImage(st.base, 0, 0);
    const P = (x, y, col) => { if (x >= 0 && y >= 0 && x < ART && y < ART) { c.fillStyle = col; c.fillRect(x, y, 1, 1); } };
    // the guide: faint dots, full colour where the chisel has covered it
    const ga = 1 - (look.dim || 0);
    for (const g of st.guide) {
      if (g.cov) { P(g.x, g.y + 1, css([0, 0, 0], 0.35 * ga)); P(g.x, g.y, css(mix(glow, [140, 140, 140], fade), ga)); }
      else if (g.k % 2 === 0) { P(g.x, g.y + 1, css([0, 0, 0], 0.3 * ga)); P(g.x, g.y, css(glow, 0.5 * ga)); }
    }
    // the groove: a soft halo, then the highlight below each pixel, then the cut itself
    const gl = mix(glow, [255, 255, 255], 0.35), grey = [150, 154, 160];
    for (const p of st.grooves) {
      if (!p.glow || p.o > fill * maxO) continue;
      const a = (0.22 * (1 - fade)).toFixed(3);
      P(p.x - 1, p.y, css(glow, a)); P(p.x + 1, p.y, css(glow, a)); P(p.x, p.y - 1, css(glow, a)); P(p.x, p.y + 2, css(glow, a));
    }
    for (const p of st.grooves) {
      const lit = p.o <= fill * maxO;
      P(p.x, p.y + 1, p.glow ? css(mix(lit ? gl : mix(glow, [0, 0, 0], 0.4), grey, fade)) : 'rgb(158,163,170)');
    }
    for (const p of st.grooves) {
      const lit = p.o <= fill * maxO;
      P(p.x, p.y, p.glow ? css(mix(lit ? mix(glow, [255, 255, 255], 0.15) : mix(glow, [20, 18, 22], 0.6), [58, 60, 66], fade)) : 'rgb(38,40,45)');
    }
  }

  // the plate's state that both the carving and the reveal draw from
  function newPlate(rune, tol, imgUrl, onImage) {
    const RU = (R().RUNES || {})[rune];
    const lines = RU ? RU.s : [];
    const st = { rune, tol, glow: hexRgb(RU ? RU.glow : '#cccccc'), lines, gsegs: segsOf(lines), guide: guidePixels(lines),
      grooves: [], gmap: new Map(), inkLen: 0, base: document.createElement('canvas'), steel: STEEL, img: null };
    st.base.width = st.base.height = ART;
    drawBase(st.base, st.steel, null);
    if (imgUrl) {                                           // the picture loads in the background; redraw when it arrives
      const im = new Image();
      im.onload = () => { st.img = im; st.steel = steelOf(im); drawBase(st.base, st.steel, im); if (onImage) onImage(); };
      im.src = imgUrl;
    }
    return st;
  }

  // a new piece of ink from a to b (plate units): light up the guide it covers and cut it into the steel
  function cut(st, ax, ay, bx, by) {
    for (const g of st.guide) if (!g.cov && credit(segDist(g.ux, g.uy, ax, ay, bx, by), st.tol) > 0.5) g.cov = true;
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len * U * 2));
    for (let j = 0; j <= n; j++) {
      const ux = ax + (bx - ax) * j / n, uy = ay + (by - ay) * j / n;
      const x = clamp(Math.floor(ux * U), 0, ART - 1), y = clamp(Math.floor(uy * U), 0, ART - 1), key = x + y * ART;
      const glow = credit(nearest(ux, uy, st.gsegs), st.tol) > 0.5;   // near the guide: it glows; off it: a grey scratch
      const old = st.gmap.get(key);
      if (old) { if (glow) old.glow = true; continue; }
      const p = { x, y, glow, o: st.inkLen + len * j / n };          // o = how far along the carving, for the reveal
      st.gmap.set(key, p); st.grooves.push(p);
    }
    st.inkLen += len;
  }

  // the header, shared by the plate and the result
  function header(wrap, rune, sub) {
    const RU = (R().RUNES || {})[rune], head = h('div', 'eui-head');
    head.appendChild(h('span', 'eui-glyph', RU ? RU.g : '✦'));
    head.appendChild(h('span', 'eui-name', RU ? RU.n : 'Rune'));
    if (sub) head.appendChild(h('div', 'eui-sub', sub));
    wrap.appendChild(head);
  }

  // ================================================================== open: the carving
  // o = { img, rune, con, tol, win, start, title?, sfx? }
  // Resolves { strokes: [[[x, y, t], ...], ...], tEnd } once the carving started and ended; null if it never started.
  // Abandon after the start resolves { strokes: [], tEnd } (the server fizzles it). close() after the start resolves
  // the strokes carved so far (so leaving mid-carving keeps what was carved).
  function open(el, o) {
    close();
    injectCss();
    o = o || {};
    last = null; lastSfx = o.sfx || null;
    const A = R(), RU = (A.RUNES || {})[o.rune], CO = (A.CONDUITS || {})[o.con] || {};
    const win = Math.max(1, Math.round(o.win || 5000)), tol = o.tol || 14;
    const MAX_PTS = A.RUNE_MAX_PTS || 400, MAX_STROKES = A.RUNE_MAX_STROKES || 12;
    const glow = RU ? RU.glow : '#cccccc';

    return new Promise((resolve) => {
      // ---- build the page
      el.replaceChildren();
      const wrap = h('div', 'eui-wrap');
      wrap.style.setProperty('--eui-glow', glow);
      wrap.style.setProperty('--eui-con', CO.c || '#c8794a');
      header(wrap, o.rune, [o.title, CO.n, (win / 1000).toFixed(1) + ' s of mana'].filter(Boolean).join(' · '));
      const plate = h('div', 'eui-plate'), art = h('canvas', 'eui-art'), ink = h('canvas', 'eui-ink');
      art.width = art.height = ART;
      plate.append(art, ink);
      const mana = h('div', 'eui-mana'), fillEl = h('div', 'eui-fill');
      mana.append(fillEl, h('div', 'eui-notch'));
      mana.title = 'Finish while the bar is above the notch for a full charge';
      const secs = h('span', 'eui-secs', (win / 1000).toFixed(1) + ' s');
      const lbl = h('div', 'eui-manalbl'); lbl.append(h('span', null, 'Mana'), h('span', 'eui-fc', '▲ full charge'), secs);
      // before the first touch the readout explains what to do
      const read = h('div', 'eui-read'), readQ = h('b', null, 'Touch the blade to start'), readS = h('small', null, 'Trace the dotted rune. Your mana drains from the first touch.');
      read.append(readQ, readS);
      const btns = h('div', 'eui-btns'), setBtn = h('button', 'eui-btn eui-go', 'Set the rune'), quitBtn = h('button', 'eui-btn', 'Abandon');
      setBtn.type = quitBtn.type = 'button'; setBtn.disabled = true;
      btns.append(setBtn, quitBtn);
      wrap.append(plate, mana, lbl, read, btns);
      el.appendChild(wrap);

      const actx = art.getContext('2d'), ictx = ink.getContext('2d');
      let dirty = true;
      const st = newPlate(o.rune, tol, o.img, () => { dirty = true; });

      // ---- the carving's state
      let started = false, ended = false, t0 = 0, lastT = 0;
      const strokes = [];          // finished strokes (2 points or more)
      let cur = null;              // the stroke being carved right now, or null while the chisel is up
      let total = 0;               // points kept so far (the limit is MAX_PTS)
      let pid = null;              // the one pointer we follow
      let lastRaw = null;          // the pointer's latest position { x, y, t } (not always a kept point)
      let sinceSound = 0, lastRead = 0, lastLow = 0, raf = 0;
      const trail = [];            // recent pointer positions for the fresh bright line: { x, y, at, id }
      let strokeId = 0;

      const elapsed = () => performance.now() - t0;
      // pointer position -> whole plate units, clamped to the plate
      function toPlate(e) {
        const r = ink.getBoundingClientRect();
        return [clamp(Math.round((e.clientX - r.left) / r.width * 1000), 0, 1000), clamp(Math.round((e.clientY - r.top) / r.height * 1000), 0, 1000)];
      }
      // whole ms since the first touch, never going down
      function stamp(e) {
        const now = performance.now(), ts = e && e.timeStamp > 0 && e.timeStamp <= now ? e.timeStamp : now;
        lastT = Math.max(lastT, Math.round(ts - t0));
        return lastT;
      }
      // keep a point in the current stroke and cut the piece from the previous one
      function keep(x, y, t) {
        const prev = cur[cur.length - 1];
        cur.push([x, y, t]); total++;
        cut(st, prev[0], prev[1], x, y); dirty = true;
        const len = Math.hypot(x - prev[0], y - prev[1]);
        sinceSound += len;
        if (sinceSound >= CHISEL_EVERY) { sinceSound = 0; sfx(o.sfx, 'chisel', clamp(len / Math.max(1, t - prev[2]) * 1000 / FAST, 0, 1)); }
      }
      // the chisel lifts: keep the lift point, and the stroke if it has 2 points or more
      function endStroke(x, y) {
        if (!cur) return;
        const prev = cur[cur.length - 1];
        if (x != null && (x !== prev[0] || y !== prev[1]) && total < MAX_PTS) keep(x, y, lastT);
        if (cur.length >= 2) strokes.push(cur); else total -= cur.length;   // a tap is dropped
        cur = null; pid = null;
        refreshRead(true);
      }

      // ---- the live readout, from the same scoring code the server uses
      function refreshRead(force) {
        if (!started || ended) return;
        const now = performance.now();
        if (!force && now - lastRead < READ_MS) return;
        lastRead = now;
        const so = cur && cur.length >= 2 ? strokes.concat([cur]) : strokes;
        try {
          const sc = R().runeScore(o.rune, so, { tol, win, tEnd: Math.max(1, Math.min(win, Math.round(elapsed()))) });
          readQ.textContent = 'Rune strength ' + pct(sc.q);
          readS.textContent = 'Lines ' + pct(sc.acc) + ' · Done ' + pct(sc.done);
        } catch (e) { readQ.textContent = 'Rune strength ?'; }
      }

      // ---- ending
      function cleanup() {
        ended = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', onHide);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', fit);
        el.replaceChildren();
        if (live === me) live = null;
      }
      function giveUp() { if (ended) return; cleanup(); resolve(null); }      // never started: nothing spent
      // why = 'set' | 'time' | 'limit' | 'close' | 'abandon'
      function finish(why) {
        if (ended) return;
        if (cur && lastRaw) endStroke(lastRaw.x, lastRaw.y);
        const tEnd = Math.max(1, Math.min(win, Math.round(elapsed())));
        const out = why === 'abandon' ? [] : strokes.map((s) => s.map(([x, y, t]) => [x, y, Math.min(t, tEnd)]));
        if (out.length && why !== 'close') sfx(o.sfx, 'set');
        last = st;                                               // showResult redraws this groove
        cleanup();
        resolve({ strokes: out, tEnd });
      }

      // ---- the pointer
      function onDown(e) {
        if (ended || pid !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        if (!started) {                                          // the first touch pays the mana and starts the clock
          let ok = false;
          try { ok = !!(o.start && o.start()); } catch (err) { ok = false; }
          if (!ok) { giveUp(); return; }
          started = true; t0 = performance.now(); lastT = 0;
          readQ.textContent = 'Rune strength 0%'; readS.textContent = 'Lines 0% · Done 0%'; setBtn.disabled = false;
        }
        if (strokes.length >= MAX_STROKES) { finish('limit'); return; }   // a 13th stroke would begin
        pid = e.pointerId;
        try { ink.setPointerCapture(pid); } catch (err) { /* synthetic events can't be captured */ }
        const [x, y] = toPlate(e), t = stamp(e);
        if (t >= win) { finish('time'); return; }
        cur = [[x, y, t]]; total++; lastRaw = { x, y, t }; strokeId++;
        trail.push({ x, y, at: performance.now(), id: strokeId });
        if (total >= MAX_PTS) finish('limit');
      }
      function onMove(e) {
        if (ended || e.pointerId !== pid || !cur) return;
        e.preventDefault();
        const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
        for (const ev of list.length ? list : [e]) {
          const [x, y] = toPlate(ev), t = stamp(ev);
          if (t > win) {                                         // the mana ran out during this move: cut it there
            const f = clamp((win - lastRaw.t) / Math.max(1, t - lastRaw.t), 0, 1);
            const cx = Math.round(lastRaw.x + (x - lastRaw.x) * f), cy = Math.round(lastRaw.y + (y - lastRaw.y) * f);
            lastT = win; lastRaw = { x: cx, y: cy, t: win };
            finish('time');
            return;
          }
          lastRaw = { x, y, t };
          trail.push({ x, y, at: performance.now(), id: strokeId });
          const prev = cur[cur.length - 1];
          if (Math.hypot(x - prev[0], y - prev[1]) >= MIN_GAP) {
            keep(x, y, t);
            if (total >= MAX_PTS) { finish('limit'); return; }
          }
        }
      }
      function onUp(e) {
        if (ended || e.pointerId !== pid) return;
        let x = lastRaw.x, y = lastRaw.y;
        if (e.type === 'pointerup') { [x, y] = toPlate(e); stamp(e); if (lastT > win) { lastT = win; x = lastRaw.x; y = lastRaw.y; } }
        endStroke(x, y);
      }
      ink.addEventListener('pointerdown', onDown);
      ink.addEventListener('pointermove', onMove);
      ink.addEventListener('pointerup', onUp);
      ink.addEventListener('pointercancel', onUp);
      ink.addEventListener('lostpointercapture', (e) => { if (e.pointerId === pid && cur) onUp({ type: 'lost', pointerId: pid }); });
      ink.addEventListener('contextmenu', (e) => e.preventDefault());
      setBtn.addEventListener('click', () => { if (started) finish('set'); });
      quitBtn.addEventListener('click', () => { if (started) finish('abandon'); else giveUp(); });

      // a hidden tab stops the frames: on return, end at once if the mana ran out meanwhile
      function onVis() { if (!document.hidden && started && !ended && elapsed() >= win) finish('time'); }
      // leaving the page mid-carving ends it with what was carved so far
      function onHide() { if (started) finish('close'); else giveUp(); }
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pagehide', onHide);

      // the ink canvas draws at the screen's real resolution
      function fit() {
        const r = ink.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
        if (ink.width !== w || ink.height !== hh) { ink.width = w; ink.height = hh; }
      }
      const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
      if (ro) ro.observe(ink); else window.addEventListener('resize', fit);
      fit();

      // the fresh bright line and the chisel's spark, fading into the groove underneath
      function drawTrail(now) {
        const W = ink.width, H = ink.height, s = W / 1000;
        ictx.clearRect(0, 0, W, H);
        while (trail.length && now - trail[0].at > TRAIL_MS) trail.shift();
        const lw = Math.max(1.5, W / 240), rgb = hexRgb(glow);
        ictx.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1], b = trail[i];
          if (a.id !== b.id) continue;
          const al = clamp(1 - (now - b.at) / TRAIL_MS, 0, 1);
          ictx.strokeStyle = css(rgb, (0.5 * al).toFixed(3)); ictx.lineWidth = lw * 2.6;
          ictx.beginPath(); ictx.moveTo(a.x * s, a.y * s); ictx.lineTo(b.x * s, b.y * s); ictx.stroke();
          ictx.strokeStyle = `rgba(255,250,235,${al.toFixed(3)})`; ictx.lineWidth = lw;
          ictx.beginPath(); ictx.moveTo(a.x * s, a.y * s); ictx.lineTo(b.x * s, b.y * s); ictx.stroke();
        }
        if (cur && lastRaw) {                                    // a little four-point spark at the chisel's tip
          const x = lastRaw.x * s, y = lastRaw.y * s, r = lw * (2 + Math.sin(now / 40));
          ictx.fillStyle = '#fffbe8';
          ictx.fillRect(x - r, y - lw / 2, r * 2, lw); ictx.fillRect(x - lw / 2, y - r, lw, r * 2);
        }
      }

      // ---- one frame
      function frame(now) {
        if (ended) return;
        if (started) {
          const left = 1 - elapsed() / win;
          if (left <= 0) { finish('time'); return; }
          fillEl.style.width = (left * 100).toFixed(2) + '%';
          secs.textContent = (left * win / 1000).toFixed(1) + ' s';
          mana.classList.toggle('eui-low', left < LOW);
          if (left < LOW && now - lastLow >= 500) { lastLow = now; sfx(o.sfx, 'manaLow'); }
          refreshRead(false);
        }
        if (dirty) { drawPlate(actx, st, {}); dirty = false; }
        drawTrail(now);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      const me = { close: () => (started ? finish('close') : giveUp()) };
      live = me;
    });
  }

  // ================================================================== showResult: the reveal
  // out = { res: 'set'|'resonant'|'backlash'|'fizzle', rune: {k, q, p, r?}|null, score: {acc, done, spare, charge, q}, before, after }
  function showResult(el, out) {
    close();
    injectCss();
    out = out || {};
    const A = R(), res = out.res || 'fizzle', sc = out.score || {};
    // redraw the groove just carved; without one, show the rune's guide on a clean plate
    let st = last;
    last = null;
    const runeKey = st ? st.rune : out.rune && out.rune.k !== 'scar' ? out.rune.k : null;
    if (!st) st = newPlate(runeKey, 14, null);
    const RU = (A.RUNES || {})[runeKey], name = RU ? RU.n : 'The rune', calm = reduced();

    return new Promise((resolve) => {
      el.replaceChildren();
      const wrap = h('div', 'eui-wrap');
      wrap.style.setProperty('--eui-glow', RU ? RU.glow : '#cccccc');
      header(wrap, runeKey);
      const plate = h('div', 'eui-plate'), art = h('canvas', 'eui-art');
      art.width = art.height = ART;
      plate.appendChild(art);
      const banner = h('div', 'eui-banner'), btns = h('div', 'eui-btns'), ok = h('button', 'eui-btn eui-go', 'Continue');
      ok.type = 'button';
      btns.appendChild(ok);
      wrap.append(plate, banner, btns);
      el.appendChild(wrap);

      // ---- the words
      const H3 = (t) => banner.appendChild(h('h3', null, t)), Pp = (t) => banner.appendChild(h('p', null, t)), Sm = (t) => banner.appendChild(h('small', null, t));
      const before = out.before, after = out.after, hasWorth = before > 0 && after > 0;
      const worth = hasWorth ? `Worth ×${(after / before).toFixed(2)}: ${fmt(before)}c → ${fmt(after)}c` : '';
      const q = out.rune && out.rune.k !== 'scar' ? out.rune.q : sc.q;
      const detail = sc.acc != null ? `Lines ${pct(sc.acc)} · Done ${pct(sc.done)} · Charge ×${(sc.charge || 1).toFixed(2)}` : '';
      if (res === 'resonant') {
        banner.classList.add('eui-res');
        H3('Resonant!');
        Pp(`${name} resonates: strength ${pct(q)}, worth 50% more.`);
        if (worth) Sm(worth);
      } else if (res === 'set') {
        H3(`${name} set`);
        Pp(`Strength ${pct(q)}` + (worth ? ' · ' + worth : ''));
        if (detail) Sm(detail);
      } else if (res === 'backlash') {
        banner.classList.add('eui-bad');
        H3('Backlash!');
        Pp('The rune shattered and scarred the blade.');
        Sm('The scar fills the slot for good.');
      } else {
        banner.classList.add('eui-meh');
        H3('The rune didn’t take hold.');
        Pp('The mana is spent.');
        if (sc.q != null) Sm(`Strength ${pct(sc.q)}: a rune needs ${pct(A.RUNE_FIZZLE || 0.25)} to take.`);
      }

      // ---- the animation: fill with light, then what the dice said
      const c = art.getContext('2d'), t0 = performance.now();
      let raf = 0, done = false, scar = null;
      const sparks = [];
      const glowing = st.grooves.filter((p) => p.glow);
      for (let i = 0; i < 14 && glowing.length; i++) sparks.push(glowing[(i * 7919) % glowing.length]);
      function showWords() { banner.classList.add('eui-in'); }
      function addFx(cls) { const f = h('div', 'eui-fx ' + cls); plate.appendChild(f); return f; }
      function frame(now) {
        if (done) return;
        const t = now - t0, fill = calm ? 1 : clamp(t / FILL_MS, 0, 1), since = t - (calm ? 0 : FILL_MS);   // since the groove filled
        let fade = 0, dim = 0;
        if (since >= 0) {
          if (!banner.classList.contains('eui-in')) {            // the moment the groove is full
            showWords();
            if (res === 'backlash') {
              scar = scarPath(st.grooves.length);
              if (!calm) { addFx('eui-flash'); plate.classList.add('eui-shake'); }
              sfx(lastSfx, 'backlash');
            } else if (res === 'resonant') { addFx('eui-shimmer'); sfx(lastSfx, 'resonant'); }
            else if (res === 'fizzle') sfx(lastSfx, 'fizzle');
          }
          if (res === 'fizzle') { fade = calm ? 1 : clamp(since / 900, 0, 1); dim = fade * 0.6; }
          if (res === 'backlash') { fade = 0.75; dim = 0.5; }
        }
        drawPlate(c, st, { fill, fade, dim });
        if (scar) drawScar(c, scar);
        if (res === 'resonant' && since >= 0) {                  // twinkling white sparks along the glowing groove
          for (let i = 0; i < sparks.length; i++) {
            const p = sparks[i], tw = calm ? 1 : Math.sin(now / 160 + i * 1.7);
            if (tw < 0.4) continue;
            c.fillStyle = '#ffffff'; c.fillRect(p.x, p.y - 1, 1, 3); c.fillRect(p.x - 1, p.y, 3, 1);
          }
        }
        const moving = !calm && (fill < 1 || (res === 'fizzle' && fade < 1) || res === 'resonant');
        if (moving) raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      function end() {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        el.replaceChildren();
        if (live === me) live = null;
        resolve();
      }
      ok.addEventListener('click', end);
      const me = { close: end };
      live = me;
    });
  }

  // a jagged crack across the plate (art pixels), the same for the same carving
  function scarPath(seed) {
    let s = (seed * 2654435761 + 12345) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pts = [[26 + rnd() * 10, 22 + rnd() * 10]];
    for (let i = 1; i <= 9; i++) pts.push([26 + i * 7.5 + (rnd() - 0.5) * 12, 22 + i * 8 + (rnd() - 0.5) * 10]);
    return pts;
  }
  function drawScar(c, pts) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
      for (let j = 0; j <= n; j++) {
        const x = Math.round(ax + (bx - ax) * j / n), y = Math.round(ay + (by - ay) * j / n);
        c.fillStyle = 'rgb(140,40,30)'; c.fillRect(x + 1, y, 1, 1);    // a hot red edge
        c.fillStyle = 'rgb(12,8,8)'; c.fillRect(x, y, 1, 1); c.fillRect(x, y + 1, 1, 1);
      }
    }
  }

  // ends whatever is open: a carving before its start resolves null, after its start the strokes so far;
  // a result resolves as if Continue was pressed. The div is left empty.
  function close() { if (live) live.close(); }

  window.EnchantUI = { open, showResult, close };
})();
