# The server is the referee

From version 1.13.0 the game server owns every player's save. The browser can no longer upload a save, so coin,
materials and blades can't be invented from the browser console or a hand-edited backup code. This page explains how
it works, what changed, how to test it on your own computer and how to put it live.

## The idea in one picture

```
Before                                         After
------                                         -----
browser: runs the rules, changes the save      browser: asks "sell blade 12"        POST /api/act {name:'sell', args:{ids:[12]}}
browser: uploads the WHOLE save every 5 s      server:  checks the rules, changes its save, rolls any dice
server:  stores whatever it is given           server:  answers with only what changed  {ops:[{p:['slots',0,'coin'],v:120}, ...]}
                                               browser: applies the changes to its copy
```

## The pieces

| File | What it is |
|---|---|
| `www/js/rules.js` | **All the game rules and numbers**, in one file that both the browser and the server load. Blade types, prices, odds, and every action (`sell`, `forgeStart`, `buy`, `eat`, `learn`...). Edit game balance here. |
| `supabase/functions/api/rules.js` | A copy of the above for the server. Never edit it: run `node tools/sync-rules.mjs` after changing `www/js/rules.js`. `npm test` fails if you forget. |
| `supabase/functions/api/index.ts` | The server: accounts, `/api/act`, mail, auctions, the Arena. |
| `supabase/schema.sql` | The database tables for a brand-new database. |
| `supabase/sql/migrate_v2.sql` | The one-time move of the live database to the new tables (see "Going live"). |
| `supabase/sql/am_records.sql` | Records boards and the public hall (now read the accounts table). |
| `tests/` | Automatic tests (`npm test`). |
| `tools/dev.mjs` | Play the whole thing on your computer (`npm run dev`). |

## How an action works

1. The player presses **Sell**. The game calls `actSync('sell', {ids:[12]})`.
2. Selling rolls no dice, so the game runs the same rule from `rules.js` on its own copy straight away, so the coin
   appears at once. This is a *prediction*.
3. The action goes to the server (`POST /api/act`). The server locks **only this player's save row**, runs the same
   rule on the real save, stores it, and answers with the changes and the save's new revision number.
4. The game applies the changes to its copy of the server's save (`SV.base`) and rebuilds what it shows from that.
   If the server said no (say the blade was already sold in another tab), the prediction disappears and the
   reason is shown.

Actions that roll dice (finishing a forge, a quick forge, new commission notices, making a smith) or involve other
players (mail, auctions, the Arena) are not predicted: the game waits for the answer, which takes a fraction of a second.

Every action is a few hundred bytes each way, sent only when something happens. The 5-second upload of the whole
save (about 29 KB) is gone. The game still checks in every 12 seconds (was 8) for mail, auctions and duels.

### Forging

The mini-game still runs in the browser, because it needs to answer every frame. When you light the forge the
server takes the energy, iron and coal (`forgeStart`) and notes the time. For each strike the game records two raw
numbers: how far the marker was from the centre, and the heat. When you quench, those go to the server
(`forgeEnd`), which scores them with the same formula the strike bar showed (`strikeScore` in rules.js), checks there
is one per strike and that the forge took a believable time, and **rolls rarity, size, variant, shine, Moonlit and the
crack itself**. So the best a cheater can do is a perfect-skill forge (grade 88 in oil, as a perfect player would get),
never an invented blade. No game can tell a bot's perfect timing from a perfect player's, so this is the usual limit.

Moonlit needs the player's local night. The game reports its time zone with each action; the server accepts a change
at most every 12 hours, so it can't be flipped to make every forge a night forge.

### Things that follow the clock

Energy (+1 every 3 minutes) and merchant demand (drifts back to normal; every 75 seconds merchants clamour for one
blade of your class) are now worked out from the time, not from a timer in the open tab. Both sides compute the same
numbers, so nothing needs uploading. One small difference from before: the clamouring now happens even while the game
is closed, picked from the clock and your smith id, so players who come back may find a type or two in demand.

### Auctions

Listing, bidding, buying out and cancelling are actions. A bid takes the coin from the bidder's save **on the
server**, so it can't be more than they have (this used to let anyone mint coin through outbid refunds). Outbid
refunds, sale payouts and returned blades still arrive by mail, and collecting mail is an action too: coin and blades
go into the save and the letter is deleted in one step, so a letter can never pay twice.

### The Arena

