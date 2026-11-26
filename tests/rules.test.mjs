// Tests of the shared game rules (www/js/rules.js), no server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../www/js/rules.js';
const R = globalThis.AMR;
const env = (now, rng = Math.random) => ({ now, rng, tz: 0, online: true, user: { username: 'unit' } });
const T0 = 1.8e12;
// a fixed "random" sequence, so tests come out the same every run
const seq = (seed = 1) => { let n = seed; return () => ((n = (n * 9301 + 49297) % 233280) / 233280); };
// a fresh account with one smith
function smith(now = T0) { const S = R.upgradeSave(null, now); R.runAction(S, 'createSmith', {}, env(now, seq())); return S; }
// a plain blade: a Fine Iron Seax, 100 cm, grade 72 (forge worth 6 x 1 x 2.72 = 16.32)
const seax = (id, o = {}) => ({ id, type: 'seax', rarity: 1, variant: 0, len: 100, si: 2, shine: '', moon: false, grade: 72, cracked: false, anvil: 0, forger: 'unit', status: 'owned', t: T0, ...o });
const act = (S, name, args, now = T0 + 1000) => R.runAction(S, name, args, env(now, null));
const refuses = (fn, re) => assert.throws(fn, (e) => e.rule && (!re || re.test(e.message)), String(re || 'a RuleError'));
// the rune's guide traced exactly, as strokes with t rising 10 ms per point
const traced = (rune) => { let t = 0; return R.RUNES[rune].s.map((l) => l.map(([x, y]) => [x, y, t += 10])); };

// ---------------------------------------------------------------------------------------------- the save
test('upgrading a save twice changes nothing the second time', () => {
  const S = smith(1e12);
  const once = structuredClone(S); R.upgradeSave(S, 2e12);
  assert.deepEqual(R.diff(once, S), []);
});

test('an old save loses the class system and merchant demand, and gains the new fields', () => {
  const S = { v: 2, slots: [{ cid: 'sOld', name: 'Old', cls: 'shadow', classes: ['war', 'shadow'], selBy: {}, freeWar: 1, demand: { seax: .8 }, demandTs: 5,
    coin: 50, iron: 1, coal: 1, fuel: 3, damascus: 0, dust: 0, shards: 0, fuelTs: 1, anvil: 1, hammer: 'worn', hammers: {}, recipes: {}, commissions: [], forged: 3,
    blades: [seax(1), seax(2, { status: 'shelf' })] }, null, null, null], active: 0, serial: 2 };
  R.upgradeSave(S, T0);
  const c = S.slots[0];
  for (const k of ['cls', 'classes', 'selBy', 'freeWar', 'demand', 'demandTs']) assert.equal(c[k], undefined, k);
  assert.equal(S.v, 3); assert.equal(c.mana, R.MANA_MAX); assert.equal(c.shelves, R.SHELF_START); assert.equal(c.stone, 0); assert.equal(c.chisel, 0);
  assert.deepEqual(c.stat, R.STAT0); assert.equal(c.grit, 0);
  assert.equal(c.blades[1].status, 'owned', 'a shelf blade without a listing goes back on the rack');
  const once = structuredClone(S); R.upgradeSave(S, T0 + 5000);
  assert.deepEqual(R.diff(once, S), [], 'and again changes nothing');
});

test('a new smith knows War Light blades, oil and nothing of polishing or enchanting', () => {
  const c = smith().slots[0];
  assert.equal(c.cls, undefined); assert.equal(c.classes, undefined);
  assert.ok(R.forgeable(c, 'seax') && !R.forgeable(c, 'katana'));
  assert.ok(R.knows(c, 'war') && R.knows(c, 'oil') && R.knows(c, 'L'));
  for (const k of ['spring', 'copper', 'ember', 'polish', 'enchant', 'shadow']) assert.ok(!R.knows(c, k), k);
  c.recipes.polish = true; assert.ok(R.knows(c, 'spring'));
  c.recipes.enchant = true; assert.ok(R.knows(c, 'copper') && R.knows(c, 'ember'));
  c.recipes.shadow = true; assert.ok(R.forgeable(c, 'katana'));
  assert.equal(R.hallCtx({ slots: [c], active: 0 }).classes, 2, 'styles known');
});

