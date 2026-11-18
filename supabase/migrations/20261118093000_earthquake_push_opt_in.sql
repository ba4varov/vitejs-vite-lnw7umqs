-- Earthquake Push Stage B1: explicit per-account consent for exactly one saved
-- city. No dispatcher, no Cron, no provider access and no changes to push-check.
-- MANUAL REVIEW BEFORE APPLYING. This migration does not enable delivery.
begin;

create table public.earthquake_push_optins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  city jsonb not null,
  opted_in_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint earthquake_optin_city_shape check (
    jsonb_typeof(city) = 'object'
    and jsonb_typeof(city->'name') = 'string'
    and jsonb_typeof(city->'latitude') = 'number'
    and (city->>'latitude')::numeric between -90 and 90
    and jsonb_typeof(city->'longitude') = 'number'
    and (city->>'longitude')::numeric between -180 and 180
    and jsonb_typeof(city->'zone') = 'string'
  )
);
alter table public.earthquake_push_optins enable row level security;
alter table public.earthquake_push_optins force row level security;
-- No public or authenticated table access; the RPC below is the sole writer.
revoke all on table public.earthquake_push_optins
  from public, anon, authenticated, service_role;
-- Future isolated dispatcher may inspect consent via server-only service role;
-- it CANNOT mutate consent. This does not activate any sending mechanism.
grant select on table public.earthquake_push_optins to service_role;

create function public.my_earthquake_push(
  payload jsonb default '{"operation":"load"}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  op text;
  p public.earthquake_push_optins;
  saved public.push_preferences;
  selected jsonb;
  index_value integer;
  device_total integer;
begin
  if uid is null or not exists (
    select 1 from auth.users where id=uid
      and (banned_until is null or banned_until<=clock_timestamp())
  ) then raise insufficient_privilege; end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or octet_length(payload::text)>512
    or payload->>'operation' is null
  then raise invalid_parameter_value; end if;
  op := payload->>'operation';
  if op not in ('load','set') then raise invalid_parameter_value; end if;

  if op = 'load' then
    if (select count(*) from jsonb_object_keys(payload))<>1
      or not (payload ? 'operation') then raise invalid_parameter_value; end if;
  else
    if jsonb_typeof(payload->'enabled') is distinct from 'boolean'
       or (select count(*) from jsonb_object_keys(payload))
          <> case when (payload->>'enabled')::boolean then 3 else 2 end
       or not (payload ? 'operation') then raise invalid_parameter_value; end if;

    if (payload->>'enabled')::boolean then
      if not (payload ? 'cityIndex')
        or jsonb_typeof(payload->'cityIndex') is distinct from 'number'
        or (payload->'cityIndex')::text !~ '^[0-4]$'
      then raise invalid_parameter_value; end if;
      index_value := (payload->>'cityIndex')::integer;
      -- The chosen city MUST already belong to this authenticated user.
      -- No arbitrary client-supplied GPS coordinates, user_id or event data.
      select * into saved from public.push_preferences
        where user_id=uid for update;
      if not found or jsonb_typeof(saved.cities) <> 'array'
         or index_value >= jsonb_array_length(saved.cities)
      then raise invalid_parameter_value; end if;
      selected := saved.cities -> index_value;
      if jsonb_typeof(selected) <> 'object' then raise invalid_parameter_value; end if;

      insert into public.earthquake_push_optins(user_id,city)
      values(uid,selected)
      on conflict(user_id) do update set
        city=excluded.city,
        opted_in_at=case
          when public.earthquake_push_optins.city=excluded.city
            then public.earthquake_push_optins.opted_in_at
          else clock_timestamp()
        end,
        updated_at=clock_timestamp();
    else
      if payload ? 'cityIndex' then raise invalid_parameter_value; end if;
      -- Explicit opt-out removes the saved consent entirely.
      -- Old device/event ledger entries remain to prevent duplicate sends.
      delete from public.earthquake_push_optins where user_id=uid;
    end if;
  end if;

  select * into p from public.earthquake_push_optins where user_id=uid;
  select count(*) into device_total from public.push_devices where user_id=uid;
  return jsonb_build_object(
    'contractVersion',1,
    'enabled',p.user_id is not null,
    'city',case when p.user_id is null then null else p.city end,
    'optedInAt',case when p.user_id is null then null else p.opted_in_at end,
    'radiusKm',300,
    'minMagnitude',3.0,
    'deviceCount',device_total,
    'deliveryEnabled',false
  );
end $$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default. Remove it
-- before adding a narrow authenticated grant. Every invocation checks auth.uid().
revoke all on function public.my_earthquake_push(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.my_earthquake_push(jsonb) to authenticated;
commit;
