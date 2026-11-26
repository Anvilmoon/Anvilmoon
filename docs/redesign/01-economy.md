# 01 Economy and progression

This document covers the overall loop, the resources, the value formula, the three unlock trees, selling,
commissions, market prices and pacing. Every number here was checked with the simulation
`tools/sim-economy.mjs` (plain Node, run `node tools/sim-economy.mjs`). The polishing mini-game (02) and the
enchanting mini-game (03) work inside the ranges set here.

Numbers marked **(changed)** differ from today's game. Numbers marked **(new)** don't exist yet. Anything not
mentioned stays as it is today (see `docs/analysis/game-mechanics.md`).

---

## The short version

- **One shop, no classes.** The 4 classes become 4 **styles** of blade (War, Shadow, Arcane, Sanctum). You
  can forge a blade when you know its **style** and its **weight** (Light/Medium/Heavy/Massive). You start
  with War style and Light weight: 7 blade types.
- **Every blade goes through the same line:** forge, then polish (optional, once), then enchant (optional,
  once, only after polishing), then sell.
- **Worth = forge worth × polish multiplier × enchant multiplier.** Polish: ×1.0 to ×2.5. Enchant: ×1.0 to
  ×4.85.
- **Three trees of unlocks** shaped like today's Workshop: Forge (anvils, quenches, hammers, patterns,
  styles), Polish (stones, liquids, wheels), Enchant (chisels, mana conduits, runes). Plus **shelf slots**.
- **Two new resources:** **grit** (bought at the market, used up by each polish) and **mana** (a meter that
  refills over time like energy, used up by each rune).
- **Selling:** scrap merchant (instant, 40% of worth), salvage (materials), or **put it on a shop shelf**:
  10 minutes for 80%, 1 hour for 100%, 8 hours for 125%. The price is fixed when you list it and the blade
  sells exactly when the time is up, worked out from the clock.
- **Pacing (typical player, 3 × 25 minutes a day):** polishing after about 23 minutes of play, enchanting
  after about 3 hours (day 3), the best anvil on day 17, the whole tree done around day 34.

---

## 1. The core loop

```
            buy iron + coal          buy grit              mana refills by itself
                  |                     |                         |
   Market --> FORGE a blade --> POLISH it (once) --> ENCHANT it (once) --> SELL it
                  |                                                      /    |     \
            energy (refills)                            scrap merchant   salvage   shop shelf
                                                        (instant, 40%)  (materials) (wait, 80-125%)
                                     commissions take any finished blade that fits an order
```

Polishing and enchanting **don't cost energy**. They are what the player does while energy refills, and they
make each blade worth much more, so a session turns into "finish fewer, better blades" over time. In the
simulation a fully finished Massive blade takes about 2.5 minutes of play, and energy stops being the limit
in the later game (see the pacing section).

### What happens to the classes and the 100 blades

