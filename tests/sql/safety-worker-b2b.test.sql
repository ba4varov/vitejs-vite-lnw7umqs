-- Apply fixture, addon, B1, B2a, B2b, then this test in ONE disposable DB.
-- The gate is OFF in Production and every default CI state.
do $$
begin
  if (select bool_or(delivery_enabled) from public.push_safety_controls)
  then raise exception 'Unexpectedly enabled shared Push';end if;
  if (select count(*) from public.push_deliveries)<>0
  then raise exception 'Migrations must not send or reserve records';end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
    where oid='public.push_safety_controls'::regclass)
  then raise exception 'Push safety controls require FORCE RLS';end if;
end $$;

set role authenticated;
do $$
begin
  begin
    perform public.safety_worker_targets(10,null);
    raise exception 'Public target reads must not be permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.finish_safety_push(gen_random_uuid(),'provider_accepted');
    raise exception 'Public outcome writes must not be permitted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role service_role;
do $$
declare r jsonb;
begin
  r:=public.safety_worker_targets(10,null);
  if r<>'[]'::jsonb then
    raise exception 'Gate OFF should expose no subscriptions';end if;
  begin
    perform public.safety_worker_targets(21,null);
    raise exception 'Unbounded device enumeration accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- Simulate established consent and an explicitly operator-enabled gate,
-- confined strictly to this ephemeral CI database.
set role authenticated;
select set_config('request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
begin
  perform public.my_earthquake_push(
    '{"operation":"set","enabled":true,"cityIndex":0}'::jsonb);
end $$;
reset role;
update public.earthquake_push_optins set
  opted_in_at=clock_timestamp()-interval '10 minutes'
  where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.push_safety_controls set delivery_enabled=true where singleton;

set role service_role;
do $$
declare rows jsonb; a jsonb; city jsonb; eid text; claim uuid; next_claim uuid;
begin
  rows:=public.safety_worker_targets(10,null);
  if jsonb_array_length(rows)<>1 then
    raise exception 'Only opted-in, registered and active device should appear';end if;
  a:=rows->0;
  if a->>'userId'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    or a->'weather'->>'enabled'<>'true'
    or a->'earthquake'->>'enabled'<>'true'
    or a->>'endpoint' <> 'https://fcm.googleapis.com/wp/synthetic-fixture'
    or a->>'auth'<>repeat('B',22)
  then raise exception 'Worker target identity or current opt-in mismatch';end if;
  if public.safety_worker_targets(10,'cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>'[]'::jsonb
  then raise exception 'Pagination cursor ignored';end if;
  city:=a->'weather'->'cities'->0;
  eid:='weather:open-meteo:'||repeat('0',32)||':wind:'
       ||to_char(clock_timestamp() at time zone 'Europe/Sofia','YYYY-MM-DD');
  claim:=public.reserve_safety_push(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    jsonb_build_object('channel','weather','eventKey',eid,'city',city,
      'kind','wind','startsAt',
      floor(extract(epoch from clock_timestamp())*1000+3600000)));
  if claim is null then raise exception 'Valid future weather candidate rejected';end if;
  if not public.burn_safety_push(claim)
     or not public.finish_safety_push(claim,'provider_accepted')
  then raise exception 'Unable to burn + finish provider accepted event';end if;
  if public.finish_safety_push(claim,'provider_rejected')
  then raise exception 'Outcome was not terminal';end if;

  -- A second risk stays uncertain in face of a provider network outage.
  next_claim:=public.reserve_safety_push(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    jsonb_build_object('channel','weather',
      'eventKey',replace(eid,':wind:',':rain:'),'city',city,
      'kind','rain','startsAt',
      floor(extract(epoch from clock_timestamp())*1000+3600000)));
  if next_claim is null or not public.burn_safety_push(next_claim)
  then raise exception 'Unable to consume uncertain provider attempt';end if;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.push_deliveries where state='sent')<>1
     or (select count(*) from public.push_deliveries where state='uncertain')<>1
  then raise exception 'Terminal and uncertain states not durable';end if;
end $$;
-- Reset the test-only gate, ensuring code never leaves production delivery on.
update public.push_safety_controls set delivery_enabled=false where singleton;
select 'safety_worker_b2b_database_checks_passed' as result;
