-- Run only against disposable CI PostgreSQL after fixture + migration.
-- A real sender is deliberately NOT tested or enabled.
do $$
declare candidate jsonb;
begin
 candidate=jsonb_build_object(
  'channel','weather','kind','wind','eventKey',
  'weather:open-meteo:00000000000000000000000000000000:wind:2026-11-18',
  'city',(select cities->0 from public.push_preferences
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'startsAt',round(extract(epoch from clock_timestamp())*1000+3600000)
 );
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null
 then raise exception 'Gate default must be disabled';end if;
 if exists(select 1 from public.push_deliveries) then
  raise exception 'Disabled gate wrote an outbox record';end if;
end $$;

-- Authenticated public roles cannot call reservation or burn RPCs.
set role authenticated;
do $$
begin
 begin
   perform public.reserve_safety_push(
     'cccccccc-cccc-4ccc-8ccc-cccccccccccc','{}'::jsonb);
   raise exception 'Unexpected authenticated reservation permission';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.burn_safety_push(gen_random_uuid());
   raise exception 'Unexpected authenticated burn permission';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

-- Only the SQL fixture's postgres can activate the gate. Never Production.
update public.push_safety_controls set delivery_enabled=true where singleton;

set role service_role;
do $$
declare candidate jsonb;
declare claim uuid;
begin
 candidate:=jsonb_build_object(
  'channel','weather','kind','wind','eventKey',
  'weather:open-meteo:00000000000000000000000000000000:wind:2026-11-18',
  'city',jsonb_build_object(
    'name','Varna','latitude',43.2141,'longitude',27.9147,'zone','Europe/Sofia'),
  'startsAt',round(extract(epoch from clock_timestamp())*1000+3600000)
 );
 claim:=public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate);
 if claim is null then raise exception 'Valid weather candidate not reserved';end if;
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null then raise exception 'Duplicate weather claim';end if;
 if not public.burn_safety_push(claim) then
  raise exception 'Pre-send weather burn denied valid consent';end if;
 if public.burn_safety_push(claim) then
  raise exception 'Second burn must be impossible';end if;

 -- User B cannot borrow A's city/preferences/device.
 if public.reserve_safety_push('dddddddd-dddd-4ddd-8ddd-dddddddddddd',candidate)
    is not null then raise exception 'Cross-account weather consent bypass';end if;

 -- A different, not enabled category is blocked even for A's active device.
 candidate:=candidate||jsonb_build_object(
   'kind','sport',
   'eventKey','weather:open-meteo:00000000000000000000000000000000:sport:2026-11-18'
 );
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null then raise exception 'Unsafe category passed';end if;

 -- Forge a new location not in the user's saved weather cities.
 candidate:=candidate||jsonb_build_object(
   'kind','rain',
   'eventKey','weather:open-meteo:00000000000000000000000000000000:rain:2026-11-18',
   'city',jsonb_build_object(
    'name','London','latitude',51.5,'longitude',-0.1,'zone','Europe/London')
 );
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null then raise exception 'Forged weather city allowed';end if;
end $$;
reset role;

-- Verify the durable state was irreversibly burned BEFORE any transport.
do $$
begin
 if (select count(*) from public.push_deliveries
      where event_key like 'weather:%' and state='uncertain')<>1
 then raise exception 'Weather ledger not burned to uncertain';end if;
end $$;

set role service_role;
do $$
declare candidate jsonb;
declare claim uuid;
begin
 candidate:=jsonb_build_object(
  'channel','earthquake',
  'eventKey','earthquake:usgs:example20261118',
  'city',jsonb_build_object(
    'name','Varna','latitude',43.2141,'longitude',27.9147,'zone','Europe/Sofia'),
  'magnitude',3.8,
  'latitude',43.2141,'longitude',28.5,
  'occurredAt',round(extract(epoch from clock_timestamp())*1000-120000)
 );
 claim:=public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate);
 if claim is null then raise exception 'Valid nearby earthquake not reserved';end if;
 perform set_config('test.earthquake_claim',claim::text,false);
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null then raise exception 'Duplicate USGS event reserved';end if;

 candidate:=candidate||jsonb_build_object(
   'eventKey','earthquake:usgs:outofrange20261118','longitude',33.0);
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null then raise exception 'Distant earthquake accepted';end if;

 candidate:=candidate||jsonb_build_object(
   'eventKey','earthquake:usgs:weak20261118',
   'longitude',28.5,'magnitude',2.9);
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null then raise exception 'Below M3 accepted';end if;

 candidate:=candidate||jsonb_build_object(
   'eventKey','earthquake:usgs:old20261118','magnitude',3.8,
   'occurredAt',round(extract(epoch from clock_timestamp())*1000-46*60000));
 if public.reserve_safety_push('cccccccc-cccc-4ccc-8ccc-cccccccccccc',candidate)
    is not null then raise exception 'Stale earthquake accepted';end if;
end $$;
reset role;

-- A user can revoke consent before burn; there must be NO outbound attempt.
delete from public.earthquake_push_optins
 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set role service_role;
do $$
begin
 if public.burn_safety_push(current_setting('test.earthquake_claim')::uuid)
 then raise exception 'Revoked earthquake consent did not stop burn';end if;
end $$;
reset role;
do $$
begin
 if (select count(*) from public.push_deliveries
     where event_key='earthquake:usgs:example20261118' and state='expired')<>1
 then raise exception 'Revocation must expire reserved earthquake';end if;
 if (select count(*) from public.push_deliveries
     where state='uncertain')<>1
 then raise exception 'Unexpected live delivery attempt';end if;
end $$;
-- Existing delivery types and other Push controls remain untouched.
select 'safety_push_gate_postgres_checks_passed' as result;
