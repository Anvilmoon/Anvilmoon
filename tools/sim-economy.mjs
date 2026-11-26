// Anvilmoon shop redesign: economy and pacing simulation. Plain Node, no dependencies.
//
// It plays many imaginary players through the RECONCILED economy in docs/redesign/04-balance.md and prints
// when they unlock each thing (in minutes of play and in days) and how much coin they make and keep.
// The existing tables (blade types, rarity odds, sizes, shine, the forge value formula) come from the real
// www/js/rules.js; everything new (polishing, enchanting, shop shelves, renown...) is in the P table below.
// Keep P and NODES in step with 04-balance.md (and, once built, with rules.js) when either changes.
//
//   node tools/sim-economy.mjs                       typical player (3 x 25 min a day), 300 runs, 30 days
//   node tools/sim-economy.mjs --profile casual      2 x 20 min a day, a little less skilled
//   node tools/sim-economy.mjs --profile keen        4 x 40 min a day, a little more skilled
//   node tools/sim-economy.mjs --runs 100 --days 60 --seed 7
//   node tools/sim-economy.mjs --one                 one player, printing each purchase as it happens
//   node tools/sim-economy.mjs --no-renown           leave out Advertising, the repeatable coin sink (to compare)
//   node tools/sim-economy.mjs --shelf-f 1.2 --shelf-min 10 --shelf-ref 100 --shelf-p 0.4
//                                                    try other shelf numbers (price factor, minutes at worth ref, power)
//
// It is a model, not the game: players are greedy and tidy, skill is a smooth curve, challenges are a flat
// daily amount. Use it to compare numbers against each other, not to predict a real player to the minute.
import '../www/js/rules.js';
const R = globalThis.AMR;

// ------------------------------------------------------------------------------------------- arguments
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ONE = process.argv.includes('--one'), NO_RENOWN = process.argv.includes('--no-renown');
const RUNS = ONE ? 1 : +arg('runs', 300), DAYS = +arg('days', 30), SEED = +arg('seed', 1), PROFILE = arg('profile', 'typical');

const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const PROFILES = {
  // sessions: [start hour, minutes]; skill: added to the average strike score, polish skill and rune strength (0..1)
  casual: { sessions: [[8, 20], [20, 20]], skill: -0.05 },
  typical: { sessions: [[8, 25], [13, 25], [20, 25]], skill: 0 },
  keen: { sessions: [[8, 40], [12, 40], [17, 40], [21, 40]], skill: 0.05 },
};
const PF = PROFILES[PROFILE]; if (!PF) throw new Error('unknown profile ' + PROFILE);
// optional overrides of the shelf numbers (they change R.SHELF, so R.shelfMs uses them too)
if (arg('shelf-f')) R.SHELF.f = +arg('shelf-f');
if (arg('shelf-min')) R.SHELF.ms = +arg('shelf-min') * MIN;
if (arg('shelf-ref')) R.SHELF.ref = +arg('shelf-ref');
if (arg('shelf-p')) R.SHELF.p = +arg('shelf-p');
if (arg('shelf-max')) R.SHELF.max = +arg('shelf-max') * MIN;

// ------------------------------------------------------------------------------------------- RECONCILED NUMBERS (04-balance.md)
const P = {
  start: { coin: 80, iron: 12, coal: 8, fuel: 10 },
  buy: { iron: 4, coal: 3, damascus: 45, dust: 40, grit: 5 },     // market buy prices (grit and star-dust are new)
  fuelMs: 3 * MIN,                                                 // energy: +1 every 3 min up to R.fuelMax (10 + 1 per Smithing level)
  feast: { e: 12, p: 30 }, mealRise: 0.05,                         // the meal the sim buys (as today)
  mana: { ms: 2 * MIN },                                           // ONE mana meter: +1 every 2 min up to R.manaMax (20 + 2 per Enchanting level); draughts to R.manaCap
  draught: { mana: 5, p: 20, rise: 0.10 },                         // mana draught: +5 mana, 20c, +10% for each one bought today
  scrap: 0.40,                                                     // scrap merchant: instant, 40% of worth
  // shop shelves: R.SHELF from rules.js (one price factor, one selling time per blade from its worth: R.shelfMs)
  shelfStart: 3,
  grit: { L: 1, M: 1, H: 2, X: 3 },                                // grit per polish, by weight
  // polishing: q = 50 x skill + stone dice + liquid bonus (0..99), m = 1 + (q/100)^1.5; Mirror q 100 x2.5; stain x0.8
  stones: [{ lo: 0, hi: 15, mirror: 0.005 }, { lo: 5, hi: 22, mirror: 0.01 }, { lo: 10, hi: 28, mirror: 0.02 }, { lo: 15, hi: 34, mirror: 0.03 }, { lo: 20, hi: 40, mirror: 0.05 }],
  liquids: { spring: { bonus: 0, stain: 0, mirror: 1, sk: 1 }, camellia: { bonus: 6, stain: 0.05, mirror: 1, sk: 1.02 }, acid: { bonus: 12, stain: 0.18, mirror: 1.5, sk: 0.95 } },
  mirrorM: 2.5, stainM: 0.8, perfect: 0.95,
  // enchanting: q from the carving (sim: a skill curve), p = v x q x conduit power (x1.5 Resonant); blade x = 1 + p1 + p2/2 + p3 x 0.3
  chisels: [{ slots: 1, res: 0.02, q: 0 }, { slots: 1, res: 0.03, q: 0.04 }, { slots: 2, res: 0.04, q: 0.07 }, { slots: 3, res: 0.06, q: 0.10 }],
  conduits: { copper: { power: 1.0, risk: 0.02, q: 0 }, silver: { power: 1.1, risk: 0.06, q: 0.03 }, stormglass: { power: 1.2, risk: 0.15, q: 0.05 } },
  runes: {   // d = how much harder than Ember it is to carve well (longer line in a short window)
    ember: { v: 0.35, mana: 1, d: 0 }, frost: { v: 0.55, mana: 2, d: 0.02 }, valor: { v: 0.75, mana: 2, d: 0.03 }, storm: { v: 0.95, mana: 3, d: 0.05 },
    fortune: { v: 1.15, mana: 3, d: 0.05 }, ward: { v: 1.40, mana: 4, d: 0.06 }, hearth: { v: 1.70, mana: 4, d: 0.07 }, dawn: { v: 2.10, mana: 5, d: 0.09 },
  },
  slotW: [1, 0.5, 0.3], resonant: 1.5, fizzle: 0.25,
  hammers: { worn: 0, smith: 0.04, master: 0.07 },                 // + average strike score (stand-in for the wider sweet spot)
  quench: { oil: { risk: 0.03, bonus: 0 }, brine: { risk: 0.10, bonus: 6 }, water: { risk: 0.22, bonus: 12 } },
  commission: { base: [15, 40, 100, 280], polishChance: 0.6, runeChance: 0.5, runeK: 1.5 },
  renown: { step: 10000, per: 0.01 },                              // Advertising (save field renown), the repeatable sink: level n costs 10,000 x n coin, each level +1% on shelf sales
  // income the sim does not model in detail: getting-started steps (once), daily and weekly challenges (per day)
  gettingStarted: 220, challengesPerDay: 160,
  // the time each step takes a player, in seconds (incl. heating, reveal, clicking around)
  secs: { L: 25, M: 32, H: 40, X: 48, polish: 25, enchant: 8, rune: 15 },
  overhead: 1.35,
};

