-- Disposable local PostgreSQL only. All fixtures/gates roll back; no outbound HTTP.
begin;
insert into auth.users(id,email) values
 ('b0000000-0000-0000-0000-000000000001','sender-owner@example.invalid'),
 ('b0000000-0000-0000-0000-000000000002','sender-other@example.invalid'),
 ('b0000000-0000-0000-0000-000000000003','sender-approver@example.invalid');
insert into public.admin_memberships(user_id) values('b0000000-0000-0000-0000-000000000003');
insert into public.push_preferences(user_id,enabled,cities,categories) values
 ('b0000000-0000-0000-0000-000000000001',true,'[{"name":"Isolated","latitude":42,"longitude":23,"zone":"UTC"}]','{wind}');
update public.push_controls set vapid_public_key='B'||repeat('A',86) where singleton;
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key) values
 ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/isolated-delivery',encode(sha256(convert_to('https://fcm.googleapis.com/wp/isolated-delivery','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Isolated','B'||repeat('A',86));
insert into public.push_test_permits(id,user_id,device_id,approved_by,device_revision,preferences_revision,category,expires_at)
 select 'b2000000-0000-0000-0000-000000000001',d.user_id,d.id,'b0000000-0000-0000-0000-000000000003',d.updated_at,p.updated_at,'wind',clock_timestamp()+interval '10 minutes'
 from public.push_devices d join public.push_preferences p on p.user_id=d.user_id where d.id='b1000000-0000-0000-0000-000000000001';
-- Actual grant checks, including the renamed legacy RPC and internal predicate.
set local role authenticated;
do $$ begin
 begin perform public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86));raise exception 'user sender access';exception when insufficient_privilege then null;end;
 begin perform public.my_push_v1_internal();raise exception 'legacy bypass';exception when insufficient_privilege then null;end;
 begin perform 1 from public.push_test_permits;raise exception 'permit direct access';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin perform 1 from public.push_devices;raise exception 'service direct access';exception when insufficient_privilege then null;end;
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86)) is not null then raise exception 'off gate';end if;
end $$;
reset role;
update public.push_controls set test_delivery_enabled=true;
do $$ declare claim jsonb;cid uuid; begin
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','wrong') is not null then raise exception 'wrong VAPID';end if;
 update public.push_test_permits set user_id='b0000000-0000-0000-0000-000000000002';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86)) is not null then raise exception 'foreign device';end if;
 update public.push_test_permits set user_id='b0000000-0000-0000-0000-000000000001';
 update public.push_devices set subscription_expires_at=clock_timestamp()-interval '1 second';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86)) is not null then raise exception 'expired subscription';end if;
 update public.push_devices set subscription_expires_at=null;
 update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='b0000000-0000-0000-0000-000000000001';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86)) is not null then raise exception 'blocked account';end if;
 update auth.users set banned_until=null where id='b0000000-0000-0000-0000-000000000001';
 update public.subscriptions set status='canceled' where user_id='b0000000-0000-0000-0000-000000000001';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86)) is not null then raise exception 'inactive subscription';end if;
 update public.subscriptions set status='active' where user_id='b0000000-0000-0000-0000-000000000001';
 update public.push_preferences set categories='{walk}';update public.push_test_permits set category='walk';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86)) is not null then raise exception 'Free Pro category';end if;
 update public.subscriptions set plan='pro' where user_id='b0000000-0000-0000-0000-000000000001';
 claim:=public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86));
 if claim is null then raise exception 'Pro permission denied';end if;
 cid:=(claim->>'claimId')::uuid;
 if public.claim_push_test('b2000000-0000-0000-0000-000000000001','B'||repeat('A',86)) is not null then raise exception 'duplicate reserved';end if;
 update public.subscriptions set plan='free' where user_id='b0000000-0000-0000-0000-000000000001';
 if public.authorize_push_test('b2000000-0000-0000-0000-000000000001',cid,'B'||repeat('A',86)) then raise exception 'downgrade race';end if;
 update public.subscriptions set plan='pro' where user_id='b0000000-0000-0000-0000-000000000001';
 update public.push_preferences set enabled=false;
 if public.authorize_push_test('b2000000-0000-0000-0000-000000000001',cid,'B'||repeat('A',86)) then raise exception 'consent race';end if;
 update public.push_preferences set enabled=true;
 update public.push_controls set test_delivery_enabled=false;
 if public.authorize_push_test('b2000000-0000-0000-0000-000000000001',cid,'B'||repeat('A',86)) then raise exception 'gate revocation race';end if;
 update public.push_controls set test_delivery_enabled=true;
 if not public.authorize_push_test('b2000000-0000-0000-0000-000000000001',cid,'B'||repeat('A',86)) then raise exception 'authorization denied';end if;
 if public.authorize_push_test('b2000000-0000-0000-0000-000000000001',cid,'B'||repeat('A',86)) then raise exception 'authorization reused';end if;
 perform public.finish_push_test('b2000000-0000-0000-0000-000000000001',cid,'throttled',123);
 if not exists(select 1 from public.push_controls where next_test_after>clock_timestamp()+interval '120 seconds') then raise exception '429 cooldown';end if;
