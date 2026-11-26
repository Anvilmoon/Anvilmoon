# Playtesting the shop redesign locally

Everything here runs on your own computer against a throwaway, in-memory database. Nothing touches Supabase, Vercel or
the live game. Stopping the server (Ctrl+C) wipes every account and save.

## Run it

| Command | What you get |
|---|---|
| `npm run dev` | The game as players would get it, at http://127.0.0.1:8130 |
| `npm run dev:test` | The same with **test mode** on: shelf listings sell 20× sooner (Short 30 s, Medium 3 min, Long 24 min), Tempered and Starforged are much more common, digs and auctions are short, and it always counts as night (Moonlit). Untick "Test mode" in the side menu to turn it off until the next reload. |

If port 8130 is busy: `PORT=8131 npm run dev` (PowerShell: `$env:PORT=8131; npm run dev`).

Then create an account (any name and password; it only lives in memory) and make your smith.

## The playtest tools

With either command, a dashed **Playtest tools** panel appears on the Home and Account pages (and a "Playtest tools"
button in the side menu on desktop). It only appears when the page comes from `tools/dev.mjs`: the panel asks the
server for `/dev/ping`, and only the local dev server answers that. The real server has no such address, so the
buttons can never appear or work there.

| Button | What it does to your save |
|---|---|
| **+5,000 coin & materials** | +5,000 coin, +50 iron, +50 coal, +20 damascus, +5 star-shards, +30 star-dust, +30 grit. Press it as often as you like. |
| **Unlock polishing** | Medium pattern and the Polishing bench (Sandstone, Spring water), counts 20 forges, at least 10 grit. |
| **Unlock enchanting** | Everything above plus the Iron and Steel Anvils and the Enchanter's table (Flint Chisel, Copper Conduit, Ember rune), counts 40 polishes, fills the mana meter. |
| **Unlock everything** | Every row in every Workshop tab: all anvils, patterns, styles, quenches, stones, liquids, chisels, conduits, runes and all 8 shelves (so Renown opens). Counts every requirement as met. Hammers aren't included; buy them in the Workshop. |

The unlock buttons skip the coin cost and the requirements. Use them to jump to a stage, then play from there.

## What to try

1. **The first hour, for real:** `npm run dev:test`, no buttons. Forge, sell to the scrap merchant, put blades on
   shelves (Short sells in 30 s), buy the Iron Anvil and the Medium pattern. Does it feel slow or fast?
2. **Polishing:** "Unlock polishing", forge a blade, open it on the Rack, press Polish. Try both liquids. Cancel one
   halfway (the grit is spent, the blade stays unpolished). Is the speed limit readable?
3. **Enchanting:** "Unlock enchanting" (and "+5,000 coin" for runes), polish a blade, press Enchant. Abandon before
   touching (costs nothing), then carve Ember and Frost. Buy the Steel Chisel for a second rune. Drink a mana draught
   at the Market.
4. **The shop:** list blades Short/Medium/Long, cancel one, close the tab and come back after the time is up: the coin
   is there and a toast says what sold.
5. **Late game:** "Unlock everything" and "+5,000 coin" a few times. Forge a Massive blade, polish with Acid wash, carve
   three runes with the Starsteel Chisel and Stormglass, list it Long. Raise Renown in the Workshop's Shop tab.
6. **Commissions:** after unlocking polishing or enchanting, buy new notices on the board: orders now ask for a polish
   quality and sometimes a rune.
