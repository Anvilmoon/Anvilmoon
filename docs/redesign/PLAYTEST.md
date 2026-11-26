# Playtesting the shop redesign locally

Everything here runs on your own computer against a throwaway, in-memory database. Nothing touches Supabase, Vercel or
the live game. Stopping the server (Ctrl+C) wipes every account and save.

## Run it

| Command | What you get |
|---|---|
| `npm run dev` | The game as players would get it, at http://127.0.0.1:8130 |
| `npm run dev:test` | The same with **test mode** on: shelf listings sell 20× sooner (a cheap blade in seconds, a great one in a few minutes), Tempered and Starforged are much more common, digs and auctions are short, and it always counts as night (Moonlit). Untick "Test mode" in the side menu to turn it off until the next reload. |

If port 8130 is busy: `PORT=8131 npm run dev` (PowerShell: `$env:PORT=8131; npm run dev`).

Then create an account (any name and password; it only lives in memory) and make your smith.

## The playtest tools

With either command, a small **Dev** button appears at the top right of the Workshop and Shop scenes (the same tools are on
the Account page, and a "Playtest tools" button in the side menu on desktop). It only appears when the page comes from `tools/dev.mjs`: the panel asks the
server for `/dev/ping`, and only the local dev server answers that. The real server has no such address, so the
buttons can never appear or work there.

| Button | What it does to your save |
|---|---|
| **+5,000 coin & materials** | +5,000 coin, +50 iron, +50 coal, +20 damascus, +5 star-shards, +30 star-dust, +30 grit. Press it as often as you like. |
| **Unlock polishing** | Medium pattern and the Polishing bench (Sandstone, Spring water), counts 20 forges, at least 10 grit. |
| **Unlock enchanting** | Everything above plus the Iron and Steel Anvils and the Enchanter's table (Flint Chisel, Copper Conduit, Ember rune), counts 40 polishes, fills the mana meter. |
| **Unlock everything** | Every upgrade (the Upgrades list, and every ▲ in the scenes): all anvils, patterns, styles, quenches, stones, liquids, chisels, conduits, runes and all 8 shelves (so Advertising opens). Counts every requirement as met. Hammers aren't included; buy them at the hammer rack in the Workshop. |

The unlock buttons skip the coin cost and the requirements. Use them to jump to a stage, then play from there.

## What to try

1. **The first hour, for real:** `npm run dev:test`, no buttons. Forge, sell to the scrap merchant, put blades on
   shelves (cheap blades sell in seconds), buy the Iron Anvil (click the anvil) and the Medium pattern (the
   pattern board). Does it feel slow or fast?
2. **Polishing:** "Unlock polishing", forge a blade, click the polishing bench in the Workshop and pick the blade. Try both liquids. Cancel one
   halfway (the grit is spent, the blade stays unpolished). Is the speed limit readable?
3. **Enchanting:** "Unlock enchanting" (and "+5,000 coin" for runes), polish a blade, click the enchanter's table and pick the blade. Abandon before
   touching (costs nothing), then carve Ember and Frost. Buy the Steel Chisel for a second rune. Drink a mana draught
   at the Market.
4. **The shop:** go through the door, click the selling racks and put blades on shelves (each blade has one
   time and price, from its worth), take one down, close the tab and come back after the time is up: the coin
   is there and a toast says what sold.
5. **Late game:** "Unlock everything" and "+5,000 coin" a few times. Forge a Massive blade, polish with Acid wash, carve
   three runes with the Starsteel Chisel and Stormglass, put it on a shelf. Raise Advertising at the flyers by the shop window.
6. **Commissions:** after unlocking polishing or enchanting, buy new notices on the board in the shop: orders now ask for a polish
   quality and sometimes a rune.