| Today | In the redesign |
|---|---|
| 4 classes, each a "character" with its own 25 blades | 4 **styles**. Same 25 blades each, same art, same names. No characters. |
| Every smith starts as a Warsmith | Every smith starts knowing **War style** |
| Learn a 2nd/3rd/4th class on the Account page (Armory 5/15/30% + 150/600/2,000c) | Learn **Shadow, Arcane, Sanctum style** in the Forge tree (see section 4) |
| Switch class to forge its blades | No switching. The blade picker shows every type you know. |
| Weight patterns (Medium/Heavy/Massive) learned once | Same, and a weight pattern works for **every** style you know |
| Class variants (Iron/Bronze/Blackened...) rolled per blade | Unchanged: rolled from the blade's style. A rare variant still adds +1 to the value bonus. |
| Arcanesmith rune-circle forge visuals | Kept as the look of forging an Arcane-style blade (the `arc` flag), if 05 wants the work |
| Imports on the commission board (another class's blade, ×1.8) | Removed: there is no "other class" any more |
| Armory: 100 types × 6 goals, first-find rewards | Unchanged. It now also gates the styles. |
| "Chronicler" titles per class | Kept, renamed per style ("Find every Shadow blade") |

**So you can forge a blade type when you know its style and its weight.** With all 4 styles and all 4 weights
that is all 100 types. All styles are worth the same coin; a new style gives 25 new types to find (each first
find pays 20 × weight factor coin, about 1,200 coin per style if you find them all), more commission variety,
and the look the player likes.

---

## 2. Resources

| Resource | Key | Status | Source | Use |
|---|---|---|---|---|
| Coin | `coin` | keep | Selling, commissions, challenges, Armory | Everything |
| Energy | `fuel` | keep, unchanged | Refills 1 per 3 min up to 10; meals up to 30 | 1 per forge |
| Iron | `iron` | keep | Market 4c, salvage, day labour | Forging |
| Bog iron | `bog` | keep | Digging the slag heap when broke | Stands in for iron |
| Coal | `coal` | keep | Market 3c, labour, digging | Forging |
| Damascus | `damascus` | keep | Market 45c, salvage Masterwork+, Armory | Unlocks in all three trees |
| Star-dust | `dust` | keep, **can now be bought (40c)** | Salvage, Armory, enchanted-blade salvage, market | Refine 10 into 1 shard; Sun and Void runes use 1 each |
| Star-shards | `shards` | keep | Refining, Starforged salvage, Armory | Higher unlocks in all three trees |
| **Grit** | `grit` | **new** | Market 5c, salvaging a polished blade | Each polish: Light 1, Medium 1, Heavy 2, Massive 3 |
| **Mana** | `mana` | **new**, a meter | Refills over time (rate and maximum set by your conduit); mana draughts at the market | Each rune chiseled costs mana (5 to 18) |

### Why mana is a meter (and not something you buy, or a per-blade amount)

The owner's idea is that how much you can chisel depends on "how much mana they have". Three options were
considered:

| Option | For | Against |
|---|---|---|
| **Meter that refills, like energy** (chosen) | The player already understands energy. Conduits have an obvious job (bigger, faster meter). It paces enchanting without coin alone deciding it. The code is a copy of `tickFuel`. | One more meter on screen |
| Bought consumable only | Simple coin sink | Enchanting becomes pure "pay coin, get multiplier"; conduits have nothing to do |
| Per-blade capacity from the conduit | No meter | Nothing limits how many blades you enchant, so nothing to manage |

So: **mana refills by itself up to the conduit's maximum, and mana draughts (bought, like meals) can fill it to
twice the maximum.** The draught price rises 5% for each one bought today, exactly like meals, so draughts are a
growing coin sink that limits itself. In the simulation draughts are 15% of all coin spent by a typical player
and 34% for a keen one.

Grit is a plain consumable because a flat cost per polish creates the right small decision: polishing a
Light Common (worth ~10c) for 5c of grit isn't worth it; polishing anything better is.

---

## 3. The value formula

Today:

```
value = max(1, round(6 · WT.v · bonus · gradeMult · sizeMult · demand · mult))
```

New:

```
forgeWorth = max(1, round(6 · WT.v · bonus · gradeMult · sizeMult))     (today's value, demand removed)
polishMult = b.polish ? b.polish.m : 1
enchantMult = 1 + sum over b.runes of (RUNES[k].v · q)
worth       = max(1, round(forgeWorth · polishMult · enchantMult))      (cracked blades are still worth 1)
```

Everything that pays for a blade uses `worth`: shop shelves, the scrap merchant, Auction House deposits.

### Target ranges (02 and 03 design inside these)

| Multiplier | Bad roll / starting gear | Typical, mid game | Best gear, great skill | Absolute cap |
|---|---|---|---|---|
| polishMult `b.polish.m` | ×1.0 (botched) to ×1.2 | ×1.4 to ×1.7 | ×2.1 average in the late game | **×2.5** |
| enchantMult | ×1.2 (one Ember rune) | ×1.6 to ×2.0 (two runes of tier 2 or 3) | ×3.8 average in the late game | **×4.85** (Sun + Void + Storm, perfect) |
| Both together | ×1.2 | ×2.5 to ×3.5 | ×8 | ×12 |

### Polish multiplier (proposal for 02)

02 owns the mini-game and the exact roll. This is the formula the simulation used; any formula that keeps the
same range and cap is fine.

```
m = 1 + (stone.cap − 1 + liquid.bonus) · (q / 100) · roll       roll = random 0.8 to 1.2 (server)
m is kept between 1 and stone.cap + liquid.bonus
with chance liquid.risk the polish is "botched": m = 1 (the blade still counts as polished)
```

`q` (0 to 100) is the skill score from the mini-game. Examples: Sandstone + water, q 60: ×1.19 to ×1.29.
Starstone + Moon-silver, q 90: ×2.08 up to the ×2.5 cap.

### Enchant multiplier (proposal for 03)

Each rune has a value `v` (table in section 4). A blade can hold as many runes as the chisel's slots, **each
rune at most once per blade**. `q` (0 to 1) is the quality of each chiseled rune from the mini-game (accuracy,
speed and mana; 03 decides how).

Examples: one Ember at q 0.8 → ×1.2. Frost + Gale at q 0.75 → ×1.68. Sun + Void + Storm at q 0.85 → ×4.27; at
q 1.0 → ×4.85.

### Example blades

| Blade | Forge worth | + Sandstone polish (×1.25) | + late polish (×2.1) | + late enchant (×3.8) |
|---|---|---|---|---|
| Light Common Seax, grade 70 | 10c | 13c | 21c | 80c |
| Medium Fine Broadsword, grade 80 | 31c | 39c | 65c | 247c |
| Heavy Masterwork Claymore, grade 85 | 95c | 119c | 200c | 758c |
| Massive Masterwork Zweihänder, grade 90 | 148c | 185c | 311c | 1,181c |
| Massive Heirloom Zweihänder, grade 95, 130 cm | 373c | 466c | 783c | 2,977c |

**Why these ranges:** they are the owner's suggested ranges, and the sim shows they work: together they let
late-game income grow about 8× from the first hours, and the top unlock costs (section 4) were tuned to that
growth so the top tier takes days, not hours or months. The sim's average late multipliers (polish ×2.10,
enchant ×3.82) sit inside the caps, so luck and skill still matter at the top. **If 02 or 03 change the caps or
the typical results, re-run the sim and retune the top costs.**

