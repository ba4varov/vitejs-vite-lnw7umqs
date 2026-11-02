-- Proposed only. No gate, membership, device, consent or VAPID mutations.
begin;
create function public.push_session_permit(action text,actor_id uuid,permit_id uuid,confirmation text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 -- Same lock order as the operator gate; scope check and arm share one transaction.
 perform 1 from public.push_controls where singleton for update;
 if not public.push_operator_access(actor_id) then return false;end if;
 perform 1 from public.push_test_permits t join public.push_devices d on d.id=t.device_id
 where t.id=permit_id and t.approved_by=actor_id and t.user_id=actor_id and d.user_id=actor_id
 and t.device_id='5ff76543-ea64-4721-9846-3859621e954f'::uuid for update of t,d;
 if not found then return false;end if;
 if action='arm' then return public.arm_push_operator(actor_id,permit_id,confirmation);
 elsif action='cancel' then return public.cancel_push_operator(actor_id,permit_id);
 end if;
 return false;
end $$;
-- Actor is supplied exclusively by the server after Auth /user verification.
-- Browser roles cannot invoke this privileged adapter or read the permit table.
revoke all on function public.push_session_permit(text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.push_session_permit(text,uuid,uuid,text) to service_role;
commit;
