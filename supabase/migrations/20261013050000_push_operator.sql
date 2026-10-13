-- Proposed rollout over the existing Production push schema. Apply only after review.
-- No device/preferences/VAPID changes; selected operator defaults to no access.
begin;
alter table public.push_test_permits add column operator_armed_at timestamptz,
 add column operator_request_id uuid unique;
alter table public.push_controls add column operator_permit_id uuid,
 add column operator_expires_at timestamptz,
 add column operator_admin_id uuid references auth.users(id) on delete set null,
 add column operator_paused boolean not null default false;

create function public.push_operator_access(actor_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.push_controls c
 join public.admin_memberships a on a.user_id=c.operator_admin_id
 join auth.users u on u.id=a.user_id
 where c.singleton and not c.operator_paused and a.user_id=actor_id
 and (u.banned_until is null or u.banned_until<=clock_timestamp())
 and (to_jsonb(u)->>'deleted_at') is null)
$$;
revoke all on function public.push_operator_access(uuid) from public,anon,authenticated,service_role;
grant execute on function public.push_operator_access(uuid) to service_role;

alter function public.push_test_allowed(uuid,text) rename to push_test_allowed_v1_internal;
revoke all on function public.push_test_allowed_v1_internal(uuid,text) from public,anon,authenticated,service_role;
create function public.push_test_allowed(permit_id uuid,key_public text) returns boolean
language sql volatile security definer set search_path='' as $$
 select public.push_test_allowed_v1_internal(permit_id,key_public)
 and exists(select 1 from public.push_controls c join public.push_test_permits t on t.id=permit_id
 where c.singleton and c.operator_permit_id=t.id and c.operator_expires_at>clock_timestamp()
 and t.approved_by=c.operator_admin_id and t.operator_request_id is not null
 and public.push_operator_access(t.approved_by))
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
 perform public.close_push_operator(permit_id); -- Burn and close BEFORE provider POST.
 return allowed;
