-- Apply after fixture and production migration, against isolated PostgreSQL.
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $$
declare result jsonb; first_optin text;
begin
 result:=public.my_earthquake_push('{"operation":"load"}'::jsonb);
 if (result->>'enabled')::boolean or result->>'deliveryEnabled' <> 'false'
    or (result->>'radiusKm')::int<>300 or (result->>'minMagnitude')::numeric<>3.0
 then raise exception 'New accounts must be opted out'; end if;

 result:=public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":0}'::jsonb);
 if result->>'enabled'<>'true' or result->'city'->>'name'<>'Варна'
    or result->>'deliveryEnabled'<>'false' or (result->>'deviceCount')::int<>1
 then raise exception 'Explicit opt-in failed'; end if;
 first_optin:=result->>'optedInAt';
 if first_optin is null then raise exception 'Consent timestamp absent'; end if;

 -- Idempotent repeat must not backdate the new consent.
 result:=public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":0}'::jsonb);
 if result->>'optedInAt' is distinct from first_optin
 then raise exception 'Idempotent opt-in modified timestamp'; end if;

 result:=public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":1}'::jsonb);
 if result->'city'->>'name'<>'София' or result->>'optedInAt'<=first_optin
 then raise exception 'City switch must start a new consent'; end if;

 -- Supplied coordinates or user ID must never be accepted by RPC.
 begin
  perform public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":0,"userId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}'::jsonb);
  raise exception 'Unexpectedly accepted forged user id';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":0,"latitude":42.0}'::jsonb);
  raise exception 'Unexpectedly accepted arbitrary coordinates';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":3}'::jsonb);
  raise exception 'Unexpectedly accepted unsaved city';
 exception when invalid_parameter_value then null;
 end;

 -- Direct table reads must fail even for a signed-in user.
 begin
  perform 1 from public.earthquake_push_optins;
  raise exception 'Unexpected direct table access';
 exception when insufficient_privilege then null;
 end;

 result:=public.my_earthquake_push('{"operation":"set","enabled":false}'::jsonb);
 if result->>'enabled'<>'false' or result->'city'<>'null'::jsonb
   or result->'optedInAt'<>'null'::jsonb
 then raise exception 'Opt-out failed';end if;
end $$;

-- A second user cannot see or change the first account through auth.uid.
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $$
declare result jsonb;
begin
 result:=public.my_earthquake_push('{"operation":"load"}'::jsonb);
 if result->>'enabled'<>'false' or (result->>'deviceCount')::int<>0
 then raise exception 'Cross-account preference leak'; end if;
 result:=public.my_earthquake_push('{"operation":"set","enabled":true,"cityIndex":0}'::jsonb);
 if result->'city'->>'name'<>'Русе' then raise exception 'Account city mismatch'; end if;
end $$;

-- Anonymous requests must fail, even if they know a saved account UUID.
select set_config('request.jwt.claim.sub','',false);
do $$
begin
 begin
  perform public.my_earthquake_push('{"operation":"load"}'::jsonb);
  raise exception 'Anonymous RPC must be rejected';
 exception when insufficient_privilege then null;
 end;
end $$;

reset role;
do $$
begin
 if (select count(*) from public.earthquake_push_optins)<>1 then
  raise exception 'Opt-out/cross-account state incorrect';
 end if;
end $$;
select 'earthquake_push_opt_in_sql_tests_passed' as result;
