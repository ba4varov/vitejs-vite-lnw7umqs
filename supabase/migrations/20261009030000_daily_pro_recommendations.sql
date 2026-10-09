-- Stable daily Pro identity. Apply only after review; no Production execution.
-- Existing RPC/window input stays compatible. Source rows are archived in-place,
-- not deleted; any read/hidden intent for a daily group wins during consolidation.
begin;
lock table public.weather_alerts in access exclusive mode;
alter table public.weather_alerts
 add column recommendation_date date,
 add column superseded boolean not null default false;
update public.weather_alerts
 set recommendation_date=(to_timestamp((event->>'start')::double precision/1000) at time zone zone)::date,
     superseded=true
 where kind in ('walk','garden','sport');

with groups as (
 select user_id,location_key,zone,kind,recommendation_date,
  bool_or(is_read) as was_read,bool_or(hidden) as was_hidden,max(updated_at) as latest_update
 from public.weather_alerts where superseded
 group by user_id,location_key,zone,kind,recommendation_date
), latest as (
 select distinct on (user_id,location_key,zone,kind,recommendation_date) *
 from public.weather_alerts where superseded
 -- A complete visible payload is preferable to a stripped tombstone; all source
 -- events remain in the archived rows, including other former hourly candidates.
 order by user_id,location_key,zone,kind,recommendation_date,
  (event ? 'feelsLikeMin') desc,updated_at desc,event_key
)
insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event,updated_at,is_read,hidden,recommendation_date)
 select g.user_id,jsonb_build_array(g.location_key,g.zone,g.kind,g.recommendation_date::text)::text,
  g.kind,g.location_key,l.city,g.zone,
  l.event||jsonb_build_object('day',g.recommendation_date::text,'windows',w.items,
   'start',w.items->0->'start','end',w.items->(jsonb_array_length(w.items)-1)->'end'),
  g.latest_update,g.was_read,g.was_hidden,g.recommendation_date
 from groups g join latest l using(user_id,location_key,zone,kind,recommendation_date)
 cross join lateral (
  select coalesce(jsonb_agg(e order by (e->>'start')::numeric),jsonb_build_array(l.event-'kind')) as items
  from (select distinct a.event-'kind' as e from public.weather_alerts a
   where a.user_id=g.user_id and a.location_key=g.location_key and a.zone=g.zone and a.kind=g.kind
    and a.recommendation_date=g.recommendation_date and a.updated_at=l.updated_at and a.event ? 'feelsLikeMin'
   order by (a.event-'kind') limit 3) candidates
 ) w;

alter table public.weather_alerts add constraint personal_alert_date
 check ((kind in ('walk','garden','sport')) = (recommendation_date is not null));
create unique index weather_alerts_daily_identity
 on public.weather_alerts(user_id,location_key,zone,kind,recommendation_date)
 where recommendation_date is not null and not superseded;

