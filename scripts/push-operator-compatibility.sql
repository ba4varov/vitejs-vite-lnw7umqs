-- Read-only schema contract check in Supabase SQL Editor before reviewed rollout.
-- No project secrets, device rows, keys, subscriptions or account data are returned.
begin read only;
do $$
declare signature text; item text; parts text[];
begin
 foreach signature in array array[
  'public.push_test_allowed(uuid,text)','public.claim_push_test(uuid,text)',
  'public.authorize_push_test(uuid,uuid,text)','public.finish_push_test(uuid,uuid,text,integer)',
  'public.my_push(jsonb)','public.is_meteo_admin()'] loop
  if to_regprocedure(signature) is null then raise exception 'PUSH_SCHEMA_FUNCTION_MISSING: %',signature;end if;
 end loop;
 foreach item in array array[
  'push_controls.singleton','push_controls.test_delivery_enabled','push_controls.vapid_public_key','push_controls.next_test_after',
  'push_devices.id','push_devices.user_id','push_devices.endpoint','push_devices.p256dh','push_devices.auth_key','push_devices.updated_at','push_devices.vapid_public_key','push_devices.subscription_expires_at',
  'push_preferences.user_id','push_preferences.enabled','push_preferences.updated_at','push_preferences.categories','push_preferences.cities',
  'push_test_permits.id','push_test_permits.approved_by','push_test_permits.device_revision','push_test_permits.preferences_revision','push_test_permits.claim_id','push_test_permits.revoked',
  'push_deliveries.event_key','push_deliveries.state','admin_memberships.user_id','subscriptions.plan','subscriptions.status'] loop
  parts:=string_to_array(item,'.');
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=parts[1] and column_name=parts[2])
  then raise exception 'PUSH_SCHEMA_COLUMN_MISSING: %',item;end if;
 end loop;
 if not has_function_privilege('service_role','public.claim_push_test(uuid,text)','execute')
  or has_function_privilege('authenticated','public.claim_push_test(uuid,text)','execute')
  or has_table_privilege('authenticated','public.push_test_permits','INSERT')
  or has_table_privilege('service_role','public.push_devices','SELECT')
 then raise exception 'PUSH_SCHEMA_GRANTS_MISMATCH';end if;
end $$;
select 'PUSH_SCHEMA_CONTRACT_OK' as result;
rollback;
