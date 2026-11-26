create table if not exists public.am_state (id int primary key default 1 check (id = 1), ver bigint not null default 0, next_due bigint not null default 0, blob jsonb not null default '{}'::jsonb);
create table if not exists public.am_saves (uid text primary key, save jsonb, save_at bigint not null default 0, rev int not null default 0);
create table if not exists public.am_history (uid text not null, at bigint not null, rev int not null default 0, save jsonb, primary key (uid, at));
insert into public.am_state (id) values (1) on conflict do nothing;
alter table public.am_state enable row level security;
alter table public.am_saves enable row level security;
alter table public.am_history enable row level security;
revoke all on public.am_state, public.am_saves, public.am_history from anon, authenticated;
