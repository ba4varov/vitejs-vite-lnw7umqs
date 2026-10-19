-- Project-wide guard for ALL Gemini callers using this Supabase deployment.
-- One server-controlled scope; no user data or client-supplied project key.
create table if not exists public.gemini_project_quota (
  scope text primary key check (scope = 'default'),
  quota_day date not null,
  used integer not null default 0 check (used >= 0),
  blocked_until timestamptz
);
alter table public.gemini_project_quota enable row level security;
revoke all on public.gemini_project_quota from public, anon, authenticated;

create or replace function public.gemini_quota(action text, daily_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  -- Google daily quotas reset at midnight Pacific, including DST.
  d date := (clock_timestamp() at time zone 'America/Los_Angeles')::date;
  reset_at timestamptz := (((clock_timestamp() at time zone 'America/Los_Angeles')::date + 1)::timestamp at time zone 'America/Los_Angeles');
  q public.gemini_project_quota;
begin
  if action not in ('reserve', 'block') or action is null or daily_limit is null or daily_limit < 0 or daily_limit > 10000 then
    raise exception 'Invalid quota operation';
  end if;
  insert into public.gemini_project_quota(scope, quota_day) values ('default', d) on conflict do nothing;
  select * into q from public.gemini_project_quota where scope = 'default' for update;
  if q.quota_day <> d then
    update public.gemini_project_quota set quota_day = d, used = 0, blocked_until = null where scope = 'default' returning * into q;
  end if;
  if action = 'block' then
    -- Unknown 429s are treated conservatively as daily exhaustion. No retry,
    -- model rotation or second instance can bypass this persistent cooldown.
    update public.gemini_project_quota set blocked_until = reset_at where scope = 'default';
    return jsonb_build_object('allowed', false, 'reason', 'cooldown');
  end if;
  if q.blocked_until > clock_timestamp() then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown');
  end if;
  if q.used >= daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit');
  end if;
  update public.gemini_project_quota set used = used + 1 where scope = 'default';
  return jsonb_build_object('allowed', true, 'reason', 'reserved');
end;
$$;
revoke all on function public.gemini_quota(text, integer) from public, anon, authenticated;
grant execute on function public.gemini_quota(text, integer) to service_role;
