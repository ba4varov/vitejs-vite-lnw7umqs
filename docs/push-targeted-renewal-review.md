# Meteo Pulse — targeted in-place Push renewal (Draft PR, no production writes)

## What the observed error proves

On 2026-11-18, the Note 13 Pro test showed `fcm:rejected`, HTTP 502 at our API and **provider HTTP 400**, with `providerBodyStatus:unknown_format`, MIME `plain` and body shape `other`. The provider returned a final rejection, but the exact cause is **not established**. The presence of `/fcm/send/` in all three stored endpoints does not independently prove the URL is invalid: browser Web Push with VAPID may legitimately have this endpoint prefix. Never rewrite an endpoint by string replacement or rotate the VAPID key based on this evidence alone.

Read-only Production inspection found **3** FCM subscriptions, all `fcm/send`, last modified by 2026-11-02, and registration, test-delivery and automatic safety delivery gates OFF. No endpoint, token or cryptographic secret was retrieved. The app already has local notification, registration fingerprint and p256dh/auth checks, and an owner-confirmed browser renewal. This PR fixes an important weakness in that renewal flow rather than creating a duplicate workflow.

## Behavior proposed

Current renewal calls POST `/api/push` with a new subscription, which uses an endpoint-keyed upsert. It usually creates another device row, leaving the old device ID as the explicit server-test target. After browser unsubscribe, the old target can become stale.

Proposed renewal:

1. Keep the **two read-only owner/VAPID/fingerprint/permission preflights**, explicit confirmation and one browser unsubscribe/subscribe. Nothing destructive happens if the selected device does not match the local browser.
2. POST `{operation:"renew",deviceId,fingerprint,subscription,label}` to the existing authenticated `/api/push` route. The server obtains the VAPID public key from its own environment and calls only the newly proposed `my_push_renew` RPC.
3. The new SQL RPC checks the existing registration gate, the single designated registration-test account, the old owned device ID **and old fingerprint**, current VAPID key, valid consent/cities/categories/entitlements, endpoint/key formats, unique endpoint ownership and rate limiting, within a single transaction.
4. Update **the same device row** (endpoint, fingerprint, p256dh/auth, expiry, updated_at). Never insert a second row, change the device ID, or change the session test target. Old one-time test permits fail their revision check after renewal.
5. The browser reports `success` only if the server returns the same device ID with a fingerprint matching the newly subscribed endpoint. An unconfirmed result must not cause an automatic retry, additional subscribe, DELETE, test send or rollback.

The public `my_push_renew` function is granted only to authenticated users, with an explicit owner check and the existing test-user registration restriction. The server still refuses any POST if `PUSH_REGISTRATION_ENABLED` is not exactly `true`. An out-of-date deployment without the proposed SQL function fails closed; **never enable the registration gate before deploying and validating the migration and server together**.

The current registration/revocation API is unchanged; registration of a brand-new device is not turned on. At the 10-device limit, renewal can still replace the existing row rather than inserting an 11th. No secrets, endpoints or raw provider response bodies are surfaced in diagnostics.

## What remains OFF

- This PR is **Draft** and its Vercel Preview branch is disabled.
- No production Supabase migration applied.
- No Vercel registration flag, Supabase registration flag, test-delivery flag or automatic safety worker is enabled.
- No Cron or earthquake/weather notification send is added, and no real Push test is attempted.
- A safe replacement subscription does **not** establish why FCM responded HTTP 400 or guarantee delivery to Android.

## Tests and review gate

The PR includes unit tests for exact HTTP body shape, gates, VAPID source and routing; browser tests for confirmation, cancellation, mismatch, failure and stable device ID; plus a fully synthetic PostgreSQL 17 transaction testing owner isolation, default OFF behavior, endpoint collisions, old-fingerprint replay and stable session target. CI must report whether each ran, not only that files exist.

Before merging, verify the tests actually execute on GitHub Actions and re-review the SQL function's `security definer`, locks, grants, cross-account checks and failure semantics. After merge, separately approve/apply the migration, then carry out a single device-only controlled renewal. Re-verify the local browser fingerprint and key match and only with separate approval run one real provider test. Immediately return all temporary registration/test gates to OFF. Do not retry an uncertain provider result.

No automatic resend and no global release are part of this PR.
