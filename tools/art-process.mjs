// Turn high-res generated images (art-src/) into real pixel art for the 320 x 180 scene grid (docs/redesign/06-scenes.md).
//   node tools/art-process.mjs <list.json> [only-name ...]
// list.json is a list of jobs:
//   { "src": "art-src/workshop_anvil.png", "out": "www/art/workshop_anvil.png", "mode": "sprite", "box": [42, 30], ... }
// mode "sprite" (an element with a transparent background):
//   key the flat background colour out (sampled from the image border, or "key": "#ff00ff"; "tol": colour distance),
//   erode the edge ("erode" source pixels), trim to the subject, fit it into "box" (scene units, aspect kept),
//   area-average down, hard alpha threshold ("alpha", 0..1), reduce to "colors" colours, add an optional 1-unit
//   "outline" colour, then scale up "scale" (default 4) times with nearest neighbour.
//   "crop": [x, y, w, h] (0..1 of the source) looks at one part of the image only. "rotate": 90 or -90 turns it first.
//   The key colour's spill is taken out of what is left (magenta seen through glass turns grey), unless "despill": false.
//   "canvas": true makes the PNG exactly box-sized with the picture at the bottom centre ("anchor": "top" puts it at the top).
// mode "bg" (an opaque background): crop to 16:9 ("cropY": 0..1, where the crop sits vertically), scale to box, reduce colours.
// Prints the final size of each picture in scene units. No dependencies: PNG decode/encode use node's zlib.
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

// ---------------------------------------------------------------- PNG
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w, h, depth, type, interlace, plte = null, trns = null; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === 'PLTE') plte = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} is not supported (8 only)`);
  if (interlace) throw new Error('interlaced PNGs are not supported');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]; if (!ch) throw new Error(`colour type ${type} is not supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[o + x - ch] : 0, b = y ? px[o - stride + x] : 0, c = x >= ch && y ? px[o - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch, d = i * 4;
    if (type === 6) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]; }
    else if (type === 2) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255; }
    else if (type === 0) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = 255; }
    else if (type === 4) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = px[s + 1]; }
    else { const k = px[s]; out[d] = plte[k * 3]; out[d + 1] = plte[k * 3 + 1]; out[d + 2] = plte[k * 3 + 2]; out[d + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { w, h, data: out };
}

export function encodePNG(w, h, data) {
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- image helpers (RGBA Uint8Array, w, h)
const hex = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(s); if (!m) throw new Error(`bad colour ${s}`); const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

function crop(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y)); w = Math.min(img.w - x, Math.round(w)); h = Math.min(img.h - y, Math.round(h));
  const d = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) d.set(img.data.subarray(((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4), r * w * 4);
  return { w, h, data: d };
}

// the background colour: the median of the border pixels
function borderColour(img) {
  const rs = [], gs = [], bs = [];
  const add = (x, y) => { const i = (y * img.w + x) * 4; rs.push(img.data[i]); gs.push(img.data[i + 1]); bs.push(img.data[i + 2]); };
  for (let x = 0; x < img.w; x += 2) { add(x, 0); add(x, img.h - 1); }
  for (let y = 0; y < img.h; y += 2) { add(0, y); add(img.w - 1, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

// key out the background: everything within tol of the key colour that touches the border (flood fill),
// plus anything anywhere within tol*0.6 (holes between handles and so on)
function keyOut(img, key, tol) {
  const { w, h, data } = img, n = w * h, near = new Uint8Array(n);
  const dist = (i) => Math.hypot(data[i * 4] - key[0], data[i * 4 + 1] - key[1], data[i * 4 + 2] - key[2]);
  for (let i = 0; i < n; i++) { const d = dist(i); near[i] = d < tol * 0.6 ? 2 : d < tol ? 1 : 0; }
  const bg = new Uint8Array(n), st = [];
  const push = (i) => { if (!bg[i] && near[i]) { bg[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) { const i = st.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
  for (let i = 0; i < n; i++) if (bg[i] || near[i] === 2 || data[i * 4 + 3] < 128) data[i * 4 + 3] = 0;
}

// take the key colour's tint out of the kept pixels (classic despill: limit the channels the key colour is made of)
function despill(img, key) {
  const { data } = img, hi = [0, 1, 2].filter((c) => key[c] > 128), lo = [0, 1, 2].filter((c) => key[c] <= 128);
  if (!hi.length || !lo.length) return;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const ex = Math.min(...hi.map((c) => data[i + c])) - Math.max(...lo.map((c) => data[i + c]));
    if (ex > 0) for (const c of hi) data[i + c] -= ex;
  }
}

function rotate(img, deg) {
  const { w, h, data } = img, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [nx, ny] = deg === 90 ? [h - 1 - y, x] : [y, w - 1 - x];
    d.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ny * h + nx) * 4);
  }
  return { w: h, h: w, data: d };
}

// shrink the opaque area by r pixels (drops the soft fringe that still has the key colour in it)
function erode(img, r) {
  const { w, h, data } = img;
  for (let k = 0; k < r; k++) {
    const a = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) a[i] = data[i * 4 + 3];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!a[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !a[i - 1] || !a[i + 1] || !a[i - w] || !a[i + w]) data[i * 4 + 3] = 0;
    }
  }
}

// drop small specks: opaque components smaller than min pixels
function despeck(img, min) {
  const { w, h, data } = img, n = w * h, lab = new Int32Array(n).fill(-1);
  for (let s = 0; s < n; s++) {
    if (lab[s] !== -1 || !data[s * 4 + 3]) continue;
    const comp = [s]; lab[s] = s;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < n && lab[j] === -1 && data[j * 4 + 3]) { lab[j] = s; comp.push(j); }
    }
    if (comp.length < min) for (const i of comp) data[i * 4 + 3] = 0;
  }
}

