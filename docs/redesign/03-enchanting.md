# Enchanting: carving runes

The third craft, unlocked after polishing. The player picks a forged, polished blade, chooses a rune, and
**draws the rune onto the blade with the mouse or a finger**. The drawn line is chiselled into the steel and glows.
A well-carved rune raises the blade's value. The value gain runs from about ×1.2 for a first try to about
×4–5 for a master's blade with three runes.

What the player is told, in one sentence:

> **Your mana drains every second you carve: trace the rune before it runs dry. Sloppy lines and unfinished
> strokes weaken it, and mana you have left at the end charges it brighter.**

Everything below explains how that sentence works, what the browser sends, what the server checks and rolls,
and the numbers.

How enchanting maps onto forging, so it feels familiar:

| Forging | Enchanting | What it changes |
|---|---|---|
| Anvil (5 tiers) | **Chisel** (4 tiers) | How many runes a blade can take, how forgiving the scoring is, how deep each rune bites (value), the chance of a Resonant rune |
| Quench (oil / brine / water) | **Mana conduit** (copper / silver / stormglass) | How long the mana lasts, a power bonus, the risk of a backlash. Chosen for each carving, like a quench |
| Blade patterns (L / M / H / X) | **Runes** (8) | Harder shapes, more mana, more value |
| Energy (1 per forge) | **Mana meter** (1–4 per rune) | Refills with time, like energy |
| Strike timing `[d, T]` scored by `strikeScore` | Stroke points `[x, y, t]` scored by `runeScore` | The same function scores them in the browser (live) and on the server (for real) |
| Server rolls rarity, size, crack | Server rolls **backlash** and **Resonance** | Dice stay on the server |

---

## 1. The mini-game

### What the player sees

