-- Unified safety Push stage B2a. NEVER ENABLES A DISPATCHER OR A PROVIDER.
-- Isolated service-role-only reservation and one-time burn for weather + quakes.
-- Manual migration review; DO NOT apply to Production without approval.
begin;

create table public.push_safety_controls (
 singleton boolean primary key default true check (singleton),
 delivery_enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.push_safety_controls(singleton) values(true);
alter table public.push_safety_controls enable row level security;
alter table public.push_safety_controls force row level security;
revoke all on public.push_safety_controls from public,anon,authenticated,service_role;

alter table public.push_deliveries
 add column safety_attempt_id uuid unique,
 add column safety_payload jsonb;
alter table public.push_deliveries add constraint safety_payload_bounded
 check (safety_payload is null or
   (jsonb_typeof(safety_payload)='object' and
    octet_length(safety_payload::text)<=1600));

-- Internal predicate: rechecked under locks before each irreversible attempt.
-- No arbitrary device ID, client location or event information can bypass
-- the registered account's current consent/selected city.
create function public.safety_candidate_eligible(target_device uuid,candidate jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare
 d public.push_devices;
 raw_channel text;
 k text;
 c jsonb;
 p public.push_preferences;
 e public.earthquake_push_optins;
 moment numeric;
 lat numeric;
 lon numeric;
 mag numeric;
 km double precision;
begin
 if candidate is null or jsonb_typeof(candidate) is distinct from 'object'
    or octet_length(candidate::text)>1600 then return false;end if;
 raw_channel:=candidate->>'channel';
 k:=candidate->>'eventKey';
 c:=candidate->'city';
 if raw_channel not in ('weather','earthquake') or k is null
    or length(k)>300 or jsonb_typeof(c) is distinct from 'object'
    or jsonb_typeof(c->'name') is distinct from 'string'
    or jsonb_typeof(c->'latitude') is distinct from 'number'
    or jsonb_typeof(c->'longitude') is distinct from 'number'
    or jsonb_typeof(c->'zone') is distinct from 'string'
 then return false;end if;

 select * into d from public.push_devices
  where id=target_device for share;
 if not found or d.vapid_public_key is null
    or (d.subscription_expires_at is not null
        and d.subscription_expires_at<=clock_timestamp())
    or not exists (
      select 1 from auth.users u where u.id=d.user_id
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and (to_jsonb(u)->>'deleted_at') is null
    )
    or not exists (
      select 1 from public.push_controls ctrl where ctrl.singleton
       and ctrl.vapid_public_key=d.vapid_public_key
    )
 then return false;end if;

 if raw_channel='weather' then
   if (select array_agg(z order by z) from jsonb_object_keys(candidate) z)
        is distinct from array['channel','city','eventKey','kind','startsAt']::text[]
      or jsonb_typeof(candidate->'startsAt') is distinct from 'number'
      or candidate->>'kind' not in ('rain','storm','wind','cold','heat')
      or k !~ '^weather:open-meteo:[a-f0-9]{32}:(rain|storm|wind|cold|heat):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or split_part(k,':',4) <> candidate->>'kind'
   then return false;end if;
   moment:=(candidate->>'startsAt')::numeric;
   if moment < extract(epoch from clock_timestamp())*1000-3600000
      or moment>extract(epoch from clock_timestamp())*1000+86400000
   then return false;end if;
   select * into p from public.push_preferences
     where user_id=d.user_id for share;
   return found and p.enabled
      and (candidate->>'kind')=any(p.categories)
      and p.cities @> jsonb_build_array(c);
 else
   if (select array_agg(z order by z) from jsonb_object_keys(candidate) z)
       is distinct from array['channel','city','eventKey','latitude','longitude','magnitude','occurredAt']::text[]
      or jsonb_typeof(candidate->'occurredAt') is distinct from 'number'
      or jsonb_typeof(candidate->'latitude') is distinct from 'number'
      or jsonb_typeof(candidate->'longitude') is distinct from 'number'
      or jsonb_typeof(candidate->'magnitude') is distinct from 'number'
      or k !~ '^earthquake:usgs:[A-Za-z0-9_-]{2,90}$'
   then return false;end if;
   moment:=(candidate->>'occurredAt')::numeric;
   lat:=(candidate->>'latitude')::numeric;
   lon:=(candidate->>'longitude')::numeric;
   mag:=(candidate->>'magnitude')::numeric;
   if mag<3 or mag>10 or lat not between -90 and 90
     or lon not between -180 and 180
     or moment>extract(epoch from clock_timestamp())*1000
     or moment<extract(epoch from clock_timestamp())*1000-2700000
   then return false;end if;
   select * into e from public.earthquake_push_optins
      where user_id=d.user_id for share;
   if not found or e.city is distinct from c
      or to_timestamp((moment/1000)::double precision)<e.opted_in_at
   then return false;end if;
   km:=6371.0088*2*asin(sqrt(least(1,greatest(0,
       power(sin(radians((lat-(c->>'latitude')::numeric)/2)),2)
       + cos(radians((c->>'latitude')::numeric))*cos(radians(lat))
       *power(sin(radians((lon-(c->>'longitude')::numeric)/2)),2)
   ))));
   return km<=300;
 end if;
exception when numeric_value_out_of_range or invalid_text_representation
   or division_by_zero then return false;
end $$;
revoke all on function public.safety_candidate_eligible(uuid,jsonb)
 from public,anon,authenticated,service_role;

-- A single transaction holds the gate/owner/consent records and reserves the
-- durable (device_id,event_key) primary key exactly once across all workers.
create function public.reserve_safety_push(target_device uuid,candidate jsonb)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare attempt uuid:=gen_random_uuid();
 key_value text;
 created uuid;
begin
 perform 1 from public.push_safety_controls
   where singleton and delivery_enabled for share;
 if not found then return null;end if;
 if not public.safety_candidate_eligible(target_device,candidate)
   then return null;end if;
 if (select count(*) from public.push_deliveries
     where device_id=target_device
       and event_key like 'weather:open-meteo:%'
         or device_id=target_device and event_key like 'earthquake:usgs:%'
         and created_at>=clock_timestamp()-interval '24 hours')>30
   then return null;end if;
 key_value:=candidate->>'eventKey';
 insert into public.push_deliveries(
   device_id,event_key,state,expires_at,safety_attempt_id,safety_payload
 ) values (
   target_device,key_value,'reserved',clock_timestamp()+interval '5 minutes',
   attempt,candidate
 ) on conflict do nothing returning safety_attempt_id into created;
 return created;
end $$;
revoke all on function public.reserve_safety_push(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.reserve_safety_push(uuid,jsonb) to service_role;

-- THE BURN MUST COMMIT BEFORE HTTPS POST. Even provider timeout leaves the
-- record 'uncertain'; never retry an indeterminate attempt.
create function public.burn_safety_push(attempt uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare p public.push_deliveries;
begin
 perform 1 from public.push_safety_controls
   where singleton and delivery_enabled for share;
 if not found then return false;end if;
 select * into p from public.push_deliveries
   where safety_attempt_id=attempt for update;
 if not found or p.state<>'reserved' or p.safety_payload is null
    or p.expires_at<=clock_timestamp()
    or p.created_at<clock_timestamp()-interval '30 seconds'
 then return false;end if;
 if not public.safety_candidate_eligible(p.device_id,p.safety_payload)
 then
   update public.push_deliveries set state='expired'
     where safety_attempt_id=attempt;
   return false;
 end if;
 update public.push_deliveries set state='uncertain'
   where safety_attempt_id=attempt and state='reserved';
 return found;
end $$;
revoke all on function public.burn_safety_push(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.burn_safety_push(uuid) to service_role;

commit;
