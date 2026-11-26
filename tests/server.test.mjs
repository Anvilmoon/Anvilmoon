// End-to-end tests of the game server against an in-memory database. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startBackend } from './harness.mjs';
import '../www/js/rules.js';
const R = globalThis.AMR;

let B;
before(async () => { B = await startBackend(); });
after(async () => { await B?.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a signed-in player with a copy of their save kept up to date from the server's patches, like the game does
async function player(name) {
  const r = await B.call('/api/register', { method: 'POST', body: { username: name, password: 'password123' } });
  assert.equal(r.status, 200, r.error);
  const p = { name, token: r.token, user: r.user, save: null, rev: 0 };
  p.act = async (n, args = {}) => {
    const res = await B.call('/api/act', { method: 'POST', token: p.token, body: { name: n, args, tz: -60 } });
    if (res.status === 200) {
      assert.equal(res.from, p.rev, 'patch should follow on from the copy we have');
      p.save = res.save ? res.save : R.applyPatch(p.save, res.ops); p.rev = res.rev;
    }
    return res;
  };
  p.fetch = async () => { const s = await B.call('/api/save', { token: p.token }); p.save = s.save; p.rev = s.rev; return s; };
  p.c = () => p.save.slots[p.save.active];
  await p.fetch();
  return p;
}
const forge = async (p, type, q = 'oil') => {
  const s = await p.act('forgeStart', { type }); assert.equal(s.status, 200, s.error);
  const need = R.WT[R.TYPES[type].wt].strikes;
  await sleep(need * R.MIN_STRIKE_MS + 20);
  return p.act('forgeEnd', { q, strikes: Array.from({ length: need }, () => [0, 0.7]) });
};
// a blade that didn't crack in the quench (oil cracks 3% of blades): forge again if it did
const sound = async (p, type = 'seax') => {
  for (let i = 0; i < 4; i++) { const r = await forge(p, type); assert.equal(r.status, 200, r.error); if (!r.out.blade.cracked) return r.out.blade; }
  throw new Error('four cracked blades in a row');
};

test('a new player makes a smith and the patches keep their copy exact', async () => {
  const a = await player('alice');
  assert.equal(a.save, null);
  const r = await a.act('createSmith');
  assert.equal(r.status, 200, r.error);
  const server = await B.call('/api/save', { token: a.token });
  assert.deepEqual(a.save, server.save);
  assert.equal(a.c().coin, 80); assert.equal(a.c().commissions.length, 3);
});

test('forging: the server rolls the blade, a perfect hand forge is grade 88 in oil', async () => {
  const a = await player('bob'); await a.act('createSmith');
  const r = await forge(a, 'seax');
  assert.equal(r.status, 200, r.error);
  assert.equal(r.out.blade.grade, 88);
  assert.equal(r.out.blade.forger, 'bob');
  const c = a.c(); assert.equal(c.fuel, 9); assert.equal(c.iron, 11); assert.equal(c.coal, 7); assert.equal(c.forged, 1);
  if (!r.out.blade.cracked) assert.ok(r.notes.some((n) => /first find/.test(n.text)), 'armory reward note');   // a cracked blade (3% in oil) finds nothing
  assert.deepEqual(a.save, (await B.call('/api/save', { token: a.token })).save);
});

test('cheats are refused', async () => {
  const a = await player('mallory'); await a.act('createSmith');
  // uploading a save is gone
  assert.equal((await B.call('/api/save', { method: 'PUT', token: a.token, body: { save: { slots: [] } } })).status, 410);
  // a forge finished faster than any hammer
  await a.act('forgeStart', { type: 'seax' });
  const fast = await a.act('forgeEnd', { q: 'oil', strikes: [[0, .7], [0, .7], [0, .7], [0, .7]] });
  assert.equal(fast.status, 400);
  // the wrong number of strikes
  await sleep(1200);
  assert.equal((await a.act('forgeEnd', { q: 'oil', strikes: [[0, .7]] })).status, 400);
  // a quench not learned yet
  assert.equal((await a.act('forgeEnd', { q: 'water', strikes: [[0, .7], [0, .7], [0, .7], [0, .7]] })).status, 400);
  // selling a blade you don't have, buying with coin you don't have, an unlock you can't afford
  assert.equal((await a.act('sell', { ids: [999] })).status, 400);
  assert.equal((await a.act('buy', { m: 'damascus', n: 1000 })).status, 400);
  assert.equal((await a.act('unlock', { k: 'X' })).status, 400);
  assert.equal((await a.act('learn', { k: 'X' })).status, 400, 'the old learn action is gone');
  assert.equal((await a.act('forgeStart', { type: 'zwei' })).status, 400, 'massive pattern not known');
  assert.equal((await a.act('forgeStart', { type: 'katana' })).status, 400, 'another style');
  assert.equal((await a.act('nonsense')).status, 400);
  assert.equal(a.c().coin, 80, 'nothing changed');
});

test('selling to the scrap merchant, buying and eating follow the rules', async () => {
  const a = await player('carol'); await a.act('createSmith');
  const b = await sound(a);
  const coin = a.c().coin, price = R.scrapPrice(b);
  const s = await a.act('sell', { ids: [b.id] });
  assert.equal(s.status, 200, s.error);
  assert.equal(s.out.coin, price);
  assert.ok(a.c().coin >= coin + s.out.coin, 'coin paid (plus any getting-started reward)');
  assert.equal(R.bladeById(a.c(), b.id).status, 'sold');
  assert.equal((await a.act('sell', { ids: [b.id] })).status, 400, 'cannot sell twice');
  const iron = a.c().iron; assert.equal((await a.act('buy', { m: 'iron', n: 3 })).status, 200); assert.equal(a.c().iron, iron + 3);
  const fuel = a.c().fuel;   // 9 after one forge (8 if the first blade cracked and was forged again)
  assert.equal((await a.act('eat', { k: 'feast' })).status, 200, '9 + 12 energy fits');
  assert.equal(a.c().fuel, fuel + 12);
  assert.equal((await a.act('eat', { k: 'feast' })).status, 400, 'too full: 21 + 12 is over 30');
});

test('auctions: deposit, bids need real coin, outbid refunds by mail, buyout hands the blade over', async () => {
  const s = await player('seller'), b1 = await player('bidder1'), b2 = await player('bidder2');
  for (const p of [s, b1, b2]) await p.act('createSmith');
  const blade = await sound(s), blade2 = await sound(s);
  const coin0 = s.c().coin;
  const L = await s.act('ahList', { id: blade.id, start: 5, buyout: 300, dur: 'short' });
  assert.equal(L.status, 200, L.error);
  assert.equal(s.c().coin, coin0 - L.out.deposit);
  assert.equal(R.bladeById(s.c(), blade.id).status, 'listed');
  assert.equal((await s.act('ahList', { id: blade.id, start: 5, dur: 'short' })).status, 400, 'already listed');
  const id = L.out.listing.id;
  // a bid bigger than the bidder's purse is refused (this used to mint coin)
  assert.equal((await b1.act('ahBid', { id, amount: 100 })).status, 400);
  assert.equal((await b1.act('ahBid', { id, amount: 10 })).status, 200);
  assert.equal(b1.c().coin, 70);
  assert.equal((await b2.act('ahBid', { id, amount: 10 })).status, 400, 'below the minimum next bid');
  assert.equal((await b2.act('ahBid', { id, amount: 20 })).status, 200);
  const mail = await B.call('/api/mail', { token: b1.token });
  assert.equal(mail.mail.length, 1); assert.equal(mail.mail[0].coin, 10);
  const got = await b1.act('mailCollect', { ids: [mail.mail[0].id] });
  assert.equal(got.status, 200, got.error); assert.equal(b1.c().coin, 80);
  assert.equal((await b1.act('mailCollect', { ids: [mail.mail[0].id] })).status, 400, 'mail collects once');
  assert.equal((await b1.act('ahBuyout', { id })).status, 400, 'buyout of 300 is more than 80 coin');
  // cancelling is refused once someone has bid
  assert.equal((await s.act('ahCancel', { id })).status, 400);
  // a second listing, bought out
  const L2 = await s.act('ahList', { id: blade2.id, start: 5, buyout: 60, dur: 'short' });
  const buy = await b1.act('ahBuyout', { id: L2.out.listing.id });
  assert.equal(buy.status, 200, buy.error);
  assert.equal(b1.c().coin, 80 - 60 + 20 + (blade2.moon ? 25 : 0), 'paid 60, plus the Armory reward for a first seax (and a first Moonlit one at night)');
  assert.ok(b1.c().blades.some((x) => x.type === 'seax' && x.status === 'owned'));
  // the seller is paid by mail and the blade is marked sold when they collect it
  const sm = (await B.call('/api/mail', { token: s.token })).mail;
  assert.equal(sm.length, 1); assert.equal(sm[0].coin, Math.floor(60 * .95) + L2.out.deposit);
  await s.act('mailCollect', { ids: [sm[0].id] });
  assert.equal(R.bladeById(s.c(), blade2.id).status, 'sold');
  // bidder2 is still the top bidder on the first auction, holding 20 coin there
  assert.equal(b2.c().coin, 60);
});

test('wager duels: the loser’s blade is lost on the server even if their game is closed', async () => {
  const a = await player('duelA'), d = await player('duelB');
  await a.act('createSmith'); await d.act('createSmith');
  const ba = await sound(a), bd = await sound(d);
  const q1 = await a.act('arenaQueue', { mode: 'wager', id: ba.id });
  assert.equal(q1.status, 200, q1.error); assert.equal(q1.out.queued, 'wager');
  assert.equal(R.bladeById(a.c(), ba.id).status, 'wager');
  assert.equal((await a.act('sell', { ids: [ba.id] })).status, 400, 'a blade at stake cannot be sold');
  const q2 = await d.act('arenaQueue', { mode: 'wager', id: bd.id });
  assert.ok(q2.out.match, 'matched');
  const mid = q2.out.match.id;
  // duelB yields: duelA wins
  const fo = await B.call('/api/pvp/forfeit', { method: 'POST', token: d.token, body: {} });
  assert.equal(fo.match.result.outcome, 'loss');
  await d.fetch(); await a.fetch();
  assert.equal(R.bladeById(d.c(), bd.id).status, 'lost');
  assert.equal(R.bladeById(a.c(), ba.id).status, 'owned', 'the winner’s blade is back on the rack');
  const mail = (await B.call('/api/mail', { token: a.token })).mail;
  assert.equal(mail.length, 1); assert.equal(mail[0].blade.type, 'seax');
  assert.ok(mid);
});

test('the poll reports a new save revision so other tabs can catch up', async () => {
  const a = await player('pollie'); await a.act('createSmith');
  const p1 = await B.call('/api/poll', { token: a.token });
  assert.equal(p1.rev, a.rev);
  await a.act('buy', { m: 'iron', n: 1 });
  const p2 = await B.call('/api/poll', { token: a.token });
  assert.equal(p2.rev, a.rev);
});

test('records come from server-written saves', async () => {
  const r = await B.call('/api/x/records');
  assert.equal(r.status, 200, r.error);
  assert.ok(r.entries.length > 0);
  assert.ok(r.smiths.bob);
  const h = await B.call('/api/x/hall?u=bob');
  assert.equal(h.user, 'bob'); assert.ok(h.hall && h.hall.stats.forged === 1);
});

// ---------------------------------------------------------------------------------------------- the shop redesign
// Change a player's stored save directly in the test database (to skip the hours of play an unlock needs), then
// fetch it again like a reloaded game would. fn(S, c) edits the save in place.
async function edit(p, fn) {
  const r = await B.db.query('select a.uid, a.save from am_saves a join am_users u on u.uid = a.uid where u.uname_lc = $1', [p.name.toLowerCase()]);
  const S = r.rows[0].save; fn(S, S.slots[S.active]);
  await B.db.query('update am_saves set save = $1::text::jsonb where uid = $2', [JSON.stringify(S), r.rows[0].uid]);
  await p.fetch();
}
// the stone swept from end to end at a steady 0.7 tracks a second
const sweep = (n, step = 35) => { const out = []; let x = 50, d = 1; for (let i = 0; i < n; i++) { out.push(x); x += d * step; if (x >= 950) { x = 950; d = -1; } if (x <= 50) { x = 50; d = 1; } } return out; };
// a copy of a blade with a new id, straight onto the rack
const copyBlade = (S, c, b, o = {}) => { const x = { ...structuredClone(b), id: ++S.serial, status: 'owned', ...o }; c.blades.push(x); return x; };
// the rune's guide traced exactly, t rising 10 ms per point
const traced = (rune) => { let t = 0; return R.RUNES[rune].s.map((l) => l.map(([x, y]) => [x, y, t += 10])); };

test('polishing: start takes the grit, end rolls the polish and raises the worth; cheats are refused', async () => {
  const a = await player('polly'); await a.act('createSmith');
  const blade = await sound(a);
  assert.equal((await a.act('polishStart', { id: blade.id })).status, 400, 'no bench yet');
  let cracked, extra;
  await edit(a, (S, c) => { c.recipes.M = true; c.recipes.polish = true; c.grit = 10; cracked = copyBlade(S, c, blade, { cracked: true }).id; extra = copyBlade(S, c, blade).id; });
  const st = await a.act('polishStart', { id: blade.id });
  assert.equal(st.status, 200, st.error);
  assert.equal(st.out.seed, R.hash32(`${a.c().cid}:${blade.id}:polish`)); assert.equal(a.c().grit, 9); assert.equal(a.save.polish.id, blade.id);
  // 400 samples (20 seconds of rubbing) sent at once: refused, and the polish is still open
  assert.equal((await a.act('polishEnd', { samples: sweep(400) })).status, 400, 'quicker than any stone');
  for (const bad of [[0.5, 100], [100, 1001], [-2, 5], 'nonsense', Array(402).fill(500)]) assert.equal((await a.act('polishEnd', { samples: bad })).status, 400, JSON.stringify(bad).slice(0, 40));
  // pretend the 20 seconds have passed
  await edit(a, (S) => { S.polish.t0 -= 30000; });
  const end = await a.act('polishEnd', { samples: sweep(401) });
  assert.equal(end.status, 200, end.error);
  const b = R.bladeById(a.c(), blade.id);
  assert.deepEqual(b.polish, end.out.polish); assert.ok(b.polish.m > 1 && end.out.after > end.out.before, JSON.stringify(end.out));
  assert.equal(end.out.after, R.value(b)); assert.ok(end.out.s > .6); assert.equal(a.c().stat.pol, 1); assert.equal(a.save.polish, null);
  assert.equal((await a.act('polishEnd', { samples: sweep(401) })).status, 400, 'nothing open any more');
  assert.equal((await a.act('polishStart', { id: blade.id })).status, 400, 'polishing twice');
  assert.equal((await a.act('polishStart', { id: cracked })).status, 400, 'a cracked blade');
  assert.equal((await a.act('polishStart', { id: extra, liq: 'acid' })).status, 400, 'a liquid not learned');
  // the polish travels with the blade through the Auction House
  const buyer = await player('pbuyer'); await buyer.act('createSmith');
  const L = await a.act('ahList', { id: blade.id, start: 1, buyout: 5, dur: 'short' });
  assert.equal(L.status, 200, L.error);
  const got = await buyer.act('ahBuyout', { id: L.out.listing.id });
  assert.equal(got.status, 200, got.error);
  const mine = buyer.c().blades.find((x) => x.type === 'seax' && x.status === 'owned');
  assert.deepEqual(mine.polish, b.polish, 'the buyer’s copy keeps the polish');
});

test('enchanting: needs a polished blade and the mana; a traced rune is set; slots, repeats and bad carvings refused', async () => {
  const a = await player('enid'); await a.act('createSmith');
  const blade = await sound(a);
  const polish = { q: 50, m: 1.35, s: .7, stone: 0, liq: 'spring' };
  let rough, b2, b3;
  await edit(a, (S, c) => { c.recipes.enchant = true; rough = copyBlade(S, c, blade).id; R.bladeById(c, blade.id).polish = polish; b2 = copyBlade(S, c, blade, { polish }).id; b3 = copyBlade(S, c, blade, { polish }).id; });
  assert.equal((await a.act('enchantStart', { id: rough, rune: 'ember' })).status, 400, 'not polished');
  assert.equal((await a.act('enchantStart', { id: blade.id, rune: 'frost' })).status, 400, 'a rune not learned');
  const st = await a.act('enchantStart', { id: blade.id, rune: 'ember', con: 'copper' });
  assert.equal(st.status, 200, st.error); assert.deepEqual(st.out, { win: 5000, tol: 14 }); assert.equal(a.c().mana, 19);
  // carvings that don't add up
  const pts = (n, len) => Array.from({ length: n }, (_, i) => Array.from({ length: len }, (_, j) => [j, i, i * len + j]));
  for (const [strokes, tEnd, why] of [[[[[100.5, 100, 0], [200, 200, 10]]], 100, 'non-integer'], [[[[1001, 100, 0], [200, 200, 10]]], 100, 'x over 1000'],
    [[[[100, 100, 50], [200, 200, 10]]], 100, 't going back'], [pts(13, 2), 1000, '13 strokes'], [pts(1, 401), 1000, '401 points'], [traced('ember'), 200000, 'too long'], ['x', 100, 'not a list']]) {
    assert.equal((await a.act('enchantEnd', { strokes, tEnd })).status, 400, why);
  }
  const end = await a.act('enchantEnd', { strokes: traced('ember'), tEnd: 2500 });
  assert.equal(end.status, 200, end.error);
  assert.ok(['set', 'resonant', 'backlash'].includes(end.out.res), end.out.res);
  assert.ok(end.out.score.q > .99, String(end.out.score.q));
  const b = R.bladeById(a.c(), blade.id);
  assert.equal(b.runes.length, 1); assert.equal(end.out.after, R.value(b));
  if (end.out.res !== 'backlash') { assert.equal(b.runes[0].k, 'ember'); assert.ok(end.out.after > end.out.before); assert.equal(a.c().stat.runes, 1); }
  else assert.equal(b.runes[0].k, 'scar');
  assert.equal((await a.act('enchantStart', { id: blade.id, rune: 'ember' })).status, 400, 'a 2nd rune with the Flint Chisel');
  await edit(a, (S, c) => { c.chisel = 2; c.recipes.frost = true; R.bladeById(c, b2).runes = [{ k: 'ember', q: .9, p: .315 }]; });
  assert.equal((await a.act('enchantStart', { id: b2, rune: 'ember' })).status, 400, 'the same rune twice');
  // a game clock that ran at half speed: the server stretches the points over the time it saw, so the rune is weaker
  assert.equal((await a.act('enchantStart', { id: b2, rune: 'frost' })).status, 200);
  await edit(a, (S) => { S.enchant.t0 -= 7500; });
  const half = traced('frost').map((s) => s.map(([x, y, t]) => [x, y, Math.round(t / 2)]));
  const slow = await a.act('enchantEnd', { strokes: half, tEnd: 1500 });
  assert.equal(slow.status, 200, slow.error); assert.ok(slow.out.score.q < .95, String(slow.out.score.q));
  // abandoning after the first touch: a fizzle, the mana is spent
  const mana = a.c().mana;
  assert.equal((await a.act('enchantStart', { id: b3, rune: 'ember' })).status, 200);
  const fz = await a.act('enchantEnd', { strokes: [], tEnd: 300 });
  assert.equal(fz.status, 200, fz.error); assert.equal(fz.out.res, 'fizzle'); assert.equal(R.bladeById(a.c(), b3).runes, undefined);
  assert.equal(a.c().mana, mana - 1);
  // out of mana
  await edit(a, (S, c) => { c.mana = 0; c.manaTs = Date.now(); });
  assert.equal((await a.act('enchantStart', { id: b3, rune: 'ember' })).status, 400, 'no mana');
});

test('shop shelves: list at a fixed price, cancel, full shelves refused, and a listing sells by the clock', async () => {
  const a = await player('shelly'); await a.act('createSmith');
  const blade = await sound(a);
  const L = await a.act('shelfList', { id: blade.id, k: 'medium' });
  assert.equal(L.status, 200, L.error);
  const b = R.bladeById(a.c(), blade.id);
  assert.equal(b.status, 'shelf'); assert.equal(L.out.price, R.value(b)); assert.equal(b.shelf.price, L.out.price); assert.equal(L.out.until - b.shelf.at, 3600e3);
  assert.equal((await a.act('sell', { ids: [blade.id] })).status, 400, 'a blade on a shelf can’t go to the scrap merchant');
  const c1 = await a.act('shelfCancel', { id: blade.id });
  assert.equal(c1.status, 200, c1.error); assert.equal(R.bladeById(a.c(), blade.id).status, 'owned');
  let ids;
  await edit(a, (S, c) => { ids = [1, 2, 3].map(() => copyBlade(S, c, blade).id); });
  for (const id of [blade.id, ids[0], ids[1]]) assert.equal((await a.act('shelfList', { id, k: 'long' })).status, 200);
  const full = await a.act('shelfList', { id: ids[2], k: 'short' });
  assert.equal(full.status, 400); assert.match(full.error, /shelves are full/);
  // the listing's time is up: the next action pays for it
  await edit(a, (S, c) => { R.bladeById(c, blade.id).shelf.until = Date.now() - 1000; });
  const coin = a.c().coin, price = R.bladeById(a.c(), blade.id).shelf.price;
  const next = await a.act('buy', { m: 'grit', n: 1 });
  assert.equal(next.status, 200, next.error);
  assert.equal(R.bladeById(a.c(), blade.id).status, 'sold');
  assert.ok(a.c().coin >= coin + price - R.PRICES.grit, 'paid the listed price');
  assert.ok(next.notes.some((n) => /Your shop sold/.test(n.text)));
  assert.equal(R.bladeById(a.c(), ids[0]).status, 'shelf', 'the others are still on their shelves');
  assert.equal(a.c().grit, 1);
});

test('the Workshop: unlock buys in order and refuses what isn’t open yet', async () => {
  const a = await player('wendy'); await a.act('createSmith');
  assert.equal((await a.act('unlock', { k: 'anvil2' })).status, 400, 'the Steel Anvil before the Iron Anvil');
  await edit(a, (S, c) => { c.coin = 5000; c.iron = 100; });
  const r = await a.act('unlock', { k: 'anvil1' });
  assert.equal(r.status, 200, r.error); assert.equal(r.out.n, 'Iron Anvil'); assert.equal(a.c().anvil, 1); assert.equal(a.c().coin, 5000 - 80);
  const p = await a.act('unlock', { k: 'polish' });
  assert.equal(p.status, 400); assert.match(p.error, /Medium blade pattern/);
  assert.equal((await a.act('unlock', { k: 'M' })).status, 200);
  const p2 = await a.act('unlock', { k: 'polish' });
  assert.equal(p2.status, 400); assert.match(p2.error, /forge 20 blades/);
  assert.equal((await a.act('anvil')).status, 400, 'the old anvil action is gone');
});
