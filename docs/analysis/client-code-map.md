# Client code map (`www/index.html`)

One file, no modules. Lines 1–22 head/meta, 23–1169 CSS, 1171–1179 the HTML shell, 1180–3550 the script.
Code is written as dense one-liners; line numbers below are for commit `c4def0a`.

## HTML shell (lines 1171–1179)

```html
<header>  logo (nav → home) + #hud (name, resources, sync status, sound)
<nav class="rail">  #tabs (menu / phone bottom bar) + #opts (dev-only test toggles)
<main id="view">  the current page, replaced wholesale by render()
#rackfab #drawer      the rack drawer (slides up)
#mailbox #boardpop    mailbox sheet, commission-board popup
#overlay              forge-result reveal
#toast                toasts
```
Created on the fly: `#rackhandle`, `#tour`, `.qseq` (quench animation overlay).

## Script sections

| Lines | Section | Key contents |
|---|---|---|
| 1181–1349 | DATA | `CLASSES` (4), `TYPES` (100 blade types + 2 gift types), `WT` weight classes, `RAR` rarities, `ANVILS`, `HAMMERS`, `SIZES`, `SHINE`, `QUENCH`, `PRICES`, `PATRONS`, `mulberry()` PRNG |
| 1351–1389 | STATE | `A` (the save), `load/save/writeLocal`, `freshAcct`, `newChar`, `unify()` (folds old multi-smith saves into one), `C()` current smith, class learning/switching |
| 1391–1451 | HELPERS | `RECIPES`, `knows()`, `MEALS`, `isNight/rollMoon`, `armoryProgress/claimArmory`, `value()`, `salvYield()`, `tickFuel()`, `heatColor()`, `hammerFx()` |
| 1453–1461 | ROLLS | `rollIdx`, `rollSize`, `rollShine`, `rollVariant`, `makeBlade()` |
| 1463–1628 | BLADE ART (vector) | `SHAPES` (25 profile functions), `BEND` (curvature), `bladeDims()`, `bladeVec()` → SVG string with grip, pommel, blade, fullers, damascus, runes, guards, ruler |
| 1632–1839 | `PX` pixel renderer | `mask()` rasterises a flat-colour SVG to a part map (blade/grip/metal), `render()` repaints it as pixel art with palettes per rarity/shine/variant, outline and glow rings, cached by `keyOf()`; `hot()`/`drawHot()`/`drawShaped()`/`drawArc()` for the glowing billet in the forge; `anvil()`, `bricks()`, `puff()` sprites |
| 1841–1865 | `bladeSVG()` | Public entry: returns cached pixel `<img>` or a vector placeholder (`.pxpend`) that is swapped when the async render finishes. `pxWarm()` pre-renders |
| 1867–1874 | COMMISSIONS | `genComm()`, `qualifies()`, `ensure()` (keeps 3 orders) |
| 1876–1886 | RECORDS | `refreshRecords()`, `entries()` (local blades + server entries), `isRecord()` |
| 1888–1984 | RENDER | `ICONS`, `renderHUD()`, `renderTabs()`, **`render()`**, tag helpers, `hardTimes()`, `pinRow()`, **`vForge()`** |
| 1987–2086 | TOUR | `TOUR_STEPS`, practice demo (`TD`), spotlight placement, click blocking during "do" steps |
| 2089–2110 | Commission board | `precious()`, `deliverable()`, `boardHTML()`, `renderBoard()` |
| 2112–2184 | Rack drawer | `RACK` state, filters, stacks (`stackKey`), `renderDrawer()`, bulk sell/salvage (`bulkState`, `bulkDo`) |
| 2186–2245 | Workshop, Market | `vWorkshop()`, quantity rows `qRow/qSync`, `vMarket()` |
| 2247–2312 | Armory, Records, Account | `vArmory()`, `vRecords()` (7 boards + standings), `vChars()`, `SETTINGS_PLATE()` |
| 2315–2338 | `SFX` | Web Audio synth: strike, hiss, tick, rune, bind, reveal, legend, shine, coin, crack, click |
| 2341–2502 | FORGING | Arcane rune circle (`ARC`, `arcRing`), `startForge()`, `loop()` (rAF), `strike()`, `quickForge()`, barrel sprites, `startQuench()`/`quenchSeq()` (animated plunge + length count), `forgeResult()`, `handOver()` (day labour) |
| 2504–2567 | STAGED REVEAL | `cardHTML(b, stage)` stages 0–4, `showReveal()`, `revealRun()`, `revealAfter()`, `closeReveal()` |
| 2569–2574 | ACTIONS | `sellBlade()`, `salvBlade()`, `sellAllTotal()` |
| 2575–2707 | ONLINE | `SERVER`, `NET`, `apiCall()`, `scrub()`, `netInit()`, OAuth, recovery codes, `afterLogin()`, `oneName()` (re-signs blades to the username), `pollLoop()`, `mergeSaves()`, `syncSave()`, `pushSave()`, `queueSave()`, `doAuth()` |
| 2709–2773 | AUCTION HOUSE | `refreshAH()`, mail (`fetchMail`, `renderMailbox`, `collectOne`), `ahCreate()`, `ahBid()`, `ahCancel()` |
| 2775–2819 | ARENA | `ARENA` state, `arenaUpdate()`, `arenaQueue()`, `arenaMove()`, `vArena()` |
| 2821–2919 | MENU, HOME, CHALLENGES | `NAV`, `navHTML()`, `GS_STEPS` getting-started, `vHome()`, `PAGE_TIPS`, challenge generator (`CH_POOL`, `CH_WEEK`, `chList`, `chEvent`), `vTasks()` |
| 2921–3124 | `FIGHT` | Procedural jointed pixel character (poses, rig, layered limbs, hair styles, sword, lighting). Used for full-body look images |
| 3126–3295 | `FACE`, `FACE2`, looks | 34×34 portrait, animated large portrait (breathes, blinks), official-account emblem with winter variant, `lookFor(name)` (default look hashed from name), `lookImg()`, look editor |
| 3296–3349 | SMITH'S HALL | `BADGES`, `TITLES` (22), `hallCtx()`, `hallSummary()` (saved into `A.hall`), `openHall()`, `smithName()`, `vHall()` |
| 3351–3394 | ACCOUNT SCREENS | `accountPlate()` (sign in / create / forgot / linked sign-ins / recovery), auth form submit handler |
| 3396–3441 | AH views | `vAuction()`, `ahBrowse()`, `ahSell()`, `ahMine()`, `ahRow()` |
| 3443–3528 | **`ACT`** | Every button handler, keyed by `data-action` |
| 3529–3548 | Boot | global click delegation (with two-click confirm), smith-creation form, keyboard (Space = strike, F = bellows), Capacitor hooks, service worker, timers, `netInit()`, `?smith=` deep link, first `render()` |