test('tidying a big save keeps Armory progress, records and blades on the rack', () => {
  const rng = seq();
  const S = R.upgradeSave(null, 1e12); R.runAction(S, 'createSmith', {}, env(1e12, rng)); const c = S.slots[0];
  for (let i = 0; i < 400; i++) { const b = R.makeBlade({ S, c, rng, now: 1e12, tz: 0 }, R.TK[i % 100], 0, 50 + (i % 50), false); b.status = i % 3 ? 'sold' : 'salvaged'; c.blades.push(b); }
  c.blades[5].status = 'owned'; c.blades[7].status = 'shelf'; c.blades[7].shelf = { k: 'long', at: 1e12, until: 2e12, price: 10 };
  const before = R.armoryProgress(S), longest = Math.max(...c.blades.filter(R.exists).map((b) => b.len));
  R.compact(S);
  assert.ok(c.blades.length < 200, 'smaller: ' + c.blades.length);
  assert.deepEqual(R.armoryProgress(S), before);
  assert.ok(c.blades.some((b) => b.len === longest), 'the longest blade is kept');
  assert.ok(c.blades.some((b) => b.id === 6 && b.status === 'owned'), 'blades on the rack are kept');
  assert.ok(c.blades.some((b) => b.id === 8 && b.status === 'shelf'), 'blades on a shelf are kept');
});

test('a patch turns the old save into the new one exactly', () => {
  const S = smith(1e12);
  const old = structuredClone(S); R.runAction(S, 'buy', { m: 'iron', n: 2 }, env(1e12 + 1000, null));
  assert.deepEqual(R.applyPatch(structuredClone(old), R.diff(old, S)), S);
});

// ---------------------------------------------------------------------------------------------- worth and selling
test('worth is forge worth x polish x enchant, and runes count strongest first', () => {
  const b = seax(1);
  assert.ok(Math.abs(R.forgeWorth(b) - 16.32) < 1e-9);
  assert.equal(R.value(b), 16); assert.equal(R.worth(b), 16);
  b.polish = { q: 70, m: 1.5, s: .8, stone: 0, liq: 'spring' };
  b.runes = [{ k: 'ember', q: 1, p: .35 }, { k: 'frost', q: 1, p: .55 }];
  assert.ok(Math.abs(R.enchantMult(b) - (1 + .55 + .35 * .5)) < 1e-9, 'the stronger Frost counts fully');
  assert.equal(R.value(b), Math.round(16.32 * 1.5 * 1.725));   // 42
  assert.equal(R.value(seax(2, { cracked: true })), 1);
  assert.equal(R.enchantMult(seax(3)), 1); assert.equal(R.polishMult(seax(3)), 1);
});

test('the scrap merchant pays 40% of worth at once', () => {
  const S = smith(), c = S.slots[0], b = seax(++S.serial, { forger: c.name, polish: { q: 50, m: 1.35, s: .7, stone: 0, liq: 'spring' } }); c.blades.push(b);
  const want = Math.round(R.value(b) * .4), coin = c.coin;
  assert.equal(R.scrapPrice(b), want);
  const ctx = act(S, 'sell', { ids: [b.id] });
  assert.deepEqual(ctx.out, { coin: want, n: 1 });
  assert.ok(c.coin >= coin + want); assert.equal(b.status, 'sold');
  refuses(() => act(S, 'sell', { ids: [b.id] }));
});

test('salvage gives back grit for a polish and star-dust for each rune (not for a scar)', () => {
  const S = smith(), c = S.slots[0];
  const plain = seax(++S.serial), done = seax(++S.serial, { polish: { q: 50, m: 1.35, s: .7, stone: 0, liq: 'spring' }, runes: [{ k: 'ember', q: 1, p: .35 }, { k: 'scar', q: 0, p: 0 }] });
  const big = { ...seax(++S.serial), type: 'zwei', polish: { q: 10, m: 1.03, s: .2, stone: 0, liq: 'spring' } };
  assert.equal(R.salvYield(plain).grit, undefined); assert.equal(R.salvYield(plain).dust, undefined);
  assert.equal(R.salvYield(done).grit, 1); assert.equal(R.salvYield(done).dust, 1);
  assert.equal(R.salvYield(big).grit, 2, 'a Massive blade gives 2 grit');
  c.blades.push(plain, done); const grit = c.grit, dust = c.dust;
  const ctx = act(S, 'salvage', { ids: [done.id] });
  assert.equal(ctx.out.n, 1); assert.equal(c.grit, grit + 1); assert.equal(c.dust, dust + 1); assert.equal(done.status, 'salvaged');
});

