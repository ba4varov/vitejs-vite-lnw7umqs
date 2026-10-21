-- MANUAL ONLY; not a forward migration. Run as postgres after verifying the
-- saved pre-change ACL is service_role=Dxtm/postgres on these three tables.
-- Do not use for a different baseline; restore only the recorded grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON TABLE public.favorite_places, public.place_settings, public.gemini_project_quota
TO service_role;
COMMIT;
