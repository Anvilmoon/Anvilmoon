-- Leaderboards, built from every account's saved blades. The server calls this for /api/records.
-- One row per name on each board. Changing a board is a change here only; the server code does not need republishing.
-- Settings read from am_state.blob->'config': hideFromRecords (usernames), giftTypes (blade types), forgerAka (old smith name -> name now).
create or replace function public.am_records() returns jsonb language sql stable set search_path = public as $fn$
with st as (select blob from am_state where id = 1),
hide as (select lower(x) as n from st, jsonb_array_elements_text(coalesce(blob->'config'->'hideFromRecords', '[]'::jsonb)) x),
gift as (select unnest(array['testsword','sweetchilli']) as t union select x from st, jsonb_array_elements_text(coalesce(blob->'config'->'giftTypes', '[]'::jsonb)) x),
aka as (select key as old, value as new from st, jsonb_each_text(coalesce(blob->'config'->'forgerAka', '{}'::jsonb))),
u as (select s.uid, st.blob->'users'->s.uid->>'username' as username, s.save from am_saves s, st
      where st.blob->'users' ? s.uid and lower(st.blob->'users'->s.uid->>'username') not in (select n from hide)),
sl as (select u.uid, u.username, x as slot from u, jsonb_array_elements(case when jsonb_typeof(u.save->'slots') = 'array' then u.save->'slots' else '[]'::jsonb end) x where jsonb_typeof(x) = 'object'),
raw as (select sl.username, coalesce(nullif(bl->>'forger', ''), sl.slot->>'name', '?') as forger, bl
        from sl, jsonb_array_elements(case when jsonb_typeof(sl.slot->'blades') = 'array' then sl.slot->'blades' else '[]'::jsonb end) bl
        where jsonb_typeof(bl) = 'object' and bl->>'status' in ('owned','sold','commission','listed') and coalesce(bl->>'cracked', 'false') <> 'true'
          and jsonb_typeof(bl->'len') = 'number' and bl->>'type' ~ '^[a-z0-9]{2,24}$' and bl->>'type' not in (select t from gift)),
b as (select distinct on (who, type, len, grade, rarity) * from (
        select username as "user", left(regexp_replace(coalesce((select new from aka where old = raw.forger), raw.forger), '[^[:alnum:] ._\-]', '', 'g'), 24) as who,
               bl->>'type' as type, (bl->>'len')::numeric as len, coalesce(floor((bl->>'si')::numeric), 0)::int as si, coalesce(floor((bl->>'grade')::numeric), 0)::int as grade,
               coalesce(floor((bl->>'rarity')::numeric), 0)::int as rarity, coalesce(floor((bl->>'anvil')::numeric), 0)::int as anvil,
               case when bl->>'shine' in ('star','temp') then bl->>'shine' else '' end as shine, case when bl->>'moon' = 'true' then 1 else 0 end as moon, bl->'id' as id
        from raw) x order by who, type, len, grade, rarity),
longest  as (select * from (select distinct on (who) * from b order by who, len desc) x order by len desc limit 10),
shortest as (select * from (select distinct on (who) * from b order by who, len asc) x order by len asc limit 10),
finest   as (select * from (select distinct on (who) * from b order by who, grade desc, len desc) x order by grade desc, len desc limit 10),
rough    as (select * from (select distinct on (who) * from b where anvil = 0 order by who, len desc) x order by len desc limit 10),
pertype  as (select distinct on (type) * from b order by type, len desc),
picked as (select * from longest union select * from shortest union select * from finest union select * from rough union select * from pertype),
wealth as (select u.username as "user",
             coalesce(case when jsonb_typeof(u.save->'wealth') = 'number' then floor((u.save->>'wealth')::numeric) end,
                      (select coalesce(sum(case when jsonb_typeof(slot->'coin') = 'number' then floor((slot->>'coin')::numeric) else 0 end), 0) from sl where sl.uid = u.uid)) as wealth
           from u)
select jsonb_build_object(
  'entries', coalesce((select jsonb_agg(to_jsonb(p)) from picked p), '[]'::jsonb),
  'wealth', coalesce((select jsonb_agg(jsonb_build_object('user', w."user", 'wealth', w.wealth) order by w.wealth desc) from (select * from wealth where wealth > 0 order by wealth desc limit 10) w), '[]'::jsonb),
  'players', (select count(*) from st, jsonb_object_keys(blob->'users')),
  'blades', (select count(*) from b));
$fn$;
revoke all on function public.am_records() from public, anon, authenticated;