---

## 4. The unlock trees

Each tree mirrors today's Workshop: a tier you buy in order (the "anvil"), a choice you make per attempt (the
"quench"), a tool that widens the sweet spot (the "hammer"), and things to learn (the "weapon types").

| Today's forge piece | Forge tree | Polish tree | Enchant tree |
|---|---|---|---|
| Anvil (bought in order, raises the odds) | Anvils | **Stones** (raise the polish cap) | **Chisels** (more rune slots, steadier runes) |
| Quench (pick one per forge, risk vs bonus) | Quenches | **Liquids** (pick one per polish, botch risk vs bonus) | **Mana conduits** (bigger, faster mana meter) |
| Hammer (wider sweet spot) | Hammers | **Wheels** (wider sweet spot) | (the chisel does this) |
| Weapon types (things to learn) | Weight patterns + styles | none | **Runes** |

Costs list coin first, then materials. "Req" is an extra requirement on top of the cost. Items in a tier must
be bought in order.

### Forge tree

| Node | Effect | Cost | Req |
|---|---|---|---|
| *Start* | Rough Anvil, Worn Hammer, oil quench, Light weight, War style | – | – |
| Iron Anvil | rarity table as today | 80c + 15 iron | – |
| Steel Anvil | as today | 400c + 30 iron + 4 damascus | – |
| Damascus Anvil | as today | **3,000c** (was 1,500) + 12 damascus + 2 shards | – |
| Dragonbone Anvil | as today | **40,000c** (was 5,000) + **40** damascus (was 30) + **10** shards (was 8) | – |
| Brine quench | as today | 100c | – |
| Water quench | as today | 400c | 10 blades of grade 70+ |
| Smith's Hammer | as today | 120c + 10 iron + 1 damascus | – |
| Master Hammer | as today | 900c + 6 damascus + 1 shard | – |
| Medium pattern | Medium blades of every style you know | 150c + 10 iron | – |
| Heavy pattern | Heavy blades | 600c + 3 damascus | deliver 5 commissions |
| Massive pattern | Massive blades | 2,000c + 8 damascus + 1 shard | forge a Masterwork or better |
| **Shadow style** (new) | the 25 Shadow blades (at the weights you know) | 300c | Armory: 10 blade types found |
| **Arcane style** (new) | the 25 Arcane blades | 1,200c | 25 types found |
| **Sanctum style** (new) | the 25 Sanctum blades | 4,000c | 45 types found |

The top two anvils cost more than today because income now grows about 8× through polishing and enchanting.

### Polish tree

Polishing as a whole opens with the **Polishing bench**.

| Node | Effect | Cost | Req |
|---|---|---|---|
| **Polishing bench** (gate) | Opens polishing. Comes with Sandstone, water and a hand cloth. | 300c | forged 20 blades, know the Medium pattern |
| Sandstone (stone 1) | polish cap ×1.40 | with the bench | – |
| Whetstone (stone 2) | cap ×1.60 | 300c + 2 damascus | – |
| Waterstone (stone 3) | cap ×1.80 | 1,200c + 6 damascus | – |
| Moonstone (stone 4) | cap ×2.00 | 6,000c + 15 damascus + 3 shards | – |
| Starstone (stone 5) | cap ×2.15 | 40,000c + 30 damascus + 10 shards | – |
| Water (liquid) | +0, never botches | with the bench | – |
| Oil (liquid) | +0.10, 3% botch | 150c | – |
| Rouge (liquid) | +0.20, 8% botch | 800c | polish 20 blades to quality 60+ |
| Moon-silver (liquid) | +0.35, 15% botch | 5,000c + 2 shards | polish 10 blades to quality 85+ |
| Hand cloth (wheel 0) | basic sweet spot | with the bench | – |
| Buffing wheel | wider sweet spot (the sim counts it as +6 quality) | 500c + 3 damascus | – |
| Master wheel | much wider (+12 quality) | 4,000c + 2 shards | Buffing wheel |

