// @ts-nocheck
// =====================================================================================================
// Anvilmoon game server (a Supabase Edge Function).
//
// The server is the referee. It keeps every player's real save and changes it only through ACTIONS:
// the game sends POST /api/act { name, args } ("sell blade 12", "forge a seax"), the server checks the
// rules (rules.js, the same file the game uses), rolls any dice, stores the new save and answers with
// the changes. Nobody can upload a save any more, so coin and blades can't be invented in the browser.
//
// Where things live (see supabase/schema.sql):
//   am_saves     one row per player: the save (coin, materials, blades...). Each action locks only that row.
//   am_users, am_sessions, am_links, am_limits   accounts and sign-in
//   am_mail      one row per letter (auction payouts, returned blades, gifts)
//   am_auctions  one row per open auction
//   am_state     one small shared row for the Arena (queues and live duels), gift campaigns and settings
//   am_history   older copies of each save (every 10 minutes, last 12), in case something must be restored
//
// When several rows are locked in one request they are always taken in this order, so two requests can
// never wait on each other forever:   am_state  ->  am_auctions  ->  am_saves
// =====================================================================================================
import postgres from 'npm:postgres@3.4.5';
import nodeCrypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import './rules.js';   // the shared game rules: sets globalThis.AMR
const R = globalThis.AMR;

const sql = postgres(Deno.env.get('SUPABASE_DB_URL'), { max: Number(Deno.env.get('AM_DB_MAX') || 2), prepare: false, idle_timeout: 20, connect_timeout: 10 });
const TESTING = Deno.env.get('AM_TEST') === '1';   // local test runs only
const SESSION_DAYS = 30;
const now = () => Date.now();
const rng = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;   // dice the player can't predict
const newId = (p) => p + Date.now().toString(36) + nodeCrypto.randomBytes(4).toString('hex');
const ok = (obj) => ({ code: 200, obj });
const fail = (code, msg) => ({ code, obj: { error: msg } });
const NEED = fail(401, 'Sign in first.');

// ============================================================== accounts
const hashPw = (pw, salt = nodeCrypto.randomBytes(16).toString('hex')) => salt + ':' + nodeCrypto.scryptSync(pw, salt, 64).toString('hex');
function checkPw(pw, stored) {
  if (!stored) return false;   // accounts made with Discord or Google have no password until one is set
  const [salt, h] = String(stored).split(':');
  const a = Buffer.from(h || '', 'hex'), b = nodeCrypto.scryptSync(pw, salt, 64);
  return a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
}
const tokenHash = (t) => nodeCrypto.createHash('sha256').update(t).digest('hex');
const cleanName = (v, fallback = 'Unknown') => (String(v || '').normalize('NFC').replace(/[^\p{L}\p{N} .\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24) || fallback);
// a database row -> the user object the rest of the file uses
const userOf = (r) => (r ? { id: r.uid, username: r.username, pass: r.pass, created: Number(r.created), rating: r.rating, wins: r.wins, losses: r.losses, rc: r.rc, links: r.links || {} } : null);
const publicUser = (u) => ({ id: u.id, username: u.username, rating: u.rating, wins: u.wins, losses: u.losses, created: u.created });
// what an account sees about itself: also whether it has a password and which Discord / Google sign-ins are linked
const selfUser = (u) => ({ ...publicUser(u), hasPw: !!u.pass, hasCode: !!u.rc, links: Object.entries(u.links || {}).map(([k, l]) => ({ id: k, providers: l.providers, name: l.name })) });
async function userById(q, uid) { const [r] = await q`select * from am_users where uid = ${uid}`; return userOf(r); }
async function userByName(q, name) { const [r] = await q`select * from am_users where uname_lc = ${String(name).trim().toLowerCase()}`; return userOf(r); }
async function newSession(q, uid) {
  const t = nodeCrypto.randomBytes(32).toString('base64url');
  await q`insert into am_sessions (hash, uid, exp) values (${tokenHash(t)}, ${uid}, ${now() + SESSION_DAYS * 864e5})`;
  return t;
}
const tokenOf = (R_) => { const h = R_.auth || ''; return h.startsWith('Bearer ') ? h.slice(7) : R_.query.get('token'); };
async function userFrom(q, R_) {
  const t = tokenOf(R_); if (!t) return null;
  const [r] = await q`select u.* from am_sessions s join am_users u on u.uid = s.uid where s.hash = ${tokenHash(t)} and s.exp > ${now()}`;
  return userOf(r);
}
async function createUser(q, name, pass) {
  const u = { id: newId('u'), username: name, pass, created: now(), rating: 1000, wins: 0, losses: 0, rc: null, links: {} };
  try {
    await q`insert into am_users (uid, username, uname_lc, pass, created, rating, wins, losses, links) values (${u.id}, ${name}, ${name.toLowerCase()}, ${pass}, ${u.created}, 1000, 0, 0, ${q.json({})})`;
  } catch (e) { if (e && e.code === '23505') return null; throw e; }   // 23505: the username is taken
  return u;
}
const saveUser = (q, u) => q`update am_users set pass = ${u.pass}, rc = ${u.rc}, links = ${q.json(u.links || {})} where uid = ${u.id}`;

// ---- recovery codes: a one-off code the player keeps somewhere safe. Username + code lets them choose a new password.
const RC_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codeNorm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function newCode(u) {
  const b = nodeCrypto.randomBytes(16); let c = '';
  for (let i = 0; i < 16; i++) c += RC_ABC[b[i] % RC_ABC.length] + (i % 4 === 3 && i < 15 ? '-' : '');
  u.rc = tokenHash(codeNorm(c));
  return c;
}
function checkCode(code, stored) {
  if (!stored) return false;
  const a = Buffer.from(tokenHash(codeNorm(code)), 'hex'), b = Buffer.from(String(stored), 'hex');
  return a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
}

// ---- Discord and Google sign-in (Supabase Auth hands the browser a signed token, checked here)
const SB_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
const JWKS = SB_URL ? createRemoteJWKSet(new URL(SB_URL + '/auth/v1/.well-known/jwks.json')) : null;
const PROVIDERS = { discord: 'Discord', google: 'Google' };
async function oauthWho(t) {
  t = String(t || '');
  if (TESTING && t.startsWith('test:')) { const [, prov, sub, name] = t.split(':'); return { sub, providers: prov.split('+'), name }; }
  if (!JWKS || t.length < 20 || t.length > 8000) return null;
  let c = null;
  try { c = (await jwtVerify(t, JWKS, { issuer: SB_URL + '/auth/v1', audience: 'authenticated' })).payload; }
  catch (e) {
    const key = Deno.env.get('SUPABASE_ANON_KEY');
    if (key) try { const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + t } }); if (r.ok) { const j = await r.json(); c = { sub: j.id, email: j.email, app_metadata: j.app_metadata, user_metadata: j.user_metadata }; } } catch (e2) { /* treated as not signed in */ }
  }
  if (!c || !c.sub) return null;
  const am = c.app_metadata || {}, um = c.user_metadata || {};
  const providers = (Array.isArray(am.providers) ? am.providers : [am.provider]).filter((x) => PROVIDERS[x]);
  if (!providers.length) return null;
  return { sub: String(c.sub), providers, name: cleanName(um.full_name || um.name || String(c.email || '').split('@')[0], 'linked account') };
}
const provLabel = (who) => who.providers.map((x) => PROVIDERS[x]).join(' / ');