// The unlock nodes (= UNLOCKS in rules.js). cost: coin and materials. req(s): extra requirement. Order here = the order the sim buys them in.
const NODES = [];
const node = (id, tree, n, cost, req, apply) => NODES.push({ id, tree, n, cost, req: req || (() => true), apply });
const has = (s, id) => !!s.got[id];
// forge tree
node('anvil1', 'forge', 'Iron Anvil', { coin: 80, iron: 15 }, null, (s) => (s.anvil = 1));
node('M', 'forge', 'Medium pattern', { coin: 150, iron: 10 }, null, (s) => s.wts.push('M'));
node('polish', 'polish', 'POLISHING BENCH (Sandstone + spring water)', { coin: 300 }, (s) => s.forged >= 20 && has(s, 'M'), (s) => (s.polishOn = 1));
node('shelf4', 'shop', 'Shelf slot 4', { coin: 150 }, null, (s) => s.shelves++);
node('hamSmith', 'forge', "Smith's Hammer", { coin: 120, iron: 10, damascus: 1 }, null, (s) => (s.hammer = 'smith'));
node('camellia', 'polish', 'Camellia oil', { coin: 150 }, (s) => s.polishOn, (s) => s.liquids.push('camellia'));
node('stone1', 'polish', 'Whetstone', { coin: 300, damascus: 2 }, (s) => s.polishOn, (s) => (s.stone = 1));
node('H', 'forge', 'Heavy pattern', { coin: 600, damascus: 3 }, (s) => s.comms >= 5, (s) => s.wts.push('H'));
node('brine', 'forge', 'Brine quench', { coin: 100 }, null, (s) => s.quenches.push('brine'));
node('anvil2', 'forge', 'Steel Anvil', { coin: 400, iron: 30, damascus: 4 }, (s) => s.anvil === 1, (s) => (s.anvil = 2));
node('shadow', 'forge', 'Shadow style', { coin: 300 }, (s) => s.found.size >= 10, (s) => s.styles.push('shadow'));
node('shelf5', 'shop', 'Shelf slot 5', { coin: 500 }, (s) => has(s, 'shelf4'), (s) => s.shelves++);
node('enchant', 'enchant', "ENCHANTER'S TABLE (Flint chisel + Copper conduit + Ember)", { coin: 1200, damascus: 5 }, (s) => s.polished >= 40 && s.anvil >= 2, (s) => { s.enchantOn = 1; s.runes.push('ember'); s.conduits.push('copper'); });
node('water', 'forge', 'Water quench', { coin: 400 }, (s) => s.g70 >= 10, (s) => s.quenches.push('water'));
node('frost', 'enchant', 'Frost rune', { coin: 300 }, (s) => s.enchantOn, (s) => s.runes.push('frost'));
node('stone2', 'polish', 'Waterstone', { coin: 1200, damascus: 6 }, (s) => s.stone === 1, (s) => (s.stone = 2));
node('chisel1', 'enchant', 'Iron Chisel', { coin: 1000, iron: 20 }, (s) => s.enchantOn, (s) => (s.chisel = 1));
node('silver', 'enchant', 'Silver conduit', { coin: 1500, damascus: 4 }, (s) => s.enchantOn, (s) => s.conduits.push('silver'));
node('valor', 'enchant', 'Valor rune', { coin: 1500, damascus: 3 }, (s) => s.runesSet >= 10, (s) => s.runes.push('valor'));
node('X', 'forge', 'Massive pattern', { coin: 2000, damascus: 8, shards: 1 }, (s) => s.mw >= 1, (s) => s.wts.push('X'));
node('acid', 'polish', 'Acid wash', { coin: 800 }, (s) => s.polishOn && s.pgood >= 15, (s) => s.liquids.push('acid'));
node('arcane', 'forge', 'Arcane style', { coin: 1200 }, (s) => s.found.size >= 25, (s) => s.styles.push('arcane'));
node('chisel2', 'enchant', 'Steel Chisel (2 runes)', { coin: 4000, damascus: 10, shards: 1 }, (s) => s.chisel === 1, (s) => (s.chisel = 2));
node('shelf6', 'shop', 'Shelf slot 6', { coin: 1500 }, (s) => has(s, 'shelf5'), (s) => s.shelves++);
node('storm', 'enchant', 'Storm rune', { coin: 3000, damascus: 6 }, (s) => s.runesSet >= 25, (s) => s.runes.push('storm'));
node('hamMaster', 'forge', 'Master Hammer', { coin: 900, damascus: 6, shards: 1 }, null, (s) => (s.hammer = 'master'));
node('anvil3', 'forge', 'Damascus Anvil', { coin: 3000, damascus: 12, shards: 2 }, (s) => s.anvil === 2, (s) => (s.anvil = 3));
node('stormglass', 'enchant', 'Stormglass conduit', { coin: 6000, shards: 3 }, (s) => s.r70 >= 10, (s) => s.conduits.push('stormglass'));
node('fortune', 'enchant', 'Fortune rune', { coin: 6000, shards: 3 }, (s) => s.runesSet >= 60, (s) => s.runes.push('fortune'));
node('stone3', 'polish', 'Moonstone', { coin: 6000, damascus: 15, shards: 3 }, (s) => s.stone === 2, (s) => (s.stone = 3));
node('sanct', 'forge', 'Sanctum style', { coin: 4000 }, (s) => s.found.size >= 45, (s) => s.styles.push('sanct'));
node('shelf7', 'shop', 'Shelf slot 7', { coin: 6000 }, (s) => has(s, 'shelf6'), (s) => s.shelves++);
node('ward', 'enchant', 'Ward rune', { coin: 12000, shards: 5 }, (s) => s.runesSet >= 120, (s) => s.runes.push('ward'));
node('anvil4', 'forge', 'Dragonbone Anvil', { coin: 40000, damascus: 40, shards: 10 }, (s) => s.anvil === 3, (s) => (s.anvil = 4));
node('chisel3', 'enchant', 'Starsteel Chisel (3 runes)', { coin: 40000, damascus: 30, shards: 10 }, (s) => s.chisel === 2, (s) => (s.chisel = 3));
node('hearth', 'enchant', 'Hearth rune', { coin: 25000, shards: 8 }, (s) => s.r80 >= 25, (s) => s.runes.push('hearth'));
node('stone4', 'polish', 'Starstone', { coin: 40000, damascus: 30, shards: 10 }, (s) => s.stone === 3, (s) => (s.stone = 4));
node('shelf8', 'shop', 'Shelf slot 8', { coin: 25000 }, (s) => has(s, 'shelf7'), (s) => s.shelves++);
node('dawn', 'enchant', 'Dawn rune', { coin: 60000, shards: 15 }, (s) => s.r90 >= 10, (s) => s.runes.push('dawn'));

