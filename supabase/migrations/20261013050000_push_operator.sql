-- Review/apply manually in an approved isolated project. No gates enabled.
begin;
alter table public.push_test_permits add column operator_armed_at timestamptz;
alter table public.push_controls add column operator_permit_id uuid,
 add column operator_expires_at timestamptz,
 add column operator_environment text check(operator_environment='isolated-test');
alter function public.push_test_allowed(uuid,text) rename to push_test_allowed_v1_internal;
revoke all on function public.push_test_allowed_v1_internal(uuid,text) from public,anon,authenticated,service_role;
create function public.push_test_allowed(permit_id uuid,key_public text) returns boolean
language sql volatile security definer set search_path='' as $$
 select public.push_test_allowed_v1_internal(permit_id,key_public)
 and exists(select 1 from public.push_controls c join public.push_test_permits t on t.id=permit_id
 where c.singleton and c.operator_environment='isolated-test' and not c.registration_enabled
 and c.operator_permit_id=t.id and c.operator_expires_at>clock_timestamp()
 and c.registration_test_user_id=t.user_id)
$$;
revoke all on function public.push_test_allowed(uuid,text) from public,anon,authenticated,service_role;

create function public.close_push_operator(permit_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.push_controls where singleton for update;
 update public.push_controls set test_delivery_enabled=false,operator_permit_id=null,operator_expires_at=null
 where singleton and operator_permit_id=permit_id;
 update public.push_test_permits set revoked=true where id=permit_id;
 return true;
end $$;
revoke all on function public.close_push_operator(uuid) from public,anon,authenticated,service_role;
grant execute on function public.close_push_operator(uuid) to service_role;

alter function public.claim_push_test(uuid,text) rename to claim_push_test_v1_internal;
revoke all on function public.claim_push_test_v1_internal(uuid,text) from public,anon,authenticated,service_role;
create function public.claim_push_test(permit_id uuid,key_public text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform 1 from public.push_controls where singleton for update;
 if not exists(select 1 from public.push_controls where singleton and not test_delivery_enabled
  and operator_permit_id=permit_id and operator_expires_at>clock_timestamp()) then return null;end if;
 -- Global boolean opens only inside this transaction; never commits true.
 update public.push_controls set test_delivery_enabled=true where singleton;
 result:=public.claim_push_test_v1_internal(permit_id,key_public);
 update public.push_controls set test_delivery_enabled=false where singleton;
 return result;
end $$;
revoke all on function public.claim_push_test(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_push_test(uuid,text) to service_role;

alter function public.authorize_push_test(uuid,uuid,text) rename to authorize_push_test_v1_internal;
revoke all on function public.authorize_push_test_v1_internal(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.authorize_push_test(permit_id uuid,claim_id uuid,key_public text) returns boolean
language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
 perform 1 from public.push_controls where singleton for update;
 if not exists(select 1 from public.push_controls where singleton and not test_delivery_enabled
  and operator_permit_id=permit_id and operator_expires_at>clock_timestamp()) then return false;end if;
 update public.push_controls set test_delivery_enabled=true where singleton;
 allowed:=public.authorize_push_test_v1_internal(permit_id,claim_id,key_public);
 -- Burn and close in the same transaction, BEFORE the provider request.
 perform public.close_push_operator(permit_id);
 return allowed;
end $$;
revoke all on function public.authorize_push_test(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.authorize_push_test(uuid,uuid,text) to service_role;

-- DB owner only. Preflight creates a revoked permit; checks use existing predicate.
create function public.prepare_push_operator(target_user uuid,target_device uuid,approver uuid,test_category text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; key_value text;
begin
 perform 1 from public.push_controls where singleton for update;
 if not exists(select 1 from public.push_controls where singleton and not test_delivery_enabled
  and operator_environment='isolated-test' and not registration_enabled and registration_test_user_id=target_user and next_test_after<=clock_timestamp()
  and (operator_permit_id is null or operator_expires_at<=clock_timestamp()))
 then raise exception 'OPERATOR_NOT_READY'; end if;
 select vapid_public_key into key_value from public.push_controls where singleton;
 insert into public.push_test_permits(user_id,device_id,approved_by,device_revision,preferences_revision,category,expires_at)
 select d.user_id,d.id,approver,d.updated_at,p.updated_at,test_category,clock_timestamp()+interval '2 minutes'
 from public.push_devices d join public.push_preferences p on p.user_id=d.user_id
 where d.id=target_device and d.user_id=target_user returning id into result;
 if result is null then raise exception 'OPERATOR_NOT_READY';end if;
 update public.push_controls set test_delivery_enabled=true,operator_permit_id=result,
  operator_expires_at=clock_timestamp()+interval '60 seconds' where singleton;
 if not public.push_test_allowed(result,key_value) then raise exception 'OPERATOR_NOT_READY';end if;
 update public.push_controls set test_delivery_enabled=false,operator_permit_id=null,operator_expires_at=null where singleton;
 update public.push_test_permits set revoked=true where id=result;
 return result;
end $$;
revoke all on function public.prepare_push_operator(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.arm_push_operator(permit_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare key_value text;
begin
 perform 1 from public.push_controls where singleton for update;
 if not exists(select 1 from public.push_controls where singleton and not test_delivery_enabled
  and operator_environment='isolated-test' and not registration_enabled and next_test_after<=clock_timestamp()
  and (operator_permit_id is null or operator_expires_at<=clock_timestamp()))
 or not exists(select 1 from public.push_test_permits where id=permit_id and revoked and claim_id is null and operator_armed_at is null)
 then raise exception 'OPERATOR_NOT_READY';end if;
 update public.push_test_permits set revoked=false,operator_armed_at=clock_timestamp() where id=permit_id;
 update public.push_controls set test_delivery_enabled=true,operator_permit_id=permit_id,
  operator_expires_at=clock_timestamp()+interval '60 seconds' where singleton returning vapid_public_key into key_value;
 if not public.push_test_allowed(permit_id,key_value) then raise exception 'OPERATOR_NOT_READY';end if;
 update public.push_controls set test_delivery_enabled=false where singleton;
 return true;
end $$;
revoke all on function public.arm_push_operator(uuid) from public,anon,authenticated,service_role;
create function public.inspect_push_operator(permit_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('endpoint',d.endpoint,'publicKey',d.vapid_public_key,'p256dh',d.p256dh,'auth',d.auth_key)
 from public.push_test_permits t join public.push_devices d on d.id=t.device_id and d.user_id=t.user_id
 join public.push_controls c on c.singleton
 where t.id=permit_id and t.revoked and t.claim_id is null and t.operator_armed_at is null
 and t.expires_at>clock_timestamp() and c.registration_test_user_id=t.user_id
$$;
revoke all on function public.inspect_push_operator(uuid) from public,anon,authenticated,service_role;
grant execute on function public.inspect_push_operator(uuid) to service_role;
commit;