create or replace function public.my_alerts(payload jsonb default '{"operation":"load"}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); op text:=payload->>'operation'; pro boolean; enabled_kinds text[]; last_run timestamptz; tokens numeric; refilled timestamptz; checked_at timestamptz; scoped boolean;
 ev jsonb; k text; ek text; city_name text; location_id text; zone_name text; start_ms numeric; end_ms numeric; day date; windows jsonb;
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 if jsonb_typeof(payload)<>'object' or octet_length(payload::text)>30000 or op is null or op not in ('load','settings','generate','read','hide','clear') then raise exception 'invalid input'; end if;
 location_id:=payload->>'locationKey';zone_name:=payload->>'zone';
 scoped:=payload ? 'locationKey' or payload ? 'zone';
 if scoped and (jsonb_typeof(payload->'locationKey') is distinct from 'string' or jsonb_typeof(payload->'zone') is distinct from 'string' or location_id is null or location_id !~ '^[-0-9:]{1,32}$' or zone_name is null or length(zone_name)>64 or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone_name)) then raise exception 'invalid scope';end if;
 if op in ('read','hide','clear','generate') and not scoped then raise exception 'scope required';end if;
 insert into public.alert_settings(user_id) values(uid) on conflict do nothing;
 -- Per-account lock makes rate limiting and duplicate prevention transactional.
 select enabled,generation_tokens,generation_refilled_at into enabled_kinds,tokens,refilled from public.alert_settings where user_id=uid for update;
 checked_at:=clock_timestamp();
 select exists(select 1 from public.get_my_entitlements() e where e.plan='pro' and 'planner:advanced'=any(e.permissions)) into pro;
 if op='settings' then
  if jsonb_typeof(payload->'enabled') is distinct from 'array' or jsonb_array_length(payload->'enabled')>8 then raise exception 'invalid settings'; end if;
  select coalesce(array_agg(value),'{}') into enabled_kinds from jsonb_array_elements_text(payload->'enabled');
  if not enabled_kinds <@ array['rain','storm','wind','cold','heat','walk','garden','sport']::text[] then raise exception 'invalid kinds'; end if;
  if not pro and enabled_kinds && array['walk','garden','sport']::text[] then raise exception 'Pro required' using errcode='42501'; end if;
  update public.alert_settings set enabled=enabled_kinds where user_id=uid;
 elsif op in ('read','hide') then
  if length(payload->>'key')>300 then raise exception 'invalid key'; end if;
  update public.weather_alerts set is_read=case when op='read' then true else is_read end,hidden=case when op='hide' then true else hidden end,event=case when op='hide' then jsonb_build_object('kind',kind,'start',event->'start','end',event->'end') else event end
   where user_id=uid and location_key=location_id and zone=zone_name and not superseded and (event_key=payload->>'key' or (kind,recommendation_date) in (select kind,recommendation_date from public.weather_alerts where user_id=uid and location_key=location_id and zone=zone_name and event_key=payload->>'key' and recommendation_date is not null)) and (pro or kind not in ('walk','garden','sport'));
 elsif op='clear' then
  -- Tombstones preserve deduplication until expiry, including concurrent refresh.
  update public.weather_alerts set hidden=true,is_read=true,event=jsonb_build_object('kind',kind,'start',event->'start','end',event->'end') where user_id=uid and location_key=location_id and zone=zone_name and not superseded;
 elsif op='generate' then
  if jsonb_typeof(payload->'events') is distinct from 'array' or jsonb_array_length(payload->'events')>189 then raise exception 'invalid events'; end if;
  city_name:=payload->>'city'; location_id:=payload->>'locationKey'; zone_name:=payload->>'zone';
  if location_id is null or location_id !~ '^[-0-9:]{1,32}$' or city_name is null or length(city_name) not between 1 and 100 or zone_name is null or length(zone_name)>64 or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone_name) then raise exception 'invalid location'; end if;
  if not pro and exists(select 1 from jsonb_array_elements(payload->'events') e where e->>'kind' in ('walk','garden','sport')) then raise exception 'Pro required' using errcode='42501';end if;
  select last_generated into last_run from public.alert_generation_state where user_id=uid and location_key=location_id and zone=zone_name;
  if last_run is null or last_run<=checked_at-interval '30 seconds' then
   -- Account lock above serializes both the per-location cooldown and token bucket.
   -- New locations are immediate within a burst of 20, refilled at 20/minute.
   tokens:=least(20,tokens+greatest(0,extract(epoch from checked_at-refilled))/3);
   if tokens<1 then raise exception 'ALERTS_RATE_LIMITED';end if;
   update public.alert_settings set generation_tokens=tokens-1,generation_refilled_at=checked_at where user_id=uid;
   insert into public.alert_generation_state(user_id,location_key,zone,last_generated) values(uid,location_id,zone_name,checked_at)
    on conflict(user_id,location_key,zone) do update set last_generated=excluded.last_generated;
   for ev in select value from jsonb_array_elements(payload->'events') loop
    if jsonb_typeof(ev)<>'object' or octet_length(ev::text)>1500 then raise exception 'invalid event'; end if;
    k:=ev->>'kind';
    if k is null or k not in ('rain','storm','wind','cold','heat','walk','garden','sport') or jsonb_typeof(ev->'start') is distinct from 'number' or jsonb_typeof(ev->'end') is distinct from 'number' then raise exception 'invalid event'; end if;
    start_ms:=(ev->>'start')::numeric;end_ms:=(ev->>'end')::numeric;
    if start_ms<extract(epoch from now())*1000-3600000 or end_ms<=start_ms or end_ms>extract(epoch from now()+interval '73 hours')*1000 then raise exception 'invalid period'; end if;
    if exists(select 1 from jsonb_object_keys(ev) f where f not in ('kind','start','end','min','max','feelsLikeMin','feelsLikeMax','rainProbability','rain','wind')) then raise exception 'unexpected event field';end if;
    if k in ('walk','garden','sport') then
     if not pro then raise exception 'Pro required' using errcode='42501'; end if;
     if end_ms-start_ms<>7200000 then raise exception 'invalid activity duration'; end if;
     if exists(select 1 from unnest(array['feelsLikeMin','feelsLikeMax','rainProbability','rain','wind']) f where jsonb_typeof(ev->f) is distinct from 'number') then raise exception 'invalid activity values';end if;
     if (ev->>'feelsLikeMin')::numeric< -100 or (ev->>'feelsLikeMax')::numeric>70 or (ev->>'feelsLikeMin')::numeric>(ev->>'feelsLikeMax')::numeric or (ev->>'rainProbability')::numeric not between 0 and 100 or (ev->>'rain')::numeric not between 0 and 500 or (ev->>'wind')::numeric not between 0 and 400 then raise exception 'invalid activity values';end if;
    else
     if jsonb_typeof(ev->'min') is distinct from 'number' or jsonb_typeof(ev->'max') is distinct from 'number' then raise exception 'invalid values'; end if;
     if (ev->>'min')::numeric>(ev->>'max')::numeric or (ev->>'min')::numeric < -100 or (ev->>'max')::numeric > 500 then raise exception 'invalid values'; end if;
     if (k='rain' and (ev->>'min')::numeric<10) or (k='wind' and (ev->>'min')::numeric<60) or (k='cold' and (ev->>'max')::numeric> -15) or (k='heat' and (ev->>'min')::numeric<40) or (k='storm' and ((ev->>'min')::numeric not in (95,96,99) or (ev->>'max')::numeric not in (95,96,99))) then raise exception 'threshold not met'; end if;
    end if;
    if k=any(enabled_kinds) and k not in ('walk','garden','sport') then
     -- Keep identity/read/hidden state when a refreshed forecast shifts a risk.
     select event_key into ek from public.weather_alerts where user_id=uid and location_key=location_id and zone=zone_name and kind=k and not superseded and (event->>'start')::numeric<end_ms and (event->>'end')::numeric>start_ms order by updated_at desc limit 1;
     ek:=coalesce(ek,jsonb_build_array(location_id,zone_name,k,start_ms)::text);
     insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event) values(uid,ek,k,location_id,city_name,zone_name,ev)
      on conflict(user_id,event_key) do update set city=excluded.city,event=case when weather_alerts.hidden then weather_alerts.event else excluded.event end,updated_at=case when weather_alerts.hidden then weather_alerts.updated_at else now() end;
    end if;
   end loop;
   -- Old and new API servers submit the same bounded planner windows. Group the
   -- entire batch before upserting; never retain windows from a previous forecast.
   for k,day,windows in
    select e->>'kind', (to_timestamp((e->>'start')::double precision/1000) at time zone zone_name)::date,
     jsonb_agg(e-'kind' order by (e->>'start')::numeric)
    from (select distinct value as e from jsonb_array_elements(payload->'events')) events
    where e->>'kind' in ('walk','garden','sport') and e->>'kind'=any(enabled_kinds)
    group by e->>'kind', (to_timestamp((e->>'start')::double precision/1000) at time zone zone_name)::date
   loop
    if jsonb_array_length(windows)>3 then raise exception 'too many daily windows';end if;
    if exists(select 1 from jsonb_array_elements(windows) w where
     (to_timestamp(((w->>'end')::double precision-1)/1000) at time zone zone_name)::date<>day)
     then raise exception 'activity crosses local date';end if;
    if exists(select 1 from jsonb_array_elements(windows) with ordinality a(w,i)
     join jsonb_array_elements(windows) with ordinality b(w,i) on a.i<b.i
     where (a.w->>'end')::numeric>(b.w->>'start')::numeric)
     then raise exception 'overlapping daily windows';end if;
    ek:=jsonb_build_array(location_id,zone_name,k,day::text)::text;
    ev:=(windows->0)||jsonb_build_object('kind',k,'day',day::text,'windows',windows,
     'end',windows->(jsonb_array_length(windows)-1)->'end');
    insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event,recommendation_date)
     values(uid,ek,k,location_id,city_name,zone_name,ev,day)
     on conflict(user_id,event_key) do update set city=excluded.city,event=excluded.event,updated_at=now();
    -- is_read and hidden are deliberately absent from the UPDATE. Account lock,
    -- primary key and the daily unique index serialize hide/read/generation.
   end loop;
  end if;
 end if;
 -- Preserve migrated source history. Daily tombstones cannot be evicted by a burst
 -- of risk events or city changes; normal seven-day retention applies to active rows.
 delete from public.weather_alerts where user_id=uid and not superseded and updated_at<now()-interval '7 days' and (recommendation_date is null or recommendation_date<(now() at time zone zone)::date-7);
 delete from public.weather_alerts where user_id=uid and recommendation_date is null and event_key in (select event_key from public.weather_alerts where user_id=uid and recommendation_date is null order by updated_at desc,event_key offset 200);
 delete from public.alert_generation_state where user_id=uid and last_generated<now()-interval '7 days';
 delete from public.alert_generation_state where user_id=uid and (location_key,zone) in (select location_key,zone from public.alert_generation_state where user_id=uid order by last_generated desc,location_key,zone offset 64);
 return jsonb_build_object('contractVersion',2,'dailyActivityVersion',1,'scope',case when scoped then jsonb_build_object('locationKey',location_id,'zone',zone_name) else null end,'pro',pro,'enabled',case when pro then enabled_kinds else array(select unnest(enabled_kinds) except select unnest(array['walk','garden','sport']::text[])) end,
 'alerts',coalesce((select jsonb_agg(jsonb_build_object('key',event_key,'locationKey',location_key,'city',city,'zone',zone,'event',event,'updated',extract(epoch from updated_at)*1000,'read',is_read)) from public.weather_alerts where user_id=uid and not superseded and scoped and location_key=location_id and zone=zone_name and not hidden and (event->>'end')::numeric>extract(epoch from now())*1000 and kind=any(enabled_kinds) and (pro or kind not in ('walk','garden','sport'))),'[]'::jsonb));
end $$;
revoke all on function public.my_alerts(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.my_alerts(jsonb) to authenticated;
commit;
