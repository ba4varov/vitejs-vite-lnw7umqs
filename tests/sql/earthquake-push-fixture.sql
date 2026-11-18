-- Isolated PostgreSQL fixture; NOT connected to any Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.push_preferences(
  user_id uuid primary key references auth.users(id),
  cities jsonb not null default '[]'::jsonb
);
create table public.push_devices(
  id uuid primary key,user_id uuid references auth.users(id)
);
insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.push_preferences(user_id,cities) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '[{"name":"Варна","latitude":43.2141,"longitude":27.9147,"zone":"Europe/Sofia"},{"name":"София","latitude":42.6977,"longitude":23.3219,"zone":"Europe/Sofia"}]'::jsonb),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '[{"name":"Русе","latitude":43.848,"longitude":25.956,"zone":"Europe/Sofia"}]'::jsonb);
insert into public.push_devices(id,user_id) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
