-- Disposable local DB only. No real push providers or credentials.
begin;
insert into auth.users(id,email) values('a0000000-0000-0000-0000-000000000001','push-owner@example.invalid'),('a0000000-0000-0000-0000-000000000002','push-other@example.invalid');
set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001';
do $$ declare d jsonb; s jsonb; begin
 d:=public.my_push();
 if (d->'preferences'->>'enabled')::boolean or d->'devices'<>'[]'::jsonb or d->'preferences'->'categories'<>'[]'::jsonb then raise exception 'automatic opt-in';end if;
 begin perform 1 from public.push_devices;raise exception 'direct access';exception when insufficient_privilege then null;end;
 begin perform public.my_push('{"operation":"settings","enabled":true,"cities":[],"categories":["wind"]}');raise exception 'empty cities accepted';exception when invalid_parameter_value then null;end;
 begin perform public.my_push('{"operation":"settings","enabled":true,"cities":[{"name":"Test","latitude":42,"longitude":23,"zone":"UTC"}],"categories":["walk"]}');raise exception 'Free Pro accepted';exception when insufficient_privilege then null;end;
 perform public.my_push('{"operation":"settings","enabled":true,"cities":[{"name":"Test","latitude":42,"longitude":23,"zone":"UTC"}],"categories":["wind"]}');
 s:=jsonb_build_object('endpoint','https://fcm.googleapis.com/wp/isolated','keys',jsonb_build_object('p256dh',translate(rtrim(encode(decode('04'||repeat('01',64),'hex'),'base64'),'='),'+/' ,'-_'),'auth',translate(rtrim(encode(decode(repeat('01',16),'hex'),'base64'),'='),'+/','-_')));
 -- PostgreSQL base64 encoder wraps 65-byte keys, remove its newline.
 s:=jsonb_set(s,'{keys,p256dh}',to_jsonb(replace(s->'keys'->>'p256dh',E'\n','')));
 begin perform public.my_push(jsonb_build_object('operation','register','subscription',s,'label','Phone'));raise exception 'off gate accepted';exception when raise_exception then if sqlerrm<>'PUSH_REGISTRATION_DISABLED' then raise;end if;end;
end $$;
reset role;
update public.push_controls set registration_enabled=true;
set local role authenticated;
do $$ declare s jsonb; d jsonb; device_id text; begin
 s:=jsonb_build_object('endpoint','https://fcm.googleapis.com/wp/isolated','keys',jsonb_build_object('p256dh',translate(replace(rtrim(encode(decode('04'||repeat('01',64),'hex'),'base64'),'='),E'\n',''),'+/','-_'),'auth',translate(rtrim(encode(decode(repeat('01',16),'hex'),'base64'),'='),'+/','-_')));
 d:=public.my_push(jsonb_build_object('operation','register','subscription',s,'label','Phone'));device_id:=d->'devices'->0->>'id';
 if jsonb_array_length(d->'devices')<>1 or d->'devices'->0 ? 'endpoint' or d->'devices'->0 ? 'auth_key' then raise exception 'device/secret response';end if;
 d:=public.my_push(jsonb_build_object('operation','register','subscription',s,'label','Phone renamed'));if jsonb_array_length(d->'devices')<>1 then raise exception 'duplicate';end if;
 begin perform public.my_push(jsonb_build_object('operation','register','subscription',jsonb_set(s,'{endpoint}','"https://127.0.0.1/private"'),'label','evil'));raise exception 'SSRF accepted';exception when invalid_parameter_value then null;end;
 perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
 if public.my_push()->'devices'<>'[]'::jsonb then raise exception 'cross-account read';end if;
 perform public.my_push(jsonb_build_object('operation','delete','id',device_id));
 perform public.my_push('{"operation":"settings","enabled":true,"cities":[{"name":"Test","latitude":42,"longitude":23,"zone":"UTC"}],"categories":["wind"]}');
 begin perform public.my_push(jsonb_build_object('operation','register','subscription',s,'label','Hijacked'));raise exception 'cross-account transfer';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
 if jsonb_array_length(public.my_push()->'devices')<>1 then raise exception 'foreign delete succeeded';end if;
 perform public.my_push('{"operation":"settings","enabled":false,"cities":[],"categories":[]}');
 if (public.my_push()->'preferences'->>'enabled')::boolean then raise exception 'pause failed';end if;
 perform public.my_push(jsonb_build_object('operation','delete','id',device_id));if public.my_push()->'devices'<>'[]'::jsonb then raise exception 'delete failed';end if;
end $$;
reset role;
update public.push_preferences set tokens=0,refilled_at=clock_timestamp() where user_id='a0000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.my_push('{"operation":"settings","enabled":false,"cities":[],"categories":[]}');raise exception 'rate limit bypass';exception when raise_exception then if sqlerrm<>'PUSH_RATE_LIMITED' then raise;end if;end;
end $$;
reset role;
delete from auth.users where id in ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
do $$ begin if exists(select 1 from public.push_preferences where user_id::text like 'a0000000%') then raise exception 'cascade';end if;end $$;
rollback;
