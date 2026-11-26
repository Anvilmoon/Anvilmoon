# Server: Supabase Edge Function `api`

File: `supabase/functions/api/index.ts` (Deno, `// @ts-nocheck`). Dependencies: `npm:postgres@3.4.5`,
`npm:jose@5.9.6`, `node:crypto`. Env: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (OAuth fallback),
`AM_TEST=1` (local tests: disables throttles, accepts `test:` OAuth tokens).

## Database

```sql
am_state   (id=1 only, ver bigint, next_due bigint, blob jsonb)   -- all shared state
am_saves   (uid text pk, save jsonb, save_at bigint, rev int)      -- one save per account
am_history (uid, at, rev, save jsonb, pk(uid, at))                 -- last 12 snapshots, ≥10 min apart
```
RLS on, all privileges revoked from `anon`/`authenticated`.

### `am_state.blob` (the in-memory `db`)

| Key | Shape |
|---|---|
| `users` | `{uid: {id, username, pass ("salt:scrypt-hex" or null), created, rating, wins, losses, rc (recovery hash), links: {sub: {providers, name, at}}}}` |
| `names` | `{lowercase username: uid}` |
| `sessions` | `{sha256(token): {uid, exp}}` |
| `links` | `{oauth sub: uid}` |
| `mail` | `{id: {id, to, t, cid, note, coin?, blade?, soldId?, returnId?, gift?, heal?}}` |
| `ah` | `{id: listing}` (see below) |
| `ahRev` | Counter bumped on any auction change |
| `queue` | `{ranked: [entry], wager: [entry]}` |
| `matches` | `{id: match}` |
| `playerMatch` | `{uid: matchId}` |
| `campaigns` | `{giftId: {at, sent, to?, last: {uid: t}}}` |
| `limits` | `{key: {n, t}}` throttle counters |
| `config` | `{hideFromRecords: [username], giftTypes: [type], forgerAka: {old: new}, personal: [gift]}` (edited by hand in the DB) |
| `rec` | Cached records `{at, data}` (60 s) |
| `seq`, `prunedAt` | Id counter, last prune time |

Ids: prefix + base36 `seq` + 8 hex chars (`u…` users, `m…` mail, `a…` auctions, `x…` matches).

### SQL functions (`supabase/sql/am_records.sql`)

- `am_records()` → `{entries, wealth, players, blades}`. Explodes every save's `slots[].blades[]`, filters
  (status owned/sold/commission/listed, not cracked, valid type, not a gift type, user not hidden),
  re-signs forger names via `config.forgerAka`, dedupes, and returns the union of the per-smith top 10 for
  longest, shortest, highest grade, longest on anvil 0, plus the longest of each type. Wealth = sum of `coin`
  across the save's slots, top 10.
- `am_x_records(uid, input)` → `am_records()` plus `smiths: {username: {t: title, b: badge, l: look}}`
  taken from each save's `hall`. (Defined twice in the file; the second definition wins.)
- `am_x_hall(uid, input)` → public hall for `input.u`: user, created, rating, wins, losses and the `hall`
  object from their save, or `{missing: true}`.

**Extension point:** any SQL function named `am_x_<name>(uid text, input jsonb) returns jsonb` is reachable at
`GET|POST /api/x/<name>` without redeploying the function. It must not write `am_state`.

## Endpoints

Auth is `Authorization: Bearer <token>` (or `?token=`). "Auth" = 401 "Sign in first." without it.

