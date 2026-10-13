-- Disposable local DB only. Every fixture is rolled back; no HTTP.
begin;
insert into auth.users(id,email) values
 ('b0000000-0000-0000-0000-000000000001','operator-owner@example.invalid'),
 ('b0000000-0000-0000-0000-000000000002','operator-other@example.invalid'),
 ('b0000000-0000-0000-0000-000000000003','operator-approver@example.invalid');
insert into public.admin_memberships(user_id) values('b0000000-0000-0000-0000-000000000003');
insert into public.push_preferences(user_id,enabled,cities,categories) values
 ('b0000000-0000-0000-0000-000000000001',true,'[{"name":"Isolated","latitude":42,"longitude":23,"zone":"UTC"}]','{wind}');
update public.push_controls set operator_environment='isolated-test',registration_test_user_id='b0000000-0000-0000-0000-000000000001',vapid_public_key='B'||repeat('A',86);
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key) values
 ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/operator-fixture',encode(sha256(convert_to('https://fcm.googleapis.com/wp/operator-fixture','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Note 13 Pro','B'||repeat('A',86));
do $$ declare permit uuid; claim jsonb; cid uuid; scenario text; begin
 if has_function_privilege('service_role','public.prepare_push_operator(uuid,uuid,uuid,text)','execute')
 or has_function_privilege('authenticated','public.arm_push_operator(uuid)','execute')
 or has_function_privilege('service_role','public.claim_push_test_v1_internal(uuid,text)','execute')
 or has_function_privilege('service_role','public.authorize_push_test_v1_internal(uuid,uuid,text)','execute')
 then raise exception 'owner boundary bypass';end if;
 for scenario in select unnest(array['success','consent','deadline','duplicate','environment','revision']) loop
  update public.push_controls set next_test_after='-infinity';
  permit:=public.prepare_push_operator('b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003','wind');
  if exists(select 1 from public.push_controls where test_delivery_enabled or operator_permit_id is not null) then raise exception 'prepared gate open';end if;
  if public.claim_push_test(permit,'B'||repeat('A',86)) is not null then raise exception 'unconfirmed claim';end if;
  perform public.arm_push_operator(permit);
  if exists(select 1 from public.push_controls where test_delivery_enabled) then raise exception 'boolean persisted true';end if;
  if public.claim_push_test(gen_random_uuid(),'B'||repeat('A',86)) is not null then raise exception 'foreign permit';end if;
  if scenario='deadline' then
   update public.push_controls set operator_expires_at=clock_timestamp()-interval '1 second';
   if public.claim_push_test(permit,'B'||repeat('A',86)) is not null then raise exception 'expired lease';end if;
   perform public.close_push_operator(permit);continue;
  end if;
  claim:=public.claim_push_test(permit,'B'||repeat('A',86));
  if claim is null then raise exception 'approved claim denied';end if;
  cid:=(claim->>'claimId')::uuid;
  if scenario='environment' then
   update public.push_controls set operator_environment=null;
   if public.authorize_push_test(permit,cid,'B'||repeat('A',86)) then raise exception 'environment revocation bypass';end if;
   update public.push_controls set operator_environment='isolated-test';
  elsif scenario='revision' then
   update public.push_devices set updated_at=clock_timestamp() where id='b1000000-0000-0000-0000-000000000001';
   if public.authorize_push_test(permit,cid,'B'||repeat('A',86)) then raise exception 'revision race bypass';end if;
  elsif scenario='consent' then
   update public.push_preferences set enabled=false where user_id='b0000000-0000-0000-0000-000000000001';
   if public.authorize_push_test(permit,cid,'B'||repeat('A',86)) then raise exception 'consent bypass';end if;
   update public.push_preferences set enabled=true where user_id='b0000000-0000-0000-0000-000000000001';
  else
   if not public.authorize_push_test(permit,cid,'B'||repeat('A',86)) then raise exception 'authorize denied';end if;
   if public.authorize_push_test(permit,cid,'B'||repeat('A',86)) then raise exception 'duplicate authorization';end if;
   perform public.finish_push_test(permit,cid,'sent',0);
  end if;
  if exists(select 1 from public.push_controls where test_delivery_enabled or operator_permit_id is not null) then raise exception 'gate not closed before send';end if;
  begin perform public.arm_push_operator(permit);raise exception 'rearm succeeded';exception when raise_exception then
   if sqlerrm<>'OPERATOR_NOT_READY' then raise;end if;
  end;
 end loop;
 begin
  perform public.prepare_push_operator('b0000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003','wind');
  raise exception 'foreign account allowed';
 exception when raise_exception then if sqlerrm<>'OPERATOR_NOT_READY' then raise;end if;end;
end $$;
rollback;
