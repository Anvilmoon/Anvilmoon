# 05 Implementation spec

The exact plan the code follows. Numbers and reasons are in `04-balance.md`; this file says **what to write where**.
Four implementers work **in parallel without talking to each other**, so every name, argument and file boundary below
is fixed. If something here is impossible, do the smallest thing that keeps the contract and write it down in your
final report; do not change another implementer's file.

Branch `shop-redesign`. Never touch Supabase, Vercel, `main`, or the live database. Test with `npm test` and
`npm run dev` (http://127.0.0.1:8130, in-memory).

## 0. Who owns what

| # | Implementer | Files they may edit | Files they must not edit |
|---|---|---|---|
| 1 | **RULES** | `www/js/rules.js`, `supabase/functions/api/rules.js` (only via `node tools/sync-rules.mjs`), `supabase/functions/api/index.ts` (only `cleanBlade`, section 7), `tests/*.test.mjs` | everything else |
| 2 | **POLISH UI** | new file `www/js/polish.js` | everything else (not `index.html`) |
| 3 | **ENCHANT UI** | new file `www/js/enchant.js` | everything else (not `index.html`) |
| 4 | **SHOP/CLIENT** | `www/index.html`, `www/sw.js` | `rules.js`, `polish.js`, `enchant.js`, server, tests |

Implementers 2, 3 and 4 code against the `AMR` names in sections 2–5 and the UI contract in section 8 even before
RULES is finished. RULES must export **exactly** those names.

---

## 1. Save format

`SAVE_V = 3`. No migration of old saves: `upgradeSave` only fills defaults and drops dead fields (section 5.3), so
a fresh dev database just works.

### 1.1 Smith `c` (in `S.slots[0]`)

| Field | Default | Meaning |
|---|---|---|
| `grit` | 0 | grit in stock |
| `mana` | `MANA_MAX` (20) | the mana meter: refills to `manaMax(c)` (20 + 2 per Enchanting level); up to `manaCap(c)` (max + 20) after draughts |
| `manaTs` | now | when mana last ticked (like `fuelTs`) |
| `stone` | 0 | best stone owned, 0..4 (like `anvil`) |
| `chisel` | 0 | best chisel owned, 0..3 |
| `shelves` | 3 | shop shelf slots, 3..8 |
| `renown` | 0 | **Advertising** level (the field keeps its old name) |
| `xp` | `{ smith: 0, ench: 0 }` | total Smithing and Enchanting XP (section 2.4); levels are worked out from it |
| `stat` | `{ pol:0, pgood:0, runes:0, r70:0, r80:0, r90:0 }` | counters for requirements: polishes, polishes with skill ≥ 0.7, runes set, runes set at strength ≥ 0.7 / 0.8 / 0.9 |
| `draughts` | absent | `{ d: localDay, n }` like `meals` |
| `recipes` | `{}` | now also holds styles (`shadow`, `arcane`, `sanct`), `polish`, `camellia`, `acid`, `enchant`, `silver`, `stormglass`, runes `frost`…`dawn` |

**Removed** smith fields (delete in `upgradeSave`): `cls`, `classes`, `selBy`, `freeWar`, `demand`, `demandTs`.
`sel` stays (the game's selected blade type).

Known without buying (`knows`): `L`, `oil`, `war`; `spring` once `recipes.polish`; `ember` and `copper` once
`recipes.enchant`.

### 1.2 Blade `b`

| Field | Set by | Shape |
|---|---|---|
| `b.polish` | `polishEnd` | `{ q, m, s, stone, liq }` plus `mirror: 1` or `stain: 1`. q 0..100, m 0.8..2.5, s 0..1 (2 decimals) |
| `b.runes` | `enchantEnd` | array, at most 3: `{ k, q, p }` plus `r: 1` if Resonant; a scar is `{ k: 'scar', q: 0, p: 0 }` |
| `b.status` | | new value **`'shelf'`** (on a shop shelf); `'sold'` once the shelf sale settles |
| `b.shelf` | `shelfList` | `{ at, until, price }` (kept after the sale as a record). Listings made before the one-time change may still carry an old `k`: ignore it |

### 1.3 Session objects on `S`

| Field | Set by | Shape |
|---|---|---|
| `S.polish` | `polishStart`, cleared by `polishEnd` | `{ id, stone, liq, seed, t0 }` |
| `S.enchant` | `enchantStart`, cleared by `enchantEnd` | `{ id, rune, con, chisel, tol, win, t0 }` |

A new start replaces a stale one (the old one's grit or mana is simply lost).

---

## 2. Data tables (rules.js, DATA section)

### 2.1 Changes to existing data

- `CLASSES`: keep the object and keys (`war shadow arcane sanct`); change only `n` to `'War'`, `'Shadow'`, `'Arcane'`,
  `'Sanctum'`. The UI calls them **styles**. `CK` stays.
- `ANVILS`: remove the `cost` fields (costs live in `UNLOCKS` now). Keep `n`, `t`, `d`.
- `PRICES = { iron: 4, coal: 3, fuel: 3, damascus: 45, grit: 5, dust: 40 }`.
- `MATN`: add `grit: 'Grit', mana: 'Mana'`.
- **Delete:** `MERCHANT`, `TRADER`, `CLASS_COST`, `SLOT_PCT`, `RECIPES`, `DEM_TICK`, `DEM_WIN`, `DEM_KEEP`.
- `SAVE_V = 3`.
- `GS_STEPS`: change the `sell` row's text to `'Sell a blade'`, `'Open a blade on your rack and put it on a shop shelf, or sell it to the scrap merchant.'`
  and the `workshop` row's text to `'Patterns, anvils, stones and chisels. This is what to save your coin for.'`.
- `TITLES` chronicler rows: `['chron-' + k, `${CLASSES[k].n} Chronicler`, `Find every ${CLASSES[k].n} blade`, …]`.

### 2.2 New data (paste after `PRICES` / `QUENCH`)

```js
const SCRAP = .40;                                   // the scrap merchant pays 40% of worth, at once
// Shop shelf listings: one fixed price and one fixed selling time per blade, both set when you list.
// time = ms x (worth / ref)^p, rounded to the minute, kept between min and max. p < 1, so a blade worth 100x more
// takes only about 6x longer to sell: dear blades earn far more per shelf-minute than cheap ones.
const SHELF = { f: 1.15, ms: 12 * 60e3, ref: 100, p: .40, min: 2 * 60e3, max: 3 * 3600e3 };
const SHELF_START = 3, SHELF_MAX = 8, SHELF_TEST_DIV = 20;   // test odds (dev only): listings sell 20x sooner
const RENOWN_STEP = 10000, RENOWN_PER = .01;          // Advertising level n costs 10,000 x n; each level +1% on shelf sales
const GRIT_PER = { L: 1, M: 1, H: 2, X: 3 };          // grit used by one polish, by weight
const MANA_MAX = 20, MANA_MS = 120000, MANA_CAP = 40; // level-1 values: +1 every 2 minutes up to manaMax(c); draughts to manaCap(c)
const DRAUGHT = { mana: 5, p: 20, rise: .10 };        // mana draught: +5 mana for 20c, +10% for each one bought today
const COMM_POLISH = .6, COMM_RUNE = .5, COMM_RUNE_K = 1.5, COMM_RUNE_Q = .5;   // commission polish/rune requests

// polishing: the mini-game (docs/redesign/02-polishing.md section 2)
const POLISH = { TICK: 50, MAX_TICKS: 400, SLACK: 1500, SEG: 24, A: 50, B: 950, R: 50, GRIME: .5, SPOT: [1.0, .5],
  BITE: .08, SLOW: .4, SLOW_BITE: .35, FAST: 1.4, FAST_END: .55, RAMP: .4, SCRATCH: .08, SCRATCH_W: 1.5 };
// polishing: the roll. Stones are bought in order (c.stone 0..4), like anvils.
const STONES = [
  { n: 'Sandstone',  lo: 0,  hi: 15, mirror: .005, c: '#b59a74', d: 'Comes with the polishing bench.' },
  { n: 'Whetstone',  lo: 5,  hi: 22, mirror: .01,  c: '#8d9096', d: 'A finer grain: better polishes.' },
  { n: 'Waterstone', lo: 10, hi: 28, mirror: .02,  c: '#c9a64a', d: 'Soaked before use. Brighter steel.' },
  { n: 'Moonstone',  lo: 15, hi: 34, mirror: .03,  c: '#9fc7e8', d: 'Pale and smooth. Mirror polishes come more often.' },
  { n: 'Starstone',  lo: 20, hi: 40, mirror: .05,  c: '#e6e0ff', d: 'The finest stone there is.' },
];
// polishing liquids: picked for each polish, like quenches. spring is known once you own the bench.
const LIQUIDS = {
  spring:   { n: 'Spring water', bonus: 0,  stain: 0,   mirror: 1,   bite: 1,   scr: 1,   c: '#9fd3ff', d: 'Safe. No bonus.' },
  camellia: { n: 'Camellia oil', bonus: 6,  stain: .05, mirror: 1,   bite: 1,   scr: .7,  c: '#e0a640', d: '+6 quality, small stain risk. The stone glides: fewer scratches.' },
  acid:     { n: 'Acid wash',    bonus: 12, stain: .18, mirror: 1.5, bite: 1.2, scr: 1.3, c: '#a8d65a', d: '+12 quality, Mirror polish 50% more likely, big stain risk. Scratches easily.' },
};
const MIRROR_M = 2.5, STAIN_M = .8, PERFECT_POLISH = .95;

// enchanting (docs/redesign/03-enchanting.md). Chisels are bought in order (c.chisel 0..3), like anvils.
const CHISELS = [
  { n: 'Flint Chisel',     slots: 1, tol: 14, res: .02, d: 'Where every runecarver starts.' },
  { n: 'Iron Chisel',      slots: 1, tol: 17, res: .03, d: 'A truer edge. Forgives a shaky hand.' },
  { n: 'Steel Chisel',     slots: 2, tol: 20, res: .04, d: 'Room for a second rune on every blade.' },
  { n: 'Starsteel Chisel', slots: 3, tol: 24, res: .06, d: 'Three runes, and the kindest edge.' },
];
// mana conduits: picked for each carving, like quenches. copper is known once you own the table.
const CONDUITS = {
  copper:     { n: 'Copper Conduit',     time: 1.0, power: 1.00, risk: .02, c: '#c8794a', d: 'Steady. 2% backlash risk.' },
  silver:     { n: 'Silver Conduit',     time: 1.3, power: 1.10, risk: .06, c: '#cfd6de', d: '30% more carving time, +10% power, 6% backlash risk.' },
  stormglass: { n: 'Stormglass Conduit', time: 1.6, power: 1.20, risk: .15, c: '#a58cff', d: '60% more carving time, +20% power, 15% backlash risk.' },
};
// Runes. s = the guide's strokes: lines of [x, y] points on the 1000 x 1000 plate (x right, y down, blade point at the top).
// sec = seconds of carving with the Copper conduit. mana = taken from the meter. v = value at full strength.
// Rule for new shapes: no two strokes closer than 150 units side by side; strokes meet at 45 degrees or more.
const RUNES = {
  ember:   { n: 'Ember',   g: 'ᚲ', glow: '#ff7a2a', sec: 5,   mana: 1, v: .35, s: [[[650, 200], [350, 500], [650, 800]]] },
  frost:   { n: 'Frost',   g: 'ᚷ', glow: '#8fdcff', sec: 6,   mana: 2, v: .55, s: [[[300, 250], [700, 750]], [[700, 250], [300, 750]]] },
  valor:   { n: 'Valor',   g: 'ᛏ', glow: '#ff5a4a', sec: 5.5, mana: 2, v: .75, s: [[[500, 150], [500, 850]], [[250, 380], [500, 150], [750, 380]]] },
  storm:   { n: 'Storm',   g: 'ᛋ', glow: '#c7b8ff', sec: 3.5, mana: 3, v: .95, s: [[[620, 120], [380, 420], [620, 580], [380, 880]]] },
  fortune: { n: 'Fortune', g: 'ᚠ', glow: '#e9c35a', sec: 5,   mana: 3, v: 1.15, s: [[[380, 150], [380, 850]], [[380, 250], [650, 100]], [[380, 480], [680, 300]]] },
  ward:    { n: 'Ward',    g: 'ᛉ', glow: '#e8f0ff', sec: 5,   mana: 4, v: 1.40, s: [[[500, 150], [500, 850]], [[220, 200], [500, 450]], [[780, 200], [500, 450]]] },
  hearth:  { n: 'Hearth',  g: 'ᛟ', glow: '#6fe0b0', sec: 6.5, mana: 4, v: 1.70, s: [[[500, 120], [750, 420], [500, 720], [250, 420], [500, 120]], [[500, 720], [300, 900]], [[500, 720], [700, 900]]] },
  dawn:    { n: 'Dawn',    g: 'ᛞ', glow: '#fff2c0', sec: 8,   mana: 5, v: 2.10, s: [[[220, 200], [220, 800]], [[780, 200], [780, 800]], [[220, 200], [780, 800]], [[780, 200], [220, 800]]] },
};
const RUNE_KEYS = Object.keys(RUNES);
const RUNE_STEP = 20, RUNE_MAX_PTS = 400, RUNE_MAX_STROKES = 12, RUNE_MAX_MS = 120000;
const RUNE_FIZZLE = .25, RUNE_FULL_SPARE = .4, RUNE_GRACE_MS = 3000, RUNE_SLOT_W = [1, .5, .3], RESONANT = 1.5;
```

### 2.3 UNLOCKS (paste after the block above)

```js
// Everything bought in the Workshop and the shop, in one table, bought with the `unlock` action.
//   tier: [field, n]  sets c[field] = n; bought in order (c[field] must be n - 1). Otherwise the key is learned into c.recipes.
//   after: an unlock you must own first.   req/need/rt: an extra requirement (see reqProgress), rt is shown as "First: <rt>."
const UNLOCKS = {
  // ---- forge
  anvil1:  { tree: 'forge', n: 'Iron Anvil', tier: ['anvil', 1], cost: { coin: 80, iron: 15 }, d: 'A proper anvil. Better rarity odds.' },
  anvil2:  { tree: 'forge', n: 'Steel Anvil', tier: ['anvil', 2], cost: { coin: 400, iron: 30, damascus: 4 }, d: 'Fewer Commons, more Masterworks.' },
  anvil3:  { tree: 'forge', n: 'Damascus Anvil', tier: ['anvil', 3], cost: { coin: 3000, damascus: 12, shards: 2 }, d: 'Pattern-welded and heavy.' },
  anvil4:  { tree: 'forge', n: 'Dragonbone Anvil', tier: ['anvil', 4], cost: { coin: 40000, damascus: 40, shards: 10 }, d: 'The best rarity table in the game.' },
  M:       { tree: 'forge', n: 'Medium blade pattern', cost: { coin: 150, iron: 10 }, d: 'Medium blades of every style you know.' },
  H:       { tree: 'forge', n: 'Heavy blade pattern', cost: { coin: 600, damascus: 3 }, req: 'comm', need: 5, rt: 'deliver 5 blades you forged to commissions', d: 'Heavy blades of every style you know.' },
  X:       { tree: 'forge', n: 'Massive blade pattern', cost: { coin: 2000, damascus: 8, shards: 1 }, req: 'mw', need: 1, rt: 'forge a Masterwork or better yourself', d: 'Massive blades of every style you know.' },
  brine:   { tree: 'forge', n: 'Brine quench', cost: { coin: 100 }, d: '10% crack risk, +6 grade.' },
  water:   { tree: 'forge', n: 'Water quench', cost: { coin: 400 }, req: 'g70', need: 10, rt: 'forge 10 blades with a grade of 70 or higher', d: '22% crack risk, +12 grade.' },
  shadow:  { tree: 'forge', n: 'Shadow style', cost: { coin: 300 }, req: 'found', need: 10, rt: 'find 10 blade types (Armory)', d: 'The 25 Shadow blades: quiet, curved and wicked.' },
  arcane:  { tree: 'forge', n: 'Arcane style', cost: { coin: 1200 }, req: 'found', need: 25, rt: 'find 25 blade types (Armory)', d: 'The 25 Arcane blades: rune-carved, with an element.' },
  sanct:   { tree: 'forge', n: 'Sanctum style', cost: { coin: 4000 }, req: 'found', need: 45, rt: 'find 45 blade types (Armory)', d: 'The 25 Sanctum blades: holy and ceremonial.' },
  // ---- polish
  polish:  { tree: 'polish', n: 'Polishing bench', cost: { coin: 300 }, after: 'M', req: 'forged', need: 20, rt: 'forge 20 blades', d: 'Opens polishing. Comes with Sandstone and Spring water.' },
  stone1:  { tree: 'polish', n: 'Whetstone', tier: ['stone', 1], after: 'polish', cost: { coin: 300, damascus: 2 }, d: STONES[1].d },
  stone2:  { tree: 'polish', n: 'Waterstone', tier: ['stone', 2], cost: { coin: 1200, damascus: 6 }, d: STONES[2].d },
  stone3:  { tree: 'polish', n: 'Moonstone', tier: ['stone', 3], cost: { coin: 6000, damascus: 15, shards: 3 }, d: STONES[3].d },
  stone4:  { tree: 'polish', n: 'Starstone', tier: ['stone', 4], cost: { coin: 40000, damascus: 30, shards: 10 }, d: STONES[4].d },
  camellia:{ tree: 'polish', n: 'Camellia oil', after: 'polish', cost: { coin: 150 }, d: LIQUIDS.camellia.d },
  acid:    { tree: 'polish', n: 'Acid wash', after: 'polish', cost: { coin: 800 }, req: 'pgood', need: 15, rt: 'polish 15 blades with skill 0.7 or better', d: LIQUIDS.acid.d },
  // ---- enchant
  enchant: { tree: 'enchant', n: 'Enchanter’s table', cost: { coin: 1200, damascus: 5 }, after: 'anvil2', req: 'pol', need: 40, rt: 'polish 40 blades', d: 'Opens enchanting. Comes with the Flint Chisel, the Copper Conduit and the Ember rune.' },
  chisel1: { tree: 'enchant', n: 'Iron Chisel', tier: ['chisel', 1], after: 'enchant', cost: { coin: 1000, iron: 20 }, d: CHISELS[1].d },
  chisel2: { tree: 'enchant', n: 'Steel Chisel', tier: ['chisel', 2], cost: { coin: 4000, damascus: 10, shards: 1 }, d: CHISELS[2].d },
  chisel3: { tree: 'enchant', n: 'Starsteel Chisel', tier: ['chisel', 3], cost: { coin: 40000, damascus: 30, shards: 10 }, d: CHISELS[3].d },
  silver:  { tree: 'enchant', n: 'Silver Conduit', after: 'enchant', cost: { coin: 1500, damascus: 4 }, d: CONDUITS.silver.d },
  stormglass: { tree: 'enchant', n: 'Stormglass Conduit', after: 'enchant', cost: { coin: 6000, shards: 3 }, req: 'r70', need: 10, rt: 'carve 10 runes with 70% strength or more', d: CONDUITS.stormglass.d },
  frost:   { tree: 'enchant', n: 'Frost rune', after: 'enchant', cost: { coin: 300 }, d: 'Value 0.55. 2 mana.' },
  valor:   { tree: 'enchant', n: 'Valor rune', after: 'enchant', cost: { coin: 1500, damascus: 3 }, req: 'runes', need: 10, rt: 'set 10 runes', d: 'Value 0.75. 2 mana.' },
  storm:   { tree: 'enchant', n: 'Storm rune', after: 'enchant', cost: { coin: 3000, damascus: 6 }, req: 'runes', need: 25, rt: 'set 25 runes', d: 'Value 0.95. 3 mana. Quick to carve, short window.' },
  fortune: { tree: 'enchant', n: 'Fortune rune', after: 'enchant', cost: { coin: 6000, shards: 3 }, req: 'runes', need: 60, rt: 'set 60 runes', d: 'Value 1.15. 3 mana.' },
  ward:    { tree: 'enchant', n: 'Ward rune', after: 'enchant', cost: { coin: 12000, shards: 5 }, req: 'runes', need: 120, rt: 'set 120 runes', d: 'Value 1.40. 4 mana.' },
  hearth:  { tree: 'enchant', n: 'Hearth rune', after: 'enchant', cost: { coin: 25000, shards: 8 }, req: 'r80', need: 25, rt: 'carve 25 runes with 80% strength or more', d: 'Value 1.70. 4 mana.' },
  dawn:    { tree: 'enchant', n: 'Dawn rune', after: 'enchant', cost: { coin: 60000, shards: 15 }, req: 'r90', need: 10, rt: 'carve 10 runes with 90% strength or more', d: 'Value 2.10. 5 mana. The longest shape.' },
  // ---- shop
  shelf4:  { tree: 'shop', n: 'Shelf slot 4', tier: ['shelves', 4], cost: { coin: 150 }, d: 'One more blade on display.' },
  shelf5:  { tree: 'shop', n: 'Shelf slot 5', tier: ['shelves', 5], cost: { coin: 500 }, d: 'One more blade on display.' },
  shelf6:  { tree: 'shop', n: 'Shelf slot 6', tier: ['shelves', 6], cost: { coin: 1500 }, d: 'One more blade on display.' },
  shelf7:  { tree: 'shop', n: 'Shelf slot 7', tier: ['shelves', 7], cost: { coin: 6000 }, d: 'One more blade on display.' },
  shelf8:  { tree: 'shop', n: 'Shelf slot 8', tier: ['shelves', 8], cost: { coin: 25000 }, d: 'A full shop. Opens Advertising.' },
};
const UNLOCK_KEYS = Object.keys(UNLOCKS);
const STAT0 = { pol: 0, pgood: 0, runes: 0, r70: 0, r80: 0, r90: 0 };
```

Key check (all recipe keys must be different): `M H X brine water shadow arcane sanct polish camellia acid enchant
silver stormglass frost valor storm fortune ward hearth dawn`; built-in `L oil war spring copper ember`; tiers
`anvil1-4 stone1-4 chisel1-3 shelf4-8`. The quench `water` and the liquid `spring` don't clash.

### 2.4 Levels: Smithing and Enchanting (second pass)

Numbers and reasons: `04-balance.md` section 11. Each `RUNES` row also has an `xp` field (Ember 4, Frost 5, Valor 6,
Storm 7, Fortune 8, Ward 9, Hearth 10, Dawn 12).

```js
// Advertising (the save field and action are still called `renown`)
const ADVERT = { n: 'Advertising', d: 'Flyers and notices around town. Every level adds 1% to every shelf sale.' };
// Climbing from level n to n + 1 takes round(LV_BASE x n^LV_POW) XP
const LV_BASE = 80, LV_POW = 1.5;
const SMITH_MAX_LV = 21, ENCH_MAX_LV = 16;
const LV_FUEL = 1, LV_MANA = 2;            // +1 max energy per Smithing level (10 -> 30), +2 max mana per Enchanting level (20 -> 50)
const MEAL_ROOM = ENERGY_CAP - FUEL_MAX, DRAUGHT_ROOM = MANA_CAP - MANA_MAX;   // 20: meals and draughts can go this far above the max
const XP_LEVELS = [0, 0, 80, 306, 722, 1362, ...];   // XP_LEVELS[n] = total XP to reach level n, built from the formula
const FORGE_XP = [10, 14, 22, 40, 90], CRACK_XP = 3;
const POLISH_XP = [6, 8, 13, 24, 54], MIRROR_XP = 25;
const ENCH_RAR_XP = [1, 1.2, 1.5, 2, 3], RESONANT_XP = 1.5;

levelOf(xp, max = SMITH_MAX_LV) -> { lv, cur, next, max }   // cur = XP into this level, next = XP this level takes (0 at the top)
smithLevel(c), enchLevel(c)                                  // levelOf(c.xp.smith, 21), levelOf(c.xp.ench, 16)
fuelMax(c) = FUEL_MAX + LV_FUEL x (Smithing lv - 1)          // tickFuel refills to this
manaMax(c) = MANA_MAX + LV_MANA x (Enchanting lv - 1)        // tickMana refills to this
fuelCap(c) = fuelMax(c) + 20                                 // eat (and salvaged energy) can fill to this
manaCap(c) = manaMax(c) + 20                                 // drink can fill to this
forgeXp(b), polishXp(b), runeXp(b, rune, resonant)           // XP for one blade / polish / rune
gainXp(ctx, 'smith' | 'ench', n)                             // adds XP, notes a level-up, adds n to ctx.out.xp[track]
```

`FUEL_MAX`, `MANA_MAX`, `ENERGY_CAP` and `MANA_CAP` stay exported as the level-1 values; code that shows or checks a
limit should call the functions instead. XP is given by `forgeEnd` (not day labour) and `quickForge` (`forgeXp`),
`polishEnd` (`polishXp`) and `enchantEnd` when the result is `set` or `resonant` (`runeXp`); nothing for a fizzle or
a backlash. Those actions add `xp: { smith: n }` or `xp: { ench: n }` to `ctx.out`. A level-up adds a note:
"**Smithing level 4!** Max energy 13." / "**Enchanting level 3!** Max mana 24."

---

## 3. Pure functions (rules.js)

### 3.1 New functions (paste in a new section right after "blades: names, worth, salvage")

Delete the old `value` and `worth` from that section first; the ones below replace them (`depositFor` keeps working).
This block needs `mulberry`, `clamp`, `hash32`, `vr`, `gradeMult`, `sizeMult`, which are all defined above it.

All are deterministic given their inputs (and `rng` where it is an argument). The polish scoring uses only
`+ − × /`, `min`, `max`, `abs`, `floor`; the rune scoring adds `Math.sqrt` (exactly rounded everywhere). Tested: every
rune template traced exactly scores q = 1.000; a 300-point random scribble scores 0.15; a jumping stone 0 → 1000 → 0
scores finish 0.

```js
// ============================================================== worth: forge worth x polish x enchant
// What the forge made a blade worth (today's formula without merchant demand). Not rounded.
function forgeWorth(b) {
  const t = TYPES[b.type]; if (!t || b.cracked) return 1;
  const bonus = 1.72 + RAR[b.rarity].vb + SIZES[b.si].vb + (b.shine ? SHINE[b.shine].vb : 0) + (vr(b).rare ? 1 : 0) + (b.moon ? .5 : 0);
  return BASE_COIN * WT[t.wt].v * bonus * gradeMult(b.grade) * sizeMult(b);
}
const polishMult = (b) => (b && b.polish ? b.polish.m : 1);
// runes count strongest first: the strongest fully, the 2nd half, the 3rd 30%
function enchantMult(b) {
  const ps = ((b && b.runes) || []).map((r) => r.p || 0).sort((x, y) => y - x);
  return 1 + ps.reduce((s, p, i) => s + p * (RUNE_SLOT_W[i] || 0), 0);
}
// What a blade is worth. Shelves, the scrap merchant and Auction House deposits all start from this.
function value(b) {
  if (!b || b.cracked || !TYPES[b.type]) return 1;
  return Math.max(1, Math.round(forgeWorth(b) * polishMult(b) * enchantMult(b)));
}
const worth = value;
const scrapPrice = (b) => Math.max(1, Math.round(value(b) * SCRAP));
// the shelf price (the third argument is ignored: it was the old Short/Medium/Long choice)
const shelfPrice = (c, b) => Math.max(1, Math.round(value(b) * SHELF.f * (1 + RENOWN_PER * ((c && c.renown) || 0))));
// how long a blade worth v takes to sell on a shelf, in ms (real time; test odds divide it by SHELF_TEST_DIV)
const shelfMs = (v) => clamp(Math.round(SHELF.ms * Math.pow(Math.max(1, v) / SHELF.ref, SHELF.p) / 60e3) * 60e3, SHELF.min, SHELF.max);
const shelfTime = (c, b) => shelfMs(value(b));
const renownCost = (c) => RENOWN_STEP * (((c && c.renown) || 0) + 1);

// ============================================================== the clock: mana and shop shelves
// The mana meter refills like energy (called in beginAction), up to manaMax(c). Above it (after draughts) it doesn't refill.
// (tickFuel likewise refills to fuelMax(c) instead of FUEL_MAX.)
function tickMana(c, now) {
  const max = manaMax(c);
  if (typeof c.mana !== 'number' || !isFinite(c.mana)) { c.mana = max; c.manaTs = now; }
  if (!c.manaTs) c.manaTs = now;
  if (c.mana >= max) { c.manaTs = now; return; }
  const n = Math.floor((now - c.manaTs) / MANA_MS);
  if (n > 0) { c.mana = Math.min(max, c.mana + n); c.manaTs += n * MANA_MS; if (c.mana >= max) c.manaTs = now; }
}
const draughtsToday = (c, day) => (c.draughts && c.draughts.d === day ? c.draughts.n : 0);
const draughtPrice = (c, day) => Math.round(DRAUGHT.p * (1 + DRAUGHT.rise * draughtsToday(c, day)));
// Every shelf listing whose time is up is sold: its fixed price goes to coin. Returns the blades sold just now.
// Pure and clock-based, so the game and the server always agree (beginAction calls it; the game may call it to show coin).
function settleShop(c, now) {
  const sold = [];
  for (const b of c.blades) {
    if (b.status !== 'shelf' || !b.shelf || now < b.shelf.until) continue;
    c.coin += b.shelf.price; b.status = 'sold'; b.su = b.shelf.until; sold.push(b);
  }
  return sold;
}
const shelfCount = (c) => c.blades.filter((b) => b.status === 'shelf').length;

// ============================================================== polishing: the shared scoring code
// The grime on each strip at the start, from the polish's seed. Same seed = same blade on both sides.
function polishInit(seed) {
  const r = mulberry(seed), t0 = new Array(POLISH.SEG).fill(POLISH.GRIME);
  for (let k = 0; k < 3; k++) {                       // three rust spots
    const c = Math.floor(r() * POLISH.SEG), w = 2 + Math.floor(r() * 3), h = POLISH.SPOT[0] + POLISH.SPOT[1] * r();
    for (let i = c - w; i <= c + w; i++) if (i >= 0 && i < POLISH.SEG) t0[i] += h * (1 - Math.abs(i - c) / (w + 1));
  }
  return { t0, t: t0.slice(), scr: new Array(POLISH.SEG).fill(0) };
}
// what the liquid does in the mini-game: bite = grime removed x, scr = scratches x
const polishFx = (liq) => ({ bite: LIQUIDS[liq].bite, scr: LIQUIDS[liq].scr });
// One 50 ms tick. x2, x1, x0 = where the stone was two ticks ago, one tick ago and now (-1 = lifted).
// Changes st. Returns how far over the speed limit the stone was (0 = fine, 1 = a full scratch), for the red glow and the scrape sound.
function polishTick(st, x2, x1, x0, fx) {
  if (x1 < 0 || x0 < 0 || x1 === x0) return 0;                       // lifted or still: nothing happens
  const move = x2 < 0 ? Math.abs(x0 - x1) : (Math.abs(x0 - x1) + Math.abs(x1 - x2)) / 2;
  const v = move / 50;                                                // tracks a second (1000 units over 20 ticks)
  const bite = POLISH.BITE * fx.bite * (v < POLISH.SLOW ? POLISH.SLOW_BITE : 1);
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1), w = (POLISH.B - POLISH.A) / POLISH.SEG;
  let worst = 0;
  for (let i = 0; i < POLISH.SEG; i++) {
    const c = POLISH.A + w * (i + .5);
    const ov = Math.min(hi, c + POLISH.R) - Math.max(lo, c - POLISH.R);   // how far the stone travelled over this strip
    if (ov <= 0) continue;
    const pass = ov / (2 * POLISH.R);                                      // 1 = one whole pass
    const limit = POLISH.FAST * (POLISH.FAST_END + (1 - POLISH.FAST_END) * st.t[i] / st.t0[i]);
    const over = clamp((v - limit) / POLISH.RAMP, 0, 1);
    st.t[i] = Math.max(0, st.t[i] - bite * pass);
    st.scr[i] += POLISH.SCRATCH * fx.scr * over * pass;
    if (over > worst) worst = over;
  }
  return worst;
}
// the speed limit (tracks a second) of strip i right now, for the speed meter's green band
const polishLimit = (st, i) => POLISH.FAST * (POLISH.FAST_END + (1 - POLISH.FAST_END) * st.t[i] / st.t0[i]);
// the strip under track position x (0..SEG-1), or -1 off the steel
const polishStrip = (x) => (x < POLISH.A || x >= POLISH.B ? -1 : Math.floor((x - POLISH.A) / ((POLISH.B - POLISH.A) / POLISH.SEG)));
// clean, finish and the skill score s (all 0..1) from a state
function polishResult(st) {
  let clean = 0, scr = 0;
  for (let i = 0; i < POLISH.SEG; i++) { clean += Math.min(1, (1 - st.t[i] / st.t0[i]) / .97); scr += st.scr[i]; }
  clean /= POLISH.SEG; scr /= POLISH.SEG;
  const finish = Math.max(0, 1 - POLISH.SCRATCH_W * scr);
  return { clean, finish, s: clean * clean * clean * finish };
}
// The whole polish from its samples. The browser calls polishTick live with the same samples; the server calls this once.
function polishScore(seed, samples, liq) {
  const st = polishInit(seed), fx = polishFx(liq);
  for (let k = 1; k < samples.length; k++) polishTick(st, k >= 2 ? samples[k - 2] : -1, samples[k - 1], samples[k], fx);
  return polishResult(st);
}
// the polish roll (server only: needs rng). s = skill 0..1
const polishCurve = (q) => 1 + Math.pow(q / 100, 1.5);
const polishName = (p) => (p.stain ? 'Stained' : p.q >= 100 ? 'Mirror polish' : p.q >= 75 ? 'Radiant polish' : p.q >= 50 ? 'Gleaming polish' : p.q >= 25 ? 'Bright polish' : 'Dull polish');
function rollPolish(s, stone, liq, rng) {
  const S = STONES[stone], L = LIQUIDS[liq];
  if (rng() < L.stain * (1.5 - s)) return { q: 0, m: STAIN_M, stain: 1 };
  if (rng() < S.mirror * L.mirror * s * s * (s >= PERFECT_POLISH ? 2 : 1)) return { q: 100, m: MIRROR_M, mirror: 1 };
  const q = clamp(Math.round(50 * s + L.bonus + S.lo + (S.hi - S.lo) * rng()), 0, 99);
  return { q, m: Math.round(polishCurve(q) * 100) / 100 };
}

// ============================================================== enchanting: the shared scoring code
// how long the mana lasts while carving this rune with this conduit, in ms
const runeWindow = (rune, con) => Math.round(RUNES[rune].sec * CONDUITS[con].time * 1000);
// credit for being d units from the line: 1 on it, 0 from 3 x tol away, a smooth curve between
const nearCredit = (d, tol) => { const r = d / (3 * tol); return r >= 1 ? 0 : 1 - r * r; };
const average = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function segmentsOf(lines) {           // a list of polylines as pieces [ax, ay, bx, by]
  const out = [];
  for (const l of lines) for (let i = 1; i < l.length; i++) out.push([l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]]);
  return out;
}
function samplePoints(l, step) {       // points along a polyline, about every `step` units, both ends included
  const out = [[l[0][0], l[0][1]]];
  for (let i = 1; i < l.length; i++) {
    const ax = l[i - 1][0], ay = l[i - 1][1], bx = l[i][0], by = l[i][1];
    const n = Math.max(1, Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}
function nearestDist(x, y, segs) {     // distance from a point to the nearest of a list of segments
  let best = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const u = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
    const ex = ax + u * dx - x, ey = ay + u * dy - y, d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}
// Score a carving. strokes = [[[x, y, t], ...], ...] (plate units 0..1000, ms since the first touch).
// o = { tol, win, tEnd }: tol from the chisel, win = how long the mana lasts (ms), tEnd = when the carving stopped (ms).
// Returns { acc, done, spare, charge, q }, all 0..1. q = acc x acc x done x charge.
function runeScore(rune, strokes, o) {
  const R = RUNES[rune], ink = [];
  for (const s of strokes) {           // the chisel stops when the mana runs out: keep only ink inside the window
    const line = [];
    for (let i = 0; i < s.length; i++) {
      const x = s[i][0], y = s[i][1], t = s[i][2];
      if (t <= o.win) { line.push([x, y]); continue; }
      if (line.length) {               // cut the last piece where the mana ran out
        const x0 = s[i - 1][0], y0 = s[i - 1][1], t0 = s[i - 1][2], f = (o.win - t0) / Math.max(1, t - t0);
        line.push([x0 + (x - x0) * f, y0 + (y - y0) * f]);
      }
      break;
    }
    if (line.length >= 2) ink.push(line);
  }
  const spare = 1 - Math.min(o.tEnd, o.win) / o.win;
  const charge = .85 + .15 * Math.min(1, spare / RUNE_FULL_SPARE);
  if (!ink.length) return { acc: 0, done: 0, spare, charge, q: 0 };
  const inkSegs = segmentsOf(ink), runeSegs = segmentsOf(R.s);
  const done = average(R.s.flatMap((l) => samplePoints(l, RUNE_STEP)).map(([x, y]) => nearCredit(nearestDist(x, y, inkSegs), o.tol)));
  const acc = average(ink.flatMap((l) => samplePoints(l, RUNE_STEP)).map(([x, y]) => nearCredit(nearestDist(x, y, runeSegs), o.tol)));
  return { acc, done, spare, charge, q: clamp(acc * acc * done * charge, 0, 1) };
}
// strokes as the browser sent them, or null if they don't add up
function cleanStrokes(strokes, tEnd) {
  if (!Array.isArray(strokes) || strokes.length > RUNE_MAX_STROKES) return null;
  let total = 0, last = 0;
  for (const s of strokes) {
    if (!Array.isArray(s) || s.length < 2) return null;
    for (const p of s) {
      if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isInteger)) return null;
      const [x, y, t] = p;
      if (x < 0 || x > 1000 || y < 0 || y > 1000 || t < last || t > tEnd) return null;
      last = t; total++;
    }
  }
  return total <= RUNE_MAX_PTS ? strokes : null;
}
// the dice for a carving (server only): fizzle, backlash (a scar fills the slot) or a rune, maybe Resonant
function rollRune(q, rune, con, chisel, rng) {
  if (q < RUNE_FIZZLE) return { res: 'fizzle', rune: null };
  if (rng() < CONDUITS[con].risk) return { res: 'backlash', rune: { k: 'scar', q: 0, p: 0 } };
  const resonant = rng() < CHISELS[chisel].res * q * q;
  const qq = Math.round(q * 1000) / 1000, p = Math.round(RUNES[rune].v * qq * CONDUITS[con].power * (resonant ? RESONANT : 1) * 1000) / 1000;
  return { res: resonant ? 'resonant' : 'set', rune: resonant ? { k: rune, q: qq, p, r: 1 } : { k: rune, q: qq, p } };
}
const runeSlots = (c) => CHISELS[c.chisel || 0].slots;
```

### 3.2 Changed helpers (replace the old bodies)

```js
const knows = (c, k) => k === 'L' || k === 'oil' || k === 'war' || !!(c.recipes && (c.recipes[k] ||
  (k === 'spring' && c.recipes.polish) || ((k === 'ember' || k === 'copper') && c.recipes.enchant)));
// do you own this unlock?
const owns = (c, k) => { const u = UNLOCKS[k]; if (!u) return false; return u.tier ? (c[u.tier[0]] || 0) >= u.tier[1] : knows(c, k); };
// the unlock just below a tier unlock (for "First get the X"), or null
const tierPrev = (k) => { const u = UNLOCKS[k]; return u && u.tier ? UNLOCK_KEYS.map((x) => UNLOCKS[x]).find((v) => v.tier && v.tier[0] === u.tier[0] && v.tier[1] === u.tier[1] - 1) || null : null; };
// can this smith forge this type? (the weight is checked by payForge)
const forgeable = (c, type) => !!(TYPES[type] && !TYPES[type].gift && knows(c, TYPES[type].c));
// progress towards a requirement
function reqProgress(S, c, key) {
  const g = (S.gone && S.gone.req) || {}, mine = c.blades.filter((b) => b.forger === c.name && b.status !== 'pending' && b.status !== 'stock');
  if (key === 'comm') return mine.filter((b) => b.status === 'commission').length + (g.comm || 0);
  if (key === 'mw') return mine.filter((b) => !b.cracked && b.rarity >= 2).length + (g.mw || 0);
  if (key === 'g70') return mine.filter((b) => !b.cracked && b.grade >= 70).length + (g.g70 || 0);
  if (key === 'forged') return c.forged || 0;
  if (key === 'found') { const m = armoryBits(S); return TK.filter((k) => (m[k] || 0) & 1).length; }
  if (Object.prototype.hasOwnProperty.call(STAT0, key)) return (c.stat && c.stat[key]) || 0;
  return 0;
}
// reqMet(S, c, r) stays: !r.req || reqProgress(S, c, r.req) >= r.need
function salvYield(b) {
  const t = WT[TYPES[b.type].wt], y = {};
  const iron = Math.round(t.iron * b.len / 100 * (b.cracked ? .3 : .6)); if (iron > 0) y.iron = iron;
  if (b.cracked) return Object.keys(y).length ? y : { fuel: 1 };
  for (const [k, v] of Object.entries(RAR[b.rarity].salv)) y[k] = (y[k] || 0) + v;
  if (b.shine === 'temp') y.dust = (y.dust || 0) + 5;
  if (b.shine === 'star') y.shards = 3;
  if (b.polish) y.grit = TYPES[b.type].wt === 'X' ? 2 : 1;
  const nr = (b.runes || []).filter((r) => r.k !== 'scar').length; if (nr) y.dust = (y.dust || 0) + nr;
  return Object.keys(y).length ? y : { fuel: 1 };
}
const exists = (b) => ['owned', 'sold', 'commission', 'listed', 'shelf'].includes(b.status) && !b.cracked;
// broke = can't afford a Light forge even after scrapping every blade on the rack
function isBroke(c) {
  const haveIron = c.iron + (c.bog || 0); if (haveIron >= 1 && c.coal >= 1) return false;
  const needC = (haveIron < 1 ? PRICES.iron * 5 : 0) + (c.coal < 1 ? PRICES.coal * 5 : 0); if (c.coin >= needC) return false;
  return c.coin + ownedOf(c).filter((b) => !isGift(b)).reduce((a, b) => a + scrapPrice(b), 0) < needC;
}
// commissions: any type you can forge; polish and rune requests once those are open (no imports)
function genComm(c, rng, now) {
  const own = TK.filter((k) => forgeable(c, k) && knows(c, TYPES[k].wt)), type = pickR(own.length ? own : [typesOf('war')[0]], rng);
  const maxR = c.anvil < 1 ? 1 : c.anvil < 3 ? 2 : 3, minR = Math.min(maxR, rollIdx([35, 35, 22, 8], rng));
  const minS = rng() < .35 ? (rng() < .75 ? 3 : 4) : 0, minG = rng() < .35 ? 55 + Math.floor(rng() * 5) * 5 : 0;
  let pay = [15, 40, 100, 280][minR] * WT[TYPES[type].wt].v * (minS === 3 ? 1.6 : minS === 4 ? 3 : 1) * (minG ? 1.3 : 1);
  let minP = 0, rune = '';
  if (knows(c, 'polish') && (knows(c, 'enchant') || rng() < COMM_POLISH)) { minP = [40, 60, 80][rollIdx([50, 35, 15], rng)]; pay *= 1 + minP / 100; }
  const runes = RUNE_KEYS.filter((k) => knows(c, k));
  if (knows(c, 'enchant') && runes.length && rng() < COMM_RUNE) { rune = pickR(runes, rng); pay *= 1 + COMM_RUNE_K * RUNES[rune].v; }
  return { id: String(now) + Math.floor(rng() * 1e6), type, minR, minS, minG, minP, rune, pay: Math.round(pay), patron: pickR(PATRONS, rng) };
}
const qualifies = (b, q) => b.status === 'owned' && !b.cracked && b.type === q.type && b.rarity >= q.minR && b.si >= q.minS && b.grade >= q.minG &&
  (!q.minP || !!(b.polish && b.polish.q >= q.minP)) && (!q.rune || (b.runes || []).some((r) => r.k === q.rune && r.q >= COMM_RUNE_Q));
// ensureComms(c, rng, now, online) keeps its signature and calls genComm(c, rng, now).
```

### 3.3 Other edits in rules.js

| Where | Change |
|---|---|
| `newChar(name, cls, now, rng)` | Keep the signature (ignore `cls`). Return `{ cid, name, coin: 80, iron: 12, coal: 8, fuel: 10, damascus: 0, dust: 0, shards: 0, bog: 0, grit: 0, mana: MANA_MAX, recipes: {}, fuelTs: now, manaTs: now, anvil: 0, stone: 0, chisel: 0, shelves: SHELF_START, renown: 0, hammer: 'worn', hammers: {}, blades: [], commissions: [], forged: 0, stat: { ...STAT0 }, xp: { smith: 0, ench: 0 }, sel: typesOf('war')[0] }` |
| `unify` | Drop the `demand`, `classes`, `freeWar`, `selBy` lines; add `'grit'` to the summed keys. |
| `needsUnify` | `all.length > 1 \|\| (all.length === 1 && (sv.slots[0] !== all[0] \|\| sv.active !== 0))` |
| `clsN`, `classOffer`, `slotsOpen`, `relaxDemand`, `settleDemand`, `clamorType` | **Delete.** |
| `compact` | `live` statuses: `['owned', 'listed', 'pending', 'wager', 'shelf']`. |
| `hallCtx` | `classes: c ? CK.filter((k) => knows(c, k)).length : 0` (key name kept; it now counts styles). |
| `HALL_KEYS` | add `'polish'`, `'runes'`. |
| `vr`, `bname`, `rollVariant`, `makeBlade` | unchanged (they read `CLASSES` by the type's style). |
| `forgeStart` (labor) | `type = typesOf('war')[1]`. Non-labor: `need(forgeable(c, type), 'Learn that blade’s style in the Workshop first.')`. |
| `quickForge`, `supfill` | same `forgeable` message. |
| `tourGift` | fallback type `typesOf('war')[0]`. |
| `createSmith` | drop `c.classes = ['war']; c.selBy = {};`. |

---

## 4. Actions

`rng: false` = the game predicts it at once (`actSync`); `rng: true` = server only (`await act`).

### 4.1 Removed

`learn`, `anvil`, `classSwitch`, `classLearn`. (Replaced by `unlock`; classes are gone.)

### 4.2 Unchanged

`createSmith` (minus the class lines), `forgeStart`/`forgeEnd`/`quickForge`/`tourGift` (minus class lines), `keep`,
`hall`, `sellMat`, `refine`, `supfill`, `eat`, `hammer`, `equip`, `repair`, `dig`, `collectDig`, `fulfill` (uses the
new `qualifies` through `deliverable`), `refreshBoard`, `jobFlag`, `chClaim`, `gs`, `gsSkip`, `prefs`.

### 4.3 Changed and new (paste into the ACTIONS section)

| Action | rng | Args | `ctx.out` |
|---|---|---|---|
| `sell` (scrap merchant) | false | `{ ids }` | `{ coin, n }` |
| `salvage` | false | `{ ids }` | `{ y, n }` (unchanged code; `salvYield` grew) |
| `buy` | false | `{ m, n }`, m ∈ iron coal damascus grit dust | `{ n, cost }` |
| `drink` (mana draught) | false | `{}` | `{ mana, p }` |
| `unlock` | false | `{ k }` | `{ n }` |
| `renown` (Advertising) | false | `{}` | `{ level, cost }` |
| `shelfList` | false | `{ id }` (a `k` from an old client is ignored) | `{ price, until }` |
| `shelfCancel` | false | `{ id }` | `{}` |
| `polishStart` | false | `{ id, liq }` | `{ seed, stone, liq }` |
| `polishEnd` | **true** | `{ samples }` | `{ polish, name, clean, finish, s, before, after, xp: { smith } }` |
| `enchantStart` | false | `{ id, rune, con }` | `{ win, tol }` |
| `enchantEnd` | **true** | `{ strokes, tEnd }` | `{ res, rune, score, before, after }`, plus `xp: { ench }` when a rune took |
| `forgeEnd`, `quickForge` | **true** | as before | `{ blade, xp: { smith } }` (day labour: unchanged, no XP) |
| `eat` / `drink` | false | as before | limits are now `fuelCap(c)` / `manaCap(c)` instead of `ENERGY_CAP` / `MANA_CAP` |

```js
// ---- selling: the scrap merchant pays 40% at once
def('sell', false, (ctx, a) => {
  const { c } = ctx, ids = idList(a.ids); let coin = 0, n = 0;
  for (const id of ids) {
    const b = bladeById(c, id); if (!b || b.status !== 'owned' || b.cracked || isGift(b)) continue;
    const v = scrapPrice(b); c.coin += v; b.status = 'sold'; b.su = ctx.now;
    chEvent(ctx, { k: 'sell', b, coin: v }); coin += v; n++;
  }
  need(n, ids.length === 1 ? 'That blade can’t be sold.' : 'Nothing to sell.');
  ctx.out = { coin, n };
});
def('buy', false, (ctx, a) => {
  const { c } = ctx, m = String(a.m); need(['iron', 'coal', 'damascus', 'grit', 'dust'].includes(m), 'That isn’t for sale.');
  const n = intArg(a.n, 1, 99999), cost = PRICES[m] * n; need(c.coin >= cost, 'Not enough coin.');
  c.coin -= cost; c[m] = (c[m] || 0) + n; ctx.out = { n, cost };
});
def('drink', false, (ctx) => {
  const { c } = ctx, day = localDay(ctx.now, ctx.tz), p = draughtPrice(c, day);
  need(c.mana + DRAUGHT.mana <= manaCap(c), 'Your mana is as full as a draught can make it.');
  need(c.coin >= p, 'Not enough coin.');
  c.coin -= p; c.mana += DRAUGHT.mana;
  if (!c.draughts || c.draughts.d !== day) c.draughts = { d: day, n: 0 }; c.draughts.n++;
  ctx.out = { mana: DRAUGHT.mana, p };
});
// ---- the Workshop and the shop: one action buys anything in UNLOCKS
def('unlock', false, (ctx, a) => {
  const { S, c } = ctx, k = String(a.k), u = Object.prototype.hasOwnProperty.call(UNLOCKS, k) ? UNLOCKS[k] : null;
  need(u, 'There is no such thing to buy.');
  need(!owns(c, k), 'You already have that.');
  if (u.after) need(owns(c, u.after), `First get the ${UNLOCKS[u.after].n}.`);
  if (u.tier) { const prev = tierPrev(k); need((c[u.tier[0]] || 0) === u.tier[1] - 1, prev ? `First get the ${prev.n}.` : 'Not yet.'); }
  need(reqMet(S, c, u), `First: ${u.rt}.`);
  need(canPay(c, u.cost), `That costs ${costStr(u.cost)}.`);
  payCost(c, u.cost);
  if (u.tier) c[u.tier[0]] = u.tier[1]; else { c.recipes = c.recipes || {}; c.recipes[k] = true; }
  ctx.out = { n: u.n };
});
def('renown', false, (ctx) => {
  const { c } = ctx, cost = renownCost(c);
  need(c.shelves >= SHELF_MAX, `Advertising opens once your shop has ${SHELF_MAX} shelves.`);
  need(c.coin >= cost, `The next round of advertising costs ${fmtN(cost)}c.`);
  c.coin -= cost; c.renown = (c.renown || 0) + 1;
  ctx.out = { level: c.renown, cost };
});
// ---- shop shelves: the price is fixed now, the blade sells by the clock (settleShop in beginAction)
def('shelfList', false, (ctx, a) => {
  const { c } = ctx, b = bladeById(c, a.id);        // a.k (the old Short/Medium/Long) is ignored
  need(b && b.status === 'owned', 'That blade isn’t on your rack.');
  need(!b.cracked, 'Nobody buys a cracked blade. Salvage it instead.');
  need(!isGift(b), 'Keepsakes can’t be sold.');
  need(!b.keep, 'That blade is locked. Unlock it first.');
  need(shelfCount(c) < c.shelves, `All ${c.shelves} shelves are full.`);
  const price = shelfPrice(c, b), full = shelfTime(c, b), ms = ctx.test ? Math.round(full / SHELF_TEST_DIV) : full;
  b.status = 'shelf'; b.shelf = { at: ctx.now, until: ctx.now + ms, price };
  ctx.out = { price, until: b.shelf.until };
});
def('shelfCancel', false, (ctx, a) => {
  const b = bladeById(ctx.c, a.id); need(b && b.status === 'shelf', 'That blade isn’t on a shelf any more.');
  b.status = 'owned'; delete b.shelf;
});
// ---- polishing: start (pay the grit), then end (score the strokes, roll the polish)
def('polishStart', false, (ctx, a) => {
  const { S, c } = ctx, b = bladeById(c, a.id), liq = String(a.liq || 'spring');
  need(knows(c, 'polish'), 'Build a polishing bench in the Workshop first.');
  need(b && b.status === 'owned' && !isGift(b), 'Pick a blade from your rack.');
  need(!b.cracked, 'A cracked blade can’t be polished.');
  need(!b.polish, 'That blade has already been polished.');
  need(Object.prototype.hasOwnProperty.call(LIQUIDS, liq) && knows(c, liq), 'Learn that liquid in the Workshop first.');
  const g = GRIT_PER[TYPES[b.type].wt];
  need((c.grit || 0) >= g, `You need ${g} grit. Buy it at the Market.`);
  c.grit -= g;
  // the seed doesn't depend on the clock, so the game's prediction and the server agree on the grime
  S.polish = { id: b.id, stone: c.stone || 0, liq, seed: hash32(`${c.cid}:${b.id}:polish`), t0: ctx.now };
  ctx.out = { seed: S.polish.seed, stone: S.polish.stone, liq };
});
def('polishEnd', true, (ctx, a) => {
  const { S, c } = ctx, P = S.polish;
  need(P, 'You aren’t polishing anything. Start again.');
  const b = bladeById(c, P.id);
  need(b && b.status === 'owned' && !b.cracked && !b.polish, 'That blade isn’t on your rack any more.');
  const x = Array.isArray(a.samples) ? a.samples : null;
  need(x && x.length <= POLISH.MAX_TICKS + 1 && x.every((v) => Number.isInteger(v) && v >= -1 && v <= 1000), 'That polish doesn’t add up. Start again.');
  need(ctx.now - P.t0 >= x.length * POLISH.TICK - POLISH.SLACK, 'That was quicker than any stone. Start again.');
  S.polish = null;
  const before = value(b), r = polishScore(P.seed, x, P.liq), roll = rollPolish(r.s, P.stone, P.liq, ctx.rng);
  b.polish = { q: roll.q, m: roll.m, s: Math.round(r.s * 100) / 100, stone: P.stone, liq: P.liq };
  if (roll.mirror) b.polish.mirror = 1;
  if (roll.stain) b.polish.stain = 1;
  c.stat = c.stat || { ...STAT0 }; c.stat.pol++; if (r.s >= .7) c.stat.pgood++;
  chEvent(ctx, { k: 'polish', b });
  ctx.out = { polish: b.polish, name: polishName(b.polish), clean: r.clean, finish: r.finish, s: r.s, before, after: value(b) };
});
// ---- enchanting: start (pay the mana at the first touch), then end (score the strokes, roll the dice)
def('enchantStart', false, (ctx, a) => {
  const { S, c } = ctx, b = bladeById(c, a.id), rune = String(a.rune || ''), con = String(a.con || 'copper');
  need(knows(c, 'enchant'), 'Build an enchanter’s table in the Workshop first.');
  need(b && b.status === 'owned' && !b.cracked && !isGift(b), 'That blade isn’t on your rack.');
  need(b.polish, 'Polish the blade before you carve a rune into it.');
  need(Object.prototype.hasOwnProperty.call(RUNES, rune) && knows(c, rune), 'Learn that rune first.');
  need(Object.prototype.hasOwnProperty.call(CONDUITS, con) && knows(c, con), 'You don’t have that conduit.');
  const runes = b.runes || [], CH = CHISELS[c.chisel || 0];
  need(runes.length < CH.slots, `Your ${CH.n} can’t fit another rune on this blade.`);
  need(!runes.some((r) => r.k === rune), 'That rune is already on this blade.');
  need(c.mana >= RUNES[rune].mana, `${RUNES[rune].n} takes ${RUNES[rune].mana} mana. Mana refills with time.`);
  c.mana -= RUNES[rune].mana;
  S.enchant = { id: b.id, rune, con, chisel: c.chisel || 0, tol: CH.tol, win: runeWindow(rune, con), t0: ctx.now };
  ctx.out = { win: S.enchant.win, tol: CH.tol };
});
def('enchantEnd', true, (ctx, a) => {
  const { S, c } = ctx, E = S.enchant;
  need(E && RUNES[E.rune], 'The carving has gone dark. Start again.');
  const b = bladeById(c, E.id);
  need(b && b.status === 'owned' && !b.cracked, 'That blade has left your rack.');
  need(!(b.runes || []).some((r) => r.k === E.rune) && (b.runes || []).length < CHISELS[E.chisel].slots, 'That blade has no room for this rune.');
  const tEnd = a.tEnd;
  need(Number.isInteger(tEnd) && tEnd >= 1 && tEnd <= RUNE_MAX_MS, 'That carving doesn’t add up. Try again.');
  const strokes = cleanStrokes(a.strokes, tEnd);
  need(strokes, 'That carving doesn’t add up. Try again.');
  // the server's clock is the referee: the carving took at least as long as the server saw, minus a grace for the
  // network. A game clock that ran slow gets its points spread back out over the real time.
  const real = Math.max(tEnd, ctx.now - E.t0 - RUNE_GRACE_MS), k = real / tEnd;
  const fair = k === 1 ? strokes : strokes.map((s) => s.map(([x, y, t]) => [x, y, t * k]));
  const sc = runeScore(E.rune, fair, { tol: E.tol, win: E.win, tEnd: real });
  S.enchant = null;
  const before = value(b), r = rollRune(sc.q, E.rune, E.con, E.chisel, ctx.rng);
  if (r.rune) { b.runes = b.runes || []; b.runes.push(r.rune); }
  if (r.res === 'set' || r.res === 'resonant') {
    const st = c.stat = c.stat || { ...STAT0 }; st.runes++; if (sc.q >= .7) st.r70++; if (sc.q >= .8) st.r80++; if (sc.q >= .9) st.r90++;
    chEvent(ctx, { k: 'rune', b });
  }
  ctx.out = { res: r.res, rune: r.rune, score: sc, before, after: value(b) };
});
```

`res` is one of `'set'`, `'resonant'`, `'backlash'` (a scar was added), `'fizzle'` (nothing added).

---

## 5. Running actions, the save, exports

### 5.1 beginAction

```js
function beginAction(S, env) {
  const ctx = { S, now: env.now, rng: env.rng, tz: env.tz, test: !!env.test, online: !!env.online, user: env.user || null, notes: [], out: {} };
  ctx.c = smithOf(S);
  if (ctx.c) {
    tickFuel(ctx.c, ctx.now); tickMana(ctx.c, ctx.now);
    const sold = settleShop(ctx.c, ctx.now);
    if (sold.length) {
      let coin = 0; for (const b of sold) { coin += b.shelf.price; chEvent(ctx, { k: 'sell', b, coin: b.shelf.price }); }
      note(ctx, `Your shop sold ${sold.length === 1 ? 'the ' + bname(sold[0]) : sold.length + ' blades'} for **${fmtN(coin)}c**.`, 4000);
    }
  }
  return ctx;
}
```

`afterAction` is unchanged.

### 5.2 upgradeSave (inside `if (c) { … }`)

- `c.xp = { smith, ench }`, each a whole number ≥ 0 (missing = 0). Do this first: the mana limits below depend on it.
- Non-negative numbers: add `'grit'` to the list; `if (typeof c.mana !== 'number' || !isFinite(c.mana)) c.mana = manaMax(c); c.mana = clamp(c.mana, 0, manaCap(c));`
- `c.stone = clamp(Math.floor(num(c.stone)), 0, STONES.length - 1); c.chisel = clamp(Math.floor(num(c.chisel)), 0, CHISELS.length - 1);`
- `c.shelves = clamp(Math.floor(num(c.shelves)) || SHELF_START, SHELF_START, SHELF_MAX); c.renown = Math.max(0, Math.floor(num(c.renown)));`
- `const st = c.stat && typeof c.stat === 'object' ? c.stat : {}; c.stat = {}; for (const k of Object.keys(STAT0)) c.stat[k] = Math.max(0, Math.floor(num(st[k])));`
- `if (!c.manaTs) c.manaTs = now;`
- Delete `c.cls, c.classes, c.selBy, c.freeWar, c.demand, c.demandTs` (and remove the old `CLASSES[c.cls]` and demand lines).
- A blade with status `'shelf'` but no `b.shelf` becomes `'owned'`.

It must stay idempotent (running it twice changes nothing the second time).

### 5.3 Exports (`G.AMR`)

Add: `SCRAP, SHELF, SHELF_START, SHELF_MAX, SHELF_TEST_DIV, RENOWN_STEP, RENOWN_PER, GRIT_PER, MANA_MAX, MANA_MS, MANA_CAP,
DRAUGHT, COMM_POLISH, COMM_RUNE, COMM_RUNE_K, COMM_RUNE_Q, POLISH, STONES, LIQUIDS, MIRROR_M, STAIN_M, PERFECT_POLISH,
CHISELS, CONDUITS, RUNES, RUNE_KEYS, RUNE_STEP, RUNE_MAX_PTS, RUNE_MAX_STROKES, RUNE_MAX_MS, RUNE_FIZZLE, RUNE_FULL_SPARE,
RUNE_GRACE_MS, RUNE_SLOT_W, RESONANT, UNLOCKS, UNLOCK_KEYS, STAT0, ADVERT,`
`LV_BASE, LV_POW, SMITH_MAX_LV, ENCH_MAX_LV, LV_FUEL, LV_MANA, MEAL_ROOM, DRAUGHT_ROOM, XP_LEVELS, FORGE_XP, CRACK_XP, POLISH_XP,
MIRROR_XP, ENCH_RAR_XP, RESONANT_XP, levelOf, smithLevel, enchLevel, fuelMax, manaMax, fuelCap, manaCap, forgeXp, polishXp, runeXp, gainXp,`
`forgeWorth, polishMult, enchantMult, scrapPrice, shelfPrice, shelfTime, shelfMs, renownCost, tickMana, draughtsToday, draughtPrice, settleShop,
shelfCount, polishInit, polishFx, polishTick, polishLimit, polishStrip, polishResult, polishScore, polishCurve, polishName,
rollPolish, runeWindow, nearCredit, runeScore, cleanStrokes, rollRune, runeSlots, owns, tierPrev`.

Keep: everything else already exported (`value` and `worth` now mean the new worth; extra arguments are ignored).

Remove: `MERCHANT, TRADER, CLASS_COST, SLOT_PCT, RECIPES, clsN, settleDemand, clamorType, DEM_WIN, classOffer, slotsOpen`.

Then run `node tools/sync-rules.mjs`.

---

## 6. Prediction notes (why this works with the server)

- `polishStart`, `enchantStart`, `shelfList`, `unlock`, `drink`, `sell` are predicted: the game sees the result at once.
- The polish **seed** is `hash32(cid:id:polish)`, not time-based, so the predicted `S.polish.seed` equals the server's.
- `t0` differs between game and server by the network delay; the server only ever uses its own `t0`, with slack
  (`POLISH.SLACK` 1.5 s, `RUNE_GRACE_MS` 3 s).
- `enchantStart` is sent at the **first touch**, not when the plate opens, so time spent studying the guide doesn't count.
- Shelf sales settle in `beginAction` on both sides. The game also calls `AMR.settleShop(C(), nowS())` when it rebuilds,
  so coin appears on time with no server call; the server repeats it on the next action.

---

## 7. Server (`supabase/functions/api/index.ts`, RULES implementer)

Only `cleanBlade` changes, so polished and enchanted blades keep their polish and runes through the Auction House and
the Arena. Add before `o.forger = …`:

```ts
  if (b.polish && typeof b.polish === 'object') {
    const p = b.polish; o.polish = { q: Math.round(num(p.q, 0, 100)), m: Math.round(num(p.m, 0.8, 2.5) * 100) / 100, s: Math.round(num(p.s, 0, 1) * 100) / 100,
      stone: Math.round(num(p.stone, 0, 4)), liq: R.LIQUIDS[p.liq] ? p.liq : 'spring' };
    if (p.mirror) o.polish.mirror = 1; if (p.stain) o.polish.stain = 1;
  }
  if (Array.isArray(b.runes)) o.runes = b.runes.filter((r) => r && (r.k === 'scar' || R.RUNES[r.k])).slice(0, 3)
    .map((r) => { const x: any = { k: r.k, q: Math.round(num(r.q, 0, 1) * 1000) / 1000, p: Math.round(num(r.p, 0, 4) * 1000) / 1000 }; if (r.r) x.r = 1; return x; });
```

Arena power stays as it is (it ignores polish and runes). Nothing else in the server needs to change: `/api/act` runs
any action in `R.ACTIONS`.

---

## 8. The UI contract: PolishUI and EnchantUI

### 8.1 Loading, containers, look

- `index.html` loads, in this order: `js/rules.js`, `js/polish.js`, `js/enchant.js`, then its own script. Both new files
  are plain scripts (no modules) that set `window.PolishUI` / `window.EnchantUI` and read `window.AMR` **at call time**.
- The caller (index.html) shows a full-screen overlay and passes an **empty `<div>`** inside it. The UI fills the div,
  sizes itself to the div's width (≥ 300 px, at most about 720 px for polish, 380 px for the enchant plate), and leaves
  the div **empty** when its promise settles. It never touches anything outside the div, never calls `act`, never
  changes the save.
- Styles: inject one `<style id="pui-css">` / `<style id="eui-css">` on first use, every class prefixed `pui-` / `eui-`.
  Use the game's CSS variables: `--iron --plate --plate2 --rule --ash --mute --dim --straw --bronze --verd --red` and the
  fonts `var(--body)` and `var(--display)`. Canvases use `image-rendering: pixelated`, `touch-action: none`,
  `user-select: none`, `-webkit-touch-callout: none`. Respect `prefers-reduced-motion` (no flashes or shakes).
- Sound: optional callback `o.sfx(event, value)`; the UI calls it and never makes sound itself. index.html maps events
  onto its `SFX`. Unknown events are ignored by index.html.
- Only one of the two UIs is open at a time.

### 8.2 The blade picture

`o.img` is a **data URL** of the blade's pixel sprite as drawn on the rack: **horizontal, grip on the left, point on
the right**, transparent background (from index.html's `PX` renderer, see 9.6). It may be `null` (pixel art turned off):
then draw a plain grey steel bar. The picture is decoration only; scoring never depends on it.

### 8.3 PolishUI

```js
window.PolishUI = {
  // Runs the mini-game. Resolves { samples } when the player finishes, or null if they cancel.
  open(el, o) -> Promise<{ samples: number[] } | null>,
  // Shows the server's answer (polishEnd's ctx.out) in the same div with a "Continue" button. Resolves on Continue.
  showResult(el, out) -> Promise<void>,
  // Ends whatever is open: a pending open() resolves null, a pending showResult() resolves. Empties the div.
  close() -> void,
};
// o = { img: string|null, seed: number, liq: 'spring'|'camellia'|'acid', stone: 0..4, title?: string, sfx?: (event, value) => void }
// sfx events: 'rub' (speed in tracks/s, 0 when lifted; every tick), 'scrape' (over 0..1), 'clean' (a strip came clean), 'done'
// out = { polish: {q, m, s, stone, liq, mirror?, stain?}, name, clean, finish, s, before, after }
```

**Coordinates.** One canvas, full width of the div, about 140 px tall on phones and 180 px on desktop. The **track** is
0..1000 across the canvas's **whole width**: `x = clamp(round((clientX − rect.left) / rect.width × 1000), 0, 1000)` with
`rect = canvas.getBoundingClientRect()`. The **steel** runs from track 50 to 950 (`AMR.POLISH.A`..`B`): draw the sprite
stretched over that span (5% to 95% of the width). Up-and-down movement is ignored. Use pointer events with
`setPointerCapture` (one pointer id only), so the stone keeps moving (clamped) when the pointer leaves the canvas.

**Samples.** The timer starts at the first `pointerdown` on the canvas (before that, a "Press and rub" hint). From then
on, every 50 ms (`AMR.POLISH.TICK`), driven by `requestAnimationFrame` with a time accumulator (a 120 ms frame writes two
samples), push one whole number: the stone's track position, or **-1** while the pointer is up. The first sample is the
position at the first press. At most `AMR.POLISH.MAX_TICKS + 1` = 401 samples. After each push, update the live state
with exactly the scoring code: `st = AMR.polishInit(o.seed)` once, `fx = AMR.polishFx(o.liq)`, then
`over = AMR.polishTick(st, s[n-3] ?? -1, s[n-2], s[n-1], fx)` for n ≥ 2. Draw the grime from `st.t / st.t0`, scratches
from `st.scr`, "Clean NN%" from `AMR.polishResult(st).clean`, and the speed meter's green band from
`AMR.polishLimit(st, AMR.polishStrip(x))`.

**End.** When 401 samples are written, the player presses **Done** (or Space), or every strip is clean
(`AMR.polishResult(st).clean >= 1`): resolve `{ samples }`. **Cancel** (or Escape, or `close()`) resolves `null`. If
the tab is hidden, keep writing `-1` samples on return for the time that passed (the accumulator does this) up to the
limit.

**Look** (from 02 section 8, minus buffing tools): dithered grime over the sprite clearing pixel by pixel, rust spots
darker, thin bright scratch lines, the stone as a small block coloured `AMR.STONES[o.stone].c` turning orange/red with
`over`, droplets in `AMR.LIQUIDS[o.liq].c`, a time bar, "Clean NN%", "Scratches N", a speed meter (0..2.5 tracks/s: grey
below 0.4, green up to the limit, red above). `showResult`: "Clean 96% · Finish 100% · Skill 0.88", then a bar filling to
`q`, the name (`out.name`), "Worth ×1.48: 53c → 78c" (`out.polish.m`, `out.before`, `out.after`); Mirror: a white glint
sweep and sparkles; Stained: a brown blotch, the new worth in red.

### 8.4 EnchantUI

```js
window.EnchantUI = {
  // Shows the plate with the rune's guide. Resolves { strokes, tEnd } once the carving has started and ended,
  // or null if it never started (cancelled before the first touch, or o.start() returned false).
  open(el, o) -> Promise<{ strokes: number[][][], tEnd: number } | null>,
  // Shows the server's answer (enchantEnd's ctx.out) with a "Continue" button. Resolves on Continue.
  showResult(el, out) -> Promise<void>,
  close() -> void,   // as PolishUI.close(); after the start, close() resolves the strokes so far (like Abandon)
};
// o = { img: string|null, rune: key of AMR.RUNES, con: key of AMR.CONDUITS, tol: number, win: number (ms),
//       start: () => boolean, title?: string, sfx?: (event, value) => void }
// sfx events: 'chisel' (carving speed 0..1, about every 60 units of line), 'manaLow' (twice a second below 20%), 'set'
// out = { res: 'set'|'resonant'|'backlash'|'fizzle', rune: {k, q, p, r?}|null, score: {acc, done, spare, charge, q}, before, after }
```

**Plate coordinates.** A **square** canvas (`width: min(88vw, 360px); aspect-ratio: 1`). Plate units are 0..1000 on both
axes over the canvas's whole box, **x to the right, y down, the blade's point at the top**:
`x = clamp(round((clientX − rect.left) / rect.width × 1000), 0, 1000)`, `y = clamp(round((clientY − rect.top) / rect.height × 1000), 0, 1000)`.
Draw a steel band behind the guide from x 150 to 850 (full height), and the sprite rotated −90° (point up) centred on
it as decoration. Draw the guide `AMR.RUNES[o.rune].s` at those coordinates (scale = canvas pixels / 1000) as a faint
dotted line in `RUNES[o.rune].glow`; covered parts brighten.

**Start.** Nothing drains until the first `pointerdown` on the plate. At that moment call `o.start()` **synchronously**:
if it returns false, resolve `null` at once. Otherwise set `t0 = performance.now()` and start the mana bar (length
`o.win` ms, colour `AMR.CONDUITS[o.con].c`, a notch at 40% "full charge", pulsing below 20%).

**Strokes.** One stroke per pointer down … up (one pointer id only; `getCoalescedEvents()` where available). Each point
is `[x, y, t]`, all whole numbers, `t = round(performance.now() − t0)`, never decreasing across the whole carving. Keep a
point only when it is **≥ 10 units** from the stroke's last kept point, plus the point where the pointer lifts. Drop
strokes with fewer than 2 points. Limits: **12 strokes, 400 points**.

**End.** The carving ends on **Set the rune**, when `performance.now() − t0 ≥ o.win`, at 400 points, or when a 13th
stroke would begin. Then `tEnd = max(1, min(o.win, round(performance.now() − t0)))`; clamp every point's `t` to `tEnd`;
resolve `{ strokes, tEnd }`. **Abandon** after the start resolves `{ strokes: [], tEnd }` (the server fizzles it; the
mana is spent). Before the start, Abandon resolves `null` (nothing spent). If the tab was hidden past the window, end at
once on return.

**Live readout.** About 10 times a second and on every lift:
`AMR.runeScore(o.rune, strokesSoFar, { tol: o.tol, win: o.win, tEnd: elapsed })` → "Rune strength NN%" (`q`) and
"Lines NN% · Done NN%" (`acc`, `done`). Ink near the guide (`AMR.nearCredit(d, o.tol) > 0.5`) glows in the rune colour,
ink off it is a grey scratch.

**showResult**: the groove fills with light (0.6 s), then: set "Ember set: strength 84% · Worth ×1.29: 120c → 155c";
resonant: a rainbow-white shimmer and "Resonant!"; backlash: a red flash, a jagged scar, "Backlash! The rune shattered
and scarred the blade."; fizzle: the glow fades, "The rune didn't take hold. The mana is spent."

---

## 9. The client (`www/index.html`, `www/sw.js`, SHOP/CLIENT implementer)

### 9.1 Remove

- The class system: `classOffer`, `switchClass`, `learnClass`, `slotsOpen`, class cards on the Account page, the "learn a
  new class" toast, anything reading `c.cls`, `c.classes`, `c.selBy`, `c.freeWar`. `rebuild()` must not reset `nc.sel`
  by class: keep `nc.sel` if `AMR.forgeable(nc, nc.sel) && knows(nc, TYPES[nc.sel].wt)`, else the first such type.
- Merchant demand: the `value(b, dem, mult)` wrapper becomes `const value = (b) => AMR.value(b)`; remove demand displays,
  the clamour interval and `AMR.settleDemand` calls. Remove `MERCHANT`, `TRADER` from the destructuring at the top.
- Commission imports (`q.imp`).
- `RECIPES`, the `learn` and `anvil` handlers: every Workshop purchase is `actSync('unlock', { k })`.

### 9.2 Forge picker

Show every type with `AMR.forgeable(c, k) && knows(c, TYPES[k].wt)`, grouped by style (War, Shadow, Arcane, Sanctum
headers, `CLASSES[s].n`), then by weight. Unknown styles show as a locked row: "Shadow style: Workshop".

### 9.3 Workshop: four tabs

**Forge**, **Polish**, **Enchant**, **Shop**. Each lists `UNLOCK_KEYS` whose `tree` matches, in table order. A row:
name, `d`, cost (`costStr(u.cost)`), its requirement with progress (`AMR.reqProgress(A, c, u.req)` / `u.need`), and a
button: Owned (`AMR.owns`), Locked ("Needs the X" when `u.after` or the previous tier is missing), or Buy (disabled
unless `canPay` and `reqMet`). Buy → `actSync('unlock', { k })`, toast `${out.n} bought.`. Hide the Polish and Enchant
trees' rows (except their gate row) until the gate is owned. The Forge tab keeps today's hammer rows (hammer, equip,
repair). The Shop tab adds an **Advertising** row (`AMR.ADVERT.n`, `AMR.ADVERT.d`: flyers and notices around town) once `c.shelves >= AMR.SHELF_MAX`: level, "+N% on shelf sales", next cost
`AMR.renownCost(c)`, button → `actSync('renown')`. Polish tab also shows the current stone; Enchant tab the current
chisel, the conduits and runes owned.

### 9.4 Shop page (new tab "Shop", next to the Rack)

- `c.shelves` slots. A filled slot (blade with `status === 'shelf'`): sprite, name, price `b.shelf.price`,
  time left `b.shelf.until − nowS()` counting down, **Cancel** → `actSync('shelfCancel', { id })`.
- An empty slot: **List a blade** → pick from the rack (owned, not cracked, not a keepsake, not locked). There is **no
  listing choice any more**: each blade shows one line, "Sells in 23 min · 575c" (`AMR.shelfTime(c, b)` and
  `AMR.shelfPrice(c, b)`; with `A.testOdds` show `Math.round(AMR.shelfTime(c, b) / AMR.SHELF_TEST_DIV)`), and one
  **List** button → `actSync('shelfList', { id })`. Sorting the picker by worth (dearest first) helps: dear blades earn
  the most per shelf-minute (04-balance section 6).
- Buy more slots links to the Workshop Shop tab.

**Client note (one-time change, Short/Medium/Long removed).** `AMR.SHELF` is now a single config object
`{ f, ms, ref, p, min, max }`, not three listings: any code that reads `SHELF.short`, `SHELF[k].n`, `SHELF[k].d`,
`SHELF[k].ms` or `SHELF[k].f` must go. Use `AMR.shelfTime(c, b)` (ms, real time) and `AMR.shelfPrice(c, b)` (a third
argument is still accepted and ignored). `shelfList` takes `{ id }`; an old client that still sends `k` keeps working
(the server ignores it). Listings already on a shelf keep their stored `price` and `until`, and may still carry an old
`b.shelf.k`: don't show it. Format the time with minutes under an hour ("23 min") and hours and minutes above
("1 h 16 min").

### 9.5 Rack, blade card and the forge reveal

For a blade on the rack, the actions are:

| Button | Shown when | Does |
|---|---|---|
| **Polish** | `knows(c,'polish') && !b.polish && !b.cracked && !isGift(b)` | the polish flow (9.6) |
| **Enchant** | `knows(c,'enchant') && b.polish && !b.cracked && (b.runes||[]).length < AMR.runeSlots(c)` | the enchant flow (9.7) |
| **Shelf · 23 min · 575c** (`AMR.shelfTime`, `AMR.shelfPrice`) | not cracked, not keepsake, not locked, a free slot | `actSync('shelfList', { id })` |
| **Scrap merchant · Nc** | not cracked, not keepsake | `actSync('sell', { ids: [id] })` (`AMR.scrapPrice(b)`) |
| **Salvage** | not keepsake | as today (show `yieldStr(AMR.salvYield(b))`) |

The forge reveal offers the same (Polish first once known). Bulk "sell" on the rack sells to the scrap merchant (rename
labels: "Scrap merchant"). Blade cards show the polish name (`AMR.polishName(b.polish)`, Mirror gets a sparkle badge)
and runes ("Runes: Dawn 92% (Resonant) · Ward 81% · scar"), and the worth `AMR.value(b)`. Records and Armory count
`'shelf'` blades like owned ones (`AMR.exists`).

### 9.6 The polish flow

```js
async function bladeImg(b) {   // the rack sprite as a data URL, or null
  try { const o = { noRuler: 1, minW: 0 }; await pxWarm(b, o); const r = PX.cache.get(PX.keyOf(b, o)); return r ? r.url : null; } catch (e) { return null; }
}
async function polishFlow(b) {
  // 1. a small panel first: pick a liquid (known ones, buttons like the quench buttons, with AMR.LIQUIDS[k].d),
  //    show the stone (AMR.STONES[c.stone].n) and "Uses N grit (you have M)". Start →
  const liq = chosenLiquid;
  const r = actSync('polishStart', { id: b.id, liq }); if (!r) return;
  const el = openCraftOverlay();                       // your overlay; returns the empty div
  const res = await PolishUI.open(el, { img: await bladeImg(b), seed: r.seed, liq: r.liq, stone: r.stone, title: bname(b), sfx: polishSfx });
  if (!res) { closeCraftOverlay(); toast('Polish abandoned. The grit is used up.'); render(); return; }
  const out = await act('polishEnd', { samples: res.samples }, { hold: true });
  if (!out) { closeCraftOverlay(); render(); return; }
  await PolishUI.showResult(el, out);
  closeCraftOverlay(); render();
}
```

### 9.7 The enchant flow

```js
async function enchantFlow(b) {
  // 1. the rune bench panel: rune cards (known runes not on this blade: glyph RUNES[k].g, name, mana, value v,
  //    carving time runeWindow(k, con)/1000 s), conduit buttons (known: CONDUITS[k].d), "Mana 12/20", the chisel
  //    and "Slot 2 of 3". Carve (disabled if c.mana < RUNES[k].mana; offer "Drink a draught (Nc)") →
  const c = C(), rune = chosenRune, con = chosenConduit;
  const el = openCraftOverlay();
  const res = await EnchantUI.open(el, { img: await bladeImg(b), rune, con, tol: AMR.CHISELS[c.chisel].tol, win: AMR.runeWindow(rune, con),
    title: bname(b), sfx: enchantSfx, start: () => !!actSync('enchantStart', { id: b.id, rune, con }) });
  if (!res) { closeCraftOverlay(); render(); return; }   // never started: nothing spent
  const out = await act('enchantEnd', { strokes: res.strokes, tEnd: res.tEnd }, { hold: true });
  if (!out) { closeCraftOverlay(); render(); return; }
  await EnchantUI.showResult(el, out);
  closeCraftOverlay(); render();
}
```

Closing the overlay any other way (back button, Escape) calls `PolishUI.close()` / `EnchantUI.close()`; the flows above
then continue with the `null` / partial result.

### 9.8 HUD, Market, clock

- HUD: show **grit** once `knows(c,'polish')`; show **Mana N/max** (`AMR.manaMax(c)`; "+1 in m:ss" when below it, from
  `c.manaTs` and `AMR.MANA_MS`) once `knows(c,'enchant')`. Energy likewise shows **N/max** with `AMR.fuelMax(c)`.
- Market: rows for **Grit** (5c), **Star-dust** (40c) using `buy`; **Mana draught** "+5 mana · Nc" (`AMR.draughtPrice(c, dayNow())`)
  → `actSync('drink')`, shown once enchanting is known.
- `rebuild()`: after replaying predictions, call `AMR.tickFuel(c, nowS()); AMR.tickMana(c, nowS()); AMR.settleShop(c, nowS());`
  (no `settleDemand`).
- The existing 5-second interval: run `AMR.settleShop(C(), nowS())` on `A`; if it returns blades, toast
  "Your shop sold …" and re-render the HUD/shop; also tick mana there. Remove the clamour and class toasts.
- Commission cards: show the polish request ("Polish 60+") and rune request ("Rune: Frost 50%+"); the deliver list uses
  `AMR.qualifies` as today.

### 9.9 Levels and Advertising (second pass)

- **Show levels.** Somewhere always visible (the HUD, or the Account/hall page plus a small badge in the HUD): "Smithing 4"
  with an XP bar `cur / next` from `AMR.smithLevel(c)`, and once enchanting is known "Enchanting 3" from
  `AMR.enchLevel(c)`. At the top level (`next === 0`) show "max". A tooltip can say what the next level gives
  ("Level 5: max energy 14", using `AMR.LV_FUEL` / `AMR.LV_MANA`).
- **Every energy and mana limit uses the functions:** HUD and Market "Energy N of max" → `AMR.fuelMax(c)`; meal buttons
  "Too full" → `c.fuel + m.e > AMR.fuelCap(c)`; mana bar and "Mana N/max" → `AMR.manaMax(c)`; the draught button
  → `AMR.manaCap(c)`; the Market note "Mana refills … up to N. Draughts can fill it to M" with those values. The old
  constants (`FUEL_MAX`, `ENERGY_CAP`, `MANA_MAX`, `MANA_CAP`) are only the level-1 values.
- `ctx.out.xp` (from `forgeEnd`, `quickForge`, `polishEnd`, `enchantEnd`) can be shown as "+14 Smithing XP" on the
  reveal or result; the level-up itself arrives as a note like any other.
- **Advertising:** every player-facing "Renown" becomes "Advertising" (Workshop Shop tab, shelf tooltips, the shop
  page header, the toast after buying: "Advertising level N. Shelf sales pay N% more."). The action key `renown`, the
  field `c.renown` and `AMR.renownCost` keep their names.

### 9.10 sw.js

`VERSION = 'anvilmoon-1.15.0-shop'`; add `'./js/polish.js', './js/enchant.js'` to `SHELL`.

---

## 10. Test checklists

### RULES (`npm test` must pass)

- [ ] `node tools/sync-rules.mjs` run; `npm test` green.
- [ ] Remove the demand test in `tests/rules.test.mjs`; fix `tests/server.test.mjs` (no `learn` → `unlock`, `sell` pays
      `scrapPrice`, no `demand`) and `tests/migrate.test.mjs` (old saves still load through `upgradeSave`).
- [ ] rules tests: every rune template sent as strokes (t increasing, `tEnd` = half the window) scores q = 1; an empty
      carving fizzles; a random scribble scores < 0.25; ink after the window doesn't count; `cleanStrokes` refuses
      non-integers, x > 1000, decreasing t, 13 strokes, 401 points.
- [ ] `polishScore` gives the same result twice; a jump list 0/1000/0… gives finish 0; `rollPolish` with a fixed rng is
      stable; a stained roll gives m 0.8, a Mirror m 2.5.
- [ ] `value` = forge worth × polish × enchant (check one blade by hand); `enchantMult` sorts by power.
- [ ] `settleShop`: a listing pays exactly once at `until`, not before; `tickMana` refills +1 per 2 min up to 20, not
      above 20 after a draught.
- [ ] Shelf time: `shelfMs(SHELF.ref) === SHELF.ms`, clamped to 2 min / 3 h, whole minutes, never shorter for a dearer
      blade, and coin per shelf-minute always higher for a dearer blade; `shelfList {id}` sets `until = now +
      shelfTime(c, b)` (÷ `SHELF_TEST_DIV` with test odds) and ignores an old `k`.
- [ ] `unlock`: buys in order (stone2 before stone1 refused), `after` and `req` refused with the right message, pays
      the cost; `owns` true afterwards.
- [ ] server tests: `polishStart` → `polishEnd` works and raises worth; polishing twice refused; a cracked blade refused;
      400 samples sent 1 s after start refused; bad samples refused. `enchantStart` needs a polished blade and the mana;
      a second identical rune refused; a 2nd rune refused with the Flint chisel; `enchantEnd` with strokes adds a rune
      (or scar/fizzle); halved timestamps are stretched (q drops). `shelfList` works, cancel returns the blade, full
      shelves refused (the sale itself is tested in the rules tests with a later `now`, since the server uses the real clock). AH listing of a polished blade keeps `polish` on the buyer's copy.
- [ ] Upgrading a save twice changes nothing; a patch still turns the old save into the new one.
- [ ] Levels: the XP table grows every level; hand and quick forges, polishes and runes that take give the right XP
      (`ctx.out.xp`), a fizzle gives none; a level-up notes it and raises `fuelMax` / `manaMax`; the clock refills to the
      new max but not past it; meals and draughts may go 20 above the new max.

### POLISH UI (`www/js/polish.js`)

- [ ] Loads with no errors on a page that has `AMR` (try it with a tiny scratch HTML page you don't commit, or
      `npm run dev` once index.html calls it).
- [ ] `open` resolves `{ samples }` with whole numbers −1..1000, at most 401, one per 50 ms after the first press; a slow
      frame writes several samples.
- [ ] The on-screen "Clean" equals `AMR.polishScore(seed, samples, liq).clean` for the returned samples.
- [ ] Done, Space, all-clean and the 20 s limit all end it; Cancel/Escape/`close()` resolve `null`; the div is empty
      afterwards; listeners are removed (open twice in a row works).
- [ ] Works with mouse, touch (no page scroll while rubbing) and at 320 px wide; `img: null` draws a plain bar.
- [ ] `showResult` handles normal, Mirror and Stained answers; reduced motion skips flashes.

### ENCHANT UI (`www/js/enchant.js`)

- [ ] Nothing drains and `o.start` isn't called until the first touch; `start` returning false resolves `null`.
- [ ] Points are whole numbers in 0..1000, t never decreases, ≥ 10 units apart, strokes of 1 point dropped, ≤ 12 strokes,
      ≤ 400 points, every t ≤ tEnd ≤ win; the result passes `AMR.cleanStrokes(strokes, tEnd)`.
- [ ] Tracing the guide carefully shows a strength close to what `AMR.runeScore` gives for the returned strokes.
- [ ] The window ends the carving; Set the rune ends it early; Abandon before start → `null`, after start →
      `{ strokes: [], tEnd ≥ 1 }`; `close()` likewise; the div is empty afterwards.
- [ ] Square plate on phones (no scroll or zoom while drawing), one pointer only; `img: null` works.
- [ ] `showResult` handles set, resonant, backlash and fizzle.

### SHOP/CLIENT (`www/index.html`, `www/sw.js`)

- [ ] `npm run dev`, new account: forge, list a blade with test odds on (a starting blade takes about 5 minutes, so
      about 15 s with test odds; it sells while the tab is open and while closed), cancel a listing, scrap-merchant
      sell, salvage.
- [ ] No console errors on any page (Forge, Rack, Shop, Workshop tabs, Market, Commissions, Armory, Records, Hall,
      Account, Arena, Auction House). No reference left to classes or demand.
- [ ] Workshop: buy Iron Anvil, Medium pattern, the bench (after 20 forges), a stone, a liquid; locked rows explain why.
- [ ] Polish a blade end to end (grit bought at the Market first); the result shows, the blade card shows the polish
      name and new worth; cancelling halfway keeps the blade unpolished and the grit spent.
- [ ] Enchant end to end (give yourself coin/requirements in DEV if needed); mana drops at the first touch; a draught
      refills; abandoning before touching costs nothing.
- [ ] HUD shows grit and mana; Market sells grit, star-dust and draughts; commission cards show polish/rune requests.
- [ ] `sw.js` version bumped and the two new files cached.