end $$;
revoke all on function public.authorize_push_test(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.authorize_push_test(uuid,uuid,text) to service_role;

alter function public.finish_push_test(uuid,uuid,text,integer) rename to finish_push_test_v1_internal;
revoke all on function public.finish_push_test_v1_internal(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
create function public.finish_push_test(permit_id uuid,claim_id uuid,outcome text,retry_seconds integer default 0) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.finish_push_test_v1_internal(permit_id,claim_id,outcome,retry_seconds);
 -- The old indefinite 429 stop must also disable the new scoped mode.
 if outcome='throttled' and (retry_seconds is null or retry_seconds>31536000) then
  update public.push_controls set operator_paused=true where singleton;
 end if;
end $$;
revoke all on function public.finish_push_test(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.finish_push_test(uuid,uuid,text,integer) to service_role;

-- Service-role-only: actor_id comes from Auth /user verification on Edge, never client input.
create function public.prepare_push_operator(actor_id uuid,target_user uuid,target_device uuid,test_category text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result uuid; key_value text; t public.push_test_permits;
begin
 perform 1 from public.push_controls where singleton for update;
 if not public.push_operator_access(actor_id) then raise insufficient_privilege;end if;
 if request_id is null or not exists(select 1 from public.push_controls where singleton and not test_delivery_enabled
  and next_test_after<=clock_timestamp() and (operator_permit_id is null or operator_expires_at<=clock_timestamp()))
 then raise exception 'OPERATOR_NOT_READY';end if;
 select * into t from public.push_test_permits where operator_request_id=request_id;
 if found then
  if t.approved_by<>actor_id or t.user_id<>target_user or t.device_id<>target_device or t.category<>test_category
   or t.expires_at<=clock_timestamp() or t.operator_armed_at is not null then raise exception 'OPERATOR_NOT_READY';end if;
  result:=t.id;
 else
  insert into public.push_test_permits(user_id,device_id,approved_by,device_revision,preferences_revision,category,expires_at,operator_request_id)
  select d.user_id,d.id,actor_id,d.updated_at,p.updated_at,test_category,clock_timestamp()+interval '2 minutes',request_id
  from public.push_devices d join public.push_preferences p on p.user_id=d.user_id
  where d.id=target_device and d.user_id=target_user returning id into result;
  if result is null then raise exception 'OPERATOR_NOT_READY';end if;
 end if;
 -- Even an idempotent preparation rechecks current consent/revisions/rights.
 select vapid_public_key into key_value from public.push_controls where singleton;
 update public.push_test_permits set revoked=false where id=result;
 update public.push_controls set test_delivery_enabled=true,operator_permit_id=result,
  operator_expires_at=clock_timestamp()+interval '60 seconds' where singleton;
 if not public.push_test_allowed(result,key_value) then raise exception 'OPERATOR_NOT_READY';end if;
 update public.push_controls set test_delivery_enabled=false,operator_permit_id=null,operator_expires_at=null where singleton;
 update public.push_test_permits set revoked=true where id=result;
 return (select jsonb_build_object('permitId',id,'userId',user_id,'deviceId',device_id,'category',category,'expiresAt',expires_at)
  from public.push_test_permits where id=result);
end $$;
revoke all on function public.prepare_push_operator(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_push_operator(uuid,uuid,uuid,text,uuid) to service_role;

create function public.arm_push_operator(actor_id uuid,permit_id uuid,confirmation text) returns boolean
language plpgsql security definer set search_path='' as $$
declare key_value text; t public.push_test_permits;
begin
 perform 1 from public.push_controls where singleton for update;
 if not public.push_operator_access(actor_id) then raise insufficient_privilege;end if;
 select * into t from public.push_test_permits where id=permit_id for update;
 if not found or t.approved_by<>actor_id or t.operator_request_id is null or not t.revoked
  or t.claim_id is not null or t.operator_armed_at is not null
  or confirmation is distinct from ('SEND ONE '||t.user_id::text||' '||t.device_id::text)
  or not exists(select 1 from public.push_controls where singleton and not test_delivery_enabled
   and next_test_after<=clock_timestamp() and (operator_permit_id is null or operator_expires_at<=clock_timestamp()))
 then raise exception 'OPERATOR_NOT_READY';end if;
 update public.push_test_permits set revoked=false,operator_armed_at=clock_timestamp() where id=permit_id;
 update public.push_controls set test_delivery_enabled=true,operator_permit_id=permit_id,
  operator_expires_at=clock_timestamp()+interval '60 seconds' where singleton returning vapid_public_key into key_value;
 if not public.push_test_allowed(permit_id,key_value) then raise exception 'OPERATOR_NOT_READY';end if;
 update public.push_controls set test_delivery_enabled=false where singleton;
 return true;
end $$;
revoke all on function public.arm_push_operator(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.arm_push_operator(uuid,uuid,text) to service_role;

create function public.inspect_push_operator(actor_id uuid,permit_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('endpoint',d.endpoint,'publicKey',d.vapid_public_key,'p256dh',d.p256dh,'auth',d.auth_key)
 from public.push_test_permits t join public.push_devices d on d.id=t.device_id and d.user_id=t.user_id
 where t.id=permit_id and t.approved_by=actor_id and public.push_operator_access(actor_id)
 and t.revoked and t.claim_id is null and t.operator_armed_at is null and t.operator_request_id is not null
 and t.expires_at>clock_timestamp()
$$;
revoke all on function public.inspect_push_operator(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inspect_push_operator(uuid,uuid) to service_role;

create function public.cancel_push_operator(actor_id uuid,permit_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.push_controls where singleton for update;
 if not exists(select 1 from public.push_test_permits where id=permit_id and approved_by=actor_id)
 then raise insufficient_privilege;end if;
 perform public.close_push_operator(permit_id);
 -- Cancellation consumes even an unarmed preparation; cannot later confirm it.
 update public.push_test_permits set operator_armed_at=coalesce(operator_armed_at,clock_timestamp()) where id=permit_id;
 return true;
end $$;
revoke all on function public.cancel_push_operator(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_push_operator(uuid,uuid) to service_role;
-- Reviewed rollout closes the obsolete global test mode; no enabling operation.
update public.push_controls set test_delivery_enabled=false where singleton;
commit;
