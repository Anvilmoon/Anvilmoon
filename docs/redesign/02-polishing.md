# Polishing: the mini-game, the roll, stones and liquids

Polishing is the second craft. You take a blade you forged, scrub the grime and fire-scale off it with a stone,
and the server rolls how good the finished polish is. A good polish multiplies what the blade is worth.

- **What you do:** drag a whetstone back and forth along the blade. You wipe the grime off as you go, like a
  scratch-off card. Keep the stone at a steady speed: too slow does almost nothing, too fast skips and
  **scratches** the steel. As the steel gets brighter it scratches more easily, so you start with bold, fast
  strokes and finish with gentle ones.
- **What the server does:** it replays the stone's path, works out a **skill score from 0 to 1**, then rolls
  a **polish quality q from 0 to 100** and a **value multiplier m from ×1.0 to ×2.4**.
- **What you unlock:** better **stones** (like anvils: a better dice table), better **liquids** (like quenches:
  more reward, more risk) and, optionally, **buffing tools** (like hammers: a wider safe speed range).

Every number below is a starting point for playtesting. The economy designer (`01-economy.md`) sets the final
costs, and `04-balance.md` holds the agreed numbers.

---

## 1. Three ideas, and the one we pick

Polishing must feel different from **forging** (hold the bellows, then tap Strike at the right moment) and from
**enchanting** (draw a rune shape with the mouse). Ideas we considered:

| Idea | How it plays | Verdict |
|---|---|---|
| **A. Whetstone strokes** | Drag the stone left and right along the blade to wipe off grime (scratch-off). A speed meter shows a safe band. Too fast scratches. The band gets narrower as each part of the blade gets clean. | **Recommended.** It's about *how fast* you move and *where is still dirty*. The shape of your path doesn't matter, so it plays nothing like rune drawing, and there's no button timing like forging. |
| B. Keep the glint | A bright band drifts along the blade. Hold the stone inside it as it wanders. | It's tracking, too close to tracing a rune, and you just watch and follow. Easy to understand but dull after a few goes. |
| C. Rhythm passes | Swipe once per beat of a metronome, in sets of three passes. | Timing to a beat is very close to forging's "tap at the right moment". Audio lag on phones makes beat games unfair. |

(We also dropped a "keep a spinning wheel's speed in a band by holding a button" idea: that is the bellows again.)

### Why A works

- **One simple control.** Press and drag. With a mouse, hold the button. On a phone, use your finger. Only
  left and right movement counts, so it works on a small screen with the phone held either way.
- **A real decision under pressure.** The clock pushes you to go faster. Going faster scratches. Thick rust
  spots need extra scrubbing, so you also have to choose *where* to spend your seconds.
- **A built-in story.** Each go starts fast and rough and ends slow and careful, like real polishing.
- **15 to 20 seconds.** The session lasts at most 20 seconds and ends early when the blade is spotless.
- **It draws over the existing pixel blade.** Grime is a dithered mask on top of the blade sprite. It wipes away
  pixel by pixel.

---

## 2. The rules of Whetstone strokes

### What the player sees

```
 ┌──────────────────────────────────────────────────────────┐
 │ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ 14.2 s             │  time left (thin bar)
 │                                                          │
 │   ══╦═▓▓▓▓▒▒░░    ░░▒▒▓▓▓█████▓▓▒░        ░▒▓▓▓▓▓▓▒▶    │  the blade: dark = grime,
 │     ║        [■]   /  /                                  │  bright = clean, / = scratches
 │                    stone                                 │
 │  Too slow ░░░░░[██████ GOOD ██████]▒▒▒▒ Too fast         │  speed meter, ▲ = your speed
 │                        ▲                                 │
 │  Clean 61%            Scratches 2            [ Done ]    │
 └──────────────────────────────────────────────────────────┘
```

- **The track.** Think of a straight line under the blade, numbered 0 to 1000 from left to right. The steel runs
  from 50 to 950. The extra space at each end lets the stone run fully off the tip and the guard.
- **Strips.** The steel is split into **24 strips** side by side. Each strip has its own amount of grime
  (and its own scratches). The player never sees the strips as boxes, only grime fading away.
- **Grime.** Every strip starts with 0.5 grime. Then **three rust spots** add 1.0 to 1.5 more at their middle,
  fading out over 2 to 4 strips on each side. Where the spots land comes from a seed fixed when the polish
  starts, so the browser and the server agree.
- **The stone** sits on the blade at the pointer's left-right position. It covers 50 track units on each side
  of its centre, which is a little over 2½ strips.

### Inputs

