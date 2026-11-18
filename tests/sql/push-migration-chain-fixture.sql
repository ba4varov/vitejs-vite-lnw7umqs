-- ONLY a disposable PostgreSQL 17 CI database. No production credentials.
-- Mirrors critical columns, roles, checks and constraints discovered via
-- READ-ONLY production metadata on 2026-11-18.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  banned_until timestamptz,
  deleted_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.push_controls(
  singleton boolean primary key default true check(singleton),
  registration_enabled boolean not null default false,
  test_delivery_enabled boolean not null default false,
  vapid_public_key text check(vapid_public_key ~ '^[A-Za-z0-9_-]{87}$')
);
create table public.push_preferences(
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  cities jsonb not null default '[]'::jsonb
    check(jsonb_typeof(cities)='array' and jsonb_array_length(cities)<=5),
  categories text[] not null default '{}'::text[]
    check(categories <@ array['rain','storm','wind','cold','heat','walk','garden','sport']::text[])
);
create table public.push_devices(
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vapid_public_key text,
  subscription_expires_at timestamptz
);
create table public.push_deliveries(
  device_id uuid not null references public.push_devices(id) on delete cascade,
  event_key text not null check(length(event_key)<=300),
  state text not null check(state in ('reserved','sent','expired','failed','uncertain')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  primary key(device_id,event_key)
);
alter table public.push_deliveries enable row level security;
alter table public.push_deliveries force row level security;
insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.push_controls(singleton,vapid_public_key)
 values(true,repeat('A',87));
insert into public.push_preferences(user_id,enabled,cities,categories) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,
 '[{"name":"Varna","latitude":43.2141,"longitude":27.9147,"zone":"Europe/Sofia"}]'::jsonb,
 array['rain','wind','storm','cold','heat']),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false,
 '[{"name":"Sofia","latitude":42.6977,"longitude":23.3219,"zone":"Europe/Sofia"}]'::jsonb,
 array['wind']);
insert into public.push_devices(id,user_id,vapid_public_key) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('A',87)),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('A',87));