// ---- throttles (one row per key in am_limits)
async function limited(q, key, max, windowMs) {
  const t = now();
  const [r] = await q`insert into am_limits (key, n, t) values (${key}, 1, ${t})
    on conflict (key) do update set n = case when ${t} - am_limits.t > ${windowMs} then 1 else am_limits.n + 1 end,
                                    t = case when ${t} - am_limits.t > ${windowMs} then ${t} else am_limits.t end
    returning n`;
  return r.n > max;
}
const throttled = (q, ip) => !TESTING && limited(q, 'ip:' + ip, 10, 60e3);

// ============================================================== mail
async function sendMail(q, to, body) {
  const m = { id: newId('m'), t: now() };
  await q`insert into am_mail (id, uid, t, body) values (${m.id}, ${to}, ${m.t}, ${q.json(body)})`;
  return m;
}
const mailOut = (r) => ({ id: r.id, to: r.uid, t: Number(r.t), ...r.body });

// ============================================================== saves
// A blade that arrives from somewhere else (mail, auction) is copied field by field, within sensible limits.
function cleanBlade(b) {
  if (!b || typeof b !== 'object' || !R.TYPES[b.type]) return null;
  const o = {}, num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  o.type = b.type; o.rarity = Math.round(num(b.rarity, 0, 4)); o.variant = Math.round(num(b.variant, 0, 5));
  o.len = Math.round(num(b.len, 1, 5000) * 10) / 10; o.si = Math.round(num(b.si, 0, 6)); o.grade = Math.round(num(b.grade, 1, 100));
  o.anvil = Math.round(num(b.anvil, 0, 4)); o.shine = b.shine === 'temp' || b.shine === 'star' ? b.shine : '';
  if (b.moon) o.moon = true; if (b.bog) o.bog = true; if (b.perfect) o.perfect = true; if (b.quick) o.quick = true; if (b.cracked) o.cracked = true;
  if (typeof b.q === 'string' && /^(oil|brine|water)$/.test(b.q)) o.q = b.q;
  if (typeof b.gift === 'string') o.gift = b.gift.slice(0, 40); if (typeof b.gdate === 'string') o.gdate = b.gdate.slice(0, 12);
  o.forger = cleanName(b.forger); o.t = num(b.t, 0, 9e15);
  return o;
}
// The time zone decides when it is night (Moonlit blades) and when a day's meals and shifts reset. The game
// reports it; a change is accepted at most every 12 hours, so it can't be flipped to make every forge "night".
function tzFor(S, sent, t) {
  const tz = R.tzOf(Math.round(Number(sent)));
  if (S.tz === undefined || (tz !== S.tz && t - (S.tzAt || 0) > 12 * 3600e3)) { S.tz = tz; S.tzAt = t; }
  return S.tz;
}
async function loadSave(q, uid) {
  const [row] = await q`select save, rev, snap_at from am_saves where uid = ${uid} for update`;
  return row || null;
}
// write the save; every 10 minutes the previous copy also goes into am_history (the last 12 are kept)
async function storeSave(q, uid, S, row, t) {
  const from = row ? row.rev : 0, rev = from + 1;
  let snap = row ? Number(row.snap_at || 0) : 0;
  if (row && row.save && t - snap >= 10 * 60e3) {
    await q`insert into am_history (uid, at, rev, save) values (${uid}, ${t}, ${from}, ${q.json(row.save)}) on conflict do nothing`;
    await q`delete from am_history where uid = ${uid} and at not in (select at from am_history where uid = ${uid} order by at desc limit 12)`;
    snap = t;
  }
  await q`insert into am_saves (uid, save, save_at, rev, snap_at) values (${uid}, ${q.json(S)}, ${t}, ${rev}, ${snap})
          on conflict (uid) do update set save = excluded.save, save_at = excluded.save_at, rev = excluded.rev, snap_at = excluded.snap_at`;
  return { from, rev };
}
// The Records boards (worked out in the database) are cached for a minute; who is on them feeds the "Record Holder" title.
const REC = { at: 0, data: null, users: null };
async function records(q) {
  if (REC.data && now() - REC.at < 60e3) return REC.data;
  const [r] = await q`select public.am_records() as r`;
  REC.data = r.r; REC.at = now(); REC.users = new Set((r.r.entries || []).map((e) => e.user));
  return REC.data;
}
const onBoards = (S, u) => (REC.users ? REC.users.has(u.username) : !!(S.hall && (S.hall.earned || []).includes('rec')));
// the parts of a save that are worked out from the rest: the public hall
function finishSave(S, u) { if (S.slots[S.active]) S.hall = R.hallSummary(S, publicUser(u), onBoards(S, u)); }
const envFor = (S, u, meta, t) => ({ now: t, rng, tz: tzFor(S, meta.tz, t), test: TESTING && !!meta.test, online: true, user: { username: u.username } });

// Run fn on the player's save with the row locked, store the result and work out the changes for the game.
// fn(S, env) returns the action's ctx (ctx.out, ctx.notes). A RuleError thrown inside undoes everything.
async function withSave(q, u, meta, fn) {
  const t = now(), row = await loadSave(q, u.id), raw = row ? row.save : null;
  const S = R.upgradeSave(raw ? structuredClone(raw) : null, t);
  R.oneName(S, u.username);
  const ctx = await fn(S, envFor(S, u, meta, t));
  R.upgradeSave(S, t);   // keep the stored save in its tidy form (a no-op for a save that already is)
  finishSave(S, u);
  const ops = R.diff(raw, S), st = await storeSave(q, u.id, S, row, t);
  const res = { out: ctx.out || {}, notes: ctx.notes || [], from: st.from, rev: st.rev, now: t };
  // a patch bigger than half the save is sent as the whole save instead
  if (JSON.stringify(ops).length * 2 > JSON.stringify(S).length) res.save = S; else res.ops = ops;
  return res;
}
// Change another player's save (the loser of a wager duel, the winner's challenge). Their game notices the new
// revision on its next check-in and fetches the save again.
async function editSave(q, uid, fn) {
  const u = await userById(q, uid); if (!u) return;
  const t = now(), row = await loadSave(q, uid); if (!row || !row.save) return;
  const S = R.upgradeSave(structuredClone(row.save), t); R.oneName(S, u.username);
  const ctx = R.beginAction(S, envFor(S, u, {}, t)); if (!ctx.c) return;
  fn(ctx); R.afterAction(ctx); finishSave(S, u);
  await storeSave(q, uid, S, row, t);
}

