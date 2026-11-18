# Meteo Pulse — Stage B2a: durable safety Push reservation/burn gate

**Delivery remains OFF, even after merging. No worker, scheduler, device transport,
VAPID secret, Supabase production migration or cron job is activated by this PR.**

## Production schema prerequisite checked (read-only)

A read-only query against the live Meteo Puls Supabase schema confirmed the
existing `push_controls`, `push_preferences`, `push_devices`,
`push_deliveries` tables and `my_push` RPC. It also confirmed that
`earthquake_push_optins` and `my_earthquake_push` (from the already merged
PR #146) **are not yet installed** in the real database.

**Required sequence, only after separate approval:** inspect the full SQL
migrations and back up the schema; apply `20261118093000_earthquake_push_opt_in.sql`
first; verify authenticated RPC, account isolation and explicit opt-in;
then apply `20261118120000_safety_push_durable_gate.sql` with its default-OFF
control; verify the gate is disabled, and only then prepare isolated test-device
delivery. No automatic dispatch should be enabled during either migration.
Merging a GitHub PR does not apply database migrations.

## Why this stage

The already merged PR #147 has a pure dry-run candidate generator for two types
of safety notifications: (1) predicted dangerous weather from a validated server
Open-Meteo forecast and (2) recorded USGS earthquakes within 300 km / M3.0+.
Its process-local `Set` only illustrates deduplication; it is NOT safe for
concurrent workers. Existing `push_deliveries(device_id,event_key)` has the
necessary unique index but no shared, opt-in-aware reservation mechanism.

This PR adds a **proposed, default-disabled database protocol**:
`supabase/migrations/20261118120000_safety_push_durable_gate.sql`:

1. A private, RLS-locked `push_safety_controls` singleton defaults
   `delivery_enabled=false`. Signed-in users, anon and service_role cannot
   directly update this gate.
2. New nullable columns on the existing, unique `push_deliveries` ledger:
   `safety_attempt_id` (unique) and a small bounded `safety_payload`
   containing only nonsecret public event/city context.
3. `reserve_safety_push(device_id,candidate)`, callable only as `service_role`,
   rejects a disabled gate, missing/banned user, absent or expired device,
   mismatched VAPID key and malformed or duplicate event keys. It atomically
   inserts ONE `reserved` row. Concurrent claims are defeated by the existing
   `(device_id,event_key)` primary key. Daily per-device safety cap: 30.
4. **Weather candidates** are valid only when current
   `push_preferences.enabled=true`, the risk category belongs to the selected
   five safety categories, the city is exactly among the owner's saved cities,
   and the start falls in the next 24 hours (or at most 1 hour in the past).
   Categories `walk/garden/sport` never qualify as danger Push.
5. **Earthquake candidates** need a current matching
   `earthquake_push_optins` row, magnitude ≥3.0, epicentral distance ≤300 km,
   event time after the original opt-in and within 45 minutes of origin.
   Revoking consent before burn prevents the send.
6. `burn_safety_push(attempt_id)`, also service_role-only, rechecks the
   **current account, permission, device and source-specific eligibility** under
   row locks. It transitions `reserved → uncertain` once, in a committed DB
   transaction. The hypothetical worker may ONLY start its provider HTTPS
   request after the burn transaction has committed successfully. `uncertain`
   is irreversible and MUST NOT be automatically retried.

Both procedures are SECURITY DEFINER because the existing ledger and
preferences tables are protected by FORCE RLS and direct service-role grants
are revoked. Their search_path is empty and PostgreSQL EXECUTE defaults are
revoked before service-role-only grants. The gate itself is not exposed to
an authenticated browser or API caller. This still requires an additional
privilege review before applying the migration to the real Supabase database.

## Important limitations / future Stage B2b

- **No actual notification sending in B2a.** This DB gate is future-use only;
  there is no frontend access, no endpoint exposing privileged credentials,
  no scheduled function and no secret-bearing GitHub workflow.
- Provider authenticity/freshness cannot be proven by the database because
  event coordinates and forecast snapshots arrive from a trusted worker.
  Before a future claim, that worker MUST independently verify a fresh
  USGS source and current server-side Open-Meteo forecast, time/geometry, and
  provide the canonical event key. A service_role token must never be accepted
  from user-supplied requests.
- The worker must perform a strictly single-use provider send using the
  existing audited Node transport, and never retry uncertain outcomes.
  An accepted provider status does not prove the phone displayed a notification.
- Official **НИМХ codes** are separate from Open-Meteo heuristics. No official
  color code is sent unless the regional bulletin is verified; Bulgaria only.
- Recheck retention and rate caps, registration access for real users, lifecycle
  of VAPID keys and push_controls, an appropriate durable scheduler on the
  chosen plan, and opt-out handling BEFORE enabling `delivery_enabled`.
- To prevent stale/shifted forecast duplicate messages, B2a preserves the
  stable event key from PR #147; the future worker must ensure date and city
  fingerprints correspond to the verified snapshot.
- This initial SQL model is suitable for reviewing lock/consent logic, not a
  production approval. No real Supabase migrations are executed.

## Verification

GitHub Actions spins up **disposable PostgreSQL 17** and applies a fixture with
fake accounts, fake device endpoints and saved cities, followed by the proposed
migration. It checks:
- gate defaults OFF, zero writes before activation,
- no anon/authenticated reservation or burn,
- weather owner/category/city restrictions and duplicate suppression,
- USGS magnitude/distance/freshness checks,
- revoked consent prevents burn and expires the pending reservation,
- irreversible `uncertain` state before any possible network send.

Existing dry-run weather + USGS unit tests, Push tests, 11-Vercel-function
budget, TypeScript build and lint are also checked. No Production deployment
or external provider credentials in the workflow.
