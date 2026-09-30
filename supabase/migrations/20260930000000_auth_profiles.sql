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
create policy "read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "read own subscription" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.new_user_defaults() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values (new.id);
  insert into public.subscriptions(user_id, plan, status) values (new.id, 'free', 'active');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.new_user_defaults();

create or replace function public.get_my_entitlements(requested_user_id uuid)
returns table(plan text, permissions text[]) language sql stable security definer set search_path = '' as $$
  select s.plan, case when s.plan = 'pro' and s.status = 'active' then array['future:premium']::text[] else array[]::text[] end
  from public.subscriptions s where s.user_id = auth.uid() and s.user_id = requested_user_id;
$$;
revoke all on function public.get_my_entitlements(uuid) from public;
grant execute on function public.get_my_entitlements(uuid) to authenticated, service_role;
revoke insert, update, delete on public.subscriptions from anon, authenticated;