// ============================================================== keepsakes (gift blades)
const CAMPAIGNS = [
  { id: 'testsword-2026-11-18', note: 'Thank you for testing Anvilmoon. This one is yours to keep: The Test Sword, 18/11/2026.',
    blade: { type: 'testsword', len: 181.1, si: 4, grade: 100, rarity: 4, variant: 0, anvil: 4, shine: '', forger: 'Anvilmoon', gift: 'test-2026-11-18' } },
];
const EXTRA_GIFTS = [{ id: 'testsword-lexy-second', username: 'lexy', campaign: 'testsword-2026-11-18' }];
const PERSONAL = [
  { id: 'sweetchilli-2026-11-19', username: 'sweetchilli', note: 'A gift for you, sweetchilli. This one was made just for you: The Sweet Chilli, 19/11/2026.',
    blade: { type: 'sweetchilli', len: 150, si: 3, grade: 100, rarity: 4, variant: 0, anvil: 4, shine: '', forger: 'Anvilmoon', gift: 'chilli-2026-11-19' } },
  { id: 'testsword-mouflon-2026-11-24', username: 'mouflon', note: 'Thank you for testing Anvilmoon, John. This one is yours to keep: The Test Sword, 24/11/2026.',
    blade: { type: 'testsword', len: 181.1, si: 4, grade: 100, rarity: 4, variant: 0, anvil: 4, shine: '', forger: 'Anvilmoon', gift: 'test-2026-11-24', gdate: '24/11/2026' } },
];
// More can be added without touching this file: config.personal (same shape as PERSONAL) and config.giftTypes in the am_state row.
const cfgOf = (st, k) => (st && st.config && Array.isArray(st.config[k]) ? st.config[k] : []);
const personalAll = (st) => [...PERSONAL, ...cfgOf(st, 'personal')];
const isGiftType = (st, t) => R.isGift({ type: t }) || cfgOf(st, 'giftTypes').includes(t);
async function runCampaigns(q, st) {
  st.campaigns = st.campaigns || {};
  const all = [...CAMPAIGNS, ...EXTRA_GIFTS, ...personalAll(st)];
  if (all.every((g) => st.campaigns[g.id])) return false;
  const users = (await q`select uid, username from am_users`).map((r) => ({ id: r.uid, username: r.username }));
  const byName = (n) => users.find((v) => v.username.toLowerCase() === n);
  for (const c of CAMPAIGNS) {
    if (st.campaigns[c.id]) continue;
    for (const u of users) await sendMail(q, u.id, { cid: null, blade: { ...c.blade }, note: c.note, gift: c.id });
    st.campaigns[c.id] = { at: now(), sent: users.length };
  }
  for (const x of EXTRA_GIFTS) {
    if (st.campaigns[x.id]) continue;
    const c = CAMPAIGNS.find((k) => k.id === x.campaign), u = byName(x.username); if (!c || !u) continue;
    await sendMail(q, u.id, { cid: null, blade: { ...c.blade }, note: c.note, gift: x.id }); st.campaigns[x.id] = { at: now(), sent: 1 };
  }
  for (const g of personalAll(st)) {
    if (st.campaigns[g.id]) continue;
    const u = byName(g.username); if (!u) continue;
    await sendMail(q, u.id, { cid: null, blade: { ...g.blade }, note: g.note, gift: g.id }); st.campaigns[g.id] = { at: now(), sent: 1, to: u.id };
  }
  return true;
}
// If a recipient's save has no copy and none is waiting in their mail, send it again (at most every 5 minutes).
async function healGifts(q, u) {
  const [s] = await q`select blob->'campaigns' as c, blob->'config' as cfg from am_state where id = 1`;
  const camps = (s && s.c) || {}, st = { config: (s && s.cfg) || {} };
  const list = [...CAMPAIGNS, ...personalAll(st).filter((g) => u.username.toLowerCase() === g.username)];
  let save = null, mail = null;
  for (const c of list) {
    const rec = camps[c.id]; if (!rec || (u.created || 0) > rec.at || (rec.to && rec.to !== u.id)) continue;
    if (!save) { const [r] = await q`select save from am_saves where uid = ${u.id}`; save = (r && r.save) || { slots: [] }; }
    if ((save.slots || []).some((sm) => sm && (sm.blades || []).some((b) => b && b.type === c.blade.type))) continue;
    if (!mail) mail = (await q`select body from am_mail where uid = ${u.id}`).map((r) => r.body);
    if (mail.some((m) => m.gift === c.id)) continue;
    const [l] = await q`select t from am_limits where key = ${'heal:' + u.id + ':' + c.id}`;
    if (l && now() - Number(l.t) < 5 * 60e3) continue;
    await q`insert into am_limits (key, n, t) values (${'heal:' + u.id + ':' + c.id}, 1, ${now()}) on conflict (key) do update set t = excluded.t`;
    await sendMail(q, u.id, { cid: null, blade: { ...c.blade }, note: c.note, gift: c.id, heal: true });
  }
}

// ============================================================== shared state (Arena, campaigns, settings)
const blankState = () => ({ queue: { ranked: [], wager: [] }, matches: {}, playerMatch: {}, lastMatch: {}, campaigns: {}, config: {}, prunedAt: 0 });
async function lockState(q) {
  const [row] = await q`select ver, next_due, blob from am_state where id = 1 for update`;
  const st = { ...blankState(), ...((row && row.blob) || {}) };
  st.lastMatch = st.lastMatch || {};
  return { st, ver: Number(row ? row.ver : 0) };
}
async function storeState(q, L) {
  await q`update am_state set blob = ${q.json(L.st)}, ver = ${L.ver + 1}, next_due = ${nextDue(L.st)} where id = 1`;
}
// lock the shared state, catch up on timed Arena work, run fn(st), store the state
async function withState(q, fn) {
  const L = await lockState(q); await tick(q, L.st);
  const out = await fn(L.st);
  await storeState(q, L);
  return out;
}

// ============================================================== auction house (one row per open auction in am_auctions)
const listingOut = (L) => ({ id: L.id, seller: L.seller, sellerSmith: cleanName(L.sellerSmith), blade: { ...L.blade, forger: cleanName(L.blade && L.blade.forger) }, start: L.start, buyout: L.buyout, bid: L.bid, bidder: L.bidder, bidderSmith: L.bidderSmith ? cleanName(L.bidderSmith) : L.bidderSmith, expires: L.expires, created: L.created });
const putListing = (q, L) => q`insert into am_auctions (id, seller, expires, changed, data) values (${L.id}, ${L.seller}, ${L.expires}, ${now()}, ${q.json(L)})
  on conflict (id) do update set data = excluded.data, changed = excluded.changed`;
