# Observations: bugs, risks, dead code, running locally

Findings from reading the code at `c4def0a`. Ordered roughly by impact. None of these were changed.

## 1. Trust model: the client is authoritative

The server never sees how coin or blades were earned. It accepts any save on `PUT /api/save` (only checks
that `slots` is an array) and only clamps blade fields when a blade enters the auction house or arena.

What a modified client (or a hand-edited save / backup code) can do:

- Set any coin, materials or blades. Records, Wealth and the public hall are computed from saves, so they can
  be topped at will.
- List or wager a blade it does not own: `cleanBlade` clamps ranges but does not check the seller has it.
- **Mint coin through auction refunds.** The server never checks a bidder has the coin. A bid of N that is
  later outbid mails N coin back to the bidder.
- Claim challenges, Armory rewards and titles freely (all client-side).

This is a reasonable trade-off for a small friendly game, but any feature that adds real competition or
trading value is built on it. Moving the economy server-side would be a large change.

## 2. Cloud save is pushed every ~5 seconds per open tab

A `setInterval` every 5 s nudges merchant demand and calls `save()` (`index.html:3543`). `save()` always
calls `queueSave()`, which PUTs the **whole save** to the server 500 ms later. So every signed-in, open tab
uploads its entire save every ~5 s even when the player does nothing. Each PUT also:

- takes the global `am_state` row lock (see 4),
- reads the stored save and runs a `max(at)` query on `am_history` for the snapshot check.

`save()` also re-parses the whole localStorage save each time (to check for a newer copy from another tab).

## 3. Saves grow without bound

Sold, salvaged, delivered and lost blades are never removed from `c.blades`, only re-statused. Every forge
adds a blade forever. Combined with (2), upload size and the work done by `am_records()` (which explodes every
blade in every save on each Records request) grow linearly with play time.

## 4. One row lock serialises the whole server

Every request except the poll fast path runs `SELECT ... FOR UPDATE` on the single `am_state` row and rewrites
the full blob when anything changed. Users, sessions, mail and auctions all live in that blob, so its size grows
with the player base and every write invalidates every client's poll fast path (`ver` changes). Things that
mark the blob dirty more often than needed:

- `GET /api/records` caches its result in the blob (a write every minute it is called).
- `healGifts` sets `rec.last[uid]` and marks dirty every 5 minutes for every keepsake recipient who fetches
  mail, even when their save already has the keepsake (it checks the save only after marking).
- Throttle counters (`limited`) on every register/login.

Fine at 6 players; it will be the first scaling wall.

## 5. Wager duels can duplicate a blade

The winner is mailed the loser's blade server-side, but the loser's blade is only marked `lost` when the
loser's client sees the finished match (`arenaUpdate` with `result.lostBladeId`). The poll only applies a
finished match if `ARENA.match` is that same unfinished match in memory. If the loser reloads or closes the tab
during the duel (rounds then time out as guards and the match ends), or is away for more than the 60 s the
match is kept, the loser keeps the blade and the winner gets a copy.

## 6. Smaller bugs

- **Auction test-mode label shows "NaN min"**: `ahSell()` uses `d.t/60e3` but `DURS` entries have `ms`, not
  `t` (`index.html:3431`). Only visible with `ANVILMOON_DEV`. The dev toggle text also promises 1–6 minute
  auctions, but the server always uses 30 min / 2 h / 12 h.
- **Hammer durability is per forge, the UI says per strike** (`Durability: 50 strikes`). `startForge()`
  decrements once per forge, and quick forge does not decrement at all.
- **Auction bid error refunds locally even if the server accepted it**: `ahBid()` deducts coin, and on any
  thrown error (including a network drop after the server processed the bid) adds it back.
- `am_x_records` is defined twice in `am_records.sql` (harmless, the second wins).
- Records `entries()` dedupe key is `who|type|len|grade|rarity`, so two genuinely identical blades by the same
  smith collapse to one (same in SQL).
- Patterns (`c.recipes`) are shared across classes, so learning Massive once unlocks it for every class you
  later learn. Possibly intended; worth knowing.

## 7. Dead or vestigial code

- `gainXP()` is empty (an XP system was removed); calls remain throughout.
- `collectMail()` returns on its first line; the rest is unreachable (replaced by `collectOne()`).
- `conflictBanner()` returns `''` immediately (old "two saves" chooser, replaced by automatic merging).
  `ACT.keeplocal/keepremote` are therefore unreachable.
- The old tutorial plate in `vForge()` is gated by `false&&…`.
- `c.trader` is always emptied; `ahRow()` still handles NPC listings and `data-action="tbuy"`, which has no
  `ACT` handler.
- `push()`/`pushAll()` in the server are leftovers from the old event-stream server.
- Stale comments: the client mentions `server/server.js`; `tools/devproxy.js` says it serves `cloud/www`.
- `README` says to rebuild `types.ts` when blade types change, but there is no generator script in the repo.

## 8. Maintainability notes

- 3,550 lines in one file, dense one-line style, no modules, no types, no tests. Any refactor or feature
  branch benefits from first splitting `index.html` into CSS + JS files (the CSP already allows `'self'`
  scripts) and adding a few pure-function tests for rolls, value and merging.
- Game constants live at the top of the script (lines 1181–1349, 1397–1418); most balance changes are
  one-line edits there. `types.ts` must stay in sync with `TYPES` weights for the arena.
- `sw.js` `VERSION` must be bumped on every client change.
- `core.autocrlf=true` on this machine, so the working copy has CRLF line endings; git normalises them on
  commit.

## Running it locally

**Offline only (fastest, no server):** serve `www/` with any static server and make `SERVER` empty, because
`config.js` always sets it to `location.origin` and a non-empty `SERVER` forces the sign-in screen. For example,
edit `www/config.js` locally (do not commit) to:

```js
window.ANVILMOON_DEV = true;      // shows the Test mode toggle and "Reset all"
window.ANVILMOON_SERVER = '';     // no server: localStorage only, no Auction/Arena/Records from others
```

Then e.g. `npx serve www` or `python -m http.server -d www 8099`, and open the page. Test mode gives boosted
shine/size/moon odds and an 8-second dig.

**With the server:** needs a Postgres with `supabase/schema.sql` and `supabase/sql/am_records.sql` applied,
and Deno. The proxy comment says the function runs "under Deno": `Deno.serve` listens on port 8000 by default,
so something like `AM_TEST=1 SUPABASE_DB_URL=postgres://… deno run -A supabase/functions/api/index.ts`, then
`node tools/devproxy.js` and open http://127.0.0.1:8099. The proxy forwards `/api/*` to
`127.0.0.1:8000/functions/v1/api/*`, and the function strips everything before `/api`. (The Supabase CLI's
`supabase functions serve` uses a different port, and there is no `supabase/config.toml` in the repo.) Note
that `config.js` must keep `ANVILMOON_SERVER = location.origin` for this mode.