A blade carried into a **wager** duel is marked as at stake (it can't be sold or listed meanwhile). When the duel ends
the server marks the loser's blade lost and mails it to the winner in the same step, whether or not the loser's game is
open. That fixes the old duplicate-blade bug. Ranked and practice duels are as before.

### Saves stay small

Sold, salvaged, delivered and lost blades used to stay in a save forever. Once a save holds more than 150 of them, the
server tidies it: it keeps every blade on the rack or listed, plus everything that could be on a Records board (your 10
longest, 10 shortest, 10 finest, 10 longest on the Rough Anvil, and your longest of each type). What the dropped blades
counted for (Armory goals, Legendaries, pattern requirements) is remembered in `save.gone`.

### No more single shared row

Accounts, sessions, mail, auctions and throttles have their own tables. A normal action locks only that player's save
row, so players no longer wait on each other. The shared `am_state` row now holds just the Arena (queues and live duels),
which gift campaigns went out, and the hand-edited settings (`config`). When a request must lock several rows it always
takes them in the order `am_state`, then `am_auctions`, then `am_saves`, so two requests can never wait on each other forever.

### Existing saves

Nothing is lost. The first time a player opens the game after the update, the server brings their save up to date
(`upgradeSave` in rules.js) and stores it: smiths from old multi-smith saves are folded into one (as the game already
did), an unfinished reveal lands on the rack, blades are re-signed to the username, and the browser-only fields are
dropped. Older copies of every save are still kept in `am_history` (every 10 minutes, last 12).

Note: saves were written by the browser until now, so anything already in them stays. If you suspect a player edited
their save before the move, look at their `am_history` copies.

## What still trusts the browser

- **Strike timing** (see Forging): a perfect-skill forge at most.
- **Getting-started steps** that are about visiting a page (Market, Workshop...) pay their small one-time reward when
  the game says the page was opened. 220 coins in total, once per account.
- **The time zone**, limited as described above.

## Playing it on your computer

You need Node.js. Once:

```
npm install
```

Then:

```
npm run dev
```

and open http://127.0.0.1:8130. This starts an in-memory Postgres (PGlite) and the real server under Deno. It never
touches the Supabase project, and everything is wiped when you stop it with Ctrl+C.

To play offline without any server, see "Running it locally" in `docs/analysis/observations.md`: with
`ANVILMOON_SERVER = ''` the same rules run in the browser.

## Tests

```
npm test
```

checks that the server's copy of the rules is up to date, then runs:

- `tests/rules.test.mjs`: demand, save upgrades, tidying, patches;
- `tests/server.test.mjs`: the real server against an in-memory database (forging, cheats refused, selling, auctions,
  wager duels, the check-in, Records);
- `tests/migrate.test.mjs`: an old-format database and save go through `migrate_v2.sql` and keep their account, mail,
  auction and blades.

## Changing the game

- **Balance (prices, odds, rewards)**: edit `www/js/rules.js`, run `node tools/sync-rules.mjs`, run `npm test`,
  then deploy both the game and the server. Deploy them close together: if the game and the server disagree, the
  server wins and the game's predictions are corrected after each action.
- **A new action**: add a `def('name', rng, (ctx, args) => { ... })` in the ACTIONS section of rules.js. Check
  everything with `need(condition, 'message')` before changing the save. Call it from the game with
  `actSync('name', args)` (no dice) or `await act('name', args)` (dice).
- Bump `VERSION` in `www/sw.js` with every change to the game.

## Going live

Do these together, in this order, at a quiet moment. The site is down for players for the few minutes in between.
Do not do any of it without deciding to: it changes the live database.

1. **Back up.** In the Supabase dashboard, Database → Backups, or at least run
   `create table am_state_copy as select * from am_state; create table am_saves_copy as select * from am_saves;`
   in the SQL editor.
2. **Move the database.** In the SQL editor, run `supabase/sql/migrate_v2.sql`, then `supabase/sql/am_records.sql`.
   (The migration keeps its own copy of the old shared row in `am_state_backup` too.)
3. **Deploy the server.** `node tools/sync-rules.mjs`, then `supabase functions deploy api`.
4. **Deploy the game.** Merge to `main`; Vercel publishes `www/`. The new `sw.js` version makes installed games
   update. A tab still open on the old game gets "Anvilmoon was updated. Reload the page" when it tries to save.
5. **Check.** Sign in, forge a blade, sell it, look at Records.

To go back: deploy the old server and game again, then restore the old shared row with
`update am_state set blob = (select blob from am_state_backup order by at limit 1) where id = 1;`.
Saves already upgraded still load in the old game (it ignores the new fields). Accounts, mail and auctions created
after going live exist only in the new tables, so going back is for the first hours, not days.