test('shop shelves: the price is fixed when listed and pays exactly once, at the time, not before', () => {
  const S = smith(), c = S.slots[0], b = seax(++S.serial, { forger: c.name }); c.blades.push(b);
  const ctx = act(S, 'shelfList', { id: b.id, k: 'medium' });
  assert.equal(ctx.out.price, R.value(b)); assert.equal(ctx.out.until, T0 + 1000 + 3600e3);
  assert.equal(b.status, 'shelf'); assert.equal(R.shelfCount(c), 1);
  const coin = c.coin;
  assert.deepEqual(R.settleShop(c, b.shelf.until - 1), []); assert.equal(c.coin, coin, 'not before');
  const sold = R.settleShop(c, b.shelf.until);
  assert.equal(sold.length, 1); assert.equal(c.coin, coin + b.shelf.price); assert.equal(b.status, 'sold'); assert.equal(b.su, b.shelf.until);
  assert.deepEqual(R.settleShop(c, b.shelf.until + 1e6), []); assert.equal(c.coin, coin + b.shelf.price, 'only once');
  // through an action: beginAction settles it and says so
  const b2 = seax(++S.serial, { forger: c.name }); c.blades.push(b2);
  act(S, 'shelfList', { id: b2.id, k: 'short' }, T0 + 5000);
  const coin2 = c.coin, later = act(S, 'buy', { m: 'iron', n: 1 }, T0 + 5000 + 10 * 60e3 + 1);
  assert.equal(b2.status, 'sold'); assert.ok(c.coin >= coin2 + b2.shelf.price - R.PRICES.iron);
  assert.ok(later.notes.some((n) => /Your shop sold/.test(n.text)));
});

test('shelf rules: Long pays more, renown adds 1% a level, cancel and full shelves', () => {
  const S = smith(), c = S.slots[0], b = seax(1);
  assert.equal(R.shelfPrice(c, b, 'short'), Math.round(16.32 * .8)); assert.equal(R.shelfPrice(c, b, 'long'), Math.round(16.32 * 1.25));
  assert.equal(R.shelfPrice({ renown: 10 }, b, 'medium'), Math.round(16.32 * 1.1));
  assert.equal(R.renownCost(c), 10000); assert.equal(R.renownCost({ renown: 2 }), 30000);
  const ids = [1, 2, 3, 4].map(() => { const x = seax(++S.serial, { forger: c.name }); c.blades.push(x); return x.id; });
  refuses(() => act(S, 'shelfList', { id: ids[0], k: 'forever' }), /Short, Medium or Long/);
  for (const id of ids.slice(0, 3)) act(S, 'shelfList', { id, k: 'long' });
  refuses(() => act(S, 'shelfList', { id: ids[3], k: 'long' }), /All 3 shelves are full/);
  act(S, 'shelfCancel', { id: ids[0] });
  assert.equal(R.bladeById(c, ids[0]).status, 'owned'); assert.equal(R.bladeById(c, ids[0]).shelf, undefined);
  act(S, 'shelfList', { id: ids[3], k: 'long' });
  refuses(() => act(S, 'shelfCancel', { id: ids[0] }), /isn’t on a shelf/);
  refuses(() => act(S, 'renown', {}), /8 shelves/);
});

test('test odds make shelf listings 20x shorter', () => {
  const S = smith(), c = S.slots[0], b = seax(++S.serial, { forger: c.name }); c.blades.push(b);
  const ctx = R.runAction(S, 'shelfList', { id: b.id, k: 'short' }, { ...env(T0 + 1000, null), test: true });
  assert.equal(ctx.out.until, T0 + 1000 + 30e3);
});

// ---------------------------------------------------------------------------------------------- mana
test('mana refills +1 every 2 minutes up to 20, and not above 20 after a draught', () => {
  const c = { mana: 10, manaTs: T0 };
  R.tickMana(c, T0 + 119e3); assert.equal(c.mana, 10);
  R.tickMana(c, T0 + 120e3); assert.equal(c.mana, 11);
  R.tickMana(c, T0 + 5 * 120e3 + 30e3); assert.equal(c.mana, 15); assert.equal(c.manaTs, T0 + 5 * 120e3);
  R.tickMana(c, T0 + 1e9); assert.equal(c.mana, 20);
  c.mana = 30; R.tickMana(c, T0 + 2e9); assert.equal(c.mana, 30, 'a draught’s extra mana stays, but nothing is added');
  const S = smith(), s = S.slots[0]; s.coin = 1000;
  const d = act(S, 'drink', {});
  assert.deepEqual(d.out, { mana: 5, p: 20 }); assert.equal(s.mana, 25);
  assert.equal(R.draughtPrice(s, R.localDay(T0 + 1000, 0)), 22, '+10% for the second one today');
  act(S, 'drink', {}); act(S, 'drink', {}); act(S, 'drink', {});
  assert.equal(s.mana, 40);
  refuses(() => act(S, 'drink', {}), /as full as a draught/);
});

