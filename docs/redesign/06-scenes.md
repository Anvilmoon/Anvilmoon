# 06 Scenes: the Workshop and the Shop

The game's main screens are two pixel-art rooms. The **Workshop** is the first screen; a door on its right leads to
the **Shop**, whose back door leads back. Everything else (Market, Armory, Records, Auctions, Arena, Challenges,
Account, Hall, Mail, the Upgrades list) stays in the menu.

Code: `www/js/scene.js` draws the rooms (`SCENE.html`, `SCENE.mount`, the `ART` table). `www/index.html` says what
each element shows and what a click does (`wsItems`, `shItems`, `sceneClick`, the `POPS` upgrade popups,
`vPolishBench`, `vEnchantTable`, `vSell`).

## How a scene is built

- A fixed logical grid of **320 × 180 units** (16:9). The scene is scaled to the page width (letterboxed, never wider
  than the screen allows) with `image-rendering: pixelated`.
- Every element is a **layer**: an absolutely positioned box at `x, y, w, h` (scene units) with a z-order. The
  background is layer 0 and is not clickable; every other element is a button.
- A layer's picture is a PNG from `www/art/` when one exists, otherwise a procedural pixel drawing (the `draw`
  function of its `ART` row). Hover draws a 1-unit gold outline around the picture's opaque pixels (CSS
  `drop-shadow`, so it follows a transparent PNG's shape too) and shows a label. On phones the main stations show a
  short label all the time; parts (anvil, barrel, stone…) open their popup on the first tap.
- **Locked** stations are drawn grey with a padlock; their parts are grey without one. Clicking any of them opens the
  popup to buy the station.
- A gold **▲** badge sits on a part when something in its popup can be bought right now (cost and requirement met).
  A green number shows waiting work (commissions you can fill).
- Ambient effects are CSS over the element: fire flicker and sparks on the forge, a soft glow on the mana conduit.
  During Moonlit hours (8 pm to 6 am, or always in test mode) the room gets a blue night tint and the windows show
  the moon. `prefers-reduced-motion` turns the effects off.

## The Workshop

| Key | Element | x, y, w, h | z | Click opens |
|---|---|---|---|---|
| `ws_bg` | Brick wall, ceiling beam, posts, window, plank floor, warm hearth light | 0, 0, 320, 180 | 0 | – |
| `ws_forge` | The forge: brick hearth with chimney hood, fire, bellows | 4, 38, 64, 100 | 2 | the **Forge** screen (pick a blade, forge) |
| `ws_patterns` | Pattern board on the wall (pinned blade patterns, one per pattern or style known) | 80, 20, 29, 30 | 2 | popup **Patterns and styles** (`M H X shadow arcane sanct`) |
| `ws_hammer` | Hammer rack on the wall (one hammer per hammer owned) | 78, 56, 32, 19 | 2 | popup **Hammers** (craft, use, repair) |
| `ws_anvil` | The anvil on a stump (colour by tier) | 72, 102, 35, 36 | 4 | popup **Anvil** (`anvil1`–`anvil4`, rarity odds) |
| `ws_barrel` | Quench barrel (liquid colour: oil, brine, water) | 110, 104, 22, 34 | 4 | popup **Quench barrel** (`brine`, `water`) |
| `ws_coal` | Sack of coal on the floor | 24, 130, 27, 28 | 6 | the **Supplies** popup (iron, coal, meals) |
| `ws_iron` | Stack of iron bars on the floor | 54, 136, 33, 22 | 6 | the **Supplies** popup |
| `ws_polish` | Polishing bench (workbench with rags) | 140, 104, 58, 34 | 3 | locked: popup to buy the bench (`polish`); open: the **Polishing bench** screen (pick a blade → polish) |
| `ws_stone` | Grinding stone on its frame (colour of the stone in use) | 146, 81, 28, 29 | 4 | popup **Polishing stone** (`stone1`–`stone4`) |
| `ws_bottles` | Liquid bottles (one per liquid known) | 176, 97, 20, 13 | 4 | popup **Polishing liquids** (`camellia`, `acid`) |
| `ws_ench` | Enchanter's table (dark wood, purple cloth) | 206, 99, 60, 39 | 3 | locked: popup to buy the table (`enchant`); open: the **Enchanter's table** screen (pick a blade → carve) |
| `ws_book` | Open rune book (lines per rune known) | 207, 93, 23, 14 | 4 | popup **Rune book** (`frost`…`dawn`) |
| `ws_chisel` | Chisel and mallet (tip colour by tier) | 229, 96, 20, 10 | 4 | popup **Chisel** (`chisel1`–`chisel3`) |
| `ws_conduit` | Mana conduit: a crystal on a bronze stand (colour of the best conduit) | 250, 69, 14, 38 | 4 | popup **Mana conduits** (`silver`, `stormglass`) |
| `ws_door` | Door to the shop, with a coin sign | 268, 58, 51, 80 | 2 | the **Shop** scene |

