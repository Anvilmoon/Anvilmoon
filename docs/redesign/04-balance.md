# 04 Balance: the one design, with final numbers

This is the agreed design. Where `01-economy.md`, `02-polishing.md` and `03-enchanting.md` disagree, **this file
wins**. `05-implementation.md` turns it into code. Every number here was checked with the simulation
`tools/sim-economy.mjs` (run `node tools/sim-economy.mjs --days 60`, add `--profile casual` or `--profile keen`).

---

## The short version

- **One shop, no classes.** The 4 classes become 4 **styles** (War, Shadow, Arcane, Sanctum). You can forge a blade
  when you know its style and its weight. Everyone starts with War style and Light weight.
- **Every blade goes the same way:** forge, then polish (optional, once), then enchant (optional, up to 3 runes, only
  after polishing), then sell.
- **Worth = forge worth × polish × enchant.** Polish ×0.8 (stained) to ×2.0, a **Mirror polish ×2.5**. Enchant ×1.2
  (one first rune) to ×4.8 (three top runes, carved well), a rare **Resonant** rune can push it past ×6.
- **Polishing costs grit** (5c each; Light 1, Medium 1, Heavy 2, Massive 3). No energy.
- **Enchanting costs mana** from **one mana meter**: 20 at most, +1 every 2 minutes, like energy. **Mana draughts** at
  the market add 5 (20c, +10% for each one bought that day).
- **Selling:** scrap merchant (instant, 40%), salvage (materials), or **a shop shelf**: 10 minutes for 80%, 1 hour for
  100%, 8 hours for 125%. Price fixed when you list; the blade sells by the clock, even with the game closed.
- **Three trees** (Forge, Polish, Enchant) and the **shop** (shelf slots, then **Renown**), all bought with one
  `unlock` action from one table.
- **Coin no longer piles up:** late income is about a third lower than in 01, and **Renown** is a never-ending thing to
  buy (level n costs 10,000 × n coin, +1% on every shelf sale). A keen player holds about 100,000 coin on day 60
  (saving for the next level) instead of 2 million.

---

## 1. Resources

| Resource | Key | Source | Use |
|---|---|---|---|
| Coin | `coin` | Selling, commissions, challenges, Armory | Everything |
| Energy | `fuel` | +1 every 3 min up to 10; meals up to 30 (unchanged) | 1 per forge |
| Iron | `iron` | Market 4c, salvage, day labour | Forging, some unlocks |
| Bog iron | `bog` | Digging the slag heap when broke (unchanged) | Stands in for iron |
| Coal | `coal` | Market 3c, labour, digging | Forging |
| Damascus | `damascus` | Market 45c, salvage Masterwork+, Armory | Unlocks |
| Star-dust | `dust` | **Market 40c (new)**, salvage, Armory, **salvaging an enchanted blade (new)** | Refine 10 into 1 shard |
| Star-shards | `shards` | Refining, Starforged salvage, Armory | Higher unlocks |
| **Grit** (new) | `grit` | Market 5c, salvaging a polished blade | Each polish: Light 1, Medium 1, Heavy 2, Massive 3 |
| **Mana** (new) | `mana` | The meter refills: +1 every 2 min up to 20. Mana draughts can fill it to 40 | Each rune carved: 1 to 5 |

### The mana meter

