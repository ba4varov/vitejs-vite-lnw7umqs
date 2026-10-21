# Restrict service_role table privileges (manual deployment)

The change removes only TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from
service_role on public.favorite_places, public.place_settings and
public.gemini_project_quota. It does not change CRUD or column grants, RLS,
RPC definitions/EXECUTE, existing foreign keys, triggers or default privileges.

## Compatibility and prerequisites

Existing SQL runners use postgres:17-bookworm. supabase/config.toml does not
pin a database major version. Production version has NOT been queried or verified.
MAINTAIN requires PostgreSQL 17+. The migration explicitly aborts below 17.
Do not silently omit MAINTAIN on an older server: stop and reassess the baseline.

Before applying, an operator must run these read-only queries on the intended
environment and save their output securely (without connection credentials):

```sql
SELECT current_database(), current_user, version(),
       current_setting('server_version_num')::integer AS server_version_num;
SELECT oid::regclass AS relation, pg_get_userbyid(relowner) AS owner,
       relacl, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid IN ('public.favorite_places'::regclass,
              'public.place_settings'::regclass,
              'public.gemini_project_quota'::regclass);
SELECT c.oid::regclass AS relation, p AS privilege,
       has_table_privilege('service_role', c.oid, p) AS effective
FROM pg_class c
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE',
                       'TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
WHERE c.oid IN ('public.favorite_places'::regclass,
               'public.place_settings'::regclass,
               'public.gemini_project_quota'::regclass);
SELECT oid::regprocedure AS function, pg_get_userbyid(proowner) AS owner,
       prosecdef, proacl, pg_get_functiondef(oid)
FROM pg_proc
WHERE oid IN ('public.gemini_quota(text,integer)'::regprocedure,
              'public.set_my_default_place(uuid)'::regprocedure);
```

Proceed only on PostgreSQL 17+, as postgres, after confirming the recorded
service-role grant is Dxtm/postgres without grant options on all three tables,
CRUD table privileges are false, quota RPC is SECURITY DEFINER with an owner
that can access its table, and service_role retains quota RPC EXECUTE.
Check column grants as well: table-level false does not imply no column access.
If ACL, function definitions, ownership or effective privileges differ, stop and
investigate. Check role inheritance/PUBLIC grants if effective Dxtm remains true;
the migration intentionally does not revoke other roles or alter memberships.
Confirm no external maintenance jobs or production-only RPC require these rights.

## Functional dependencies

- src/places-client.ts uses authenticated REST SELECT/INSERT/DELETE and column
  UPDATE; rpc/set_my_default_place uses SECURITY INVOKER and authenticated grants.
- Existing composite FK clears default_place_id when its favorite is deleted.
  REFERENCES controls creation of constraints, not existing FK enforcement;
  TRIGGER controls creation, not execution of existing triggers.
- Admin API forwards user JWTs to SECURITY DEFINER admin_user_favorites,
  admin_statistics and admin_advanced_statistics; those only read favorites.
- server/gemini-quota.js uses service_role EXECUTE on gemini_quota. Its definer
  performs INSERT, SELECT FOR UPDATE and UPDATE; daily reset uses UPDATE.
- push-test Edge Function uses push RPCs, without a dependency on these tables.
- MAINTAIN is unused by application code; removing it does not disable autovacuum.

## Verification

Run `node scripts/test-service-role-privileges.mjs` (local Docker required).
The runner accepts no remote database URL; it creates an isolated PostgreSQL 17
container, applies actual project migrations, reproduces the audited ACL, checks
all 12 direct/effective rights before and after, compares unchanged catalog/ACL
snapshots, reapplies the migration, exercises authenticated places/default/FK/RLS
and service-role quota RPC, runs existing admin/quota SQL tests, and verifies
exact original ACL restoration with the rollback file. It always removes its
container. Also run npm test, npm run build, npm run lint and npm run test:admin:sql.

The new runner uses a minimal Auth schema and SET ROLE, not GoTrue or real JWT
HTTP. The existing admin runner adds PostgREST/JWT coverage but does not apply
this migration or test service-role quota HTTP. Staging still needs real JWT
places/admin checks, service-role quota HTTP, concurrent reservations and the
AI quota-unavailable fallback. Do not reset production quota to test rollover.

## Apply after review and staging

1. Complete the preflight above and all staging checks. Save ACL/column grants
   and effective privileges before the change. Keep the rollback file available.
2. Apply ONLY supabase/migrations/20261021130000_service_role_table_privileges.sql
   using the approved migration procedure as postgres. With psql, use
   `psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261021130000_service_role_table_privileges.sql`
   with the intended connection configured securely outside the command.
   Do not run a blanket db push that could apply unrelated pending migrations.
   Record migration history using the established project procedure.
3. The file supplies BEGIN/COMMIT and a 5-second lock timeout. A failure rolls
   back the transaction; investigate contention rather than increasing scope.
4. Re-run the privilege query: all 12 Dxtm results must be false; CRUD and column
   grants must match the baseline. Check RPC ownership/EXECUTE is unchanged.
5. Smoke-test authenticated favorites/default deletion and admin favorites/stats.
   Observe a normal quota-protected request without forcing daily reset/block.
   Monitor 42501/403, places_sync permission diagnostics and gemini-quota:rpc
   http_error/quota_unavailable. No app or Edge redeployment is required.

## Rollback

If failure is attributable to these grants, first check the saved baseline.
Only for the verified Dxtm/postgres baseline, run as postgres:

`psql -X -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261021130000_service_role_table_privileges.sql`

This grants exactly the original four rights, without ALL or grant options.
It changes no data. Recheck ACL/effective rights and the failed feature; record
the rollback in migration history according to the existing process. For a
baseline different from Dxtm/postgres, use its recorded grants instead of this
rollback. Never put the rollback in the forward migrations directory.

No production SQL, deployment or merge is performed by this PR.
