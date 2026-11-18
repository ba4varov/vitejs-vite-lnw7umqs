-- This runs ONLY in disposable CI PostgreSQL after BOTH merged migrations.
do $$
begin
 if to_regclass('public.earthquake_push_optins') is null
    or to_regclass('public.push_safety_controls') is null
 then raise exception 'B1 or B2a table is missing';end if;
 if (select delivery_enabled from public.push_safety_controls where singleton)
 then raise exception 'Gate must remain OFF by default';end if;
 if (select count(*) from public.push_deliveries) <> 0
 then raise exception 'Fresh migrations must not send or reserve';end if;
 if (select relrowsecurity and relforcerowsecurity from pg_class
       where oid='public.earthquake_push_optins'::regclass) is not true
    or (select relrowsecurity and relforcerowsecurity from pg_class
       where oid='public.push_safety_controls'::regclass) is not true
 then raise exception 'RLS and FORCE RLS are mandatory';end if;
end $$;

-- Authenticated account A can opt in to precisely its own saved city.
set role authenticated;
select set_config('request.jwt.claim.sub',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare v jsonb;
begin
 v:=public.my_earthquake_push('{"operation":"load"}'::jsonb);
 if v->>'enabled' is distinct from 'false' or v->>'deliveryEnabled' is distinct from 'false'
 then raise exception 'Unexpected initial consent or delivery state';end if;
 v:=public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":0}'::jsonb);
 if v->>'enabled' is distinct from 'true'
   or v->'city'->>'name' is distinct from 'Varna'
   or v->>'radiusKm' is distinct from '300'
 then raise exception 'B1 opt-in not available after B2 migration';end if;
end $$;
reset role;

-- Owner B cannot subscribe to A's city.
set role authenticated;
select set_config('request.jwt.claim.sub',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $$
declare v jsonb;
begin
 v:=public.my_earthquake_push('{"operation":"load"}'::jsonb);
 if v->>'enabled' is distinct from 'false'
 then raise exception 'Cross-account consent data leaked';end if;
 begin
   perform public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":1}'::jsonb);
   raise exception 'Unexpected access to another account city';
 exception when invalid_parameter_value then null;
 end;
end $$;
reset role;

-- Even service_role cannot flip gate directly. This is an operator-only action.
set role service_role;
do $$
begin
 begin
   update public.push_safety_controls set delivery_enabled=true;
   raise exception 'service_role unexpectedly allowed to turn on gate';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

-- ONLY inside an ephemeral CI database, temporarily turn gate on to test
-- reserve/burn, but DO NOT invoke a provider or make any HTTP request.
update public.push_safety_controls
 set delivery_enabled=true where singleton;

set role service_role;
do $$
declare
 c jsonb;
 k text;
 claim uuid;
 quake jsonb;
 qclaim uuid;
begin
 c:=(select cities->0 from public.push_preferences
       where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 k:='weather:open-meteo:'||repeat('0',32)||':wind:'
   ||to_char(clock_timestamp() at time zone 'Europe/Sofia','YYYY-MM-DD');
 claim:=public.reserve_safety_push(
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   jsonb_build_object(
     'channel','weather','eventKey',k,'city',c,'kind','wind',
     'startsAt',floor(extract(epoch from clock_timestamp())*1000+3600000)
   ));
 if claim is null then raise exception 'Valid weather reservation failed';end if;
 if public.reserve_safety_push(
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   jsonb_build_object(
     'channel','weather','eventKey',k,'city',c,'kind','wind',
     'startsAt',floor(extract(epoch from clock_timestamp())*1000+3600000)
   )) is not null then raise exception 'Duplicate weather event reserved';end if;
 if not public.burn_safety_push(claim)
   or public.burn_safety_push(claim)
 then raise exception 'One-shot burn contract violated';end if;

 quake:=jsonb_build_object(
   'channel','earthquake','eventKey','earthquake:usgs:ci20261118',
   'city',c,'magnitude',4.2,'latitude',43.2141,'longitude',28.5,
   'occurredAt',floor(extract(epoch from clock_timestamp())*1000-60000));
 qclaim:=public.reserve_safety_push(
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc',quake);
 if qclaim is null then raise exception 'Valid quake reservation failed';end if;
 perform set_config('test.quake_claim',qclaim::text,false);
end $$;
reset role;

-- User A revokes earthquake notifications before the irreversible attempt.
set role authenticated;
select set_config('request.jwt.claim.sub',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare v jsonb;
begin
 v:=public.my_earthquake_push('{"operation":"set","enabled":false}'::jsonb);
 if v->>'enabled' is distinct from 'false'
 then raise exception 'B1 opt-out failed after B2 migration';end if;
end $$;
reset role;
set role service_role;
do $$
begin
 if public.burn_safety_push(current_setting('test.quake_claim')::uuid)
 then raise exception 'Revoked earthquake opt-in was ignored';end if;
end $$;
reset role;

-- No Push ever sent. Verify durable and terminal states, then set OFF.
do $$
begin
 if (select count(*) from public.push_deliveries
     where state='uncertain' and event_key like 'weather:%')<>1
 then raise exception 'Weather not recorded as uncertain after burn';end if;
 if (select count(*) from public.push_deliveries
     where state='expired' and event_key like 'earthquake:%')<>1
 then raise exception 'Quake not canceled before send';end if;
end $$;
update public.push_safety_controls
 set delivery_enabled=false where singleton;
select 'push_migration_chain_qa_passed' as result;
