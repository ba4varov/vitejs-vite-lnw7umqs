-- Executed only by the disposable local SQL harness.
begin;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ declare consent jsonb; result jsonb; revision uuid; begin
 if public.get_activity_consent()->>'enabled' <> 'false' then raise exception 'default must be off'; end if;
 result:=public.record_activity('chat_use',gen_random_uuid(),gen_random_uuid());
 if result->>'reason'<>'NO_CONSENT' then raise exception 'no consent recorded'; end if;
 consent:=public.set_activity_consent(true);revision:=(consent->>'revision')::uuid;
 result:=public.record_activity('forecast_view','60000000-0000-0000-0000-000000000001',revision);
 if result->>'recorded'<>'true' then raise exception 'opt in not recorded'; end if;
 result:=public.record_activity('forecast_view','60000000-0000-0000-0000-000000000001',revision);
 if result->>'reason'<>'DUPLICATE' then raise exception 'duplicate recorded'; end if;
 result:=public.record_activity('forecast_view',gen_random_uuid(),revision);
 if result->>'reason'<>'RATE_LIMIT' then raise exception 'rate limit not enforced'; end if;
 perform public.record_activity('active',gen_random_uuid(),revision);
 perform public.record_activity('active',gen_random_uuid(),revision);
 perform public.set_activity_consent(false);
 result:=public.record_activity('chat_use',gen_random_uuid(),revision);
 if result->>'reason'<>'NO_CONSENT' then raise exception 'withdrawal recorded'; end if;
 perform public.set_activity_consent(true);
 result:=public.record_activity('chat_use',gen_random_uuid(),revision);
 if result->>'reason'<>'NO_CONSENT' then raise exception 'stale consent recorded'; end if;
 begin perform public.record_activity('search_text',gen_random_uuid(),revision);raise exception 'invalid action allowed';exception when invalid_parameter_value then null;end;
 begin perform * from public.activity_daily;raise exception 'direct read allowed';exception when insufficient_privilege then null;end;
 begin update public.activity_consent set enabled=true;raise exception 'direct consent write allowed';exception when insufficient_privilege then null;end;
 begin perform public.admin_user_activity(30);raise exception 'ordinary admin allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.activity_daily where user_id='00000000-0000-0000-0000-000000000002') then raise exception 'withdrawal did not delete';end if;
end $$;
-- Fixed relative boundary dataset; login times are irrelevant.
insert into public.activity_daily(user_id,day,action,count) values
 ('00000000-0000-0000-0000-000000000001',(now() at time zone 'UTC')::date,'active',1),
 ('00000000-0000-0000-0000-000000000002',(now() at time zone 'UTC')::date-6,'active',1),
 ('00000000-0000-0000-0000-000000000002',(now() at time zone 'UTC')::date-7,'active',1),
 ('00000000-0000-0000-0000-000000000003',(now() at time zone 'UTC')::date-29,'active',1),
 ('00000000-0000-0000-0000-000000000003',(now() at time zone 'UTC')::date-30,'active',1),
 ('00000000-0000-0000-0000-000000000001',(now() at time zone 'UTC')::date,'forecast_view',3),
 ('00000000-0000-0000-0000-000000000001',(now() at time zone 'UTC')::date-90,'active',1);
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$ declare result jsonb;begin
 result:=public.admin_user_activity(30);
 if result->>'dau'<>'1' or result->>'wau'<>'2' or result->>'mau'<>'3' then raise exception 'incorrect DAU/WAU/MAU: %',result;end if;
 if result->'actions'->>'forecast_view'<>'3' then raise exception 'incorrect counters';end if;
 if jsonb_array_length(result->'days')<>30 then raise exception 'incorrect days';end if;
 if jsonb_array_length(public.admin_user_activity(90)->'days')<>90 then raise exception 'incorrect 90 days';end if;
 if result::text like '%user_id%' then raise exception 'individual records leaked';end if;
 begin perform * from public.activity_daily;raise exception 'admin direct read allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.activity_daily where day < (now() at time zone 'UTC')::date-89) then raise exception 'expired data not pruned';end if;
end $$;
rollback;