## The Shop

| Key | Element | x, y, w, h | z | Click opens |
|---|---|---|---|---|
| `sh_bg` | Wood-panelled wall, dado rail, street window, hanging lamp, flagstone floor | 0, 0, 320, 180 | 0 | – |
| `sh_back` | Back door to the workshop, with an anvil sign | 2, 62, 43, 76 | 2 | the **Workshop** scene |
| `sh_board` | Commission board: cork board with the current notices (green pin = you can fill it) | 171, 26, 31, 30 | 2 | the **Commission board** window |
| `sh_racks` | Selling racks: two wall shelves, 4 stands each; open slots have stands, listed blades stand on them in their rarity colour | 48, 14, 100, 74 | 2 | the **Selling racks** screen |
| `sh_counter` | Shop counter with a cash box and coins | 92, 92, 96, 46 | 3 | the **Selling racks** screen |
| `sh_slots` | A crate of new shelf planks | 192, 122, 24, 16 | 4 | popup **Shelf slots** (`shelf4`–`shelf8`) |
| `sh_flyer` | Flyers pinned by the window (more flyers per Advertising level) | 178, 62, 18, 23 | 2 | popup **Advertising** (locked until 8 shelf slots) |
| `sh_scrap` | The scrap merchant's cart, full of scrap, with a "40%" sign | 219, 104, 40, 34 | 4 | the **Selling racks** screen on its Scrap merchant tab |
| `sh_street` | Front door with a glass pane, sack sign | 275, 62, 43, 76 | 2 | the **Market** |

## Screens behind the stations

- **Forge**: today's forge page, with "← Workshop".
- **Polishing bench / Enchanter's table**: a bar with the tool in use, grit or mana (buy 5 grit, drink a draught,
  Upgrades), and a card for each blade that can be polished / carved. A card's button runs the existing polish or
  enchant flow.
- **Selling racks**: tabs Shelves / Scrap merchant. On top the shelf slots (listed blades with price, countdown and
  "Take down"; empty slots; one tile to buy more slots). Below, the rack: every blade with "Shelf · price · time"
  (`AMR.shelfPrice(c, b)`, `AMR.shelfTime(c, b)`, divided by `SHELF_TEST_DIV` in test mode) and "Scrap · 40%".
  Cracked blades offer Salvage, locked blades stay home.
- **Upgrade popups** share one component: the part's picture, title, what is in use, a sentence on what it does, then a
  row per upgrade (name, description, cost, requirement with a progress bar, and Owned / Needs the X / Buy).

## Art for the image generator

Style for every asset: **pixel art**, crisp hard edges, no anti-aliasing or blur, a limited warm palette matching the
game (ink outline `#141110`, iron `#5d6166`/`#9aa2a9`, wood `#5a3d26`/`#7a5534`, brick `#5c3428`, straw gold
`#e2c275`, bronze `#b9773f`, forge orange `#ff7a1a`/`#ffb43a`, enchant violet `#a58cff`), light from the forge on the
left in the Workshop and from a hanging lamp in the Shop, a slight top-down 3/4 view, everything standing on the same
floor line (scene y = 138). Draw at **4× the scene units** (one art pixel = one scene unit, scaled ×4), so the sizes
below are the PNG sizes. All element PNGs have a **transparent background**; the two backgrounds are opaque.
No text in the images (labels are drawn by the game).

