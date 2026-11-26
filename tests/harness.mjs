// Starts a throwaway copy of the whole backend on this computer: a Postgres database that lives in memory
// (PGlite) and the real game server (supabase/functions/api/index.ts) running under Deno.
// Used by the tests and by `npm run dev`. Nothing here touches the real Supabase project.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function startBackend({ log = false, schema = null, sqlBefore = [] } = {}) {
  const db = await PGlite.create();
  await db.exec('create role anon; create role authenticated;');   // the two roles every Supabase project has
  await db.exec(schema ?? readFileSync(ROOT + 'supabase/schema.sql', 'utf8'));
  for (const s of sqlBefore) await db.exec(s);
  await db.exec(readFileSync(ROOT + 'supabase/sql/am_records.sql', 'utf8'));
  const pgPort = await freePort(), apiPort = await freePort();
  const pg = new PGLiteSocketServer({ db, port: pgPort, host: '127.0.0.1' });
  await pg.start();
  const deno = spawn(process.execPath, [ROOT + 'node_modules/deno/bin.cjs', 'run', '-A', '--quiet', '--node-modules-dir=none', '--no-config', ROOT + 'supabase/functions/api/index.ts'], {
    env: { ...process.env, SUPABASE_DB_URL: `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`, AM_TEST: '1', AM_PORT: String(apiPort), AM_DB_MAX: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start:\n' + out)), 120000);
    const on = (d) => { out += d; if (log) process.stdout.write(d); if (out.includes('listening')) { clearTimeout(t); res(); } };
    deno.stdout.on('data', on); deno.stderr.on('data', on);
    deno.on('exit', (c) => { clearTimeout(t); rej(new Error('server exited ' + c + ':\n' + out)); });
  });
  deno.stdout.on('data', (d) => { if (log) process.stdout.write(d); });
  deno.stderr.on('data', (d) => process.stderr.write(d));
  const base = `http://127.0.0.1:${apiPort}`;
  // call the API the way the game does
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  };
  const stop = async () => { deno.removeAllListeners('exit'); deno.kill(); await pg.stop(); await db.close(); };
  return { db, base, apiPort, call, stop };
}