async function lockListing(q, id) { const [r] = await q`select data from am_auctions where id = ${String(id)} for update`; return r ? r.data : null; }
// Auctions that have run out: the winner gets the blade by mail, the seller the coin (or the blade back).
async function settleAuctions(q) {
  const due = await q`select data from am_auctions where expires <= ${now()} for update skip locked`;
  for (const { data: L } of due) {
    if (L.bidder) {
      await sendMail(q, L.bidder, { cid: L.bidderCid, blade: L.blade, note: `You won the auction for ${L.bladeName}, paying ${L.bid}c.` });
      const pay = Math.floor(L.bid * (1 - R.AH_CUT)) + L.deposit;
      await sendMail(q, L.seller, { cid: L.sellerCid, coin: pay, soldId: L.clientId, note: `Your ${L.bladeName} sold at auction for ${L.bid}c. After the 5% cut and with your deposit back, you receive ${pay}c.` });
    } else {
      await sendMail(q, L.seller, { cid: L.sellerCid, returnId: L.clientId, note: `Your ${L.bladeName} didn’t sell and is back on your rack. The deposit is kept.` });
    }
    await q`delete from am_auctions where id = ${L.id}`;
  }
}
const newBlade = (S, b, t) => ({ ...cleanBlade(b), id: ++S.serial, status: 'owned', t });

// ============================================================== arena (PvP), resolved here
// Moves: strike beats feint, feint beats guard, guard beats strike (and counters).
const WEIGHT = { L: 1, M: 1.4, H: 2.5, X: 3.6 };
function fighter(blade) {
  const wt = (R.TYPES[blade.type] && R.TYPES[blade.type].wt) || 'M';
  const power = 14 * Math.sqrt(WEIGHT[wt]) * (1 + blade.rarity * 0.12) * (0.75 + blade.grade / 200) * (blade.shine === 'star' ? 1.08 : 1);
  return { wt, power: Math.round(power * 10) / 10, hp: 100 };
}
const ROUND_MS = 15e3, MAX_ROUNDS = 12, BOT_WAIT_MS = 20e3;
const bladeLabel = (b) => `${b.moon ? 'Moonlit ' : ''}${b.shine === 'star' ? 'Starforged ' : b.shine === 'temp' ? 'Tempered ' : ''}${R.RAR[b.rarity].n} ${(R.TYPES[b.type] || { n: b.type }).n}`;
function matchView(M, uid) {
  const me = M.p.find((p) => p.uid === uid), foe = M.p.find((p) => p.uid !== uid);
  return {
    id: M.id, mode: M.mode, round: M.round, deadline: M.deadline, over: M.over, winner: M.winner,
    you: { name: me.name, smith: me.smith, blade: me.blade, hp: me.f.hp, power: me.f.power, moved: !!me.move, rating: me.rating },
    foe: { name: foe.name, smith: foe.smith, blade: foe.blade, hp: foe.f.hp, power: foe.f.power, moved: !!foe.move, bot: !!foe.bot, rating: foe.rating },
    log: M.log.slice(-8), result: M.over ? M.result[uid] : null,
  };
}
function startMatch(st, mode, a, b) {
  const M = { id: newId('x'), mode, round: 1, log: [], over: false, result: {}, p: [a, b] };
  for (const p of M.p) { p.f = fighter(p.blade); p.move = null; if (!p.bot) st.playerMatch[p.uid] = M.id; }
  M.deadline = now() + ROUND_MS; st.matches[M.id] = M;
  M.log.push(`${a.smith} (${a.name}) faces ${b.smith}${b.bot ? '' : ` (${b.name})`}.`);
  return M;
}
function botMove() { const r = rng(); return r < 0.4 ? 'strike' : r < 0.7 ? 'guard' : 'feint'; }
async function resolveRound(q, st, M) {
  const [a, b] = M.p;
  for (const p of M.p) if (!p.move) p.move = p.bot ? botMove() : 'guard';
  const hit = (att, def, mult) => { const d = Math.round(att.f.power * mult * (0.9 + rng() * 0.2)); def.f.hp = Math.max(0, def.f.hp - d); return d; };
  const bonus = (p, mv) => ((mv === 'strike' && p.f.wt === 'X') || (mv === 'feint' && p.f.wt === 'L') ? 1.15 : 1);
  const ma = a.move, mb = b.move; let line;
  if (ma === mb) {
    if (ma === 'strike') { const d1 = hit(a, b, 0.6 * bonus(a, ma)), d2 = hit(b, a, 0.6 * bonus(b, mb)); line = `Both strike. ${a.smith} deals ${d1}, ${b.smith} deals ${d2}.`; }
    else line = ma === 'guard' ? 'Both guard. Steel rings, nobody is hurt.' : 'Both feint. Neither falls for it.';
  } else {
    const beats = { strike: 'feint', feint: 'guard', guard: 'strike' };
    const [w, l] = beats[ma] === mb ? [a, b] : [b, a], mw = w.move;
    if (mw === 'strike') line = `${w.smith} strikes through ${l.smith}’s feint for ${hit(w, l, 1 * bonus(w, mw))}.`;
    else if (mw === 'feint') line = `${w.smith} feints past ${l.smith}’s guard for ${hit(w, l, 0.8 * bonus(w, mw))}.`;
    else line = `${w.smith} guards and counters ${l.smith}’s strike for ${hit(w, l, 0.5 * (0.5 + w.blade.grade / 100))}.`;
  }
  M.log.push(`Round ${M.round}: ${line}`);
  for (const p of M.p) p.move = null;
  if (a.f.hp <= 0 || b.f.hp <= 0 || M.round >= MAX_ROUNDS) await finishMatch(q, st, M);
  else { M.round++; M.deadline = now() + ROUND_MS; }
}
// The end of a duel changes the players' saves right here, so nothing depends on their game being open:
// a wager loser's blade is marked lost in the same step that mails it to the winner.
async function finishMatch(q, st, M) {
  const [a, b] = M.p;
  M.over = true; M.overAt = now();
  const winner = a.f.hp === b.f.hp ? null : a.f.hp > b.f.hp ? a : b, loser = winner && (winner === a ? b : a);
  M.winner = winner ? winner.uid : null;
  M.log.push(winner ? `${winner.smith} wins the duel.` : 'The duel ends in a draw.');
  for (const p of M.p) {
    if (p.bot) continue;
    const foe = p === a ? b : a, r = { outcome: !winner ? 'draw' : p === winner ? 'win' : 'loss', ratingChange: 0 };
    if (M.mode === 'ranked' && !foe.bot) {
      const exp = 1 / (1 + Math.pow(10, (foe.rating - p.rating) / 400)), score = r.outcome === 'win' ? 1 : r.outcome === 'loss' ? 0 : 0.5;
      r.ratingChange = Math.round(32 * (score - exp));
    }
    const won = r.outcome === 'win' && !foe.bot ? 1 : 0, lost = r.outcome === 'loss' && !foe.bot ? 1 : 0;
    await q`update am_users set rating = rating + ${r.ratingChange}, wins = wins + ${won}, losses = losses + ${lost} where uid = ${p.uid}`;
    M.result[p.uid] = r; delete st.playerMatch[p.uid]; st.lastMatch[p.uid] = M.id;
  }
  const wager = M.mode === 'wager' && !a.bot && !b.bot;
  if (wager && winner) {
    M.result[loser.uid].lostBladeId = loser.bladeId;
    await editSave(q, loser.uid, (ctx) => { const bl = R.bladeById(ctx.c, loser.bladeId); if (bl && bl.status === 'wager') { bl.status = 'lost'; bl.su = ctx.now; } });
    await sendMail(q, winner.uid, { cid: winner.cid, blade: loser.blade, note: `You won ${loser.smith}’s ${bladeLabel(loser.blade)} in a wager duel.` });
  }
  for (const p of M.p) {
    if (p.bot || (p === loser && wager) || (!wager && p !== winner)) continue;
    // the blade carried into a wager comes back to the rack; a win also counts for challenges
    await editSave(q, p.uid, (ctx) => {
      const bl = R.bladeById(ctx.c, p.bladeId); if (bl && bl.status === 'wager') { bl.status = 'owned'; bl.su = ctx.now; }
      if (p === winner) R.chEvent(ctx, { k: 'win' });
    });
  }
}
// a wager blade that never got to fight goes back on the rack
const unqueue = async (q, st, uid) => {
  let wagerBlade = null;
  for (const k of Object.keys(st.queue)) st.queue[k] = st.queue[k].filter((x) => { if (x.uid !== uid) return true; if (k === 'wager') wagerBlade = x.bladeId; return false; });
  return wagerBlade;
};
async function restoreWager(q, uid, bladeId) {
  await editSave(q, uid, (ctx) => { const bl = R.bladeById(ctx.c, bladeId); if (bl && bl.status === 'wager') { bl.status = 'owned'; bl.su = ctx.now; } });
}
// Timed Arena work happens at the start of whichever request takes the state lock next.
async function tick(q, st) {
  for (const M of Object.values(st.matches)) {
    if (!M.over && now() > M.deadline) await resolveRound(q, st, M);
    if (M.over && now() - (M.overAt || 0) > 60e3) {
      delete st.matches[M.id];
      for (const [uid, mid] of Object.entries(st.lastMatch)) if (mid === M.id) delete st.lastMatch[uid];
    }
  }
  const qr = st.queue.ranked;
  for (let i = qr.length - 1; i >= 0; i--) {
    if (now() - qr[i].since < BOT_WAIT_MS) continue;
    const p = qr.splice(i, 1)[0];
    const bot = { uid: 'bot', bot: true, name: 'Practice', smith: ['Old Hesk', 'Kesh the Quiet', 'Ysolde Marr', 'Brannoc Ashvale'][Math.floor(rng() * 4)], rating: 1000,
      blade: { ...p.blade, forger: 'NPC', rarity: Math.max(0, p.blade.rarity - 1 + Math.round(rng() * 2)), grade: 40 + Math.round(rng() * 45), shine: '' } };
    startMatch(st, 'practice', p, bot);
  }
  // people who queued and then closed the game are dropped after two minutes without a check-in
  for (const k of Object.keys(st.queue)) {
    const gone = st.queue[k].filter((x) => now() - (x.seen || x.since) >= 120e3);
    st.queue[k] = st.queue[k].filter((x) => now() - (x.seen || x.since) < 120e3);
    if (k === 'wager') for (const x of gone) await restoreWager(q, x.uid, x.bladeId);
  }
  if (now() - (st.prunedAt || 0) > 3600e3) {
    await q`delete from am_sessions where exp < ${now()}`;
    await q`delete from am_limits where t < ${now() - 3600e3}`;
    st.prunedAt = now();
  }
}
function nextDue(st) {
  let d = 9e15;
  for (const M of Object.values(st.matches)) d = Math.min(d, M.over ? (M.overAt || 0) + 60e3 : M.deadline);
  for (const p of st.queue.ranked) d = Math.min(d, p.since + BOT_WAIT_MS);
  for (const k of Object.keys(st.queue)) for (const p of st.queue[k]) d = Math.min(d, (p.seen || p.since) + 120e3);
  return Math.floor(Math.min(d, (st.prunedAt || 0) + 3600e3));
}
const queuedIn = (st, uid) => Object.keys(st.queue).find((k) => st.queue[k].some((x) => x.uid === uid)) || null;
function pvpView(st, uid) {
  const mid = st.playerMatch[uid] || st.lastMatch[uid], M = mid && st.matches[mid];
  return M ? matchView(M, uid) : null;
}