// ---------------------------------------------------------------------------------------------- the Workshop
test('unlock: bought in order, after and requirements refused with the right message, cost paid, owned afterwards', () => {
  const S = smith(), c = S.slots[0]; c.coin = 1e6; c.iron = 500; c.damascus = 500; c.shards = 100;
  refuses(() => act(S, 'unlock', { k: 'nonsense' }), /no such thing/);
  refuses(() => act(S, 'unlock', { k: 'anvil2' }), /First get the Iron Anvil/);
  const coin = c.coin, iron = c.iron;
  assert.deepEqual(act(S, 'unlock', { k: 'anvil1' }).out, { n: 'Iron Anvil' });
  assert.equal(c.anvil, 1); assert.equal(c.coin, coin - 80); assert.equal(c.iron, iron - 15); assert.ok(R.owns(c, 'anvil1'));
  refuses(() => act(S, 'unlock', { k: 'anvil1' }), /already have/);
  // the polishing bench needs the Medium pattern and 20 forges
  refuses(() => act(S, 'unlock', { k: 'polish' }), /First get the Medium blade pattern/);
  act(S, 'unlock', { k: 'M' }); assert.ok(R.knows(c, 'M'));
  refuses(() => act(S, 'unlock', { k: 'polish' }), /First: forge 20 blades\./);
  c.forged = 20; act(S, 'unlock', { k: 'polish' }); assert.ok(R.owns(c, 'polish') && R.knows(c, 'spring'));
  // stones in order: the Waterstone before the Whetstone is refused
  refuses(() => act(S, 'unlock', { k: 'stone2' }), /First get the Whetstone/);
  act(S, 'unlock', { k: 'stone1' }); act(S, 'unlock', { k: 'stone2' }); assert.equal(c.stone, 2);
  refuses(() => act(S, 'unlock', { k: 'acid' }), /First: polish 15 blades/);
  c.stat.pgood = 15; act(S, 'unlock', { k: 'acid' }); assert.ok(R.knows(c, 'acid'));
  // styles need Armory finds
  refuses(() => act(S, 'unlock', { k: 'shadow' }), /find 10 blade types/);
  // shelves 4..8, then renown
  for (const k of ['shelf4', 'shelf5', 'shelf6', 'shelf7', 'shelf8']) act(S, 'unlock', { k });
  assert.equal(c.shelves, 8);
  const r = act(S, 'renown', {}); assert.deepEqual(r.out, { level: 1, cost: 10000 }); assert.equal(R.renownCost(c), 20000);
  // poor smith
  const P = smith(), p = P.slots[0]; refuses(() => act(P, 'unlock', { k: 'M' }), /That costs 150c \+ 10 Iron/);
});

test('every unlock key is different from every built-in key, and tierPrev finds the step below', () => {
  assert.equal(new Set(R.UNLOCK_KEYS).size, R.UNLOCK_KEYS.length);
  for (const k of ['L', 'oil', 'war', 'spring', 'copper', 'ember']) assert.ok(!R.UNLOCKS[k], k);
  assert.equal(R.tierPrev('stone2').n, 'Whetstone'); assert.equal(R.tierPrev('stone1'), null); assert.equal(R.tierPrev('M'), null);
  assert.equal(R.tierPrev('shelf4'), null, 'the first shelf slot you buy has no step below');
});

// ---------------------------------------------------------------------------------------------- polishing
const sweep = (n, step) => { const out = []; let x = 50, d = 1; for (let i = 0; i < n; i++) { out.push(x); x += d * step; if (x >= 950) { x = 950; d = -1; } if (x <= 50) { x = 50; d = 1; } } return out; };

test('polishScore is the same every time, and steady rubbing beats doing nothing', () => {
  const s = sweep(401, 35);
  assert.deepEqual(R.polishScore(42, s, 'spring'), R.polishScore(42, s, 'spring'));
  const good = R.polishScore(42, s, 'spring');
  assert.ok(good.s > .6 && good.finish === 1, JSON.stringify(good));
  assert.equal(R.polishScore(42, [], 'spring').s, 0);
  assert.equal(R.polishScore(42, Array(401).fill(-1), 'spring').s, 0, 'never touching the blade');
  // the live state the browser keeps gives the same answer
  const st = R.polishInit(42), fx = R.polishFx('spring');
  for (let n = 2; n <= s.length; n++) R.polishTick(st, n >= 3 ? s[n - 3] : -1, s[n - 2], s[n - 1], fx);
  assert.deepEqual(R.polishResult(st), good);
  assert.equal(R.polishStrip(49), -1); assert.equal(R.polishStrip(50), 0); assert.equal(R.polishStrip(949), 23); assert.equal(R.polishStrip(950), -1);
});

test('a stone jumping from end to end scratches the finish to nothing', () => {
  const jump = Array.from({ length: 401 }, (_, i) => (i % 2 ? 1000 : 0));
  const r = R.polishScore(7, jump, 'spring');
  assert.equal(r.finish, 0); assert.equal(r.s, 0);
});