function bbox(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('nothing left after keying');
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

// area-averaging resize with premultiplied alpha (float result)
function resize(img, ow, oh) {
  const { w, h, data } = img;
  const pass = (src, sw, sh, dw, horiz) => {   // resize one axis
    const len = horiz ? sw : sh, other = horiz ? sh : sw, out = new Float64Array((horiz ? dw * sh : sw * dw) * 4), f = len / dw;
    for (let o = 0; o < other; o++) for (let d = 0; d < dw; d++) {
      const a = d * f, b = a + f; let acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0;
      for (let s = Math.floor(a); s < Math.ceil(b); s++) {
        const wt = Math.min(b, s + 1) - Math.max(a, s); if (wt <= 0) continue;
        const i = (horiz ? o * sw + s : s * sw + o) * 4; acc0 += src[i] * wt; acc1 += src[i + 1] * wt; acc2 += src[i + 2] * wt; acc3 += src[i + 3] * wt;
      }
      const j = (horiz ? o * dw + d : d * sw + o) * 4; out[j] = acc0 / f; out[j + 1] = acc1 / f; out[j + 2] = acc2 / f; out[j + 3] = acc3 / f;
    }
    return out;
  };
  const pm = new Float64Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const a = data[i * 4 + 3] / 255; pm[i * 4] = data[i * 4] * a; pm[i * 4 + 1] = data[i * 4 + 1] * a; pm[i * 4 + 2] = data[i * 4 + 2] * a; pm[i * 4 + 3] = a; }
  return pass(pass(pm, w, h, ow, true), ow, h, oh, false);
}

// premultiplied float -> RGBA with a hard alpha threshold
function harden(f, w, h, thr) {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = f[i * 4 + 3]; if (a < thr || a <= 0) continue;
    d[i * 4] = Math.round(Math.min(255, f[i * 4] / a)); d[i * 4 + 1] = Math.round(Math.min(255, f[i * 4 + 1] / a)); d[i * 4 + 2] = Math.round(Math.min(255, f[i * 4 + 2] / a)); d[i * 4 + 3] = 255;
  }
  return { w, h, data: d };
}

// median cut over the opaque pixels, then map every pixel to its nearest palette colour
function quantize(img, n) {
  const px = [];
  for (let i = 0; i < img.w * img.h; i++) if (img.data[i * 4 + 3]) px.push([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]);
  if (px.length <= n) return;
  let boxes = [px];
  while (boxes.length < n) {
    let bi = -1, best = -1, ch = 0;
    boxes.forEach((b, k) => { if (b.length < 2) return; for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; } const r = (hi - lo) * Math.sqrt(b.length); if (r > best) { best = r; bi = k; ch = c; } } });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch]), m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  const pal = boxes.map((b) => [0, 1, 2].map((c) => Math.round(b.reduce((s, p) => s + p[c], 0) / b.length)));
  for (let i = 0; i < img.w * img.h; i++) {
    if (!img.data[i * 4 + 3]) continue;
    let bd = Infinity, bc = pal[0];
    for (const c of pal) { const d = (img.data[i * 4] - c[0]) ** 2 * 0.3 + (img.data[i * 4 + 1] - c[1]) ** 2 * 0.59 + (img.data[i * 4 + 2] - c[2]) ** 2 * 0.11; if (d < bd) { bd = d; bc = c; } }
    img.data[i * 4] = bc[0]; img.data[i * 4 + 1] = bc[1]; img.data[i * 4 + 2] = bc[2];
  }
}