// ============================================================== actions that touch more than the player's own save
// (the rest are in rules.js and run through withSave). Each gets (q, u, args, meta).
const SERVER_ACTIONS = {
  // collect letters: coin, blades, auction results
  async mailCollect(q, u, a, meta) {
    const ids = (Array.isArray(a.ids) ? a.ids : [a.ids]).map(String).slice(0, 200);
    return withSave(q, u, meta, async (S, env) => {
      const rows = await q`select id, body from am_mail where uid = ${u.id} and id = any(${q.array(ids, 25)}) for update`;
      R.need(rows.length, 'That mail has already been collected.');
      const ctx = R.beginAction(S, env), c = ctx.c; R.need(c, 'Make a smith first.');
      const got = [], skipped = [];
      for (const { id, body: m } of rows) {
        if (m.coin) c.coin += Math.max(0, Math.floor(m.coin));
        if (m.blade) {
          if (m.heal && R.isGift(m.blade) && R.allBlades(S).some((b) => b.type === m.blade.type)) skipped.push(id);
          else { const b = newBlade(S, m.blade, env.now); if (b.type) { c.blades.push(b); got.push({ mail: id, id: b.id }); } }
        }
        if (m.soldId) { const b = c.blades.find((x) => x.ahId === m.soldId); if (b) { b.status = 'sold'; b.su = env.now; delete b.ahId; } }
        if (m.returnId) { const b = c.blades.find((x) => x.ahId === m.returnId); if (b) { b.status = 'owned'; b.su = env.now; delete b.ahId; } }
      }
      await q`delete from am_mail where uid = ${u.id} and id = any(${q.array(rows.map((r) => r.id), 25)})`;
      R.afterAction(ctx); ctx.out = { got, skipped, n: rows.length };
      return ctx;
    });
  },
  async ahList(q, u, a, meta) {
    const start = Math.floor(+a.start), buyout = Math.floor(+a.buyout || 0), dur = R.DURS[a.dur] ? a.dur : null;
    R.need(start >= 1 && start <= 1e9 && dur && (!buyout || (buyout >= start && buyout <= 1e9)), 'Check the starting bid, buyout and duration.');
    const [{ n }] = await q`select count(*)::int as n from am_auctions where seller = ${u.id}`;
    R.need(n < R.MAX_LISTINGS, `You can have up to ${R.MAX_LISTINGS} auctions at once.`);
    return withSave(q, u, meta, async (S, env) => {
      const ctx = R.beginAction(S, env), c = ctx.c; R.need(c, 'Make a smith first.');
      const b = R.bladeById(c, a.id); R.need(b && b.status === 'owned' && !b.cracked, 'Pick a blade from your rack first.');
      R.need(!R.isGift(b), 'Keepsakes can’t be sold or traded.');
      const dep = R.depositFor(b, dur); R.need(c.coin >= dep, `The deposit is ${dep}c, and you have ${Math.floor(c.coin)}c.`);
      const id = newId('a'), t = env.now;
      c.coin -= dep; b.status = 'listed'; b.su = t; b.ahId = id;
      const L = { id, seller: u.id, sellerName: u.username, sellerSmith: c.name, sellerCid: c.cid, clientId: id, blade: cleanBlade(b), bladeName: R.bname(b),
        start, buyout, bid: 0, bidder: null, bidderCid: null, bidderSmith: null, deposit: dep, created: t, expires: t + R.DURS[dur].ms };
      await putListing(q, L);
      ctx.out = { listing: listingOut(L), deposit: dep, name: L.bladeName };
      return ctx;
    });
  },
  async ahBid(q, u, a, meta) {
    await settleAuctions(q);
    const L = await lockListing(q, a.id);
    R.need(L && L.expires > now(), 'That auction has ended.'); R.need(L.seller !== u.id, 'You can’t bid on your own auction.');
    if (L.buyout && +a.amount >= L.buyout) return SERVER_ACTIONS.ahBuyout(q, u, a, meta, L);
    const amount = Math.floor(+a.amount); R.need(amount >= R.minBid(L) && amount <= 1e9, `The minimum bid is ${R.minBid(L)}c.`);
    return withSave(q, u, meta, async (S, env) => {
      const ctx = R.beginAction(S, env), c = ctx.c; R.need(c, 'Make a smith first.');
      R.need(c.coin >= amount, `You have ${R.fmtN(c.coin)}c, which isn’t enough.`);
      c.coin -= amount;   // held by the auction house until someone outbids you
      if (L.bidder) await sendMail(q, L.bidder, { cid: L.bidderCid, coin: L.bid, note: `You were outbid on the ${L.bladeName}. Your ${L.bid}c bid is returned.` });
      Object.assign(L, { bid: amount, bidder: u.id, bidderCid: c.cid, bidderSmith: c.name });
      await putListing(q, L);
      ctx.out = { bid: amount };
      return ctx;
    });
  },
  async ahBuyout(q, u, a, meta, locked) {
    if (!locked) await settleAuctions(q);
    const L = locked || await lockListing(q, a.id);
    R.need(L && L.expires > now(), 'That auction has ended.'); R.need(L.seller !== u.id, 'You can’t buy your own auction.');
    R.need(L.buyout, 'This auction has no buyout.');
    return withSave(q, u, meta, async (S, env) => {
      const ctx = R.beginAction(S, env), c = ctx.c; R.need(c, 'Make a smith first.');
      R.need(c.coin >= L.buyout, `You have ${R.fmtN(c.coin)}c, which isn’t enough.`);
      c.coin -= L.buyout;
      const b = newBlade(S, L.blade, env.now); c.blades.push(b);
      if (L.bidder) await sendMail(q, L.bidder, { cid: L.bidderCid, coin: L.bid, note: `The ${L.bladeName} was bought out. Your ${L.bid}c bid is returned.` });
      const pay = Math.floor(L.buyout * (1 - R.AH_CUT)) + L.deposit;
      await sendMail(q, L.seller, { cid: L.sellerCid, coin: pay, soldId: L.clientId, note: `Your ${L.bladeName} was bought out for ${L.buyout}c. After the 5% cut and with your deposit back, you receive ${pay}c.` });
      await q`delete from am_auctions where id = ${L.id}`;
      R.afterAction(ctx); ctx.out = { bought: true, amount: L.buyout, blade: b };
      return ctx;
    });
  },
  async ahCancel(q, u, a, meta) {
    const L = await lockListing(q, a.id);
    R.need(L && L.expires > now(), 'That auction has ended.'); R.need(L.seller === u.id, 'That isn’t your auction.');
    R.need(!L.bidder, 'Someone has already bid, so this auction can’t be cancelled.');
    return withSave(q, u, meta, async (S, env) => {
      const ctx = R.beginAction(S, env), c = ctx.c; R.need(c, 'Make a smith first.');
      const b = c.blades.find((x) => x.ahId === L.clientId); if (b) { b.status = 'owned'; b.su = env.now; delete b.ahId; }
      await q`delete from am_auctions where id = ${L.id}`;
      return ctx;
    });
  },
  async arenaQueue(q, u, a, meta) {
    const Ls = await lockState(q), st = Ls.st; await tick(q, st);
    R.need(!(st.playerMatch[u.id] && st.matches[st.playerMatch[u.id]]), 'You’re already in a duel.');
    const mode = a.mode === 'wager' ? 'wager' : 'ranked';
    const prev = await unqueue(q, st, u.id);
    const res = await withSave(q, u, meta, async (S, env) => {
      const ctx = R.beginAction(S, env), c = ctx.c; R.need(c, 'Make a smith first.');
      if (prev != null) { const pb = R.bladeById(c, prev); if (pb && pb.status === 'wager') pb.status = 'owned'; }
      const b = R.bladeById(c, a.id); R.need(b && b.status === 'owned' && !b.cracked, 'Choose a blade from your rack to carry.');
      R.need(!(mode === 'wager' && isGiftType(st, b.type)), 'Keepsakes can only fight in ranked duels.');
      if (mode === 'wager') { b.status = 'wager'; b.su = env.now; }   // can't be sold or listed while it is at stake
      const me = { uid: u.id, name: u.username, smith: c.name, cid: c.cid, bladeId: b.id, blade: cleanBlade(b), rating: u.rating, since: now(), seen: now() };
      const foe = st.queue[mode].shift();
      if (foe) ctx.out = { match: matchView(startMatch(st, mode, foe, me), u.id) };
      else { st.queue[mode].push(me); ctx.out = { queued: mode, botAfter: mode === 'ranked' ? BOT_WAIT_MS : null }; }
      return ctx;
    });
    await storeState(q, Ls);
    return res;
  },
  async arenaLeave(q, u, a, meta) {
    const Ls = await lockState(q), prev = await unqueue(q, Ls.st, u.id);
    const res = await withSave(q, u, meta, async (S, env) => {
      const ctx = R.beginAction(S, env);
      if (prev != null && ctx.c) { const pb = R.bladeById(ctx.c, prev); if (pb && pb.status === 'wager') { pb.status = 'owned'; pb.su = env.now; } }
      return ctx;
    });
    await storeState(q, Ls);
    return res;
  },
};

