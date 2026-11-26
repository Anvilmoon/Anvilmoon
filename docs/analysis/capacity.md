# Capacity: can the free tiers handle server-authoritative forging?

Written 2026-11-26. Question from the dev: they kept forging **client-side** because they feared a
server-side ("backend") version would use too much data. This estimates the real cost. **Short answer: the
worry is backwards — server-authoritative forging would use *less* data than what the game already does
today.** No code was changed.

All payload sizes are measured live from the `lexy` test account; free-tier limits are from a 2026-11-26 web
check and should be re-verified (they change). Numbers are order-of-magnitude, not billing-exact.

## Free-tier limits (2026-11-26)

| Service | Metric | Free limit | Notes |
|---|---|---|---|
| Supabase | Edge Function invocations | **500,000 / month** | Applied **org-wide**, not per project |
| Supabase | Egress (outbound) | **5 GB / month** | Outbound only; request bodies you upload don't count |
| Supabase | Database size | **500 MB** | |
| Supabase | — | project paused after 7 days idle | |
| Vercel | Bandwidth (Hobby) | **100 GB / month** | Serves the static game only (`/api` is rewritten to Supabase) |

Egress (server → client) is the thing to watch; **ingress (client → server uploads) is not metered**. That
detail matters a lot here, see below.

## Measured payload sizes (live)

| Thing | Size |
|---|---|
| One whole-save `PUT /api/save` body | **28.8 KB** (lexy, 110 blades) |
| One blade in a save | ~207 bytes |
| A hypothetical server-side forge request `{type, strikes[], quench}` | ~100 bytes |
| A forge response (the one new blade) | ~250 bytes |
| `GET /api/save` on load | 28.8 KB |
| `GET /api/poll?ver=` fast path response | ~20 bytes |

Vercel serves the game shell once (~460 KB `index.html` + fonts/icons), then the service worker caches it, so
Vercel bandwidth is a non-issue at any realistic player count (100 GB ÷ ~0.5 MB first load ≈ 200,000 cold
loads/month). The interesting budget is Supabase.

## What the game does **today** (client-side forging)

Forging happens entirely in the browser; the result is just folded into the save, and the whole save is
uploaded on a timer. Two always-on loops dominate, per **open tab**:

- **Whole-save autosave every ~5 s.** A global `setInterval` (`index.html:3543`) nudges demand and calls
  `save()` → `pushSave()`, a 28.8 KB `PUT`. This runs whether or not the player does anything, and even when
  the tab is hidden. ≈ **720 invocations/hour/tab**, and it grows as saves grow.
- **Poll every 8 s** (1.5 s during a duel), paused when the tab is hidden. ≈ **450 invocations/hour/tab**.
- Plus mail every 60 s, auction refresh, records refetch.

So **one idle open tab costs ≈ 780–1,200 Supabase invocations/hour while doing nothing.** Against a 500K/month
org-wide budget that is only ~**420–640 tab-hours per month for the entire game**. At ~1 hr/day of open tab
per active player (~30 hr/month) that is roughly **15–20 active players before the free invocation budget is
exhausted** — and almost none of those invocations are forges. They are autosave and poll.

Egress today is modest per request (poll answers are tiny; the big ones are the 28.8 KB `GET /api/save` on
load and `GET /api/records`), so egress is not the current wall. **Invocations are.**

## What server-authoritative forging would cost

"Server-side forging" means: the client sends `{type, strikes, quench}` (~100 bytes), the server does the
rolls and returns the one new blade (~250 bytes), and the blade is stored server-side. Critically, if the
server owns the state you also **stop uploading the whole 28.8 KB save every 5 s** — mutations become small
deltas sent only when something actually happens.

Per forge: **1 invocation, ~350 bytes round trip.** Forging is **energy-gated**: 1 energy per forge, energy
regenerates 1 per 3 min (20/hour, cap 10) and meals add up to 30. So an active player sustains roughly
**20–40 forges/hour**, and **zero while idle**.

Worked example — 100 active players, each forging 30 blades/day:

- 3,000 forges/day ≈ **90,000 forge invocations/month** (18% of the 500K budget).
- Egress from forges ≈ 90,000 × 250 bytes ≈ **23 MB/month** (0.5% of 5 GB).

So **forging itself is trivially cheap.** The free tier could absorb the forge traffic of **several hundred
active players** without noticing. The data volume of a forge is about **80× smaller** than a single one of
today's 28.8 KB autosaves, and you'd send far fewer of them.

## So what actually limits scale?

Not forging. Two things, and neither is fixed by keeping forging on the client:

1. **Polling and the 5 s autosave.** These, not forges, eat the invocation budget. Server-authoritative
   forging *removes* the 5 s autosave (a big win) but polling remains. To grow, lengthen the poll interval,
   keep using the cheap `?ver=` fast path, and pause polling when hidden (already done). This alone would
   raise the current ~15–20 player ceiling several-fold.
2. **The single-row lock (separate bottleneck).** Every non-fast-path request does
   `SELECT ... FOR UPDATE` on the one `am_state` row and rewrites the **entire** shared blob (all users,
   sessions, mail, auctions) when anything changes, over a single DB connection (`max: 1`). This serialises
   the whole server and the per-write cost grows with the total player base. This caps throughput to maybe a
   few dozen writes/second **regardless of which tier you pay for**, and is the real ceiling once you pass a
   few dozen concurrent writers. Moving forging server-side makes this *worse* per forge unless the state is
   also split out of the single blob (e.g. a real `blades` table, or at least per-user rows), so a forge
   locks only that player's row.

Database size is a slow, secondary concern: saves grow forever because sold/salvaged blades are never
removed (lexy already carries 110 blades for 5 owned). At ~28.8 KB/save plus up to 12 history snapshots
(~345 KB/user), 500 MB holds very roughly **1,000–1,500 heavy accounts**. Pruning dead blades or storing
blades in their own table removes this ceiling too.

## Verdict

- **The dev's data worry is unfounded for this game.** Server-authoritative forging would *reduce* total
  traffic, because the current design already uploads the whole 28.8 KB save every ~5 seconds per open tab —
  far more data than a stream of ~350-byte forge calls sent only when forging. A forge is tiny and
  energy-gated.
- On the free tiers, **forge data volume is not a limiting factor** — it could support hundreds of active
  players' forging. Vercel bandwidth is a non-issue.
- The real limits are **(a)** the always-on 5 s autosave + poll invocation count (fixable, and partly fixed
  *by* going server-side), and **(b)** the single-row `am_state` lock + unbounded save growth (architectural,
  must be addressed regardless of client-vs-server forging).
- **Recommendation:** going server-authoritative for forging is both the security fix (closes the
  fake-save exploit) *and* a bandwidth win — but pair it with splitting player state out of the single blob
  (per-user rows or a blades table) so forges don't all serialise on one lock, and drop/raise the 5 s
  whole-save autosave. Do those together, not forging alone.

Sources for the free-tier figures:
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://vercel.com/docs/limits/overview
- https://vercel.com/docs/accounts/plans/hobby-plan
