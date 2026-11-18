# Meteo Pulse — B2b shared Push worker, review-only implementation

## Status

**NOT LIVE.** Code toggle `SAFETY_WORKER_CODE_ENABLED=false` is hardcoded, the
Vercel environment key `PUSH_SAFETY_WORKER_ENABLED` is not enabled and the
production Supabase singleton `push_safety_controls.delivery_enabled` remains
false. No Cron job is registered or scheduled, and no production SQL migration
is applied by this PR. Merging the PR **must not send a notification**.

## Two channels, one guarded transport

- **Expected dangerous weather:** validated server-side Open-Meteo forecast;
  opted-in saved city and selected weather risk, up to 24 hours in advance.
  Categories: rain, storm, wind, cold, heat. Text says "forecast Open-Meteo",
  never asserts official NIMH yellow/orange/red codes.
- **Recorded earthquakes:** validated single USGS GeoJSON feed; M3.0+, within
  300km of the separately opted-in saved city; event occurrence after consent,
  within 45 minutes. Text says "recorded" and USGS, never "early warning".
- No silent opt-in. Earthquake consent never overrides weather preferences.
- Notification Service Worker (existing `public/push-sw.js`) displays only
  same-origin notifications and opens only the Meteo Pulse homepage.

## Files and security boundaries

- `supabase/migrations/20261118130000_safety_push_worker_b2b.sql`:
  proposed only, requires already applied B1+B2a. Adds bounded
  `safety_worker_targets(max_rows <=20,after_device)` RPC returning eligible
  enrolled devices, subscription material and *current* opt-ins, callable only
  by service_role and only when the separate database safety gate is ON.
  The direct service_role table privileges remain denied. Adds
  `finish_safety_push(attempt,result)` for recognized terminal provider
  responses, while unknown network results remain in irrevocable
  `uncertain` state.
- `server/safety-push-worker.js`: Node 24-only, production-only, cron-secret
  authenticated, hardcoded default OFF. Reuses the existing VAPID encryption,
  allowlisted Google FCM endpoint, HTTPS/TLS verification, DNS pinning and
  **single-socket sendOnce transport** from `server/push-node-transport.js`.
  No browser can pass coordinates, device IDs, notifications, risk thresholds
  or provider endpoints to this worker.
- `/api/push?channel=safety-dispatch`: existing Vercel API function; no
  extra function. Exact POST-only endpoint with empty JSON body; rejects extra
  query keys or caller-provided targets. It is inert while the code gate OFF.
- Work limit: up to 20 eligible targets, up to 10 distinct forecast cities,
  **at most 3 durable reservations/attempts per run**, and only 1 batched
  USGS feed. This avoids per-device polling. It is a staging budget and
  must be reworked for fair coverage if users or cities exceed these caps.
- Event identity stays `weather:open-meteo:<stable city fingerprint>:<kind>:<local day>`
  or `earthquake:usgs:<USGS event id>`. SQL unique
  `(device_id,event_key)` survives worker crashes and overlapping invocations.
- Every attempt: SELECT validated active target → source fetch → CREATE
  candidate → `reserve_safety_push` (DB transaction) → build encrypted Web
  Push + DNS/TLS prepare → `burn_safety_push` to `uncertain`
  (transaction MUST commit) → **one** outbound HTTPS request → optional
  `finish_safety_push` for recognized accepted/rejected/expired HTTP.
  Provider HTTP 2xx means *provider accepted*, not that a phone displayed it.
  Network timeout/unknown result is never retried, even on a later Cron run.
  Failed preflight remains reserved and is deliberately not replayed.
- The provider adapter **supports FCM only** in this stage. Apple, Mozilla,
  Windows and non-FCM endpoints are explicitly excluded until a future
  transport adapter is independently security-reviewed. Registration UI
  can support other providers, but delivery is not claimed for them yet.
- Existing FCM transport currently accepts TTL=60 seconds and urgency
  very-low. **These are diagnostic-mode settings and must be revisited before
  dependable dangerous-weather delivery**. Do not advertise guaranteed
  notification timing or coverage.
- Versioned SQL schema `public.safety_worker_targets` can reveal subscription
  key material to service_role, intentionally not to anon/authenticated.
  This is security-sensitive and requires a manual review before applying B2b.

## Scheduler / product limitations

Vercel Hobby Cron is not suited to frequent checks for upcoming hazardous
weather. A potential operator-owned scheduler is Supabase Cron with pg_net,
triggering the same POST-only endpoint using a secret stored in Supabase Vault.
**No scheduler is configured by this PR.** The worker needs separate review
for Cron frequency, budgets, source rate limits, serverless execution time,
coverage/fairness, latency and blast radius. No Vercel deployment is produced
for the draft branch.

## Preconditions for production activation (separate approval and PR)

1. Merge and review B2b, then explicitly approve application of the B2b SQL
   migration; confirm existing B1/B2a and that their gate remains OFF.
2. Test read-only target RPC permissions in real project without returning
   keys/coordinates in logs. Confirm at least one opted-in test account and
   a real, valid subscription whose VAPID keys match the sender.
3. Update diagnostic FCM urgency/TTL for alert use, test Android display, and
   keep phone-specific permission/rotation problems visible.
4. Approve a controlled single-device dispatch in an isolated environment,
   with no earlier event backfill and explicit participant consent. Verify
   provider response **and** on-device notification display.
5. Review threat model, concurrency/reservation policy, max-target limits,
   latency and costs. Official **НИМХ** alerts are not sent until a separately
   validated official area/date/source pipeline is available (Bulgaria only).
6. Approve one operator-controlled activation changing **all three gates**
   together: reviewed code flag, authenticated environment flag and B2a
   database gate, plus scheduler. Rollout must support immediate stop and
   account opt-out, and never replay uncertain notifications.

## Verification

CI on disposable PostgreSQL 17 with synthetic accounts and subscriptions
runs exactly B1→B2a→B2b and checks table/RPC privileges, default OFF,
separate consents, once-only reservation, terminal outcome and retained
unknown outcome. Node tests inject a fake transport; **no network Web Push
requests are made**. Build/lint and existing 11 Vercel-function budget tests
guard the implementation.

Source documentation:
- Supabase Cron: https://supabase.com/docs/guides/cron
- Scheduled Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Vercel Cron limitations: https://vercel.com/docs/cron-jobs/usage-and-pricing