// contrast/saturation/brightness touch-up around mid grey (generated sprites come out a little flat when shrunk)
function tone(img, { contrast = 1, saturation = 1, brightness = 1 }) {
  for (let i = 0; i < img.w * img.h; i++) {
    if (!img.data[i * 4 + 3]) continue;
    let [r, g, b] = [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    [r, g, b] = [r, g, b].map((v) => ((l + (v - l) * saturation) - 128) * contrast + 128).map((v) => v * brightness);
    img.data[i * 4] = Math.max(0, Math.min(255, Math.round(r))); img.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g))); img.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
}

// a 1-unit outline on the transparent pixels next to opaque ones (the canvas grows by 1 on every side)
function outline(img, col) {
  const w = img.w + 2, h = img.h + 2, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < img.h; y++) d.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((y + 1) * w + 1) * 4);
  const a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] === 255;
  const add = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) add.push(y * w + x);
  for (const i of add) { d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 254; }
  for (const i of add) d[i * 4 + 3] = 255;
  return { w, h, data: d };
}

function upscale(img, s) {
  const w = img.w * s, h = img.h * s, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(img.data.subarray(((Math.floor(y / s)) * img.w + Math.floor(x / s)) * 4, ((Math.floor(y / s)) * img.w + Math.floor(x / s)) * 4 + 4), (y * w + x) * 4);
  return { w, h, data: d };
}

// ---------------------------------------------------------------- one job
export function processJob(j) {
  let img = decodePNG(readFileSync(abs(j.src)));
  if (j.rotate) img = rotate(img, j.rotate);
  if (j.crop) img = crop(img, j.crop[0] * img.w, j.crop[1] * img.h, j.crop[2] * img.w, j.crop[3] * img.h);
  const scale = j.scale || 4, [BW, BH] = j.box;
  let small;
  if (j.mode === 'bg') {
    const ch = Math.min(img.h, Math.round(img.w * BH / BW)), cw = Math.round(ch * BW / BH);
    img = crop(img, (img.w - cw) / 2, (img.h - ch) * (j.cropY == null ? 0.5 : j.cropY), cw, ch);
    small = harden(resize(img, BW, BH), BW, BH, 0.01);
  } else {
    const key = j.key ? hex(j.key) : borderColour(img);
    keyOut(img, key, j.tol || 90);
    if (j.erode !== 0) erode(img, j.erode || 2);
    despeck(img, j.speck || 400);
    if (j.despill !== false) despill(img, key);
    const [x, y, w, h] = bbox(img);
    img = crop(img, x, y, w, h);
    const pad = j.outline ? 2 : 0, s = Math.min((BW - pad) / w, (BH - pad) / h);
    const ow = Math.max(1, Math.round(w * s)), oh = Math.max(1, Math.round(h * s));
    small = harden(resize(img, ow, oh), ow, oh, j.alpha || 0.5);
  }
  if (j.tone) tone(small, j.tone);
  if (j.colors) quantize(small, j.colors);
  if (j.outline) small = outline(small, hex(j.outline));
  if (j.canvas && j.mode !== 'bg') {   // place the picture on a box-sized transparent canvas
    const c = { w: BW, h: BH, data: new Uint8Array(BW * BH * 4) }, ox = Math.floor((BW - small.w) / 2), oy = j.anchor === 'top' ? 0 : BH - small.h;
    for (let y = 0; y < small.h; y++) c.data.set(small.data.subarray(y * small.w * 4, (y + 1) * small.w * 4), ((oy + y) * BW + ox) * 4);
    small = c;
  }
  const big = upscale(small, scale);
  writeFileSync(abs(j.out), encodePNG(big.w, big.h, big.data));
  return { w: small.w, h: small.h };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [list, ...only] = process.argv.slice(2);
  if (!list) { console.log('usage: node tools/art-process.mjs <list.json> [only-name ...]'); process.exit(1); }
  for (const j of JSON.parse(readFileSync(abs(list), 'utf8'))) {
    const name = path.basename(j.out, '.png');
    if (only.length && !only.includes(name)) continue;
    try { const r = processJob(j); console.log(`${name}: ${r.w} x ${r.h} units (box ${j.box.join(' x ')})`); }
    catch (e) { console.log(`${name}: ${e.message}`); }
  }
}
