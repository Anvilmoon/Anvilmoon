// The move from the old database layout: an old shared am_state row and an old-format save go through
// supabase/sql/migrate_v2.sql and the new server, and the player keeps their account, mail, auction and blades.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { startBackend, ROOT } from './harness.mjs';
import '../www/js/rules.js';
const R = globalThis.AMR;

// the tables as they were before this change
const OLD_SCHEMA = `
create table if not exists public.am_state (id int primary key default 1 check (id = 1), ver bigint not null default 0, next_due bigint not null default 0, blob jsonb not null default '{}'::jsonb);
create table if not exists public.am_saves (uid text primary key, save jsonb, save_at bigint not null default 0, rev int not null default 0);
create table if not exists public.am_history (uid text not null, at bigint not null, rev int not null default 0, save jsonb, primary key (uid, at));
insert into public.am_state (id) values (1) on conflict do nothing;`;
const salt = 'abcd', pass = salt + ':' + crypto.scryptSync('oldpassword1', salt, 64).toString('hex');
const token = 'old-session-token', th = crypto.createHash('sha256').update(token).digest('hex');
const now = Date.now();
const blade = (id, o = {}) => ({ id, type: 'seax', rarity: 1, variant: 0, len: 95.5, si: 2, shine: '', moon: false, grade: 70, cracked: false, anvil: 0, forger: 'Old Name', status: 'owned', t: now - 1e6, ...o });
const smith = (cid, name, coin, blades) => ({ cid, name, cls: 'war', coin, iron: 5, coal: 5, fuel: 3, damascus: 1, dust: 0, shards: 0, fuelTs: now - 1e6, anvil: 1, hammer: 'worn', hammers: {}, blades, demand: { seax: 0.8 }, commissions: [], trader: [], forged: blades.length, meals: { d: new Date().toDateString(), n: 2 } });
const oldSave = { slots: [smith('sA', 'Old Name', 100, [blade(1), blade(2, { status: 'listed', ahId: 'lclient1' }), blade(3, { status: 'pending' })]), smith('sB', 'Second', 50, [blade(1, { type: 'gladius', rarity: 4 })]), null, null],
  active: 0, serial: 3, totalForged: 4, tab: 'forge', rev: 77, base: 12, pushed: 77, claimed: { 'seax:found1': 1 }, mailSeen: {} };
const listing = { id: 'aold1', seller: 'u1', sellerName: 'veteran', sellerSmith: 'Old Name', sellerCid: 'sA', clientId: 'lclient1', blade: blade(0), bladeName: 'Fine Iron Seax', start: 5, buyout: 0, bid: 0, bidder: null, bidderCid: null, bidderSmith: null, deposit: 2, created: now, expires: now + 3600e3 };
const blob = { users: { u1: { id: 'u1', username: 'veteran', pass, created: now - 9e8, rating: 1040, wins: 3, losses: 1, rc: null, links: {} }, u2: { id: 'u2', username: 'rival', pass, created: now, rating: 1000, wins: 0, losses: 0 } },
  names: { veteran: 'u1', rival: 'u2' }, sessions: { [th]: { uid: 'u1', exp: now + 864e5 } }, links: {}, limits: {},
  mail: { mold1: { id: 'mold1', to: 'u1', t: now, cid: 'sA', coin: 25, note: 'An old letter.' } }, ah: { aold1: listing }, ahRev: 4,
  queue: { ranked: [], wager: [] }, matches: {}, playerMatch: {}, seq: 9, campaigns: { 'testsword-2026-11-18': { at: now - 1e9, sent: 2 }, 'testsword-lexy-second': { at: 1 }, 'sweetchilli-2026-11-19': { at: 1 }, 'testsword-mouflon-2026-11-24': { at: 1 } }, config: { hideFromRecords: [] } };
const q = (v) => "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";

