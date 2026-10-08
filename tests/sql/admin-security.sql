\set ON_ERROR_STOP on
-- Fixtures exist only in this disposable database.
insert into auth.users(id,email,created_at,raw_app_meta_data) values
 ('00000000-0000-0000-0000-000000000001','admin@example.invalid',now() - interval '1 day','{"providers":["email"]}'),
 ('00000000-0000-0000-0000-000000000002','ordinary@example.invalid',now() - interval '10 days','{"providers":["email"]}'),
 ('00000000-0000-0000-0000-000000000003','old@example.invalid',now() - interval '40 days','{"providers":["email"]}');
update public.subscriptions set plan='pro' where user_id='00000000-0000-0000-0000-000000000001';
insert into public.favorite_places(user_id,name,latitude,longitude) values
 ('00000000-0000-0000-0000-000000000002','Test city',43,27);
insert into public.admin_memberships(user_id) values ('00000000-0000-0000-0000-000000000001');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
  if public.is_meteo_admin() then raise exception 'ordinary user has admin access'; end if;
  begin perform public.admin_statistics(); raise exception 'stats leaked'; exception when insufficient_privilege then null; end;
  begin perform public.admin_users(); raise exception 'users leaked'; exception when insufficient_privilege then null; end;
  begin perform user_id from public.admin_memberships; raise exception 'membership read allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_memberships(user_id) values(auth.uid()); raise exception 'self grant allowed'; exception when insufficient_privilege then null; end;
  begin update public.admin_memberships set user_id=auth.uid(); raise exception 'membership update allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.admin_memberships; raise exception 'membership deletion allowed'; exception when insufficient_privilege then null; end;
  begin perform id from auth.users; raise exception 'auth.users read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- User-controlled metadata cannot grant membership.
update auth.users set raw_user_meta_data='{"role":"admin","is_admin":true}' where id='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$ begin if public.is_meteo_admin() then raise exception 'metadata escalated privileges'; end if; end $$;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  if public.is_meteo_admin() then raise exception 'missing subject allowed'; end if;
  begin perform public.admin_statistics(); raise exception 'missing subject stats leaked'; exception when insufficient_privilege then null; end;
  begin perform public.admin_users(); raise exception 'missing subject users leaked'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.admin_statistics(); raise exception 'anonymous stats leaked'; exception when insufficient_privilege then null; end;
  begin perform public.admin_users(); raise exception 'anonymous users leaked'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_memberships(user_id) values('00000000-0000-0000-0000-000000000002'); raise exception 'anonymous grant allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$ begin
  begin perform public.admin_statistics(); raise exception 'service RPC granted'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_memberships(user_id) values('00000000-0000-0000-0000-000000000002'); raise exception 'service grant allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare stats jsonb; users jsonb; begin
  if not public.is_meteo_admin() then raise exception 'explicit admin denied'; end if;
  stats := public.admin_statistics();
  if stats->>'total' <> '3' or stats->>'last7' <> '1' or stats->>'last30' <> '2'
    or stats->>'favorites' <> '1' or stats->>'free' <> '2' or stats->>'pro' <> '1'
    or jsonb_array_length(stats->'registrations') <> 30 then raise exception 'wrong real statistics: %',stats; end if;
  if (select sum((day->>'count')::int) from jsonb_array_elements(stats->'registrations') day) <> 2 then raise exception 'wrong chart counts'; end if;
  users := public.admin_users('ORDINARY',1,null);
  if users->>'total' <> '1' or users->'users'->0->>'email' <> 'ordinary@example.invalid' then raise exception 'wrong real users/search'; end if;
  if public.admin_users('',2,null)->'users' <> '[]'::jsonb then raise exception 'wrong page 2'; end if;
  begin insert into public.admin_memberships(user_id) values('00000000-0000-0000-0000-000000000002'); raise exception 'admin granted membership'; exception when insufficient_privilege then null; end;
end $$;
set time zone 'America/Los_Angeles';
do $$ declare days jsonb; begin
  days := public.admin_statistics()->'registrations';
  if days->29->>'date' <> (now() at time zone 'UTC')::date::text
    or days->0->>'date' <> ((now() at time zone 'UTC')::date - 29)::text then
    raise exception 'chart dates depend on database timezone';
  end if;
end $$;
reset role;
select 'PASS: direct SQL RPC isolation, self-grant denial, metadata isolation, real statistics and pagination' as result;
