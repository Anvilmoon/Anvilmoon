# Game mechanics

All numbers are from the code at `c4def0a`. "Test mode" (`A.testOdds`, only available when
`ANVILMOON_DEV` is true) changes some odds; production values are listed unless noted.

## Resources

| Resource | Key | Source | Use |
|---|---|---|---|
| Coin | `coin` | Selling blades/materials, commissions, auctions, challenges, Armory first finds, getting-started steps | Everything |
| Energy | `fuel` | Regenerates 1 per 3 min up to 10 (`FUEL_MAX`); meals add more up to 30 (`ENERGY_CAP`); salvaging a cracked or empty blade gives 1 | 1 per forge |
| Iron | `iron` | Buy 4c, salvage, day labour | Forging |
| Bog iron | `bog` | Digging the slag heap (when broke) | Substitutes for iron; caps that blade at Fine |
| Coal | `coal` | Buy 3c, day labour, digging | Forging |
| Damascus | `damascus` | Buy 45c / sell 22c, salvage Masterwork+ | Upgrades |
| Star-dust | `dust` | Salvage Tempered (+5), salvage Heirloom/Legendary, Armory | 10 refine into 1 shard |
| Star-shards | `shards` | Refining, salvage Starforged (3), Armory | Upgrades, sell 100c |

New smith: 80 coin, 12 iron, 8 coal, 10 energy, Rough Anvil, Worn Hammer, Light pattern and oil quench known.

## Classes and blades

Four classes, 25 blades each (7 Light, 7 Medium, 6 Heavy, 5 Massive) = 100 blade types:
Warsmith (straight European steel), Shadowsmith (curved/eastern), Arcanesmith (rune blades with an element
variant), Sanctum Smith (holy/ceremonial). Every smith starts as a **Warsmith**. Other classes are learned on
the Account page once the Armory is complete enough: 2nd class at 5% for 150c, 3rd at 15% for 600c, 4th at 30%
for 2,000c. You can switch class any time; one shared purse and rack.

| Weight | Iron | Coal | Strikes | Value factor `v` |
|---|---|---|---|---|
| Light (L) | 1 | 1 | 4 | 1 |
| Medium (M) | 2 | 1 | 6 | 1.8 |
| Heavy (H) | 4 | 2 | 8 | 3 |
| Massive (X) | 6 | 3 | 10 | 4.5 |

