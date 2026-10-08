-- Disposable PostgreSQL only: minimal Supabase-compatible Auth schema/roles.
-- This is not a GoTrue/Supabase Auth installation and does not validate JWTs.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated to authenticator;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid;
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
