-- Disposable local DB only. Every fixture is rolled back; no HTTP.
begin;
update public.push_controls set operator_admin_id='b0000000-0000-0000-0000-000000000003';
do $$ declare permit uuid; claim jsonb; cid uuid; scenario text; request_id uuid; replay uuid; begin
 if exists(select 1 from public.push_controls where test_delivery_enabled) then raise exception 'legacy gate not closed at rollout';end if;
 if (select to_jsonb(d) from public.push_devices d where id='b1000000-0000-0000-0000-000000000001') is distinct from (select snapshot from operator_existing_device) then raise exception 'existing registration modified by migration';end if;
 if (select to_jsonb(p) from public.push_preferences p where user_id='b0000000-0000-0000-0000-000000000001') is distinct from (select snapshot from operator_existing_preferences) then raise exception 'consent modified by migration';end if;
 if has_function_privilege('authenticated','public.prepare_push_operator(uuid,uuid,uuid,text,uuid)','execute')
 or has_function_privilege('authenticated','public.arm_push_operator(uuid,uuid,text)','execute')
 or has_function_privilege('service_role','public.claim_push_test_v1_internal(uuid,text)','execute')
 or has_function_privilege('service_role','public.authorize_push_test_v1_internal(uuid,uuid,text)','execute')
 then raise exception 'owner boundary bypass';end if;
 for scenario in select unnest(array['success','consent','deadline','duplicate','environment','revision','throttle','indefinite']) loop
  update public.push_controls set next_test_after='-infinity';
  permit:=(public.prepare_push_operator('b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','wind',gen_random_uuid())->>'permitId')::uuid;
  if exists(select 1 from public.push_controls where test_delivery_enabled or operator_permit_id is not null) then raise exception 'prepared gate open';end if;
  if public.claim_push_test(permit,'B'||repeat('A',86)) is not null then raise exception 'unconfirmed claim';end if;
  begin perform public.arm_push_operator('b0000000-0000-0000-0000-000000000003',permit,'wrong confirmation');raise exception 'confirmation bypass';
  exception when raise_exception then if sqlerrm<>'OPERATOR_NOT_READY' then raise;end if;end;
  perform public.arm_push_operator('b0000000-0000-0000-0000-000000000003',permit,'SEND ONE b0000000-0000-0000-0000-000000000001 b1000000-0000-0000-0000-000000000001');
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
   update public.push_controls set operator_admin_id=null;
   if public.authorize_push_test(permit,cid,'B'||repeat('A',86)) then raise exception 'environment revocation bypass';end if;
   update public.push_controls set operator_admin_id='b0000000-0000-0000-0000-000000000003';
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
   if scenario='throttle' then
    perform public.finish_push_test(permit,cid,'throttled',123);
    if not exists(select 1 from public.push_controls where next_test_after>clock_timestamp()+interval '120 seconds') then raise exception 'provider cooldown shortened';end if;
   elsif scenario='indefinite' then
    perform public.finish_push_test(permit,cid,'throttled',null);
    if public.push_operator_access('b0000000-0000-0000-0000-000000000003') then raise exception 'indefinite throttle bypass';end if;
    update public.push_controls set operator_paused=false; -- Fixture reset, never performed by tool.
   else perform public.finish_push_test(permit,cid,'sent',0);end if;
  end if;
  if exists(select 1 from public.push_controls where test_delivery_enabled or operator_permit_id is not null) then raise exception 'gate not closed before send';end if;
  begin perform public.arm_push_operator('b0000000-0000-0000-0000-000000000003',permit,'SEND ONE b0000000-0000-0000-0000-000000000001 b1000000-0000-0000-0000-000000000001');raise exception 'rearm succeeded';exception when raise_exception then
   if sqlerrm<>'OPERATOR_NOT_READY' then raise;end if;
  end;
 end loop;
 update public.push_controls set next_test_after='-infinity';
 request_id:=gen_random_uuid();
 permit:=(public.prepare_push_operator('b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','wind',request_id)->>'permitId')::uuid;
 replay:=(public.prepare_push_operator('b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','wind',request_id)->>'permitId')::uuid;
 if replay<>permit then raise exception 'preparation idempotency failed';end if;
 perform public.cancel_push_operator('b0000000-0000-0000-0000-000000000003',permit);
 begin perform public.arm_push_operator('b0000000-0000-0000-0000-000000000003',permit,'SEND ONE b0000000-0000-0000-0000-000000000001 b1000000-0000-0000-0000-000000000001');raise exception 'cancelled permit armed';
 exception when raise_exception then if sqlerrm<>'OPERATOR_NOT_READY' then raise;end if;end;
 insert into public.admin_memberships(user_id) values('b0000000-0000-0000-0000-000000000002');
 if public.push_operator_access('b0000000-0000-0000-0000-000000000002') then raise exception 'other admin can initiate';end if;
 begin perform public.prepare_push_operator('b0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','wind',gen_random_uuid());raise exception 'other admin prepared';
 exception when insufficient_privilege then null;end;
 begin
  perform public.prepare_push_operator('b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','wind',gen_random_uuid());
  raise exception 'foreign account allowed';
 exception when raise_exception then if sqlerrm<>'OPERATOR_NOT_READY' then raise;end if;end;
end $$;
rollback;
-- Remove only the disposable pre-migration fixtures before unrelated HTTP regressions.
delete from auth.users where id in ('b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003');
