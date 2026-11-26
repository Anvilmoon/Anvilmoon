-- =====================================================================================================
-- Anvilmoon database move, version 2: from one shared am_state row to one table per kind of thing.
--
-- Run ONCE, in the Supabase SQL editor, at the same time as the new server is deployed (see
-- docs/server-authority.md, "Going live"). It is safe to run twice: a second run changes nothing.
--
-- What it does:
--   1. keeps a full copy of the old shared row in am_state_backup, so nothing can be lost;
--   2. creates the new tables (accounts, sessions, mail, auctions, throttles) and copies the data in;
--   3. removes the copied parts from am_state, which keeps only the Arena, gift campaigns and settings.
-- Players' saves (am_saves) are not touched here: the server brings each one up to date the first time
-- that player opens the game (see upgradeSave in www/js/rules.js).
-- Live Arena queues and duels are cleared (they last seconds; nobody loses a blade, the old server never
-- took blades away before a duel ended).
-- Afterwards, run supabase/sql/am_records.sql again (the Records functions now read am_users).
-- =====================================================================================================
begin;

-- 1. the safety copy
create table if not exists public.am_state_backup (at timestamptz not null default now(), blob jsonb);
alter table public.am_state_backup enable row level security;
revoke all on public.am_state_backup from anon, authenticated;
insert into public.am_state_backup (blob) select blob from public.am_state where id = 1 and blob ? 'users';

-- 2. the new tables (the same as supabase/schema.sql)
alter table public.am_saves add column if not exists snap_at bigint not null default 0;
create table if not exists public.am_users (
  uid text primary key, username text not null, uname_lc text not null unique, pass text, created bigint not null default 0,
  rating int not null default 1000, wins int not null default 0, losses int not null default 0, rc text, links jsonb not null default '{}'::jsonb);
create table if not exists public.am_sessions (hash text primary key, uid text not null, exp bigint not null);
create index if not exists am_sessions_uid on public.am_sessions (uid);
create table if not exists public.am_links (sub text primary key, uid text not null);
create table if not exists public.am_limits (key text primary key, n int not null default 0, t bigint not null default 0);
create table if not exists public.am_mail (id text primary key, uid text not null, t bigint not null, body jsonb not null);
create index if not exists am_mail_uid on public.am_mail (uid);
create table if not exists public.am_auctions (id text primary key, seller text not null, expires bigint not null, changed bigint not null default 0, data jsonb not null);
create index if not exists am_auctions_seller on public.am_auctions (seller);
create index if not exists am_auctions_expires on public.am_auctions (expires);
alter table public.am_users enable row level security;
alter table public.am_sessions enable row level security;
alter table public.am_links enable row level security;
alter table public.am_limits enable row level security;
alter table public.am_mail enable row level security;
alter table public.am_auctions enable row level security;
revoke all on public.am_users, public.am_sessions, public.am_links, public.am_limits, public.am_mail, public.am_auctions from anon, authenticated;

-- copy the data across
insert into public.am_users (uid, username, uname_lc, pass, created, rating, wins, losses, rc, links)
select u.key, u.value->>'username', lower(u.value->>'username'), u.value->>'pass',
       coalesce((u.value->>'created')::numeric, 0)::bigint, coalesce((u.value->>'rating')::numeric, 1000)::int,
       coalesce((u.value->>'wins')::numeric, 0)::int, coalesce((u.value->>'losses')::numeric, 0)::int,
       u.value->>'rc', coalesce(u.value->'links', '{}'::jsonb)
from public.am_state s, jsonb_each(coalesce(s.blob->'users', '{}'::jsonb)) u
where s.id = 1
on conflict do nothing;

insert into public.am_sessions (hash, uid, exp)
select x.key, x.value->>'uid', (x.value->>'exp')::numeric::bigint
from public.am_state s, jsonb_each(coalesce(s.blob->'sessions', '{}'::jsonb)) x
where s.id = 1 and x.value->>'uid' is not null
on conflict do nothing;

insert into public.am_links (sub, uid)
select x.key, x.value from public.am_state s, jsonb_each_text(coalesce(s.blob->'links', '{}'::jsonb)) x where s.id = 1
on conflict do nothing;

insert into public.am_limits (key, n, t)
select x.key, coalesce((x.value->>'n')::numeric, 0)::int, coalesce((x.value->>'t')::numeric, 0)::bigint
from public.am_state s, jsonb_each(coalesce(s.blob->'limits', '{}'::jsonb)) x where s.id = 1
on conflict do nothing;

insert into public.am_mail (id, uid, t, body)
select x.key, x.value->>'to', coalesce((x.value->>'t')::numeric, 0)::bigint, x.value - 'id' - 'to' - 't'
from public.am_state s, jsonb_each(coalesce(s.blob->'mail', '{}'::jsonb)) x where s.id = 1 and x.value->>'to' is not null
on conflict do nothing;

insert into public.am_auctions (id, seller, expires, changed, data)
select x.key, x.value->>'seller', (x.value->>'expires')::numeric::bigint, coalesce((x.value->>'created')::numeric, 0)::bigint, x.value
from public.am_state s, jsonb_each(coalesce(s.blob->'ah', '{}'::jsonb)) x where s.id = 1
on conflict do nothing;

-- 3. am_state keeps only the Arena, gift campaigns (which gifts went out) and settings (config)
update public.am_state
set blob = (blob - 'users' - 'names' - 'sessions' - 'links' - 'limits' - 'mail' - 'ah' - 'ahRev' - 'rec' - 'seq'
                 - 'queue' - 'matches' - 'playerMatch')
           || '{"queue": {"ranked": [], "wager": []}, "matches": {}, "playerMatch": {}, "lastMatch": {}}'::jsonb,
    ver = ver + 1, next_due = 0
where id = 1 and blob ? 'users';

commit;