// ------------------------------------------------------------------------------------------- the model
const STYLES_OF = { war: R.typesOf('war'), shadow: R.typesOf('shadow'), arcane: R.typesOf('arcane'), sanct: R.typesOf('sanct') };
const WT_ORDER = ['L', 'M', 'H', 'X'];
// the forge's part of the worth (R.value now includes polish and runes, so it can't be used here: they are multiplied in below)
const forgeWorth = (b) => Math.max(1, Math.round(R.forgeWorth(b)));
const enchMult = (b) => { const ps = (b.runes || []).map((r) => r.p).sort((x, y) => y - x); return 1 + ps.reduce((a, p, i) => a + p * P.slotW[i], 0); };
const worth = (b) => (b.cracked ? 1 : Math.max(1, Math.round(forgeWorth(b) * (b.polish ? b.polish.m : 1) * enchMult(b))));
const gauss = (rng) => { let u = 0; for (let i = 0; i < 6; i++) u += rng(); return (u - 3) / Math.sqrt(0.5); };   // ~N(0,1)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const polishMult = (q) => 1 + Math.pow(q / 100, 1.5);

function newState(rng) {
  return { rng, coin: P.start.coin, iron: P.start.iron, coal: P.start.coal, fuel: P.start.fuel, fuelTs: 0, damascus: 0, dust: 0, shards: 0, grit: 0, mana: 0, manaTs: 0,
    anvil: 0, wts: ['L'], styles: ['war'], quenches: ['oil'], hammer: 'worn', stone: 0, liquids: ['spring'], chisel: 0, conduits: [], runes: [], renown: 0,
    polishOn: 0, enchantOn: 0, shelves: P.shelfStart, got: {}, shelf: [], rack: [], orders: [], found: new Set(), arm: {},
    forged: 0, comms: 0, mw: 0, g70: 0, polished: 0, pgood: 0, runesSet: 0, r70: 0, r80: 0, r90: 0, manaVal: 0,
    meals: { d: -1, n: 0 }, draughts: { d: -1, n: 0 }, playMs: 0, now: 0, day: 0, unlock: {}, coinByDay: [],
    inc: { shelf: 0, quick: 0, comm: 0, other: 0 }, n: { shelf: 0, quick: 0, salv: 0, comm: 0 }, shelfMin: 0,
    spend: { supplies: 0, meals: 0, grit: 0, draughts: 0, dust: 0, unlocks: 0, renown: 0 }, sold: [], gs: 0, chD: -1, chN: 0, mirrors: 0, stains: 0, scars: 0, reson: 0,
    xp: { smith: 0, ench: 0 }, lvAt: { smith: {}, ench: {} }, lvByDay: { smith: [], ench: [] } };
}
// levels come straight from rules.js (levelOf, fuelMax, manaMax, the XP tables)
const fmax = (s) => R.fuelMax(s), mmax = (s) => R.manaMax(s), mcap = (s) => R.manaCap(s);
function addXp(s, track, n) {
  const lv0 = (track === 'smith' ? R.smithLevel(s) : R.enchLevel(s)).lv; s.xp[track] += n;
  const lv = (track === 'smith' ? R.smithLevel(s) : R.enchLevel(s)).lv;
  for (let l = lv0 + 1; l <= lv; l++) s.lvAt[track][l] = { min: s.playMs / MIN, day: s.day + 1 };
}

