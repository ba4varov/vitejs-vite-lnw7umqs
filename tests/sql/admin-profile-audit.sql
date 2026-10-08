-- Real journal counts for one UI profile opening and for direct RPCs.
-- All data is disposable; no frontend flag can suppress these inserts.
begin;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
create temporary table audit_baseline as select coalesce(max(id),0) id from public.admin_audit_log;
grant select on audit_baseline to authenticated;
set local role authenticated;
select public.admin_users('',1,'00000000-0000-0000-0000-000000000002');
select public.admin_management_account('00000000-0000-0000-0000-000000000002');
select public.admin_user_favorites('00000000-0000-0000-0000-000000000002');
-- The new action is supported by the protected audit filter, too.
do $$ declare entries jsonb; begin
 entries:=public.admin_audit_entries('30','user_management_view',1)->'entries';
 if jsonb_array_length(entries)<1 or entries->0->>'action'<>'user_management_view' then raise exception 'management audit filter missing'; end if;
end $$;
reset role;
do $$ declare counts jsonb; begin
 select jsonb_object_agg(action,n) into counts from (
  select action,count(*) n from public.admin_audit_log where id>(select id from audit_baseline) group by action
 ) c;
 if counts<>'{"user_details_view":1,"user_management_view":1,"user_favorites_view":1}'::jsonb then raise exception 'wrong profile opening counts: %',counts; end if;
 if exists(select 1 from public.admin_audit_log where id>(select id from audit_baseline)
  and (admin_id<>'00000000-0000-0000-0000-000000000001' or object_id<>'00000000-0000-0000-0000-000000000002' or outcome<>'success'))
  then raise exception 'wrong actor, subject or outcome'; end if;
end $$;
-- A direct management RPC, including not_found, must never become an unlogged read.
truncate audit_baseline;
insert into audit_baseline select coalesce(max(id),0) from public.admin_audit_log;
set local role authenticated;
select public.admin_management_account('00000000-0000-0000-0000-000000000002');
select public.admin_management_account('00000000-0000-0000-0000-000000000099');
reset role;
do $$ begin
 if (select count(*) from public.admin_audit_log where id>(select id from audit_baseline))<>2 then raise exception 'direct management calls not audited exactly once'; end if;
 if (select count(*) from public.admin_audit_log where id>(select id from audit_baseline) and action='user_management_view' and outcome='success')<>1 then raise exception 'direct success type missing'; end if;
 if (select count(*) from public.admin_audit_log where id>(select id from audit_baseline) and action='user_management_view' and outcome='not_found')<>1 then raise exception 'direct not_found type missing'; end if;
end $$;
rollback;
-- A journal failure must prevent every sensitive RPC from returning data.
begin;
create function public.test_reject_profile_audit() returns trigger language plpgsql as $$ begin raise exception 'test profile audit storage failure'; end $$;
create trigger test_reject_profile_audit before insert on public.admin_audit_log for each row execute function public.test_reject_profile_audit();
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.admin_users('',1,'00000000-0000-0000-0000-000000000002'); raise exception 'unaudited identity returned'; exception when raise_exception then if sqlerrm<>'test profile audit storage failure' then raise; end if; end;
 begin perform public.admin_management_account('00000000-0000-0000-0000-000000000002'); raise exception 'unaudited management returned'; exception when raise_exception then if sqlerrm<>'test profile audit storage failure' then raise; end if; end;
 begin perform public.admin_user_favorites('00000000-0000-0000-0000-000000000002'); raise exception 'unaudited favorites returned'; exception when raise_exception then if sqlerrm<>'test profile audit storage failure' then raise; end if; end;
end $$;
rollback;
select 'PASS: one profile open = one identity, one management and one favorites audit; all direct reads fail closed on audit errors' as result;