test('rollPolish: stable with a fixed rng; a stain is x0.8, a Mirror x2.5', () => {
  assert.deepEqual(R.rollPolish(.8, 0, 'spring', seq(3)), R.rollPolish(.8, 0, 'spring', seq(3)));
  const n = R.rollPolish(.8, 0, 'spring', () => .5);
  assert.deepEqual(n, { q: 48, m: Math.round((1 + Math.pow(.48, 1.5)) * 100) / 100 });
  assert.deepEqual(R.rollPolish(0, 0, 'acid', () => 0), { q: 0, m: .8, stain: 1 });
  assert.deepEqual(R.rollPolish(1, 4, 'spring', () => 0), { q: 100, m: 2.5, mirror: 1 });
  assert.equal(R.rollPolish(1, 0, 'spring', () => .999).q, 65, 'skill 1 on Sandstone: 50 + 15 at the top of the roll');
  assert.equal(R.rollPolish(1, 4, 'acid', () => .999).q, 99, 'never 100 without a Mirror');
  assert.equal(R.polishName({ q: 100, mirror: 1 }), 'Mirror polish'); assert.equal(R.polishName({ q: 0, stain: 1 }), 'Stained'); assert.equal(R.polishName({ q: 60 }), 'Gleaming polish');
});

test('polishStart takes the grit and keeps a seed both sides agree on; refusals', () => {
  const S = smith(), c = S.slots[0], b = seax(++S.serial, { forger: c.name }); c.blades.push(b);
  refuses(() => act(S, 'polishStart', { id: b.id }), /polishing bench/);
  c.recipes.polish = true;
  refuses(() => act(S, 'polishStart', { id: b.id }), /need 1 grit/);
  c.grit = 3;
  refuses(() => act(S, 'polishStart', { id: b.id, liq: 'acid' }), /Learn that liquid/);
  const ctx = act(S, 'polishStart', { id: b.id });
  assert.equal(c.grit, 2); assert.equal(ctx.out.seed, R.hash32(`${c.cid}:${b.id}:polish`)); assert.equal(ctx.out.stone, 0); assert.equal(ctx.out.liq, 'spring');
  assert.deepEqual(S.polish, { id: b.id, stone: 0, liq: 'spring', seed: ctx.out.seed, t0: T0 + 1000 });
  refuses(() => R.runAction(S, 'polishEnd', { samples: [] }, env(T0 + 2000, null)), /Only the server/);
  const cr = seax(++S.serial, { cracked: true }); c.blades.push(cr);
  refuses(() => act(S, 'polishStart', { id: cr.id }), /cracked/);
  b.polish = { q: 1, m: 1.01, s: 0, stone: 0, liq: 'spring' };
  refuses(() => act(S, 'polishStart', { id: b.id }), /already been polished/);
});

test('polishEnd scores the samples, rolls the polish and counts it; too fast and bad samples are refused', () => {
  const S = smith(), c = S.slots[0], b = seax(++S.serial, { forger: c.name }); c.blades.push(b);
  c.recipes.polish = true; c.grit = 5;
  act(S, 'polishStart', { id: b.id }, T0);
  const samples = sweep(401, 35), end = (args, now) => R.runAction(S, 'polishEnd', args, env(now, seq(9)));
  refuses(() => end({ samples }, T0 + 1000), /quicker than any stone/);
  for (const bad of [[1.5], [2000], [-2], ['5'], Array(402).fill(100), 'abc', null]) refuses(() => end({ samples: bad }, T0 + 60e3), /doesn’t add up/);
  const ctx = end({ samples }, T0 + 401 * 50);
  const sc = R.polishScore(R.hash32(`${c.cid}:${b.id}:polish`), samples, 'spring');
  assert.equal(ctx.out.s, sc.s); assert.equal(b.polish.s, Math.round(sc.s * 100) / 100);
  assert.ok(b.polish.m > 1 && ctx.out.after > ctx.out.before, JSON.stringify(ctx.out));
  assert.equal(ctx.out.after, R.value(b)); assert.equal(ctx.out.name, R.polishName(b.polish));
  assert.equal(S.polish, null); assert.equal(c.stat.pol, 1); assert.equal(c.stat.pgood, sc.s >= .7 ? 1 : 0);
  assert.deepEqual(ctx.out.xp, { smith: R.polishXp(b) }); assert.equal(c.xp.smith, R.POLISH_XP[1] + (b.polish.mirror ? R.MIRROR_XP : 0), 'a Fine blade');
  refuses(() => end({ samples }, T0 + 60e3), /aren’t polishing/);
});