// ---- clocks: energy and mana refill from the clock, shop listings sell at their fixed end time
function tick(s) {
  const fm = fmax(s), mm = mmax(s);
  if (s.fuel >= fm) s.fuelTs = s.now;
  else { const n = Math.floor((s.now - s.fuelTs) / P.fuelMs); if (n > 0) { s.fuel = Math.min(fm, s.fuel + n); s.fuelTs += n * P.fuelMs; } }
  if (s.enchantOn) {
    if (s.mana >= mm) s.manaTs = s.now;
    else { const n = Math.floor((s.now - s.manaTs) / P.mana.ms); if (n > 0) { s.mana = Math.min(mm, s.mana + n); s.manaTs += n * P.mana.ms; if (s.mana >= mm) s.manaTs = s.now; } }
  }
  s.shelf = s.shelf.filter((L) => { if (L.until > s.now) return true; s.coin += L.price; s.inc.shelf += L.price; s.sold.push(L.b); return false; });
}

// ---- skill (gets better with practice)
const strikeAvg = (s) => clamp(0.62 + 0.23 * (1 - Math.exp(-s.forged / 80)) + P.hammers[s.hammer] + PF.skill + 0.07 * gauss(s.rng), 0, 1);
const polishSkillExp = (s) => clamp(0.55 + 0.32 * (1 - Math.exp(-s.polished / 40)) + PF.skill, 0, 1);
const polishSkill = (s, liq) => clamp((polishSkillExp(s) + 0.08 * gauss(s.rng)) * P.liquids[liq].sk, 0, 1);
const runeQExp = (s, k, con) => clamp(0.58 + 0.24 * (1 - Math.exp(-s.runesSet / 40)) + P.chisels[s.chisel].q + P.conduits[con].q - P.runes[k].d + PF.skill, 0, 1);

// ---- the polish roll, exactly as rollPolish in 05-implementation.md
function rollPolish(sk, stone, liq, rng) {
  const S = P.stones[stone], L = P.liquids[liq];
  if (rng() < L.stain * (1.5 - sk)) return { q: 0, m: P.stainM, stain: true };
  if (rng() < S.mirror * L.mirror * sk * sk * (sk >= P.perfect ? 2 : 1)) return { q: 100, m: P.mirrorM, mirror: true };
  const q = clamp(Math.round(50 * sk + L.bonus + S.lo + (S.hi - S.lo) * rng()), 0, 99);
  return { q, m: Math.round(polishMult(q) * 100) / 100 };
}
function expPolishM(sk, stone, liq) {   // expected multiplier (for the sim player's choice)
  const S = P.stones[stone], L = P.liquids[liq], st = clamp(L.stain * (1.5 - sk), 0, 1), mi = S.mirror * L.mirror * sk * sk * (sk >= P.perfect ? 2 : 1);
  let avg = 0; for (let i = 0; i <= 10; i++) avg += polishMult(clamp(50 * sk + L.bonus + S.lo + (S.hi - S.lo) * i / 10, 0, 99)) / 11;
  return st * P.stainM + (1 - st) * (mi * P.mirrorM + (1 - mi) * avg);
}

// ---- buying
const dayPrice = (base, rise, ctr, s) => Math.round(base * (1 + rise * (ctr.d === s.day ? ctr.n : 0)));
const bump = (ctr, s) => { if (ctr.d !== s.day) { ctr.d = s.day; ctr.n = 0; } ctr.n++; };
function coinFor(s, cost) {   // coin needed to pay a cost, buying missing iron / damascus / star-dust at the market
  let c = cost.coin || 0;
  c += Math.max(0, (cost.iron || 0) - s.iron) * P.buy.iron + Math.max(0, (cost.damascus || 0) - s.damascus) * P.buy.damascus;
  const sh = Math.max(0, (cost.shards || 0) - s.shards); c += Math.max(0, sh * 10 - s.dust) * P.buy.dust;
  return c;
}
function pay(s, cost) {
  const c = coinFor(s, cost); s.coin -= c;
  s.iron = Math.max(0, s.iron - (cost.iron || 0)); s.damascus = Math.max(0, s.damascus - (cost.damascus || 0));
  const sh = Math.max(0, (cost.shards || 0) - s.shards); s.shards = Math.max(0, s.shards - (cost.shards || 0)); s.dust = Math.max(0, s.dust - sh * 10);
}
const reserve = (s) => 40 + 2 * (WT_ORDER.indexOf(bestWt(s)) + 1) * 12;
const renownCost = (lv) => P.renown.step * (lv + 1);   // the price of the next level when you have lv
function shop(s) {   // buy the next unlock in priority order once it can be paid for (save up for it otherwise)
  for (let guard = 0; guard < 5; guard++) {
    const nd = NODES.find((x) => !s.got[x.id] && x.req(s));
    if (!nd) break;
    if (s.coin < coinFor(s, nd.cost) + reserve(s)) break;
    s.spend.unlocks += coinFor(s, nd.cost); pay(s, nd.cost); s.got[nd.id] = 1; nd.apply(s);
    s.unlock[nd.id] = { min: s.playMs / MIN, day: s.day + 1, forges: s.forged };
    if (ONE) console.log(`  day ${String(s.day + 1).padStart(2)}  play ${(s.playMs / MIN).toFixed(0).padStart(5)} min  forges ${String(s.forged).padStart(5)}  bought ${nd.n}`);
  }
  // renown (opens with shelf slot 8): the sim buys it only once every unlock is bought, keeping 5,000 back
  if (!NO_RENOWN && NODES.every((x) => s.got[x.id])) {
    while (s.coin >= renownCost(s.renown) + 5000) { const c = renownCost(s.renown); s.coin -= c; s.spend.renown += c; s.renown++; }
  }
}

