-- MANUAL ONLY, after stage 1 and 2 migrations. Never run automatically in Production.
begin;
create table public.admin_audit_log (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default clock_timestamp(),
 admin_id uuid not null,
 action text not null check (action in ('user_details_view','user_favorites_view')),
 object_type text not null check (object_type = 'user'),
 object_id uuid not null,
 outcome text not null check (outcome in ('success','not_found'))
);
create index admin_audit_time on public.admin_audit_log(occurred_at desc, id desc);
create index admin_audit_action_time on public.admin_audit_log(action, occurred_at desc);
alter table public.admin_audit_log enable row level security;
alter table public.admin_audit_log force row level security;
revoke all on public.admin_audit_log from public, anon, authenticated, service_role;
revoke all on sequence public.admin_audit_log_id_seq from public, anon, authenticated, service_role;

-- Keep the implementation private: callers cannot bypass the audited wrapper.
alter function public.admin_users(text, integer, uuid) rename to admin_users_internal;
revoke all on function public.admin_users_internal(text, integer, uuid) from public, anon, authenticated, service_role;
create function public.admin_users(search_email text default '', page_number integer default 1, selected_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if search_email is null or page_number is null then raise invalid_parameter_value; end if;
 result := public.admin_users_internal(search_email, page_number, selected_id);
 if selected_id is not null then
  insert into public.admin_audit_log(admin_id, action, object_type, object_id, outcome)
  values(auth.uid(), 'user_details_view', 'user', selected_id,
   case when jsonb_array_length(result->'users') > 0 then 'success' else 'not_found' end);
 end if;
 return result;
end; $$;
create or replace function public.admin_user_favorites(selected_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if selected_id is null then raise invalid_parameter_value; end if;
 select coalesce(jsonb_agg(row_data order by row_data.created_at, row_data.id), '[]'::jsonb) into result from (
  select f.id, f.name, f.region, f.country, f.latitude, f.longitude, f.created_at
  from public.favorite_places f where f.user_id = selected_id order by f.created_at, f.id limit 500
 ) row_data;
 insert into public.admin_audit_log(admin_id, action, object_type, object_id, outcome)
 values(auth.uid(), 'user_favorites_view', 'user', selected_id,
  case when exists(select 1 from auth.users where id = selected_id) then 'success' else 'not_found' end);
 return result;
end; $$;

create function public.admin_advanced_statistics(period text default '30') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare starts timestamp; step interval; cutoff timestamptz; result jsonb;
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if period is null or period not in ('7','30','90','12m') then raise invalid_parameter_value; end if;
 step := case when period = '12m' then interval '1 month' else interval '1 day' end;
 starts := case when period = '12m' then date_trunc('month', now() at time zone 'UTC') - interval '11 months'
  else date_trunc('day', now() at time zone 'UTC') - ((period::integer - 1) * interval '1 day') end;
 cutoff := starts at time zone 'UTC';
 with locations as (
  -- Coordinates are the existing saved-place identity (4 decimal places).
  -- Localized names never merge different locations or split one location.
  select latitude_key, longitude_key, min(name) as name, min(region) as region, min(country) as country, count(*) as count
  from public.favorite_places group by latitude_key, longitude_key
 ), buckets as (
  select d.day::date as date,
   (select count(*) from auth.users where created_at >= (d.day at time zone 'UTC') and created_at < ((d.day + step) at time zone 'UTC')) as registrations,
   (select count(*) from auth.users where last_sign_in_at >= (d.day at time zone 'UTC') and last_sign_in_at < ((d.day + step) at time zone 'UTC')) as last_logins
  from generate_series(starts, now() at time zone 'UTC', step) d(day)
 )
 select jsonb_build_object(
  'total', (select count(*) from auth.users),
  'last7', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
  'last30', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
  'login7', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
  'login30', (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
  'noLogin30', (select count(*) from auth.users where last_sign_in_at is null or last_sign_in_at < now() - interval '30 days'),
  'free', (select count(*) from auth.users u join public.subscriptions s on s.user_id=u.id where s.plan='free'),
  'pro', (select count(*) from auth.users u join public.subscriptions s on s.user_id=u.id where s.plan='pro'),
  'unknownPlan', (select count(*) from auth.users u where not exists(select 1 from public.subscriptions s where s.user_id=u.id and s.plan in ('free','pro'))),
  'favorites', (select count(*) from public.favorite_places),
  'uniqueCities', (select count(*) from locations),
  'cities', (select coalesce(jsonb_agg(c), '[]'::jsonb) from (select * from locations order by count desc, latitude_key, longitude_key limit 10) c),
  'buckets', (select coalesce(jsonb_agg(b order by date),'[]'::jsonb) from buckets b),
  'period', period, 'asOf', now()
 ) into result;
 return result;
end; $$;

create function public.admin_audit_entries(period text default '30', selected_action text default '', page_number integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cutoff timestamptz; result jsonb;
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if period is null or period not in ('7','30','90','12m') or selected_action is null or selected_action not in ('','user_details_view','user_favorites_view')
  or page_number is null or page_number < 1 or page_number > 1000000 then raise invalid_parameter_value; end if;
 cutoff := now() - case when period='12m' then interval '12 months' else period::integer * interval '1 day' end;
 select jsonb_build_object('entries', (select coalesce(jsonb_agg(r order by occurred_at desc, id desc),'[]'::jsonb) from (
  select * from public.admin_audit_log where occurred_at >= cutoff and (selected_action='' or action=selected_action)
  order by occurred_at desc, id desc limit 20 offset (page_number-1)*20
 ) r), 'total', (select count(*) from public.admin_audit_log where occurred_at >= cutoff and (selected_action='' or action=selected_action)),
 'pageSize', 20) into result;
 return result;
end; $$;
revoke all on function public.admin_users(text, integer, uuid), public.admin_user_favorites(uuid), public.admin_advanced_statistics(text), public.admin_audit_entries(text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_users(text,integer,uuid), public.admin_user_favorites(uuid), public.admin_advanced_statistics(text), public.admin_audit_entries(text,text,integer) to authenticated;
commit;
