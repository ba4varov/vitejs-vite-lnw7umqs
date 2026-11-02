-- Synthetic fixtures only. No HTTP, real endpoints or persisted mutations.
begin;
insert into auth.users(id,email) values
 ('d0000000-0000-0000-0000-000000000001','desktop@example.invalid'),
 ('d0000000-0000-0000-0000-000000000002','other@example.invalid');
insert into public.admin_memberships(user_id) values
 ('d0000000-0000-0000-0000-000000000001'),('d0000000-0000-0000-0000-000000000002');
insert into public.push_preferences(user_id,enabled,cities,categories) values
 ('d0000000-0000-0000-0000-000000000001',true,'[{"name":"Isolated","latitude":42,"longitude":23,"zone":"UTC"}]','{wind}');
update public.push_controls set operator_admin_id='d0000000-0000-0000-0000-000000000001',
 session_target_device_id=null,registration_test_user_id=null,test_delivery_enabled=false,
 operator_permit_id=null,operator_expires_at=null,operator_paused=false,next_test_after='-infinity',vapid_public_key='B'||repeat('A',86);
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key) values
 ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/DESKTOP-SYNTHETIC',encode(sha256(convert_to('https://fcm.googleapis.com/wp/DESKTOP-SYNTHETIC','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Desktop Chrome synthetic','B'||repeat('A',86)),
 ('d1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/OTHER-SYNTHETIC',encode(sha256(convert_to('https://fcm.googleapis.com/wp/OTHER-SYNTHETIC','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Other synthetic','B'||repeat('A',86));
do $$ declare
 owner_id uuid:='d0000000-0000-0000-0000-000000000001';
 other_id uuid:='d0000000-0000-0000-0000-000000000002';
 target_id uuid:='d1000000-0000-0000-0000-000000000001';
 p uuid; claim jsonb; mode text; signature text;
begin
 foreach signature in array array['push_session_target(uuid)','push_session_scope(uuid,uuid,uuid)','prepare_push_session(uuid,text,uuid)','push_session_permit(text,uuid,uuid,text)','authorize_push_test(uuid,uuid,text)'] loop
  if has_function_privilege('anon','public.'||signature,'execute') or has_function_privilege('authenticated','public.'||signature,'execute')
   or not has_function_privilege('service_role','public.'||signature,'execute') then raise exception 'bad grants: %',signature;end if;
 end loop;
 if public.push_session_target(owner_id) is not null then raise exception 'default open';end if;
 begin perform public.prepare_push_session(owner_id,'wind',gen_random_uuid());raise exception 'missing target accepted';exception when insufficient_privilege then null;end;
 update public.push_controls set session_target_device_id=target_id where singleton;
 if public.push_session_target(other_id) is not null then raise exception 'foreign admin target exposed';end if;
 begin perform public.prepare_push_session(other_id,'wind',gen_random_uuid());raise exception 'foreign admin allowed';exception when insufficient_privilege then null;end;
 -- One real SQL scenario per rejection, each isolated by a PL/pgSQL subtransaction.
 foreach mode in array array['wrong-device','registration','missing','expired','account','membership','target-after-claim','success'] loop
  begin
   p:=(public.prepare_push_session(owner_id,'wind',gen_random_uuid())->>'permitId')::uuid;
   if mode='missing' then
    if public.push_session_permit('arm',owner_id,gen_random_uuid(),'anything') then raise exception 'missing permit allowed';end if;
   elsif mode='wrong-device' then
    update public.push_controls set session_target_device_id='d1000000-0000-0000-0000-000000000002' where singleton;
    if public.push_session_permit('arm',owner_id,p,'SEND ONE '||owner_id||' '||target_id) then raise exception 'wrong target allowed';end if;
   elsif mode in ('registration','expired','account','membership') then
    if mode='registration' then update public.push_devices set auth_key=repeat('B',22),updated_at=clock_timestamp() where id=target_id;
    elsif mode='expired' then update public.push_test_permits set expires_at=created_at+interval '1 microsecond' where id=p;
    elsif mode='account' then update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=owner_id;
    elsif mode='membership' then delete from public.admin_memberships where user_id=owner_id;
    end if;
    begin
     if public.push_session_permit('arm',owner_id,p,'SEND ONE '||owner_id||' '||target_id) then raise exception 'rejected scenario allowed: %',mode;end if;
    exception when raise_exception then
     if sqlerrm<>'OPERATOR_NOT_READY' then raise;end if;
    end;
   else
    if not public.push_session_permit('arm',owner_id,p,'SEND ONE '||owner_id||' '||target_id) then raise exception 'arm refused';end if;
    claim:=public.claim_push_test(p,'B'||repeat('A',86));
    if claim is null then raise exception 'claim refused';end if;
    if public.claim_push_test(p,'B'||repeat('A',86)) is not null then raise exception 'duplicate claim';end if;
    if mode='target-after-claim' then update public.push_controls set session_target_device_id=null where singleton;end if;
    if public.authorize_push_test(p,(claim->>'claimId')::uuid,'B'||repeat('A',86)) is distinct from (mode='success') then raise exception 'final target check failed';end if;
    if public.authorize_push_test(p,(claim->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'repeat send allowed';end if;
    if exists(select 1 from public.push_controls where singleton and (session_target_device_id is not null or test_delivery_enabled or operator_permit_id is not null)) then raise exception 'permission not burned before provider';end if;
   end if;
   raise sqlstate 'ZX001'; -- Roll back this scenario's mutations, including cooldown.
  exception when sqlstate 'ZX001' then null;
  end;
 end loop;
end $$;
rollback;