end $$;
-- Re-registration after key rotation must identify the key used by the browser.
update public.push_controls set registration_enabled=true,registration_test_user_id='b0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub='b0000000-0000-0000-0000-000000000001';
do $$ declare payload jsonb;begin
 payload:=jsonb_build_object('operation','register','label','Registered','vapidPublicKey','B'||repeat('A',86),'subscription',jsonb_build_object('endpoint','https://fcm.googleapis.com/wp/registered','expirationTime',null,'keys',jsonb_build_object('p256dh',translate(replace(rtrim(encode(decode('04'||repeat('01',64),'hex'),'base64'),'='),E'\n',''),'+/','-_'),'auth',repeat('A',22))));
 perform public.my_push(payload);
 begin perform public.my_push(payload-'vapidPublicKey');raise exception 'unbound registration';exception when raise_exception then if sqlerrm<>'PUSH_KEY_MISMATCH' then raise;end if;end;
end $$;
reset role;
-- Expired permit, revoked approver, changed revisions and provider expiration.
update public.push_controls set next_test_after='-infinity';
insert into public.push_test_permits(id,user_id,device_id,approved_by,device_revision,preferences_revision,category,expires_at)
 select 'b2000000-0000-0000-0000-000000000002',d.user_id,d.id,'b0000000-0000-0000-0000-000000000003',d.updated_at,p.updated_at,'walk',clock_timestamp()+interval '10 minutes'
 from public.push_devices d join public.push_preferences p on p.user_id=d.user_id where d.id='b1000000-0000-0000-0000-000000000001';
do $$ declare claim jsonb;cid uuid;begin
 update public.push_test_permits set created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' where id='b2000000-0000-0000-0000-000000000002';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000002','B'||repeat('A',86)) is not null then raise exception 'expired permit';end if;
 update public.push_test_permits set created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '10 minutes' where id='b2000000-0000-0000-0000-000000000002';
 delete from public.admin_memberships where user_id='b0000000-0000-0000-0000-000000000003';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000002','B'||repeat('A',86)) is not null then raise exception 'revoked approver';end if;
 insert into public.admin_memberships(user_id) values('b0000000-0000-0000-0000-000000000003');
 update public.push_devices set updated_at=updated_at+interval '1 second' where id='b1000000-0000-0000-0000-000000000001';
 if public.claim_push_test('b2000000-0000-0000-0000-000000000002','B'||repeat('A',86)) is not null then raise exception 'changed device';end if;
 update public.push_test_permits set device_revision=(select updated_at from public.push_devices where id='b1000000-0000-0000-0000-000000000001') where id='b2000000-0000-0000-0000-000000000002';
 claim:=public.claim_push_test('b2000000-0000-0000-0000-000000000002','B'||repeat('A',86));cid:=(claim->>'claimId')::uuid;
 if not public.authorize_push_test('b2000000-0000-0000-0000-000000000002',cid,'B'||repeat('A',86)) then raise exception 'valid authorization';end if;
 perform public.finish_push_test('b2000000-0000-0000-0000-000000000002',cid,'expired',0);
 if exists(select 1 from public.push_devices where id='b1000000-0000-0000-0000-000000000001') then raise exception '410 invalidation';end if;
end $$;
rollback;