// ---------------------------------------------------------------------------------------------- enchanting
test('every rune template traced exactly scores 1; an empty carving fizzles; a scribble stays under the fizzle line', () => {
  for (const k of R.RUNE_KEYS) {
    const win = R.runeWindow(k, 'copper'), tEnd = Math.round(win / 2), s = traced(k);
    assert.ok(R.cleanStrokes(s, tEnd), k + ' passes cleanStrokes');
    const sc = R.runeScore(k, s, { tol: R.CHISELS[0].tol, win, tEnd });
    assert.ok(Math.abs(sc.q - 1) < 1e-9, `${k}: ${sc.q}`);
  }
  const empty = R.runeScore('ember', [], { tol: 14, win: 5000, tEnd: 100 });
  assert.equal(empty.q, 0); assert.equal(R.rollRune(empty.q, 'ember', 'copper', 0, () => .5).res, 'fizzle');
  const rng = seq(5), scribble = [Array.from({ length: 300 }, (_, i) => [Math.round(rng() * 1000), Math.round(rng() * 1000), i * 10])];
  for (const k of R.RUNE_KEYS) assert.ok(R.runeScore(k, scribble, { tol: 24, win: 8000, tEnd: 3000 }).q < R.RUNE_FIZZLE, k);
  // a slow carving loses the full-charge bonus
  const slow = R.runeScore('ember', traced('ember'), { tol: 14, win: 5000, tEnd: 5000 });
  assert.ok(Math.abs(slow.q - .85) < 1e-9);
});

test('ink after the mana runs out doesn’t count', () => {
  const win = 5000, late = R.RUNES.ember.s.map((l) => l.map(([x, y], i) => [x, y, win + 1 + i]));
  assert.equal(R.runeScore('ember', late, { tol: 14, win, tEnd: win }).q, 0);
  // the first half in time, the rest after: only about half is done
  const [a, m, b] = R.RUNES.ember.s[0], half = [[[a[0], a[1], 0], [m[0], m[1], 4000], [b[0], b[1], 6000]]];
  const sc = R.runeScore('ember', half, { tol: 14, win, tEnd: win });
  assert.ok(sc.done > .6 && sc.done < .9, String(sc.done)); assert.ok(sc.acc > .99);
});

test('cleanStrokes refuses what a real carving can’t send', () => {
  const ok = [[[100, 100, 0], [200, 200, 10]]];
  assert.ok(R.cleanStrokes(ok, 10)); assert.deepEqual(R.cleanStrokes([], 10), []);
  assert.equal(R.cleanStrokes([[[100.5, 100, 0], [200, 200, 10]]], 10), null, 'non-integer');
  assert.equal(R.cleanStrokes([[[1001, 100, 0], [200, 200, 10]]], 10), null, 'x over 1000');
  assert.equal(R.cleanStrokes([[[100, -1, 0], [200, 200, 10]]], 10), null, 'y below 0');
  assert.equal(R.cleanStrokes([[[100, 100, 10], [200, 200, 5]]], 10), null, 't going back');
  assert.equal(R.cleanStrokes([[[100, 100, 0], [200, 200, 11]]], 10), null, 't after tEnd');
  assert.equal(R.cleanStrokes([[[100, 100, 0]]], 10), null, 'a one-point stroke');
  assert.equal(R.cleanStrokes([[[100, 100, 0, 1], [200, 200, 1]]], 10), null, 'four numbers');
  const strokes = (n, len) => Array.from({ length: n }, (_, i) => Array.from({ length: len }, (_, j) => [j, i, i * len + j]));
  assert.ok(R.cleanStrokes(strokes(12, 2), 1000)); assert.equal(R.cleanStrokes(strokes(13, 2), 1000), null, '13 strokes');
  assert.ok(R.cleanStrokes(strokes(10, 40), 1000), '400 points');
  assert.equal(R.cleanStrokes([strokes(1, 401)[0]], 1000), null, '401 points');
  assert.equal(R.cleanStrokes('x', 10), null);
});

test('rollRune: backlash leaves a scar, a set rune keeps q and power, Resonant is x1.5', () => {
  assert.deepEqual(R.rollRune(.9, 'frost', 'copper', 0, () => 0), { res: 'backlash', rune: { k: 'scar', q: 0, p: 0 } });
  assert.deepEqual(R.rollRune(.9, 'frost', 'silver', 0, () => .5), { res: 'set', rune: { k: 'frost', q: .9, p: Math.round(.55 * .9 * 1.1 * 1000) / 1000 } });
  let i = 0; const r = R.rollRune(1, 'dawn', 'copper', 3, () => [.5, 0][i++]);
  assert.deepEqual(r, { res: 'resonant', rune: { k: 'dawn', q: 1, p: 3.15, r: 1 } });
  assert.equal(R.rollRune(.24, 'dawn', 'copper', 3, () => .5).res, 'fizzle');
});

