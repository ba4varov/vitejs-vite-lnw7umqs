-- Disposable PostgreSQL only. All data/gates roll back. No HTTP or schedules.
begin;
insert into auth.users(id,email) values
 ('d0000000-0000-0000-0000-000000000001','weather-free@example.invalid'),
 ('d0000000-0000-0000-0000-000000000002','weather-pro@example.invalid');
insert into public.push_preferences(user_id,enabled,cities,categories,language) values
 ('d0000000-0000-0000-0000-000000000001',true,'[{"name":"Sofia","latitude":42,"longitude":23,"zone":"UTC"}]','{wind,walk}','en');
update public.push_controls set vapid_public_key='B'||repeat('A',86);
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key) values
 ('d1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/weather-isolated',encode(sha256(convert_to('https://fcm.googleapis.com/wp/weather-isolated','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Weather isolated','B'||repeat('A',86));
set local role authenticated;
do $$ begin
 begin perform public.begin_weather_push('B'||repeat('A',86));raise exception 'user sender bypass';exception when insufficient_privilege then null;end;
 begin perform 1 from public.push_weather_jobs;raise exception 'user queue read';exception when insufficient_privilege then null;end;
 begin perform public.my_push_v2_internal();raise exception 'legacy test restriction bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin perform 1 from public.push_devices;raise exception 'service direct subscription access';exception when insufficient_privilege then null;end;
 begin perform public.push_weather_eligible('d0000000-0000-0000-0000-000000000001','wind');raise exception 'internal predicate access';exception when insufficient_privilege then null;end;
 if public.begin_weather_push('B'||repeat('A',86)) is not null then raise exception 'default-off gate';end if;
end $$;
reset role;
update public.push_controls set delivery_enabled=true;
do $$ declare r jsonb;run uuid;c text;cl jsonb;old_event uuid;a bigint;b bigint;new_device uuid;begin
 if public.begin_weather_push('wrong-key') is not null then raise exception 'wrong key';end if;
 r:=public.begin_weather_push('B'||repeat('A',86));run:=(r->>'runId')::uuid;c:=r->'cities'->0->>'key';
 if jsonb_array_length(r->'cities')<>1 then raise exception 'shared city selection';end if;
 if public.begin_weather_push('B'||repeat('A',86)) is not null then raise exception 'concurrent cycle';end if;
 a:=floor(extract(epoch from clock_timestamp())/3600)*3600000;b:=a+7200000;
 perform public.stage_weather_push(run,c,jsonb_build_array(jsonb_build_object('kind','wind','start',a,'end',b),jsonb_build_object('kind','walk','start',a+3600000,'end',b+3600000)));
 if (select count(*) from public.push_weather_jobs)<>1 then raise exception 'Free Pro recommendations';end if;
 cl:=public.claim_weather_push(run,'B'||repeat('A',86));
 if cl->>'language'<>'en' or cl->>'kind'<>'wind' or cl->'city'->>'name'<>'Sofia' then raise exception 'claim content/locale';end if;
 old_event:=(select event_id from public.push_weather_jobs where id=(cl->>'id')::uuid);
 -- Withdrawal immediately before irreversible send must win.
 update public.push_preferences set enabled=false where user_id='d0000000-0000-0000-0000-000000000001';
 if public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'withdrawal bypass';end if;
 update public.push_preferences set enabled=true where user_id='d0000000-0000-0000-0000-000000000001';
 if not public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'valid authorization';end if;
 if public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'double send authorization';end if;
 if (select state from public.push_weather_jobs where id=(cl->>'id')::uuid)<>'uncertain' then raise exception 'burn before POST';end if;
 perform public.finish_weather_push((cl->>'id')::uuid,(cl->>'claimId')::uuid,'sent',0);
 -- A rolling start, expanded period, or re-enrollment cannot duplicate the warning.
 perform public.stage_weather_push(run,c,jsonb_build_array(jsonb_build_object('kind','wind','start',a+3600000,'end',b+3600000)));
 if (select count(*) from public.push_weather_jobs)<>1 or (select count(*) from public.push_weather_events where kind='wind')<>1 then raise exception 'period dedupe';end if;
 if public.claim_weather_push(run,'B'||repeat('A',86)) is not null then raise exception 'repeat warning';end if;
 delete from public.push_devices where id='d1000000-0000-0000-0000-000000000001';
 insert into public.push_devices(user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key)
 values('d0000000-0000-0000-0000-000000000001','https://fcm.googleapis.com/wp/weather-isolated',encode(sha256(convert_to('https://fcm.googleapis.com/wp/weather-isolated','UTF8')),'hex'),'B'||repeat('A',86),repeat('A',22),'Re-enrolled','B'||repeat('A',86)) returning id into new_device;
 perform public.stage_weather_push(run,c,jsonb_build_array(jsonb_build_object('kind','wind','start',a,'end',b)));
 if (select count(*) from public.push_weather_jobs)<>1 then raise exception 're-enrollment replay';end if;
 -- Pro recommendations require a current active server-side subscription.
 update public.subscriptions set plan='pro' where user_id='d0000000-0000-0000-0000-000000000001';
 perform public.stage_weather_push(run,c,jsonb_build_array(jsonb_build_object('kind','walk','start',a+3600000,'end',b+3600000)));
 cl:=public.claim_weather_push(run,'B'||repeat('A',86));if cl->>'kind'<>'walk' then raise exception 'Pro claim';end if;
 update public.subscriptions set plan='free' where user_id='d0000000-0000-0000-0000-000000000001';
 if public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'downgrade send';end if;
 update public.subscriptions set plan='pro',status='canceled' where user_id='d0000000-0000-0000-0000-000000000001';
 if public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'inactive account send';end if;
 update public.subscriptions set status='active' where user_id='d0000000-0000-0000-0000-000000000001';
 update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='d0000000-0000-0000-0000-000000000001';
 if public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'banned user send';end if;
 update auth.users set banned_until=null where id='d0000000-0000-0000-0000-000000000001';
 update public.push_devices set updated_at=clock_timestamp() where id=new_device;
 if public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'device revision bypass';end if;
 -- Separate new hazard: expired subscriptions, then throttling with exact cooldown.
 perform public.stage_weather_push(run,c,jsonb_build_array(jsonb_build_object('kind','wind','start',b+7200000,'end',b+10800000)));
 cl:=public.claim_weather_push(run,'B'||repeat('A',86));if cl is null then raise exception 'new distinct period';end if;
 update public.push_devices set subscription_expires_at=clock_timestamp()-interval '1 second' where id=new_device;
 if public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'expired subscription';end if;
 update public.push_devices set subscription_expires_at=null where id=new_device;
 if not public.authorize_weather_push(run,(cl->>'id')::uuid,(cl->>'claimId')::uuid,'B'||repeat('A',86)) then raise exception 'throttle authorization';end if;
 perform public.finish_weather_push((cl->>'id')::uuid,(cl->>'claimId')::uuid,'throttled',123);
 if (select next_provider_at from public.push_controls)<clock_timestamp()+interval '120 seconds' then raise exception 'Retry-After';end if;
 if public.claim_weather_push(run,'B'||repeat('A',86)) is not null then raise exception 'provider cooldown';end if;
 perform public.end_weather_push(run);
 if public.begin_weather_push('B'||repeat('A',86)) is not null then raise exception 'cycle budget';end if;
 -- No arbitrary stage content, and an old run cannot continue after kill switch.
 update public.push_controls set next_cycle_at='-infinity',next_provider_at='-infinity';
 r:=public.begin_weather_push('B'||repeat('A',86));run:=(r->>'runId')::uuid;
 begin perform public.stage_weather_push(run,c,'[{"kind":"admin","start":0,"end":1}]');raise exception 'invalid forecast event';exception when invalid_parameter_value then null;end;
 update public.push_controls set delivery_enabled=false;
 if public.claim_weather_push(run,'B'||repeat('A',86)) is not null then raise exception 'kill switch';end if;
end $$;
-- Existing settings API: BG/EN persistence, Free/Pro enforcement, owner isolation.
set local request.jwt.claim.sub='d0000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ declare result jsonb;begin
 result:=public.my_push('{"operation":"settings","enabled":true,"cities":[{"name":"Sofia","latitude":42,"longitude":23,"zone":"UTC"}],"categories":["wind"],"language":"en"}');
 if result->>'language'<>'en' then raise exception 'language persistence';end if;
 if result->'registrationPublicKey'<>'null'::jsonb then raise exception 'population gate default';end if;
 begin perform public.my_push('{"operation":"settings","enabled":true,"cities":[],"categories":["wind"],"language":"fr"}');raise exception 'invalid language';exception when invalid_parameter_value then null;end;
end $$;
reset role;
rollback;
select 'PASS: weather dispatcher gates, RLS, forecasts, overlap/re-enrollment dedupe, ownership, current consent/Free/Pro, lease and provider cooldown';

begin;
insert into auth.users(id,email) values ('d3000000-0000-0000-0000-000000000001','enrollment@example.invalid');
set local request.jwt.claim.sub='d3000000-0000-0000-0000-000000000001';
update public.push_controls set vapid_public_key='B'||repeat('A',86),registration_enabled=true;
set local role authenticated;
select public.my_push('{"operation":"settings","enabled":true,"cities":[{"name":"Test","latitude":42,"longitude":23,"zone":"UTC"}],"categories":["wind"],"language":"en"}');
do $$ begin
 begin perform public.my_push(jsonb_build_object('operation','register','label','Test','vapidPublicKey','B'||repeat('A',86),'subscription',jsonb_build_object('endpoint','https://fcm.googleapis.com/wp/population','expirationTime',null,'keys',jsonb_build_object('p256dh','B'||repeat('A',86),'auth',repeat('A',22)))));raise exception 'population gate bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.push_controls set population_registration_enabled=true;
set local role authenticated;
do $$ declare result jsonb;begin
 result:=public.my_push(jsonb_build_object('operation','register','label','Test','vapidPublicKey','B'||repeat('A',86),'subscription',jsonb_build_object('endpoint','https://fcm.googleapis.com/wp/population','expirationTime',null,'keys',jsonb_build_object('p256dh','B'||repeat('A',86),'auth',repeat('A',22)))));
 if jsonb_array_length(result->'devices')<>1 or result->>'registrationPublicKey'<>'B'||repeat('A',86) then raise exception 'explicit population enrollment';end if;
 begin perform public.my_push(jsonb_build_object('operation','register','label','Test','vapidPublicKey','wrong','subscription','{}'::jsonb));raise exception 'key bypass';exception when others then if sqlerrm<>'PUSH_KEY_MISMATCH' then raise;end if;end;
end $$;
reset role;
-- Retain 5-city per-account limit and globally serialize admission, never arbitrary keepalive.
do $$ declare i integer;k integer;uid uuid;cities jsonb;begin
 for i in 1..4 loop
  uid:=('d4000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid;
  insert into auth.users(id,email) values(uid,'capacity-'||i||'@example.invalid');
  cities:='[]'::jsonb;
  for k in 1..5 loop cities:=cities||jsonb_build_array(jsonb_build_object('name','Capacity','latitude',i*10+k,'longitude',10,'zone','UTC'));end loop;
  insert into public.push_preferences(user_id,enabled,cities,categories) values(uid,true,cities,'{wind}');
 end loop;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.my_push('{"operation":"settings","enabled":true,"cities":[{"name":"New","latitude":42,"longitude":24,"zone":"UTC"}],"categories":["wind"]}');raise exception 'global capacity bypass';exception when others then if sqlerrm<>'PUSH_CITY_CAPACITY' then raise;end if;end;
 perform public.my_push('{"operation":"settings","enabled":false,"cities":[],"categories":[]}');
end $$;
reset role;
rollback;
select 'PASS: default-off population registration, exact VAPID contract and bounded location admission; stop remains available';
