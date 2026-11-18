-- Draft migration only. Do not apply to Production without separate approval.
-- Preserve the existing device ID (and any session-scoped test target), never
-- create a second row on browser subscription renewal. Registration gates remain OFF.
begin;

create function public.my_push_renew(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); p public.push_preferences; old_device public.push_devices;
 s jsonb; endpoint_value text; new_fp text; public_key text; test_user uuid;
 pro boolean; expiration_value numeric; remaining numeric;
begin
 if uid is null or not exists(
  select 1 from auth.users where id=uid and (banned_until is null or banned_until<=clock_timestamp())
 ) then raise insufficient_privilege;end if;

 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>12000
  or payload->>'operation' is distinct from 'renew'
  or (select count(*) from jsonb_object_keys(payload))<>6
  or exists(select 1 from jsonb_object_keys(payload) k
    where k not in ('operation','deviceId','fingerprint','subscription','label','vapidPublicKey'))
 then raise invalid_parameter_value;end if;

 -- This route is for the single existing registration-test owner only. Keep
 -- the original DB+Vercel registration gates and the same server VAPID key.
 select c.vapid_public_key,c.registration_test_user_id
 into public_key,test_user from public.push_controls c
 where c.singleton and c.registration_enabled for update;
 if not found or test_user is distinct from uid then raise insufficient_privilege;end if;
 if public_key is null or jsonb_typeof(payload->'vapidPublicKey') is distinct from 'string'
  or payload->>'vapidPublicKey'<>public_key then raise exception 'PUSH_KEY_MISMATCH';end if;

 if jsonb_typeof(payload->'deviceId') is distinct from 'string'
  or payload->>'deviceId' !~ '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'
  or jsonb_typeof(payload->'fingerprint') is distinct from 'string'
  or payload->>'fingerprint' !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(payload->'label') is distinct from 'string'
  or length(trim(payload->>'label')) not between 1 and 80
 then raise invalid_parameter_value;end if;

 select * into old_device from public.push_devices
 where id=(payload->>'deviceId')::uuid and user_id=uid for update;
 if not found or old_device.fingerprint is distinct from payload->>'fingerprint'
  or old_device.vapid_public_key is distinct from public_key then raise insufficient_privilege;end if;

 select * into p from public.push_preferences where user_id=uid for update;
 if not found or not p.enabled or cardinality(p.categories)=0
  or jsonb_array_length(p.cities)=0 then raise invalid_parameter_value;end if;
 select exists(select 1 from public.get_my_entitlements() e
  where e.plan='pro' and 'planner:advanced'=any(e.permissions)) into pro;
 if not pro and p.categories && array['walk','garden','sport']::text[] then raise insufficient_privilege;end if;

 -- Same strict subscription grammar as the existing register operation.
 s:=payload->'subscription';
 if jsonb_typeof(s) is distinct from 'object' or
  exists(select 1 from jsonb_object_keys(s) k where k not in ('endpoint','keys','expirationTime'))
  or jsonb_typeof(s->'endpoint') is distinct from 'string'
  or length(s->>'endpoint')>2048 then raise invalid_parameter_value;end if;
 endpoint_value:=s->>'endpoint';
 if not (endpoint_value ~ '^https://fcm\.googleapis\.com/(fcm/send|wp)/[A-Za-z0-9_:-]+$'
  or endpoint_value ~ '^https://web\.push\.apple\.com/[A-Za-z0-9_-]+$'
  or endpoint_value ~ '^https://[a-z0-9-]+\.notify\.windows\.com/w/\?token=[A-Za-z0-9_%.-]+$'
  or endpoint_value ~ '^https://updates\.push\.services\.mozilla\.com/wpush/v2/[A-Za-z0-9_-]+$')
 then raise invalid_parameter_value;end if;
 if jsonb_typeof(s->'keys') is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(s->'keys') k where k not in ('p256dh','auth'))
  or jsonb_typeof(s->'keys'->'p256dh') is distinct from 'string'
  or jsonb_typeof(s->'keys'->'auth') is distinct from 'string'
  or s->'keys'->>'p256dh' !~ '^[A-Za-z0-9_-]{87}$'
  or s->'keys'->>'auth' !~ '^[A-Za-z0-9_-]{22}$'
  or get_byte(decode(translate(s->'keys'->>'p256dh','-_','+/')||'=','base64'),0)<>4
 then raise invalid_parameter_value;end if;
 if s ? 'expirationTime' and s->'expirationTime'<>'null'::jsonb then
  if jsonb_typeof(s->'expirationTime') is distinct from 'number' then raise invalid_parameter_value;end if;
  expiration_value:=(s->>'expirationTime')::numeric;
  if expiration_value<=extract(epoch from clock_timestamp())*1000
    or expiration_value>253402300799000 then raise invalid_parameter_value;end if;
 end if;

 new_fp:=encode(sha256(convert_to(endpoint_value,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(new_fp,6));
 if exists(select 1 from public.push_devices d
  where d.fingerprint=new_fp and d.id<>old_device.id) then raise invalid_parameter_value;end if;

 remaining:=least(20,p.tokens+greatest(0,extract(epoch from clock_timestamp()-p.refilled_at))/3);
 if remaining<1 then raise exception 'PUSH_RATE_LIMITED';end if;
 update public.push_preferences set tokens=remaining-1,refilled_at=clock_timestamp()
 where user_id=uid;

 update public.push_devices set
  endpoint=endpoint_value,fingerprint=new_fp,
  p256dh=s->'keys'->>'p256dh',auth_key=s->'keys'->>'auth',
  label=trim(payload->>'label'),vapid_public_key=public_key,
  subscription_expires_at=case when expiration_value is null then null
   else to_timestamp((expiration_value/1000)::double precision) end,
  updated_at=clock_timestamp()
 where id=old_device.id and user_id=uid;
 if not found then raise insufficient_privilege;end if;

 -- Existing permits become invalid because the device revision changed. The
 -- session target still points to the *same ID*, rather than a stale row.
 return public.my_push('{"operation":"load"}'::jsonb);
end $$;

revoke all on function public.my_push_renew(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.my_push_renew(jsonb) to authenticated;
commit;
