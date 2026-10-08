-- Apply manually after 20261008000000_admin_readonly.sql. No Production automation.
begin;
create function public.admin_user_favorites(selected_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
  if selected_id is null then raise invalid_parameter_value; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'region', f.region, 'country', f.country,
    'latitude', f.latitude, 'longitude', f.longitude) order by f.created_at, f.id)
    from public.favorite_places f where f.user_id = selected_id), '[]'::jsonb);
end; $$;
revoke all on function public.admin_user_favorites(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_user_favorites(uuid) to authenticated;
commit;
