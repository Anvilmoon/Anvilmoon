# Anvilmoon

Pixel-art blade forging and collecting game, live at https://anvilmoon.net.

- `www/` is the game itself (one page, `index.html`). Vercel publishes this folder on every push to `main`.
- `supabase/functions/api/` is the game server: accounts, cloud saves, mail, the Auction House, Records and the Arena. It runs as a Supabase Edge Function. `www/vercel.json` forwards `/api/...` to it, so the game and its server share one address.
- `supabase/schema.sql` creates the three database tables the server uses.
- `tools/` holds the script that moved the data over from the old PC server, and a small local test proxy.

When blade types change in `www/index.html`, rebuild `supabase/functions/api/types.ts` and redeploy the function.
Bump `VERSION` in `www/sw.js` with every change to the game so players' browsers pick it up.
