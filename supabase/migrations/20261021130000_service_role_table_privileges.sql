-- Manual application only. PostgreSQL 17+ (MAINTAIN privilege).
-- Preserve CRUD, column grants, RLS, functions and existing FK/trigger objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'This migration requires PostgreSQL 17+; verify server_version_num';
  END IF;
END $$;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON TABLE public.favorite_places, public.place_settings, public.gemini_project_quota
FROM service_role;
COMMIT;
