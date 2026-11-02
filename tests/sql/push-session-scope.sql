-- Synthetic local fixtures, no HTTP or provider, rolled back in full.
begin;
insert into auth.users(id,email) values
 ('c0000000-0000-0000-0000-000000000001','session-owner@example.invalid'),
 ('c0000000-0000-0000-0000-000000000002','session-other@example.invalid');
insert into public.admin_memberships(user_id) values
 ('c0000000-0000-0000-0000-000000000001'),('c0000000-0000-0000-0000-000000000002');
insert into public.push_preferences(user_id,enabled,cities,categories) values
 ('c0000000-0000-0000-0000-000000000001',true,'[{"name":"Isolated","latitude":42,"longitude":23,"zone":"UTC"}]','{wind}');
update public.push_controls set operator_admin_id='c0000000-0000-0000-0000-000000000001',
 registration_test_user_id=null,test_delivery_enabled=false,next_test_after='-infinity',vapid_public_key='B'||repeat('A',86);
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key) values
 ('5ff76543-ea64-4721-9846-3859621e954f','c0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/session-fixture',encode(sha256(convert_to('https://fcm.googleapis.com/wp/session-fixture','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Redmi Note 13 Pro','B'||repeat('A',86));
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key)
 select 'c1000000-0000-0000-0000-000000000001',user_id,'https://fcm.googleapis.com/wp/other-fixture',encode(sha256(convert_to('https://fcm.googleapis.com/wp/other-fixture','UTF8')),'hex'),p256dh,auth_key,label,vapid_public_key from public.push_devices where id='5ff76543-ea64-4721-9846-3859621e954f';
do $$ declare p uuid; claim jsonb; owner_id uuid:='c0000000-0000-0000-0000-000000000001'; begin
 if has_function_privilege('anon','public.push_session_permit(text,uuid,uuid,text)','execute')
 or has_function_privilege('authenticated','public.push_session_permit(text,uuid,uuid,text)','execute')
 or not has_function_privilege('service_role','public.push_session_permit(text,uuid,uuid,text)','execute')
 then raise exception 'session adapter grants invalid';end if;
 p:=(public.prepare_push_operator(owner_id,owner_id,'5ff76543-ea64-4721-9846-3859621e954f','wind',gen_random_uuid())->>'permitId')::uuid;
 if public.push_session_permit('arm','c0000000-0000-0000-0000-000000000002',p,'anything') then raise exception 'other admin allowed';end if;
 -- Even a selected admin cannot use a permit for another owner.
 update public.push_test_permits set user_id='c0000000-0000-0000-0000-000000000002' where id=p;
 if public.push_session_permit('arm',owner_id,p,'anything') then raise exception 'foreign owner allowed';end if;
 update public.push_test_permits set user_id=owner_id where id=p;
 -- UUID restriction remains authoritative even if the label is copied.
 update public.push_test_permits set device_id='c1000000-0000-0000-0000-000000000001' where id=p;
 if public.push_session_permit('arm',owner_id,p,'anything') then raise exception 'other device allowed';end if;
 update public.push_test_permits set device_id='5ff76543-ea64-4721-9846-3859621e954f' where id=p;
 if public.push_session_permit('unexpected',owner_id,p,null) then raise exception 'unexpected action';end if;
 if not public.push_session_permit('arm',owner_id,p,'SEND ONE '||owner_id::text||' 5ff76543-ea64-4721-9846-3859621e954f') then raise exception 'scoped arm denied';end if;
 claim:=public.claim_push_test(p,'B'||repeat('A',86));
 if claim is null then raise exception 'claim denied';end if;
 if not public.authorize_push_test(p,(claim->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'authorization denied';end if;
 if public.authorize_push_test(p,(claim->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'duplicate authorization';end if;
 if exists(select 1 from public.push_controls where test_delivery_enabled or operator_permit_id is not null) then raise exception 'gate left open';end if;
end $$;
rollback;