// ============================================================== API routes
async function api(q, R_) {
  const p = R_.path, m = R_.method, ip = R_.ip, b = R_.body || {};

  // ---- every game action goes through here
  if (p === '/api/act' && m === 'POST') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    const name = String(b.name || ''), meta = { tz: b.tz, test: b.test };
    if (Object.prototype.hasOwnProperty.call(SERVER_ACTIONS, name)) return ok(await SERVER_ACTIONS[name](q, u, b.args || {}, meta));
    R.need(Object.prototype.hasOwnProperty.call(R.ACTIONS, name), 'Unknown action.');
    return ok(await withSave(q, u, meta, (S, env) => R.runAction(S, name, b.args || {}, env)));
  }

  // ---- accounts
  if (p === '/api/register' && m === 'POST') {
    if (await throttled(q, ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const name = String(b.username || '').trim(), password = String(b.password || '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return fail(400, 'Usernames are 3 to 20 letters, numbers or underscores.');
    if (!TESTING && ((await limited(q, 'reg:' + ip, 3, 3600e3)) || (await limited(q, 'reg:all', 60, 3600e3)))) return fail(429, 'Too many new accounts from here. Try again later.');
    if (password.length < 8) return fail(400, 'Passwords need at least 8 characters.');
    const user = await createUser(q, name, hashPw(password)); if (!user) return fail(409, 'That username is taken.');
    const code = newCode(user); await saveUser(q, user);
    return ok({ token: await newSession(q, user.id), user: selfUser(user), code });
  }
  if (p === '/api/login' && m === 'POST') {
    if (await throttled(q, ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const key = String(b.username || '').trim().toLowerCase();
    if (await limited(q, 'user:' + key, 8, 600e3)) return fail(429, 'Too many attempts on this account. Wait ten minutes and try again.');
    const user = await userByName(q, key);
    if (!user || !checkPw(String(b.password || ''), user.pass)) return fail(401, 'That username and password don’t match.');
    return ok({ token: await newSession(q, user.id), user: selfUser(user) });
  }
  if (p === '/api/logout' && m === 'POST') {
    const t = tokenOf(R_); if (t) await q`delete from am_sessions where hash = ${tokenHash(t)}`;
    return ok({ ok: true });
  }
  if (p === '/api/password' && m === 'POST') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    // Three ways in: the current password; a fresh Discord / Google sign-in linked to this account (a reset); or no password yet.
    let reset = false;
    if (b.access_token) {
      const who = await oauthWho(b.access_token);
      const [l] = who ? await q`select uid from am_links where sub = ${who.sub}` : [];
      if (!who || !l || l.uid !== u.id) return fail(401, 'That sign-in isn’t linked to this account.');
      reset = true;
    } else if (u.pass && !checkPw(String(b.current || ''), u.pass)) return fail(401, 'Your current password isn’t right.');
    if (String(b.next || '').length < 8) return fail(400, 'Passwords need at least 8 characters.');
    u.pass = hashPw(String(b.next)); await saveUser(q, u);
    if (reset) { const t = tokenOf(R_); await q`delete from am_sessions where uid = ${u.id} and hash <> ${t ? tokenHash(t) : ''}`; }   // a reset signs out every other device
    return ok({ ok: true, user: selfUser(u) });
  }
  if (p === '/api/recovery' && m === 'POST') {   // a new recovery code (the old one stops working)
    const u = await userFrom(q, R_); if (!u) return NEED;
    if (u.pass && !checkPw(String(b.password || ''), u.pass)) return fail(401, 'Your password isn’t right.');
    const code = newCode(u); await saveUser(q, u);
    return ok({ code, user: selfUser(u) });
  }
  if (p === '/api/recover' && m === 'POST') {   // forgot the password: username + recovery code sets a new one
    if (await throttled(q, ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const key = String(b.username || '').trim().toLowerCase();
    if (!TESTING && await limited(q, 'rc:' + key, 5, 3600e3)) return fail(429, 'Too many attempts on this account. Wait an hour and try again.');
    const user = await userByName(q, key);
    if (!user || !checkCode(b.code, user.rc)) return fail(401, 'That username and recovery code don’t match.');
    if (String(b.next || '').length < 8) return fail(400, 'Passwords need at least 8 characters.');
    user.pass = hashPw(String(b.next)); const code = newCode(user); await saveUser(q, user);   // each code works once
    await q`delete from am_sessions where uid = ${user.id}`;
    return ok({ token: await newSession(q, user.id), user: selfUser(user), code });
  }
  if (p === '/api/oauth' && m === 'POST') {
    if (await throttled(q, ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const who = await oauthWho(b.access_token);
    if (!who) return fail(401, 'That sign-in didn’t work. Try again.');
    const [l] = await q`select uid from am_links where sub = ${who.sub}`;
    const owner = l ? await userById(q, l.uid) : null;
    const link = async (x) => {
      x.links = x.links || {}; x.links[who.sub] = { providers: who.providers, name: who.name, at: (x.links[who.sub] || {}).at || now() };
      await saveUser(q, x); await q`insert into am_links (sub, uid) values (${who.sub}, ${x.id}) on conflict (sub) do update set uid = excluded.uid`;
    };
    if (b.mode === 'link') {
      const u = await userFrom(q, R_); if (!u) return NEED;
      if (owner && owner.id !== u.id) return fail(409, `That ${provLabel(who)} account is already linked to another Anvilmoon account.`);
      await link(u); return ok({ linked: provLabel(who), user: selfUser(u) });
    }
    if (owner) { await link(owner); return ok({ token: await newSession(q, owner.id), user: selfUser(owner) }); }
    // nobody has linked this Discord / Google account: it can start a new Anvilmoon account once a username is chosen
    if (b.username === undefined) return ok({ needName: true, provider: provLabel(who), suggest: who.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20) });
    const name = String(b.username).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return fail(400, 'Usernames are 3 to 20 letters, numbers or underscores.');
    if (!TESTING && ((await limited(q, 'reg:' + ip, 3, 3600e3)) || (await limited(q, 'reg:all', 60, 3600e3)))) return fail(429, 'Too many new accounts from here. Try again later.');
    const user = await createUser(q, name, null); if (!user) return fail(409, 'That username is taken.');
    const code = newCode(user); await link(user);
    return ok({ token: await newSession(q, user.id), user: selfUser(user), created: true, code });
  }
  if (p === '/api/unlink' && m === 'POST') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    const k = String(b.id || '');
    if (!u.links || !u.links[k]) return fail(404, 'That sign-in isn’t linked.');
    if (!u.pass && Object.keys(u.links).length < 2) return fail(400, 'Set a password first, or you’d have no way to sign in.');
    delete u.links[k]; await saveUser(q, u); await q`delete from am_links where sub = ${k}`;
    return ok({ user: selfUser(u) });
  }
  if (p === '/api/me' && m === 'GET') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    // gift campaigns go out the first time anyone opens the game after one is added
    const [s] = await q`select blob->'campaigns' as c, blob->'config' as cfg from am_state where id = 1`;
    const camps = (s && s.c) || {}, all = [...CAMPAIGNS, ...EXTRA_GIFTS, ...personalAll({ config: (s && s.cfg) || {} })];
    if (!all.every((g) => camps[g.id])) { const Ls = await lockState(q); if (await runCampaigns(q, Ls.st)) await storeState(q, Ls); }
    return ok({ user: selfUser(u) });
  }

  // ---- the save: read only (it changes through /api/act)
  if (p === '/api/save' && m === 'GET') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    const row = await loadSave(q, u.id);
    if (!row || !row.save) return ok({ save: null, rev: row ? row.rev : 0, now: now() });
    // the first time a save from before the move is opened, it is brought up to date and stored
    const S = R.upgradeSave(structuredClone(row.save), now()); R.oneName(S, u.username); finishSave(S, u);
    if (R.diff(row.save, S).length) { const st = await storeSave(q, u.id, S, row, now()); return ok({ save: S, rev: st.rev, now: now() }); }
    return ok({ save: row.save, rev: row.rev, now: now() });
  }
  if (p === '/api/save' && m === 'PUT') return fail(410, 'Anvilmoon was updated. Reload the page to keep playing.');

  // ---- what changed since the game last asked (the game asks every few seconds)
  if (p === '/api/poll' && m === 'GET') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    const t = now();
    const [r] = await q`select s.ver, s.next_due, s.blob->'playerMatch'->>${u.id} as pm, s.blob->'lastMatch'->>${u.id} as lm, s.blob->'queue' as queue,
        (select coalesce(string_agg(id, ',' order by id), '') from am_mail where uid = ${u.id}) as mail,
        (select count(*)::text || ':' || coalesce(max(changed), 0)::text from am_auctions) as ah,
        (select count(*)::int from am_auctions where expires <= ${t}) as ahdue,
        (select rev from am_saves where uid = ${u.id}) as rev
      from am_state s where s.id = 1`;
    if (r.ahdue > 0) await settleAuctions(q);
    const queue = r.queue || {}, queued = Object.keys(queue).find((k) => (queue[k] || []).some((x) => x.uid === u.id)) || null;
    let pvp = null, qd = queued;
    if (r.pm || r.lm || queued || t >= Number(r.next_due)) {
      const Ls = await lockState(q), st = Ls.st;
      await tick(q, st);
      for (const k of Object.keys(st.queue)) for (const x of st.queue[k]) if (x.uid === u.id) x.seen = t;
      pvp = pvpView(st, u.id); qd = queuedIn(st, u.id);
      await storeState(q, Ls);
    }
    const [sr] = await q`select rev from am_saves where uid = ${u.id}`;
    return ok({ mail: r.mail, ah: r.ah, rev: sr ? sr.rev : 0, pvp, queued: qd, now: t });
  }

  // ---- mail
  if (p === '/api/mail' && m === 'GET') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    await healGifts(q, u);
    return ok({ mail: (await q`select * from am_mail where uid = ${u.id} order by t`).map(mailOut) });
  }

  // ---- auction house (listing, bids and buyouts are actions)
  if (p === '/api/ah' && m === 'GET') {
    const u = await userFrom(q, R_);
    await settleAuctions(q);
    return ok({ listings: (await q`select data from am_auctions where expires > ${now()} order by expires`).map((r) => listingOut(r.data)), me: u ? u.id : null });
  }

  // ---- records: global leaderboards built from every player's saved blades
  if (p === '/api/records' && m === 'GET') return ok(await records(q));

  // ---- arena (queueing and leaving are actions)
  if (p === '/api/pvp/ladder' && m === 'GET') {
    const u = await userFrom(q, R_);
    const top = (await q`select * from am_users where wins + losses > 0 order by rating desc limit 25`).map((r) => publicUser(userOf(r)));
    return ok({ ladder: top, me: u ? publicUser(u) : null });
  }
  if (p === '/api/pvp/state' && m === 'GET') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    return withState(q, (st) => { const mid = st.playerMatch[u.id]; return ok({ match: mid && st.matches[mid] ? matchView(st.matches[mid], u.id) : null, queued: queuedIn(st, u.id) }); });
  }
  if (p === '/api/pvp/move' && m === 'POST') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    return withState(q, async (st) => {
      const M = st.matches[String(b.matchId || '')];
      if (!M || M.over) return fail(404, 'That duel is over.');
      const me = M.p.find((x) => x.uid === u.id);
      if (!me) return fail(403, 'That isn’t your duel.');
      if (!['strike', 'guard', 'feint'].includes(b.move)) return fail(400, 'Choose strike, guard or feint.');
      if (me.move) return fail(400, 'You’ve already chosen this round.');
      me.move = b.move;
      const foe = M.p.find((x) => x !== me);
      if (foe.bot) foe.move = botMove();
      if (M.p.every((x) => x.move)) await resolveRound(q, st, M);
      return ok({ match: matchView(M, u.id) });
    });
  }
  if (p === '/api/pvp/forfeit' && m === 'POST') {
    const u = await userFrom(q, R_); if (!u) return NEED;
    return withState(q, async (st) => {
      const mid = st.playerMatch[u.id], M = mid && st.matches[mid];
      if (!M) return ok({ ok: true });
      const me = M.p.find((x) => x.uid === u.id); me.f.hp = 0; M.log.push(`${me.smith} yields.`);
      await finishMatch(q, st, M);
      return ok({ match: matchView(M, u.id) });
    });
  }

  // ---- extra read-only requests, written as database functions named am_x_<name>(uid text, input jsonb) returning jsonb
  const xm = p.match(/^\/api\/x\/([a-z0-9_]{1,40})$/);
  if (xm && (m === 'GET' || m === 'POST')) {
    const u = await userFrom(q, R_);
    const fn = 'am_x_' + xm[1];
    const [f] = await q`select 1 as ok from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace where n.nspname = 'public' and pr.proname = ${fn}`;
    if (!f) return fail(404, 'Unknown request.');
    const input = m === 'GET' ? Object.fromEntries(R_.query) : b;
    const [r] = await q.unsafe(`select public.${fn}($1, $2::jsonb) as r`, [u ? u.id : null, input]);
    return ok(r.r === null || r.r === undefined ? {} : r.r);
  }
  return fail(404, 'Unknown request.');
}