test('enchanting through the actions: mana at the start, a rune or scar at the end, slots and repeats refused', () => {
  const S = smith(), c = S.slots[0], b = seax(++S.serial, { forger: c.name }); c.blades.push(b);
  refuses(() => act(S, 'enchantStart', { id: b.id, rune: 'ember' }), /enchanter’s table/);
  c.recipes.enchant = true;
  refuses(() => act(S, 'enchantStart', { id: b.id, rune: 'ember' }), /Polish the blade/);
  b.polish = { q: 50, m: 1.35, s: .7, stone: 0, liq: 'spring' };
  refuses(() => act(S, 'enchantStart', { id: b.id, rune: 'frost' }), /Learn that rune/);
  refuses(() => act(S, 'enchantStart', { id: b.id, rune: 'ember', con: 'silver' }), /conduit/);
  const st = act(S, 'enchantStart', { id: b.id, rune: 'ember' }, T0);
  assert.deepEqual(st.out, { win: 5000, tol: 14 }); assert.equal(c.mana, 19);
  const end = R.runAction(S, 'enchantEnd', { strokes: traced('ember'), tEnd: 2500 }, env(T0 + 2600, () => .5));
  assert.equal(end.out.res, 'set'); assert.deepEqual(end.out.rune, { k: 'ember', q: 1, p: .35 });
  assert.deepEqual(end.out.xp, { ench: Math.round(R.RUNES.ember.xp * R.ENCH_RAR_XP[1]) }); assert.equal(c.xp.ench, end.out.xp.ench); assert.equal(c.xp.smith, 0);
  assert.equal(end.out.after, R.value(b)); assert.ok(end.out.after > end.out.before);
  assert.deepEqual(c.stat, { ...R.STAT0, runes: 1, r70: 1, r80: 1, r90: 1 }); assert.equal(S.enchant, null);
  refuses(() => act(S, 'enchantStart', { id: b.id, rune: 'ember' }), /can’t fit another rune/);
  c.chisel = 2;
  refuses(() => act(S, 'enchantStart', { id: b.id, rune: 'ember' }), /already on this blade/);
  c.mana = 0;
  c.recipes.frost = true; refuses(() => act(S, 'enchantStart', { id: b.id, rune: 'frost' }), /takes 2 mana/);
  // a game clock that ran at half speed: the server stretches the points over the real time and the rune is weaker
  c.mana = 20; act(S, 'enchantStart', { id: b.id, rune: 'frost' }, T0 + 10000);
  const half = traced('frost').map((s) => s.map(([x, y, t]) => [x, y, Math.round(t / 2)]));
  const slow = R.runAction(S, 'enchantEnd', { strokes: half, tEnd: 1500 }, env(T0 + 10000 + 3000 + 4500, () => .5));
  assert.ok(slow.out.score.q < .95 && slow.out.score.q > .25, String(slow.out.score.q));
  // a fizzle: nothing added, the mana is spent
  const b2 = seax(++S.serial, { polish: b.polish }); c.blades.push(b2);
  act(S, 'enchantStart', { id: b2.id, rune: 'ember' }, T0 + 20000);
  const fz = R.runAction(S, 'enchantEnd', { strokes: [], tEnd: 100 }, env(T0 + 20100, () => .5));
  assert.equal(fz.out.res, 'fizzle'); assert.equal(fz.out.rune, null); assert.equal(b2.runes, undefined); assert.equal(fz.out.xp, undefined, 'no XP for a fizzle');
  refuses(() => R.runAction(S, 'enchantEnd', { strokes: [], tEnd: 100 }, env(T0 + 20200, () => .5)), /gone dark/);
});

// ---------------------------------------------------------------------------------------------- commissions
test('commissions ask for polish and runes once those are open, and qualifies checks them', () => {
  const c = smith().slots[0];
  for (let i = 0; i < 50; i++) { const q = R.genComm(c, seq(i + 1), T0); assert.ok(R.forgeable(c, q.type)); assert.equal(q.minP, 0); assert.equal(q.rune, ''); assert.equal(q.imp, undefined); }
  c.recipes.polish = true; c.recipes.enchant = true;
  const qs = Array.from({ length: 50 }, (_, i) => R.genComm(c, seq(i + 1), T0));
  assert.ok(qs.every((q) => q.minP >= 40), 'with enchanting, every order wants a polish');
  assert.ok(qs.some((q) => q.rune === 'ember'));
  const q = { type: 'seax', minR: 0, minS: 0, minG: 0, minP: 60, rune: 'ember' }, b = seax(1);
  assert.ok(!R.qualifies(b, q));
  b.polish = { q: 60, m: 1.46, s: .9, stone: 0, liq: 'spring' }; assert.ok(!R.qualifies(b, q));
  b.runes = [{ k: 'ember', q: .4, p: .14 }]; assert.ok(!R.qualifies(b, q), 'too weak');
  b.runes = [{ k: 'ember', q: .5, p: .175 }]; assert.ok(R.qualifies(b, q));
});

