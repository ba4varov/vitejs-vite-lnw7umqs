# Meteo Pulse — earthquake Push stage B1: user consent and dry-run eligibility

**State: implementation proposal only. No automatic sending.**
This stage intentionally does not turn on the disabled `supabase/functions/push-check` edge function or the existing Node sender, and does not schedule Cron jobs.

## User-facing controls
- An authenticated account opens Profile → Push notifications.
- Under an independent block **"Push за земетресения – подготовка"**, the user explicitly selects one of their **already saved cities**, with fixed **300 km radius and minimum M 3.0**. No raw GPS coordinates are accepted in the new endpoint.
- Users can explicitly opt in and opt out. A saved opt-in is **not** a promise of delivery. A separate registered device and OS/browser notification permission will be required when sending is approved.
- Language BG/EN and dark/light mode supported. The consent controls never call `Notification.requestPermission`, `showNotification` or a provider.
- Disabling this preference removes the earthquake consent row and never revokes unrelated weather preferences or devices.

## Database and ownership
- Proposed migration: `supabase/migrations/20261118093000_earthquake_push_opt_in.sql`. **Review before applying**.
- `public.earthquake_push_optins`: exactly one row per account, `user_id` FK to `auth.users`, saved-city snapshot, consent timestamp, updated time. Absence = opt-out. The city is copied atomically from `public.push_preferences.cities` for the signed-in account; callers supply **only** `cityIndex` (0–4).
- The explicit `public.my_earthquake_push(jsonb)` RPC checks `auth.uid()`, banned users, a strict input shape, allowed operation, and only the caller's saved city. It keeps `opted_in_at` unchanged when re-saving the same city, resets on city change, and deletes the row on revocation.
- SQL runs with a pinned empty `search_path`, all tables and columns are schema qualified. Direct table access is revoked from anonymous and signed-in API roles; RLS is enabled and forced; only authenticated users may execute the narrowly scoped RPC.
- `service_role` may **read consent only** (not write). No subscriptions, auth credentials or VAPID private keys are exposed to browsers.
- Isolated disposable PostgreSQL SQL checks must validate role separation, invalid payloads, cross-user isolation, consent timestamps, idempotency, and deletion. No live Supabase migration or database update is carried out by GitHub commits.

## HTTP API
- Existing Vercel function `/api/push` gains **`?channel=earthquakes`** for GET and PUT; it leaves existing unqualified `/api/push` contracts intact. No twelfth API function.
- The Node server validates an active bearer session using the existing Supabase Auth adapter. It calls the authenticated RPC with **the original JWT and anon key**, no service_role. Rejects unknown query parameters, user identifiers, raw coordinates and malformed responses. Private `no-store` caching and strict timeouts.
- Missing migration returns an explicit unavailable status. **Nothing is enabled silently**.

## Pending delivery stage B2 (separate PR and approval)
1. **Do not** use a user-facing request as a dispatcher. A single authenticated scheduled worker reads a shared USGS event source (fixed URL), collects only active consents and registered, non-expired devices.
2. Validate magnitude M≥3, distance ≤300 km from the saved city, earthquake event time within 45 minutes of the verified source event and **after the opt-in timestamp**. Never send backfill on registration or user re-enablement. Source may revise events; dedupe on a stable USGS ID, not magnitude or distance.
3. Reuse `public.push_deliveries` uniqueness `(device_id,event_key)`; `earthquake:usgs:<event_id>` is reserved **before** outbound contact. Recheck latest account, consent, city, device, VAPID keys, expiry and mute policy immediately before sending, atomically burn the reservation into `uncertain`. Uncertain provider outcomes must not be automatically retried.
4. Use existing audited Node RFC 8291 encryption, validated FCM endpoint, DNS pinning/TLS and single-shot request transport. **Never enable generic provider retries**, redirects, unsafe hostnames or per-device polling. Include origin UTC time, local timestamp, source and clear "recorded earthquake" language.
5. Add explicit operator feature gate defaulting FALSE, per-user rate caps, per-source dedup, EMSC/USGS cross-catalog matching if a second source is later added, 410 stale device cleanup and visible opt-out status.
6. Validate on staging with an explicitly authorized single target device before any production delivery. Existing `push-check` (HTTP 503) must stay fail-closed until the worker passes a separate security review.
7. Test real browsers and Android notifications end-to-end; an accepted 201 from FCM does **not** prove that the device displayed it.

## Current no-send safety
- `EARTHQUAKE_PUSH_DELIVERY_ENABLED=false` remains unchanged in `server/earthquakes-core.js`.
- The new `server/earthquake-push-eligibility.js` contains **pure, offline dry-run logic** for the 300km/M3 filters, consent timing, 45min freshness, per-device dedup. It contains no HTTP transport and is not wired to a scheduler.
- The original weather Push subscription settings and test sender are not altered. Existing weather/NIMH/earthquake information panels continue working when no account or new migration exists.

Official Supabase security guidance: https://supabase.com/docs/guides/database/postgres/row-level-security
