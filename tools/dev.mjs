// Play the game on this computer against a throwaway copy of the backend: `npm run dev`, then open http://127.0.0.1:8130
// The database lives in memory and is gone when you stop this (Ctrl+C). Nothing touches the real Supabase project.
//   npm run dev        the game as players get it
//   npm run dev:test   the same with test mode on (shelves sell 20x sooner, more Tempered/Starforged, short digs and auctions)
// Playtest helpers (docs/redesign/PLAYTEST.md): this file alone answers /dev/ping and /dev/grant. They exist only here,
// never in the real server, so the game's dev panel only ever appears on this local copy.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { startBackend, ROOT } from '../tests/harness.mjs';

const PORT = Number(process.env.PORT || 8130), W = path.join(ROOT, 'www'), TEST = process.env.AM_DEV_TEST === '1' || process.argv.includes('--test');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
const B = await startBackend();

// ---- playtest helpers: change the signed-in player's save in the local in-memory database
// the game's rules, read fresh each time (so a change to rules.js needs no restart)
function rules() { const g = { console }; g.globalThis = g; vm.runInNewContext(readFileSync(path.join(W, 'js/rules.js'), 'utf8'), g); return g.AMR; }
const readBody = (q) => new Promise((res) => { const c = []; q.on('data', (d) => c.push(d)); q.on('end', () => res(Buffer.concat(c))); });
const GRANTS = {
  materials: 'Adds 5,000 coin, 50 iron, 50 coal, 20 damascus, 5 star-shards, 30 star-dust and 30 grit.',
  polish: 'Unlocks polishing: Medium pattern, the polishing bench, and 20 forges counted.',
  enchant: 'Unlocks enchanting: everything polishing needs, the Steel Anvil, the enchanter’s table, and 40 polishes counted.',
  all: 'Unlocks everything in the Workshop (every tree, all 8 shelves) and counts every requirement as met.',
};
function grant(S, kind) {
  const R = rules(), c = S && S.slots && S.slots[S.active || 0];
  if (!c) throw new Error('Make a smith first.');
  const own = (k) => { const u = R.UNLOCKS[k]; if (!u) return; if (u.tier) c[u.tier[0]] = Math.max(c[u.tier[0]] || 0, u.tier[1]); else { c.recipes = c.recipes || {}; c.recipes[k] = true; } };
  const stat = (o) => { c.stat = c.stat || {}; for (const [k, v] of Object.entries(o)) c.stat[k] = Math.max(c.stat[k] || 0, v); };
  if (kind === 'materials') {
    const add = { coin: 5000, iron: 50, coal: 50, damascus: 20, shards: 5, dust: 30, grit: 30 };
    for (const [k, v] of Object.entries(add)) c[k] = (c[k] || 0) + v;
  } else if (kind === 'polish') { ['M', 'polish'].forEach(own); c.forged = Math.max(c.forged || 0, 20); c.grit = Math.max(c.grit || 0, 10); }
  else if (kind === 'enchant') { ['M', 'polish', 'anvil1', 'anvil2', 'enchant'].forEach(own); c.forged = Math.max(c.forged || 0, 20); stat({ pol: 40 }); c.grit = Math.max(c.grit || 0, 10); c.mana = Math.max(c.mana || 0, R.MANA_MAX || 20); }
  else if (kind === 'all') {
    R.UNLOCK_KEYS.forEach(own); c.forged = Math.max(c.forged || 0, 20);
    stat({ pol: 40, pgood: 15, runes: 120, r70: 10, r80: 25, r90: 10 }); c.mana = Math.max(c.mana || 0, R.MANA_MAX || 20);
  } else throw new Error('Unknown grant.');
}
async function devGrant(q, r) {
  const send = (code, o) => { r.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)); };
  try {
    const kind = String(JSON.parse(String(await readBody(q)) || '{}').kind || ''); if (!GRANTS[kind]) return send(400, { error: 'Unknown grant.' });
    const h = q.headers.authorization || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) return send(401, { error: 'Sign in first.' });
    const s = await B.db.query('select uid from public.am_sessions where hash = $1 and exp > $2', [createHash('sha256').update(t).digest('hex'), Date.now()]);
    if (!s.rows.length) return send(401, { error: 'Sign in first.' });
    const uid = s.rows[0].uid, row = (await B.db.query('select save from public.am_saves where uid = $1', [uid])).rows[0];
    const S = row && (typeof row.save === 'string' ? JSON.parse(row.save) : row.save);
    grant(S, kind);
    await B.db.query('update public.am_saves set save = $1, rev = rev + 1 where uid = $2', [JSON.stringify(S), uid]);
    send(200, { ok: true, kind, d: GRANTS[kind] });
  } catch (e) { send(400, { error: e.message || 'That didn’t work.' }); }
}

http.createServer(async (q, r) => {
  const url = q.url.split('?')[0];
  if (url === '/dev/ping') { r.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify({ dev: true, test: TEST, grants: GRANTS })); return; }
  if (url === '/dev/grant' && q.method === 'POST') return devGrant(q, r);
  if (q.url.startsWith('/api/')) {   // forwarded to the game server, the way Vercel does it
    const body = await readBody(q);
    try {
      const x = await fetch(B.base + q.url, { method: q.method, headers: { 'content-type': 'application/json', ...(q.headers.authorization ? { authorization: q.headers.authorization } : {}) }, body: ['GET', 'HEAD'].includes(q.method) ? undefined : body });
      r.writeHead(x.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(Buffer.from(await x.arrayBuffer()));
    } catch (e) { r.writeHead(502); r.end('{"error":"The local server is not answering."}'); }
    return;
  }
  let f = decodeURIComponent(url); if (f.endsWith('/')) f += 'index.html';
  try {
    let d = await readFile(path.join(W, path.normalize(f)));
    if (f === '/config.js' && TEST) d = Buffer.concat([Buffer.from('window.ANVILMOON_DEV = true; window.ANVILMOON_TEST = true;\n'), d]);   // test mode
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(d);
  } catch (e) { r.writeHead(404); r.end('Not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`Anvilmoon is running at http://127.0.0.1:${PORT}${TEST ? '  (test mode)' : ''}  (Ctrl+C stops it)`));
process.on('SIGINT', async () => { await B.stop(); process.exit(0); });