- **Cost per polish:** grit, Light 1, Medium 1, Heavy 2, Massive 3 (5c each).
- A liquid's bonus is added to the stone's cap and scaled by quality (see the formula in section 3), so the
  best combination reaches 2.15 + 0.35 = **×2.5**.
- Wheels don't wear out (unlike hammers). Fewer things to track.

### Enchant tree

Enchanting as a whole opens with the **Enchanter's table**. A blade must be polished before it can be enchanted.

| Node | Effect | Cost | Req |
|---|---|---|---|
| **Enchanter's table** (gate) | Opens enchanting. Comes with the Iron chisel, Copper conduit and the Ember rune. Mana starts full. | 1,200c + 5 damascus | polished 40 blades, own the Steel Anvil |
| Iron chisel (chisel 1) | 1 rune per blade | with the table | – |
| Steel chisel (chisel 2) | 2 runes per blade | 2,000c + 8 damascus | – |
| Silversteel chisel (chisel 3) | 2 runes, steadier (sim: +0.08 rune quality) | 8,000c + 20 damascus + 4 shards | – |
| Starsteel chisel (chisel 4) | 3 runes, steadier (+0.12) | 50,000c + 40 damascus + 12 shards | – |
| Copper conduit (conduit 1) | mana max 20, +1 every 90 s | with the table | – |
| Silver conduit (conduit 2) | max 35, +1 every 60 s | 1,500c + 4 damascus | – |
| Gold conduit (conduit 3) | max 55, +1 every 45 s | 6,000c + 12 damascus + 3 shards | – |
| Moonglass conduit (conduit 4) | max 80, +1 every 30 s | 40,000c + 30 damascus + 10 shards | – |

**Runes** (the "weapon types" of enchanting). Names are suggestions; 03 can rename them and give them shapes,
but please keep the tiers, values and costs or flag a change.

| Rune | Tier | Value `v` | Mana per chisel | Other cost per chisel | Learn cost | Req |
|---|---|---|---|---|---|---|
| Ember | 1 | 0.25 | 5 | – | with the table | – |
| Ward | 1 | 0.25 | 5 | – | 300c | – |
| Frost | 2 | 0.45 | 8 | – | 1,500c + 3 damascus | enchanted 10 blades |
| Gale | 2 | 0.45 | 8 | – | 1,500c + 3 damascus | enchanted 10 blades |
| Storm | 3 | 0.85 | 12 | – | 6,000c + 3 shards | enchanted 40 blades |
| Stone | 3 | 0.85 | 12 | – | 6,000c + 3 shards | enchanted 40 blades |
| Sun | 4 | 1.50 | 18 | 1 star-dust | 40,000c + 10 shards | enchanted 200 blades |
| Void | 4 | 1.50 | 18 | 1 star-dust | 40,000c + 10 shards | enchanted 200 blades |

- **Cost per rune:** its mana (and star-dust for Sun and Void). How much of the mana a rune actually needs, and
  what happens when the meter runs dry halfway, is 03's call; the server only needs to check the mana is there
  and take it.
- Two runes per tier so commissions can ask for a specific one and so the player has a choice that isn't just
  "the strongest".

### Shop shelves (a fourth, small progression)

| Slot | Cost |
|---|---|
| 1 to 3 | free (start) |
| 4 | 150c |
| 5 | 500c |
| 6 | 1,500c |
| 7 | 6,000c |
| 8 | 25,000c |

In the sim, slot 4 comes in the first 10 minutes, slot 5 after about 2 hours, slot 6 around hour 7, slot 7
around hour 16 and slot 8 is the last thing a typical player buys (around day 34).

---

## 5. Selling

Three ways, for every finished blade (forged, polished or enchanted). Keepsakes (gift blades) still can't be
sold, salvaged or listed.

### (a) The scrap merchant: instant, 40% of worth

`quickSell = max(1, round(worth · 0.40))`. One click, coin at once, any number of blades. It replaces today's
Sell button (75% × demand). It is the "I need coin now" or "my shelves are full" button.

**Merchant demand is removed** (recommended). The per-type demand map, the 0.93 drop per sale, the drift back and
the clamouring every 75 s all go (`c.demand`, `settleDemand`, `relaxDemand`, `clamorType`, `DEM_*`, `MERCHANT`).
Reasons: its job was to stop players dumping many copies of one blade on the merchant; the shelf now limits
selling (few slots, waiting time) and the scrap merchant pays too little to dump on. It is also a whole
clock-settled system (100 numbers per save) that would otherwise have to be kept working for little effect.