let B;
before(async () => {
  B = await startBackend({ schema: OLD_SCHEMA, sqlBefore: [
    `update am_state set blob = ${q(blob)} where id = 1;`,
    `insert into am_saves (uid, save, save_at, rev) values ('u1', ${q(oldSave)}, ${now}, 12);`,
    readFileSync(ROOT + 'supabase/sql/migrate_v2.sql', 'utf8'),
    readFileSync(ROOT + 'supabase/sql/migrate_v2.sql', 'utf8'),   // running it twice changes nothing
  ] });
});
after(async () => { await B?.stop(); });

test('the old session still works and the old password still signs in', async () => {
  const me = await B.call('/api/me', { token });
  assert.equal(me.status, 200, me.error); assert.equal(me.user.username, 'veteran'); assert.equal(me.user.rating, 1040);
  const li = await B.call('/api/login', { method: 'POST', body: { username: 'Veteran', password: 'oldpassword1' } });
  assert.equal(li.status, 200, li.error);
});

test('the old save is folded into one smith and nothing is lost', async () => {
  const s = await B.call('/api/save', { token });
  assert.equal(s.status, 200, s.error);
  const S = s.save, c = S.slots[0];
  assert.equal(S.slots.filter(Boolean).length, 1);
  assert.equal(c.coin, 150, 'both smiths’ coin');
  assert.equal(c.blades.length, 4, 'every blade kept');
  assert.equal(c.name, 'veteran'); assert.ok(c.blades.filter((b) => b.type === 'seax').every((b) => b.forger === 'veteran'), 're-signed to the username');
  assert.equal(c.blades.find((b) => b.id === 3).status, 'owned', 'an unfinished reveal lands on the rack');
  assert.equal(new Set(c.blades.map((b) => b.id)).size, 4, 'ids are unique');
  assert.equal(S.tab, undefined); assert.equal(S.base, undefined);
  assert.ok(S.hall && S.hall.stats, 'the public hall is worked out');
  assert.ok(s.rev > 12, 'the upgraded save was stored');
  const again = await B.call('/api/save', { token });
  assert.equal(again.rev, s.rev, 'and is stored only once');
});

test('old mail, the old auction and actions work after the move', async () => {
  const mail = await B.call('/api/mail', { token });
  assert.equal(mail.mail.length, 1); assert.equal(mail.mail[0].coin, 25); assert.equal(mail.mail[0].to, 'u1');
  const s = await B.call('/api/save', { token });
  const col = await B.call('/api/act', { method: 'POST', token, body: { name: 'mailCollect', args: { ids: ['mold1'] } } });
  assert.equal(col.status, 200, col.error); assert.equal(col.from, s.rev);
  const S = R.applyPatch(s.save, col.ops ?? []); const c = col.save ? col.save.slots[0] : S.slots[0];
  assert.equal(c.coin, 150 + 25 + 36, 'the letter’s 25, plus the Armory reward for the gladius the second smith had (20 x 1.8)');
  const ah = await B.call('/api/ah');
  assert.equal(ah.listings.length, 1); assert.equal(ah.listings[0].id, 'aold1');
  const cancel = await B.call('/api/act', { method: 'POST', token, body: { name: 'ahCancel', args: { id: 'aold1' } } });
  assert.equal(cancel.status, 200, cancel.error);
  const after = (await B.call('/api/save', { token })).save.slots[0];
  assert.equal(after.blades.find((b) => b.id === 2).status, 'owned', 'the listed blade is back on the rack');
});

test('the shared row keeps only Arena, campaigns and settings, with a backup of the old one', async () => {
  const r = await B.db.query('select blob from am_state where id = 1');
  const b = r.rows[0].blob;
  assert.equal(b.users, undefined); assert.equal(b.mail, undefined); assert.ok(b.campaigns); assert.ok(b.config);
  const k = await B.db.query('select count(*)::int as n from am_state_backup');
  assert.equal(k.rows[0].n, 1, 'one backup, even though the move ran twice');
  const u = await B.db.query('select count(*)::int as n from am_users');
  assert.equal(u.rows[0].n, 2);
});
