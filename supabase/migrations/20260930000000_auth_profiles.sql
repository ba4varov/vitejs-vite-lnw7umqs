-- Meteo Pulse identity data. This migration assumes a new Supabase project.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active',
  provider_customer_id text unique,
  provider_subscription_id text unique,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.profiles force row level security;
alter table public.subscriptions force row level security;

-- No browser role receives table privileges. Profiles are accessed by the
-- verified server route; subscriptions are exposed only through the RPC below.
revoke all on table public.profiles from public, anon, authenticated, service_role;
revoke all on table public.subscriptions from public, anon, authenticated, service_role;
grant usage on schema public to service_role, authenticated;
grant select (user_id, display_name) on public.profiles to service_role;
grant update (display_name) on public.profiles to service_role;

-- These policies are defence in depth if direct authenticated grants are added
-- in a later migration. There is deliberately no subscription update policy.
create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "read own subscription" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_profile_updated_at() from public, anon, authenticated, service_role;
create trigger set_profile_updated_at
before update of display_name on public.profiles
for each row execute function public.set_profile_updated_at();

create or replace function public.new_user_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(user_id) values (new.id);
  insert into public.subscriptions(user_id, plan, status) values (new.id, 'free', 'active');
  return new;
end;
$$;
revoke all on function public.new_user_defaults() from public, anon, authenticated, service_role;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.new_user_defaults();

-- The server invokes this RPC with the already verified user's JWT, not with
-- the service-role JWT. It therefore needs no caller-provided user id and cannot
-- be used to request another user's entitlements.
create or replace function public.get_my_entitlements()
returns table(plan text, permissions text[])
language sql
stable
security definer
set search_path = ''
as $$
  select s.plan,
    case
      when s.plan = 'pro' and s.status = 'active'
        then array['future:premium']::text[]
      else array[]::text[]
    end
  from public.subscriptions as s
  where s.user_id = auth.uid();
$$;
revoke all on function public.get_my_entitlements() from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlements() to authenticated;
