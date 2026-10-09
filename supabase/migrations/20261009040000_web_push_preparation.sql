-- Stage 6G-A. MANUAL REVIEW ONLY; no schedule, delivery or existing-user opt-in.
begin;
create table public.push_controls (
 singleton boolean primary key default true check(singleton),
 registration_enabled boolean not null default false
);
insert into public.push_controls(singleton) values(true);
create table public.push_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 cities jsonb not null default '[]' check(jsonb_typeof(cities)='array' and jsonb_array_length(cities)<=5),
 categories text[] not null default '{}' check(categories <@ array['rain','storm','wind','cold','heat','walk','garden','sport']::text[]),
 tokens numeric not null default 20 check(tokens between 0 and 20),
 refilled_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.push_devices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null check(length(endpoint)<=2048),
 fingerprint text not null unique check(fingerprint=encode(sha256(convert_to(endpoint,'UTF8')),'hex')),
 p256dh text not null, auth_key text not null,
 label text not null check(length(label) between 1 and 80),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index push_devices_user on public.push_devices(user_id);
-- Reserved delivery ledger: no producer/dispatcher exists in this stage.
create table public.push_deliveries (
 device_id uuid not null references public.push_devices(id) on delete cascade,
 event_key text not null check(length(event_key)<=300),
 state text not null check(state in ('reserved','sent','expired','failed','uncertain')),
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 primary key(device_id,event_key)
);
alter table public.push_controls enable row level security;
alter table public.push_controls force row level security;
alter table public.push_preferences enable row level security;
alter table public.push_preferences force row level security;
alter table public.push_devices enable row level security;
alter table public.push_devices force row level security;
alter table public.push_deliveries enable row level security;
alter table public.push_deliveries force row level security;
create policy own_push_preferences on public.push_preferences to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_push_devices on public.push_devices to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
-- Direct table access, including service_role, is denied. Only the bounded RPC.
revoke all on public.push_controls,public.push_preferences,public.push_devices,public.push_deliveries from public,anon,authenticated,service_role;