| | Value |
|---|---|
| Most it refills to | **20** |
| Refill | **+1 every 2 minutes** (30 an hour), worked out from the clock like energy |
| Most it can hold (with draughts) | **40** (above 20 it doesn't refill, like energy above 10) |
| Mana draught (market) | **+5 mana for 20c**, price +10% for each draught bought that day (resets at local midnight) |
| Starts | full (20) |

A rune costs its mana when you **first touch the blade** to carve it, whatever happens next.

---

## 2. The value formula

```
forgeWorth = 6 · WT.v · bonus · gradeMult · sizeMult          (today's value, merchant demand removed)
polishMult = b.polish ? b.polish.m : 1
enchantMult = 1 + p1 + p2 × 0.5 + p3 × 0.3                     (rune powers, strongest first; a scar counts 0)
worth      = max(1, round(forgeWorth · polishMult · enchantMult))     (a cracked blade is worth 1)
```

| Price | Formula |
|---|---|
| Scrap merchant | `max(1, round(worth × 0.40))` |
| Shop shelf | `max(1, round(worth × listing factor × (1 + 0.01 × renown)))` |
| Auction House deposit | as today, from `worth` |

### Ranges

| | Bad / first try | Typical mid game | Late game, good hands | Jackpot |
|---|---|---|---|---|
| Polish | ×0.8 stained, ×1.1 sloppy | ×1.3 to ×1.5 | ×1.8 to ×2.0 (sim average ×1.73) | Mirror ×2.5 |
| Enchant | ×1.21 (Ember, strength 60%) | ×1.5 to ×2.5 | ×4.2 to ×4.84 (sim average ×3.7) | ~×6 with Resonant runes |

### Example blades

| Blade | Forge worth | Sandstone polish (×1.25) | Late polish (×1.85) | + three top runes (×4.5) |
|---|---|---|---|---|
| Light Common Seax, grade 70 | 10c | 13c | 19c | 83c |
| Medium Fine Broadsword, grade 80 | 31c | 39c | 57c | 258c |
| Heavy Masterwork Claymore, grade 85 | 95c | 119c | 176c | 791c |
| Massive Masterwork Zweihänder, grade 90, 110 cm | 156c | 195c | 289c | 1,300c |

---

## 3. Polishing

### The mini-game (from 02, unchanged)

Drag the stone left and right along the blade to rub off grime, for at most 20 seconds. Too slow does little, too fast
scratches; the safe speed drops as the steel gets clean. The browser records the stone's position every 50 ms
(0..1000, or -1 while lifted) and the server re-scores that list with the same function:
`skill s = clean³ × finish` (0..1). See 02 section 2 for the full rules; the only change is that **there are no buffing
tools**, so the speed limit is always the plain one (1.4 tracks a second on dirty steel, down to 0.77 on clean steel).

### The roll

```
stain first (only Camellia and Acid): chance = liquid.stain × (1.5 − s)        → q 0, ×0.8, "Stained"
then Mirror: chance = stone.mirror × liquid.mirror × s² (× 2 when s ≥ 0.95)     → q 100, ×2.5, "Mirror polish"
otherwise:  q = round(50 × s + liquid bonus + a random number from stone.lo to stone.hi), kept 0..99
            m = 1 + (q / 100) ^ 1.5, rounded to 2 decimals                      (×1.00 .. ×1.99)
```

| q | 0 | 25 | 40 | 50 | 60 | 75 | 90 | 99 | Mirror | Stained |
|---|---|---|---|---|---|---|---|---|---|---|
| m | ×1.00 | ×1.13 | ×1.25 | ×1.35 | ×1.46 | ×1.65 | ×1.85 | ×1.99 | **×2.50** | ×0.80 |
| Name | Dull | Bright | Bright | Gleaming | Gleaming | Radiant | Radiant | Radiant | Mirror polish | Stained |

Names: 0–24 Dull, 25–49 Bright, 50–74 Gleaming, 75–99 Radiant, 100 Mirror, stained Stained.

### Stones (bought in order, like anvils)

| # | Stone | Dice adds | Mirror chance (×s²) | Cost | Requirement |
|---|---|---|---|---|---|
| 0 | Sandstone | 0–15 | 0.5% | with the bench | – |
| 1 | Whetstone | 5–22 | 1% | 300c + 2 damascus | – |
| 2 | Waterstone | 10–28 | 2% | 1,200c + 6 damascus | – |
| 3 | Moonstone | 15–34 | 3% | 6,000c + 15 damascus + 3 shards | – |
| 4 | Starstone | 20–40 | 5% | 40,000c + 30 damascus + 10 shards | – |

### Liquids (picked for each polish, like quenches)

| Key | Liquid | q bonus | Stain chance | Mirror × | In the mini-game | Cost | Requirement |
|---|---|---|---|---|---|---|---|
| `spring` | Spring water | +0 | 0 | ×1 | normal | with the bench | – |
| `camellia` | Camellia oil | +6 | 5% × (1.5 − s) | ×1 | scratches ×0.7 | 150c | – |
| `acid` | Acid wash | +12 | 18% × (1.5 − s) | ×1.5 | grime ×1.2 faster, scratches ×1.3 | 800c | polish 15 blades with skill 0.7+ |

### Cost and rules

- Grit per polish: Light 1, Medium 1, Heavy 2, Massive 3. Taken when the polish starts.
- Once per blade, final. Not for cracked blades or keepsakes, only for blades on the rack.
- Leaving halfway: the grit is gone, the blade stays unpolished, you may pay again.

---

## 4. Enchanting

### The mini-game (from 03, unchanged)

Pick a polished blade, a rune and a conduit. The rune's guide shows on the blade. Your first touch takes the mana and
starts the carving; then you **trace the guide before the carving time runs out**. The browser sends the strokes as
`[x, y, t]` points; the server re-times them against its own clock and scores them with the same function:

```
done   = how much of the rune has ink on it           (0..1)
acc    = how much of the ink lies on the rune         (0..1)
charge = 0.85 + 0.15 × min(1, time left over / 40%)   (finish with 40% of the time left for a full charge)
q      = acc² × done × charge                          ("rune strength", 0..1)
```

Credit for a point `d` units from the line: `1 − (d / (3 × tol))²`, nothing beyond `3 × tol`. `tol` comes from the chisel.

### The one meaning of mana

There is **one mana meter** (section 1). It decides **whether** you can carve (each rune costs 1 to 5). The **conduit**
decides **how long you get to carve this rune**: carving time = `rune.sec × conduit.time` seconds. That is the owner's
"how much you can chisel depends on how fast you chisel and how much mana you have", in two simple parts. Conduits are
chosen for each carving, exactly like quenches, and do **not** change the meter. (Why: 01 had conduits enlarge the
meter, 03 had them as a per-carving choice. The choice is the more interesting decision, maps cleanly onto the quench,
and keeps the meter one fixed thing the player can learn once.)

### The result

```
q < 0.25                          → fizzle: nothing carved, the slot stays free, the mana is spent
else roll backlash (conduit risk) → a scar { k:'scar' } fills the slot for good (the blade is unharmed)
else roll Resonant (chisel.res × q²)
     power p = rune.v × q × conduit.power × (Resonant ? 1.5 : 1)        (stored on the blade)
enchantMult = 1 + p1 + 0.5 × p2 + 0.3 × p3         (strongest first)
```

Examples: Ember q 0.60, Copper → **×1.21**. Valor 0.85 + Frost 0.85, Steel chisel, Silver → ×1.96. Dawn + Hearth + Ward
all q 0.95, Stormglass → **×4.84**. Same with Dawn Resonant → ×6.04.

### Chisels (bought in order, like anvils)

| # | Chisel | Runes per blade | `tol` (forgiveness) | Resonant chance (× q²) | Cost | Requirement |
|---|---|---|---|---|---|---|
| 0 | Flint Chisel | 1 | 14 | 2% | with the table | – |
| 1 | Iron Chisel | 1 | 17 | 3% | 1,000c + 20 iron | – |
| 2 | Steel Chisel | 2 | 20 | 4% | 4,000c + 10 damascus + 1 shard | – |
| 3 | Starsteel Chisel | 3 | 24 | 6% | 40,000c + 30 damascus + 10 shards | – |

A blade carved earlier can take more runes later once the chisel allows it. **Each rune at most once per blade.**

### Mana conduits (picked for each carving, like quenches)

| Key | Conduit | Carving time × | Power × | Backlash risk | Cost | Requirement |
|---|---|---|---|---|---|---|
| `copper` | Copper Conduit | ×1.0 | ×1.00 | 2% | with the table | – |
| `silver` | Silver Conduit | ×1.3 | ×1.10 | 6% | 1,500c + 4 damascus | – |
| `stormglass` | Stormglass Conduit | ×1.6 | ×1.20 | 15% | 6,000c + 3 shards | carve 10 runes at 70%+ |

### Runes

| Key | Rune | Glyph | Carving time (Copper) | Mana | Value `v` | Cost | Requirement |
|---|---|---|---|---|---|---|---|
| `ember` | Ember | ᚲ | 5.0 s | 1 | 0.35 | with the table | – |
| `frost` | Frost | ᚷ | 6.0 s | 2 | 0.55 | 300c | – |
| `valor` | Valor | ᛏ | 5.5 s | 2 | 0.75 | 1,500c + 3 damascus | set 10 runes |
| `storm` | Storm | ᛋ | 3.5 s | 3 | 0.95 | 3,000c + 6 damascus | set 25 runes |
| `fortune` | Fortune | ᚠ | 5.0 s | 3 | 1.15 | 6,000c + 3 shards | set 60 runes |
| `ward` | Ward | ᛉ | 5.0 s | 4 | 1.40 | 12,000c + 5 shards | set 120 runes |
| `hearth` | Hearth | ᛟ | 6.5 s | 4 | 1.70 | 25,000c + 8 shards | set 25 runes at 80%+ |
| `dawn` | Dawn | ᛞ | 8.0 s | 5 | 2.10 | 60,000c + 15 shards | set 10 runes at 90%+ |

"Set" = a rune that took (not a fizzle, not a scar). Runes are pure value: Valor's Arena bonus and Fortune's listing
bonus from 03 are dropped.

### Rune templates (normalized strokes)

The plate is 1000 × 1000 units: x to the right, y down, the blade's point at the top. Each stroke is a list of `[x, y]`
points joined by straight lines. Any stroke order and direction is fine.

| Rune | Strokes |
|---|---|
| Ember | `[650,200] [350,500] [650,800]` |
| Frost | `[300,250] [700,750]` · `[700,250] [300,750]` |
| Valor | `[500,150] [500,850]` · `[250,380] [500,150] [750,380]` |
| Storm | `[620,120] [380,420] [620,580] [380,880]` |
| Fortune | `[380,150] [380,850]` · `[380,250] [650,100]` · `[380,480] [680,300]` |
| Ward | `[500,150] [500,850]` · `[220,200] [500,450]` · `[780,200] [500,450]` |
| Hearth | `[500,120] [750,420] [500,720] [250,420] [500,120]` · `[500,720] [300,900]` · `[500,720] [700,900]` |
| Dawn | `[220,200] [220,800]` · `[780,200] [780,800]` · `[220,200] [780,800]` · `[780,200] [220,800]` |

Checked: each template traced exactly scores strength 1.00; a random scribble over the plate scores about 0.15
(fizzles).

---

## 5. Every unlock

All bought with the `unlock` action. "After" = you must own that first. Tiers (anvils, stones, chisels, shelves) are
bought in order. Hammers keep their own Workshop rows (they wear out and are repaired) and are unchanged.

### Forge tree

| Key | Unlock | Effect | Cost | Requirement |
|---|---|---|---|---|
| – | *Start* | Rough Anvil, Worn Hammer, oil quench, Light weight, War style | – | – |
| `anvil1` | Iron Anvil | rarity table as today | 80c + 15 iron | – |
| `anvil2` | Steel Anvil | as today | 400c + 30 iron + 4 damascus | – |
| `anvil3` | Damascus Anvil | as today | 3,000c + 12 damascus + 2 shards | – |
| `anvil4` | Dragonbone Anvil | as today | 40,000c + 40 damascus + 10 shards | – |
| `M` | Medium pattern | Medium blades of every style you know | 150c + 10 iron | – |
| `H` | Heavy pattern | Heavy blades | 600c + 3 damascus | deliver 5 commissions |
| `X` | Massive pattern | Massive blades | 2,000c + 8 damascus + 1 shard | forge a Masterwork or better |
| `brine` | Brine quench | as today | 100c | – |
| `water` | Water quench | as today | 400c | 10 blades of grade 70+ |
| `shadow` | Shadow style | the 25 Shadow blades | 300c | find 10 blade types (Armory) |
| `arcane` | Arcane style | the 25 Arcane blades | 1,200c | find 25 blade types |
| `sanct` | Sanctum style | the 25 Sanctum blades | 4,000c | find 45 blade types |
| (hammer) | Smith's Hammer | as today | 120c + 10 iron + 1 damascus | – |
| (hammer) | Master Hammer | as today | 900c + 6 damascus + 1 shard | – |

### Polish tree

| Key | Unlock | Effect | Cost | Requirement |
|---|---|---|---|---|
| `polish` | **Polishing bench** | opens polishing, with Sandstone and Spring water | 300c | after Medium pattern; forge 20 blades |
| `stone1` | Whetstone | stone 1 | 300c + 2 damascus | after the bench |
| `stone2` | Waterstone | stone 2 | 1,200c + 6 damascus | – |
| `stone3` | Moonstone | stone 3 | 6,000c + 15 damascus + 3 shards | – |
| `stone4` | Starstone | stone 4 | 40,000c + 30 damascus + 10 shards | – |
| `camellia` | Camellia oil | liquid | 150c | after the bench |
| `acid` | Acid wash | liquid | 800c | after the bench; polish 15 blades with skill 0.7+ |

### Enchant tree

| Key | Unlock | Effect | Cost | Requirement |
|---|---|---|---|---|
| `enchant` | **Enchanter's table** | opens enchanting, with the Flint Chisel, Copper Conduit and Ember | 1,200c + 5 damascus | after the Steel Anvil; polish 40 blades |
| `chisel1` | Iron Chisel | chisel 1 | 1,000c + 20 iron | after the table |
| `chisel2` | Steel Chisel | chisel 2 (2 runes) | 4,000c + 10 damascus + 1 shard | – |
| `chisel3` | Starsteel Chisel | chisel 3 (3 runes) | 40,000c + 30 damascus + 10 shards | – |
| `silver` | Silver Conduit | conduit | 1,500c + 4 damascus | after the table |
| `stormglass` | Stormglass Conduit | conduit | 6,000c + 3 shards | after the table; carve 10 runes at 70%+ |
| `frost` … `dawn` | Runes | see the rune table | see the rune table | after the table |

### Shop

| Key | Unlock | Cost |
|---|---|---|
| – | Shelf slots 1 to 3 | free |
| `shelf4` | Shelf slot 4 | 150c |
| `shelf5` | Shelf slot 5 | 500c |
| `shelf6` | Shelf slot 6 | 1,500c |
| `shelf7` | Shelf slot 7 | 6,000c |
| `shelf8` | Shelf slot 8 | 25,000c |
| (renown) | **Renown** level n (repeatable, opens with slot 8) | 10,000 × n coin: +1% on every shelf sale per level |

---

## 6. Selling

| Way | Rule |
|---|---|
| **Scrap merchant** (the `sell` action) | Instant. 40% of worth. Any number of blades. Replaces today's Sell (75% × demand). |
| **Salvage** | As today, plus: polished blade +1 grit (Massive +2); +1 star-dust for each rune on it (not scars). Cracked as today. |
| **Shop shelf** | One blade per slot. Price fixed when listed. Sells at exactly listed time + duration, settled from the clock. Cancel any time before: back to the rack, nothing paid. Locked (kept) blades and keepsakes can't be listed. |

| Listing | Sells after | Price | With test odds (dev only) |
|---|---|---|---|
| Short | 10 minutes | 80% | 30 seconds |
| Medium | 1 hour | 100% | 3 minutes |
| Long | 8 hours | 125% | 24 minutes |

**Merchant demand is removed** (the per-type demand, the clamouring, `settleDemand`). The shelves limit selling now.

---

## 7. Commissions

As today (3 orders, pin, lock, refresh `10 · 2^locked`, Heavy pattern still needs 5 deliveries), plus:

| | Rule |
|---|---|
| Blade type | Any type you can forge (known style at a known weight). **No imports.** |
| Polish request | Once you own the bench: 60% of new orders ask a minimum polish quality 40 / 60 / 80 (chances 50/35/15%). Once you own the table: **every** order does. Pay × (1 + minP/100). |
| Rune request | Once you own the table: 50% of new orders also ask for one rune you know, at strength 0.5+. Pay × (1 + 1.5 × v): Ember ×1.53 … Dawn ×4.15. |

```
pay = [15, 40, 100, 280][minR] · WT.v · (Large 1.6 | Huge 3 | 1) · (minGrade ? 1.3 : 1)
      · (minP ? 1 + minP/100 : 1) · (rune ? 1 + 1.5 · RUNES[rune].v : 1)
```

---

## 8. Market

| Item | Buy | Sell |
|---|---|---|
| Iron | 4c | – |
| Coal | 3c | – |
| Damascus | 45c | 22c |
| Star-shards | – | 100c |
| **Star-dust** (new) | 40c | – |
| **Grit** (new) | 5c | – |
| **Mana draught** (new) | 20c, +10% each one today | +5 mana, up to 40 |
| Meals | as today | – |
| Refine | 10 star-dust → 1 shard | |

---

## 9. What changed from each design and why

### From 01-economy

| Change | Why |
|---|---|
| Polish numbers now come from 02's roll (q, m = 1 + (q/100)^1.5, Mirror, Stain). Stones are dice ranges, not caps. Wheels removed. | Lead's decision; one polishing formula, fewer items. |
| Liquids: 3 (`spring`, `camellia`, `acid`) instead of 4. | 02's keys don't clash with the quench `water`; 3 mirror the 3 quenches. |
| Conduits are a per-carving choice (time, power, backlash), not meter upgrades. The meter is fixed (20, +1/2 min). | One meaning per thing (see section 4). The conduit tier costs (up to 40,000c) are gone, the tree is shorter. |
| Chisels: Flint/Iron/Steel/Starsteel (1/1/2/3 runes) from 03. | 03 owns the mini-game; `tol` is what a chisel does. |
| Runes: 03's eight shapes, values scaled ×1.3 (no chisel "depth"), new costs and requirements. Several runes combine 1 / 0.5 / 0.3. | Lead's range ×1.2 to ×4.8 with one fewer multiplier; each extra slot adds less, so slots aren't a straight ×3. |
| No star-dust cost on runes; salvage gives +1 dust per rune. | Simpler: mana is the only rune cost. |
| Draughts: +5 mana for 20c, +10% per draught a day (was +10 for 15c, +5%). | Draughts are the steady late-game sink; the steeper rise keeps them self-limiting. |
| Commission rune factor 1 + 1.5·v (was 1 + 2·v). | Rune values are higher now. |
| Top costs re-tuned: Steel Chisel 4,000c, Starsteel 40,000c, Dawn 60,000c + 15 shards, Ward 12,000c, Hearth 25,000c. | Keep the top tier over weeks with the new (lower) late income. |
| **Renown** added (10,000 × n, +1%/level). | Fixes the coin pile (section 10). |
| Shelf listings sell 20× faster with test odds. | So the owner can test shelves in a short session. |

### From 02-polishing

| Change | Why |
|---|---|
| Cost is grit by weight (no energy, no "compound"). | Lead's decision; energy stays the forge's resource. |
| Buffing tools dropped (`zone` is always 1). | Fewer concepts. 02 itself says the game works without them. |
| Mirror ×2.5 (was ×2.4). | Matches the agreed top of the range. |
| Stones renamed Sandstone/Whetstone/Waterstone/Moonstone/Starstone; same dice. Costs from 01. | One naming, one price list. |
| Acid needs 15 polishes at skill 0.7+ (was 10). | Arrives in the 5th–6th hour, after the Massive pattern. |

### From 03-enchanting

| Change | Why |
|---|---|
| Chisel `depth` removed; rune `v` raised ×1.3 instead. | One fewer multiplier, same range. |
| Meter 20 / +1 per 2 min, runes cost 1–5 mana (was 12 / +1 per 4 min, 1–4). | Enough for the early game, scarce enough at the top (a three-rune top blade costs 13). |
| Valor and Fortune side effects dropped. | Runes are pure value; Arena power ignores polish and enchant. |
| Costs and requirements from the sim. | |
| `Math.hypot` replaced with `Math.sqrt` in the scoring. | Same answer on every engine. |

---

## 10. Simulation results

`node tools/sim-economy.mjs --runs 300 --days 60` for each profile. Typical: 3 sessions of 25 minutes a day.
Casual: 2 × 20 minutes, slightly less skilled. Keen: 4 × 40 minutes, slightly more skilled. Medians.

### Pacing (typical player)

| Unlock | Median play | 10% .. 90% | Day |
|---|---|---|---|
| Iron Anvil | 1 min | 1 .. 2 min | 1 |
| Medium pattern | 5 min | 3 .. 5 min | 1 |
| Shelf slot 4 | 7 min | 6 .. 12 min | 1 |
| **Polishing bench** | **24 min** | 18 .. 26 min | 1 |
| Camellia oil | 48 min | 25 .. 76 min | 1 |
| Whetstone | 75 min | 50 .. 101 min | 1 |
| Heavy pattern | 105 min | 77 .. 152 min | 2 |
| Steel Anvil | 127 min | 101 .. 161 min | 2 |
| Shadow style | 150 min | 104 .. 178 min | 2 |
| Shelf slot 5 | 152 min | 125 .. 186 min | 3 |
| **Enchanter's table** | **180 min** | 152 .. 228 min | 3 |
| Water quench, Frost rune | 3.4 h | | 3 |
| Waterstone | 3.9 h | 3.4 .. 4.7 h | 4 |
| Iron Chisel | 4.3 h | 3.7 .. 5.1 h | 4 |
| Silver Conduit | 5.0 h | 4.2 .. 5.6 h | 4 |
| Valor rune | 5.5 h | 4.7 .. 6.4 h | 5 |
| Massive pattern | 6.3 h | 5.5 .. 7.1 h | 5 |
| Acid wash | 6.4 h | 5.6 .. 7.3 h | 6 |
| Arcane style | 6.5 h | 5.6 .. 7.5 h | 6 |
| Steel Chisel | 7.3 h | 6.5 .. 8.2 h | 6 |
| Shelf slot 6 | 7.7 h | 6.9 .. 8.6 h | 7 |
| Storm rune | 8.2 h | 7.3 .. 9.4 h | 7 |
| Master Hammer | 8.6 h | 7.7 .. 9.7 h | 7 |
| **Damascus Anvil** | **9.4 h** | 8.2 .. 10.7 h | **8** |
| Stormglass Conduit | 10.6 h | 9.5 .. 11.8 h | 9 |
| Fortune rune | 11.7 h | 10.4 .. 12.9 h | 10 |
| Moonstone | 12.9 h | 11.3 .. 13.9 h | 10 |
| Sanctum style | 13.3 h | 12.0 .. 14.4 h | 11 |
| Shelf slot 7 | 13.9 h | 12.5 .. 15.1 h | 11 |
| Ward rune | 15.6 h | 14.1 .. 16.9 h | 13 |
| **Dragonbone Anvil** | **20.7 h** | 19.0 .. 22.5 h | **16** |
| Starsteel Chisel | 25.9 h | 23.8 .. 27.7 h | 20 |
| Hearth rune | 29.1 h | 26.9 .. 31.1 h | 23 |
| Starstone | 32.9 h | 30.6 .. 35.1 h | 26 |
| Shelf slot 8 (Renown opens) | 34.9 h | 32.6 .. 37.3 h | 27 |
| **Dawn rune (tree complete)** | **40.4 h** | 37.9 .. 42.9 h | **31** |

### Pacing per profile

| Profile | Play a day | Polishing | Enchanting | Damascus Anvil | Dragonbone | Tree complete |
|---|---|---|---|---|---|---|
| Casual | 40 min | 20 min, day 1 | 175 min, day 5 | day 14 | day 30 | day 56 (91% by day 60) |
| Typical | 75 min | 24 min, day 1 | 180 min, day 3 | day 8 | day 16 | day 31 |
| Keen | 160 min | 23 min, day 1 | 202 min, day 2 | day 4 | day 8 | day 15 |

### Coin per hour of play (typical, all income)

| Play | Coin/hour | (01's sim) |
|---|---|---|
| 0 – 30 min | 2,600 (Armory first finds, getting started) | 3,280 |
| 30 – 60 min | 950 | 1,870 |
| 1 – 2 h | 1,270 | 2,450 |
| 2 – 3 h | 2,070 | 3,390 |
| 3 – 5 h | 1,940 | 3,510 |
| 5 – 10 h | 3,000 | 5,780 |
| 10 – 20 h | 4,600 | 9,930 |
| 20 – 40 h | 5,670 | 12,270 |
| 40 – 80 h | 8,200 | 19,750 |

Keen player after 80 hours: 12,800 coin/hour (01: 20,400).

### Coin in hand (incl. listed blades), end of day, median

| Day | 1 | 3 | 7 | 14 | 21 | 30 | 45 | 60 |
|---|---|---|---|---|---|---|---|---|
| Casual | 346 | 748 | 1,525 | 4,373 | 7,714 | 21,562 | 23,111 | 22,358 |
| Typical | 500 | 1,342 | 3,426 | 24,041 | 17,428 | 37,658 | 46,766 | 65,078 |
| Keen | 896 | 3,329 | 30,375 | 35,076 | 42,858 | 69,382 | 89,654 | 101,342 |
| Keen **without Renown** | 896 | 3,329 | 30,375 | 35,956 | 243,986 | 595,196 | 1,170,523 | 1,745,546 |

Renown level on day 60: casual 2, typical 10, keen 19 (+19% on shelf sales). The coin a keen player holds is now what
they are saving for the next level (200,000c).

### Other results (typical, last 300 blades sold)

- 100% polished, average ×1.73; 97% enchanted, average ×3.73, best ×6.5, 2.45 runes per enchanted blade.
- Over 60 days: 1,848 polishes (70 Mirror, 58 stained), 3,472 runes set (152 Resonant, 414 scars).
- Income: shop shelves 95%, commissions 4%, challenges and Armory 1%, scrap merchant under 1%.
- Blades: 49% Short listings, 28% Medium, 15% Long, 5% commissions, 3% scrap merchant, 1% salvage.
- Coin spent: unlocks 33%, renown 52%, mana draughts 8%, iron and coal 5%, grit 2%.

### What the sim tells us

- **Targets met:** polishing in the first session, enchanting in the 3rd hour, the top tier over two to eight weeks.
- **The first two hours earn less than in 01** (polish starts at about ×1.2 with Sandstone). Pacing still holds; if
  playtesters find hour 1–2 slow, lower the Whetstone and Steel Anvil costs first.
- **Energy stops mattering late** (polishing and enchanting don't use it). Mana and shelf slots are the late limits.
- **Coin pile fixed:** income is lower and Renown absorbs the rest, with a small, lasting reward.

### How the sim works

It uses the real `rules.js` for blade types, rarity, sizes, shine and the forge formula, and the `P` table and `NODES`
list (= this document) for everything new. Polish uses the exact roll above with a skill curve (0.55 rising to 0.87 with
practice); rune strength is a curve too (0.58 rising to about 0.82 with the Flint chisel, +0.04/+0.07/+0.10 for better
chisels, +0.03/+0.05 for more carving time, a little lower for long runes). The imaginary player forges the heaviest
blade they can afford, polishes everything once enchanting is open, picks the rune and conduit with the best gain per
mana, buys draughts when they pay for themselves, lists Short in a session and Medium/Long before a break, and buys
unlocks in the order of `NODES` (Renown only once the tree is complete). Times: forge 25–48 s, polish 25 s, each rune
15 s, all × 1.35. It compares numbers; it does not predict a real player to the minute.

---

## Decisions for the owner to review

1. **Renown** (10,000 × level coin, +1% on shelf sales each) as the endless coin sink. Alternatives: shop decorations, a
   prestige reset.
2. **Fixed mana meter** (20, +1 every 2 min) with conduits as a per-carving choice. Mana draughts get pricier fast
   (+10% each per day).
3. **Hours 1–2 earn less** than 01 promised. Fine in the sim, but worth watching in playtests.
4. **Star-dust for sale** (40c) so shards can be bought (400c each).
5. **Scrap merchant at 40%** (a feel question; pacing barely changes from 35% to 50%).
6. **Backlash scars are permanent** (about 12% of runes in the sim, mostly from Stormglass).
7. **Styles cost coin and need Armory finds** (10/25/45 types).
