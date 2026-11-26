-- Anvilmoon database: everything the game server (supabase/functions/api) keeps.
-- Run this on an empty database. To move an existing database from the old layout (everything shared in one
-- am_state row), run supabase/sql/migrate_v2.sql instead; it creates the same tables and copies the data over.
-- Then run supabase/sql/am_records.sql (the Records boards and the public hall).

-- one row per player: the save the server keeps (coin, materials, blades...). Only the server writes it.
create table if not exists public.am_saves (uid text primary key, save jsonb, save_at bigint not null default 0, rev int not null default 0, snap_at bigint not null default 0);
-- older copies of each save, at most every 10 minutes, the last 12
create table if not exists public.am_history (uid text not null, at bigint not null, rev int not null default 0, save jsonb, primary key (uid, at));

-- accounts and sign-in
create table if not exists public.am_users (
  uid text primary key, username text not null, uname_lc text not null unique, pass text, created bigint not null default 0,
  rating int not null default 1000, wins int not null default 0, losses int not null default 0, rc text, links jsonb not null default '{}'::jsonb);
create table if not exists public.am_sessions (hash text primary key, uid text not null, exp bigint not null);
create index if not exists am_sessions_uid on public.am_sessions (uid);
create table if not exists public.am_links (sub text primary key, uid text not null);       -- Discord / Google account -> player
create table if not exists public.am_limits (key text primary key, n int not null default 0, t bigint not null default 0);   -- throttles

-- letters: auction payouts, returned blades, gifts
create table if not exists public.am_mail (id text primary key, uid text not null, t bigint not null, body jsonb not null);
create index if not exists am_mail_uid on public.am_mail (uid);
-- open auctions
create table if not exists public.am_auctions (id text primary key, seller text not null, expires bigint not null, changed bigint not null default 0, data jsonb not null);
create index if not exists am_auctions_seller on public.am_auctions (seller);
create index if not exists am_auctions_expires on public.am_auctions (expires);

-- one small shared row: Arena queues and live duels, gift campaigns, hand-edited settings (config)
create table if not exists public.am_state (id int primary key default 1 check (id = 1), ver bigint not null default 0, next_due bigint not null default 0, blob jsonb not null default '{}'::jsonb);
insert into public.am_state (id) values (1) on conflict do nothing;

-- nobody but the server's own database connection may touch these tables
alter table public.am_saves enable row level security;
alter table public.am_history enable row level security;
alter table public.am_users enable row level security;
alter table public.am_sessions enable row level security;
alter table public.am_links enable row level security;
alter table public.am_limits enable row level security;
alter table public.am_mail enable row level security;
alter table public.am_auctions enable row level security;
alter table public.am_state enable row level security;
revoke all on public.am_saves, public.am_history, public.am_users, public.am_sessions, public.am_links, public.am_limits,
  public.am_mail, public.am_auctions, public.am_state from anon, authenticated;