| File | PNG size | Layer | Depicts | Notes |
|---|---|---|---|---|
| `art/workshop_bg.png` | 1280 × 720 | 0 | Empty workshop room: brick wall, wooden ceiling beam and posts, a small night window (178, 23, 34 × 35 units), wall meets the floor at y 129, plank floor to y 160, a stone step below | opaque; leave the station areas empty; night is a CSS tint |
| `art/workshop_forge.png` | 256 × 400 | 2 | Brick forge with chimney hood, glowing fire in an arched opening (fire about 30–80% across, 50–80% down), stone hearth, bellows leaning on the right | the flicker and sparks are added by CSS |
| `art/workshop_patterns.png` | 116 × 120 | 2 | Wooden board with pinned parchment blade patterns | |
| `art/workshop_hammers.png` | 128 × 76 | 2 | Wall rack with three smithing hammers | |
| `art/workshop_anvil.png` | 140 × 144 | 4 | Iron anvil (horn to the left) on a tree stump | one tier only; tiers are a later option (`_1`…`_4` suffix) |
| `art/workshop_barrel.png` | 88 × 136 | 4 | Wooden quench barrel with iron hoops, dark liquid on top | |
| `art/workshop_coal.png` | 108 × 112 | 6 | Open burlap sack full of coal | |
| `art/workshop_iron.png` | 132 × 88 | 6 | Small pyramid of iron ingots | |
| `art/workshop_bench.png` | 232 × 136 | 3 | Polishing workbench with a lower shelf and rags | the stone and bottles are separate layers on top |
| `art/workshop_stone.png` | 112 × 116 | 4 | Round grinding/polishing stone on a wooden frame with a water trough | |
| `art/workshop_bottles.png` | 80 × 52 | 4 | Three small corked bottles (blue, amber, green liquid) | |
| `art/workshop_table.png` | 240 × 156 | 3 | Dark wooden enchanting table with a purple, gold-trimmed cloth | the book, chisel and conduit are separate layers |
| `art/workshop_runebook.png` | 92 × 56 | 4 | Open leather book with glowing rune lines | |
| `art/workshop_chisel.png` | 80 × 40 | 4 | Small steel chisel and wooden mallet lying flat | art at the bottom of a 20 × 10 canvas, so the hotspot stays tappable |
| `art/workshop_conduit.png` | 56 × 152 | 4 | Violet crystal on a slim bronze stand | glow added by CSS |
| `art/workshop_door.png` | 204 × 320 | 2 | Heavy wooden door in a stone frame, iron straps, a small hanging coin sign below | the door to the shop |
| `art/shop_bg.png` | 1280 × 720 | 0 | Empty shop interior: vertical wood panels, dado rail at y 96, street window (202, 20, 58 × 65 units) showing rooftops at night, a hanging lamp at x 150–170 (down to y 67), flagstone floor from y 132 | opaque; keep the racks and board clear of the lamp |
| `art/shop_backdoor.png` | 172 × 304 | 2 | Plain back door with an anvil sign | |
| `art/shop_board.png` | 124 × 120 | 2 | Cork notice board with three pinned paper notices | |
| `art/shop_racks.png` | 400 × 296 | 2 | Two long empty wall shelves on iron brackets, at the bottom of a 100 × 74 canvas (shelf tops at y 24 and 53 of the box) | the stands, listed blades and price tags are drawn over it by the game (`over: drawRackItems` in `scene.js`) |
| `art/shop_counter.png` | 384 × 184 | 3 | Wooden shop counter, a brass cash box and a few coins on top | |
| `art/shop_crate.png` | 96 × 64 | 4 | Wooden crate with new shelf planks sticking out | |
| `art/shop_flyers.png` | 72 × 92 | 2 | A few paper flyers pinned to the wall | |
| `art/shop_scrap.png` | 160 × 136 | 4 | Small wooden cart heaped with scrap metal and broken blades, a little paper sign | |
| `art/shop_street.png` | 172 × 304 | 2 | Front door with a glass pane, a sack sign | |

Hover variants are not needed: the outline and label are drawn by the game.

## How this art was made

The current set is generated with OpenAI's image model in the owner's chosen style ("Style A": side-view 16-bit pixel
art, crisp chunky pixels, a limited warm palette, dark brick and timber, warm firelight). Every asset is an image
**edit** with the Style A workshop picture attached as the reference (`ref`: `art-src/style_a.png`, kept out of git with
the raw images), so all of them share its palette and pixel size.

1. `node tools/gen-art.mjs tools/art-jobs.json` (the prompts used for this set): one job per asset (`name`, `prompt`, `size`, `quality`, `ref`). The key is read from
   the git-ignored `.env`; raw images land in the git-ignored `art-src/`. Elements are drawn on a flat magenta
   (`#FF00FF`) background, or green (`#00FF00`) for the violet things (table, rune book, conduit).
2. `node tools/art-process.mjs tools/art-process.json`: keys the background colour out, takes its tint out of glass,
   trims to the subject, scales it into the element's box with area averaging (1 art pixel = 1 scene unit), hard alpha,
   reduces to 12–20 colours, and scales up ×4 with nearest neighbour. Backgrounds are cropped to 16:9 and reduced to 64
   colours. It prints each picture's size in scene units, which is what the `ART` boxes use.

## Swapping art in

1. Put the PNG in `www/art/` with the file name above (the size can be any multiple of the scene box; 4× is the
   target).
2. Add the file name to `www/art/art.json`: `{ "files": ["workshop_forge.png", …] }`. Only listed files are loaded,
   so missing art never shows a broken image or a 404; a listed file that fails to load falls back to the drawing.
3. To move or resize an element, change its `x, y, w, h` in the `ART` table in `www/js/scene.js`; the hotspot is the
   element's box. Add new decorations the same way (a row with `bg: true` is not clickable).
4. Bump `VERSION` in `www/sw.js` so players get the new files.
