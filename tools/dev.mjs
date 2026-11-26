// Play the game on this computer against a throwaway copy of the backend: `npm run dev`, then open http://127.0.0.1:8130
// The database lives in memory and is gone when you stop this (Ctrl+C). Nothing touches the real Supabase project.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startBackend, ROOT } from '../tests/harness.mjs';

const PORT = Number(process.env.PORT || 8130), W = path.join(ROOT, 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
const B = await startBackend();
http.createServer(async (q, r) => {
  if (q.url.startsWith('/api/')) {   // forwarded to the game server, the way Vercel does it
    const body = await new Promise((res) => { const c = []; q.on('data', (d) => c.push(d)); q.on('end', () => res(Buffer.concat(c))); });
    try {
      const x = await fetch(B.base + q.url, { method: q.method, headers: { 'content-type': 'application/json', ...(q.headers.authorization ? { authorization: q.headers.authorization } : {}) }, body: ['GET', 'HEAD'].includes(q.method) ? undefined : body });
      r.writeHead(x.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(Buffer.from(await x.arrayBuffer()));
    } catch (e) { r.writeHead(502); r.end('{"error":"The local server is not answering."}'); }
    return;
  }
  let f = decodeURIComponent(q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html';
  try { const d = await readFile(path.join(W, path.normalize(f))); r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(d); }
  catch (e) { r.writeHead(404); r.end('Not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`Anvilmoon is running at http://127.0.0.1:${PORT}  (Ctrl+C stops it)`));
process.on('SIGINT', async () => { await B.stop(); process.exit(0); });
