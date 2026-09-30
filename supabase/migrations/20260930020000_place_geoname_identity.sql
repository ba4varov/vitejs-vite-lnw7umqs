-- GeoNames id returned by Open-Meteo. Existing rows remain valid and are
-- resolved conservatively by name, coordinates and available metadata.
alter table public.favorite_places add column if not exists geoname_id bigint;
create index if not exists favorite_places_geoname_id_idx
  on public.favorite_places (user_id, geoname_id) where geoname_id is not null;
grant update (geoname_id) on public.favorite_places to authenticated;
