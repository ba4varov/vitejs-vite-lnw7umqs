-- Stage 6G-B. MANUAL REVIEW ONLY. No secrets, permits, opt-in, delivery or Cron enabled.
begin;
alter table public.push_controls
 add column test_delivery_enabled boolean not null default false,
 add column registration_test_user_id uuid references auth.users(id) on delete set null,
 add column vapid_public_key text check(vapid_public_key ~ '^[A-Za-z0-9_-]{87}$'),
 add column next_test_after timestamptz not null default '-infinity';
alter table public.push_devices
 add column vapid_public_key text,
 add column subscription_expires_at timestamptz;

-- Preserve the reviewed contract behind a wrapper; remove every external grant.
alter function public.my_push(jsonb) rename to my_push_v1_internal;
revoke all on function public.my_push_v1_internal(jsonb) from public,anon,authenticated,service_role;
create function public.my_push(payload jsonb default '{"operation":"load"}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; key_value text; allowed_user uuid; expiration_value numeric;
begin
 if payload->>'operation'='register' then
  select vapid_public_key,registration_test_user_id into key_value,allowed_user from public.push_controls where singleton for share;
  if auth.uid() is null or allowed_user is distinct from auth.uid() then raise insufficient_privilege;end if;
  if key_value is null or jsonb_typeof(payload->'vapidPublicKey') is distinct from 'string'
   or payload->>'vapidPublicKey'<>key_value then raise exception 'PUSH_KEY_MISMATCH';end if;
  if payload->'subscription' ? 'expirationTime' and payload->'subscription'->'expirationTime'<>'null'::jsonb then
   if jsonb_typeof(payload->'subscription'->'expirationTime') is distinct from 'number' then raise invalid_parameter_value;end if;
   expiration_value:=(payload->'subscription'->>'expirationTime')::numeric;
   if expiration_value<=extract(epoch from clock_timestamp())*1000 or expiration_value>253402300799000 then raise invalid_parameter_value;end if;
  end if;
  result:=public.my_push_v1_internal(payload-'vapidPublicKey');
  update public.push_devices set vapid_public_key=key_value,
   subscription_expires_at=case when expiration_value is null then null else to_timestamp((expiration_value/1000)::double precision) end
   where user_id=auth.uid() and endpoint=payload->'subscription'->>'endpoint';
 else
  result:=public.my_push_v1_internal(payload);
 end if;
 return result||jsonb_build_object('registrationPublicKey',(select vapid_public_key from public.push_controls where singleton and registration_enabled and registration_test_user_id=auth.uid()));
end $$;
revoke all on function public.my_push(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.my_push(jsonb) to authenticated;

create table public.push_test_permits (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid not null references public.push_devices(id) on delete cascade,
 approved_by uuid not null references auth.users(id) on delete cascade,
 device_revision timestamptz not null,
 preferences_revision timestamptz not null,
 category text not null check(category in ('rain','storm','wind','cold','heat','walk','garden','sport')),
 language text not null default 'bg' check(language in ('bg','en')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 claim_id uuid,
 claimed_at timestamptz,
 revoked boolean not null default false
);
alter table public.push_test_permits enable row level security;
alter table public.push_test_permits force row level security;
revoke all on public.push_test_permits from public,anon,authenticated,service_role;

-- Internal predicate: called only while reservation/gate locks are held.
create function public.push_test_allowed(permit_id uuid,key_public text) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.push_test_permits t
  join public.push_devices d on d.id=t.device_id and d.user_id=t.user_id
  join public.push_preferences p on p.user_id=t.user_id
  join auth.users u on u.id=t.user_id
  join public.subscriptions s on s.user_id=t.user_id
  join public.admin_memberships a on a.user_id=t.approved_by
  join auth.users approver on approver.id=a.user_id
  join public.push_controls c on c.singleton
  where t.id=permit_id and not t.revoked and t.expires_at>clock_timestamp()
   and c.test_delivery_enabled and c.vapid_public_key=key_public and d.vapid_public_key=key_public
   and d.updated_at=t.device_revision and p.updated_at=t.preferences_revision
   and (d.subscription_expires_at is null or d.subscription_expires_at>clock_timestamp())
   and p.enabled and jsonb_array_length(p.cities)>0 and t.category=any(p.categories)
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and (to_jsonb(u)->>'deleted_at') is null
   and (approver.banned_until is null or approver.banned_until<=clock_timestamp())
   and (to_jsonb(approver)->>'deleted_at') is null
   and s.status='active' and s.plan in ('free','pro')
   and (s.plan='pro' or not p.categories && array['walk','garden','sport']::text[]))
$$;
revoke all on function public.push_test_allowed(uuid,text) from public,anon,authenticated,service_role;

create function public.claim_push_test(permit_id uuid,key_public text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.push_test_permits; result jsonb; claim uuid:=gen_random_uuid();
begin
 -- Serialize all tests globally: at most one new attempt/minute, with provider cooldown.
 perform 1 from public.push_controls where singleton and test_delivery_enabled and next_test_after<=clock_timestamp() for update;
 if not found then return null;end if;
 select * into t from public.push_test_permits where id=permit_id for update;
 if not found or t.claim_id is not null or not public.push_test_allowed(permit_id,key_public) then return null;end if;
 insert into public.push_deliveries(device_id,event_key,state,expires_at)
  values(t.device_id,'test:'||permit_id::text,'reserved',t.expires_at) on conflict do nothing;
 if not found then return null;end if;
 update public.push_test_permits set claim_id=claim,claimed_at=clock_timestamp() where id=permit_id;
 update public.push_controls set next_test_after=clock_timestamp()+interval '1 minute' where singleton;
 select jsonb_build_object('claimId',claim,'endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth_key,
  'publicKey',d.vapid_public_key,'language',t.language) into result from public.push_devices d where d.id=t.device_id;
 return result;
end $$;

create function public.authorize_push_test(permit_id uuid,claim_id uuid,key_public text) returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.push_test_permits;
begin
 perform 1 from public.push_controls where singleton for update;
 select * into t from public.push_test_permits where id=permit_id for update;
 if not found or t.claim_id is distinct from claim_id or t.claimed_at<clock_timestamp()-interval '30 seconds'
  or not public.push_test_allowed(permit_id,key_public) then return false;end if;
 update public.push_deliveries set state='uncertain' where device_id=t.device_id and event_key='test:'||permit_id::text and state='reserved';
 return found; -- Atomically burn the authorization before the irreversible network request.
end $$;

create function public.finish_push_test(permit_id uuid,claim_id uuid,outcome text,retry_seconds integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare t public.push_test_permits;
begin
 if outcome is null or outcome not in ('sent','expired','failed','throttled','invalid') then raise invalid_parameter_value;end if;
 perform 1 from public.push_controls where singleton for update;
 select * into t from public.push_test_permits where id=permit_id for update;
 if not found or t.claim_id is distinct from claim_id then raise insufficient_privilege;end if;
 update public.push_deliveries set state=case when outcome='sent' then 'sent' when outcome in ('expired','invalid') then 'expired' else 'failed' end
  where device_id=t.device_id and event_key='test:'||permit_id::text and state=case when outcome='invalid' then 'reserved' else 'uncertain' end;
 if not found then return;end if;
 if outcome='throttled' then
  if retry_seconds is null or retry_seconds>31536000 then
   update public.push_controls set test_delivery_enabled=false where singleton;
  else
   update public.push_controls set next_test_after=greatest(next_test_after,clock_timestamp()+make_interval(secs=>greatest(60,retry_seconds))) where singleton;
  end if;
 end if;
 if outcome in ('expired','invalid') then
  -- A newer re-registration is protected. Deletion cascades permit + device ledger.
  delete from public.push_devices where id=t.device_id and user_id=t.user_id and updated_at=t.device_revision;
 end if;
end $$;
revoke all on function public.claim_push_test(uuid,text),public.authorize_push_test(uuid,uuid,text),public.finish_push_test(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_push_test(uuid,text),public.authorize_push_test(uuid,uuid,text),public.finish_push_test(uuid,uuid,text,integer) to service_role;
commit;