## How the UI works

- **Immediate-mode rendering.** `render()` rebuilds `#view.innerHTML` from the view function for `A.tab`
  (`{home:vHome, forge:vForge, workshop:vWorkshop, market:vMarket, auction:vAuction, arena:vArena,
  armory:vArmory, records:vRecords, chars:vChars, hall:vHall, tasks:vTasks}`), plus HUD, menu, rack drawer,
  mailbox and commission board. Drawer and board diff their HTML string and skip the DOM write if unchanged,
  preserving scroll and focus.
- **Event delegation.** One `click` listener finds the nearest `[data-action]` and calls `ACT[action](el)`.
  `data-confirm` turns a button into a two-click confirm ("Sure?" for 2.5 s). Forms, `input` and `change`
  have their own delegated listeners keyed by `data-rack`, `data-bf`, `data-ah`, `data-ahf`, `id`.
- **The forge bypasses render().** `startForge()` writes its own markup into `#view` and drives a
  `requestAnimationFrame` loop. While `F` (forge state) or `revealId` is set, `render()` returns early after
  the chrome, and navigation is blocked ("Finish the blade first").
- **Overlays:** reveal in `#overlay`; quench animation in a `.qseq` element appended to `body`.
- **Accessibility/motion:** `prefers-reduced-motion` shortens or skips animations; ARIA roles on dialogs/tabs.