// ---- forging
const bestWt = (s) => WT_ORDER.filter((w) => s.wts.includes(w)).pop();
const knownTypes = (s, w) => s.styles.flatMap((st) => STYLES_OF[st]).filter((k) => !w || R.TYPES[k].wt === w);
function pickType(s) {
  const affordable = WT_ORDER.filter((w) => s.wts.includes(w) && s.coin + s.iron * P.buy.iron + s.coal * P.buy.coal >= (R.WT[w].iron * P.buy.iron + R.WT[w].coal * P.buy.coal));
  const w = affordable.pop() || 'L';
  const target = s.orders[Math.floor(s.rng() * s.orders.length)];
  if (target && s.rng() < 0.5 && s.wts.includes(R.TYPES[target.type].wt)) return target.type;
  const all = knownTypes(s, w), fresh = all.filter((k) => !s.found.has(k));
  const pool = fresh.length ? fresh : all; return pool[Math.floor(s.rng() * pool.length)];
}
function spend(s, secs) { s.playMs += secs * 1000 * P.overhead; s.now += secs * 1000 * P.overhead; }
function forge(s) {
  if (s.fuel < 1) {
    const p = dayPrice(P.feast.p, P.mealRise, s.meals, s);
    if (s.coin < p + reserve(s)) return false;
    s.coin -= p; s.fuel += P.feast.e; bump(s.meals, s); s.spend.meals += p;
  }
  const type = pickType(s), W = R.WT[R.TYPES[type].wt];
  const mats = Math.max(0, W.iron - s.iron) * P.buy.iron + Math.max(0, W.coal - s.coal) * P.buy.coal;
  if (s.coin < mats) return false;
  s.coin -= mats; s.spend.supplies += mats; s.iron = Math.max(0, s.iron - W.iron); s.coal = Math.max(0, s.coal - W.coal); s.fuel--;
  const avg = strikeAvg(s);
  let q = 'oil', best = -1;
  for (const k of s.quenches) {
    const g = Math.round(avg * 88 + P.quench[k].bonus), ev = (1 - P.quench[k].risk - 0.02) * R.gradeMult(g) * (g >= 90 ? 1.25 : 1);
    if (ev > best) { best = ev; q = k; }
  }
  const grade = clamp(Math.round(avg * 88 + P.quench[q].bonus), 1, 100), perfect = grade >= 90, tier = Math.min(4, s.anvil + (perfect ? 1 : 0));
  const night = (((s.now % DAY) + DAY) % DAY) / HOUR; const isNight = night >= 20 || night < 6;
  const { len, si } = R.rollSize(s.rng);
  const b = { type, rarity: R.rollIdx(R.ANVILS[tier].t, s.rng), variant: R.rollVariant(R.TYPES[type].c, s.rng), len, si, shine: R.rollShine(s.rng),
    moon: R.rollMoon(isNight, s.rng), grade, cracked: s.rng() < P.quench[q].risk + 0.02 };
  s.forged++; earnSide(s); spend(s, P.secs[R.TYPES[type].wt]); addXp(s, 'smith', R.forgeXp(b));
  if (b.cracked) { s.iron += Math.round(W.iron * b.len / 100 * 0.3); return true; }
  if (b.rarity >= 2) s.mw++; if (grade >= 70) s.g70++;
  armory(s, b);
  finish(s, b);
  return true;
}
// getting-started steps pay out over the first 10 forges; daily challenges after 10 and 30 forges that day
function earnSide(s) {
  if (s.gs < 10) { const c = Math.round(P.gettingStarted / 10); s.gs++; s.coin += c; s.inc.other += c; }
  if (s.chD !== s.day) { s.chD = s.day; s.chN = 0; } s.chN++;
  const c = s.chN === 10 ? Math.round(P.challengesPerDay * 0.4) : s.chN === 30 ? Math.round(P.challengesPerDay * 0.6) : 0;
  if (c) { s.coin += c; s.inc.other += c; }
}
// Armory first finds (as today)
function armory(s, b) {
  const bits = 1 | (b.rarity === 4 ? 2 : 0) | (b.si >= 5 ? 4 : 0) | (b.shine === 'temp' ? 8 : 0) | (b.shine === 'star' ? 16 : 0) | (b.moon ? 32 : 0);
  const old = s.arm[b.type] || 0, add = bits & ~old; s.arm[b.type] = old | bits; s.found.add(b.type);
  if (add & 1) { const c = Math.round(20 * R.WT[R.TYPES[b.type].wt].v); s.coin += c; s.inc.other += c; }
  if (add & 2) s.damascus += 2; if (add & 4) s.damascus += 1; if (add & 8) s.dust += 5; if (add & 16) s.shards += 1; if (add & 32) { s.coin += 25; s.inc.other += 25; }
}

