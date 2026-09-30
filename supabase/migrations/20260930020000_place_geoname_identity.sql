-- GeoNames id returned by Open-Meteo. Existing rows remain valid and are
-- resolved conservatively by name, coordinates and available metadata.
alter table public.favorite_places add column if not exists geoname_id bigint;
alter table public.favorite_places add column if not exists country_code text check (country_code is null or char_length(country_code) = 2);
alter table public.favorite_places add column if not exists admin1_id bigint;
create index if not exists favorite_places_geoname_id_idx
  on public.favorite_places (user_id, geoname_id) where geoname_id is not null;
grant update (geoname_id, country_code, admin1_id) on public.favorite_places to authenticated;
