// Anvilmoon scenes: the Workshop and the Shop, drawn in layers on a fixed 320 x 180 pixel grid (docs/redesign/06-scenes.md).
// Every element is a layer: a PNG from www/art/ when one exists (listed in art/art.json), otherwise a procedural
// pixel-art drawing below. index.html says what each element shows (label, locked, upgrade badge) and what a click does;
// this file only draws. It never touches the save.
(function () {
  'use strict';
  const W = 320, H = 180;

  // ---------------------------------------------------------------- the elements
  // key: { scene, src, x, y, w, h (scene units), z (layer order), hot: [x, y, w, h] (optional, relative to the element), draw }
  // bg: the background layer (not clickable). fx: an ambient effect drawn by CSS over the element.
  // over: a drawing put on top of the PNG (for what changes with the save, like the blades on the racks).
  const ART = {
    // ---- the Workshop (floor line y 138: the boxes are the generated art's own sizes, docs/redesign/06-scenes.md)
    ws_bg:       { scene: 'workshop', src: 'art/workshop_bg.png',       x: 0,   y: 0,   w: 320, h: 180, z: 0, bg: true, draw: drawWorkshopBg },
    ws_forge:    { scene: 'workshop', src: 'art/workshop_forge.png',    x: 4,   y: 38,  w: 64,  h: 100, z: 2, fx: 'fire', draw: drawForge },
    ws_patterns: { scene: 'workshop', src: 'art/workshop_patterns.png', x: 80,  y: 20,  w: 29,  h: 30,  z: 2, draw: drawPatterns },
    ws_hammer:   { scene: 'workshop', src: 'art/workshop_hammers.png',  x: 78,  y: 56,  w: 32,  h: 19,  z: 2, draw: drawHammers },
    ws_anvil:    { scene: 'workshop', src: 'art/workshop_anvil.png',    x: 72,  y: 102, w: 35,  h: 36,  z: 4, draw: drawAnvil },
    ws_barrel:   { scene: 'workshop', src: 'art/workshop_barrel.png',   x: 110, y: 104, w: 22,  h: 34,  z: 4, draw: drawBarrel },
    ws_coal:     { scene: 'workshop', src: 'art/workshop_coal.png',     x: 24,  y: 130, w: 27,  h: 28,  z: 6, draw: drawCoal },
    ws_iron:     { scene: 'workshop', src: 'art/workshop_iron.png',     x: 54,  y: 136, w: 33,  h: 22,  z: 6, draw: drawIron },
    ws_polish:   { scene: 'workshop', src: 'art/workshop_bench.png',    x: 140, y: 104, w: 58,  h: 34,  z: 3, draw: drawBench },
    ws_stone:    { scene: 'workshop', src: 'art/workshop_stone.png',    x: 146, y: 81,  w: 28,  h: 29,  z: 4, draw: drawStone },
    ws_bottles:  { scene: 'workshop', src: 'art/workshop_bottles.png',  x: 176, y: 97,  w: 20,  h: 13,  z: 4, draw: drawBottles },
    ws_ench:     { scene: 'workshop', src: 'art/workshop_table.png',    x: 206, y: 99,  w: 60,  h: 39,  z: 3, draw: drawTable },
    ws_book:     { scene: 'workshop', src: 'art/workshop_runebook.png', x: 207, y: 93,  w: 23,  h: 14,  z: 4, draw: drawBook },
    ws_chisel:   { scene: 'workshop', src: 'art/workshop_chisel.png',   x: 229, y: 96,  w: 20,  h: 10,  z: 4, draw: drawChisel },
    ws_conduit:  { scene: 'workshop', src: 'art/workshop_conduit.png',  x: 250, y: 69,  w: 14,  h: 38,  z: 4, fx: 'glow', draw: drawConduit },
    ws_door:     { scene: 'workshop', src: 'art/workshop_door.png',     x: 268, y: 58,  w: 51,  h: 80,  z: 2, draw: drawDoorShop },
    // ---- the Shop (floor line y 138)
    sh_bg:       { scene: 'shop', src: 'art/shop_bg.png',         x: 0,   y: 0,   w: 320, h: 180, z: 0, bg: true, draw: drawShopBg },
    sh_back:     { scene: 'shop', src: 'art/shop_backdoor.png',   x: 2,   y: 62,  w: 43,  h: 76,  z: 2, draw: drawDoorBack },
    sh_board:    { scene: 'shop', src: 'art/shop_board.png',      x: 171, y: 26,  w: 31,  h: 30,  z: 2, draw: drawBoard },
    // the racks PNG is only the two shelves; over: the stands, blades and price tags drawn on top (shelf tops at y 24 and 53)
    sh_racks:    { scene: 'shop', src: 'art/shop_racks.png',      x: 48,  y: 14,  w: 100, h: 74,  z: 2, draw: drawRacks, over: drawRackItems },
    sh_counter:  { scene: 'shop', src: 'art/shop_counter.png',    x: 92,  y: 92,  w: 96,  h: 46,  z: 3, draw: drawCounter },
    sh_slots:    { scene: 'shop', src: 'art/shop_crate.png',      x: 192, y: 122, w: 24,  h: 16,  z: 4, draw: drawCrate },
    sh_flyer:    { scene: 'shop', src: 'art/shop_flyers.png',     x: 178, y: 62,  w: 18,  h: 23,  z: 2, draw: drawFlyers },
    sh_scrap:    { scene: 'shop', src: 'art/shop_scrap.png',      x: 219, y: 104, w: 40,  h: 34,  z: 4, draw: drawScrap },
    sh_street:   { scene: 'shop', src: 'art/shop_street.png',     x: 275, y: 62,  w: 43,  h: 76,  z: 2, draw: drawDoorStreet },
  };

  // ---------------------------------------------------------------- PNGs: only files listed in art/art.json are tried
  const HAVE = new Set();
  let ready = false;
  const SCENE = { ART, W, H, onready: null };
  try {
    fetch('art/art.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      for (const f of (j && j.files) || []) HAVE.add('art/' + String(f).replace(/^art\//, ''));
      ready = true; if (HAVE.size && SCENE.onready) SCENE.onready();
    }).catch(() => { ready = true; });
  } catch (e) { ready = true; }
  SCENE.ready = () => ready;

  // ---------------------------------------------------------------- HTML
  const pct = (v, of) => (v / of * 100).toFixed(3) + '%';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const STATE = {};   // what each element was last drawn with (index.html's `st`)
  // one layer's picture: the PNG, or a canvas drawn by mount()
  function layer(k, st) {
    const a = ART[k]; STATE[k] = st || {};
    if (HAVE.has(a.src)) return `<img class="scimg" src="${a.src}" alt="" draggable="false" data-art="${k}" onerror="SCENE.fail(this)">` +
      (a.over ? `<canvas class="scimg" width="${a.w}" height="${a.h}" data-art="${k}" data-over="1" data-st="${esc(JSON.stringify(st || {}))}" style="position:absolute;left:0;top:0"></canvas>` : '');
    return `<canvas class="scimg" width="${a.w}" height="${a.h}" data-art="${k}" data-st="${esc(JSON.stringify(st || {}))}"></canvas>`;
  }
  // items: { key: { label, short (phones), sub, lock, part (no padlock: a part of a locked station), badge, quiet, hide, st, count } }; o: { night }
  SCENE.html = function (scene, items, o = {}) {
    const keys = Object.keys(ART).filter((k) => ART[k].scene === scene).sort((a, b) => ART[a].z - ART[b].z);
    const els = keys.map((k) => {
      const a = ART[k], it = items[k] || {};
      if (it.hide) return '';
      const box = `left:${pct(a.x, W)};top:${pct(a.y, H)};width:${pct(a.w, W)};height:${pct(a.h, H)};z-index:${a.z}`;
      if (a.bg) return `<div class="scbg" style="${box}">${layer(k, it.st)}</div>`;
      const fx = a.fx && !it.lock ? `<span class="scfx fx-${a.fx}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>` : '';
      return `<button type="button" class="scel ${it.lock ? 'lock' : ''} ${it.part ? 'part' : ''} ${it.badge ? 'up' : ''} ${it.quiet ? 'quiet' : ''}" data-action="scene" data-k="${k}" style="${box}" aria-label="${esc(it.label)}${it.sub ? ': ' + esc(it.sub) : ''}">
        ${layer(k, it.st)}${fx}${it.lock && !it.part ? '<i class="sclock" aria-hidden="true"></i>' : ''}${it.badge ? '<b class="scbadge" aria-hidden="true">▲</b>' : ''}${it.count ? `<b class="sccount">${esc(it.count)}</b>` : ''}
        <span class="sclabel"><b>${it.short ? `<span class="lg">${esc(it.label)}</span><span class="sm">${esc(it.short)}</span>` : esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
    }).join('');
    return `<div class="scene sc-${scene} ${o.night ? 'night' : ''}"><div class="scbox">${els}<div class="scnight" aria-hidden="true"></div></div></div>`;
  };
  // a small picture of one element (popups use it)
  SCENE.icon = function (k, st) { const a = ART[k]; if (!a) return ''; return `<span class="scicon" style="position:relative;aspect-ratio:${a.w}/${a.h}">${layer(k, st)}</span>`; };
  // draw every canvas inside root that hasn't been drawn
  SCENE.mount = function (root) {
    (root || document).querySelectorAll('canvas[data-art]:not([data-done])').forEach((cv) => {
      const k = cv.dataset.art, a = ART[k]; if (!a) return;
      let st = {}; try { st = JSON.parse(cv.dataset.st || '{}'); } catch (e) { /* empty */ }
      const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
      try { (cv.dataset.over ? a.over : a.draw)(G(ctx), a.w, a.h, st); } catch (e) { /* a drawing bug never breaks the page */ }
      cv.dataset.done = '1';
    });
  };
  // a PNG that fails to load: swap in the drawing and stop trying that file
  SCENE.fail = function (img) {
    const k = img.dataset.art, a = ART[k]; if (!a) return; HAVE.delete(a.src);
    const ov = img.parentElement && img.parentElement.querySelector('canvas[data-over]'); if (ov) ov.remove();
    const cv = document.createElement('canvas'); cv.width = a.w; cv.height = a.h; cv.className = 'scimg'; cv.dataset.art = k;
    cv.dataset.st = JSON.stringify(STATE[k] || {}); img.replaceWith(cv); SCENE.mount(cv.parentElement);
  };

  // ---------------------------------------------------------------- the pixel painter
  function G(ctx) {
    const g = {
      ctx,
      r(x, y, w, h, c) { if (w <= 0 || h <= 0) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
      p(x, y, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); },
      // a box with a dark outline, a lit top/left edge and a shaded bottom/right edge
      box(x, y, w, h, fill, hi, lo, ink = '#141110') { g.r(x, y, w, h, ink); g.r(x + 1, y + 1, w - 2, h - 2, fill); if (hi) { g.r(x + 1, y + 1, w - 2, 1, hi); g.r(x + 1, y + 1, 1, h - 2, hi); } if (lo) { g.r(x + 1, y + h - 2, w - 2, 1, lo); g.r(x + w - 2, y + 1, 1, h - 2, lo); } },
      // a filled ellipse, pixel by pixel
      ell(cx, cy, rx, ry, c) { for (let y = -ry; y <= ry; y++) { const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry || 1)))); g.r(cx - hw, cy + y, hw * 2 + 1, 1, c); } },
      line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) g.p(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); },
    };
    return g;
  }
  // a fixed random sequence, so a drawing is the same every time
  function rnd(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const pick = (r, a) => a[Math.floor(r() * a.length)];

  // ---------------------------------------------------------------- palette (matches the game's CSS)
  const K = {
    ink: '#141110', wall: '#2a2320', brick: ['#5c3428', '#673b2d', '#523026', '#6f4333', '#4a2b23'], mortar: '#251c19',
    wood: '#5a3d26', woodHi: '#7a5534', woodLo: '#3d2817', woodDk: '#2c1d12', plank: ['#4b3220', '#553923', '#4f3521', '#5c3e26'],
    iron: '#5d6166', ironHi: '#9aa2a9', ironLo: '#3a3d41', steel: '#b8c0c6', coal: '#1f1c1b', coalHi: '#3a3532',
    sack: '#8b6f47', sackHi: '#a8895c', sackLo: '#614d31', fire: ['#ff7a1a', '#ffb43a', '#ffe28a', '#e2531c', '#c8401a'],
    straw: '#e2c275', bronze: '#b9773f', paper: '#e8dcc0', paperLo: '#c9b994', stone: '#7b7670', stoneHi: '#9c968e', stoneLo: '#57534e',
    purple: '#5a3d7a', purpleHi: '#7d5aa6', glow: '#a58cff', cloth: '#3f2a55',
  };

  // ---------------------------------------------------------------- the Workshop
  function bricks(g, x0, y0, w, h, seed, cols = K.brick) {
    const r = rnd(seed); g.r(x0, y0, w, h, K.mortar);
    for (let y = y0, row = 0; y < y0 + h; y += 6, row++) {
      for (let x = x0 - (row % 2 ? 6 : 0); x < x0 + w; x += 12) {
        const bx = Math.max(x, x0), bw = Math.min(x + 11, x0 + w) - bx, bh = Math.min(5, y0 + h - y);
        const c = pick(r, cols); g.r(bx, y, bw, bh, c); g.r(bx, y, bw, 1, 'rgba(255,255,255,.06)'); g.r(bx, y + bh - 1, bw, 1, 'rgba(0,0,0,.18)');
      }
    }
  }
  function planks(g, y0, seed, cols = K.plank) {
    const r = rnd(seed);
    for (let y = y0, row = 0; y < H; y += 6, row++) {
      g.r(0, y, W, 6, pick(r, cols)); g.r(0, y, W, 1, 'rgba(255,255,255,.05)'); g.r(0, y + 5, W, 1, K.woodDk);
      for (let x = Math.floor(r() * 40); x < W; x += 40 + Math.floor(r() * 50)) g.r(x, y, 1, 5, K.woodDk);
    }
  }
  function windowPane(g, x, y, w, h, night, street) {
    g.box(x - 2, y - 2, w + 4, h + 4, K.woodLo, K.woodHi, K.woodDk);
    const sky = night ? ['#0f1628', '#16203a', '#1d2a4a'] : ['#6f93b8', '#86a9c9', '#a5c2da'];
    for (let i = 0; i < h; i++) g.r(x, y + i, w, 1, sky[Math.min(2, Math.floor(i / h * 3))]);
    if (night) { g.ell(x + w - 9, y + 8, 4, 4, '#f2ecd0'); g.ell(x + w - 8, y + 7, 3, 3, '#16203a'); const r = rnd(9); for (let i = 0; i < 7; i++) g.p(x + 2 + r() * (w - 4), y + 2 + r() * (h / 2), '#cfd8ff'); }
    else { g.ell(x + 8, y + 7, 3, 3, '#fff3c4'); }
    if (street) { // rooftops across the street
      g.r(x, y + h - 10, w, 10, night ? '#1a1820' : '#4a3a35'); for (let i = 0; i < w; i += 9) g.r(x + i, y + h - 14 + (i % 2 ? 2 : 0), 7, 5, night ? '#221f2a' : '#5e4a40');
      if (night) for (let i = 4; i < w; i += 11) g.r(x + i, y + h - 7, 2, 2, '#ffcf6a');
    } else g.r(x, y + h - 6, w, 6, night ? '#141a26' : '#5b6b52');
    g.r(x + Math.floor(w / 2), y, 1, h, K.woodLo); g.r(x, y + Math.floor(h / 2), w, 1, K.woodLo);   // the window bars
    g.r(x - 3, y + h + 2, w + 6, 3, K.woodHi); g.r(x - 3, y + h + 5, w + 6, 1, K.woodDk);             // the sill
  }
  function drawWorkshopBg(g, w, h, st) {
    bricks(g, 0, 0, W, 136, 7);
    for (let y = 0; y < 136; y++) if (y < 20) g.r(0, y, W, 1, `rgba(10,8,7,${(20 - y) / 30})`);   // dark under the roof
    g.box(0, 0, W, 9, K.woodLo, K.woodHi, K.woodDk);                                             // ceiling beam
    for (const x of [74, 144, 208, 276]) g.box(x, 0, 5, 136, K.woodLo, K.woodHi, K.woodDk);     // posts
    windowPane(g, 152, 22, 40, 30, st.night, false);
    g.r(0, 133, W, 4, K.woodDk); g.r(0, 134, W, 1, K.woodLo);                                    // skirting
    planks(g, 137, 3);
    // warm light from the hearth on the floor and wall
    for (let i = 0; i < 6; i++) { g.r(0, 137 + i * 7, 120 - i * 14, 7, `rgba(255,140,40,${.07 - i * .01})`); }
    // tools hanging on the wall between the stations
    g.r(206, 40, 1, 14, K.woodDk); g.box(203, 54, 7, 4, K.iron, K.ironHi, K.ironLo);              // tongs
  }
  function drawForge(g, w, h, st) {
    // chimney hood
    bricks(g, 0, 0, 64, 30, 40);
    for (let y = 0; y < 30; y++) { const hw = 16 + Math.round(y * .55); g.ctx.clearRect(0, y, 32 - hw - 1, 1); g.ctx.clearRect(32 + hw + 1, y, 64, 1); g.p(32 - hw - 1, y, K.ink); g.p(32 + hw, y, K.ink); }
    g.r(17, 0, 30, 1, K.ink);
    g.box(0, 30, 64, 6, K.stone, K.stoneHi, K.stoneLo);                                         // mantel
    bricks(g, 2, 36, 60, 58, 51); g.r(1, 36, 1, 58, K.ink); g.r(62, 36, 1, 58, K.ink);
    // the fire opening: an arch
    g.r(12, 50, 40, 34, K.ink);
    for (let x = 0; x < 36; x++) { const top = 54 - Math.round(4 * Math.sin(Math.PI * x / 35)); g.r(14 + x, top, 1, 82 - top, '#170d09'); }
    const r = rnd(st.lv || 3), F = K.fire;
    g.r(16, 74, 32, 8, '#2a0f08');                                                                // embers bed
    for (let i = 0; i < 70; i++) { const x = 16 + r() * 32, y = 66 + r() * 15; g.p(x, y, y > 77 ? pick(r, ['#c8401a', '#e2531c', '#7a1d0c']) : pick(r, F)); }
    for (let i = 0; i < 26; i++) { const x = 20 + r() * 24, y = 56 + r() * 14; g.p(x, y, pick(r, [F[0], F[1], F[3]])); }
    g.box(0, 84, 64, 20, K.stone, K.stoneHi, K.stoneLo);                                        // the hearth stone
    g.r(6, 88, 52, 1, K.stoneLo); g.r(20, 92, 1, 10, K.stoneLo); g.r(42, 92, 1, 10, K.stoneLo);
    // bellows leaning on the side
    g.box(56, 66, 7, 16, '#6b4a2c', '#8a6038', '#3f2a1a'); g.r(58, 62, 3, 4, K.iron);
  }
  function drawPatterns(g, w, h, st) {
    g.box(0, 0, w, h, '#6b4f33', '#8a6a46', '#4a3522');                                         // board
    const n = Math.max(1, st.n || 1), styles = st.styles || ['#b8c0c6'], r = rnd(5);
    for (let i = 0; i < Math.min(6, n); i++) {                                                   // pinned pattern sheets
      const x = 3 + (i % 3) * 11, y = 3 + Math.floor(i / 3) * 13;
      g.box(x, y, 10, 12, K.paper, '#f6eedc', K.paperLo); g.p(x + 5, y + 1, '#c8401a');
      g.line(x + 2, y + 9, x + 7, y + 3, styles[i % styles.length]); g.p(x + 2, y + 10, K.bronze);
    }
    for (let i = n; i < 6; i++) { const x = 3 + (i % 3) * 11, y = 3 + Math.floor(i / 3) * 13; g.r(x + 4, y, 1, 1, K.woodDk); }
    if (r() < 2) g.r(1, h - 3, w - 2, 1, '#4a3522');
  }
  function drawHammers(g, w, h, st) {
    g.box(0, 2, w, 6, K.wood, K.woodHi, K.woodLo);                                               // the rack board
    const n = Math.max(1, st.n || 1), heads = [K.ironLo, K.iron, K.steel];
    for (let i = 0; i < 3; i++) {
      const x = 5 + i * 9; g.r(x + 1, 3, 2, 2, K.woodDk);
      if (i >= n) continue;
      g.r(x + 1, 6, 2, 16, i === 2 ? '#3a2a1a' : K.woodHi); g.r(x + 1, 6, 1, 16, K.woodLo);      // handle
      g.box(x - 2, 18, 8, 5, heads[i], K.ironHi, K.ironLo);                                     // head
    }
  }
  const ANVIL_TINT = [['#4b4744', '#6b6560', '#2f2c2a'], ['#5d6166', '#9aa2a9', '#3a3d41'], ['#6a7a8a', '#b8c8d6', '#3e4a56'], ['#5e4c44', '#a08c7c', '#3a2d27'], ['#d8d0bc', '#f4eedc', '#8c846f']];
  function drawAnvil(g, w, h, st) {
    const [c, hi, lo] = ANVIL_TINT[Math.max(0, Math.min(4, st.lv || 0))];
    g.r(2, 4, 36, 1, K.ink); g.r(1, 5, 39, 7, K.ink);
    g.r(2, 5, 37, 6, c); g.r(2, 5, 37, 1, hi);                                                    // the face
    for (let i = 0; i < 9; i++) g.r(0 + i, 8 - Math.floor(i / 3), 1, 1 + Math.floor(i / 3), c);   // the horn
    g.r(0, 7, 2, 2, c); g.r(36, 11, 3, 2, lo);
    g.r(13, 12, 16, 8, K.ink); g.r(14, 12, 14, 8, c); g.r(14, 12, 1, 8, hi); g.r(27, 12, 1, 8, lo);   // the waist
    g.r(8, 20, 26, 8, K.ink); g.r(9, 20, 24, 7, c); g.r(9, 20, 24, 1, hi); g.r(9, 26, 24, 1, lo);     // the foot
    g.r(5, 27, 32, 3, K.woodLo); g.r(5, 27, 32, 1, K.woodHi);                                      // the stump
    if (st.lv === 3) for (let x = 4; x < 36; x += 3) g.p(x, 7 + (x % 2), '#7d6658');               // damascus ripples
  }
  function drawBarrel(g, w, h, st) {
    g.r(2, 3, 20, 30, K.ink); g.r(1, 6, 22, 24, K.ink);
    for (let x = 2; x < 22; x++) { const c = x % 5 === 0 ? K.woodLo : x < 6 ? K.woodHi : x > 18 ? K.woodLo : K.wood; g.r(x, 4, 1, 28, c); }
    g.r(1, 7, 22, 3, K.ironLo); g.r(1, 7, 22, 1, K.iron); g.r(1, 24, 22, 3, K.ironLo); g.r(1, 24, 22, 1, K.iron);
    const liq = st.q === 'water' ? ['#2f6fae', '#6fb2e8'] : st.q === 'brine' ? ['#5b7480', '#8fa7b0'] : ['#5a3a10', '#8f6424'];
    g.r(3, 2, 18, 3, K.ink); g.r(4, 3, 16, 2, liq[0]); g.r(6, 3, 6, 1, liq[1]);
  }
  function drawCoal(g, w, h, st) {
    g.r(3, 8, 24, 20, K.ink); g.r(1, 12, 28, 15, K.ink);
    g.r(4, 9, 22, 18, K.sack); g.r(2, 13, 26, 13, K.sack); g.r(4, 9, 22, 2, K.sackHi); g.r(22, 13, 4, 13, K.sackLo);
    for (let y = 14; y < 26; y += 4) for (let x = 5; x < 24; x += 5) g.p(x + (y % 8 ? 2 : 0), y, K.sackLo);
    const r = rnd(11); g.ell(15, 8, 9, 4, K.coal);
    for (let i = 0; i < 26; i++) g.p(7 + r() * 16, 5 + r() * 6, pick(r, [K.coal, K.coalHi, '#2a2624']));
    g.r(2, 26, 26, 2, 'rgba(0,0,0,.35)');
  }
  function drawIron(g, w, h, st) {
    const bar = (x, y) => { g.r(x, y, 14, 5, K.ink); g.r(x + 1, y + 1, 12, 3, K.iron); g.r(x + 2, y + 1, 10, 1, K.ironHi); g.r(x + 1, y + 3, 12, 1, K.ironLo); };
    bar(2, 15); bar(16, 15); bar(9, 10); bar(23, 10); bar(5, 5); bar(19, 5); g.r(1, 20, 32, 2, 'rgba(0,0,0,.35)');
  }
  function drawBench(g, w, h, st) {
    g.box(0, 2, w, 7, K.woodHi, '#9a7046', K.wood);                                               // the top
    g.r(4, 9, 5, 31, K.ink); g.r(5, 9, 3, 30, K.wood); g.r(w - 9, 9, 5, 31, K.ink); g.r(w - 8, 9, 3, 30, K.wood);
    g.box(3, 26, w - 6, 4, K.wood, K.woodHi, K.woodLo);                                         // the shelf
    g.box(10, 18, 14, 8, '#8a7a62', '#a8977c', '#6b5c48');                                      // a rag pile
    g.r(30, 21, 10, 5, K.sackLo); g.r(31, 21, 8, 1, K.sack);
  }
  function drawStone(g, w, h, st) {
    const c = st.c || '#b59a74';
    g.r(3, 22, 4, 8, K.ink); g.r(4, 22, 2, 8, K.wood); g.r(w - 7, 22, 4, 8, K.ink); g.r(w - 6, 22, 2, 8, K.wood);   // the frame
    g.ell(14, 13, 12, 12, K.ink); g.ell(14, 13, 11, 11, c); g.ell(12, 11, 7, 7, shade(c, 18)); g.ell(14, 13, 3, 3, shade(c, -30));
    g.r(13, 12, 3, 3, K.iron); g.r(2, 13, 24, 1, 'rgba(0,0,0,.15)');
    g.r(0, 27, w, 3, K.woodLo); g.r(0, 27, w, 1, K.woodHi);                                       // the trough
    g.r(3, 28, w - 6, 1, '#4f87b8');
  }
  function drawBottles(g, w, h, st) {
    const cols = st.cols && st.cols.length ? st.cols : ['#9fd3ff'];
    cols.slice(0, 3).forEach((c, i) => {
      const x = 1 + i * 6, y = i === 1 ? 3 : 6;
      g.r(x, y + 4, 5, 20 - y - 4, K.ink); g.r(x + 1, y + 5, 3, 20 - y - 6, c); g.r(x + 1, y + 5, 1, 20 - y - 6, 'rgba(255,255,255,.45)');
      g.r(x + 1, y, 3, 5, K.ink); g.r(x + 2, y + 1, 1, 3, '#cfd6de'); g.r(x + 1, y, 3, 1, K.bronze);   // neck and cork
    });
  }
  function drawTable(g, w, h, st) {
    g.box(0, 2, w, 7, '#3d2a1e', '#5a3f2c', '#2a1b12');                                          // dark wood top
    g.r(2, 4, w - 4, 3, K.cloth); g.r(2, 7, w - 4, 6, K.cloth); for (let x = 4; x < w - 4; x += 6) g.p(x, 12, K.straw);   // the cloth
    g.r(5, 13, 5, 27, K.ink); g.r(6, 13, 3, 26, '#3d2a1e'); g.r(w - 10, 13, 5, 27, K.ink); g.r(w - 9, 13, 3, 26, '#3d2a1e');
    g.box(4, 28, w - 8, 4, '#3d2a1e', '#5a3f2c', '#2a1b12');
    const r = rnd(21); for (let i = 0; i < 4; i++) g.p(8 + r() * (w - 16), 18 + r() * 8, st.lock ? '#555' : K.glow);   // drifting motes
  }
  function drawBook(g, w, h, st) {
    g.r(1, 3, w - 2, 11, K.ink); g.r(2, 4, w - 4, 9, '#6b2f3a');                                  // the cover
    g.r(3, 2, 8, 10, K.paper); g.r(13, 2, 8, 10, K.paper); g.r(11, 2, 2, 11, K.paperLo);          // the pages
    const n = Math.min(8, st.n || 1);
    for (let i = 0; i < 4; i++) g.r(4, 4 + i * 2, 6, 1, i < n ? '#6b5a8c' : K.paperLo);
    for (let i = 0; i < 4; i++) g.r(14, 4 + i * 2, 6, 1, i + 4 < n ? '#6b5a8c' : K.paperLo);
    g.p(16, 3, K.glow); g.r(w - 4, 12, 2, 3, K.straw);                                            // a ribbon
  }
  function drawChisel(g, w, h, st) {
    const tip = ['#8a7a62', '#9aa2a9', '#b8c8d6', '#e6e0ff'][Math.max(0, Math.min(3, st.lv || 0))];
    g.r(1, 4, 7, 3, K.ink); g.r(2, 5, 5, 1, K.woodHi); g.r(8, 4, 5, 3, K.ink); g.r(8, 5, 5, 1, tip); g.p(13, 5, tip);   // the chisel
    g.r(3, 7, 8, 3, K.ink); g.r(4, 8, 6, 1, K.wood);                                              // a mallet handle
  }
  function drawConduit(g, w, h, st) {
    const c = st.c || '#c8794a';
    g.r(3, h - 6, 8, 6, K.ink); g.r(4, h - 5, 6, 4, K.bronze); g.r(6, 14, 2, h - 20, K.bronze); g.r(6, 14, 1, h - 20, '#d89a5e');   // the stand
    for (let y = 0; y < 16; y++) { const hw = y < 8 ? Math.floor(y / 2) + 1 : Math.floor((16 - y) / 2); g.r(7 - hw, 1 + y, hw * 2, 1, K.ink); g.r(8 - hw, 1 + y, Math.max(1, hw * 2 - 2), 1, c); }
    g.r(6, 4, 1, 6, 'rgba(255,255,255,.6)');
  }
  function door(g, w, h, seed, glass, night) {
    g.box(0, 0, w, h, K.stoneLo, K.stoneHi, K.ink);                                               // the frame
    g.r(4, 6, w - 8, h - 6, K.ink);
    for (let x = 5; x < w - 4; x++) g.r(x, 7, 1, h - 8, (x - 5) % 6 === 0 ? K.woodDk : x < 9 ? K.woodHi : K.wood);
    g.box(6, 16, w - 12, 3, K.ironLo, K.iron, K.ink); g.box(6, h - 22, w - 12, 3, K.ironLo, K.iron, K.ink);   // straps
    g.r(w - 11, h / 2, 3, 4, K.straw); g.r(w - 10, h / 2 + 1, 1, 2, K.bronze);                     // the handle
    if (glass) { g.r(9, 24, w - 18, 18, K.ink); g.r(10, 25, w - 20, 16, night ? '#1d2a4a' : '#a5c2da'); g.r(w / 2, 25, 1, 16, K.woodDk); }
  }
  function sign(g, x, y, w, h, kind) {
    g.r(x + 3, y - 3, 1, 3, K.ironLo); g.r(x + w - 4, y - 3, 1, 3, K.ironLo);
    g.box(x, y, w, h, K.woodHi, '#9a7046', K.woodLo);
    const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2);
    if (kind === 'coin') { g.ell(cx, cy, 3, 3, K.straw); g.r(cx, cy - 2, 1, 4, K.bronze); }
    else if (kind === 'anvil') { g.r(cx - 4, cy - 2, 8, 2, K.ink); g.r(cx - 1, cy, 3, 2, K.ink); g.r(cx - 3, cy + 2, 6, 1, K.ink); }
    else if (kind === 'sack') { g.r(cx - 3, cy - 1, 6, 4, K.ink); g.r(cx - 1, cy - 3, 2, 2, K.ink); }
  }
  function drawDoorShop(g, w, h, st) { door(g, w, h - 10, 1, false, st.night); sign(g, 6, h - 9, w - 12, 8, 'coin'); g.r(0, h - 10, w, 0, K.ink); }
  function drawDoorBack(g, w, h, st) { door(g, w, h - 10, 2, false, st.night); sign(g, 6, h - 9, w - 12, 8, 'anvil'); }
  function drawDoorStreet(g, w, h, st) { door(g, w, h - 10, 3, true, st.night); sign(g, 6, h - 9, w - 12, 8, 'sack'); }

  // ---------------------------------------------------------------- the Shop
  function drawShopBg(g, w, h, st) {
    const r = rnd(13);
    g.r(0, 0, W, 136, '#3b2a1f');
    for (let x = 0; x < W; x += 10) { g.r(x, 10, 10, 124, pick(r, ['#4a3424', '#503827', '#46311f'])); g.r(x, 10, 1, 124, '#2e2017'); }   // wall panels
    g.r(0, 80, W, 3, K.woodHi); g.r(0, 83, W, 1, K.woodDk);                                                                              // dado rail
    for (let y = 0; y < 18; y++) g.r(0, y, W, 1, `rgba(10,8,7,${(18 - y) / 26})`);
    g.box(0, 0, W, 9, K.woodLo, K.woodHi, K.woodDk);
    windowPane(g, 214, 24, 38, 30, st.night, true);
    g.r(0, 133, W, 4, K.woodDk); g.r(0, 134, W, 1, K.woodLo);
    // a flagstone floor
    for (let y = 137, row = 0; y < H; y += 8, row++) for (let x = -(row % 2) * 9; x < W; x += 18) { g.r(x, y, 17, 7, pick(r, ['#5a5249', '#625a50', '#544c44'])); g.r(x, y, 17, 1, 'rgba(255,255,255,.06)'); }
    // a lamp hanging from the beam
    g.r(160, 9, 1, 8, K.ironLo); g.box(156, 17, 9, 7, '#ffcf6a', '#fff0b8', '#c89a3a');
    for (let i = 0; i < 5; i++) g.r(150 - i * 6, 26 + i * 6, 22 + i * 12, 6, `rgba(255,210,120,${.05 - i * .008})`);
  }
  function drawBoard(g, w, h, st) {
    g.box(0, 0, w, h, '#8a6a46', '#a8855a', '#5e4630'); g.r(3, 3, w - 6, h - 6, '#b08a5a');    // a cork board
    const r = rnd(17); for (let i = 0; i < 40; i++) g.p(3 + r() * (w - 6), 3 + r() * (h - 6), '#9a7848');
    const n = Math.min(3, st.n == null ? 3 : st.n), fit = st.fit || 0;
    for (let i = 0; i < n; i++) {
      const x = 4 + i * 14, y = 5 + (i % 2) * 4;
      g.box(x, y, 12, 16, K.paper, '#f6eedc', K.paperLo);
      for (let l = 0; l < 4; l++) g.r(x + 2, y + 4 + l * 3, 8 - (l % 2) * 3, 1, '#8a7a62');
      g.p(x + 6, y + 1, i < fit ? '#8fbf7a' : '#c8401a');
    }
    g.box(6, h - 9, w - 12, 6, K.woodHi, '#9a7046', K.woodLo);                                    // "Commissions" plaque
    g.r(10, h - 7, w - 20, 1, K.woodDk); g.r(10, h - 5, w - 26, 1, K.woodDk);
  }
  function drawRacks(g, w, h, st) {
    const slots = Math.max(1, st.slots || 3), filled = st.cols || [];
    for (const sy of [30, 66]) {                                                                   // two wall shelves
      g.box(0, sy, w, 5, K.woodHi, '#9a7046', K.woodLo);
      g.r(6, sy + 5, 3, 5, K.woodLo); g.r(w - 9, sy + 5, 3, 5, K.woodLo);
    }
    for (let i = 0; i < 8; i++) {
      const row = i < 4 ? 0 : 1, col = i % 4, x = 10 + col * 23, base = row ? 66 : 30, open = i < slots;
      if (!open) { g.r(x + 2, base - 3, 6, 3, 'rgba(0,0,0,.25)'); continue; }
      g.r(x - 1, base - 2, 12, 2, K.woodDk);                                                       // a stand
      const c = filled[i];
      if (c) {                                                                                     // a blade on display, point up
        g.r(x + 4, base - 26, 3, 20, K.ink); g.r(x + 5, base - 26, 1, 19, K.steel); g.p(x + 5, base - 27, K.steel);
        g.r(x + 1, base - 7, 9, 2, c); g.r(x + 4, base - 5, 3, 3, K.woodHi);
      } else { g.r(x + 3, base - 4, 5, 2, '#2c2118'); }
      g.r(x + 2, base + 6, 7, 4, K.paper); g.r(x + 3, base + 7, 4, 1, '#8a7a62');                 // a price tag
    }
  }
  // over the racks PNG: a stand on every open slot, the listed blades in their rarity colour, a price tag under each
  function drawRackItems(g, w, h, st) {
    const slots = Math.max(1, st.slots || 3), filled = st.cols || [];
    for (let i = 0; i < Math.min(8, slots); i++) {
      const x = 12 + (i % 4) * 22, base = i < 4 ? 24 : 53, c = filled[i];
      g.r(x - 1, base - 4, 12, 4, K.ink); g.r(x, base - 3, 10, 2, K.woodHi); g.r(x, base - 1, 10, 1, K.woodLo); // a stand
      if (c) {                                                                                     // a blade on display, point up
        g.r(x + 4, base - 19, 3, 14, K.ink); g.r(x + 5, base - 19, 1, 13, K.steel); g.p(x + 5, base - 20, K.ink);
        g.r(x + 1, base - 7, 9, 2, c); g.r(x + 4, base - 5, 3, 3, K.woodHi);
      } else g.r(x + 3, base - 3, 5, 1, K.woodDk);
      g.r(x + 1, base + 2, 9, 5, K.ink); g.r(x + 2, base + 3, 7, 3, K.paper); g.r(x + 3, base + 4, 4, 1, '#8a7a62');     // a price tag on the shelf edge
    }
  }
  function drawCounter(g, w, h, st) {
    g.box(w - 26, 2, 14, 7, '#c9a04a', K.straw, K.bronze); g.r(w - 20, 4, 2, 2, K.ink);            // a cash box
    g.ell(18, 7, 3, 1, K.straw); g.p(23, 8, K.straw);                                             // coins
    g.box(0, 9, w, 6, '#7a5534', '#9a7046', K.woodLo);
    g.r(2, 15, w - 4, h - 15, K.ink); for (let x = 3; x < w - 3; x++) g.r(x, 15, 1, h - 16, (x - 3) % 8 === 0 ? K.woodDk : K.wood);
    g.box(6, 21, w - 12, 3, K.woodLo, K.woodHi, K.woodDk);
  }
  function drawCrate(g, w, h, st) {
    g.box(0, 4, w, h - 4, K.wood, K.woodHi, K.woodLo); g.r(1, 10, w - 2, 1, K.woodDk); g.r(1, 15, w - 2, 1, K.woodDk);
    g.line(2, 5, w - 3, h - 2, K.woodDk);
    for (let i = 0; i < 3; i++) g.box(3 + i * 6, 0, 5, 6, K.woodHi, '#9a7046', K.woodLo);          // new planks sticking out
  }
  function drawFlyers(g, w, h, st) {
    const n = Math.max(1, Math.min(4, 1 + (st.lv || 0)));
    for (let i = 0; i < n; i++) {
      const x = 1 + (i % 2) * 6, y = 1 + Math.floor(i / 2) * 10 + (i % 2) * 3;
      g.box(x, y, 12, 15, i % 2 ? '#e8d6a8' : K.paper, '#f6eedc', K.paperLo); g.p(x + 6, y + 1, '#c8401a');
      g.r(x + 2, y + 4, 8, 2, '#8a5a3a'); for (let l = 0; l < 3; l++) g.r(x + 2, y + 8 + l * 2, 7 - l, 1, '#8a7a62');
    }
  }
  function drawScrap(g, w, h, st) {
    g.r(4, 30, 6, 6, K.ink); g.ell(7, 32, 3, 3, K.woodLo);                                        // a wheel
    g.r(2, 14, 34, 16, K.ink); g.r(3, 15, 32, 14, '#5a4a3c'); g.r(3, 15, 32, 1, '#7a6650');       // the cart
    g.r(34, 20, 6, 2, K.woodLo); g.r(28, 30, 2, 5, K.woodLo);
    const r = rnd(23); for (let i = 0; i < 30; i++) g.p(5 + r() * 28, 9 + r() * 7, pick(r, [K.iron, K.ironHi, K.ironLo, K.bronze, '#7a3a2a']));
    g.line(8, 8, 18, 3, K.steel); g.line(20, 10, 30, 5, K.ironHi);
    g.box(12, 0, 16, 8, K.paper, '#f6eedc', K.paperLo); g.r(14, 3, 12, 2, '#c8401a');              // the "40%" sign
  }

  function shade(hex, d) { const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, v + d)); return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join(''); }

  window.SCENE = SCENE;
})();
