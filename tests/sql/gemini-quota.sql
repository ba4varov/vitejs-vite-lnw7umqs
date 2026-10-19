-- Run on a disposable database after the migration; rolls back all test data.
begin;
delete from public.gemini_project_quota;
do $$
declare r jsonb; i integer;
begin
  if has_function_privilege('anon', 'public.gemini_quota(text,integer)', 'execute') or
     has_function_privilege('authenticated', 'public.gemini_quota(text,integer)', 'execute') then
    raise exception 'Quota RPC is accessible to public users';
  end if;
  if has_table_privilege('anon', 'public.gemini_project_quota', 'select') or
     has_table_privilege('authenticated', 'public.gemini_project_quota', 'update') then
    raise exception 'Quota table is accessible to public users';
  end if;
  for i in 1..20 loop
    r := public.gemini_quota('reserve', 20);
    if r <> '{"allowed":true,"reason":"reserved"}'::jsonb then raise exception 'Reservation % failed', i; end if;
  end loop;
  if public.gemini_quota('reserve', 20) <> '{"allowed":false,"reason":"daily_limit"}'::jsonb then raise exception 'Limit exceeded'; end if;
  if (select used from public.gemini_project_quota) <> 20 then raise exception 'Denied request incremented usage'; end if;
  update public.gemini_project_quota set quota_day = quota_day - 1;
  if public.gemini_quota('reserve', 20) <> '{"allowed":true,"reason":"reserved"}'::jsonb then raise exception 'New day did not reset'; end if;
  if (select used from public.gemini_project_quota) <> 1 then raise exception 'Rollover count wrong'; end if;
  perform public.gemini_quota('block', 20);
  if public.gemini_quota('reserve', 20) <> '{"allowed":false,"reason":"cooldown"}'::jsonb then raise exception 'Persistent 429 breaker failed'; end if;
  if (select blocked_until from public.gemini_project_quota) <> (((clock_timestamp() at time zone 'America/Los_Angeles')::date + 1)::timestamp at time zone 'America/Los_Angeles') then raise exception 'Wrong reset timezone'; end if;
  update public.gemini_project_quota set quota_day = quota_day - 1;
  if public.gemini_quota('reserve', 0) <> '{"allowed":false,"reason":"daily_limit"}'::jsonb then raise exception 'Zero allowance failed'; end if;
end;
$$;
rollback;
