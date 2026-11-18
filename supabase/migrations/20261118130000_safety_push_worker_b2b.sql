-- B2b: privileged reads and terminal bookkeeping for a future shared worker.
-- This migration DOES NOT activate delivery, alter any gate or schedule jobs.
-- Manual review required before production migration. No production writes now.
begin;

do $$
begin
  if to_regclass('public.push_safety_controls') is null
     or to_regclass('public.earthquake_push_optins') is null
     or to_regprocedure('public.reserve_safety_push(uuid,jsonb)') is null
     or to_regprocedure('public.burn_safety_push(uuid)') is null
  then raise exception 'SAFETY_WORKER_REQUIRES_B1_B2A';end if;
end $$;

-- The HTTP worker cannot SELECT user devices/preferences directly because the
-- existing tables deny direct service_role grants and use FORCE RLS.
-- Only this privileged, bounded RPC can supply subscribed devices.
-- It is called only after the already installed gate is explicitly enabled.
create function public.safety_worker_targets(
  max_rows integer default 10,
  after_device uuid default null
) returns jsonb language plpgsql volatile security definer
set search_path='' as $$
declare
  answer jsonb;
begin
  if max_rows is null or max_rows<1 or max_rows>20
  then raise invalid_parameter_value;end if;

  if not exists(
    select 1 from public.push_safety_controls
    where singleton and delivery_enabled
  ) then return '[]'::jsonb;end if;

  select coalesce(jsonb_agg(row_content order by id),'[]'::jsonb)
  into answer from (
    select d.id,
      jsonb_build_object(
        'deviceId',d.id,
        'userId',d.user_id,
        'endpoint',d.endpoint,
        'p256dh',d.p256dh,
        'auth',d.auth_key,
        'publicKey',d.vapid_public_key,
        'expiresAt',case when d.subscription_expires_at is null
          then null else extract(epoch from d.subscription_expires_at)*1000 end,
        'weather',case when p.enabled then
          jsonb_build_object('enabled',true,'cities',p.cities,'categories',to_jsonb(p.categories))
          else null end,
        'earthquake',case when e.user_id is not null then
          jsonb_build_object('enabled',true,'city',e.city,
            'optedInAt',extract(epoch from e.opted_in_at)*1000)
          else null end
      ) as row_content
    from public.push_devices d
      join auth.users u on u.id=d.user_id
      left join public.push_preferences p on p.user_id=d.user_id
      left join public.earthquake_push_optins e on e.user_id=d.user_id
    where (after_device is null or d.id>after_device)
      and (coalesce(p.enabled,false) or e.user_id is not null)
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and u.deleted_at is null
      and (d.subscription_expires_at is null
        or d.subscription_expires_at>clock_timestamp())
      and exists (select 1 from public.push_controls ctrl
        where ctrl.singleton and d.vapid_public_key=ctrl.vapid_public_key)
    order by d.id
    limit max_rows
  ) selected;
  return answer;
end $$;
revoke all on function public.safety_worker_targets(integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.safety_worker_targets(integer,uuid)
  to service_role;

-- Optional terminal state update after a single provider response.
-- Unknown/timeouts stay 'uncertain' forever, never eligible for retry.
create function public.finish_safety_push(
  attempt uuid,
  result text
) returns boolean language plpgsql volatile security definer
set search_path='' as $$
declare status text;
begin
  if attempt is null or result is null or
     result not in ('provider_accepted','provider_rejected','subscription_expired')
  then return false;end if;
  status:=case result
    when 'provider_accepted' then 'sent'
    when 'provider_rejected' then 'failed'
    when 'subscription_expired' then 'expired'
  end;
  update public.push_deliveries
     set state=status
   where safety_attempt_id=attempt and state='uncertain';
  return found;
end $$;
revoke all on function public.finish_safety_push(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.finish_safety_push(uuid,text)
  to service_role;

commit;
