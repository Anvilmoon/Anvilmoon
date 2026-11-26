# Data model (client save)

The save is `A`, stored in `localStorage['anvilmoon-save-v1']` and in `am_saves.save`.
Other localStorage keys: `anvilmoon-token`, `anvilmoon-mute`. sessionStorage: `anvilmoon-oauth`,
`anvilmoon-code`.

## Account save `A`

| Key | Meaning |
|---|---|
| `slots` | `[smith, null, null, null]`. Historically up to 4 smiths; `unify()` now folds them into one (slot 0) and keeps every class they had |
| `active` | Index of the current smith (0, or −1 before one exists) |
| `serial` | Last blade id handed out |
| `totalForged` | Account-wide count |
| `tab` | Current page |
| `testOdds` | Test mode (forced off unless `ANVILMOON_DEV`) |
| `rev`, `at` | Local revision counter and timestamp, bumped on every `save()` |
| `base`, `pushed` | Server `rev` this save grew from; last local `rev` the server has |
| `wealth` | Coin across smiths (read by nothing server side; Records computes its own) |
| `hall` | Public hall summary written on every save: `{v, look, title, badge, pct, earned[], stats, blades[≤8]}` |
| `claimed` | Armory rewards already paid: `{"type:goal": 1}` |
| `mailSeen` | `{mailId: t}` collected mail, so it is never applied twice |
| `arenaDone` | `{matchId: 1}` results already applied |
| `ch` | Challenges: `{d, p, c, w, wp, wc, streak, best, last, done}` |
| `gs` | Getting started: `{d: {stepId: 1}, fin}` |
| `look` | Portrait choice `{body, skin, hair, hairC, beard, cloth, trim, trous}` |
| `hallTitle` | Chosen title id |
| `tourDone`, `tutDone`, `tipsOff`, `rackTall` | UI preferences |

## Smith (`A.slots[0]`, returned by `C()`)

| Key | Meaning |
|---|---|
| `cid` | Random smith id (used to address mail) |
| `name` | Now always the account username (`oneName()`), old names kept in `aka` |
| `cls`, `classes`, `freeWar`, `selBy` | Current class, learned classes, whether Warsmith was granted free, last selected blade per class |
| `coin`, `iron`, `coal`, `fuel`, `damascus`, `dust`, `shards`, `bog` | Resources |
| `fuelTs` | Energy regen clock |
| `anvil` | 0–4 |
| `hammer`, `hammers` | Equipped key; `{smith: {dur}, master: {dur}}` |
| `recipes` | `{M, H, X, brine, water: true}` |
| `blades` | Every blade ever made or received, **including sold/salvaged/lost ones** |
| `demand` | `{type: multiplier}` for all 100 types |
| `commissions` | 3 orders `{id, type, minR, minS, minG, pay, imp, patron, pin?, lock?}` |
| `trader` | Always emptied (removed feature) |
| `sel`, `selW` | Selected blade type and weight tab |
| `forged` | Count |
| `labor`, `meals`, `digUntil` | `{d: dateString, n}` daily counters, dig timer |
| `merged`, `aka` | Bookkeeping from folded smiths |

## Blade

| Key | Meaning |
|---|---|
| `id` | Local integer from `A.serial` |
| `type` | One of 100 `TYPES` keys, or a gift type |
| `rarity` | 0 Common, 1 Fine, 2 Masterwork, 3 Heirloom, 4 Legendary |
| `variant` | Index into the class's variants |
| `len`, `si` | Length in cm (1 decimal), size index 0 Runt … 6 Colossal |
| `grade` | 1–100 |
| `shine` | `''`, `'temp'`, `'star'` |
| `moon` | Moonlit |
| `cracked` | Broke in the quench |
| `anvil` | Anvil tier it was forged on |
| `perfect` | Rolled on the next anvil up |
| `bog`, `quick`, `q` | Bog iron, quick forge, quench used |
| `forger` | Smith name |
| `status` | `pending` (during reveal) → `owned`, `sold`, `salvaged`, `commission`, `listed`, `lost` (wager) |
| `t`, `su` | Created time, last status change (used by save merging) |
| `ahId` | Client listing id while listed |
| `keep`, `hall` | Locked against selling; shown in the hall |
| `gift`, `gdate` | Keepsake campaign id and date |

Records count statuses owned/sold/commission/listed (`exists()`). The Armory counts every non-cracked blade
except `pending`, so salvaged and lost blades still count. Arena, AH, commissions and selling use only `owned`.
