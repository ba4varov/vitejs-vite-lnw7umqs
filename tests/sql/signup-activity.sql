-- Local disposable test only. Existing user was inserted before the migration.
begin;
insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000002',null,'{"activity_consent":true}'),
 ('00000000-0000-0000-0000-000000000003',now(),'{}');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$begin
 if public.claim_activity_offer()->>'offer'<>'false' then raise exception 'legacy prompted';end if;
 perform public.set_activity_consent(true);
 perform public.answer_activity_offer(false);
 if public.get_activity_consent()->>'enabled'<>'true' then raise exception 'legacy consent changed';end if;
end$$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform public.claim_activity_offer();raise exception 'unconfirmed prompted';exception when insufficient_privilege then null;end;
 begin perform public.answer_activity_offer(true);raise exception 'unconfirmed consent';exception when insufficient_privilege then null;end;
 if public.get_activity_consent()->>'enabled'<>'false' then raise exception 'metadata enabled';end if;
 begin select * from public.activity_signup_offer;raise exception 'direct table read';exception when insufficient_privilege then null;end;
end$$;
reset role;
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 if public.claim_activity_offer()->>'offer'<>'true' then raise exception 'no fresh offer';end if;
 if public.claim_activity_offer()->>'offer'<>'false' then raise exception 'repeat offer';end if;
 perform public.answer_activity_offer(false);perform public.answer_activity_offer(true);
 if public.get_activity_consent()->>'enabled'<>'false' then raise exception 'stale answer enabled';end if;
end$$;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$declare c jsonb;begin
 c:=public.answer_activity_offer(true);
 if c->>'enabled'<>'true' then raise exception 'live opt-in failed';end if;
 perform public.record_activity('chat_use',gen_random_uuid(),(c->>'revision')::uuid);
 perform public.set_activity_consent(false);perform public.answer_activity_offer(true);
 if public.get_activity_consent()->>'enabled'<>'false' then raise exception 'withdrawal overwritten';end if;
 if public.record_activity('chat_use',gen_random_uuid(),(c->>'revision')::uuid)->>'recorded'<>'false' then raise exception 'stale record';end if;
end$$;
reset role;
do $$begin
 if exists(select 1 from public.activity_daily where user_id='00000000-0000-0000-0000-000000000003') then raise exception 'counts not deleted';end if;
 if (select count(*) from public.activity_signup_offer)<>2 then raise exception 'legacy enrolled';end if;
 if not exists(select 1 from public.activity_consent where user_id='00000000-0000-0000-0000-000000000001' and enabled) then raise exception 'foreign consent changed';end if;
end$$;
rollback;
