-- Follow-up to Stage 6C. Keeps old data; no Production execution here.
begin;
alter table public.alert_settings add column generation_tokens numeric not null default 20 check(generation_tokens between 0 and 20), add column generation_refilled_at timestamptz not null default now();
create table public.alert_generation_state (
 user_id uuid not null references auth.users(id) on delete cascade,
 location_key text not null check(location_key ~ '^[-0-9:]{1,32}$'),
 zone text not null check(length(zone) between 1 and 64), last_generated timestamptz not null,
 primary key(user_id,location_key,zone)
);
alter table public.alert_generation_state enable row level security;
alter table public.alert_generation_state force row level security;
create policy own_alert_generation on public.alert_generation_state for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.alert_generation_state from public,anon,authenticated,service_role;
create index weather_alerts_scope on public.weather_alerts(user_id,location_key,zone);
create or replace function public.my_alerts(payload jsonb default '{"operation":"load"}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); op text:=payload->>'operation'; pro boolean; enabled_kinds text[]; last_run timestamptz; tokens numeric; refilled timestamptz; checked_at timestamptz; scoped boolean;
 ev jsonb; k text; ek text; city_name text; location_id text; zone_name text; start_ms numeric; end_ms numeric;
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
   where user_id=uid and location_key=location_id and zone=zone_name and event_key=payload->>'key' and (pro or kind not in ('walk','garden','sport'));
 elsif op='clear' then
  -- Tombstones preserve deduplication until expiry, including concurrent refresh.
  update public.weather_alerts set hidden=true,is_read=true,event=jsonb_build_object('kind',kind,'start',event->'start','end',event->'end') where user_id=uid and location_key=location_id and zone=zone_name;
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
    if k=any(enabled_kinds) then
     -- Keep identity/read/hidden state when a refreshed forecast shifts a risk.
     select event_key into ek from public.weather_alerts where user_id=uid and location_key=location_id and zone=zone_name and kind=k and (event->>'start')::numeric<end_ms and (event->>'end')::numeric>start_ms order by updated_at desc limit 1;
     ek:=coalesce(ek,jsonb_build_array(location_id,zone_name,k,start_ms)::text);
     insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event) values(uid,ek,k,location_id,city_name,zone_name,ev)
      on conflict(user_id,event_key) do update set city=excluded.city,event=case when weather_alerts.hidden then weather_alerts.event else excluded.event end,updated_at=case when weather_alerts.hidden then weather_alerts.updated_at else now() end;
    end if;
   end loop;
  end if;
 end if;
 delete from public.weather_alerts where user_id=uid and updated_at<now()-interval '7 days';
 delete from public.weather_alerts where user_id=uid and event_key in (select event_key from public.weather_alerts where user_id=uid order by updated_at desc,event_key offset 200);
 delete from public.alert_generation_state where user_id=uid and last_generated<now()-interval '7 days';
 delete from public.alert_generation_state where user_id=uid and (location_key,zone) in (select location_key,zone from public.alert_generation_state where user_id=uid order by last_generated desc,location_key,zone offset 64);
 return jsonb_build_object('contractVersion',2,'scope',case when scoped then jsonb_build_object('locationKey',location_id,'zone',zone_name) else null end,'pro',pro,'enabled',case when pro then enabled_kinds else array(select unnest(enabled_kinds) except select unnest(array['walk','garden','sport']::text[])) end,
 'alerts',coalesce((select jsonb_agg(jsonb_build_object('key',event_key,'locationKey',location_key,'city',city,'zone',zone,'event',event,'updated',extract(epoch from updated_at)*1000,'read',is_read)) from public.weather_alerts where user_id=uid and scoped and location_key=location_id and zone=zone_name and not hidden and (event->>'end')::numeric>extract(epoch from now())*1000 and kind=any(enabled_kinds) and (pro or kind not in ('walk','garden','sport'))),'[]'::jsonb));
end $$;
revoke all on function public.my_alerts(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.my_alerts(jsonb) to authenticated;
commit;
