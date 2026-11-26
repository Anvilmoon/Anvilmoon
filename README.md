# Anvilmoon

Pixel-art blade forging and collecting game, live at https://anvilmoon.net.

- `www/` is the game itself (one page, `index.html`, plus `js/rules.js`). Vercel publishes this folder on every push to `main`.
- `www/js/rules.js` holds all the game rules and numbers. The browser and the server both run it; the server is the referee.
- `supabase/functions/api/` is the game server: accounts, every game action, mail, the Auction House, Records and the Arena. It runs as a Supabase Edge Function. `www/vercel.json` forwards `/api/...` to it, so the game and its server share one address.
- `supabase/schema.sql` creates the database tables; `supabase/sql/` holds the Records functions and the one-time database move (`migrate_v2.sql`).
- `tests/` and `tools/` hold the tests and a way to play everything on your own computer.

How the server keeps the real save, how to test and how to put changes live: [docs/server-authority.md](docs/server-authority.md).

Quick rules:
- After changing `www/js/rules.js`, run `node tools/sync-rules.mjs` (copies it to the server), then `npm test`.
- `npm run dev` plays the whole game locally at http://127.0.0.1:8130 with a throwaway database.
- Bump `VERSION` in `www/sw.js` with every change to the game so players' browsers pick it up.
