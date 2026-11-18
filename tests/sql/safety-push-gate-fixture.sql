-- Disposable PostgreSQL-only fixture. Never run against a real project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(
 id uuid primary key,
 banned_until timestamptz,
 deleted_at timestamptz
);
create table public.push_controls(
 singleton boolean primary key,
 vapid_public_key text
);
create table public.push_preferences(
 user_id uuid primary key references auth.users(id),
 enabled boolean not null,
 cities jsonb not null,
 categories text[] not null
);
create table public.push_devices(
 id uuid primary key,
 user_id uuid not null references auth.users(id),
 vapid_public_key text,
 subscription_expires_at timestamptz
);
create table public.earthquake_push_optins(
 user_id uuid primary key references auth.users(id),
 city jsonb not null,
 opted_in_at timestamptz not null
);
create table public.push_deliveries(
 device_id uuid not null references public.push_devices(id),
 event_key text not null,
 state text not null check(state in ('reserved','sent','expired','failed','uncertain')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 primary key(device_id,event_key)
);
insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.push_controls values(true,'synthetic-vapid-key');
insert into public.push_preferences values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,
  '[{"name":"Varna","latitude":43.2141,"longitude":27.9147,"zone":"Europe/Sofia"}]'::jsonb,
  array['rain','storm','wind','cold','heat']::text[]),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false,
  '[{"name":"Sofia","latitude":42.6977,"longitude":23.3219,"zone":"Europe/Sofia"}]'::jsonb,
  array['wind']::text[]);
insert into public.push_devices values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic-vapid-key',null),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic-vapid-key',null);
insert into public.earthquake_push_optins values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '[{"name":"Varna"}]'::jsonb,clock_timestamp()-interval '1 hour');
-- Replace dummy opt-in city with the exact saved city from weather preferences.
update public.earthquake_push_optins set city=(
 select cities->0 from public.push_preferences
 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
