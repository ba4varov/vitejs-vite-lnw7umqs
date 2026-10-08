-- Actual Stage 4 functions, disposable database only. All fixtures roll back.
begin;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ declare r jsonb; begin
 r:=public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','pro','free','20000000-0000-0000-0000-000000000001');
 if r->>'confirmed'<>'true' then raise exception 'grant not confirmed'; end if;
 r:=public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','pro','free','20000000-0000-0000-0000-000000000001');
 if r->>'replayed'<>'true' then raise exception 'retry repeated'; end if;
 if public.admin_management_account('00000000-0000-0000-0000-000000000002')->>'manualPro'<>'true' then raise exception 'missing manual provenance'; end if;
 begin perform public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','free','pro','20000000-0000-0000-0000-000000000001'); raise exception 'conflicting request allowed'; exception when raise_exception then if sqlerrm<>'REQUEST_CONFLICT' then raise; end if; end;
 begin perform public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','free','free','20000000-0000-0000-0000-000000000003'); raise exception 'stale overwrite'; exception when raise_exception then if sqlerrm<>'STALE_PLAN' then raise; end if; end;
 perform public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','free','pro','20000000-0000-0000-0000-000000000002');
 -- Replaying old grant after a later restore must NOT re-grant Pro.
 perform public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','pro','free','20000000-0000-0000-0000-000000000001');
 if public.admin_management_account('00000000-0000-0000-0000-000000000002')->>'plan'<>'free' then raise exception 'old replay changed state'; end if;
 begin perform public.admin_set_manual_plan(auth.uid(),'free','pro','20000000-0000-0000-0000-000000000004'); raise exception 'unverified paid Pro overwritten'; exception when raise_exception then if sqlerrm<>'EXTERNAL_SUBSCRIPTION_PROTECTED' then raise; end if; end;
 begin update public.subscriptions set plan='pro'; raise exception 'direct update granted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.admin_audit_log where request_id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'))<>2 then raise exception 'duplicate or missing audit'; end if;
 if exists(select 1 from public.admin_audit_log where request_id is not null and admin_id<>'00000000-0000-0000-0000-000000000001') then raise exception 'actor forgery'; end if;
end $$;
update public.subscriptions set provider_customer_id='test-customer' where user_id='00000000-0000-0000-0000-000000000002';
update auth.users set banned_until=now()+interval '1 day' where id='00000000-0000-0000-0000-000000000002';
update public.profiles set display_name='Example name' where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 begin perform public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','pro','free','20000000-0000-0000-0000-000000000005'); raise exception 'provider overwritten'; exception when raise_exception then if sqlerrm<>'EXTERNAL_SUBSCRIPTION_PROTECTED' then raise; end if; end;
 if public.admin_management_summary()->>'blocked'<>'1' then raise exception 'wrong auth ban count'; end if;
 if public.admin_management_users('EXAMPLE',1,'blocked','free')->>'total'<>'1' then raise exception 'name/status/plan filter failed'; end if;
 if public.admin_management_users('',1,'active','free')->>'total'<>'1' then raise exception 'active filter failed'; end if;
 if public.admin_management_users('',1,'','',current_date+1,current_date+2)->>'total'<>'0' then raise exception 'date filter failed'; end if;
end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 begin perform public.admin_set_manual_plan(auth.uid(),'pro','free','20000000-0000-0000-0000-000000000006'); raise exception 'ordinary escalation'; exception when insufficient_privilege then null; end;
 begin perform public.admin_management_account(auth.uid()); raise exception 'account data leak'; exception when insufficient_privilege then null; end;
 begin perform public.admin_management_users(); raise exception 'user data leak'; exception when insufficient_privilege then null; end;
 begin perform public.admin_management_summary(); raise exception 'summary leak'; exception when insufficient_privilege then null; end;
end $$;
rollback;
begin;
create function public.test_reject_plan_audit() returns trigger language plpgsql as $$ begin if new.request_id is not null then raise exception 'test audit storage failure'; end if; return new; end $$;
create trigger test_reject_plan_audit before insert on public.admin_audit_log for each row execute function public.test_reject_plan_audit();
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.admin_set_manual_plan('00000000-0000-0000-0000-000000000002','pro','free','20000000-0000-0000-0000-000000000007'); raise exception 'unaudited mutation'; exception when raise_exception then if sqlerrm<>'test audit storage failure' then raise; end if; end;
end $$;
reset role;
do $$ begin
 if (select plan from public.subscriptions where user_id='00000000-0000-0000-0000-000000000002')<>'free' then raise exception 'audit failure did not roll back subscription'; end if;
 if exists(select 1 from public.admin_audit_log where request_id='20000000-0000-0000-0000-000000000007') then raise exception 'failed mutation logged as success'; end if;
end $$;
rollback;
select 'PASS: stage 4 actual SQL authorization, filters, protected subscriptions, idempotency and audit rollback' as result;