create function public.my_push(payload jsonb default '{"operation":"load"}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); op text:=payload->>'operation'; pro boolean; p public.push_preferences;
 s jsonb; c jsonb; kinds text[]; endpoint_value text; fp text; city_ids text[]:='{}'; city_id text; t numeric;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and (banned_until is null or banned_until<=now())) then raise insufficient_privilege;end if;
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>12000 or op is null or op not in ('load','register','settings','delete') then raise invalid_parameter_value;end if;
 if exists(select 1 from jsonb_object_keys(payload) k where k not in ('operation','subscription','label','enabled','cities','categories','id')) then raise invalid_parameter_value;end if;
 insert into public.push_preferences(user_id) values(uid) on conflict do nothing;
 select * into p from public.push_preferences where user_id=uid for update;
 select exists(select 1 from public.get_my_entitlements() e where e.plan='pro' and 'planner:advanced'=any(e.permissions)) into pro;
 if op<>'load' then
  t:=least(20,p.tokens+greatest(0,extract(epoch from clock_timestamp()-p.refilled_at))/3);
  if t<1 then raise exception 'PUSH_RATE_LIMITED';end if;
  update public.push_preferences set tokens=t-1,refilled_at=clock_timestamp() where user_id=uid;
 end if;
 if op='settings' then
  if jsonb_typeof(payload->'enabled') is distinct from 'boolean' or jsonb_typeof(payload->'cities') is distinct from 'array' or jsonb_array_length(payload->'cities')>5 or jsonb_typeof(payload->'categories') is distinct from 'array' or jsonb_array_length(payload->'categories')>8 then raise invalid_parameter_value;end if;
  if exists(select 1 from jsonb_array_elements(payload->'categories') k where jsonb_typeof(k)<>'string') then raise invalid_parameter_value;end if;
  select coalesce(array_agg(value),'{}') into kinds from jsonb_array_elements_text(payload->'categories');
  if not kinds <@ array['rain','storm','wind','cold','heat','walk','garden','sport']::text[] or cardinality(kinds)<>(select count(distinct k) from unnest(kinds) k) then raise invalid_parameter_value;end if;
  if not pro and kinds && array['walk','garden','sport']::text[] then raise insufficient_privilege;end if;
  for c in select value from jsonb_array_elements(payload->'cities') loop
   if jsonb_typeof(c) is distinct from 'object' or exists(select 1 from jsonb_object_keys(c) k where k not in ('name','latitude','longitude','zone')) or jsonb_typeof(c->'name') is distinct from 'string' or length(trim(c->>'name')) not between 1 and 100 or jsonb_typeof(c->'latitude') is distinct from 'number' or jsonb_typeof(c->'longitude') is distinct from 'number' or (c->>'latitude')::numeric not between -90 and 90 or (c->>'longitude')::numeric not between -180 and 180 or jsonb_typeof(c->'zone') is distinct from 'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=c->>'zone') then raise invalid_parameter_value;end if;
   city_id:=(c->>'latitude')::numeric::text||':'||(c->>'longitude')::numeric::text;
   if city_id=any(city_ids) then raise invalid_parameter_value;end if;city_ids:=array_append(city_ids,city_id);
  end loop;
  if (payload->>'enabled')::boolean and (cardinality(kinds)=0 or jsonb_array_length(payload->'cities')=0) then raise invalid_parameter_value;end if;
  update public.push_preferences set enabled=(payload->>'enabled')::boolean,cities=payload->'cities',categories=kinds,updated_at=now() where user_id=uid;
 elsif op='register' then
  if not exists(select 1 from public.push_controls where singleton and registration_enabled) then raise exception 'PUSH_REGISTRATION_DISABLED';end if;
  if not p.enabled or cardinality(p.categories)=0 or jsonb_array_length(p.cities)=0 then raise invalid_parameter_value;end if;
  if not pro and p.categories && array['walk','garden','sport']::text[] then raise insufficient_privilege;end if;
  s:=payload->'subscription'; endpoint_value:=s->>'endpoint';
  if jsonb_typeof(s) is distinct from 'object' or exists(select 1 from jsonb_object_keys(s) k where k not in ('endpoint','keys','expirationTime')) or jsonb_typeof(s->'endpoint') is distinct from 'string' or length(endpoint_value)>2048 then raise invalid_parameter_value;end if;
  -- No userinfo, custom port, fragments, encoded hosts, suffix tricks or IP URLs.
  if not (endpoint_value ~ '^https://fcm\.googleapis\.com/(fcm/send|wp)/[A-Za-z0-9_:-]+$' or endpoint_value ~ '^https://web\.push\.apple\.com/[A-Za-z0-9_-]+$' or endpoint_value ~ '^https://[a-z0-9-]+\.notify\.windows\.com/w/\?token=[A-Za-z0-9_%.-]+$' or endpoint_value ~ '^https://updates\.push\.services\.mozilla\.com/wpush/v2/[A-Za-z0-9_-]+$') then raise invalid_parameter_value;end if;
  if jsonb_typeof(s->'keys') is distinct from 'object' or exists(select 1 from jsonb_object_keys(s->'keys') k where k not in ('p256dh','auth')) or jsonb_typeof(s->'keys'->'p256dh') is distinct from 'string' or jsonb_typeof(s->'keys'->'auth') is distinct from 'string' or (s->'keys'->>'p256dh') !~ '^[A-Za-z0-9_-]{87}$' or (s->'keys'->>'auth') !~ '^[A-Za-z0-9_-]{22}$' then raise invalid_parameter_value;end if;
  if get_byte(decode(translate(s->'keys'->>'p256dh','-_','+/')||'=','base64'),0)<>4 then raise invalid_parameter_value;end if;
  if jsonb_typeof(payload->'label') is distinct from 'string' or length(trim(payload->>'label')) not between 1 and 80 then raise invalid_parameter_value;end if;
  fp:=encode(sha256(convert_to(endpoint_value,'UTF8')),'hex');
  -- Global fingerprint lock prevents cross-account registration races.
  perform pg_advisory_xact_lock(hashtextextended(fp,6));
  if exists(select 1 from public.push_devices where fingerprint=fp and user_id<>uid) then raise insufficient_privilege;end if;
  if (select count(*) from public.push_devices where user_id=uid)>=10 and not exists(select 1 from public.push_devices where fingerprint=fp and user_id=uid) then raise exception 'DEVICE_LIMIT';end if;
  insert into public.push_devices(user_id,endpoint,fingerprint,p256dh,auth_key,label) values(uid,endpoint_value,fp,s->'keys'->>'p256dh',s->'keys'->>'auth',trim(payload->>'label'))
   on conflict(fingerprint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,label=excluded.label,updated_at=now() where push_devices.user_id=uid;
 elsif op='delete' then
  if jsonb_typeof(payload->'id') is distinct from 'string' then raise invalid_parameter_value;end if;
  delete from public.push_devices where id=(payload->>'id')::uuid and user_id=uid;
 end if;
 select * into p from public.push_preferences where user_id=uid;
 return jsonb_build_object('contractVersion',1,'pro',pro,'preferences',jsonb_build_object('enabled',p.enabled,'cities',p.cities,'categories',p.categories),
  'devices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'fingerprint',fingerprint,'createdAt',created_at) order by created_at) from public.push_devices where user_id=uid),'[]'::jsonb));
end $$;
revoke all on function public.my_push(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.my_push(jsonb) to authenticated;
commit;