// ---- polishing and enchanting a fresh blade
function finish(s, b) {
  const fw = forgeWorth(b);
  if (s.polishOn) {
    const ex = polishSkillExp(s);
    let liq = 'spring', bestM = 0;
    for (const k of s.liquids) { const m = expPolishM(clamp(ex * P.liquids[k].sk, 0, 1), s.stone, k); if (m > bestM) { bestM = m; liq = k; } }
    const g = P.grit[R.TYPES[b.type].wt], gritCost = Math.max(0, g - s.grit) * P.buy.grit;
    const order = s.orders.find((o) => o.type === b.type && o.minP);
    if ((fw * (bestM - 1) > gritCost * 1.5 || order || s.enchantOn) && s.coin >= gritCost) {
      s.coin -= gritCost; s.spend.grit += gritCost; s.grit = Math.max(0, s.grit - g);
      const sk = polishSkill(s, liq); b.polish = rollPolish(sk, s.stone, liq, s.rng);
      s.polished++; if (sk >= 0.7) s.pgood++; if (b.polish.mirror) s.mirrors++; if (b.polish.stain) s.stains++; addXp(s, 'smith', R.polishXp(b));
      spend(s, P.secs.polish);
    }
  }
  if (s.enchantOn && b.polish) enchant(s, b, fw * b.polish.m);
  // a commission that wants exactly this?
  const v = worth(b);
  const oi = s.orders.findIndex((q) => fits(b, q));
  if (oi >= 0 && (s.orders[oi].pay > v * 0.9 || s.comms < 5)) {
    s.coin += s.orders[oi].pay; s.inc.comm += s.orders[oi].pay; s.comms++; s.n.comm++; s.orders.splice(oi, 1, genOrder(s)); return;
  }
  s.rack.push(b);
}
function enchant(s, b, base) {
  const slots = P.chisels[s.chisel].slots, order = s.orders.find((o) => o.type === b.type && o.rune);
  b.runes = [];
  let pick = [...s.runes].sort((x, y) => P.runes[y].v - P.runes[x].v);
  if (order && s.runes.includes(order.rune)) pick = [order.rune, ...pick.filter((k) => k !== order.rune)];
  let did = 0;
  for (let i = 0; i < slots && pick.length; i++) {
    // the best rune for this slot by gain per mana spent (cheaper runes on cheaper blades)
    let k = null, con = 'copper', gain = 0, gpm = 0;
    for (const rk of pick) for (const ck of s.conduits) {
      const Rn = P.runes[rk], C = P.conduits[ck], q = runeQExp(s, rk, ck);
      const gn = base * Rn.v * q * C.power * (1 - C.risk) * P.slotW[i] - base * C.risk * 0.3 * (slots - i - 1 > 0 ? 0.5 : 0);
      const isOrder = order && rk === order.rune;
      const score = gn / Rn.mana * (isOrder ? 3 : 1);
      if (score > gpm) { gpm = score; gain = gn; k = rk; con = ck; }
    }
    if (!k) break;
    const Rn = P.runes[k];
    // spend mana freely while the meter is high; when it is low, only on blades worth it; buy a draught when the gain pays for it
    const val = s.manaVal || 0;
    if (s.mana >= Rn.mana && !(s.mana < mmax(s) * 0.5 && gpm < val * 0.7)) { /* use what we have */ }
    else {
      while (s.mana < Rn.mana) {
        const p = dayPrice(P.draught.p, P.draught.rise, s.draughts, s);
        if (gpm * P.draught.mana < p * 1.2 || s.coin < p + reserve(s) || s.mana + P.draught.mana > mcap(s)) break;
        s.coin -= p; s.mana += P.draught.mana; bump(s.draughts, s); s.spend.draughts += p;
      }
      if (s.mana < Rn.mana) break;
    }
    s.mana -= Rn.mana; s.manaVal = s.manaVal ? s.manaVal * 0.95 + gpm * 0.05 : gpm;
    spend(s, P.secs.rune);
    pick = pick.filter((x) => x !== k);
    const C = P.conduits[con], q = clamp(runeQExp(s, k, con) + 0.08 * gauss(s.rng), 0, 1);
    if (q < P.fizzle) continue;                                                        // didn't take: the slot stays free
    if (s.rng() < C.risk) { b.runes.push({ k: 'scar', q: 0, p: 0 }); s.scars++; did++; continue; }   // backlash: a scar fills the slot
    const res = s.rng() < P.chisels[s.chisel].res * q * q; if (res) s.reson++;
    b.runes.push({ k, q, p: Rn.v * q * C.power * (res ? P.resonant : 1) });
    s.runesSet++; if (q >= 0.7) s.r70++; if (q >= 0.8) s.r80++; if (q >= 0.9) s.r90++; did++; addXp(s, 'ench', R.runeXp(b, k, res));
  }
  if (did) spend(s, P.secs.enchant); else delete b.runes;
}

// ---- commissions (today's rules, plus polish and rune requests once those are unlocked)
function genOrder(s) {
  const r = s.rng, types = s.wts.flatMap((w) => knownTypes(s, w)), type = types[Math.floor(r() * types.length)];
  const maxR = s.anvil < 1 ? 1 : s.anvil < 3 ? 2 : 3, minR = Math.min(maxR, R.rollIdx([35, 35, 22, 8], r));
  const minS = r() < 0.35 ? (r() < 0.75 ? 3 : 4) : 0, minG = r() < 0.35 ? 55 + Math.floor(r() * 5) * 5 : 0;
  let pay = P.commission.base[minR] * R.WT[R.TYPES[type].wt].v * (minS === 3 ? 1.6 : minS === 4 ? 3 : 1) * (minG ? 1.3 : 1);
  let minP = 0, rune = '';
  if (s.polishOn && (s.enchantOn || r() < P.commission.polishChance)) { minP = [40, 60, 80][R.rollIdx([50, 35, 15], r)]; pay *= 1 + minP / 100; }
  if (s.enchantOn && s.runes.length && r() < P.commission.runeChance) { rune = s.runes[Math.floor(r() * s.runes.length)]; pay *= 1 + P.commission.runeK * P.runes[rune].v; }
  return { type, minR, minS, minG, minP, rune, pay: Math.round(pay), age: 0 };
}
const fits = (b, q) => !b.cracked && b.type === q.type && b.rarity >= q.minR && b.si >= q.minS && b.grade >= q.minG &&
  (!q.minP || (b.polish && b.polish.q >= q.minP)) && (!q.rune || (b.runes || []).some((x) => x.k === q.rune && x.q >= 0.5));

