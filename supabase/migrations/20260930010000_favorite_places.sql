-- User-owned saved places. Apply after 20260930000000_auth_profiles.sql.
create table public.favorite_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  region text check (region is null or char_length(region) <= 120),
  country text check (country is null or char_length(country) <= 120),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  latitude_key numeric(7,4) generated always as (round(latitude::numeric, 4)) stored,
  longitude_key numeric(8,4) generated always as (round(longitude::numeric, 4)) stored,
  created_at timestamptz not null default now(),
  unique (user_id, latitude_key, longitude_key),
  unique (user_id, id)
);
create table public.place_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  default_place_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (user_id, default_place_id) references public.favorite_places(user_id, id) on delete set null (default_place_id)
);
alter table public.favorite_places enable row level security;
alter table public.place_settings enable row level security;
alter table public.favorite_places force row level security;
alter table public.place_settings force row level security;
revoke all on public.favorite_places, public.place_settings from public, anon, authenticated;
grant select, insert, delete on public.favorite_places to authenticated;
grant select on public.place_settings to authenticated;
create policy "manage own favorite places" on public.favorite_places for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "read own place settings" on public.place_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "insert own place settings" on public.place_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "update own place settings" on public.place_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.set_my_default_place(place_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if place_id is not null and not exists (
    select 1 from public.favorite_places where user_id = auth.uid() and id = place_id
  ) then raise exception 'favorite place does not belong to current user' using errcode = '42501'; end if;
  insert into public.place_settings(user_id, default_place_id, updated_at)
  values (auth.uid(), place_id, now())
  on conflict (user_id) do update set default_place_id = excluded.default_place_id, updated_at = now();
end; $$;
revoke all on function public.set_my_default_place(uuid) from public, anon, authenticated;
grant insert, update (default_place_id, updated_at) on public.place_settings to authenticated;
grant execute on function public.set_my_default_place(uuid) to authenticated;
