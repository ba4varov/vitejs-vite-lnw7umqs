-- Manual rollout only. No Cron, HTTP, secrets, existing-account opt-in or enabled gates.
begin;
alter table public.push_controls
 add column delivery_enabled boolean not null default false,
 add column population_registration_enabled boolean not null default false,
 add column next_cycle_at timestamptz not null default '-infinity',
 add column next_provider_at timestamptz not null default '-infinity',
 add column run_id uuid,
 add column lease_until timestamptz;
alter table public.push_preferences add column language text not null default 'bg' check(language in ('bg','en'));

create function public.push_city_key(city jsonb) returns text
language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(trim_scale((city->>'latitude')::numeric),trim_scale((city->>'longitude')::numeric),city->>'zone')::text,'UTF8')),'hex')
$$;
revoke all on function public.push_city_key(jsonb) from public,anon,authenticated,service_role;

-- Retain legacy test registration behind its existing restriction.
alter function public.my_push(jsonb) rename to my_push_v2_internal;
revoke all on function public.my_push_v2_internal(jsonb) from public,anon,authenticated,service_role;
create function public.my_push(payload jsonb default '{"operation":"load"}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; control public.push_controls; expiration_value numeric; n integer;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 if payload ? 'language' and (payload->>'operation'<>'settings' or jsonb_typeof(payload->'language')<>'string' or payload->>'language' not in ('bg','en')) then raise invalid_parameter_value;end if;
 -- Global admission lock bounds unique enabled locations to 20 within the Free budget.
 if payload->>'operation' in ('settings','register','delete') then
  select * into control from public.push_controls where singleton for update;
 else select * into control from public.push_controls where singleton;end if;
 if payload->>'operation'='settings' and payload->'enabled'='true'::jsonb then
  select count(distinct public.push_city_key(c)) into n from (
   select c from public.push_preferences p cross join lateral jsonb_array_elements(p.cities) c where p.enabled and p.user_id<>auth.uid()
   union all select c from jsonb_array_elements(payload->'cities') c
  ) selected;
  if n>20 then raise exception 'PUSH_CITY_CAPACITY';end if;
 end if;
 if payload->>'operation'='register' and control.population_registration_enabled then
  if not control.registration_enabled then raise exception 'PUSH_REGISTRATION_DISABLED';end if;
  if control.vapid_public_key is null or payload->>'vapidPublicKey' is distinct from control.vapid_public_key then raise exception 'PUSH_KEY_MISMATCH';end if;
  if payload->'subscription' ? 'expirationTime' and payload->'subscription'->'expirationTime'<>'null'::jsonb then
   if jsonb_typeof(payload->'subscription'->'expirationTime') is distinct from 'number' then raise invalid_parameter_value;end if;
   expiration_value:=(payload->'subscription'->>'expirationTime')::numeric;
   if expiration_value<=extract(epoch from clock_timestamp())*1000 or expiration_value>253402300799000 then raise invalid_parameter_value;end if;
  end if;
  result:=public.my_push_v1_internal(payload-'vapidPublicKey');
  update public.push_devices set vapid_public_key=control.vapid_public_key,
   subscription_expires_at=case when expiration_value is null then null else to_timestamp((expiration_value/1000)::double precision) end
   where user_id=auth.uid() and endpoint=payload->'subscription'->>'endpoint';
 else result:=public.my_push_v2_internal(payload-'language');end if;
 if payload->>'operation'='settings' and payload ? 'language' then
  update public.push_preferences set language=payload->>'language' where user_id=auth.uid();
 end if;
 return result||jsonb_build_object('language',(select language from public.push_preferences where user_id=auth.uid()),
  'deliveryEnabled',control.delivery_enabled,
  'lastDelivery',(select jsonb_build_object('status',j.state,'at',coalesce(j.finished_at,j.claimed_at)) from public.push_weather_jobs j where j.user_id=auth.uid() and j.state in ('sent','failed','expired','uncertain') order by coalesce(j.finished_at,j.claimed_at) desc limit 1),
  'registrationPublicKey',case when control.registration_enabled and (control.population_registration_enabled or control.registration_test_user_id=auth.uid()) then control.vapid_public_key else null end);
end $$;
revoke all on function public.my_push(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.my_push(jsonb) to authenticated;

create table public.push_weather_cities (
 key text primary key, city jsonb not null,
 next_check_at timestamptz not null default '-infinity', updated_at timestamptz not null default clock_timestamp()
);
create table public.push_weather_events (
 id uuid primary key default gen_random_uuid(), city_key text not null references public.push_weather_cities(key),
 kind text not null check(kind in ('rain','storm','wind','cold','heat','walk','garden','sport')),
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 refreshed_at timestamptz not null default clock_timestamp()
);
create index push_weather_event_period on public.push_weather_events(city_key,kind,starts_at,ends_at);
create table public.push_weather_jobs (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.push_weather_events(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid references public.push_devices(id) on delete set null,
 fingerprint text not null, device_revision timestamptz not null, preferences_revision timestamptz not null,
 state text not null default 'pending' check(state in ('pending','reserved','uncertain','sent','expired','failed','cancelled')),
 claim_id uuid, claimed_at timestamptz, finished_at timestamptz, created_at timestamptz not null default clock_timestamp(),
 unique(user_id,fingerprint,event_id)
);
create index push_weather_jobs_pending on public.push_weather_jobs(created_at) where state='pending';
create index push_weather_jobs_frequency on public.push_weather_jobs(user_id,fingerprint,claimed_at);
alter table public.push_weather_cities enable row level security;
alter table public.push_weather_cities force row level security;
alter table public.push_weather_events enable row level security;
alter table public.push_weather_events force row level security;
alter table public.push_weather_jobs enable row level security;
alter table public.push_weather_jobs force row level security;
revoke all on public.push_weather_cities,public.push_weather_events,public.push_weather_jobs from public,anon,authenticated,service_role;

create function public.push_weather_eligible(uid uuid,category text) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.push_preferences p join auth.users u on u.id=p.user_id
  join public.subscriptions s on s.user_id=p.user_id
  where p.user_id=uid and p.enabled and category=any(p.categories)
   and (u.banned_until is null or u.banned_until<=clock_timestamp()) and (to_jsonb(u)->>'deleted_at') is null
   and s.status='active' and s.plan in ('free','pro')
   and (category in ('rain','storm','wind','cold','heat') or s.plan='pro'))
$$;
revoke all on function public.push_weather_eligible(uuid,text) from public,anon,authenticated,service_role;

create function public.begin_weather_push(key_public text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run uuid:=gen_random_uuid(); targets jsonb;
begin
 perform 1 from public.push_controls where singleton and delivery_enabled and vapid_public_key=key_public
  and next_cycle_at<=clock_timestamp() and next_provider_at<=clock_timestamp()
  and (lease_until is null or lease_until<=clock_timestamp()) for update;
 if not found then return null;end if;
 update public.push_controls set run_id=run,lease_until=clock_timestamp()+interval '120 seconds',next_cycle_at=clock_timestamp()+interval '15 minutes' where singleton;
 -- Actual warning retention only; never heartbeat/keepalive queries.
 delete from public.push_weather_events where ends_at<clock_timestamp()-interval '14 days';
 delete from public.push_weather_cities c where updated_at<clock_timestamp()-interval '14 days' and not exists(select 1 from public.push_weather_events e where e.city_key=c.key);
 -- Recovery never replays a reserved or uncertain attempt.
 update public.push_weather_jobs set state='cancelled',finished_at=clock_timestamp() where state='reserved' and claimed_at<clock_timestamp()-interval '2 minutes';
 insert into public.push_weather_cities(key,city)
  select distinct on (public.push_city_key(city)) public.push_city_key(city),city
  from public.push_preferences p cross join lateral jsonb_array_elements(p.cities) city
  where p.enabled and exists(select 1 from public.push_devices d where d.user_id=p.user_id and d.vapid_public_key=key_public and (d.subscription_expires_at is null or d.subscription_expires_at>clock_timestamp()))
   and exists(select 1 from unnest(p.categories) category where public.push_weather_eligible(p.user_id,category))
  order by public.push_city_key(city),p.user_id
  on conflict(key) do update set updated_at=clock_timestamp();
 select coalesce(jsonb_agg(jsonb_build_object('key',c.key,'city',c.city)),'[]'::jsonb) into targets from (
  select c.* from public.push_weather_cities c where c.next_check_at<=clock_timestamp()
   and exists(select 1 from public.push_preferences p cross join lateral jsonb_array_elements(p.cities) city
    where p.enabled and public.push_city_key(city)=c.key
     and exists(select 1 from unnest(p.categories) category where public.push_weather_eligible(p.user_id,category))
     and exists(select 1 from public.push_devices d where d.user_id=p.user_id and d.vapid_public_key=key_public and (d.subscription_expires_at is null or d.subscription_expires_at>clock_timestamp())))
  order by c.next_check_at,c.key limit 5 for update
 ) c;
 -- Five cities per quarter-hour = each admitted city hourly, at most 480 calls/day.
 update public.push_weather_cities set next_check_at=clock_timestamp()+interval '1 hour' where key in (select t->>'key' from jsonb_array_elements(targets) t);
 return jsonb_build_object('runId',run,'cities',targets);
end $$;

create function public.stage_weather_push(run uuid,city_id text,events jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.push_weather_cities; item jsonb; eid uuid; a timestamptz; b timestamptz; category text; n integer:=0;
begin
 perform 1 from public.push_controls where singleton and delivery_enabled and run_id=run and lease_until>clock_timestamp() for update;
 if not found then return 0;end if;
 select * into c from public.push_weather_cities where key=city_id for update;
 if not found or jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>100 then raise invalid_parameter_value;end if;
 for item in select value from jsonb_array_elements(events) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>3
   or not item ?& array['kind','start','end'] or jsonb_typeof(item->'start')<>'number' or jsonb_typeof(item->'end')<>'number' then raise invalid_parameter_value;end if;
  category:=item->>'kind';a:=to_timestamp((item->>'start')::double precision/1000);b:=to_timestamp((item->>'end')::double precision/1000);
  if category not in ('rain','storm','wind','cold','heat','walk','garden','sport') or a<clock_timestamp()-interval '1 hour' or a>clock_timestamp()+interval '24 hours'
   or b<=a or b<=clock_timestamp() or b>a+interval '24 hours' then raise invalid_parameter_value;end if;
  -- Same city/category overlapping period keeps the same identity across rolling forecasts.
  -- Personal recommendations retain their existing once-per-local-day identity.
  select id into eid from public.push_weather_events e where e.city_key=city_id and e.kind=category and (
   (category in ('rain','storm','wind','cold','heat') and e.starts_at<b and e.ends_at>a)
   or (category in ('walk','garden','sport') and (e.starts_at at time zone (c.city->>'zone'))::date=(a at time zone (c.city->>'zone'))::date))
   order by starts_at,id limit 1 for update;
  if eid is null then
   insert into public.push_weather_events(city_key,kind,starts_at,ends_at) values(city_id,category,a,b) returning id into eid;
  else update public.push_weather_events set refreshed_at=clock_timestamp(),starts_at=least(starts_at,a),ends_at=greatest(ends_at,b) where id=eid;end if;
  insert into public.push_weather_jobs(event_id,user_id,device_id,fingerprint,device_revision,preferences_revision)
   select eid,d.user_id,d.id,d.fingerprint,d.updated_at,p.updated_at from public.push_devices d join public.push_preferences p on p.user_id=d.user_id
   join public.push_controls control on control.singleton
   where d.vapid_public_key=control.vapid_public_key and (d.subscription_expires_at is null or d.subscription_expires_at>clock_timestamp())
    and public.push_weather_eligible(d.user_id,category)
    and exists(select 1 from jsonb_array_elements(p.cities) city where public.push_city_key(city)=city_id)
   on conflict(user_id,fingerprint,event_id) do nothing;
  n:=n+1;
 end loop;
 -- A valid new forecast that removes a hazard cancels any still-pending obsolete warning.
 update public.push_weather_jobs j set state='cancelled',finished_at=clock_timestamp() from public.push_weather_events e
  where j.event_id=e.id and j.state='pending' and e.city_key=city_id and e.refreshed_at<transaction_timestamp();
 return n;
end $$;

create function public.weather_push_job_allowed(job uuid,key_public text) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.push_weather_jobs j join public.push_weather_events e on e.id=j.event_id
  join public.push_devices d on d.id=j.device_id and d.user_id=j.user_id and d.fingerprint=j.fingerprint
  join public.push_preferences p on p.user_id=j.user_id join public.push_controls c on c.singleton
  where j.id=job and c.delivery_enabled and c.vapid_public_key=key_public and d.vapid_public_key=key_public
   and c.next_provider_at<=clock_timestamp() and c.lease_until>clock_timestamp()
   and d.updated_at=j.device_revision and p.updated_at=j.preferences_revision
   and (d.subscription_expires_at is null or d.subscription_expires_at>clock_timestamp())
   and e.ends_at>clock_timestamp() and e.refreshed_at>clock_timestamp()-interval '75 minutes'
   and public.push_weather_eligible(j.user_id,e.kind)
   and exists(select 1 from jsonb_array_elements(p.cities) city where public.push_city_key(city)=e.city_key))
$$;
revoke all on function public.weather_push_job_allowed(uuid,text) from public,anon,authenticated,service_role;

create function public.claim_weather_push(run uuid,key_public text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.push_weather_jobs; claim uuid:=gen_random_uuid(); result jsonb;
begin
 perform 1 from public.push_controls where singleton and delivery_enabled and run_id=run and lease_until>clock_timestamp() and next_provider_at<=clock_timestamp() for update;
 if not found then return null;end if;
 -- Invalid pending jobs are terminal, including stopped accounts and stale preferences.
 update public.push_weather_jobs set state='cancelled',finished_at=clock_timestamp() where state='pending' and not public.weather_push_job_allowed(id,key_public);
 select q.* into j from public.push_weather_jobs q join public.push_weather_events e on e.id=q.event_id
  where q.state='pending' and public.weather_push_job_allowed(q.id,key_public)
   and (select count(*) from public.push_weather_jobs recent where recent.user_id=q.user_id and recent.fingerprint=q.fingerprint and recent.claimed_at>clock_timestamp()-interval '24 hours')<6
  order by e.starts_at,q.created_at,q.id limit 1 for update of q;
 if not found then return null;end if;
 update public.push_weather_jobs set state='reserved',claim_id=claim,claimed_at=clock_timestamp() where id=j.id;
 select jsonb_build_object('id',j.id,'claimId',claim,'endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth_key,'publicKey',d.vapid_public_key,
  'language',p.language,'kind',e.kind,'start',extract(epoch from e.starts_at)*1000,'end',extract(epoch from e.ends_at)*1000,
  'city',(select city from jsonb_array_elements(p.cities) city where public.push_city_key(city)=e.city_key limit 1)) into result
  from public.push_devices d join public.push_preferences p on p.user_id=d.user_id join public.push_weather_events e on e.id=j.event_id where d.id=j.device_id;
 return result;
end $$;

create function public.authorize_weather_push(run uuid,job uuid,claim uuid,key_public text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.push_controls where singleton and run_id=run for update;
 if not found or not public.weather_push_job_allowed(job,key_public) then return false;end if;
 update public.push_weather_jobs set state='uncertain' where id=job and state='reserved' and claim_id=claim and claimed_at>clock_timestamp()-interval '30 seconds';
 return found; -- Burn before POST. Crashes and lost responses never replay the attempt.
end $$;

create function public.finish_weather_push(job uuid,claim uuid,outcome text,retry_seconds integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare j public.push_weather_jobs;
begin
 if outcome is null or outcome not in ('sent','expired','invalid','failed','throttled') then raise invalid_parameter_value;end if;
 perform 1 from public.push_controls where singleton for update;
 select * into j from public.push_weather_jobs where id=job for update;
 if not found or j.claim_id is distinct from claim then raise insufficient_privilege;end if;
 update public.push_weather_jobs set state=case when outcome='sent' then 'sent' when outcome in ('expired','invalid') then 'expired' else 'failed' end,finished_at=clock_timestamp()
  where id=job and state=case when outcome='invalid' then 'reserved' else 'uncertain' end;
 if not found then return;end if;
 if outcome='throttled' then
  if retry_seconds is null or retry_seconds>31536000 then update public.push_controls set delivery_enabled=false where singleton;
  else update public.push_controls set next_provider_at=greatest(next_provider_at,clock_timestamp()+make_interval(secs=>greatest(60,retry_seconds))) where singleton;end if;
 end if;
 if outcome in ('expired','invalid') then
  delete from public.push_devices where id=j.device_id and user_id=j.user_id and updated_at=j.device_revision;
 end if;
end $$;

create function public.end_weather_push(run uuid) returns void
language sql security definer set search_path='' as $$
 update public.push_controls set lease_until=null,run_id=null where singleton and run_id=run
$$;
revoke all on function public.begin_weather_push(text),public.stage_weather_push(uuid,text,jsonb),public.claim_weather_push(uuid,text),public.authorize_weather_push(uuid,uuid,uuid,text),public.finish_weather_push(uuid,uuid,text,integer),public.end_weather_push(uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_weather_push(text),public.stage_weather_push(uuid,text,jsonb),public.claim_weather_push(uuid,text),public.authorize_weather_push(uuid,uuid,uuid,text),public.finish_weather_push(uuid,uuid,text,integer),public.end_weather_push(uuid) to service_role;
commit;