1. **The rune bench.** From the rack, a polished blade with a free rune slot has an **Enchant** button. The bench
   shows:
   - the runes you know as cards (glyph, name, mana cost, value, "pace" as one to five dots),
   - the conduits you own as buttons, like the quench buttons ("Silver conduit: 30% more mana, +10% power, 6%
     backlash risk"),
   - your mana meter ("Mana 7 / 12").
2. **The carving plate.** After you pick a rune and a conduit, a close-up of the blade fills a square panel, point up,
   in the pixel-art style. The rune is drawn over the steel as a **faint dotted guide**. Under the plate is the
   **mana bar**, full, with a small notch at 40% ("finish above this line for a full charge"). Below that are two
   buttons: **Set the rune** and **Abandon**.
3. **Nothing drains until you touch the blade.** You can study the guide for as long as you like. Your **first touch**
   pays the mana and starts the carving (this sends `enchantStart`).
4. **Carving.** You trace the guide with the mouse button held, or with a finger. You may lift and put down the
   chisel as often as you like, and draw the strokes in any order and either direction. As you carve:
   - the line you draw is cut into the steel: it glows in the rune's colour where it sits on the guide, and shows
     as a plain grey scratch where it wanders off;
   - parts of the guide you have covered light up;
   - a "Rune strength 0–100%" readout updates as you draw (the same `runeScore` the server uses);
   - the mana bar drains steadily, with a soft tick when it falls below 20%.
5. **The carving ends** when you press **Set the rune**, when the mana runs out, or when you hit the point or stroke
   limit (section 4). The game sends the strokes (`enchantEnd`) and waits for the server's answer.
6. **The reveal.** The groove fills with light from one end to the other. The server's dice can then add:
   - **Resonant!** A rare jackpot: a shimmer and chime, and the rune is worth 50% more.
   - **Backlash!** The conduit snaps. The rune shatters and leaves a **scar** that uses up the slot.
   - **The rune didn't take hold** if the strength was under 25%. The slot stays free and the mana is spent.

**Abandon** ends the carving with nothing carved. The mana is spent and the slot stays free. Before the first touch,
Abandon just closes the plate and costs nothing.

### Speed and mana: the exact rule

The owner's words were "the amount they can chisel depends on how fast they chisel, and how much mana they have."
The model:

- **The conduit holds a fixed amount of mana, and it drains at a steady rate for as long as you carve.** So the mana
  is really a **time window**:
  `window (ms) = rune.sec × conduit.time × 1000`.
  Example: Ember has `sec = 5`. With the Copper conduit (×1) you get 5 seconds, with Stormglass (×1.6) 8 seconds.
- **Ink drawn after the mana runs out does not count.** The chisel stops cutting. So how much of the rune you can
  carve = how fast you carve × how much time your mana buys. That is the owner's sentence, almost word for word.
- **Drawing faster uses less mana per length of line** (the mana goes by time, not by distance). But people draw
  less accurately when they hurry. That is the tension: hurry and your lines wander, dawdle and the rune is left
  unfinished.
- **Mana left over charges the rune.** This gives even a slow, safe player a reason to speed up:
  `spare = 1 − (time used ÷ window)`,
  `charge = 0.85 + 0.15 × min(1, spare ÷ 0.4)`.
  If you finish with 40% or more of the bar left you get the full charge (×1.00). If you finish just as the bar
  empties you get ×0.85. More than 40% left gains nothing more. This cap means a bot that traces instantly is no
  better than a player who finishes with 40% left.
- "Time used" ends when you press **Set the rune**, so press it promptly. The mana keeps draining until you do,
  which matches what the bar shows.

Some examples, for Ember with the Copper conduit (5 s window, about 850 units of line):

| How you carve | Done (coverage) | Spare | Charge | Effect |
|---|---|---|---|---|
| Careful, finished in 3.0 s | 100% | 40% | ×1.00 | Full strength for your accuracy |
| Very careful, finished in 4.5 s | 100% | 10% | ×0.89 | A bit weaker: you took your time |
| Slow, the mana ran out at 80% of the shape | ~80% | 0% | ×0.85 | Unfinished and uncharged |
| Fast and scrappy, 1.5 s | 100% | 70% | ×1.00 | Charged, but accuracy suffers (see section 2) |

**Why time, not distance?** If mana were spent per unit of line, speed would not matter at all, only tidiness.
With mana spent per second, speed matters (the owner's wish), and the bar is easy to read: it is a timer that
drains. Players already understand timers from the forge's heat.

---

## 2. Shape scoring: `runeScore`

### The idea

The guide is drawn at a fixed place on the plate and the player traces **over** it. So the drawing does not need to be
moved or resized to compare it. We compare it exactly where it lies. Two questions:

1. **Done (coverage):** how much of the rune has ink on it?
2. **Accuracy:** how much of the ink lies on the rune?

Both are needed. Coverage alone could be gamed by scribbling over the whole plate (coverage 100%, accuracy near 0).
Accuracy alone could be gamed by carving one short perfect line (accuracy 100%, coverage low).

**Rune strength** `q = accuracy² × done × charge`, capped at 1. Accuracy is squared ("it counts twice"), because a
tidy rune should matter more than a complete scrawl.

### Step by step

The plate measures 1000 × 1000 units: x goes to the right, y goes down, and the blade's point is at the top. Every
rune fits roughly inside x 200–800 and y 100–900, the flat of a blade standing upright.

1. **Cut at the mana.** Throw away every point drawn after the window. If a line crosses the moment the mana
   runs out, cut it at that moment (interpolate between the two points).
2. **Sample the rune.** Walk along every line of the guide and take a point every 20 units ("samples").
3. **Done:** for every guide sample, find the distance to the nearest piece of ink (point-to-segment distance).
   Turn it into credit with `near(d)`. Done = the average credit.
4. **Accuracy:** sample the ink the same way, every 20 units. For every ink sample, find the distance to the nearest
   line of the guide and take `near(d)`. Accuracy = the average credit.
5. **Credit for a distance** (`tol` comes from the chisel, section 5):
   `near(d) = 1 − (d ÷ (3·tol))²`, and 0 once `d ≥ 3·tol`.
   With the Flint chisel (`tol = 14`): 5 units off earns 98%, 14 off 89%, 28 off 56%, and 42 or more earns nothing.
   It is a smooth curve with no hard edge, so small wobbles cost little and real misses cost a lot.

**Stroke order and direction are not required.** Players draw shapes differently (top-down or bottom-up, one
long line or several pieces), and asking for a set order would mean explaining it and showing arrows. Since the
guide is right there, "trace over it" needs no explanation. Scoring the geometry alone also makes the function
short and the same for every rune.

**Lifting the chisel is free**, apart from the time it takes. Ink is only scored where it is drawn: moving to the
next stroke with the button up costs time and no accuracy.

### How reliable it is (tested)

I wrote the function in a scratch file and fed it simulated traces: a hand that drifts away from the line by a
typical amount, 40 tries each, no time limit. On a plate shown 320 px wide, 10 units is about 3 px.

| Typical wobble | Flint chisel (tol 14) | Starsteel chisel (tol 24) |
|---|---|---|
| Careful (~10 units, ~3 px) | 0.84–0.86 | 0.94–0.95 |
| OK (~20 units, ~6 px) | 0.53–0.59 | 0.80–0.83 |
| Sloppy (~35 units, ~11 px) | 0.24–0.28 | 0.55–0.60 |
| Careful, one stroke skipped | 0.25–0.70 (by how big the stroke is) | 0.29–0.80 |
| Random scribble over the plate (400 pts) | — | 0.02–0.14 (doesn't take) |

The numbers barely change from rune to rune, so every rune scores fairly. Harder runes are harder because they
are longer and have to be carved faster, not because the scoring treats them differently.

**Rule for designing new runes:** two strokes must never run side by side closer than 150 units, and where strokes
meet they should meet at 45° or more. Otherwise ink on one stroke earns credit on its neighbour. All 8 runes
below follow this rule.

---

## 3. What the browser sends, what the server checks

### The data

`enchantEnd` sends:

```js
{ strokes: [ [[x, y, t], [x, y, t], ...],   // one list per stroke (chisel down ... chisel up)
             ... ],
  tEnd: 3120 }                               // ms from the first touch to "Set the rune" (or the mana running out)
```

- `x`, `y`: whole numbers 0–1000 (plate units). The browser converts the pointer position and clamps it to the plate.
- `t`: whole milliseconds since the first touch. It never goes down, within a stroke or from one stroke to the next.
- The browser keeps a point only when the pointer has moved **10 units or more** from the last kept point (plus the
  point where the chisel lifts). This keeps lines smooth and the message small.
- **Limits:** at most **400 points** in total and **12 strokes**. If the player reaches either one, the carving ends
  there, as if the mana ran out. 400 points at 10-unit spacing is about 4,000 units of line, well above the longest
  rune (Dawn, about 2,840). Strokes with fewer than 2 points (a tap) are dropped before sending.
- The message is at most about 5 kB.

### The server's checks (`enchantEnd`)

1. There is an open carving (`S.enchant`) and its blade is still on the rack.
2. `strokes` is a list of at most 12 lists. Every stroke has at least 2 points. There are at most 400 points in total.
   Every point is three whole numbers. `x` and `y` are between 0 and 1000. `t` never goes down and is never more
   than `tEnd`. An empty list is allowed: that is **Abandon**, and the rune fizzles.
3. `tEnd` is a whole number from 1 to 120,000 (2 minutes).
4. **The server's clock is the referee.** The server noted the time of `enchantStart` (`t0`) and knows the time now.
   Timestamps from the browser could be faked, or slowed down by a "speed hack" tool that makes the game's clock
   run slow so the player gets more time. So:

   ```
   seen = now − t0                               // how long the server saw the carving last
   real = max(tEnd, seen − GRACE)                // GRACE = 3,000 ms for the network and the action queue
   stretch every t by real ÷ tEnd                // only ever makes the carving longer, never shorter
   ```

   An honest player's `tEnd` is about `seen`, so nothing changes. A client whose clock ran slow, or that shrank its
   timestamps, has its points spread back out over the time that really passed. Ink that was really drawn after the
   mana ran out falls outside the window again, and the spare mana shrinks. The most anyone can gain is the 3-second
   grace.
5. The server then runs `runeScore` itself and rolls the dice (section 4).

**No minimum time check is needed.** Forging has one (`MIN_STRIKE_MS`) because each strike is a separate score.
Here, carving faster than "40% mana left" earns nothing, because the charge is capped.

### What a cheater can achieve

A modified browser can send a mathematically perfect tracing: accuracy 1, done 1, charge 1, so `q = 1`. That is the
ceiling, the same as a perfect-skill forge. A skilled human reaches about 0.85–0.95. A cheater **cannot**:
- go above q = 1, or pick a rune they haven't learned, or a conduit they don't own;
- carve more runes than the chisel's slots, or the same rune twice on a blade;
- avoid a backlash, force a Resonance, or skip the mana cost (all of these are decided on the server);
- gain more than 3 seconds by faking the clock.

No game can tell a perfect bot from a perfect player. That is accepted here as it is for forging.

---

## 4. The result: strength, power, slots and dice

### From strength to power

When a rune takes, the server stores its **power** `p`, which already includes everything that was true at that
moment:

```
p = rune.v × q × chisel.depth × conduit.power × (Resonant ? 1.5 : 1)
```

Storing `p` on the blade means a later chisel upgrade doesn't change what old runes are worth, and the value
function stays tiny.

### Slots: how many runes a blade holds

**Your chisel decides how many runes a blade can take:** Flint and Iron 1, Steel 2, Starsteel 3. A blade carved with a
Flint chisel can take a second rune later, once you own a Steel chisel.

**Each extra rune adds less.** The runes on a blade are sorted by power. The strongest counts fully, the second
half, the third 30%:

```
enchantMult(b) = 1 + p₁ × 1 + p₂ × 0.5 + p₃ × 0.3        (p₁ ≥ p₂ ≥ p₃)
```

Order of carving doesn't matter. **The same rune can't go on a blade twice**, so filling three slots needs three
learned runes, which gives rune unlocks a lasting purpose.

`enchantMult` multiplies the blade's value everywhere it is used: worth, the scrap merchant's price, the shop
listing. Salvage materials are not changed. It stacks with the polishing multiplier (see `01-economy.md` for the final value formula).

### The dice (server only, in `enchantEnd`)

In this order:

1. **Fizzle (not a die):** if `q < 0.25` the rune doesn't take. The slot stays free, the mana is spent, and no dice
   are rolled.
2. **Backlash:** `rng() < conduit.risk` → the rune shatters and leaves a **scar**: `{ k: 'scar', q: 0, p: 0 }`. The
   scar takes up a slot for good. This is the conduit's "crack risk". It is softer than a cracked blade (the
   blade and its other runes are unharmed), but it is permanent.
3. **Resonance:** `rng() < chisel.res × q²` → the rune is **Resonant** (`r: 1`), worth ×1.5, and gets a shimmer in
   the rack. Good carving makes it more likely. With the Starsteel chisel and q = 0.95 the chance is about 5.4%.

What the player sees is what they get: the strength shown live is the strength stored. Luck only touches backlash
and Resonance.

### Example numbers (the economy designer's target: about ×1.2 to ×4–5)

| Setup | Runes and strength | enchantMult |
|---|---|---|
| First try: Flint chisel, Copper conduit | Ember, q 0.60 | **×1.21** |
| A good first try | Ember, q 0.85 | ×1.30 |
| Middle: Iron chisel, Silver conduit | Fortune, q 0.80 | ×1.92 |
| Steel chisel (2 slots), Silver | Ward 0.85 + Fortune 0.85 | ×2.77 |
| Top: Starsteel, Stormglass | Dawn + Hearth + Ward, all q 0.85 | ×4.42 |
| Top, great carving | all q 0.95 | **×4.82** |
| Top, great carving, Dawn Resonant | | ×6.0 (rare) |

The working, for the top row: depth 1.3 × power 1.2 = 1.56. Then `1.56 × 0.95 × (1.6 + 1.3×0.5 + 1.1×0.3) = 3.82`,
so the multiplier is ×4.82.

**Conduits in expectation** (power × chance of no backlash): Copper 1.00 × 0.98 = 0.98, Silver 1.10 × 0.94 = 1.03,
Stormglass 1.20 × 0.85 = 1.02. They are close on purpose. The real choice is **time against risk**: Stormglass gives
60% more time, which is what makes Dawn carveable and lifts q, at a 15% chance of scarring a slot. On a precious
blade's last slot, a careful player picks Copper. That mirrors oil against water quench.

---

## 5. The runes

Eight runes, named for what they do, with shapes based on the Elder Futhark (shown in the "Glyph" column). The
coordinates are the real templates: x 0–1000 to the right, y 0–1000 down, the blade's point at the top.

| # | Key | Name | Glyph | Shape | Strokes | Line length | `sec` (Copper) | Pace to finish / for full charge* | Mana | `v` | Effect |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `ember` | Ember | ᚲ | `<` angle | 1 | 849 | 5.0 | 170 / 283 | 1 | 0.35 | Orange glow, embers drift off the blade |
| 2 | `frost` | Frost | ᚷ | X cross | 2 | 1,281 | 6.0 | 225 / 388 | 1 | 0.50 | Ice-blue glow |
| 3 | `valor` | Valor | ᛏ | Up-arrow | 2 | 1,379 | 5.5 | 265 / 460 | 2 | 0.65 | Red glow. **+5% Arena power** (optional) |
| 4 | `storm` | Storm | ᛋ | Lightning zigzag | 1 | 1,057 | 3.5 | 302 / 503 | 2 | 0.80 | Violet glow, a crackle when shown |
| 5 | `fortune` | Fortune | ᚠ | F with two raised branches | 3 | 1,359 | 5.0 | 309 / 566 | 2 | 0.95 | Gold glow. **+10% shop listing price** (optional) |
| 6 | `ward` | Ward | ᛉ | Stem with two raised arms | 3 | 1,451 | 5.0 | 330 / 605 | 3 | 1.10 | Silver-white glow |
| 7 | `hearth` | Hearth | ᛟ | Diamond on two legs | 3 | 2,100 | 6.5 | 356 / 636 | 3 | 1.30 | Jade glow |
| 8 | `dawn` | Dawn | ᛞ | Bow-tie between two posts | 4 | 2,841 | 8.0 | 400 / 728 | 4 | 1.60 | White-gold glow, slow shimmer |

\* Units per second (1000 = the plate's width) with the Copper conduit, allowing 0.3 s to move between strokes. The
first number is the speed needed just to finish. The second is the speed needed to finish with 40% mana left. The
Silver conduit divides these by 1.3 and Stormglass by 1.6. On a 320-px plate, 300 units/s is about 100 px/s, a calm
tracing speed.

Effects are kept minimal: **value is the point.** Every rune gives its glow colour to the blade in the rack and the
Hall, and the blade's name gets a suffix from its strongest rune ("Longsword of Dawn"), which is purely cosmetic. The
two gameplay effects (Valor in the Arena, Fortune in the shop) are small and optional. If the economy designer
prefers pure value, drop them.

The data, as it would sit in rules.js (it doubles as a check that the shapes follow the spacing rule):

```js
// Runes for enchanting. s = the strokes of the guide: lines of [x, y] points on a 1000 x 1000 plate
// (x to the right, y down, the blade's point at the top). sec = seconds of carving with the Copper conduit.
// mana = cost from the mana meter. v = value at full strength with the starter chisel and conduit.
// Rule for new shapes: no two strokes closer than 150 units side by side; strokes meet at 45° or more.
const RUNES = {
  ember:   { n: 'Ember',   g: 'ᚲ', glow: '#ff7a2a', sec: 5,   mana: 1, v: .35,
             s: [[[650, 200], [350, 500], [650, 800]]] },
  frost:   { n: 'Frost',   g: 'ᚷ', glow: '#8fdcff', sec: 6,   mana: 1, v: .50, cost: { coin: 200 },
             s: [[[300, 250], [700, 750]], [[700, 250], [300, 750]]] },
  valor:   { n: 'Valor',   g: 'ᛏ', glow: '#ff5a4a', sec: 5.5, mana: 2, v: .65, cost: { coin: 400 }, arena: 1.05,
             s: [[[500, 150], [500, 850]], [[250, 380], [500, 150], [750, 380]]] },
  storm:   { n: 'Storm',   g: 'ᛋ', glow: '#c7b8ff', sec: 3.5, mana: 2, v: .80, cost: { coin: 700, damascus: 2 },
             s: [[[620, 120], [380, 420], [620, 580], [380, 880]]] },
  fortune: { n: 'Fortune', g: 'ᚠ', glow: '#e9c35a', sec: 5,   mana: 2, v: .95, cost: { coin: 1000, damascus: 3 }, list: 1.10,
             s: [[[380, 150], [380, 850]], [[380, 250], [650, 100]], [[380, 480], [680, 300]]] },
  ward:    { n: 'Ward',    g: 'ᛉ', glow: '#e8f0ff', sec: 5,   mana: 3, v: 1.10, cost: { coin: 1800, damascus: 6 },
             s: [[[500, 150], [500, 850]], [[220, 200], [500, 450]], [[780, 200], [500, 450]]] },
  hearth:  { n: 'Hearth',  g: 'ᛟ', glow: '#6fe0b0', sec: 6.5, mana: 3, v: 1.30, cost: { coin: 3500, damascus: 10, shards: 2 },
             req: 'r80', need: 5, rt: 'Carve 5 runes with 80% strength or more',
             s: [[[500, 120], [750, 420], [500, 720], [250, 420], [500, 120]], [[500, 720], [300, 900]], [[500, 720], [700, 900]]] },
  dawn:    { n: 'Dawn',    g: 'ᛞ', glow: '#fff2c0', sec: 8,   mana: 4, v: 1.60, cost: { coin: 7000, damascus: 20, shards: 5 },
             req: 'r90', need: 1, rt: 'Carve a rune with 90% strength or more',
             s: [[[220, 200], [220, 800]], [[780, 200], [780, 800]], [[220, 200], [780, 800]], [[780, 200], [220, 800]]] },
};
```

Rune costs are a suggestion scaled from today's pattern costs (Medium 150c, Heavy 600c, Massive 2,000c). Enchanting
comes later in a run than forging, so the top runes cost more. **The economy designer finalizes them.** Ember is
known as soon as enchanting is unlocked.

---

## 6. Chisels and mana conduits

### Chisels (the "anvil" of enchanting, bought in order like anvils)

| Tier | Name | Slots | `tol` (forgiveness) | `depth` (value) | `res` (Resonance at q = 1) | Suggested cost |
|---|---|---|---|---|---|---|
| 0 | Flint Chisel | 1 | 14 | 1.00 | 2% | Comes with the rune bench |
| 1 | Iron Chisel | 1 | 17 | 1.10 | 3% | 600c + 20 iron (between the Steel Anvil's 400c and the Damascus Anvil's 1,500c) |
| 2 | Steel Chisel | 2 | 20 | 1.20 | 4% | 2,000c + 10 damascus + 1 shard |
| 3 | Starsteel Chisel | 3 | 24 | 1.30 | 6% | 6,000c + 30 damascus + 8 shards (a little above the Dragonbone Anvil) |

`tol` is in plate units. A finer chisel "bites where you mean it", much as a better hammer widens the sweet spot.
Full credit fades to nothing at 3 × `tol`: 42 units (about 13 px) for Flint, 72 units (about 23 px) for Starsteel.

### Mana conduits (the "quench" of enchanting, chosen for each carving)

| Key | Name | `time` (mana) | `power` | `risk` (backlash) | Suggested cost |
|---|---|---|---|---|---|
| `copper` | Copper Conduit | ×1.0 | ×1.00 | 2% | Comes with the rune bench |
| `silver` | Silver Conduit | ×1.3 | ×1.10 | 6% | 500c (today's brine is 100c, but it arrives much earlier) |
| `stormglass` | Stormglass Conduit | ×1.6 | ×1.20 | 15% | 1,500c + 2 shards, requires: carve 10 runes with 70% strength or more |

Stormglass is the "volatile" conduit: the most mana and power, and a real chance of backlash. You choose the
conduit for each carving, on the bench, before your first touch, because it sets the length of the mana bar.

```js
const CHISELS = [
  { n: 'Flint Chisel',     slots: 1, tol: 14, depth: 1.00, res: .02, d: 'Where every runecarver starts.' },
  { n: 'Iron Chisel',      slots: 1, tol: 17, depth: 1.10, res: .03, cost: { coin: 600, iron: 20 }, d: 'A truer edge. Forgives a shaky hand.' },
  { n: 'Steel Chisel',     slots: 2, tol: 20, depth: 1.20, res: .04, cost: { coin: 2000, damascus: 10, shards: 1 }, d: 'Room for a second rune.' },
  { n: 'Starsteel Chisel', slots: 3, tol: 24, depth: 1.30, res: .06, cost: { coin: 6000, damascus: 30, shards: 8 }, d: 'Three runes, cut deep.' },
];
const CONDUITS = {
  copper:     { n: 'Copper Conduit',     time: 1.0, power: 1.00, risk: .02, d: 'Steady. 2% backlash risk.' },
  silver:     { n: 'Silver Conduit',     time: 1.3, power: 1.10, risk: .06, cost: { coin: 500 }, d: '30% more mana, +10% power, 6% backlash risk.' },
  stormglass: { n: 'Stormglass Conduit', time: 1.6, power: 1.20, risk: .15, cost: { coin: 1500, shards: 2 },
                req: 'r70', need: 10, rt: 'Carve 10 runes with 70% strength or more', d: '60% more mana, +20% power, 15% backlash risk.' },
};
```

---

## 7. What each attempt costs: the mana meter

**Assumption: a mana meter that refills with time, exactly like energy.**

- `c.mana`, at most **12** (`MANA_MAX`), **+1 every 4 minutes** (`MANA_MS = 240000`). It is worked out from the
  clock in `beginAction` with a `tickMana` that copies `tickFuel`, so no timer in the tab is trusted.
- Each carving costs the rune's `mana` (1–4) from the meter, paid at the first touch (`enchantStart`).
- A full meter is about 4–12 carvings depending on the runes. A top blade (Dawn + Hearth + Ward) costs 10 mana,
  about 40 minutes of refill.
- Optional refill: a **Mana draught** at the Market (suggested 25c for +3, getting pricier with each one bought that
  day, like meals). The economy designer decides whether it exists and its price.

**Why a meter rather than mana crystals:**
1. Players already know energy, so there is one less new idea to learn.
2. It uses the existing clock pattern (`tickFuel`), which is already server-safe.
3. It needs no new item in the inventory, the Market, salvage tables or the save beyond two numbers.
4. It paces the top end naturally: you can't carve 50 Dawns in a row.

If the economy designer would rather have a coin sink, the switch is small: replace `c.mana` with a `crystals` item
bought at the Market, keep each rune's `mana` as its crystal cost, and drop `tickMana`.

The owner's "how much mana they have" is covered twice: the meter decides **whether** you can carve, and the
conduit's mana bar decides **how much** you can carve in one go.

---

## 8. Data shapes, actions and pseudocode

### New save fields

| Where | Field | Meaning |
|---|---|---|
| smith `c` | `mana`, `manaTs` | The mana meter and when it last ticked (like `fuel`, `fuelTs`) |
| smith `c` | `chisel` | Chisel tier 0–3 (like `anvil`) |
| smith `c` | `recipes.enchant` | Enchanting unlocked (the "rune bench", see `01-economy.md` for its cost and requirement) |
| smith `c` | `recipes.<rune>`, `recipes.<conduit>` | Learned runes and owned conduits, through the existing `knows()` and `learn` |
| smith `c` | `carve = { n, r70, r80, r90 }` | Runes set, and how many reached 70/80/90% (for unlock requirements) |
| blade `b` | `runes = [{ k, q, p, r? }]` | Rune key, strength, power, Resonant flag. A scar is `{ k: 'scar', q: 0, p: 0 }` |
| save `S` | `enchant = { id, rune, conduit, chisel, tol, winMs, t0 }` | The open carving. `winMs` (the conduit's mana as milliseconds of carving) replaces the brief's `mana` field, to avoid confusion with the meter |

`knows()` grows by two defaults: `k === 'ember' || k === 'copper'` (for smiths with `recipes.enchant`). Rune and
conduit keys must not clash with other recipe keys. Today's keys are `M H X brine water`, and **`05-implementation.md`
should check them against the polishing keys.**

### Actions

| Action | `rng` | Arguments | What it does |
|---|---|---|---|
| `enchantStart` | false | `{ id, rune, conduit }` | Checks everything, pays the mana, opens `S.enchant`. Predicted in the browser so the bar starts at once |
| `enchantEnd` | true | `{ strokes, tEnd }` | Checks, re-times against the server clock, scores, rolls, writes `b.runes` |
| `chisel` | false | `{}` | Buys the next chisel (copy of `anvil`) |
| `learn` | false | `{ k }` | Unchanged, but it also looks up `k` in `RUNES` and `CONDUITS` |

`enchantStart` takes `conduit` as well as the brief's `{ id, rune }`, because the conduit sets the mana window before
carving begins. A new `enchantStart` replaces a stale open carving (for example after a reload in the middle of
carving), and the stale carving's mana is lost.

### Numbers at the top of rules.js

```js
// ---- enchanting
const MANA_MAX = 12, MANA_MS = 240000;     // the mana meter: +1 every 4 minutes, up to 12
const RUNE_STEP = 20;                      // scoring looks at a point every 20 plate units
const RUNE_MAX_PTS = 400;                  // most points a carving may send
const RUNE_MAX_STROKES = 12;               // most strokes a carving may send
const RUNE_MAX_MS = 120000;                // no carving lasts longer than 2 minutes
const RUNE_FIZZLE = .25;                   // a rune weaker than this doesn't take
const RUNE_FULL_SPARE = .4;                // finish with 40% of the mana left for a full charge
const RUNE_GRACE_MS = 3000;                // how far the game's clock may lag the server's (network, queue)
const RUNE_SLOT_W = [1, .5, .3];           // the strongest rune counts fully, the 2nd half, the 3rd 30%
const RESONANT = 1.5;                      // a Resonant rune is worth 50% more
```

### `runeScore`: the shared, pure scoring function

```js
// ============================================================== enchanting
// The carving mini-game runs in the browser. It reports the strokes the player drew as [x, y, t] points
// (plate units 0..1000, milliseconds since the first touch). Both sides score them with this function,
// so the strength the player sees is the strength they get.
//   o = { tol, winMs, tEnd }   tol from the chisel, winMs = how long the mana lasts, tEnd = when carving stopped
// Returns { acc, done, spare, q }, all 0..1.
function runeScore(runeKey, strokes, o) {
  const R = RUNES[runeKey];
  // 1. the chisel stops when the mana runs out: keep only ink drawn inside the window
  const ink = [];
  for (const s of strokes) {
    const line = [];
    for (let i = 0; i < s.length; i++) {
      const [x, y, t] = s[i];
      if (t <= o.winMs) { line.push([x, y]); continue; }
      if (line.length) {                                     // cut the last piece where the mana ran out
        const [x0, y0, t0] = s[i - 1], f = (o.winMs - t0) / Math.max(1, t - t0);
        line.push([x0 + (x - x0) * f, y0 + (y - y0) * f]);
      }
      break;
    }
    if (line.length >= 2) ink.push(line);
  }
  const spare = 1 - Math.min(o.tEnd, o.winMs) / o.winMs;
  if (!ink.length) return { acc: 0, done: 0, spare, q: 0 };
  const inkSegs = segmentsOf(ink), runeSegs = segmentsOf(R.s);
  // 2. done: how much of the rune has ink on it
  const done = average(R.s.flatMap((l) => samplePoints(l, RUNE_STEP)).map(([x, y]) => nearCredit(nearestDist(x, y, inkSegs), o.tol)));
  // 3. accuracy: how much of the ink lies on the rune
  const acc = average(ink.flatMap((l) => samplePoints(l, RUNE_STEP)).map(([x, y]) => nearCredit(nearestDist(x, y, runeSegs), o.tol)));
  // 4. mana left over charges the rune (full charge at 40% left)
  const charge = .85 + .15 * Math.min(1, spare / RUNE_FULL_SPARE);
  return { acc, done, spare, q: clamp(acc * acc * done * charge, 0, 1) };
}
// credit for being d units from the line: 1 on it, 0 from 3 x tol away, a smooth curve between
const nearCredit = (d, tol) => { const r = d / (3 * tol); return r >= 1 ? 0 : 1 - r * r; };
const average = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
// a polyline's pieces as [ax, ay, bx, by]
function segmentsOf(lines) {
  const out = [];
  for (const l of lines) for (let i = 1; i < l.length; i++) out.push([l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]]);
  return out;
}
// points along a polyline, about every `step` units, both ends included
function samplePoints(l, step) {
  const out = [[l[0][0], l[0][1]]];
  for (let i = 1; i < l.length; i++) {
    const [ax, ay] = l[i - 1], [bx, by] = l[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}
// distance from a point to the nearest of a list of segments
function nearestDist(x, y, segs) {
  let best = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const u = L2 ? clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
    const ex = ax + u * dx - x, ey = ay + u * dy - y, d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}
// value multiplier from a blade's runes: sorted strongest first, each slot counts less
function enchantMult(b) {
  const ps = (b.runes || []).map((r) => r.p || 0).sort((x, y) => y - x);
  return 1 + ps.reduce((s, p, i) => s + p * (RUNE_SLOT_W[i] || 0), 0);
}
```

Cost: about 150 guide samples × up to 400 ink pieces, plus about 200 ink samples × at most 8 guide pieces. That is
well under a millisecond, so it is fine on the server and fine 10 times a second in the browser.

### The strokes check

```js
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
// the mana meter refills from the clock, exactly like energy (called in beginAction)
function tickMana(c, now) {
  if (!knows(c, 'enchant')) return;
  if (c.mana == null) { c.mana = MANA_MAX; c.manaTs = now; }
  if (c.mana >= MANA_MAX) { c.manaTs = now; return; }
  const n = Math.floor((now - c.manaTs) / MANA_MS);
  if (n > 0) { c.mana = Math.min(MANA_MAX, c.mana + n); c.manaTs += n * MANA_MS; if (c.mana >= MANA_MAX) c.manaTs = now; }
}
```

### The two actions

```js
// ---- enchanting: start (pay the mana at the first touch), then end (score the strokes, roll the dice)
def('enchantStart', false, (ctx, a) => {
  const { S, c } = ctx, b = bladeById(c, a.id), rune = String(a.rune || ''), con = String(a.conduit || '');
  const R = RUNES[rune], CO = CONDUITS[con], CH = CHISELS[c.chisel || 0];
  need(knows(c, 'enchant'), 'Build a rune bench in the Workshop first.');
  need(b && b.status === 'owned' && !b.cracked && !isGift(b), 'That blade isn’t on your rack.');
  need(isPolished(b), 'Polish the blade before you carve a rune into it.');      // defined by 02-polishing
  need(R && knows(c, rune), 'Learn that rune first.');
  need(CO && knows(c, con), 'You don’t have that conduit.');
  const runes = b.runes || [];
  need(runes.length < CH.slots, `Your ${CH.n.toLowerCase()} can’t fit another rune on this blade.`);
  need(!runes.some((r) => r.k === rune), 'That rune is already on this blade.');
  need(c.mana >= R.mana, `${R.n} takes ${R.mana} mana. Your mana refills with time.`);
  c.mana -= R.mana;
  S.enchant = { id: b.id, rune, conduit: con, chisel: c.chisel || 0, tol: CH.tol,
                winMs: Math.round(R.sec * CO.time * 1000), t0: ctx.now };
});
def('enchantEnd', true, (ctx, a) => {
  const { S, c } = ctx, E = S.enchant;
  need(E && RUNES[E.rune], 'The rune bench has gone dark. Start the carving again.');
  const b = bladeById(c, E.id);
  need(b && b.status === 'owned', 'That blade has left your rack.');
  const tEnd = a.tEnd;
  need(Number.isInteger(tEnd) && tEnd >= 1 && tEnd <= RUNE_MAX_MS, 'That carving doesn’t add up. Try again.');
  const strokes = cleanStrokes(a.strokes, tEnd);
  need(strokes, 'That carving doesn’t add up. Try again.');
  // the server's clock is the referee: the carving lasted at least as long as the server saw it, minus a grace
  // for the network. A game clock that ran slow gets its points spread back out over the real time.
  const real = Math.max(tEnd, ctx.now - E.t0 - RUNE_GRACE_MS), k = real / tEnd;
  const fair = k === 1 ? strokes : strokes.map((s) => s.map(([x, y, t]) => [x, y, t * k]));
  const sc = runeScore(E.rune, fair, { tol: E.tol, winMs: E.winMs, tEnd: real });
  S.enchant = null;
  const R = RUNES[E.rune], CO = CONDUITS[E.conduit], CH = CHISELS[E.chisel];
  b.runes = b.runes || [];
  let res;
  if (sc.q < RUNE_FIZZLE) res = 'fizzle';                                             // didn't take: slot stays free
  else if (ctx.rng() < CO.risk) { res = 'backlash'; b.runes.push({ k: 'scar', q: 0, p: 0 }); }   // the slot is scarred
  else {
    const resonant = ctx.rng() < CH.res * sc.q * sc.q;
    const q = Math.round(sc.q * 1000) / 1000;
    const p = Math.round(R.v * q * CH.depth * CO.power * (resonant ? RESONANT : 1) * 1000) / 1000;
    b.runes.push(resonant ? { k: E.rune, q, p, r: 1 } : { k: E.rune, q, p });
    res = resonant ? 'resonant' : 'set';
    const cv = c.carve || (c.carve = { n: 0, r70: 0, r80: 0, r90: 0 });
    cv.n++; if (q >= .7) cv.r70++; if (q >= .8) cv.r80++; if (q >= .9) cv.r90++;
  }
  ctx.out = { res, score: sc, blade: b };
});
```

Then:
- `value(b, …)` gets one more factor, `× enchantMult(b)` (and the polishing factor, per `01-economy.md`).
- `reqMet` learns the three requirement types `r70`, `r80`, `r90` (from `c.carve`).
- `beginAction` calls `tickMana(ctx.c, ctx.now)` next to `tickFuel`.
- `newChar` adds `chisel: 0` (and `mana`/`manaTs` are filled in by `tickMana` once enchanting is unlocked).
- Export `runeScore`, `enchantMult`, `RUNES`, `CHISELS`, `CONDUITS` and the numbers, so the game uses them through
  `AMR.` as it does `AMR.strikeScore`. Then run `node tools/sync-rules.mjs`.
- Optional effects: the shop listing price × `RUNES.fortune.list` if the blade has a Fortune rune, and Arena power
  × `RUNES.valor.arena` if it has Valor.

Tests to add to `node tools/test.mjs`: the template itself (sent as strokes) scores q = 1; an empty carving fizzles;
a random scribble scores below 0.25; points after the window don't count; a slowed clock (all `t` halved) is
stretched back by the server; malformed strokes are refused; a fourth rune on a Steel-chisel blade is refused.

---

## 9. Implementation notes (browser)

### The plate

- A square panel, `width: min(88vw, 360px); aspect-ratio: 1`, made of two stacked canvases:
  - **The art canvas**, 120 × 120 art pixels shown with `image-rendering: pixelated`. It draws the close-up of the
    blade, standing upright and filling about 85% of the width: the type's steel colours (from its palette and
    rarity), a lighter bevel down each edge, the fuller if the type has one, and dark stone behind. Very narrow types
    (a stiletto) are simply zoomed in more, because the rune always needs the same room.
  - **The ink canvas** on top, at the device's pixel ratio, for the live line. The pointer events go here.
- **The guide** is drawn on the art canvas as dotted pixels at low opacity (every other art pixel, the way `arcRing`
  draws the dotted spokes of the rune circle), in the rune's glow colour. Covered parts of the guide brighten to full
  colour.
- **The carved groove:** as the player draws, the ink canvas shows a thin bright line right away for responsiveness.
  Every frame, the new pieces are also "cut" into the art canvas: a dark 1-pixel groove with a 1-pixel highlight
  below it (a bevel), glowing in the rune colour when that piece is near the guide (`nearCredit > 0.5`), and plain
  grey steel when it isn't. Sloppy lines stay visible as scratches, which is honest feedback.
- **The mana bar** sits under the plate: a pixel bar in the conduit's colour (copper, silver, stormglass violet)
  that drains smoothly, with a notch at 40% labelled "full charge". Below 20% it pulses.
- **The readout:** "Rune strength 84%", updated about 10 times a second from `AMR.runeScore` (rerun on every lift of the
  chisel too). Under it, smaller: "Lines 92% · Done 97%".
- **The reveal:** the groove fills with light along the strokes over 0.6 s, then the result banner appears. Resonant:
  a rainbow-white shimmer (reuse the shine sparkle). Backlash: a short red flash, a gentle shake (skipped when
  `prefers-reduced-motion` is set), and a jagged dark scar drawn across the rune. Fizzle: the glow fades out.
- **In the rack:** blades with runes get small glowing marks on the sprite in the rune colours (the strongest rune's
  glow as the blade's aura), a name suffix ("of Dawn"), and a tooltip line "Runes: Dawn 92% (Resonant) · Ward 81%".
  Adding `runes` to `HALL_KEYS` would show the glow in the Hall too (optional).

### Input

- On the ink canvas: `touch-action: none; user-select: none` (the way `#bellows` is set up), `pointerdown` with
  `setPointerCapture`, `pointermove`, and `pointerup`/`pointercancel` ending the stroke. Track **one pointer id only**,
  so a resting palm or a second finger is ignored. `getCoalescedEvents()` (where the browser has it) gives smoother
  lines from fast movement.
- Convert each pointer position to plate units: `x = round((clientX − rect.left) / rect.width × 1000)`, clamped
  0–1000, and the same for y. Keep a point only when it is 10 units or more from the last kept one.
- `t = round(performance.now() − E.t0)`. `E.t0` is set at the first `pointerdown`, the same moment `enchantStart` is
  sent.
- The carving ends at: **Set the rune**, `now − t0 ≥ winMs`, 400 points, or a 13th stroke. `tEnd = min(winMs, round(now
  − t0))`.
- If the tab is hidden during carving (`visibilitychange`), `requestAnimationFrame` stops. On return, if the window
  has passed, end the carving at once. The server's stretch makes this fair either way.
- Leaving the page in the middle of carving ends it with what has been carved so far.

### Sound (added to `SFX` in the same synthesized style)

```js
chisel:   (c, t, s = .5) => { noise(c, t, .035, 3600 + s * 2000, 2.5, .12); tone(c, 2100 + s * 900, t, .03, 'square', .015) },
manaLow:  (c, t) => tone(c, 330, t, .12, 'triangle', .05),
fizzle:   (c, t) => { noise(c, t, .6, 1200, .7, .1); tone(c, 600, t, .5, 'sine', .05, .4) },
backlash: (c, t) => { noise(c, t, .4, 700, 1.2, .35); tone(c, 220, t, .5, 'sawtooth', .07, .4) },
```

- `chisel` plays about every 60 units of carved line. Its pitch `s` comes from the carving speed, so fast carving
  sounds like a quick high scrape and slow carving like a deliberate tick. `buzz('LIGHT')` comes with it on phones.
- Setting the rune reuses `bind`. A Resonant rune plays `shine` then `legend`. The mana bar's last 20% ticks with
  `manaLow` twice a second.

### Phones

- The plate takes almost the full width (88vw), which is larger than on most desktops. The buttons sit **below** the
  plate so a thumb never presses them while carving.
- `touch-action: none` on the canvas stops the page from scrolling or zooming while you draw. No long-press menu
  (`-webkit-touch-callout: none`).
- A finger is less precise than a mouse. The scoring does **not** treat touch differently, because the server can't
  check which device was used. The longer windows (Silver, Stormglass) and wider chisels are what help.

### Accessibility and quick play

Drawing can't be done with the keyboard. If wanted, add a **Quick carve** like Quick forge: no mini-game, the server
rolls q between 0.30 and 0.50, same mana cost. This is the economy designer's call.

---

## 10. Open points for the economy designer

1. The final costs of the rune bench (the enchanting unlock), the chisels, the conduits and the runes. The suggestions
   above are scaled from today's anvils, quenches and patterns.
2. How `enchantMult` (about ×1.2–×4.8) stacks with polishing and the shop listing. This doc assumes the multipliers
   multiply each other.
3. The mana meter's size and refill (12, +1 per 4 minutes), and whether a Mana draught exists.
4. Whether to keep the two small effects (Valor +5% Arena power, Fortune +10% listing price), or keep runes as pure
   value.
5. Whether a scar can ever be ground out (for example for 10% of the blade's worth). This doc says no: the backlash
   risk should mean something.

Ideas considered and left out to keep it simple: making stroke order matter (needs arrows and explanation); a rune
"pour" choice (spend extra meter mana for a longer window); recognising which rune was drawn without choosing it first
(much harder to score reliably); quality wobble dice on top of the live score (players should get what they saw).