Variants per class (rare variant ≈ 5% chance, adds +1 to the value bonus): War Iron/Bronze/**Blackened**,
Shadow Smoked/Serrated/**Bone-handled**, Arcane Fire/Frost/Storm/**Void**, Sanctum Silver/Gold/**Relic-wrapped**.

Two gift types (`testsword`, `sweetchilli`) are keepsakes: one of a kind, cannot be sold, salvaged, listed or
wagered, can fight in ranked duels. They arrive by mail from server-side campaigns.

## Unlocks (Workshop)

| Item | Cost | Requirement |
|---|---|---|
| Medium pattern | 150c + 10 iron | – |
| Heavy pattern | 600c + 3 damascus | Deliver 5 self-forged blades to commissions |
| Massive pattern | 2,000c + 8 damascus + 1 shard | Forge a Masterwork or better yourself |
| Brine quench | 100c | – |
| Water quench | 400c | Forge 10 blades with grade ≥ 70 |
| Iron Anvil | 80c + 15 iron | Anvils must be bought in order |
| Steel Anvil | 400c + 30 iron + 4 damascus | |
| Damascus Anvil | 1,500c + 12 damascus + 2 shards | |
| Dragonbone Anvil | 5,000c + 30 damascus + 8 shards | |
| Smith's Hammer | 120c + 10 iron + 1 damascus | Sweet spot ×1.3, cooling ×0.85, 50 durability, repair 30c |
| Master Hammer | 900c + 6 damascus + 1 shard | Sweet spot ×1.6, cooling ×0.7, 50 durability, repair 150c |

Hammer durability drops by 1 per forge (not per strike, despite the UI text); a broken hammer behaves as the
Worn Hammer. Patterns are stored per smith in `c.recipes` (not per class).

## Forging (hand forge)

Costs 1 energy + iron + coal for the weight. Bog iron fills any iron shortfall and caps rarity at Fine.

Loop (`loop()`, per frame, `dt` capped at 50 ms):
- Heat `T` (0–1) starts at 0.15; holding Bellows (button or **F**) raises it by 0.32/s, otherwise it falls by
  0.055/s.
- The strike marker oscillates: `mx = (sin(t·3.4)+1)/2` (about 1.85 s per sweep).
- Heat bands: `< 0.48` cold, `0.48–0.88` "Strike now", `> 0.88` too hot.

On **Strike** (button or **Space**):
- `timing = max(0, 1 − |mx − 0.5| · 3.2 / zone)` where `zone` is the hammer's sweet-spot factor.
- Heat factor `hf`: T < 0.3 → 0.35 and `cold += 0.09`; T < 0.48 → 0.65 and `cold += 0.04`; T > 0.88 → 0.6
  and `burns += 1`; else 1.
- Strike score = `timing · hf`. Labels: > 0.85 Perfect, > 0.6 Clean, > 0.3 Glancing, else Missed.
- Heat drops by `0.09 · cool` after each strike.

After all strikes, choose a quench:

| Quench | Crack risk | Grade bonus |
|---|---|---|
| Oil | 3% | +0 |
| Brine | 10% | +6 |
| Water | 22% | +12 |

- **Grade** = `clamp(round(avg_score · 88 + bonus − burns · 2), 1, 100)`. So a flawless hand forge is 88 in oil,
  94 in brine, 100 in water.
- **Crack chance** = quench risk + accumulated `cold`. A cracked blade is worth 1c and salvages for scrap.
- **Perfect forge:** grade ≥ 90 rolls rarity on the **next anvil up** (`b.perfect`).
- **Arcanesmith** plays the same maths with different visuals: a spark orbits a rune circle every 1.8 s, and
  timing is the angular distance to the target rune (window `0.72 · zone` radians). Quenches are renamed Salt
  circle / Moonwater / Starfire ("unravel" instead of "crack").
- **Quick forge:** no mini-game, grade 30–55, oil quench (3% crack), same costs.
- **Day labour** (only when broke, 5 shifts/day): play the mini-game on the foreman's blade; pays 1 iron +1 if
  average > 0.55, 1 coal +1 if average > 0.8.
- **Dig the slag heap** (only when broke): free, 45 s, gives 1 bog iron + 1 coal.

"Broke" (`isBroke`): you cannot afford a Light forge even after selling every owned blade.

## Rolls (`makeBlade`)

**Rarity** from the anvil's table (percent):

| Anvil | Common | Fine | Masterwork | Heirloom | Legendary |
|---|---|---|---|---|---|
| Rough | 70 | 22 | 6 | 1.8 | 0.2 |
| Iron | 60 | 25 | 10 | 4 | 1 |
| Steel | 48 | 30 | 15 | 5.5 | 1.5 |
| Damascus | 38 | 32 | 19 | 8.5 | 2.5 |
| Dragonbone | 30 | 33 | 22 | 11 | 4 |

**Size** (independent of type; `len` is the blade from guard to tip, in cm):

| Size | Weight % | Length | Value bonus |
|---|---|---|---|
| Runt | 1 | 8–30 | +1.5 |
| Small | 20 | 30–70 | 0 |
| Standard | 55 | 70–120 (triangular, peaks at 95) | 0 |
| Large | 20 | 120–160 | +0.3 |
| Huge | 3.49 | 160–220 | +1 |
| Titan | 0.5 | 220–300 | +4 |
| Colossal | 0.01 (1 in 10,000) | 300 + exponential tail, mean +60 | +30 |

`si` is recomputed from the final length, so the band edges are exact.

**Shine:** Starforged 1/2,000 (value +40), Tempered 1/200 (+3). **Moonlit:** only 20:00–06:00 local device
time, 1/15 (+0.5). **Variant:** rare ≈ 5%.

## Value

```
worth(b)  = value(b, demand=1, mult=1)                (shown "Worth")
merchant  = value(b, demand[type], mult=0.75)         (Sell button)
value     = max(1, round(6 · WT.v · bonus · gradeMult · sizeMult · demand · mult))
bonus     = 1.72 + rarity.vb + size.vb + shine.vb + (rare variant ? 1 : 0) + (moon ? 0.5 : 0)
rarity.vb = Common 0, Fine 1, Masterwork 3, Heirloom 8, Legendary 25
gradeMult = max(0.6, 1 + (grade − 72)/55 · 0.5)
sizeMult  = Runt: 1, else sqrt(max(10, len)/100)
cracked   = 1c
```

**Merchant demand** (per smith, per type, starts at 1): each sale multiplies it by 0.93 (floor 0.5); every 5 s
all demand drifts 3% back toward 1; every 75 s one random type of your class gets +0.4 (cap 1.6).

**Salvage:** iron = `round(WT.iron · len/100 · 0.6)` (0.3 if cracked), plus Fine 1 coal, Masterwork 1 damascus,
Heirloom 2 damascus + 1 dust, Legendary 3 damascus + 3 dust, Tempered +5 dust, Starforged 3 shards. If nothing,
1 energy.

**Market:** buy iron 4, coal 3, damascus 45; sell damascus 22, shards 100; refine 10 dust → 1 shard.
**Meals:** bread +1 energy 4c, pottage +3 10c, meat pie +6 18c, feast +12 30c; each meal today raises meal
prices 5% (resets at local midnight).

## Commissions

Always 3 orders (`ensure`). An order wants a type (from your class and known weights; with 12% chance, if online
and none on the board, an **import** from another class that pays ×1.8) with minimum rarity (capped by your anvil:
Rough → Fine, Iron/Steel → Masterwork, better → Heirloom), maybe a minimum size (35%: Large 75% / Huge 25%) and
maybe a minimum grade (35%: 55–75).

Pay = `[15, 40, 100, 280][minRarity] · WT.v · (Large 1.6 | Huge 3 | 1) · (minGrade ? 1.3 : 1) · (import ? 1.8 : 1)`.

Delivering marks the blade `commission` (it still counts for Records and the Armory) and replaces the order.
New notices cost `10 · 2^locked` (locked orders survive the refresh). Orders can be pinned to the Forge page.
Locked, keepsake and "precious" blades (record, shine, Titan+, rare variant, Legendary) are protected or need a
second click.

## Armory and rewards

100 blade types × 6 goals = 600 (found, Legendary, Titan or bigger, Tempered, Starforged, Moonlit). Shared by
the account; counts any non-cracked blade you have ever kept/sold/delivered/listed. First-find rewards
(`claimArmory`): found → 20 · WT.v coin; Legendary → 2 damascus; Titan → 1 damascus; Tempered → 5 dust;
Starforged → 1 shard; Moonlit → 25 coin. Armory % also gates classes and hall badges
(Bronze 0%, Silver 10%, Gold 30%, Platinum 60%).

## Getting started, challenges, titles

- **Getting started** (`GS_STEPS`): 10 one-time steps (forge, open rack, sell, market, board, collect a
  challenge, workshop, armory, arena, hall) paying 10–50c each, 220c total. While unfinished, the game opens on
  Home.
- **Challenges:** 5 daily (tiers Easy ×2, Medium, Hard, Very hard: 25/25/50/100/200c) and 5 weekly (150–600c),
  picked by a PRNG seeded on the UTC day/week number, so everyone gets the same list. Days turn at 00:00 UTC,
  weeks on Monday. Progress counts forge/sell/salvage/win events. A day streak counts days with at least one
  daily done.
- **Titles** (22): forge 1/50/250/1,000, Legendary 1/10, Titan, Starforged, Moonlit, a Chronicler per class
  (find all 25), Record Holder, Duelist (5 wins), Arena Champion (1,200 rating), Coin Baron (10,000 coins),
  Steadfast (7-day streak), Taskmaster (50 challenges), Founding Smith (account created before 2026-12-01).
  All computed on the client from the save.

## Records (global boards)

Built by SQL from every account's saved blades (status owned/sold/commission/listed, not cracked, not gifts,
hidden users excluded), one entry per smith per board, top 10: **Largest blade**, **Runt board** (shortest),
**Forge grade**, **Rough anvil** (longest forged on the starter anvil), **Each blade** (longest of every type),
**Wealth** (coin in hand), **Arena** (rating ladder). The client merges its own local blades in so your entries
show instantly.

## Auction House

List a non-gift blade with a start bid, optional buyout and duration Short 30 min / Medium 2 h / Long 12 h.
Deposit = `max(1, round(worth · 3% · (1 | 2 | 4)))`, paid up front, returned on a sale, kept if it expires
or is cancelled. Minimum next bid = `max(bid+1, ceil(bid · 1.05))`. Bid coin is taken immediately and mailed
back if outbid. On sale the seller gets `floor(price · 0.95) + deposit` by mail; the buyer gets the blade by mail
(buyouts arrive instantly). Cancel only before any bid. Max 20 listings per player.

## Arena (server-resolved)

- Pick an owned, uncracked blade. **Ranked** (rating at stake, blade safe) or **Wager** (winner takes the
  loser's blade, players only, no keepsakes).
- Ranked queue: if no player within 20 s, a **practice** bot match starts (bot uses your blade type with
  rarity ±1, grade 40–85, no shine). Practice does not change rating or win/loss.
- Power = `14 · sqrt(weight) · (1 + 0.12 · rarity) · (0.75 + grade/200) · (Starforged ? 1.08 : 1)`,
  weight L 1, M 1.4, H 2.5, X 3.6. Both start at 100 HP.
- Each round both pick simultaneously within 15 s (no pick = guard). Strike beats Feint, Feint beats Guard,
  Guard beats Strike.
  - Both strike: each deals 0.6 · power. Both guard or both feint: nothing.
  - Strike wins: 1.0 · power. Feint wins: 0.8 · power. Guard wins: counter for `0.5 · (0.5 + grade/100) · power`.
  - Massive blades +15% on strike, Light blades +15% on feint. Every hit ×(0.9–1.1) random.
- Ends at 0 HP or after 12 rounds; higher HP wins, equal is a draw. Ranked Elo with K = 32, everyone starts
  at 1,000. Yielding sets your HP to 0. Bot moves: strike 40%, guard 30%, feint 30%.
