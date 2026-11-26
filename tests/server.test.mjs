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
  assert.ok(r.notes.some((n) => /first find/.test(n.text)), 'armory reward note');
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
  // selling a blade you don't have, buying with coin you don't have, a pattern you can't afford
  assert.equal((await a.act('sell', { ids: [999] })).status, 400);
  assert.equal((await a.act('buy', { m: 'damascus', n: 1000 })).status, 400);
  assert.equal((await a.act('learn', { k: 'X' })).status, 400);
  assert.equal((await a.act('forgeStart', { type: 'zwei' })).status, 400, 'massive pattern not known');
  assert.equal((await a.act('forgeStart', { type: 'katana' })).status, 400, 'another class');
  assert.equal((await a.act('nonsense')).status, 400);
  assert.equal(a.c().coin, 80, 'nothing changed');
});

test('selling, buying and eating follow the rules', async () => {
  const a = await player('carol'); await a.act('createSmith');
  const f = await forge(a, 'seax'); const b = f.out.blade;
  const coin = a.c().coin, price = R.value(b, a.c().demand[b.type]);
  const s = await a.act('sell', { ids: [b.id] });
  assert.equal(s.status, 200, s.error);
  assert.ok(Math.abs(s.out.coin - price) <= 1);
  assert.ok(a.c().coin >= coin + s.out.coin, 'coin paid (plus any getting-started reward)');
  assert.equal(R.bladeById(a.c(), b.id).status, 'sold');
  assert.equal((await a.act('sell', { ids: [b.id] })).status, 400, 'cannot sell twice');
  const iron = a.c().iron; assert.equal((await a.act('buy', { m: 'iron', n: 3 })).status, 200); assert.equal(a.c().iron, iron + 3);
  assert.equal((await a.act('eat', { k: 'feast' })).status, 200, '9 + 12 energy fits');
  assert.equal(a.c().fuel, 21);
  assert.equal((await a.act('eat', { k: 'feast' })).status, 400, 'too full: 21 + 12 is over 30');
});

test('auctions: deposit, bids need real coin, outbid refunds by mail, buyout hands the blade over', async () => {
  const s = await player('seller'), b1 = await player('bidder1'), b2 = await player('bidder2');
  for (const p of [s, b1, b2]) await p.act('createSmith');
  const blade = (await forge(s, 'seax')).out.blade, blade2 = (await forge(s, 'seax')).out.blade;
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
  assert.equal(b1.c().coin, 80 - 60 + 20, 'paid 60, plus the Armory reward for a first seax');
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
  const ba = (await forge(a, 'seax')).out.blade, bd = (await forge(d, 'seax')).out.blade;
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
