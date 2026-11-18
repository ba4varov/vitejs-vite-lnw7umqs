# Meteo Puls – preflight for the two merged Push migrations

## Current status, read-only inspection (2026-11-18)

This runbook records a **read-only metadata check** of the connected production
Supabase project **Meteo Puls**. No personal data, device endpoints, VAPID keys,
tokens, user IDs or precise locations were retrieved. No production write was
performed.

- Already present: `public.push_controls`, `push_preferences`,
  `push_devices`, `push_deliveries`, and `public.my_push`.
- Missing in production: `public.earthquake_push_optins`,
  `public.my_earthquake_push(jsonb)`, `public.push_safety_controls`,
  `public.reserve_safety_push(uuid,jsonb)`,
  `public.burn_safety_push(uuid)`.
- Structural prerequisites verified: `auth.users.banned_until`,
  `auth.users.deleted_at`, `push_devices.subscription_expires_at`,
  `push_devices.vapid_public_key`, JSONB saved cities, text[] categories,
  service_role and authenticated PostgreSQL roles, and the unique
  `push_deliveries(device_id,event_key)` primary key.
- Snapshot volumes: three registered devices, three account preference rows,
  one account with weather Push enabled, 12 rows in the delivery ledger
  (32 kB relation). These are **aggregate counts**, not identities.
- The existing registration and test delivery controls both read **false**.
  This is separate from the new default-OFF safety gate.
- The original delivery ledger already has RLS enabled and forced.
- `supabase_migrations.schema_migrations` reports neither B1 nor B2a.
  GitHub PR merges do not automatically execute Supabase SQL migrations.

## Fixed deployment order

1. **Before any production write, obtain explicit approval.** Verify latest
   database backup/recovery capability, migration window and current schema.
   Review SECURITY DEFINER function ownership, grants, RLS and permissions.
2. Run the original B1 file
   `supabase/migrations/20261118093000_earthquake_push_opt_in.sql`
   first, using a controlled migration tool with a recorded version.
   Check that `earthquake_push_optins` has RLS+FORCE RLS, only authenticated
   callers can execute the owner-validated `my_earthquake_push` RPC, and no
   existing weather Push settings were modified.
3. Use a permitted signed-in *test account* to GET and PUT opt-in with a
   previously saved city, test opt-out and account isolation. All responses
   must include `deliveryEnabled:false`. A failed test blocks proceeding.
4. Run B2a
   `supabase/migrations/20261118120000_safety_push_durable_gate.sql`.
   It explicitly requires B1 to exist and has a default-OFF control.
   Verify the single `push_safety_controls` row has
   `delivery_enabled=false`, that the two new nullable delivery columns
   exist and that a normal signed-in user cannot invoke either privileged
   reservation/burn function. **Do not turn the gate ON.**
5. Confirm pre-existing Push device metadata and 12 (or then-current)
   existing ledger records have not been modified. Do not reset identities,
   regenerate VAPID keys, enable registration, deploy a worker or run a Push
   provider request as part of applying these two migrations.
6. Only **after a separate Stage B2b PR** supplies a validated shared
   weather + USGS worker, atomic reservation/committed burn, secure
   credentials, opt-outs, operational limits and an explicitly authorized
   single-device test, review a controlled production activation.
   Forecast warnings and recorded earthquakes remain separate categories.
   Official НИМХ codes additionally require a verified area/date/source.

## Added integration test (no production writes)

This Draft PR introduces one CI job on disposable PostgreSQL 17:
- A production-shaped test fixture supplies fake users, cities, controls,
  devices and ledger, without real endpoints or credentials.
- The **exact** merged B1 migration runs first, followed by the **exact**
  merged B2a migration in the **same** test database.
- A final SQL test checks authenticated opt-in, cross-account isolation,
  privileged reservation, deduplication, `reserved → uncertain` one-shot
  semantics, opt-out before the burn and the permanently default-OFF state.
  The gate is enabled **only temporarily within the disposable test DB** to
  exercise the protocol; no network Push is sent. The CI job does not connect
  to real Supabase or Vercel.
- Existing unit tests, production TypeScript build and lint run as regression
  protection. No new API function or frontend code is added.

## Residual risks that still block real automatic delivery

- CI with fake accounts is not an end-to-end real-device delivery test and
  cannot establish real regional event coverage or guaranteed notifications.
- A SECURITY DEFINER function needs additional security review before it is
  installed in an exposed schema; confirm PostgREST EXECUTE privileges,
  function ownership and missing authentication cases in staging.
- A browser Push permission is separate from account-level consent and
  the existing registration control may remain disabled.
- If any step diverges from expected behavior, stop. Do not attempt
  partial manual correction directly in production.

**No production SQL execution is authorized by this document.**
