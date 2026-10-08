-- Actual functions, privileges, grouping and atomic audit behavior in disposable DB.
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
update auth.users set last_sign_in_at = now() - interval '1 day' where id='00000000-0000-0000-0000-000000000001';
update auth.users set last_sign_in_at = now() - interval '20 days' where id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ declare s jsonb; a jsonb; begin
 s := public.admin_advanced_statistics('12m');
 if s->>'login7' <> '1' or s->>'login30' <> '2' or s->>'noLogin30' <> '1' then raise exception 'login counts'; end if;
 if jsonb_array_length(s->'buckets') <> 12 then raise exception 'monthly buckets'; end if;
 if (s->>'noLogin30')::integer + (s->>'login30')::integer <> (s->>'total')::integer then raise exception 'login partition'; end if;
 perform public.admin_users('',1,'00000000-0000-0000-0000-000000000002');
 perform public.admin_user_favorites('00000000-0000-0000-0000-000000000002');
 perform public.admin_users('',1,'00000000-0000-0000-0000-000000000099');
 a := public.admin_audit_entries('7','user_details_view',1);
 if a->'entries'->0->>'outcome' <> 'not_found' then raise exception 'missing object outcome'; end if;
 if (a->>'total')::integer < 1 or a->'entries'->0->>'admin_id' <> auth.uid()::text then raise exception 'actor attribution'; end if;
 begin insert into public.admin_audit_log(admin_id,action,object_type,object_id,outcome) values(auth.uid(),'user_details_view','user',auth.uid(),'success'); raise exception 'forged insert accepted'; exception when insufficient_privilege then null; end;
 begin update public.admin_audit_log set admin_id=auth.uid(); raise exception 'update accepted'; exception when insufficient_privilege then null; end;
 begin delete from public.admin_audit_log; raise exception 'delete accepted'; exception when insufficient_privilege then null; end;
 begin perform public.admin_users_internal('',1,auth.uid()); raise exception 'unlogged bypass accepted'; exception when insufficient_privilege then null; end;
 begin perform public.admin_advanced_statistics(null); raise exception 'null accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_audit_entries('30','invented',1); raise exception 'invalid action accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- Same names at distinct coordinates; translated names at identical coordinates.
insert into public.favorite_places(user_id,name,latitude,longitude) values
 ('00000000-0000-0000-0000-000000000001','Twin',10,20),
 ('00000000-0000-0000-0000-000000000002','Близнак',10,20),
 ('00000000-0000-0000-0000-000000000001','Twin',11,21);
set local role authenticated;
do $$ declare s jsonb; begin
 s := public.admin_advanced_statistics('7');
 if (s->>'uniqueCities')::integer <> 3 then raise exception 'location grouping'; end if;
 if (s->'cities'->0->>'count')::integer <> 2 then raise exception 'localized grouping'; end if;
end $$;
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 begin perform public.admin_advanced_statistics('30'); raise exception 'ordinary stats allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_audit_entries(); raise exception 'ordinary log allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.admin_audit_log; raise exception 'direct table read allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
-- Empty dataset has real zero counts and empty city/log arrays.
begin;
truncate public.admin_audit_log;
delete from public.favorite_places;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ declare s jsonb; begin
 s := public.admin_advanced_statistics('90');
 if (s->>'favorites')::integer <> 0 or s->'cities' <> '[]'::jsonb or jsonb_array_length(s->'buckets') <> 90 then raise exception 'empty favorites'; end if;
 if public.admin_audit_entries()->'entries' <> '[]'::jsonb then raise exception 'empty log'; end if;
end $$;
rollback;

-- Force audit storage failure: sensitive read must fail, not return unaudited data.
begin;
create function public.test_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit storage failure'; end $$;
create trigger test_reject_audit before insert on public.admin_audit_log for each row execute function public.test_reject_audit();
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.admin_users('',1,auth.uid()); raise exception 'unaudited details returned'; exception when raise_exception then if sqlerrm <> 'test audit storage failure' then raise; end if; end;
 begin perform public.admin_user_favorites(auth.uid()); raise exception 'unaudited favorites returned'; exception when raise_exception then if sqlerrm <> 'test audit storage failure' then raise; end if; end;
end $$;
rollback;
