-- Manual application only. UUID membership is managed by the database owner.
create table public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.admin_memberships enable row level security;
alter table public.admin_memberships force row level security;
revoke all on public.admin_memberships from public, anon, authenticated, service_role;

create function public.is_meteo_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_memberships where user_id = auth.uid());
$$;
revoke all on function public.is_meteo_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_meteo_admin() to authenticated;

create function public.admin_statistics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_meteo_admin() then raise insufficient_privilege; end if;
  return jsonb_build_object(
    'total', (select count(*) from auth.users),
    'last7', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'last30', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'favorites', (select count(*) from public.favorite_places),
    'free', (select count(*) from public.subscriptions where plan = 'free'),
    'pro', (select count(*) from public.subscriptions where plan = 'pro'),
    'registrations', (select jsonb_agg(jsonb_build_object('date', d.day::date, 'count',
      (select count(*) from auth.users u where u.created_at >= d.day and u.created_at < d.day + interval '1 day')) order by d.day)
      from generate_series(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '29 days',
        date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', interval '1 day') d(day))
  );
end; $$;

create function public.admin_users(search_email text default '', page_number integer default 1, selected_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; total bigint;
begin
  if not public.is_meteo_admin() then raise insufficient_privilege; end if;
  if page_number < 1 or page_number > 1000000 or length(search_email) > 254 then raise invalid_parameter_value; end if;
  select count(*) into total from auth.users u where
    (selected_id is null or u.id = selected_id) and strpos(lower(coalesce(u.email,'')), lower(search_email)) > 0;
  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into result from (
    select u.id, u.email, u.created_at, u.last_sign_in_at,
      u.raw_app_meta_data -> 'providers' as providers, s.plan, p.display_name
    from auth.users u left join public.subscriptions s on s.user_id = u.id
    left join public.profiles p on p.user_id = u.id
    where (selected_id is null or u.id = selected_id) and strpos(lower(coalesce(u.email,'')), lower(search_email)) > 0
    order by u.created_at desc, u.id limit 20 offset (page_number - 1) * 20
  ) row_data;
  return jsonb_build_object('users', result, 'total', total, 'page', page_number, 'pageSize', 20);
end; $$;
revoke all on function public.admin_statistics() from public, anon, authenticated, service_role;
revoke all on function public.admin_users(text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_statistics(), public.admin_users(text, integer, uuid) to authenticated;