*Optional later, not in the first build:* **"In fashion"**: one style is in fashion in each 4-hour window (UTC),
picked from the window number with `hash32`, the same for everyone (like challenges). Blades of that style
listed during the window get ×1.15. One line of code, deterministic, no save field. The sim leaves it out.

### (b) Salvage it yourself

Today's salvage, plus something for the work put in:

| Blade | Salvage gives |
|---|---|
| Any (as today) | iron = round(WT.iron · len/100 · 0.6), plus Fine 1 coal, Masterwork 1 damascus, Heirloom 2 damascus + 1 dust, Legendary 3 damascus + 3 dust, Tempered +5 dust, Starforged 3 shards |
| Cracked (as today) | iron at 0.3, or 1 energy |
| **Polished** (new) | + 1 grit (Massive: + 2) |
| **Enchanted** (new) | + 1 star-dust for each rune of tier 2 or higher |

Sun and Void cost 1 star-dust and give 1 back on salvage, so salvage can never make dust out of nothing but mana.

### (c) List it on a shop shelf

| Listing | Sells after | Price |
|---|---|---|
| Short | 10 minutes | 80% of worth |
| Medium | 1 hour | 100% of worth |
| Long | 8 hours | 125% of worth |

Rules:

- One blade per shelf slot. Start with 3 slots, buy up to 8 (section 4).
- **The price is fixed when you list:** `price = round(worth · f)`. No randomness. The blade sells at exactly
  `listedAt + duration`.
- **Settled from the clock, on the server:** `beginAction` runs a new `settleShelf(c, now)` next to `tickFuel`:
  every shelf listing whose time is up becomes `sold` and its price is added to `coin`. Both the game and the
  server compute the same thing, so nothing needs uploading, and listings sell while the game is closed.
- **Cancel** any time before it sells: the blade goes back to the rack, nothing is paid or charged. (The price
  is fixed, so there is nothing to gain by cancelling and relisting.)
