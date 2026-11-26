# Anvilmoon: codebase and game analysis

Written 2026-11-26 against `main` at commit `c4def0a` (game version **1.12.17**).
The live site at https://anvilmoon.net serves exactly this commit: its `index.html` is byte-identical to
`www/index.html` once Windows line endings are stripped, and `sw.js` reports `anvilmoon-1.12.17`.

These notes describe the game as it was before the server became the referee (1.13.0). For the current design see [../server-authority.md](../server-authority.md).

## Documents

| File | What it covers |
|---|---|
| [architecture.md](architecture.md) | Hosting, deployment, request lifecycle, persistence, cloud-save sync, polling, security model |
| [client-code-map.md](client-code-map.md) | Map of the 3,550-line `www/index.html`: sections, globals, render loop, action dispatch, which screen is which function |
| [game-mechanics.md](game-mechanics.md) | Every rule and formula: forging mini-game, grade, rarity/size/shine rolls, value, economy, commissions, progression, challenges, arena |
| [server-api.md](server-api.md) | The Supabase Edge Function: every endpoint, the shared-state blob, tables, SQL functions, timers |
| [data-model.md](data-model.md) | Shape of the save (`A`), a smith, a blade, mail, listings, matches |
| [observations.md](observations.md) | Bugs, dead code, trust/cheating surface, scaling risks, and how to run it locally |
| [capacity.md](capacity.md) | Free-tier cost estimate: whether server-authoritative forging is affordable (it is; the real limits are polling and the single-row lock) |

## The game in one paragraph

Anvilmoon is a browser pixel-art blacksmithing and collecting game. You pick a blade type, spend energy,
iron and coal, then play a short timing mini-game (hold Bellows to heat, tap Strike as a marker crosses the
centre). The average strike quality becomes the blade's **grade**; the quench you choose adds grade but risks
a crack. The blade then rolls **rarity** (table set by your anvil), **length/size**, **variant**, a rare
**shine** (Tempered 1/200, Starforged 1/2000) and, at night, **Moonlit** (1/15). A staged reveal shows the
result. You keep, sell (to merchants, at a demand-adjusted price), salvage, deliver to commissions, auction to
other players, or carry into rock-paper-scissors Arena duels. Progress is a 100-blade Armory with 5 trophies
each, unlockable patterns/anvils/hammers/classes, daily and weekly challenges, global Records boards and a
public "Smith's hall" per player.

## Quick facts

- **Stack:** one static page (vanilla JS, no framework, no build step) on Vercel + one Supabase Edge Function
  (Deno/TypeScript) + Postgres. No npm dependencies in the repo.
- **Size:** `www/index.html` 460 KB / 3,550 lines (CSS lines 23–1169, JS lines 1180–3550, mostly
  minified-style one-liners). Server `supabase/functions/api/index.ts` 626 lines.
- **All art and sound are procedural.** Blades are drawn as SVG, rasterized to a mask, then repainted as
  pixel art on canvas. Characters, anvil, barrel, bricks are drawn in code. Sounds are synthesized with Web
  Audio. The only binary assets are fonts and icons.
- **The game logic runs in the browser.** The server stores saves and runs the multiplayer parts (accounts,
  mail, auction house, arena, records) but does not validate the economy.
- **State:** the whole player save is one JSON object in `localStorage` (`anvilmoon-save-v1`), mirrored to
  `am_saves.save` (jsonb). All shared server state (users, sessions, mail, auctions, matches, queues) is one
  jsonb blob in a single row, `am_state`.
- **Live population (2026-11-26):** 6 players, 510 counted blades, 0 open auctions, 2 players on the ladder.
- **History:** 48 commits, all 2026-11-25/26, from 1.8.0 (the move from an old PC server to
  Vercel + Supabase) to 1.12.17.
