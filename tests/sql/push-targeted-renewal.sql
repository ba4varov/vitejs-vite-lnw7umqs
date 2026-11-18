-- Local CI PostgreSQL ONLY. All endpoints/keys below are synthetic; no Push.
begin;
insert into auth.users(id,email) values
 ('e0000000-0000-0000-0000-000000000001','renew-owner@example.invalid'),
 ('e0000000-0000-0000-0000-000000000002','renew-other@example.invalid');

insert into public.push_preferences(user_id,enabled,cities,categories) values
 ('e0000000-0000-0000-0000-000000000001',true,
 '[{"name":"Isolated","latitude":43,"longitude":27,"zone":"UTC"}]','{wind}'),
 ('e0000000-0000-0000-0000-000000000002',true,
 '[{"name":"Isolated","latitude":43,"longitude":27,"zone":"UTC"}]','{wind}');

update public.push_controls set registration_enabled=false,
 registration_test_user_id='e0000000-0000-0000-0000-000000000001',
 vapid_public_key='B'||repeat('A',86),test_delivery_enabled=false,
 session_target_device_id='e1000000-0000-0000-0000-000000000001'
 where singleton;
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key) values
 ('e1000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/fcm/send/isolated-old',
 encode(sha256(convert_to('https://fcm.googleapis.com/fcm/send/isolated-old','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Note 13 Pro synthetic','B'||repeat('A',86)),
 ('e1000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002',
 'https://fcm.googleapis.com/wp/another-owner',
 encode(sha256(convert_to('https://fcm.googleapis.com/wp/another-owner','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Other synthetic','B'||repeat('A',86));

do $$ begin
 if has_function_privilege('anon','public.my_push_renew(jsonb)','execute')
  or has_function_privilege('service_role','public.my_push_renew(jsonb)','execute')
  or not has_function_privilege('authenticated','public.my_push_renew(jsonb)','execute')
 then raise exception 'Bad grants on renewal RPC';end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',false);
do $$
declare
 old_fp text:=encode(sha256(convert_to('https://fcm.googleapis.com/fcm/send/isolated-old','UTF8')),'hex');
 sub jsonb:=jsonb_build_object('endpoint','https://fcm.googleapis.com/wp/isolated-new',
  'keys',jsonb_build_object('p256dh','B'||repeat('A',86),'auth',repeat('A',22)),
  'expirationTime',null);
 args jsonb;
begin
 args:=jsonb_build_object('operation','renew',
  'deviceId','e1000000-0000-0000-0000-000000000001',
  'fingerprint',old_fp,'subscription',sub,'label','Note 13 Pro synthetic',
  'vapidPublicKey','B'||repeat('A',86));
 begin
  perform public.my_push_renew(args);
  raise exception 'Gate OFF allowed renewal';
 exception when insufficient_privilege then null;end;
 perform set_config('test.renew_payload',args::text,false);
end $$;
reset role;

update public.push_controls set registration_enabled=true where singleton;
set role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',false);
do $$
declare args jsonb:=current_setting('test.renew_payload')::jsonb; result jsonb;
begin
 begin
  perform public.my_push_renew(jsonb_set(args,'{fingerprint}',to_jsonb(repeat('a',64))));
  raise exception 'Wrong fingerprint accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.my_push_renew(args||'{"deviceId":"e1000000-0000-0000-0000-000000000002"}'::jsonb);
  raise exception 'Foreign device accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.my_push_renew(jsonb_set(args,'{subscription,endpoint}',
    to_jsonb('https://fcm.googleapis.com/wp/another-owner'::text)));
  raise exception 'Foreign endpoint accepted';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.my_push_renew(jsonb_set(args,'{subscription,endpoint}',
    to_jsonb('https://127.0.0.1/unsafe'::text)));
  raise exception 'Unsafe endpoint accepted';
 exception when invalid_parameter_value then null;end;
 result:=public.my_push_renew(args);
 if jsonb_array_length(result->'devices')<>1
  or result->'devices'->0->>'id' is distinct from 'e1000000-0000-0000-0000-000000000001'
  or result->'devices'->0->>'fingerprint' is distinct from
    encode(sha256(convert_to('https://fcm.googleapis.com/wp/isolated-new','UTF8')),'hex')
  or result->'devices'->0 ? 'endpoint'
  or result->'devices'->0 ? 'auth_key'
 then raise exception 'Same ID / owner-scoped output violated';end if;
 begin
  perform public.my_push_renew(args);
  raise exception 'Stale fingerprint replay accepted';
 exception when insufficient_privilege then null;end;
end $$;
reset role;

do $$
begin
 if (select session_target_device_id from public.push_controls where singleton)
  is distinct from 'e1000000-0000-0000-0000-000000000001'::uuid
 then raise exception 'Session target changed';end if;
 if (select count(*) from public.push_devices where user_id='e0000000-0000-0000-0000-000000000001')<>1
 then raise exception 'Duplicate device';end if;
 if (select endpoint from public.push_devices where id='e1000000-0000-0000-0000-000000000001')
  <> 'https://fcm.googleapis.com/wp/isolated-new'
 then raise exception 'Endpoint not updated';end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',false);
do $$
begin
 begin
  perform public.my_push_renew(current_setting('test.renew_payload')::jsonb);
  raise exception 'Foreign account accepted';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.push_controls set registration_enabled=false where singleton;
rollback;