- A listed blade has status `shelf` (new, separate from the Auction House's `listed`). Records and the Armory
  should count `shelf` blades like `owned` ones.
- Challenges that count "sell" or "coins from selling" count both shelf sales (when they settle) and the scrap
  merchant.

**How the three choices feel in play** (from the sim): during a session the player lists Short to keep coin
coming; before a break of an hour or more they list Medium; before the night, Long. A typical player's blades
went 48% Short, 29% Medium, 15% Long, 5% commissions, 2% scrap merchant. Shelf slots are what limits sales in
the early game (forging is fast); in the late game finishing each blade takes long enough that 6 to 8 slots
keep up.

---

## 6. Commissions

Kept as today (3 orders on the board, pay, pin, lock, refresh for `10 · 2^locked` coin, Heavy pattern still
needs 5 deliveries), with these changes:

| | Rule |
|---|---|
| Blade type | Any type you can forge (a known style at a known weight). No imports. |
| Minimum rarity, size, grade | As today |
| **Polish request** (new) | Once polishing is open, 60% of new orders ask for a minimum polish quality: 40 (50% of those), 60 (35%) or 80 (15%). Pay × (1 + minQ/100): ×1.4, ×1.6, ×1.8. Once enchanting is open, **every** order asks for a polish. |
| **Rune request** (new) | Once enchanting is open, 50% of new orders also ask for one specific rune you know, chiseled at quality 0.5 or better. Pay × (1 + 2 · v): Ember/Ward ×1.5, Frost/Gale ×1.9, Storm/Stone ×2.7, Sun/Void ×4. |

Full pay formula:

```
pay = [15, 40, 100, 280][minR] · WT.v · (Large 1.6 | Huge 3 | 1) · (minGrade ? 1.3 : 1)
      · (minPolish ? 1 + minPolish/100 : 1) · (rune ? 1 + 2·RUNES[rune].v : 1)
```

Why every order asks for a polish once enchanting is open: commission pay is a posted fee, and blade worth
grows about 8× through the game. The polish and rune factors grow the fee in step, so a late order (say a
Masterwork Massive, polish 80, Sun rune: 100 × 4.5 × 1.8 × 4 = 3,240c) still beats selling the same blade
(about 1,200c). Without them commissions would be useless after the first few hours.

A blade fits an order when `b.polish.q >= minPolish` and some rune in `b.runes` has `k === rune && q >= 0.5`.

---

## 7. Market prices

| Item | Buy | Sell | Note |
|---|---|---|---|
| Iron | 4c | – | as today |
| Coal | 3c | – | as today |
| Damascus | 45c | 22c | as today |
| Star-shards | – | 100c | as today |
| **Star-dust** | **40c** (new) | – | So shards can be bought with coin (10 dust = 400c a shard). Selling a shard still gives only 100c, so there is no loop. |
| **Grit** | **5c** (new) | – | |
| **Mana draught** | **15c**, +5% for each one bought today (new) | – | +10 mana, up to 2 × the conduit's maximum. Same rule as meals; the count resets at local midnight. |
| Meals | as today | – | |
| Refine | 10 star-dust → 1 shard | | as today |

Buying star-dust is a change worth noting: today shards only come from luck (Starforged, Heirlooms, Armory).
With the higher top costs, luck alone would make the late game take wildly different times for different
players. Luck still saves you coin.

---

## 8. Pacing

### Targets

| Milestone | Target |
|---|---|
| Medium pattern, Iron Anvil | first 5 to 10 minutes |
| Polishing | first session (20 to 30 minutes of play) |
| Heavy pattern, Steel Anvil | 2nd hour |
| Enchanting | 2nd to 3rd hour of play |
| Massive pattern, Damascus Anvil | later the same few days (5 to 10 hours) |
| Top tier (Dragonbone, Starstone, Moonglass, Starsteel, Sun/Void) | over many days |

### Simulation results

`node tools/sim-economy.mjs --runs 300 --days 60` (typical player: 3 sessions of 25 minutes a day at 08:00,
13:00 and 20:00, so 75 minutes a day). Median of 300 players, with the spread between the luckiest/fastest 10%
and the slowest 10%.

| Unlock | Median play time | 10% .. 90% | Median day | Forges by then |
|---|---|---|---|---|
| Iron Anvil | 1 min | 1 .. 2 min | 1 | 2 |
| Medium pattern | 4 min | 3 .. 6 min | 1 | 6 |
| Shelf slot 4 | 7 min | 5 .. 11 min | 1 | 10 |
| Smith's Hammer | 14 min | 7 .. 36 min | 1 | 18 |
| **Polishing bench** | **23 min** | 17 .. 26 min | 1 | 30 |
| Oil liquid | 26 min | 23 .. 51 min | 1 | 35 |
| Whetstone | 51 min | 26 .. 77 min | 1 | 55 |
| Heavy pattern | 89 min | 53 .. 154 min | 2 | 82 |
| Steel Anvil | 102 min | 76 .. 129 min | 2 | 92 |
| Shadow style | 115 min | 77 .. 152 min | 2 | 99 |
| Shelf slot 5 | 127 min | 94 .. 155 min | 2 | 107 |
| Buffing wheel | 130 min | 103 .. 178 min | 2 | 115 |
| **Enchanter's table** | **177 min** | 129 .. 205 min | 3 | 139 |
| Water quench | 180 min | 146 .. 220 min | 3 | 145 |
| Waterstone | 3.6 h | 3.0 .. 4.3 h | 3 | 165 |
| Steel chisel | 4.6 h | 3.8 .. 5.2 h | 4 | 193 |
| Massive pattern | 5.4 h | 4.6 .. 6.3 h | 5 | 219 |
| Silver conduit | 5.8 h | 5.0 .. 6.7 h | 5 | 231 |
| Frost / Gale runes | 6.2 / 6.5 h | 5.2 .. 7.6 h | 5 / 6 | 242 / 253 |
| Rouge liquid | 6.9 h | 6.0 .. 7.8 h | 6 | 258 |
| Arcane style | 7.2 h | 6.1 .. 8.1 h | 6 | 266 |
| Shelf slot 6 | 7.4 h | 6.4 .. 8.4 h | 6 | 275 |
| Master Hammer | 7.8 h | 6.5 .. 8.6 h | 7 | 281 |
| Damascus Anvil | 8.6 h | 7.4 .. 9.5 h | 7 | 305 |
| Storm rune | 9.8 h | 8.6 .. 10.8 h | 8 | 340 |
| Gold conduit | 10.8 h | 9.6 .. 12.1 h | 9 | 369 |
| Moonstone | 12.0 h | 10.8 .. 13.4 h | 10 | 398 |
| Stone rune | 13.0 h | 11.7 .. 14.4 h | 11 | 424 |
| Silversteel chisel | 14.3 h | 12.9 .. 15.6 h | 12 | 458 |
| Master wheel | 14.8 h | 13.4 .. 16.4 h | 12 | 472 |
| Moon-silver liquid | 15.4 h | 14.0 .. 17.0 h | 12 | 488 |
| Sanctum style | 15.8 h | 14.4 .. 17.5 h | 13 | 500 |
| Shelf slot 7 | 16.5 h | 14.8 .. 18.1 h | 13 | 515 |
| **Dragonbone Anvil** | **21.2 h** | 19.5 .. 23.1 h | **17** | 637 |
| Starstone | 25.7 h | 23.9 .. 27.8 h | 20 | 759 |
| Moonglass conduit | 30.0 h | 27.9 .. 32.1 h | 24 | 870 |
| Starsteel chisel | 35.2 h | 32.9 .. 37.5 h | 27 | 1,005 |
| Sun rune | 39.1 h | 36.6 .. 41.8 h | 30 | 1,094 |
| Void rune | 42.0 h | 39.5 .. 45.0 h | 33 | 1,167 |
| **Shelf slot 8 (last)** | **43.7 h** | 41.0 .. 46.8 h | **34** | 1,207 |

The same unlocks by play time are almost identical for other kinds of players; the days differ:

| Profile | Play a day | Polishing | Enchanting | Damascus Anvil | Dragonbone | Everything |
|---|---|---|---|---|---|---|
| Casual (2 × 20 min, a bit less skilled) | 40 min | 20 min, day 1 | 164 min, day 5 | day 13 | day 30 | about day 60 (half of them done by day 60) |
| Typical (3 × 25 min) | 75 min | 23 min, day 1 | 177 min, day 3 | day 7 | day 17 | day 34 |
| Keen (4 × 40 min, a bit more skilled) | 160 min | 23 min, day 1 | 176 min, day 2 | day 4 | day 8 | day 16 |

### Coin per hour of play (typical player, all income before costs)

| Stretch of play | Coin/hour | Sessions with polishing / enchanting |
|---|---|---|
| 0 to 30 min | 3,280 (Armory first finds and getting-started steps) | 64% / 0% |
| 30 to 60 min | 1,870 | 98% / 0% |
| 1 to 2 h | 2,450 | 100% / 0% |
| 2 to 3 h | 3,390 | 100% / 20% |
| 3 to 5 h | 3,510 | 100% / 93% |
| 5 to 10 h | 5,780 | 100% / 100% |
| 10 to 20 h | 9,930 | 100% / 100% |
| 20 to 40 h | 12,270 | 100% / 100% |
| 40 h on | 19,750 | 100% / 100% |

Where a typical player's coin went over 60 days: unlocks 66%, mana draughts 15%, iron and coal 8%, star-dust 7%,
grit 3%, meals under 1%. Income: shop shelves 95%, commissions 3%, challenges and Armory 1%, scrap merchant
under 1%.

### What the sim tells us

- **The targets are met:** polishing in the first session, enchanting at the end of the 3rd hour (a player who
  buys it right after the Steel Anvil gets it after about 2.5 hours: median 153 min in the sim), the top tier
  spread over two to eight weeks depending on how much someone plays.
- **Energy stops mattering later.** Early on forging is fast and energy runs out (shelf slots and energy are
  the limits). Later, polishing and enchanting take most of each blade's time, energy refills faster than it is
  used, and meals are almost never bought. This seems fine to me (fewer moments of "come back later"), but if
  the owner wants energy to stay a limit, polishing could cost 1 energy. See open questions.
- **Mana is the late-game limit**, and mana draughts become the main coin sink after unlocks.
- **Coin piles up once the tree is done.** A keen player holds about 2 million coin by day 60. Something to
  spend it on after the tree is complete is an open question.

### How the sim works (and its limits)

It uses the real `rules.js` for blade types, rarity, sizes, shine and today's value formula, and the numbers in
this document for everything new (the `P` table and `NODES` list at the top of the script). An imaginary
player forges the heaviest blade they can afford (half the time the type a commission wants, otherwise a type
they haven't found yet), polishes and enchants whenever it pays, lists Short during a session and Medium/Long
before a break, sends overflow to the scrap merchant or salvage, buys meals and mana draughts when they pay
for themselves, and buys unlocks in a fixed sensible order as soon as it can afford them while keeping a small
reserve. Skill (strike score, polish quality, rune quality) improves smoothly with practice. Challenges are a
flat 160c a day and getting-started steps 220c once. Times per action: forge 25 to 48 s by weight, polish 30 s,
enchant 15 s + 15 s per rune, all × 1.35 for clicking around.

It is a model for comparing numbers, not a promise to the minute. Real players will be slower in the first
session (reading, exploring) and less tidy with their shelves. The polishing and enchanting mini-game designs
(02, 03) will replace the simple quality curves; 04 should re-run the sim with them.

---

## 9. Interface for 02, 03 and 05

These are the names the other documents and the code should use. **Kept exactly as agreed:**

| Field | Meaning |
|---|---|
| `b.polish = { q, m }` | Set once by polishing. `q` 0..100 skill score, `m` the multiplier (1 to 2.5). Botched polish: `m = 1`. |
| `b.runes = [{ k, q }]` | Set once by enchanting (only if `b.polish` exists). `k` a key of `RUNES`, `q` 0..1. At most one of each `k`, at most the chisel's slot count. |

**Proposed, for 05 to confirm:**

| Thing | Proposal |
|---|---|
| Data tables at the top of rules.js | `STYLES` (today's `CLASSES` without the "character" wording), `STONES`, `LIQUIDS`, `WHEELS`, `CHISELS`, `CONDUITS`, `RUNES`, `SHELF_COST`, `LISTINGS`, `QUICK_SELL = 0.40`, `GRIT_PER = {L:1,M:1,H:2,X:3}`, `DRAUGHT = {mana:10, p:15}`, `PRICES` gains `grit: 5, dust: 40` |
| Smith fields (new) | `styles: ['war']` (replaces `cls`, `classes`, `selBy`, `freeWar`), `grit`, `mana`, `manaTs`, `stone`, `wheel`, `chisel`, `conduit` (numbers/keys like `anvil` and `hammer`), `shelfSlots: 3`, `draughts: {d, n}` (like `meals`), `polishOn`, `enchantOn` |
| Learned things | Keep using `c.recipes` for everything learned once: patterns (`M`, `H`, `X`), quenches, styles (`shadow`...), liquids (`oil`...), runes (`frost`...). One `learn` action, one table of requirements. |
| Removed smith fields | `demand`, `demandTs`, `cls`, `classes`, `selBy`, `freeWar` |
| Blade on a shelf | `status: 'shelf'`, `b.shelf = { at, k, price }` |
| Requirement counters | `reqProgress` gains `forged`, `polished`, `pq60`, `pq85`, `enchanted`, `found` (Armory types) |
| Actions | `polishStart` (takes grit, like `forgeStart` takes energy) and `polishEnd` (raw inputs in, server rolls); `enchantStart` / `enchantEnd` (server checks and takes mana per rune); `shelfList {id, k}`, `shelfCancel {id}`; `quickSell {ids}` (replaces `sell`); `salvage` (extended); `learn` (extended); `upgrade {k: 'anvil'|'stone'|'chisel'|'conduit'}` (or keep `anvil` and add siblings); `hammer`/`wheel`; `shelfSlot`; `buy` (accepts `grit`, `dust`); `drink` (mana draught) |
| Clock settling | `beginAction` runs `tickFuel`, **`tickMana`** (copy of `tickFuel` using the conduit's max and rate) and **`settleShelf`**. `settleDemand` is removed. |
| Value | `value(b, mult)` loses its `dem` argument; `worth(b)` as in section 3; `quickSell(b) = max(1, round(worth(b) · 0.40))` |

---

## 10. What is removed

- The class system: `CLASS_COST`, `SLOT_PCT`, `clsN`, `classOffer`, `slotsOpen`, `classSwitch`, `classLearn`,
  and the class part of the Account page. (Data in `CLASSES` stays, renamed to styles.)
- Merchant demand: `c.demand`, `settleDemand`, `relaxDemand`, `clamorType`, `DEM_TICK`, `DEM_WIN`, `DEM_KEEP`,
  `MERCHANT`, `TRADER`.
- Commission imports.
- `isBroke` should use the scrap-merchant price instead of `value(b, demand)`.

---

## Open questions for the owner

1. **Big numbers at the top.** The best unlocks cost 40,000 to 50,000 coin (the Dragonbone Anvil was 5,000).
   That's because blades end up worth about 8× more. Are you happy with big numbers, or should every price and
   worth be divided down?
2. **Energy fades in the late game** because polishing and enchanting don't use it. Keep it that way, or make
   polishing cost 1 energy so energy stays a limit?
3. **Star-dust for sale (40c)** turns shards into something you can buy (400c each). It makes the late game
   fair across lucky and unlucky players, but shards are no longer purely a luck reward. OK?
4. **Scrap merchant at 40%.** Harsh enough that players use the shelves, but is it too harsh for a new player
   who just wants coin? (Pacing barely changes anywhere from 35% to 50% in the sim, because a tidy player uses
   the shelves; this is a feel question.)
5. **"In fashion"** (one style worth +15% on the shelf for 4 hours, same for everyone): add it now, later, or
   never?
6. **After the tree is finished**, coin piles up (a keen player has about 2 million by day 60). Want a long-term
   coin sink (shop decorations, more shelf slots, a prestige reset)? Out of scope for now unless you say so.
7. **Styles cost coin and need Armory finds** (10/25/45 types). Would you rather styles be free once the Armory
   requirement is met, so the Armory is the only gate?
8. **Shelf listings can be cancelled for free.** Fine, or should cancelling cost something?