// ---------------------------------------------------------------------------------------------- levels
test('levels: the XP table, the caps, and where a total puts you', () => {
  assert.deepEqual(R.levelOf(0), { lv: 1, cur: 0, next: 80, max: R.SMITH_MAX_LV });
  assert.equal(R.levelOf(79).lv, 1); assert.deepEqual(R.levelOf(80), { lv: 2, cur: 0, next: R.XP_LEVELS[3] - 80, max: 21 });
  assert.equal(R.levelOf(R.XP_LEVELS[10] + 5).lv, 10); assert.equal(R.levelOf(R.XP_LEVELS[10] + 5).cur, 5);
  assert.deepEqual(R.levelOf(1e9), { lv: 21, cur: 1e9 - R.XP_LEVELS[21], next: 0, max: 21 });
  assert.equal(R.levelOf(1e9, R.ENCH_MAX_LV).lv, 16);
  for (let n = 2; n < R.XP_LEVELS.length; n++) assert.ok(R.XP_LEVELS[n] - R.XP_LEVELS[n - 1] > (R.XP_LEVELS[n - 1] - R.XP_LEVELS[n - 2] || 0), 'each level takes longer than the one before');
  const top = { xp: { smith: 1e9, ench: 1e9 } };
  assert.equal(R.fuelMax(top), 30); assert.equal(R.manaMax(top), 50); assert.equal(R.fuelCap(top), 50); assert.equal(R.manaCap(top), 70);
  const fresh = smith().slots[0];
  assert.deepEqual(fresh.xp, { smith: 0, ench: 0 });
  assert.equal(R.fuelMax(fresh), R.FUEL_MAX); assert.equal(R.manaMax(fresh), R.MANA_MAX); assert.equal(R.fuelCap(fresh), R.ENERGY_CAP); assert.equal(R.manaCap(fresh), R.MANA_CAP);
  assert.equal(R.forgeXp(seax(1, { rarity: 4 })), 90); assert.equal(R.forgeXp(seax(1, { cracked: true })), R.CRACK_XP);
  assert.equal(R.polishXp(seax(1, { rarity: 0, polish: { q: 100, m: 2.5, mirror: 1 } })), R.POLISH_XP[0] + R.MIRROR_XP);
  assert.equal(R.runeXp(seax(1, { rarity: 4 }), 'dawn', true), Math.round(12 * 3 * 1.5));
});

test('every forge (hand and quick) gives Smithing XP by rarity', () => {
  const S = smith(), c = S.slots[0]; c.fuel = 30; c.iron = 50; c.coal = 50;
  const q = R.runAction(S, 'quickForge', { type: 'seax' }, env(T0 + 1000, seq(4)));
  assert.deepEqual(q.out.xp, { smith: R.forgeXp(q.out.blade) }); assert.equal(c.xp.smith, R.forgeXp(q.out.blade));
  act(S, 'forgeStart', { type: 'seax' }, T0 + 2000);
  const f = R.runAction(S, 'forgeEnd', { q: 'oil', strikes: [[0, .7], [0, .7], [0, .7], [0, .7]] }, env(T0 + 4000, seq(5)));
  assert.equal(f.out.xp.smith, R.forgeXp(f.out.blade)); assert.equal(c.xp.smith, R.forgeXp(q.out.blade) + R.forgeXp(f.out.blade));
});

test('a level-up says so, raises max energy and mana, and the clock refills to the new max', () => {
  const S = smith(), c = S.slots[0], ctx = { c, notes: [], out: {} };
  c.xp.smith = 79; c.fuel = 10; c.fuelTs = T0;
  R.gainXp(ctx, 'smith', 5);
  assert.equal(R.smithLevel(c).lv, 2); assert.equal(R.fuelMax(c), 11);
  assert.ok(ctx.notes.some((n) => /Smithing level 2!.*Max energy 11\./.test(n.text)), JSON.stringify(ctx.notes));
  assert.deepEqual(ctx.out.xp, { smith: 5 });
  R.tickFuel(c, T0 + R.FUEL_MS); assert.equal(c.fuel, 11, 'refills past the old 10');
  R.tickFuel(c, T0 + 1e9); assert.equal(c.fuel, 11, 'but not past the new max');
  c.xp.ench = 0; c.mana = 20; c.manaTs = T0;
  R.gainXp(ctx, 'ench', R.XP_LEVELS[3]);
  assert.equal(R.enchLevel(c).lv, 3); assert.equal(R.manaMax(c), 24);
  assert.ok(ctx.notes.some((n) => /Enchanting level 3!.*Max mana 24\./.test(n.text)));
  R.tickMana(c, T0 + 1e9); assert.equal(c.mana, 24);
  // meals and draughts can go 20 above the new max
  c.coin = 1000; c.fuel = 20;
  const lv1 = smith(), l = lv1.slots[0]; l.coin = 1000; l.fuel = 20;
  refuses(() => act(lv1, 'eat', { k: 'feast' }), /too full/);
  c.xp.smith = R.XP_LEVELS[3]; c.fuelTs = T0 + 1000;
  act(S, 'eat', { k: 'feast' }); assert.equal(c.fuel, 32, '20 + 12 fits under 12 + 20');
  c.mana = 39; act(S, 'drink', {}); assert.equal(c.mana, 44, 'over the level-1 cap of 40');
});