// ---- selling: shelves first, then the scrap merchant or the salvage pile for the overflow
const salvCoin = (b) => {   // what salvaging is worth to this player, in coin at market prices
  const W = R.WT[R.TYPES[b.type].wt]; let c = Math.round(W.iron * b.len / 100 * 0.6) * P.buy.iron;
  const y = R.RAR[b.rarity].salv; c += (y.coal || 0) * P.buy.coal + (y.damascus || 0) * P.buy.damascus + (y.dust || 0) * P.buy.dust;
  if (b.shine === 'temp') c += 5 * P.buy.dust; if (b.shine === 'star') c += 3 * 10 * P.buy.dust;
  if (b.polish) c += (R.TYPES[b.type].wt === 'X' ? 2 : 1) * P.buy.grit;
  for (const r of b.runes || []) if (r.k !== 'scar') c += P.buy.dust;
  return c;
};
function salvage(s, b) {
  const W = R.WT[R.TYPES[b.type].wt]; s.iron += Math.round(W.iron * b.len / 100 * 0.6);
  const y = R.RAR[b.rarity].salv; s.coal += y.coal || 0; s.damascus += y.damascus || 0; s.dust += y.dust || 0;
  if (b.shine === 'temp') s.dust += 5; if (b.shine === 'star') s.shards += 3;
  if (b.polish) s.grit += R.TYPES[b.type].wt === 'X' ? 2 : 1;
  for (const r of b.runes || []) if (r.k !== 'scar') s.dust++;   // +1 star-dust per rune
}
function sellRound(s, maxRack) {
  for (let i = s.orders.length - 1; i >= 0; i--) {   // deliver any blade on the rack that fits an order
    const q = s.orders[i], j = s.rack.findIndex((b) => fits(b, q) && (q.pay > worth(b) * 0.9 || s.comms < 5));
    if (j < 0) continue;
    s.rack.splice(j, 1); s.coin += q.pay; s.inc.comm += q.pay; s.comms++; s.n.comm++; s.orders.splice(i, 1, genOrder(s));
  }
  s.rack.sort((a, b) => worth(b) - worth(a));
  const ren = 1 + P.renown.per * s.renown;
  while (s.rack.length && s.shelf.length < s.shelves) {   // the dearest blade first: it earns the most per shelf-minute
    const b = s.rack.shift(), v = worth(b), price = Math.round(v * R.SHELF.f * ren), ms = R.shelfMs(v);
    s.shelf.push({ b, until: s.now + ms, price }); s.n.shelf++; s.shelfMin += ms / MIN;
  }
  while (s.rack.length > maxRack) {   // too many: sell or salvage the least valuable
    const b = s.rack.pop(), q = Math.round(worth(b) * P.scrap), sv = salvCoin(b);
    if (sv > q) { salvage(s, b); s.n.salv++; } else { s.coin += q; s.inc.quick += q; s.sold.push(b); s.n.quick++; }
  }
  if (s.dust >= 10) { const n = Math.floor(s.dust / 10); s.dust -= n * 10; s.shards += n; }   // refine star-dust into shards
}

// ---- a session of play
function session(s, len) {
  const end = s.playMs + len * MIN; tick(s);
  for (const q of s.orders) q.age++;
  if (s.orders.some((q) => q.age > 6) && s.coin > 60) { s.coin -= 10; s.orders = []; }
  while (s.orders.length < 3) s.orders.push(genOrder(s));
  while (s.playMs < end) {
    tick(s); shop(s);
    const before = s.playMs;
    forge(s);
    sellRound(s, 8);
    if (s.playMs === before) { s.playMs += 20e3; s.now += 20e3; }   // nothing to do: wait a moment
  }
  tick(s); sellRound(s, 12); shop(s);
}

function run(seed) {
  const s = newState(R.mulberry(seed));
  for (let d = 0; d < DAYS; d++) {
    s.day = d;
    PF.sessions.forEach(([h, len], i) => {
      s.now = d * DAY + h * HOUR;
      const m0 = s.playMs, c0 = s.inc.shelf + s.inc.quick + s.inc.comm + s.inc.other;
      session(s, len);
      (s.log = s.log || []).push({ min: s.playMs / MIN, earned: s.inc.shelf + s.inc.quick + s.inc.comm + s.inc.other - c0, dm: (s.playMs - m0) / MIN });
    });
    s.coinByDay.push(s.coin + s.shelf.reduce((a, L) => a + L.price, 0));
    s.lvByDay.smith.push(R.smithLevel(s).lv); s.lvByDay.ench.push(R.enchLevel(s).lv); (s.xpByDay = s.xpByDay || []).push({ ...s.xp });
  }
  s.now = DAYS * DAY; tick(s);
  return s;
}

