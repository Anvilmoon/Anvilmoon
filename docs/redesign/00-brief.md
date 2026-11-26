# Anvilmoon shop redesign: the brief

Branch `shop-redesign` (from `main` at v1.14.0). A **gameplay test copy**. It never touches the live Supabase
project, the live database, Vercel production or `main`. It is played locally with `npm run dev`
(http://127.0.0.1:8130, in-memory database, wiped on Ctrl+C).

## The owner's idea (summary)

Anvilmoon becomes **a shop the player runs**. They make wares and sell them to customers.

1. **Forge** (exists today): the player starts knowing only simple blades. Forging unlocks stay like today:
   new anvils, new weapon types, quenches, hammers.
2. **Polish** (new, unlocked later): a different mini-game that polishes a forged blade and raises its value
   **based on a roll**. Its own unlocks: better polishing stones (the "anvil" of polishing) and better
   polishing liquids (the "quench" of polishing).
3. **Enchant** (new, unlocked after polishing): the player **draws a rune with the mouse onto the blade**,
   which chisels the rune into it. How much they can chisel depends on **how fast they chisel** and **how
   much mana they have**. Its own unlocks: better chisels (the "anvil"), better mana conduits (the "quench" /
   "liquid"), and new runes (the "weapon types").
4. **Selling**, for every finished blade:
   - **Quick sell to the scrap merchant** (instant, low price),
   - **Scrap it yourself for materials**,
   - **List it in the shop**: it sells for a **higher price after a set time**.
5. Keep: forging, buying supplies (Market), commissions. Remove: the four smiths / classes system (Warsmith,
   Shadowsmith, Arcanesmith, Sanctum Smith as separate characters with separate blade lists).

## Ground rules for every design

- **Server-authoritative stays.** All rules and numbers live in `www/js/rules.js` (shared by the browser and
  the Supabase function, copied by `node tools/sync-rules.mjs`). Every change is an action
  (`def('name', rng, run)`). Dice are rolled only on the server. Mini-games run in the browser and send raw,
  checkable inputs (like today's `forgeEnd` sends `[d, T]` per strike and the server scores them with
  `strikeScore`). A cheater should at best reach "perfect skill", never invent results.
- **Time-based things are computed from the clock**, like energy (`tickFuel`) and merchant demand
  (`settleDemand`): no timers in the open tab are trusted. A shop listing sells at `listedAt + duration`,
  settled in `beginAction`.
- **Keep it simple.** The main developer is new to coding. Few new concepts, clear names, numbers in tables
  at the top of rules.js.
- **No save migration needed.** This is a test copy; the dev database starts empty. A fresh save format is
  fine (bump `SAVE_V`). Don't spend effort upgrading live saves.
- Out of scope for redesign (leave working as-is where possible, adapt minimally): Auction House, Arena,
  Records, Hall, challenges, getting-started steps, mail, accounts.

## Existing material to read (don't redo it)

- `docs/analysis/game-mechanics.md`: every current rule and number (value formula, rarity tables, sizes,
  shine, demand, salvage, commissions, unlock costs).
- `docs/server-authority.md`: how actions, prediction and patches work.
- `www/js/rules.js`: the rules themselves.

## Design documents in this folder

| File | Content |
|---|---|
| `00-brief.md` | This brief |
| `01-economy.md` | The overall loop, resources, value formula, the three unlock trees, selling, commissions, pacing |
| `02-polishing.md` | The polishing mini-game, its roll, stones and liquids |
| `03-enchanting.md` | Rune drawing, chisel/mana rules, conduits, the rune list |
| `04-balance.md` | Reconciled numbers and simulation results |
| `05-implementation.md` | The action API and save format the code follows |
