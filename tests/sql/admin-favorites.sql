\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
  begin perform public.admin_user_favorites('00000000-0000-0000-0000-000000000002'); raise exception 'ordinary favorites leaked'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  begin perform public.admin_user_favorites('00000000-0000-0000-0000-000000000002'); raise exception 'missing subject leaked'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.admin_user_favorites('00000000-0000-0000-0000-000000000002'); raise exception 'anon leaked'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$ begin
  begin perform public.admin_user_favorites('00000000-0000-0000-0000-000000000002'); raise exception 'service role leaked'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare favorites jsonb; begin
  favorites := public.admin_user_favorites('00000000-0000-0000-0000-000000000002');
  if jsonb_array_length(favorites) <> 1 or favorites->0->>'name' <> 'Test city' then raise exception 'wrong favorites: %',favorites; end if;
  if public.admin_user_favorites('00000000-0000-0000-0000-000000000003') <> '[]'::jsonb then raise exception 'cross-user leak'; end if;
  begin perform public.admin_user_favorites(null); raise exception 'null accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
select 'PASS: favorites database privileges and cross-user isolation' as result;
