-- Additive, opt-in only. No production execution by this change.
create table public.activity_consent (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 revision uuid not null default gen_random_uuid()
);
create table public.activity_daily (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null,
 action text not null check (action in ('active','forecast_view','search_complete','chat_use','favorite_add','favorite_remove')),
 count integer not null check (count between 1 and 500),
 request_ids uuid[] not null default '{}',
 last_at timestamptz not null default now(),
 primary key(user_id, day, action),
 check (cardinality(request_ids) <= 500)
);
create index activity_daily_day on public.activity_daily(day);
alter table public.activity_consent enable row level security;
alter table public.activity_consent force row level security;
alter table public.activity_daily enable row level security;
alter table public.activity_daily force row level security;
-- No table access, including for admins. Only narrow authenticated RPCs.
revoke all on public.activity_consent, public.activity_daily from public, anon, authenticated, service_role;

create function public.get_activity_consent() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select jsonb_build_object('enabled',enabled,'revision',revision) into result
 from public.activity_consent where user_id=auth.uid();
 return coalesce(result,jsonb_build_object('enabled',false,'revision',null));
end; $$;

create function public.set_activity_consent(desired boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid(); result jsonb;
begin
 if subject is null then raise insufficient_privilege; end if;
 if desired is null then raise invalid_parameter_value; end if;
 -- Same per-account lock in recorder and consent updates: withdrawal cannot race a write.
 perform pg_advisory_xact_lock(hashtextextended(subject::text, 610));
 insert into public.activity_consent(user_id,enabled) values(subject,desired)
 on conflict(user_id) do update set enabled=excluded.enabled, revision=gen_random_uuid();
 if not desired then delete from public.activity_daily where user_id=subject; end if;
 select public.get_activity_consent() into result;
 return result;
end; $$;

create function public.record_activity(selected_action text, operation_id uuid, consent_revision uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid(); today date := (now() at time zone 'UTC')::date; row_data public.activity_daily;
begin
 if subject is null then raise insufficient_privilege; end if;
 if selected_action is null or selected_action not in ('active','forecast_view','search_complete','chat_use','favorite_add','favorite_remove') or operation_id is null then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(hashtextextended(subject::text, 610));
 if not exists(select 1 from public.activity_consent where user_id=subject and enabled and revision=consent_revision) then
  return jsonb_build_object('recorded',false,'reason','NO_CONSENT');
 end if;
 -- Opportunistic own-account cleanup; global cleanup is an explicit owner operation.
 delete from public.activity_daily where user_id=subject and day < today-89;
 select * into row_data from public.activity_daily where user_id=subject and day=today and action=selected_action;
 if found then
  if selected_action='active' or operation_id=any(row_data.request_ids) then return jsonb_build_object('recorded',false,'reason','DUPLICATE'); end if;
  if row_data.count>=500 or row_data.last_at>now()-interval '1 second' then return jsonb_build_object('recorded',false,'reason','RATE_LIMIT'); end if;
  update public.activity_daily set count=count+1, request_ids=array_append(request_ids,operation_id),last_at=now()
   where user_id=subject and day=today and action=selected_action;
 else
  insert into public.activity_daily(user_id,day,action,count,request_ids) values(subject,today,selected_action,1,array[operation_id]);
 end if;
 -- Daily active user is recorded only after an accepted feature action or visible forecast view.
 insert into public.activity_daily(user_id,day,action,count) values(subject,today,'active',1) on conflict do nothing;
 return jsonb_build_object('recorded',true);
end; $$;

create function public.admin_user_activity(period integer default 30) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'UTC')::date; first_day date; result jsonb;
begin
 if not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if period is null or period not in (7,30,90) then raise invalid_parameter_value; end if;
 first_day := today-period+1;
 delete from public.activity_daily where day < today-89;
 select jsonb_build_object(
  'period',period,'timezone','UTC',
  'consenting',(select count(*) from public.activity_consent where enabled),
  'dau',(select count(*) from public.activity_daily where action='active' and day=today),
  'wau',(select count(distinct user_id) from public.activity_daily where action='active' and day between today-6 and today),
  'mau',(select count(distinct user_id) from public.activity_daily where action='active' and day between today-29 and today),
  'actions',(select coalesce(jsonb_object_agg(action,total),'{}'::jsonb) from
    (select action,sum(count) total from public.activity_daily where action<>'active' and day between first_day and today group by action) s),
  'days',(select jsonb_agg(jsonb_build_object('date',d::date,'count',
    (select count(*) from public.activity_daily where action='active' and day=d::date)) order by d)
    from generate_series(first_day::timestamp,today::timestamp,interval '1 day') d),
  'hasData',exists(select 1 from public.activity_daily where day between first_day and today)
 ) into result;
 return result;
end; $$;
revoke all on function public.get_activity_consent(), public.set_activity_consent(boolean), public.record_activity(text,uuid,uuid), public.admin_user_activity(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_activity_consent(), public.set_activity_consent(boolean), public.record_activity(text,uuid,uuid), public.admin_user_activity(integer) to authenticated;
