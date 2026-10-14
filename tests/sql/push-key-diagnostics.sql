-- Synthetic data only. Run inside a disposable local database; always roll back.
begin;
insert into auth.users(id,email) values('f0000000-0000-0000-0000-000000000001','key-owner@example.invalid'),('f0000000-0000-0000-0000-000000000002','key-other@example.invalid');
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label) values(
 'f0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/key-diagnostic-fixture','7c3f9e51d0ff4ab4403656ee0821c970c8f87734179c9d2659651fe2d357058a',
 'BHzyexiNA09-ilI4AwS1GsPAiWnid_IbNaYLSPxHZpl4B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E','AQEBAQEBAQEBAQEBAQEBAQ','Synthetic keys');
create temp table key_diagnostic_before as select to_jsonb(d) as data from public.push_devices d;
create temp table key_controls_before as select to_jsonb(c) as data from public.push_controls c;
create temp table key_preferences_before as select to_jsonb(p) as data from public.push_preferences p;
create temp table key_deliveries_before as select to_jsonb(d) as data from public.push_deliveries d;
set local role authenticated;
set local request.jwt.claim.sub='f0000000-0000-0000-0000-000000000001';
do $$ declare r jsonb; fp text:='7c3f9e51d0ff4ab4403656ee0821c970c8f87734179c9d2659651fe2d357058a';
 pp text:='9b920d5b4e1acf4dd4b2b3e2881165f4c550a8d26a4199780f6f12ce6e6e5dd9';
 ap text:='466f8ba226b371415367ee41aba5ccf6d7544b29cee16f42bf03c74a3036a5d4';
 did uuid:='f0000000-0000-0000-0000-000000000003'; unavailable jsonb:='{"p256dh":"unavailable","auth":"unavailable"}';
 begin
 -- Expected proofs generated independently using Node P-256 test fixtures + SHA-256.
 r:=public.check_my_push_keys(did,fp,repeat('1',64),pp,ap);
 if r<>'{"p256dh":"match","auth":"match"}'::jsonb then raise exception 'cross-language match failed: %',r;end if;
 r:=public.check_my_push_keys(did,fp,repeat('1',64),repeat('0',64),ap);
 if r<>'{"p256dh":"mismatch","auth":"match"}'::jsonb then raise exception 'p256dh mismatch';end if;
 r:=public.check_my_push_keys(did,fp,repeat('1',64),pp,repeat('0',64));
 if r<>'{"p256dh":"match","auth":"mismatch"}'::jsonb then raise exception 'auth mismatch';end if;
 r:=public.check_my_push_keys(did,fp,repeat('2',64),pp,ap);
 if r<>'{"p256dh":"mismatch","auth":"mismatch"}'::jsonb then raise exception 'nonce binding';end if;
 if public.check_my_push_keys(did,fp,repeat('1',64),'missing','unavailable')<>'{"p256dh":"missing","auth":"unavailable"}'::jsonb then raise exception 'browser missing/unavailable';end if;
 if public.check_my_push_keys(did,repeat('0',64),repeat('1',64),pp,ap)<>unavailable then raise exception 'fingerprint gate';end if;
 if public.check_my_push_keys('f0000000-0000-0000-0000-000000000009',fp,repeat('1',64),pp,ap)<>unavailable then raise exception 'unknown device';end if;
 if public.check_my_push_keys(did,fp,'short',pp,ap)<>unavailable then raise exception 'invalid nonce';end if;
 if public.check_my_push_keys(did,fp,repeat('1',64),'raw-key',ap)<>unavailable then raise exception 'invalid proof';end if;
 perform set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-000000000002',true);
 if public.check_my_push_keys(did,fp,repeat('1',64),pp,ap)<>unavailable then raise exception 'foreign device leaked';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.check_my_push_keys(did,fp,repeat('1',64),pp,ap);raise exception 'missing session accepted';exception when insufficient_privilege then null;end;
 begin perform public.push_key_proof_status('raw','raw',''::bytea,16);raise exception 'helper exposed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.push_devices;raise exception 'direct table exposed';exception when insufficient_privilege then null;end;
 end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.check_my_push_keys(uuid,text,text,text,text)','execute') or has_function_privilege('service_role','public.check_my_push_keys(uuid,text,text,text,text)','execute') then raise exception 'RPC grant too broad';end if;
 if has_function_privilege('authenticated','public.push_key_proof_status(text,text,bytea,integer)','execute') then raise exception 'helper grant';end if;
 if exists((select to_jsonb(d) from public.push_devices d except select data from key_diagnostic_before) union all (select data from key_diagnostic_before except select to_jsonb(d) from public.push_devices d)) then raise exception 'device changed';end if;
 if exists((select to_jsonb(c) from public.push_controls c except select data from key_controls_before) union all (select data from key_controls_before except select to_jsonb(c) from public.push_controls c)) then raise exception 'controls changed';end if;
 if exists((select to_jsonb(p) from public.push_preferences p except select data from key_preferences_before) union all (select data from key_preferences_before except select to_jsonb(p) from public.push_preferences p)) then raise exception 'preferences changed';end if;
 if exists((select to_jsonb(d) from public.push_deliveries d except select data from key_deliveries_before) union all (select data from key_deliveries_before except select to_jsonb(d) from public.push_deliveries d)) then raise exception 'deliveries changed';end if;
 end $$;
-- Stored missing/malformed material and banned users fail safely.
update public.push_devices set p256dh='',auth_key='invalid' where id='f0000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub='f0000000-0000-0000-0000-000000000001';
do $$ begin
 if public.check_my_push_keys('f0000000-0000-0000-0000-000000000003','7c3f9e51d0ff4ab4403656ee0821c970c8f87734179c9d2659651fe2d357058a',repeat('1',64),repeat('0',64),repeat('0',64))<>'{"p256dh":"missing","auth":"unavailable"}'::jsonb then raise exception 'stored missing/malformed';end if;
end $$;
reset role;
update auth.users set banned_until=now()+interval '1 hour' where id='f0000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.check_my_push_keys('f0000000-0000-0000-0000-000000000003',repeat('0',64),repeat('1',64),repeat('0',64),repeat('0',64));raise exception 'banned accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: key proof vectors, isolation, authentication, grants, missing data and read-only snapshots';