| Method & path | Auth | Body / query | Does |
|---|---|---|---|
| `POST /api/register` | – | `{username, password}` | Username `^[A-Za-z0-9_]{3,20}$`, password ≥ 8. Creates user (rating 1000), returns `{token, user, code}` (recovery code) |
| `POST /api/login` | – | `{username, password}` | `{token, user}` |
| `POST /api/logout` | token | – | Deletes the session |
| `POST /api/password` | yes | `{current, next}` or `{access_token, next}` | Change, set (OAuth-only accounts) or reset via linked OAuth (signs out other devices) |
| `POST /api/recovery` | yes | `{password}` | New recovery code (old one stops working) |
| `POST /api/recover` | – | `{username, code, next}` | Reset password with code; signs out all devices; returns new token and new code |
| `POST /api/oauth` | opt. | `{access_token, mode?, username?}` | Sign in with a linked provider, link (`mode:'link'`), or create (`needName` first, then `username`) |
| `POST /api/unlink` | yes | `{id}` | Unlink a provider (not the last sign-in method) |
| `GET /api/me` | yes | – | `{user, saveAt}` |
| `GET /api/save` | yes | – | `{save, saveAt, rev}` |
| `PUT /api/save` | yes | `{save, base}` | 409 + server save if `base ≠ rev`; else snapshot, store, `rev+1` |
| `GET /api/poll` | yes | `?ver=` | `{mail: signature, ah: ahRev, pvp: matchView, queued, ver}` or just `{ver}` (fast path) |
| `GET /api/mail` | yes | – | Re-sends missing keepsakes (`healGifts`), then `{mail: [...]}` |
| `POST /api/mail/ack` | yes | `{ids}` | Deletes collected mail |
| `GET /api/ah` | – | – | `{listings, me}` (only unexpired) |
| `POST /api/ah` | yes | `{blade, start, buyout, dur, smith, cid, clientId, deposit, name}` | Lists a blade (cleaned, no gifts, ≤ 20 per player) |
| `POST /api/ah/:id/bid` | yes | `{amount, smith, cid}` | Bid (or buyout if amount ≥ buyout). Refunds previous bidder by mail |
| `POST /api/ah/:id/buyout` | yes | `{smith, cid}` | Buy now: seller paid by mail, blade returned in the response |
| `POST /api/ah/:id/cancel` | yes | – | Seller cancels if no bids; returns `clientId` |
| `GET /api/records` | – | – | `am_records()`, cached 60 s in the blob |
| `GET /api/pvp/ladder` | – | – | Top 25 by rating among players with ≥ 1 ranked result |
| `POST /api/pvp/queue` | yes | `{mode, blade, bladeId, smith, cid}` | Match with the first waiting player or queue |
| `POST /api/pvp/leave` | yes | – | Leave queues |
| `GET /api/pvp/state` | yes | – | `{match, queued}` |
| `POST /api/pvp/move` | yes | `{matchId, move}` | strike/guard/feint; resolves the round when both moved |
| `POST /api/pvp/forfeit` | yes | – | Yield the current duel |
| `GET|POST /api/x/:name` | opt. | query or body | Calls SQL `am_x_<name>(uid, input)` |

The client currently uses `/api/x/records` (falls back to `/api/records`) and `/api/x/hall?u=`.

## Auction listing (server side)

```
{id, seller, sellerName, sellerSmith, sellerCid, clientId, blade (cleaned), bladeName,
 start, buyout, bid, bidder, bidderCid, bidderSmith, deposit, created, expires}
```
`clientId` is the seller's local tag on the blade (`b.ahId`) so mail can mark it sold (`soldId`) or returned
(`returnId`). `cid` is the smith id the mail is addressed to.

## Match

```
{id, mode: 'ranked'|'wager'|'practice', round, deadline, over, overAt, winner, log: [string],
 result: {uid: {outcome, ratingChange, lostBladeId?}},
 p: [{uid, name, smith, cid, clientBladeId, blade, rating, since, seen, bot?, f: {wt, power, hp}, move}]}
```
`matchView(M, uid)` returns `you`/`foe` (moves hidden, only `moved` flags), last 8 log lines and your result.
Matches are deleted 60 s after they end.

## Timed work in `tick()`

| What | When |
|---|---|
| Gift campaigns (`CAMPAIGNS`, `EXTRA_GIFTS`, `PERSONAL`, `config.personal`) | Mailed once, recorded in `db.campaigns` |
| Settle expired auctions (winner gets blade, seller gets 95% + deposit; or blade returned, deposit kept) | Every request after `expires` |
| Arena round timeout (no move = guard) | After `deadline` (15 s) |
| Ranked queue → bot after 20 s | |
| Drop queue entries not seen for 2 min | (poll refreshes `seen` every 30 s) |
| Prune expired sessions and old throttles | Hourly |

## Gifts (keepsakes)

Hard-coded campaigns: The Test Sword to every user existing on 2026-11-18 (plus one extra for `lexy`), The
Sweet Chilli to `sweetchilli`, a Test Sword to `mouflon` (2026-11-24). More can be added via `config.personal`
without redeploying. `healGifts` re-mails a keepsake (marked `heal`) if a recipient's save has lost it and no
copy is waiting, at most every 5 minutes.
