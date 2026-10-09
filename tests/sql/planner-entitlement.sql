-- Disposable SQL harness only. Production accounts are never touched.
begin;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select 1 from public.get_my_entitlements() where 'planner:advanced'=any(permissions)) then raise exception 'Free granted planner'; end if;
end $$;
reset role;
update public.subscriptions set plan='pro',status='active' where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.get_my_entitlements() where plan='pro' and 'planner:advanced'=any(permissions) and 'future:premium'=any(permissions)) then raise exception 'Pro rights missing'; end if;
end $$;
reset role;
update public.subscriptions set plan='free' where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 if exists(select 1 from public.get_my_entitlements() where 'planner:advanced'=any(permissions)) then raise exception 'Same session revoke failed'; end if;
end $$;
reset role;
update public.subscriptions set plan='pro',status='inactive' where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 if exists(select 1 from public.get_my_entitlements() where 'planner:advanced'=any(permissions)) then raise exception 'Inactive Pro granted planner'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.get_my_entitlements()','execute') then raise exception 'Guest RPC allowed'; end if;
end $$;
rollback;