// ============================================================== request handling
const HEAD = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
const reply = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: HEAD });
// requests that only read don't need a transaction
const READ_ONLY = new Set(['GET /api/records', 'GET /api/pvp/ladder']);

async function handle(req) {
  const url = new URL(req.url), i = url.pathname.indexOf('/api');
  const path = i < 0 ? url.pathname : url.pathname.slice(i).replace(/^\/api(\/api)+/, '/api');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' } });
  let body = null;
  if (req.method === 'POST' || req.method === 'PUT') {
    const raw = await req.text(); if (raw.length > 1e6) return reply(413, { error: 'That is too large.' });
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return reply(400, { error: 'That request isn’t valid.' }); }
    if (!body || typeof body !== 'object') body = {};
  }
  const R_ = { path, method: req.method, query: url.searchParams, body, auth: req.headers.get('authorization') || '',
    ip: (req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown' };
  try {
    const out = READ_ONLY.has(req.method + ' ' + path) ? await api(sql, R_) : await sql.begin((tx) => api(tx, R_));
    return reply(out.code, out.obj);
  } catch (e) {
    if (e && e.rule) return reply(400, { error: e.message });   // a rule said no; the transaction was undone
    throw e;
  }
}
const serve = async (req) => {
  try { return await handle(req); }
  catch (e) { console.error(e); return reply(500, { error: 'Something went wrong on the server.' }); }
};
// AM_PORT is only set by the local tests (tools/test.mjs); on Supabase the platform picks the port
if (Deno.env.get('AM_PORT')) Deno.serve({ port: Number(Deno.env.get('AM_PORT')), onListen: () => console.log('listening') }, serve); else Deno.serve(serve);
