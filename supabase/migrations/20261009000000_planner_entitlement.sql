-- Additive Stage 6B; apply separately after review. No new tables or grants.
begin;
create or replace function public.get_my_entitlements()
returns table(plan text, permissions text[])
language sql stable security definer set search_path = ''
as $$
  select s.plan,
    case when s.plan = 'pro' and s.status = 'active'
      then array['future:premium','planner:advanced']::text[]
      else array[]::text[] end
  from public.subscriptions as s where s.user_id = auth.uid();
$$;
revoke all on function public.get_my_entitlements() from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlements() to authenticated;
commit;