// ------------------------------------------------------------------------------------------- report
const pct = (a, p) => { if (!a.length) return NaN; const x = [...a].sort((u, v) => u - v); return x[Math.min(x.length - 1, Math.floor(p * x.length))]; };
const fm = (m) => (isNaN(m) ? '   -  ' : m < 600 ? `${m.toFixed(0)} min` : `${(m / 60).toFixed(1)} h`);
const runs = []; for (let i = 0; i < RUNS; i++) runs.push(run(SEED * 100003 + i));
const minPerDay = PF.sessions.reduce((a, x) => a + x[1], 0);
// the shelf curve itself: selling time, price and coin per shelf-hour by worth (no Advertising), against the scrap merchant
console.log(`\nShop shelf: price x${R.SHELF.f}, time ${R.SHELF.ms / MIN} min x (worth / ${R.SHELF.ref})^${R.SHELF.p}, ${R.SHELF.min / MIN} min .. ${R.SHELF.max / MIN} min`);
console.log('  worth      time   price   coin/shelf-hour   scrap merchant (instant)');
for (const v of [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
  const ms = R.shelfMs(v), pr = Math.round(v * R.SHELF.f);
  console.log(`  ${String(v).padStart(5)}  ${fm(ms / MIN).padStart(8)}  ${String(pr).padStart(6)}   ${String(Math.round(pr / (ms / HOUR))).padStart(10)}        ${Math.round(v * P.scrap)}`);
}
console.log(`\nAnvilmoon economy sim (04-balance). Profile "${PROFILE}" (${PF.sessions.length} sessions, ${minPerDay} min of play a day), ${RUNS} runs, ${DAYS} days, seed ${SEED}${NO_RENOWN ? ', NO renown' : ''}.\n`);
if (!ONE) {
  console.log('Unlock                                                     reached  median play     p10 .. p90 play     median day  forges');
  for (const nd of NODES) {
    const u = runs.map((r) => r.unlock[nd.id]).filter(Boolean);
    const m = u.map((x) => x.min);
    console.log(`${(`[${nd.tree}] ` + nd.n).padEnd(58)} ${String(Math.round(100 * u.length / RUNS)).padStart(5)}%  ${fm(pct(m, 0.5)).padStart(10)}   ${fm(pct(m, 0.1)).padStart(8)} .. ${fm(pct(m, 0.9)).padEnd(8)}  ${String(pct(u.map((x) => x.day), 0.5) ?? '-').padStart(7)}   ${String(pct(u.map((x) => x.forges), 0.5) ?? '-').padStart(5)}`);
  }
}
const windows = [[0, 30], [30, 60], [60, 120], [120, 180], [180, 300], [300, 600], [600, 1200], [1200, 2400], [2400, 4800], [4800, 1e9]];
console.log('\nCoin earned per hour of play (all income: shop, scrap merchant, commissions, challenges, Armory)');
for (const [a, b] of windows) {
  const per = [];
  for (const r of runs) { const L = r.log.filter((x) => x.min > a && x.min <= b); if (!L.length) continue; const m = L.reduce((t, x) => t + x.dm, 0); per.push(L.reduce((t, x) => t + x.earned, 0) / m * 60); }
  if (!per.length) continue;
  console.log(`  ${(fm(a) + ' - ' + (b > 1e8 ? 'end' : fm(b))).padEnd(18)} ${String(Math.round(pct(per, 0.5))).padStart(8)} coin/h`);
}
const days = [1, 3, 7, 14, 21, 30, 45, 60, 90].filter((d) => d <= DAYS);
console.log('\nCoin in hand (incl. shelf listings) at the end of day:  ' + days.map((d) => `day ${d}: ${Math.round(pct(runs.map((r) => r.coinByDay[d - 1]), 0.5)).toLocaleString('en')}`).join('   '));
console.log('Advertising level at the end: median ' + pct(runs.map((r) => r.renown), 0.5) + ', p90 ' + pct(runs.map((r) => r.renown), 0.9));
// levels
for (const [track, name, max] of [['smith', 'Smithing', R.SMITH_MAX_LV], ['ench', 'Enchanting', R.ENCH_MAX_LV]]) {
  const marks = [2, 3, 5, 8, 10, 12, 15, 18, max].filter((l, i, a) => l <= max && a.indexOf(l) === i);
  console.log(`
${name} level (max ${max}): reached by   ` + marks.map((l) => { const u = runs.map((r) => r.lvAt[track][l]).filter(Boolean); return `lv${l} ${Math.round(100 * u.length / RUNS)}% ${u.length ? fm(pct(u.map((x) => x.min), 0.5)).trim() + ' (day ' + pct(u.map((x) => x.day), 0.5) + ')' : ''}`; }).join(' | '));
  console.log(`  level at the end of day: ` + days.map((d) => `day ${d}: ${pct(runs.map((r) => r.lvByDay[track][d - 1]), 0.5)}`).join('   ') + `
  XP at the end of day:    ` + days.map((d) => `day ${d}: ${Math.round(pct(runs.map((r) => r.xpByDay[d - 1][track]), 0.5)).toLocaleString('en')}`).join('   '));
}
const late = runs.flatMap((r) => r.sold.slice(-300));
const polS = late.filter((b) => b.polish), encS = late.filter((b) => b.runes && b.runes.length);
const avg = (v) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : NaN);
console.log(`\nAt the end (last 300 blades sold per player): ${(100 * polS.length / late.length).toFixed(0)}% polished, average polish x${avg(polS.map((b) => b.polish.m)).toFixed(2)} (best x${Math.max(...polS.map((b) => b.polish.m)).toFixed(2)}); ` +
  `${(100 * encS.length / late.length).toFixed(0)}% enchanted, average enchant x${avg(encS.map(enchMult)).toFixed(2)} (best x${encS.length ? Math.max(...encS.map(enchMult)).toFixed(2) : '-'}), runes per enchanted blade ${avg(encS.map((b) => b.runes.length)).toFixed(2)}.`);
const sum = (k) => runs.reduce((t, r) => t + r[k], 0);
console.log(`Per player over the run: ${(sum('polished') / RUNS).toFixed(0)} polishes (${(sum('mirrors') / RUNS).toFixed(1)} Mirror, ${(sum('stains') / RUNS).toFixed(1)} stained), ${(sum('runesSet') / RUNS).toFixed(0)} runes set (${(sum('reson') / RUNS).toFixed(1)} Resonant, ${(sum('scars') / RUNS).toFixed(1)} scars).`);
const tot = runs.reduce((t, r) => { for (const k in r.inc) t[k] = (t[k] || 0) + r.inc[k]; return t; }, {}), all = Object.values(tot).reduce((a, b) => a + b, 0);
console.log(`Income split: shop shelves ${(100 * tot.shelf / all).toFixed(0)}%, scrap merchant ${(100 * tot.quick / all).toFixed(0)}%, commissions ${(100 * tot.comm / all).toFixed(0)}%, challenges + Armory ${(100 * tot.other / all).toFixed(0)}%.`);
const nn = runs.reduce((t, r) => { for (const k in r.n) t[k] = (t[k] || 0) + r.n[k]; return t; }, {}), nAll = Object.values(nn).reduce((a, b) => a + b, 0);
console.log(`Where blades went: ${Object.entries(nn).map(([k, v]) => `${k} ${(100 * v / nAll).toFixed(0)}%`).join(', ')}.`);
const sp = runs.reduce((t, r) => { for (const k in r.spend) t[k] = (t[k] || 0) + r.spend[k]; return t; }, {}), spAll = Object.values(sp).reduce((a, b) => a + b, 0);
console.log(`Where coin went: ${Object.entries(sp).map(([k, v]) => `${k} ${(100 * v / spAll).toFixed(0)}%`).join(', ')}.`);
console.log(`Average shelf listing: ${(runs.reduce((t, r) => t + r.shelfMin, 0) / Math.max(1, nn.shelf)).toFixed(0)} min.`);
console.log(`Blades forged in ${DAYS} days: median ${pct(runs.map((r) => r.forged), 0.5)}.\n`);
