-- Proposed only: defaults closed; never selects a real device or enables delivery.
begin;
alter table public.push_controls add column session_target_device_id uuid
 references public.push_devices(id) on delete set null;
alter table public.push_test_permits add column session_scoped boolean not null default false;

create function public.push_session_target(actor_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('deviceId',d.id,'userId',d.user_id,'label',d.label)
 from public.push_controls c join public.push_devices d on d.id=c.session_target_device_id
 where c.singleton and d.user_id=actor_id and c.operator_admin_id=actor_id
 and public.push_operator_access(actor_id)
$$;

create function public.push_session_scope(actor_id uuid,permit_id uuid,target_device uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.push_controls c
 join public.push_test_permits t on t.id=permit_id
 join public.push_devices d on d.id=t.device_id
 where c.singleton and c.session_target_device_id=target_device and t.device_id=target_device
 and t.session_scoped and t.approved_by=actor_id and t.user_id=actor_id and d.user_id=actor_id
 and c.operator_admin_id=actor_id and public.push_operator_access(actor_id))
$$;

-- Recheck the current target at claim AND final authorization, including changes after arm.
-- Legacy operator permits retain their existing independent restrictions.
alter function public.push_test_allowed(uuid,text) rename to push_test_allowed_before_session_target;
revoke all on function public.push_test_allowed_before_session_target(uuid,text) from public,anon,authenticated,service_role;
create function public.push_test_allowed(permit_id uuid,key_public text) returns boolean
language sql volatile security definer set search_path='' as $$
 select public.push_test_allowed_before_session_target(permit_id,key_public)
 and exists(select 1 from public.push_test_permits t where t.id=permit_id
 and (not t.session_scoped or public.push_session_scope(t.approved_by,t.id,t.device_id)))
$$;
revoke all on function public.push_test_allowed(uuid,text) from public,anon,authenticated,service_role;

create function public.prepare_push_session(actor_id uuid,test_category text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target_id uuid; result jsonb;
begin
 perform 1 from public.push_controls where singleton for update;
 target_id:=(public.push_session_target(actor_id)->>'deviceId')::uuid;
 if target_id is null then raise insufficient_privilege;end if;
 result:=public.prepare_push_operator(actor_id,actor_id,target_id,test_category,request_id);
 update public.push_test_permits set session_scoped=true where id=(result->>'permitId')::uuid;
 return result;
end $$;

create or replace function public.push_session_permit(action text,actor_id uuid,permit_id uuid,confirmation text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
 -- Same lock order as the operator gate; scope check and arm share one transaction.
 perform 1 from public.push_controls where singleton for update;
 if not public.push_operator_access(actor_id) then return false;end if;
 -- Owned session preparations can always be cancelled, even after target revocation.
 perform 1 from public.push_test_permits t join public.push_devices d on d.id=t.device_id
 where t.id=permit_id and t.session_scoped and t.approved_by=actor_id
 and t.user_id=actor_id and d.user_id=actor_id for update of t,d;
 if not found then return false;end if;
 if action='cancel' then return public.cancel_push_operator(actor_id,permit_id);end if;
 target_id:=(public.push_session_target(actor_id)->>'deviceId')::uuid;
 if action='arm' and public.push_session_scope(actor_id,permit_id,target_id) then
  return public.arm_push_operator(actor_id,permit_id,confirmation);
 end if;
 return false;
end $$;

-- Burn the selected target as well as the permit before returning to the sender.
alter function public.authorize_push_test(uuid,uuid,text) rename to authorize_push_test_before_session_target;
revoke all on function public.authorize_push_test_before_session_target(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.authorize_push_test(permit_id uuid,claim_id uuid,key_public text) returns boolean
language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
 perform 1 from public.push_controls where singleton for update;
 allowed:=public.authorize_push_test_before_session_target(permit_id,claim_id,key_public);
 if exists(select 1 from public.push_test_permits t where t.id=permit_id and t.session_scoped) then
  update public.push_controls set session_target_device_id=null where singleton;
 end if;
 return allowed;
end $$;

revoke all on function public.push_session_target(uuid),public.push_session_scope(uuid,uuid,uuid),
 public.prepare_push_session(uuid,text,uuid),public.push_session_permit(text,uuid,uuid,text),
 public.authorize_push_test(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.push_session_target(uuid),public.push_session_scope(uuid,uuid,uuid),
 public.prepare_push_session(uuid,text,uuid),public.push_session_permit(text,uuid,uuid,text),
 public.authorize_push_test(uuid,uuid,text) to service_role;
commit;