| Device | Stone down | Move | Stone up |
|---|---|---|---|
| Mouse | hold the button on the blade | move left and right | release |
| Touch | finger on the blade | slide left and right (draw the stone a little *above* the finger so the finger doesn't hide it) | lift |
| Keyboard | hold **←** or **→** (or **A** / **D**) | the stone speeds up the longer you hold, from 0 to 2 tracks a second in about 0.8 s, and slows quickly when you let go | release both |
| Any | **Space** or the **Done** button ends early | | |

Up-and-down movement is ignored. The canvas sets `touch-action: none` so dragging doesn't scroll the page.

### Ticks (sampling)

The game records the stone's position every **50 ms** (20 times a second), as a whole number 0 to 1000, or
**-1** while the stone is lifted. It does this on the animation frame using a time accumulator: if a frame took
120 ms, the game writes two samples with the latest position. These samples are all the server ever sees, and
the browser drives the grime on screen from **the same samples with the same function**. So what you see wiping
away is exactly what the server will count.

At most **400 ticks** (20 seconds). The game stops early when every strip is clean (see "clean" below) or when the
player presses Done.

### What happens each tick

1. **Speed.** Take how far the stone moved in the last two ticks and average them. Speed is in *tracks per
   second*: 1.0 means crossing the whole track in one second. (A move of 50 track units in one tick = 1.0.)
   If the stone is lifted or didn't move, nothing happens this tick.
2. **Which strips.** For each strip, work out how far the stone travelled while over it this tick. One full
   pass of the stone over a strip counts as 1. A half pass counts as 0.5. So a slow stroke and a fast stroke
   over the same strip wear it the same amount: speed changes *quality*, not how much one pass removes.
3. **Bite (removing grime).** One full pass removes **0.08** grime from a strip. Below **0.4 tracks/s** the stone
   only drags and bites at **35%**. The buffing tool and the liquid can raise the bite.
4. **Speed limit (scratches).** Each strip has a speed limit:
   `limit = 1.4 × tool zone × (0.55 + 0.45 × grime left / grime at start)`.
   On a fresh, dirty strip the limit is 1.4 tracks/s. On a nearly clean strip it falls to 0.77. Going over the
   limit adds scratches, gently at first: going 0.4 over (or more) counts as a full scratch.
   `scratch += 0.08 × liquid scratch factor × min(1, (speed − limit) / 0.4) × pass`.
   Scratches are **permanent**. They show as thin bright lines and can't be polished out.
5. The speed meter shows the band for the strip under the middle of the stone, so the player sees the green
   band shrink as that part of the blade comes up bright.

### Failure modes

| What the player does | What happens |
|---|---|
| Moves too slowly (< 0.4 tracks/s) | The stone drags and does a third of the work. Nothing breaks, but the clock runs out with grime left. |
| Moves too fast | **Scratches.** The stone glows red, a scraping sound plays, bright scratch lines appear. Light overspeed is a light scratch. |
| Keeps the same fast speed to the end | The limit drops as strips get clean, so a speed that was safe at the start scratches at the end. |
| Only does full-length strokes | Fine early, but time is wasted on strips already clean while the rust spots still need work. |
| Stops early or runs out of time | The grime left lowers the score. |
| Teleports (bot or glitch) | A huge jump in one tick is a huge speed, so it scratches. The model punishes it on its own. |

### The skill score (0 to 1)

When the session ends:

- **clean** = the average over the 24 strips of `min(1, (1 − grime left / grime at start) / 0.97)`.
  A strip with 3% or less of its grime left counts as fully clean, so you don't hunt for the last speck.
- **finish** = `max(0, 1 − 1.5 × average scratch per strip)`. One whole-blade stroke at well over the limit costs
  about 12% finish.
- **skill s** = `clean × clean × clean × finish`. Cubing *clean* makes the last part matter:
  90% clean gives 0.73, 80% gives 0.51.

### How hard is it? (test bots, 30 blades each, with the plain rag)

These come from a quick simulation of the exact rules above. Real players will differ, so check in playtesting.

| Player | Plain rag (zone 1.0) | Felt pad (1.2) | Buffing wheel (1.4) |
|---|---|---|---|
| Frantic: full strokes at 1.3 to 1.8, jittery | 0.00 | 0.00 | 0.00 |
| Same speed (1.0) the whole time, never slows down | 0.32 | 0.70 | 0.92 |
| Slow and steady (0.7), full strokes | 0.69 | 0.76 | 0.82 |
| Average: aims at dirty patches, half adapts speed | 0.61 | 0.75 | 0.87 |
| Good: aims well, slows down near the end | 0.86 | 0.91 | 0.95 |
| Expert | 0.93 | 0.97 | 0.99 |

So a careful beginner gets about 0.6 to 0.7, a good player 0.85 to 0.9, and only near-perfect play gets 0.95 or more.

---

## 3. Server-authoritative scoring

It works like forging today: the browser sends raw, checkable inputs, and the server re-scores them with shared
code in `www/js/rules.js` and rolls all the dice.

### What the browser sends

`polishEnd { samples: [ 412, 431, 455, …, -1, -1, 700, 688, … ] }`

- One whole number per 50 ms tick: the stone's track position 0..1000, or -1 = lifted.
- At most 401 numbers (the start position plus 400 ticks). As JSON that is about **1.5 to 2 KB**, well inside the
  server's 1 MB request limit.

### What the server does

1. Checks there's a polish in progress (`S.polish`), and that the blade is still on the rack, not cracked and
   not polished yet.
2. **Sanity checks:**
   - `samples` is an array of at most **401** entries, every one a whole number from **-1 to 1000**.
   - **Not faster than real time:** `now − S.polish.t0 ≥ samples.length × 50 ms − 1,500 ms`. The 1.5 seconds of
     slack covers network delay. A 20-second polish can't arrive after 5 seconds.
   - There's no minimum count. Pressing Done at once just scores near 0. That's allowed and only hurts the
     player.
3. Runs `polishScore(seed, samples, fx)`: the same function the browser used on screen. It only uses `+ − × /`,
   `min`, `max` and `abs`, which give exactly the same answer in every browser and on the server.
4. Rolls the result with `ctx.rng` (section 4) and writes it on the blade.

### What a cheater can do at best

They can write a perfect sample list by hand or with a script. That gives **skill 1.0**: the same as a flawless
player. They can't choose q, m, a Mirror polish or avoid a stain, because those are rolled on the server. They
can't go faster than real time. Impossible jumps score as scratches. No game can tell a perfect bot from a
perfect human, so "perfect skill" is the accepted limit, just as for forging.

### Quitting halfway

If the player leaves the page or reloads during a polish, nothing is sent and the blade stays **unpolished**.
The energy and compound are gone (as with an abandoned forge). They may pay again and start over. This is a
paid retry, never a free one, and it never touches a result already rolled. The economy designer should price
the compound with that in mind.

---

## 4. The roll

Three parts add up to the quality q:

```
q = 50 × skill            (0..50: your hands)
  + the stone's dice      (a random number in the stone's range, e.g. 0..15 for the Coarse whetstone)
  + the liquid's bonus    (0, +6 or +12)
q is rounded and kept between 0 and 99. Only a Mirror polish is 100.
```

Before that, two special rolls:

1. **Stain** (only risky liquids): chance `liquid stain risk × (1.5 − skill)`. Good hands halve the risk. Careless
   hands raise it by half. A stained blade gets `m = ×0.8`: worth **less** than before. This is polishing's
   "crack", but it doesn't destroy the blade.
2. **Mirror polish** (the jackpot): chance `stone mirror chance × liquid mirror factor × skill × skill`, **doubled
   for a perfect polish (skill ≥ 0.95)**. A Mirror polish is `q = 100, m = ×2.4`, sparkles, and gets its own
   badge. It needs skill: at skill 0.5 the chance is a quarter of the full one.

Otherwise the multiplier follows q:

```
m = 1 + (q / 100) ^ 1.5        (rounded to 2 decimals)
```

| q | 0 | 10 | 25 | 40 | 50 | 60 | 75 | 90 | 99 | Mirror |
|---|---|---|---|---|---|---|---|---|---|---|
| m | ×1.00 | ×1.03 | ×1.13 | ×1.25 | ×1.35 | ×1.46 | ×1.65 | ×1.85 | ×1.99 | **×2.40** |

**Names** (shown on the blade card and the rack):

| q | Name |
|---|---|
| 0–24 | Dull polish |
| 25–49 | Bright polish |
| 50–74 | Gleaming polish |
| 75–99 | Radiant polish |
| 100 | **Mirror polish** |
| stained | Stained |

So a bad polish is about ×1.0, a good one ×1.3 to ×1.6, and the best stone and liquid with perfect skill gives
×1.8 to ×2.0, with a 10–14% chance of a ×2.4 Mirror. This matches the economy target of "×1.0 up to about ×2–2.5".

### Expected multiplier by stone and skill

These are averages, stains and Mirrors included. The skill columns match the bot table above: 0.3 is sloppy,
0.6 average, 0.8 good, 0.95+ perfect.

**Spring water** (safe: no bonus, no stain)

| Stone | skill 0 | 0.3 | 0.6 | 0.8 | 0.95 | 1.0 |
|---|---|---|---|---|---|---|
| Coarse whetstone | ×1.02 | ×1.11 | ×1.23 | ×1.33 | ×1.42 | ×1.45 |
| Grey stone | ×1.05 | ×1.15 | ×1.29 | ×1.40 | ×1.49 | ×1.53 |
| Yellow stone | ×1.09 | ×1.20 | ×1.35 | ×1.47 | ×1.57 | ×1.61 |
| Jade stone | ×1.12 | ×1.25 | ×1.41 | ×1.54 | ×1.65 | ×1.69 |
| Moonstone | ×1.17 | ×1.31 | ×1.48 | ×1.61 | ×1.75 | ×1.79 |

**Camellia oil** (+6, small stain risk, gentler on the steel)

| Stone | skill 0 | 0.3 | 0.6 | 0.8 | 0.95 | 1.0 |
|---|---|---|---|---|---|---|
| Coarse whetstone | ×1.03 | ×1.13 | ×1.27 | ×1.37 | ×1.47 | ×1.50 |
| Grey stone | ×1.07 | ×1.18 | ×1.33 | ×1.44 | ×1.54 | ×1.58 |
| Yellow stone | ×1.10 | ×1.23 | ×1.39 | ×1.51 | ×1.62 | ×1.66 |
| Jade stone | ×1.14 | ×1.28 | ×1.45 | ×1.58 | ×1.70 | ×1.74 |
| Moonstone | ×1.19 | ×1.34 | ×1.52 | ×1.66 | ×1.79 | ×1.83 |

**Acid wash** (+12, Mirror ×1.5, big stain risk, harsher in the mini-game)

| Stone | skill 0 | 0.3 | 0.6 | 0.8 | 0.95 | 1.0 |
|---|---|---|---|---|---|---|
| Coarse whetstone | ×1.01 | ×1.12 | ×1.26 | ×1.38 | ×1.49 | ×1.52 |
| Grey stone | ×1.04 | ×1.16 | ×1.32 | ×1.45 | ×1.56 | ×1.60 |
| Yellow stone | ×1.07 | ×1.20 | ×1.38 | ×1.51 | ×1.64 | ×1.68 |
| Jade stone | ×1.11 | ×1.25 | ×1.43 | ×1.58 | ×1.72 | ×1.76 |
| Moonstone | ×1.15 | ×1.30 | ×1.50 | ×1.65 | ×1.81 | ×1.85 |

Acid looks only a little better on average. But it also scratches 30% more in the mini-game, so the same player
usually scores lower with it. It is a gamble for skilled players chasing Mirrors, not a free upgrade. That's the
same deal water quenching offers today.

**Mirror chance** (Spring water / Acid wash)

| Stone | skill 0.6 | 0.8 | 0.95 | 1.0 |
|---|---|---|---|---|
| Coarse whetstone | 0.2% / 0.2% | 0.3% / 0.4% | 0.9% / 1.2% | 1.0% / 1.4% |
| Grey stone | 0.4% / 0.5% | 0.6% / 0.8% | 1.8% / 2.4% | 2.0% / 2.7% |
| Yellow stone | 0.7% / 0.9% | 1.3% / 1.7% | 3.6% / 4.9% | 4.0% / 5.5% |
| Jade stone | 1.1% / 1.4% | 1.9% / 2.5% | 5.4% / 7.3% | 6.0% / 8.2% |
| Moonstone | 1.8% / 2.3% | 3.2% / 4.2% | 9.0% / 12.2% | 10.0% / 13.7% |

**Stain chance:** Camellia oil 7.5% at skill 0, 4.5% at 0.6, 2.5% at 1.0. Acid wash 27% at skill 0,
16% at 0.6, 9% at 1.0.

### What that means in coins

The multiplier applies to the blade's whole value, so polishing is worth most on your best blades:

| Blade (worth before) | Grey stone, water, skill 0.6 (×1.29) | Moonstone, acid, skill 0.95 (×1.81 average) |
|---|---|---|
| Common Light, grade 70 (≈10c) | ≈13c (+3) | ≈18c (+8) |
| Masterwork Medium, grade 80 (≈53c) | ≈68c (+15) | ≈96c (+43) |
| Legendary Heavy, grade 85 (≈538c) | ≈694c (+156) | ≈974c (+436) |

With a per-polish cost of roughly 1 energy plus a few coins (section 6), polishing Commons barely pays. Players
learn to polish their good blades. That's the decision we want.

---

## 5. Stones, liquids and buffing tools

The three kinds of unlock each change one thing, so they're easy to explain:

- **Stone** = the dice (like the anvil's rarity table). It doesn't change the mini-game.
- **Liquid** = a trade-off (like the quench): a bonus to q against stain risk, and a small change to the mini-game.
- **Buffing tool** = easier mini-game (like the hammer's wider sweet spot).

### Stones (the "anvil" of polishing)

Bought in order, like anvils. The Coarse whetstone comes free with polishing.

| Stone | Dice adds | Mirror chance (at skill 1, before doubling) | Suggested cost | Compare (anvil at the same step) |
|---|---|---|---|---|
| Coarse whetstone | 0–15 | 0.5% | free with polishing | Rough Anvil (free) |
| Grey stone | 5–22 | 1% | 250c | Iron Anvil 80c + 15 iron |
| Yellow stone | 10–28 | 2% | 800c + 3 damascus | Steel Anvil 400c + 30 iron + 4 damascus |
| Jade stone | 15–34 | 3% | 2,500c + 10 damascus + 1 shard | Damascus Anvil 1,500c + 12 damascus + 2 shards |
| Moonstone | 20–40 | 5% | 7,000c + 25 damascus + 6 shards | Dragonbone Anvil 5,000c + 30 damascus + 8 shards |

The costs sit a little above the anvils because polishing comes later, when the player earns more. Stones use
coin, damascus and shards, not iron (a stone isn't made of iron).

### Liquids (the "quench" of polishing)

The keys are deliberately different from the quench keys (`oil`, `brine`, `water`) so `knows()` never mixes
them up.

| Key | Liquid | q bonus | Stain risk (× (1.5 − skill)) | Mirror factor | In the mini-game | Suggested cost | Compare |
|---|---|---|---|---|---|---|---|
| `spring` | Spring water | +0 | 0% | ×1 | normal | free | Oil quench (free) |
| `camellia` | Camellia oil | +6 | 5% | ×1 | scratches ×0.7 (the stone glides) | 200c | Brine 100c |
| `acid` | Acid wash | +12 | 18% | ×1.5 | bite ×1.2 (faster) but scratches ×1.3 | 700c, needs "Polish 10 blades with skill 0.7 or better" | Water 400c, needs 10 blades of grade ≥ 70 |

A stain looks like a brown etched blotch. Flavour text: "The acid bit too deep."

### Buffing tools (optional, the "hammer" of polishing)

| Tool | Speed limit ×(zone) | Bite × | Durability | Suggested cost | Repair | Compare |
|---|---|---|---|---|---|---|
| Polishing rag | ×1.0 | ×1.0 | never wears | free | – | Worn Hammer |
| Felt pad | ×1.2 | ×1.1 | 50 polishes | 150c + 1 damascus | 30c | Smith's Hammer 120c + 10 iron + 1 damascus |
| Buffing wheel | ×1.4 | ×1.2 | 50 polishes | 1,100c + 6 damascus + 1 shard | 150c | Master Hammer 900c + 6 damascus + 1 shard |

These are milder than the hammers' ×1.3 and ×1.6 on purpose. In the simulation a ×1.6 wheel let almost anyone
reach skill 0.95. Like hammers, durability drops by 1 per polish and a worn-out tool works like the rag.

If the team wants fewer new things, buffing tools can wait. The game works with just stones and liquids.

---

## 6. Cost per attempt and limits

- **Each polish costs 1 energy + 1 polishing compound.** Compound is a new Market item. A suggested price is
  **6c** (iron is 4c, coal 3c). Energy is shared with forging, so the player chooses between making a new
  blade and improving an old one. That's a good tension. The economy designer may scale compound by weight
  (Light 1, Medium 1, Heavy 2, Massive 3, like coal).
- **Each blade can be polished once.** The result is final.
- **Can't be polished:** cracked blades, keepsakes or gifts, blades not on the rack (listed, sold, at stake in a
  wager, delivered).
- **Polish before you enchant.** Suggestion for `03-enchanting.md`: an enchanted blade can't be polished,
  because the stone would scrub off the rune. This keeps the order forge → polish → enchant.

---

## 7. Data shapes, actions and code

### On the blade

```js
b.polish = {
  q: 64,          // quality 0..100 (100 = Mirror)
  m: 1.51,        // value multiplier (0.8 if stained)
  s: 0.82,        // skill score, 2 decimals (for Records / curiosity)
  stone: 2,       // stone index used
  liquid: 'camellia',
  t: 1764000000000,
  mirror: true,   // only when it's a Mirror polish
  stain: true,    // only when stained
}
```

`value()` multiplies by it: `… × (b.polish ? b.polish.m : 1)`.

### On the smith

| Field | Meaning |
|---|---|
| `c.recipes.polish` | polishing learned (bought in the Workshop) |
| `c.stone` | best stone owned, an index 0..4, like `c.anvil` |
| `c.recipes.camellia`, `c.recipes.acid` | liquids learned (`spring` is always known) |
| `c.buff`, `c.buffs` | equipped tool and owned tools with durability, like `c.hammer` / `c.hammers` |
| `c.compound` | polishing compound in stock |
| `c.polished`, `c.polishGood` | counters: blades polished, and polished with skill ≥ 0.7 (for the Acid requirement) |

### During a polish (in the save, like `S.forge`)

```js
S.polish = { id: 12, stone: 2, liquid: 'camellia', buff: 'felt', seed: 3912345678, t0: 1764000000000 }
```

The stone and tool are copied at the start, so changing gear mid-polish changes nothing.

### Numbers (top of rules.js, next to ANVILS and QUENCH)

```js
// ---- polishing: the mini-game (see docs/redesign/02-polishing.md)
const POLISH = {
  TICK: 50,            // ms between samples: 20 a second
  MAX_TICKS: 400,      // 20 seconds at most
  SLACK: 1500,         // ms of network slack in the "not faster than real time" check
  SEG: 24,             // the steel is split into 24 strips
  A: 50, B: 950,       // where the steel starts and ends on the 0..1000 track
  R: 50,               // the stone covers this far either side of its centre
  GRIME: 0.5,          // grime on every strip at the start
  SPOT: [1.0, 0.5],    // three rust spots add 1.0 + up to 0.5 more at their middle
  BITE: 0.08,          // grime one full pass removes
  SLOW: 0.4,           // below this speed (tracks a second) the stone drags...
  SLOW_BITE: 0.35,     // ...and bites at 35%
  FAST: 1.4,           // speed limit on a dirty strip (tracks a second)
  FAST_END: 0.55,      // on a clean strip the limit is 55% of that
  RAMP: 0.4,           // this far over the limit is a full scratch
  SCRATCH: 0.08,       // scratch from one full pass at full overspeed
  SCRATCH_W: 1.5,      // finish = 1 - 1.5 x average scratch
};
// ---- polishing: the roll
const STONES = [
  { n: 'Coarse whetstone', lo: 0,  hi: 15, mirror: .005, d: 'Comes with polishing.' },
  { n: 'Grey stone',       lo: 5,  hi: 22, mirror: .01,  cost: { coin: 250 } },
  { n: 'Yellow stone',     lo: 10, hi: 28, mirror: .02,  cost: { coin: 800, damascus: 3 } },
  { n: 'Jade stone',       lo: 15, hi: 34, mirror: .03,  cost: { coin: 2500, damascus: 10, shards: 1 } },
  { n: 'Moonstone',        lo: 20, hi: 40, mirror: .05,  cost: { coin: 7000, damascus: 25, shards: 6 } },
];
const LIQUIDS = {
  spring:   { n: 'Spring water', bonus: 0,  stain: 0,   mirror: 1,   bite: 1,   scr: 1,  d: 'Safe. No bonus.' },
  camellia: { n: 'Camellia oil', bonus: 6,  stain: .05, mirror: 1,   bite: 1,   scr: .7, d: '+6 quality, small stain risk. The stone glides.' },
  acid:     { n: 'Acid wash',    bonus: 12, stain: .18, mirror: 1.5, bite: 1.2, scr: 1.3, d: '+12 quality, Mirror more likely, big stain risk. Scratches easily.' },
};
const BUFFS = {
  rag:   { n: 'Polishing rag', zone: 1,   bite: 1,   d: 'Never wears out.' },
  felt:  { n: 'Felt pad',      zone: 1.2, bite: 1.1, dur: 50, cost: { coin: 150, damascus: 1 }, repair: { coin: 30 } },
  wheel: { n: 'Buffing wheel', zone: 1.4, bite: 1.2, dur: 50, cost: { coin: 1100, damascus: 6, shards: 1 }, repair: { coin: 150 } },
};
const MIRROR_M = 2.4, STAIN_M = 0.8, PERFECT_POLISH = .95;
const POLISH_COST = { fuel: 1, compound: 1 };
```

### The shared scoring code (pure functions in rules.js, exported in `G.AMR`)

```js
// The grime on each strip at the start, from the polish's seed. Same seed = same blade on both sides.
function polishInit(seed) {
  const r = mulberry(seed), t0 = new Array(POLISH.SEG).fill(POLISH.GRIME);
  for (let k = 0; k < 3; k++) {                       // three rust spots
    const c = Math.floor(r() * POLISH.SEG), w = 2 + Math.floor(r() * 3), h = POLISH.SPOT[0] + POLISH.SPOT[1] * r();
    for (let i = c - w; i <= c + w; i++) if (i >= 0 && i < POLISH.SEG) t0[i] += h * (1 - Math.abs(i - c) / (w + 1));
  }
  return { t0, t: t0.slice(), scr: new Array(POLISH.SEG).fill(0) };
}
// What the gear does: zone = speed-limit multiplier, bite and scr = multipliers on grime removed and scratches.
const polishFx = (P) => ({ zone: BUFFS[P.buff].zone, bite: BUFFS[P.buff].bite * LIQUIDS[P.liquid].bite, scr: LIQUIDS[P.liquid].scr });
// One 50 ms tick. x2, x1, x0 = where the stone was two ticks ago, one tick ago and now (-1 = lifted).
// Changes st. Returns how far over the speed limit the stone was (0 = fine), for the red glow and the scrape sound.
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
    const limit = POLISH.FAST * fx.zone * (POLISH.FAST_END + (1 - POLISH.FAST_END) * st.t[i] / st.t0[i]);
    const over = clamp((v - limit) / POLISH.RAMP, 0, 1);
    st.t[i] = Math.max(0, st.t[i] - bite * pass);
    st.scr[i] += POLISH.SCRATCH * fx.scr * over * pass;
    if (over > worst) worst = over;
  }
  return worst;
}
// clean, finish and the skill score from a state
function polishResult(st) {
  let clean = 0, scr = 0;
  for (let i = 0; i < POLISH.SEG; i++) { clean += Math.min(1, (1 - st.t[i] / st.t0[i]) / .97); scr += st.scr[i]; }
  clean /= POLISH.SEG; scr /= POLISH.SEG;
  const finish = Math.max(0, 1 - POLISH.SCRATCH_W * scr);
  return { clean, finish, s: clean * clean * clean * finish };
}
// The whole polish from its samples. The browser calls polishTick live; the server calls this once.
function polishScore(seed, samples, fx) {
  const st = polishInit(seed);
  for (let k = 1; k < samples.length; k++) polishTick(st, k >= 2 ? samples[k - 2] : -1, samples[k - 1], samples[k], fx);
  return polishResult(st);
}
// The roll (server only: needs rng)
const polishMult = (q) => 1 + Math.pow(q / 100, 1.5);
const polishName = (p) => (p.stain ? 'Stained' : p.q >= 100 ? 'Mirror polish' : p.q >= 75 ? 'Radiant polish' : p.q >= 50 ? 'Gleaming polish' : p.q >= 25 ? 'Bright polish' : 'Dull polish');
function rollPolish(s, stone, liquid, rng) {
  const S = STONES[stone], L = LIQUIDS[liquid];
  if (rng() < L.stain * (1.5 - s)) return { q: 0, m: STAIN_M, stain: true };
  if (rng() < S.mirror * L.mirror * s * s * (s >= PERFECT_POLISH ? 2 : 1)) return { q: 100, m: MIRROR_M, mirror: true };
  const q = clamp(Math.round(50 * s + L.bonus + S.lo + (S.hi - S.lo) * rng()), 0, 99);
  return { q, m: Math.round(polishMult(q) * 100) / 100 };
}
```

### The actions

```js
// ---- polishing: start (pay), then end (score the strokes, roll the polish)
def('polishStart', false, (ctx, a) => {
  const { S, c } = ctx, b = bladeById(c, a.id), liquid = String(a.liquid || '');
  need(c.recipes.polish, 'Learn polishing in the Workshop first.');
  need(b && b.status === 'owned' && !isGift(b), 'Pick a blade from your rack.');
  need(!b.cracked, 'A cracked blade can’t be polished.');
  need(!b.polish, 'That blade has already been polished.');
  need(!b.ench, 'Polish a blade before you enchant it.');
  need(LIQUIDS[liquid] && (liquid === 'spring' || c.recipes[liquid]), 'Learn that liquid in the Workshop first.');
  need(canPay(c, POLISH_COST), 'You need 1 energy and 1 polishing compound.');
  payCost(c, POLISH_COST);
  const buff = buffKey(c);                         // the equipped tool, or 'rag' if it's worn out (like hammerFx)
  if (buff !== 'rag') c.buffs[buff].dur--;
  S.polish = { id: b.id, stone: c.stone, liquid, buff, seed: hash32(`${c.name}:${b.id}:${S.serial}`), t0: ctx.now };
});
def('polishEnd', true, (ctx, a) => {
  const { S, c } = ctx, P = S.polish;
  need(P, 'You aren’t polishing anything. Start again.');
  const b = bladeById(c, P.id);
  need(b && b.status === 'owned' && !b.cracked && !b.polish, 'That blade isn’t on your rack any more.');
  const x = Array.isArray(a.samples) ? a.samples : [];
  need(x.length <= POLISH.MAX_TICKS + 1 && x.every((v) => Number.isInteger(v) && v >= -1 && v <= 1000), 'That polish doesn’t add up. Start again.');
  need(ctx.now - P.t0 >= x.length * POLISH.TICK - POLISH.SLACK, 'That was quicker than any stone. Start again.');
  S.polish = null;
  const r = polishScore(P.seed, x, polishFx(P)), roll = rollPolish(r.s, P.stone, P.liquid, ctx.rng);
  b.polish = { q: roll.q, m: roll.m, s: Math.round(r.s * 100) / 100, stone: P.stone, liquid: P.liquid, t: ctx.now };
  if (roll.mirror) b.polish.mirror = true;
  if (roll.stain) b.polish.stain = true;
  c.polished = (c.polished || 0) + 1; if (r.s >= .7) c.polishGood = (c.polishGood || 0) + 1;
  chEvent(ctx, { k: 'polish', b });                // for future challenges ("Polish 3 blades")
  ctx.out = { polish: b.polish, clean: r.clean, finish: r.finish, s: r.s };
});
```

Plus the shop actions, following `anvil`, `learn`, `hammer`, `equip` and `repair`: `stone` (buy the next stone),
`learn` with `polish`, `camellia` and `acid` recipes, and `buff` / `equipBuff` / `repairBuff` if tools are in.
`buy` gets `compound` added to `PRICES` and `MATN`.

### In the browser (shape only)

```js
// like F for the forge
PL = { id, seed, fx, st: AMR.polishInit(seed), samples: [], x: -1, down: false, acc: 0, last: performance.now(), done: false };
// every animation frame:
PL.acc += now - PL.last; PL.last = now;
while (PL.acc >= 50 && PL.samples.length <= 400) {
  PL.acc -= 50;
  const s = PL.samples, cur = PL.down ? Math.round(PL.x) : -1;
  s.push(cur);
  const n = s.length;
  if (n >= 2) PL.over = AMR.polishTick(PL.st, n >= 3 ? s[n - 3] : -1, s[n - 2], s[n - 1], PL.fx);
}
// draw from PL.st; end when 400 ticks, Done, or every strip is clean, then:
const r = await act('polishEnd', { samples: PL.samples }, { hold: true });
```

### Tests to add

- `tests/rules.test.mjs`: `polishScore` gives the same answer twice. A made-up perfect stroke list reaches
  s ≥ 0.95. A list that jumps 0 → 1000 → 0 scores mostly scratches. `rollPolish` with a fixed rng gives
  the expected q.
- `tests/server.test.mjs`: polishing twice is refused, a cracked blade is refused, a 400-sample polish sent
  1 second after the start is refused, non-whole numbers and values over 1000 are refused, and the blade's
  value goes up by `b.polish.m`.

---

## 8. Notes for the implementer: look and sound

### Canvas and layout

- One canvas, full width of the page (≥ 320 px on phones), about **140 px tall on phones, 180 px on desktop**.
  Draw at art-pixel size and scale up with `image-rendering: pixelated`, like the forge's `#hotpx`.
- **The blade** is the normal pixel blade (same renderer as the rack, so rarity colours show), laid
  horizontally and scaled to fill the track from 50 to 950.
- **Grime overlay:** for every art pixel of the blade (use the sprite's alpha as the mask), work out its strip
  from its x. Give each pixel a fixed random threshold 0..1 from a hash of its position. Draw the grime pixel
  only while `grime left / grime at start > threshold`. This gives the dithered, scratch-off look: the blade
  clears pixel by pixel, unevenly, rust spots last. Colours: grime `#4a3b2a` / `#5c4a30`, rust spots
  `#7a3f1e` / `#8f5226` (mixed by how much spot each strip has).
- **Shine:** clean strips get a soft white highlight row along the blade's spine. A brighter glint follows the
  stone across clean steel.
- **Scratches:** for each strip draw `min(6, floor(scratch / 0.02))` thin 1-pixel diagonal lines in
  `#e9e4da`. Their positions come from a hash of strip and line number, so they stay put.
- **The stone:** a small pixel block, about 12 × 7 art pixels, coloured by tier (Coarse brown-grey, Grey,
  Yellow ochre, Jade green, Moonstone pale blue with a twinkle). It turns orange then red as `over` rises.
  On touch, draw it about 40 px above the finger.
- **Liquid:** a few droplet pixels trail the stone in the liquid's colour (water pale blue, camellia amber,
  acid sickly green). Acid adds an occasional tiny fizz pixel.
- **Speed meter** under the canvas: a horizontal bar from 0 to 2.5 tracks a second, grey "too slow" zone up to
  0.4, a green band up to the limit of the strip under the stone (it visibly shrinks as that strip gets clean),
  red beyond. A needle shows the current speed (the same two-tick average the rules use). Words under it:
  "Too slow", "Good", "Too fast!".
- **Read-outs:** a thin shrinking time bar along the top, "Clean 61%" (live `clean` from `polishResult`),
  "Scratches 2" (the number of strips with a visible scratch), and a **Done** button. Big enough to read on a
  small phone.
- **Before starting:** a short panel to pick the liquid (buttons like the quench buttons, with the risk text)
  and a line saying which stone and tool are in use, plus "Costs 1 energy + 1 compound".
- **The result:** show "Clean 96% · Finish 100% · Skill 0.88", then the roll as a bar filling up to q with
  rising ticks (like the forge reveal). Show the name ("Gleaming polish") and "Worth ×1.48: 53c → 78c".
- **Mirror polish:** a white glint sweeps the whole blade, the screen flashes softly, sparkle pixels (reuse the
  Starforged sparkle look) and the badge "Mirror polish". With reduced motion turned on, skip the flash.
- **Stain:** a brown blotch spreads from a random strip in about half a second. The value change shows in red.
- On the rack and blade cards: a small badge with the polish name, and a permanent gentle sparkle on Mirror
  blades.

### Sound (in the existing `SFX` Web Audio style: synthesized, no files)

- **Rubbing (new, continuous):** one looping noise source through a bandpass filter and a gain, made at the
  start of a polish and stopped at the end. Each tick, while the stone is down: gain `0.02 + 0.08 × min(speed, 1.5)
  / 1.5`, filter frequency `700 + 900 × speed`. Fade to silence when lifted. Add it as `SFX.loop('rub')`
  returning `{ set(speed), stop() }`, and respect `SFX.muted`.
- **Scrape (new, one-shot):** when `over > 0`, a short harsh chirp: `tone(c, 2400, t, .06, 'sawtooth', .04 × over, .6)`
  plus a little noise at 4,000 Hz. Play it at most once every 120 ms. Also `buzz('LIGHT')`.
- **A strip comes clean:** the existing `tick`. **The whole blade is clean:** the existing `coin`.
- **Result:** the existing `reveal` with the tier (0 to 4). **Mirror:** `shine` then `legend`, and
  `buzz('HEAVY')`. **Stain:** a low, dull version of `crack` (noise at 500 Hz, no high tone).

---

## Summary of key numbers

| Thing | Value |
|---|---|
| Session | ≤ 20 s, 20 samples a second, ≤ 401 whole numbers (≈ 2 KB) |
| Speed band (rag) | 0.4 to 1.4 tracks a second on dirty steel, down to 0.77 on clean steel |
| Skill | clean³ × finish |
| Quality | 50 × skill + stone dice (0–15 … 20–40) + liquid (0 / +6 / +12), max 99 |
| Multiplier | 1 + (q/100)^1.5: ×1.0 to ×1.99. Mirror ×2.4. Stain ×0.8 |
| Mirror chance | stone 0.5% … 5% × skill², ×2 at skill ≥ 0.95, ×1.5 with acid |
| Cost | 1 energy + 1 compound (≈ 6c), once per blade, not for cracked blades |