## Global state objects

| Name | Holds |
|---|---|
| `A` | The persisted save (see data-model.md) |
| `F` | Current forging session (heat `T`, strikes, burns, cold, runes for arcane, sprite) or `null` |
| `UI` | Ephemeral UI flags: `rack`, `board`, `mail`, `sup`, `more`, `armCls`, `recCls`, `recPage`, `wsOpen` |
| `NET` | Token, user, offline flag, auth form state, poll versions (`pv`, `pm`, `pa`, `pp`) |
| `SYNC` | Save badge state: local / saving / saved / offline / error |
| `RACK`, `ahUI`, `ARENA`, `HALL`, `MAIL`, `REC`, `TOUR`, `TD` | Per-feature UI/data state |
| `AHL` | Current auction listings |
| `ENT` | Cached Records entries (cleared on every `save()`) |

## Background timers

| Interval | Does |
|---|---|
| 5 s | Demand of every blade type drifts 3% back toward 1.0, then **`save()`** (also checks if a class unlocked) |
| 75 s | A random blade of your class gets +0.4 demand (cap 1.6) and a "Merchants are clamoring" toast |
| 1 s | HUD refresh (energy timer), dig countdown, arena queue state and round clock |
| 120 ms | Repaint live animated portraits (`faceTick`) |
| 8 s / 1.5 s | `pollLoop()` |
| 60 s | `fetchMail()`, auction refresh if on that tab |

## Site → code map

| What you see on anvilmoon.net | Code |
|---|---|
| Welcome / sign-in / create account | `vChars()` when `needAcct()`, `accountPlate()` |
| Header (name, coin, energy timer, materials, "Saved" badge, sound) | `renderHUD()`, `renderSync()` |
| Menu (Make / Trade / Compete / Yours), phone bottom bar + More | `NAV`, `NAV_BAR`, `navHTML()`, `navGo()` |
| Home (getting started steps, "waiting for you", tiles) | `vHome()`, `GS_STEPS`, `gsMark()` |
| Forge page (blade picker by weight, costs, tools, Supplies popup, last forges, pinned orders) | `vForge()` |
| Forging mini-game (bellows, strike bar, heat indicator, pips) | `startForge()`, `loop()`, `strike()`; arcane: `arcRing()` |
| Quench barrel animation and length count | `startQuench()`, `quenchSeq()`, `barrelSprites()` |
| Result card (silhouette → length → colour/name → shine → stats and actions) | `showReveal()`, `cardHTML()` |
| Rack drawer (wall of upright blades, stacks, filters, Sell all, Details sheet, bulk) | `renderDrawer()`, `bulkState()` |
| Commission board popup | `boardHTML()`, `renderBoard()` |
| Workshop (patterns, anvils, hammers, quenches/bindings) | `vWorkshop()` |
| Market (supplies, sell/refine, tavern meals, merchant demand) | `vMarket()` |
| Auction House (Browse / Sell / Your auctions) | `vAuction()`, `ahBrowse()`, `ahSell()`, `ahMine()` |
| Mailbox | `renderMailbox()`, `collectOne()` |
| Arena (pick blade, ranked/wager, duel screen, ladder) | `vArena()`, `duelSide()` |
| Challenges (daily/weekly, streak) | `vTasks()` |
| Armory (100 blades × 5 trophies, by class) | `vArmory()` |
| Records (7 boards + Your standings) | `vRecords()` |
| Smith's hall (`/?smith=Name`): portrait, badge, title, blades on show, record, titles | `vHall()`, `openHall()`, look editor `lookEditor()` |
| Account (classes, account plate, backup/restore/delete) | `vChars()`, `SETTINGS_PLATE()` |
| First-forge guided tour | `tourStart()`, `TOUR_STEPS` |
