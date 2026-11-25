// @ts-nocheck
// Anvilmoon game API as a Supabase Edge Function: accounts, cloud saves, mail, the Auction House, Records and the Arena.
// The same rules as the old PC server. Small shared state lives in one row (am_state); saves live in am_saves.
// Every request runs inside one transaction that locks the state row, so two requests can never trample each other.
import postgres from 'npm:postgres@3.4.5';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TYPEW } from './types.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL'), { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10 });
const SESSION_DAYS = 30, AH_CUT = 0.05, MAX_LISTINGS_PER_USER = 20;
const DURATIONS = { short: 30 * 60e3, medium: 2 * 3600e3, long: 12 * 3600e3 };
let db = null, dirty = false;
const markDirty = () => { dirty = true; };
const id = (p) => p + (++db.seq).toString(36) + crypto.randomBytes(4).toString('hex');
const now = () => Date.now();

// ---------------------------------------------------------------- accounts
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
function checkPw(pw, stored) {
  const [salt, h] = String(stored).split(':');
  const a = Buffer.from(h || '', 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
function newSession(uid) {
  const t = crypto.randomBytes(32).toString('base64url');
  db.sessions[tokenHash(t)] = { uid, exp: now() + SESSION_DAYS * 864e5 }; markDirty();
  return t;
}
function userFrom(R) {
  const h = R.auth || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : R.query.get('token');
  if (!t) return null;
  const s = db.sessions[tokenHash(t)];
  if (!s || s.exp < now()) return null;
  return db.users[s.uid] || null;
}
const cleanName = (v, fallback = 'Unknown') => (String(v || '').normalize('NFC').replace(/[^\p{L}\p{N} .\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24) || fallback);
const publicUser = (u) => ({ id: u.id, username: u.username, rating: u.rating, wins: u.wins, losses: u.losses, created: u.created });

// per-key throttles, kept in the shared state so they hold across function instances
function limited(key, max, windowMs) {
  const a = db.limits[key] || { n: 0, t: now() };
  if (now() - a.t > windowMs) { a.n = 0; a.t = now(); }
  a.n++; db.limits[key] = a; markDirty();
  return a.n > max;
}
const TESTING = Deno.env.get('AM_TEST') === '1';   // local test runs only
const throttled = (ip) => !TESTING && limited('ip:' + ip, 10, 60e3);

// ---------------------------------------------------------------- live updates
// There is no always-open connection any more. The game asks /api/poll every few seconds; these counters tell it what changed.
const push = () => {};
const pushAll = (type) => { if (type === 'ah') db.ahRev = (db.ahRev || 0) + 1; };
const mailSig = (uid) => Object.values(db.mail).filter((m) => m.to === uid).map((m) => m.id).sort().join(',');

// ---------------------------------------------------------------- mail
function sendMail(to, body) {
  const m = { id: id('m'), to, t: now(), ...body };
  db.mail[m.id] = m; markDirty();
  return m;
}

// ---------------------------------------------------------------- records (global leaderboards)
const REC_LIVE = ['owned', 'sold', 'commission', 'listed'];
async function records(tx) {
  if (db.rec && db.rec.data && now() - db.rec.at < 5 * 60e3) return db.rec.data;
  const rows = await tx`select uid, save from am_saves`;
  // accounts listed in config.hideFromRecords (the official account, for one) never appear on the boards
  const hide = new Set(((db.config && db.config.hideFromRecords) || []).map((n) => String(n).toLowerCase()));
  const seen = new Set(), all = [];
  for (const r of rows) {
    const u = db.users[r.uid]; if (!u || hide.has(u.username.toLowerCase())) continue;
    const slots = (r.save && Array.isArray(r.save.slots)) ? r.save.slots : [];
    for (const c of slots) {
      if (!c || !Array.isArray(c.blades)) continue;
      for (const b of c.blades) {
        if (!b || !REC_LIVE.includes(b.status) || b.cracked || typeof b.len !== 'number' || !b.type || isGift(b.type)) continue;
        const key = [b.forger, b.type, b.len, b.grade, b.rarity].join('|');
        if (seen.has(key)) continue; seen.add(key);
        all.push({ who: cleanName(b.forger || c.name, '?'), user: u.username, type: String(b.type), len: b.len, si: b.si | 0, grade: b.grade | 0,
          rarity: b.rarity | 0, anvil: b.anvil | 0, shine: b.shine === 'star' || b.shine === 'temp' ? b.shine : '', moon: b.moon ? 1 : 0, id: b.id });
      }
    }
  }
  const pick = new Set();
  const top = (arr, n) => arr.slice(0, n).forEach((x) => pick.add(x));
  top([...all].sort((a, b) => b.len - a.len), 10);
  top([...all].sort((a, b) => a.len - b.len), 6);
  top([...all].sort((a, b) => b.grade - a.grade), 6);
  top(all.filter((x) => x.anvil === 0).sort((a, b) => b.len - a.len), 6);
  const best = {}; for (const x of all) if (!best[x.type] || x.len > best[x.type].len) best[x.type] = x;
  Object.values(best).forEach((x) => pick.add(x));
  db.rec = { at: now(), data: { entries: [...pick], players: Object.keys(db.users).length, blades: all.length } }; markDirty();
  return db.rec.data;
}

// ---------------------------------------------------------------- save history
// A copy of each account's save is kept at most every 10 minutes (last 12), so anything lost can be restored.
async function snapshot(tx, uid, cur) {
  if (!cur || !cur.save) return;
  const [last] = await tx`select max(at) as at from am_history where uid = ${uid}`;
  if (last && last.at && now() - Number(last.at) < 10 * 60e3) return;
  await tx`insert into am_history (uid, at, rev, save) values (${uid}, ${now()}, ${cur.rev || 0}, ${tx.json(cur.save)})`;
  await tx`delete from am_history where uid = ${uid} and at not in (select at from am_history where uid = ${uid} order by at desc limit 12)`;
}

// ---------------------------------------------------------------- keepsakes (gift blades)
const GIFT_TYPES = new Set(['testsword', 'sweetchilli']);
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
const cfg = (k) => (db && db.config && Array.isArray(db.config[k]) ? db.config[k] : []);
const personalAll = () => [...PERSONAL, ...cfg('personal')];
const isGift = (t) => GIFT_TYPES.has(t) || cfg('giftTypes').includes(t);
const GIFT_IDS = [...CAMPAIGNS, ...EXTRA_GIFTS, ...PERSONAL].map((g) => g.id);
const personalFor = (u) => personalAll().filter((g) => u && u.username.toLowerCase() === g.username);
function runCampaigns() {
  db.campaigns = db.campaigns || {};
  if ([...GIFT_IDS, ...cfg('personal').map((g) => g.id)].every((g) => db.campaigns[g])) return;
  for (const c of CAMPAIGNS) {
    if (db.campaigns[c.id]) continue;
    const users = Object.values(db.users);
    for (const u of users) sendMail(u.id, { cid: null, blade: { ...c.blade }, note: c.note, gift: c.id });
    db.campaigns[c.id] = { at: now(), sent: users.length }; markDirty();
  }
  for (const x of EXTRA_GIFTS) {
    if (db.campaigns[x.id]) continue;
    const c = CAMPAIGNS.find((k) => k.id === x.campaign), u = Object.values(db.users).find((v) => v.username.toLowerCase() === x.username);
    if (!c || !u) continue;
    sendMail(u.id, { cid: null, blade: { ...c.blade }, note: c.note, gift: x.id });
    db.campaigns[x.id] = { at: now(), sent: 1 }; markDirty();
  }
  for (const g of personalAll()) {
    if (db.campaigns[g.id]) continue;
    const u = Object.values(db.users).find((v) => v.username.toLowerCase() === g.username);
    if (!u) continue;
    sendMail(u.id, { cid: null, blade: { ...g.blade }, note: g.note, gift: g.id });
    db.campaigns[g.id] = { at: now(), sent: 1, to: u.id }; markDirty();
  }
}
// If a recipient's saved game has no copy and none is waiting in their mail (for example a stale tab saved over it), send it again.
async function healGifts(tx, u) {
  if (!u || !db.campaigns) return;
  const due = [];
  for (const c of [...CAMPAIGNS, ...personalFor(u)]) {
    const rec = db.campaigns[c.id]; if (!rec || (u.created || 0) > rec.at) continue;
    if (rec.to && rec.to !== u.id) continue;
    if (Object.values(db.mail).some((m) => m.to === u.id && m.gift === c.id)) continue;
    rec.last = rec.last || {};
    if (now() - (rec.last[u.id] || rec.at) < 5 * 60e3) continue;
    due.push([c, rec]);
  }
  if (!due.length) return;
  const [row] = await tx`select save from am_saves where uid = ${u.id}`;
  const slots = (row && row.save && Array.isArray(row.save.slots)) ? row.save.slots : [];
  for (const [c, rec] of due) {
    rec.last[u.id] = now(); markDirty();   // look again in five minutes at the earliest
    if (slots.some((sm) => sm && Array.isArray(sm.blades) && sm.blades.some((b) => b && b.type === c.blade.type))) continue;
    sendMail(u.id, { cid: null, blade: { ...c.blade }, note: c.note, gift: c.id, heal: true });
  }
}

// ---------------------------------------------------------------- blades
function cleanBlade(b) {
  if (!b || typeof b !== 'object') return null;
  const o = {}, num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  if (typeof b.type !== 'string' || !/^[a-z0-9]{2,24}$/.test(b.type)) return null;
  o.type = b.type; o.rarity = Math.round(num(b.rarity, 0, 4)); o.variant = Math.round(num(b.variant, 0, 5));
  o.len = Math.round(num(b.len, 1, 5000) * 10) / 10; o.si = Math.round(num(b.si, 0, 6)); o.grade = Math.round(num(b.grade, 1, 100));
  o.anvil = Math.round(num(b.anvil, 0, 4));
  if (b.shine === 'temp' || b.shine === 'star') o.shine = b.shine; else o.shine = '';
  if (b.moon) o.moon = true; if (b.bog) o.bog = true; if (b.perfect) o.perfect = true;
  if (typeof b.q === 'string' && /^(oil|brine|water)$/.test(b.q)) o.q = b.q;
  o.forger = cleanName(b.forger); o.t = num(b.t, 0, 9e15);
  return o;
}
const bladeLabel = (b) => `${b.moon ? 'Moonlit ' : ''}${b.shine === 'star' ? 'Starforged ' : b.shine === 'temp' ? 'Tempered ' : ''}${['Common', 'Fine', 'Masterwork', 'Heirloom', 'Legendary'][b.rarity]} ${b.type}`;

// ---------------------------------------------------------------- auction house
const minBid = (L) => (L.bid ? Math.max(L.bid + 1, Math.ceil(L.bid * 1.05)) : L.start);
const listingOut = (L) => ({ id: L.id, seller: L.seller, sellerSmith: cleanName(L.sellerSmith), blade: { ...L.blade, forger: cleanName(L.blade && L.blade.forger) }, start: L.start, buyout: L.buyout, bid: L.bid, bidder: L.bidder, bidderSmith: L.bidderSmith ? cleanName(L.bidderSmith) : L.bidderSmith, expires: L.expires, created: L.created });
function settle() {
  let changed = false;
  for (const L of Object.values(db.ah)) {
    if (L.expires > now()) continue;
    if (L.bidder) {
      sendMail(L.bidder, { cid: L.bidderCid, blade: L.blade, note: `You won the auction for ${L.bladeName}, paying ${L.bid}c.` });
      const pay = Math.floor(L.bid * (1 - AH_CUT)) + L.deposit;
      sendMail(L.seller, { cid: L.sellerCid, coin: pay, soldId: L.clientId, note: `Your ${L.bladeName} sold at auction for ${L.bid}c. After the 5% cut and with your deposit back, you receive ${pay}c.` });
    } else {
      sendMail(L.seller, { cid: L.sellerCid, returnId: L.clientId, note: `Your ${L.bladeName} didn’t sell and is back on your rack. The deposit is kept.` });
    }
    delete db.ah[L.id]; changed = true;
  }
  if (changed) { markDirty(); pushAll('ah'); }
}

// ---------------------------------------------------------------- arena (PvP)
// Moves: strike beats feint, feint beats guard, guard beats strike (and counters).
const WEIGHT = { L: 1, M: 1.4, H: 2.5, X: 3.6 };
function fighter(blade) {
  const wt = TYPEW[blade.type] || 'M';
  const power = 14 * Math.sqrt(WEIGHT[wt]) * (1 + blade.rarity * 0.12) * (0.75 + blade.grade / 200) * (blade.shine === 'star' ? 1.08 : 1);
  return { wt, power: Math.round(power * 10) / 10, hp: 100 };
}
const ROUND_MS = 15e3, MAX_ROUNDS = 12, BOT_WAIT_MS = 20e3;
function matchView(M, uid) {
  const me = M.p.find((p) => p.uid === uid), foe = M.p.find((p) => p.uid !== uid);
  return {
    id: M.id, mode: M.mode, round: M.round, deadline: M.deadline, over: M.over, winner: M.winner,
    you: { name: me.name, smith: me.smith, blade: me.blade, hp: me.f.hp, power: me.f.power, moved: !!me.move, rating: me.rating },
    foe: { name: foe.name, smith: foe.smith, blade: foe.blade, hp: foe.f.hp, power: foe.f.power, moved: !!foe.move, bot: !!foe.bot, rating: foe.rating },
    log: M.log.slice(-8), result: M.over ? M.result[uid] : null,
  };
}
function startMatch(mode, a, b) {
  const M = { id: id('x'), mode, round: 1, log: [], over: false, result: {}, p: [a, b] };
  for (const p of M.p) { p.f = fighter(p.blade); p.move = null; if (!p.bot) db.playerMatch[p.uid] = M.id; }
  M.deadline = now() + ROUND_MS; db.matches[M.id] = M; markDirty();
  M.log.push(`${a.smith} (${a.name}) faces ${b.smith}${b.bot ? '' : ` (${b.name})`}.`);
  return M;
}
function botMove() { const r = Math.random(); return r < 0.4 ? 'strike' : r < 0.7 ? 'guard' : 'feint'; }
function resolveRound(M) {
  const [a, b] = M.p;
  for (const p of M.p) if (!p.move) p.move = p.bot ? botMove() : 'guard';
  const hit = (att, def, mult) => { const d = Math.round(att.f.power * mult * (0.9 + Math.random() * 0.2)); def.f.hp = Math.max(0, def.f.hp - d); return d; };
  const bonus = (p, mv) => (mv === 'strike' && p.f.wt === 'X') || (mv === 'feint' && p.f.wt === 'L') ? 1.15 : 1;
  const ma = a.move, mb = b.move; let line;
  if (ma === mb) {
    if (ma === 'strike') { const d1 = hit(a, b, 0.6 * bonus(a, ma)), d2 = hit(b, a, 0.6 * bonus(b, mb)); line = `Both strike. ${a.smith} deals ${d1}, ${b.smith} deals ${d2}.`; }
    else line = ma === 'guard' ? 'Both guard. Steel rings, nobody is hurt.' : 'Both feint. Neither falls for it.';
  } else {
    const beats = { strike: 'feint', feint: 'guard', guard: 'strike' };
    const [w, l] = beats[ma] === mb ? [a, b] : [b, a];
    const mw = w.move;
    if (mw === 'strike') line = `${w.smith} strikes through ${l.smith}’s feint for ${hit(w, l, 1 * bonus(w, mw))}.`;
    else if (mw === 'feint') line = `${w.smith} feints past ${l.smith}’s guard for ${hit(w, l, 0.8 * bonus(w, mw))}.`;
    else line = `${w.smith} guards and counters ${l.smith}’s strike for ${hit(w, l, 0.5 * (0.5 + w.blade.grade / 100))}.`;
  }
  M.log.push(`Round ${M.round}: ${line}`);
  for (const p of M.p) p.move = null;
  if (a.f.hp <= 0 || b.f.hp <= 0 || M.round >= MAX_ROUNDS) finishMatch(M);
  else { M.round++; M.deadline = now() + ROUND_MS; }
  markDirty();
}
function finishMatch(M) {
  const [a, b] = M.p;
  M.over = true; M.overAt = now();
  const winner = a.f.hp === b.f.hp ? null : a.f.hp > b.f.hp ? a : b, loser = winner && (winner === a ? b : a);
  M.winner = winner ? winner.uid : null;
  M.log.push(winner ? `${winner.smith} wins the duel.` : 'The duel ends in a draw.');
  for (const p of M.p) {
    if (p.bot) continue;
    const u = db.users[p.uid], r = { outcome: !winner ? 'draw' : p === winner ? 'win' : 'loss', ratingChange: 0 };
    const foe = p === a ? b : a;
    if (u && M.mode === 'ranked' && !foe.bot) {
      const exp = 1 / (1 + Math.pow(10, (foe.rating - p.rating) / 400)), score = r.outcome === 'win' ? 1 : r.outcome === 'loss' ? 0 : 0.5;
      r.ratingChange = Math.round(32 * (score - exp)); u.rating += r.ratingChange;
    }
    if (u && !foe.bot) { if (r.outcome === 'win') u.wins++; else if (r.outcome === 'loss') u.losses++; }
    M.result[p.uid] = r; delete db.playerMatch[p.uid];
  }
  if (M.mode === 'wager' && winner && !loser.bot && !winner.bot) {
    sendMail(winner.uid, { cid: winner.cid, blade: loser.blade, note: `You won ${loser.smith}’s ${bladeLabel(loser.blade)} in a wager duel.` });
    M.result[loser.uid].lostBladeId = loser.clientBladeId;
  }
  markDirty();
}
// Everything the old server did on a timer now happens at the start of whichever request arrives next.
function tick() {
  runCampaigns(); settle();
  for (const M of Object.values(db.matches)) {
    if (!M.over && now() > M.deadline) resolveRound(M);
    if (M.over && now() - (M.overAt || 0) > 60e3) { delete db.matches[M.id]; markDirty(); }
  }
  const q = db.queue.ranked;
  for (let i = q.length - 1; i >= 0; i--) {
    if (now() - q[i].since < BOT_WAIT_MS) continue;
    const p = q.splice(i, 1)[0];
    const bot = { uid: 'bot', bot: true, name: 'Practice', smith: ['Old Hesk', 'Kesh the Quiet', 'Ysolde Marr', 'Brannoc Ashvale'][Math.floor(Math.random() * 4)], rating: 1000,
      blade: { ...p.blade, forger: 'NPC', rarity: Math.max(0, p.blade.rarity - 1 + Math.round(Math.random() * 2)), grade: 40 + Math.round(Math.random() * 45), shine: '' } };
    startMatch('practice', p, bot);
  }
  // people who queued and then closed the game are dropped after two minutes without a check-in
  for (const k of Object.keys(db.queue)) { const n = db.queue[k].length; db.queue[k] = db.queue[k].filter((x) => now() - (x.seen || x.since) < 120e3); if (db.queue[k].length !== n) markDirty(); }
  const t = now();
  if (t - (db.prunedAt || 0) > 3600e3) {
    for (const [k, s] of Object.entries(db.sessions)) if (s.exp < t) delete db.sessions[k];
    for (const [k, a] of Object.entries(db.limits)) if (t - a.t > 3600e3) delete db.limits[k];
    db.prunedAt = t; markDirty();
  }
}
// the next moment something has to happen even if nobody acts
function nextDue() {
  let d = 9e15;
  for (const L of Object.values(db.ah)) d = Math.min(d, L.expires);
  for (const M of Object.values(db.matches)) d = Math.min(d, M.over ? (M.overAt || 0) + 60e3 : M.deadline);
  for (const p of db.queue.ranked) d = Math.min(d, p.since + BOT_WAIT_MS);
  return Math.floor(d);
}

// ---------------------------------------------------------------- API routes
const ok = (obj) => ({ code: 200, obj });
const fail = (code, msg) => ({ code, obj: { error: msg } });
async function api(tx, R) {
  const p = R.path, m = R.method, u = userFrom(R), ip = R.ip, q = R.body || {};
  const NEED = fail(401, 'Sign in first.');

  if (p === '/api/register' && m === 'POST') {
    if (throttled(ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const { username = '', password = '' } = q;
    const name = String(username).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return fail(400, 'Usernames are 3 to 20 letters, numbers or underscores.');
    if (!TESTING && (limited('reg:' + ip, 3, 3600e3) || limited('reg:all', 60, 3600e3))) return fail(429, 'Too many new accounts from here. Try again later.');
    if (String(password).length < 8) return fail(400, 'Passwords need at least 8 characters.');
    if (db.names[name.toLowerCase()]) return fail(409, 'That username is taken.');
    const user = { id: id('u'), username: name, pass: hashPw(String(password)), created: now(), rating: 1000, wins: 0, losses: 0 };
    db.users[user.id] = user; db.names[name.toLowerCase()] = user.id; markDirty();
    return ok({ token: newSession(user.id), user: publicUser(user) });
  }
  if (p === '/api/login' && m === 'POST') {
    if (throttled(ip)) return fail(429, 'Too many attempts. Wait a minute and try again.');
    const { username = '', password = '' } = q;
    const user = db.users[db.names[String(username).trim().toLowerCase()]];
    if (limited('user:' + String(username).trim().toLowerCase(), 8, 600e3)) return fail(429, 'Too many attempts on this account. Wait ten minutes and try again.');
    if (!user || !checkPw(String(password), user.pass)) return fail(401, 'That username and password don’t match.');
    return ok({ token: newSession(user.id), user: publicUser(user) });
  }
  if (p === '/api/logout' && m === 'POST') {
    const h = R.auth || ''; if (h.startsWith('Bearer ')) { delete db.sessions[tokenHash(h.slice(7))]; markDirty(); }
    return ok({ ok: true });
  }
  if (p === '/api/password' && m === 'POST') {
    if (!u) return NEED;
    const { current = '', next = '' } = q;
    if (!checkPw(String(current), u.pass)) return fail(401, 'Your current password isn’t right.');
    if (String(next).length < 8) return fail(400, 'Passwords need at least 8 characters.');
    u.pass = hashPw(String(next)); markDirty(); return ok({ ok: true });
  }
  if (p === '/api/me' && m === 'GET') {
    if (!u) return NEED;
    const [s] = await tx`select save_at from am_saves where uid = ${u.id}`;
    return ok({ user: publicUser(u), saveAt: s ? Number(s.save_at) : 0 });
  }

  // cloud save
  if (p === '/api/save' && m === 'GET') {
    if (!u) return NEED;
    const [s] = await tx`select save, save_at, rev from am_saves where uid = ${u.id}`;
    return ok({ save: s ? s.save : null, saveAt: s ? Number(s.save_at) : 0, rev: s ? s.rev : 0 });
  }
  if (p === '/api/save' && m === 'PUT') {
    if (!u) return NEED;
    const { save, base } = q;
    if (!save || typeof save !== 'object' || !Array.isArray(save.slots)) return fail(400, 'That save isn’t valid.');
    // A save must say which account save it grew from. If the account has moved on since (another device or an
    // old tab), it's refused and the client combines the two, so one device can never wipe out another's blades.
    const [s] = await tx`select save, rev from am_saves where uid = ${u.id}`;
    const cur = s ? s.rev : 0;
    if (s && s.save && base !== cur) return { code: 409, obj: { error: 'Your account has a newer save.', save: s.save, rev: cur } };
    await snapshot(tx, u.id, s);
    const at = now();
    await tx`insert into am_saves (uid, save, save_at, rev) values (${u.id}, ${tx.json(save)}, ${at}, ${cur + 1})
             on conflict (uid) do update set save = excluded.save, save_at = excluded.save_at, rev = excluded.rev`;
    return ok({ saveAt: at, rev: cur + 1 });
  }

  // what changed since the game last asked (replaces the always-open event stream)
  if (p === '/api/poll' && m === 'GET') {
    if (!u) return NEED;
    for (const k of Object.keys(db.queue)) for (const x of db.queue[k]) if (x.uid === u.id && now() - (x.seen || 0) > 30e3) { x.seen = now(); markDirty(); }
    const mid = db.playerMatch[u.id], M = mid && db.matches[mid];
    const last = Object.values(db.matches).filter((x) => x.over && x.p.some((y) => y.uid === u.id)).sort((a, b) => (b.overAt || 0) - (a.overAt || 0))[0];
    const queued = Object.keys(db.queue).find((k) => db.queue[k].some((x) => x.uid === u.id)) || null;
    return ok({ mail: mailSig(u.id), ah: db.ahRev || 0, pvp: M ? matchView(M, u.id) : last ? matchView(last, u.id) : null, queued, poll: true });
  }

  // mail
  if (p === '/api/mail' && m === 'GET') { if (!u) return NEED; await healGifts(tx, u); return ok({ mail: Object.values(db.mail).filter((x) => x.to === u.id) }); }
  if (p === '/api/mail/ack' && m === 'POST') {
    if (!u) return NEED;
    const { ids = [] } = q;
    for (const mid of ids) if (db.mail[mid] && db.mail[mid].to === u.id) { delete db.mail[mid]; markDirty(); }
    return ok({ ok: true });
  }

  // auction house
  if (p === '/api/ah' && m === 'GET') { return ok({ listings: Object.values(db.ah).filter((L) => L.expires > now()).map(listingOut), me: u ? u.id : null }); }
  if (p === '/api/ah' && m === 'POST') {
    if (!u) return NEED;
    const blade = cleanBlade(q.blade);
    if (!blade) return fail(400, 'That blade can’t be listed.');
    if (isGift(blade.type)) return fail(400, 'Keepsakes can’t be sold or traded.');
    const start = Math.floor(+q.start), buyout = Math.floor(+q.buyout || 0), dur = DURATIONS[q.dur];
    if (!(start >= 1) || !dur || (buyout && buyout < start)) return fail(400, 'Check the starting bid, buyout and duration.');
    if (Object.values(db.ah).filter((L) => L.seller === u.id).length >= MAX_LISTINGS_PER_USER) return fail(400, `You can have up to ${MAX_LISTINGS_PER_USER} auctions at once.`);
    const L = { id: id('a'), seller: u.id, sellerName: u.username, sellerSmith: cleanName(q.smith || u.username), sellerCid: q.cid || null, clientId: String(q.clientId || ''), blade, bladeName: (String(q.name || '').normalize('NFC').replace(/[^\p{L}\p{N} .,\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80) || bladeLabel(blade)),
      start, buyout, bid: 0, bidder: null, bidderCid: null, bidderSmith: null, deposit: Math.max(0, Math.floor(+q.deposit || 0)), created: now(), expires: now() + dur };
    db.ah[L.id] = L; markDirty(); pushAll('ah');
    return ok({ listing: listingOut(L) });
  }
  const am = p.match(/^\/api\/ah\/([a-z0-9]+)\/(bid|buyout|cancel)$/);
  if (am && m === 'POST') {
    if (!u) return NEED;
    const L = db.ah[am[1]], act = am[2];
    if (!L || L.expires <= now()) return fail(404, 'That auction has ended.');
    if (act === 'cancel') {
      if (L.seller !== u.id) return fail(403, 'That isn’t your auction.');
      if (L.bidder) return fail(400, 'Someone has already bid, so this auction can’t be cancelled.');
      delete db.ah[L.id]; markDirty(); pushAll('ah'); return ok({ ok: true, clientId: L.clientId });
    }
    if (L.seller === u.id) return fail(400, 'You can’t bid on your own auction.');
    const buying = act === 'buyout' || (L.buyout && +q.amount >= L.buyout);
    const amount = buying ? L.buyout : Math.floor(+q.amount);
    if (buying && !L.buyout) return fail(400, 'This auction has no buyout.');
    if (!buying && !(amount >= minBid(L))) return fail(400, `The minimum bid is ${minBid(L)}c.`);
    if (L.bidder) sendMail(L.bidder, { cid: L.bidderCid, coin: L.bid, note: `You were outbid on the ${L.bladeName}. Your ${L.bid}c bid is returned.` });
    if (buying) {
      const pay = Math.floor(amount * (1 - AH_CUT)) + L.deposit;
      sendMail(L.seller, { cid: L.sellerCid, coin: pay, soldId: L.clientId, note: `Your ${L.bladeName} was bought out for ${amount}c. After the 5% cut and with your deposit back, you receive ${pay}c.` });
      delete db.ah[L.id]; markDirty(); pushAll('ah');
      return ok({ bought: true, amount, blade: L.blade });
    }
    L.bid = amount; L.bidder = u.id; L.bidderCid = q.cid || null; L.bidderSmith = cleanName(q.smith || u.username);
    markDirty(); pushAll('ah'); return ok({ bid: amount });
  }

  // records: global leaderboards built from every player's saved blades
  if (p === '/api/records' && m === 'GET') return ok(await records(tx));
  // arena
  if (p === '/api/pvp/ladder' && m === 'GET') {
    const top = Object.values(db.users).filter((x) => x.wins + x.losses > 0).sort((a, b) => b.rating - a.rating).slice(0, 25).map(publicUser);
    return ok({ ladder: top, me: u ? publicUser(u) : null });
  }
  if (p === '/api/pvp/queue' && m === 'POST') {
    if (!u) return NEED;
    if (db.playerMatch[u.id] && db.matches[db.playerMatch[u.id]]) return fail(400, 'You’re already in a duel.');
    const blade = cleanBlade(q.blade), mode = q.mode === 'wager' ? 'wager' : 'ranked';
    if (!blade) return fail(400, 'Choose a blade to carry.');
    if (mode === 'wager' && isGift(blade.type)) return fail(400, 'Keepsakes can only fight in ranked duels.');
    for (const k of Object.keys(db.queue)) db.queue[k] = db.queue[k].filter((x) => x.uid !== u.id);
    const me = { uid: u.id, name: u.username, smith: cleanName(q.smith || u.username), cid: q.cid || null, clientBladeId: q.bladeId, blade, rating: u.rating, since: now(), seen: now() };
    const foe = db.queue[mode].shift(); markDirty();
    if (foe) { const M = startMatch(mode, foe, me); return ok({ match: matchView(M, u.id) }); }
    db.queue[mode].push(me); return ok({ queued: mode, botAfter: mode === 'ranked' ? BOT_WAIT_MS : null });
  }
  if (p === '/api/pvp/leave' && m === 'POST') {
    if (!u) return NEED;
    for (const k of Object.keys(db.queue)) db.queue[k] = db.queue[k].filter((x) => x.uid !== u.id);
    markDirty(); return ok({ ok: true });
  }
  if (p === '/api/pvp/state' && m === 'GET') {
    if (!u) return NEED;
    const mid = db.playerMatch[u.id];
    const queued = Object.keys(db.queue).find((k) => db.queue[k].some((x) => x.uid === u.id)) || null;
    return ok({ match: mid && db.matches[mid] ? matchView(db.matches[mid], u.id) : null, queued });
  }
  if (p === '/api/pvp/move' && m === 'POST') {
    if (!u) return NEED;
    const { matchId, move } = q, M = db.matches[matchId];
    if (!M || M.over) return fail(404, 'That duel is over.');
    const me = M.p.find((x) => x.uid === u.id);
    if (!me) return fail(403, 'That isn’t your duel.');
    if (!['strike', 'guard', 'feint'].includes(move)) return fail(400, 'Choose strike, guard or feint.');
    if (me.move) return fail(400, 'You’ve already chosen this round.');
    me.move = move; markDirty();
    const foe = M.p.find((x) => x !== me);
    if (foe.bot) foe.move = botMove();
    if (M.p.every((x) => x.move)) resolveRound(M);
    return ok({ match: matchView(M, u.id) });
  }
  if (p === '/api/pvp/forfeit' && m === 'POST') {
    if (!u) return NEED;
    const mid = db.playerMatch[u.id], M = mid && db.matches[mid];
    if (!M) return ok({ ok: true });
    M.p.find((x) => x.uid === u.id).f.hp = 0; M.log.push(`${M.p.find((x) => x.uid === u.id).smith} yields.`); finishMatch(M);
    return ok({ match: matchView(M, u.id) });
  }
  return fail(404, 'Unknown request.');
}

// ---------------------------------------------------------------- request handling
const HEAD = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
const reply = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: HEAD });
const blank = () => ({ users: {}, names: {}, sessions: {}, ah: {}, mail: {}, seq: 0, campaigns: {}, limits: {}, queue: { ranked: [], wager: [] }, matches: {}, playerMatch: {}, ahRev: 0, config: {} });

async function handle(req) {
  const url = new URL(req.url), i = url.pathname.indexOf('/api');
  const path = i < 0 ? url.pathname : url.pathname.slice(i).replace(/^\/api(\/api)+/, '/api');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' } });
  let body = null;
  if (req.method === 'POST' || req.method === 'PUT') {
    const raw = await req.text(); if (raw.length > 3e6) return reply(413, { error: 'That is too large.' });
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return reply(400, { error: 'That request isn’t valid.' }); }
  }
  const R = { path, method: req.method, query: url.searchParams, body, auth: req.headers.get('authorization') || '',
    ip: (req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown' };
  // Quick exit for the regular check-in: when nothing has changed and nothing is due, only two small numbers are read.
  if (path === '/api/poll' && req.method === 'GET' && url.searchParams.get('ver')) {
    const [s] = await sql`select ver, next_due from am_state where id = 1`;
    if (s && String(s.ver) === url.searchParams.get('ver') && now() < Number(s.next_due)) return reply(200, { ver: Number(s.ver) });
  }
  const out = await sql.begin(async (tx) => {
    const [row] = await tx`select ver, next_due, blob from am_state where id = 1 for update`;
    db = { ...blank(), ...(row.blob || {}) }; dirty = false;
    tick();
    const r = await api(tx, R);
    let ver = Number(row.ver);
    if (dirty) { ver++; await tx`update am_state set blob = ${tx.json(db)}, ver = ${ver}, next_due = ${nextDue()} where id = 1`; }
    else if (Number(row.next_due) <= now()) await tx`update am_state set next_due = ${nextDue()} where id = 1`;
    if (r.obj && r.obj.poll) { delete r.obj.poll; r.obj.ver = ver; }
    return r;
  });
  return reply(out.code, out.obj);
}
Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (e) { console.error(e); return reply(500, { error: 'Something went wrong on the server.' }); }
});
