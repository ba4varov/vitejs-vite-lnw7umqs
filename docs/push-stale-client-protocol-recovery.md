# Meteo Pulse — stale Push client protocol, post-#152 incident

## Verified on 18 November 2026

After PR #152 merged, the real Chrome user tapped **Renew Push registration** on the matching *second* Note 13 Pro. A *third* Note 13 Pro row appeared, while the previous rows' `updated_at` remained unchanged. The new row had distinct endpoint, p256dh and auth and matched the browser's new subscription. The user confirmed that the **renewal** button was tapped, not the registration button.

The SQL function `my_push_renew(jsonb)` only issues UPDATE by the selected existing device ID. It cannot INSERT another `push_devices` row. The former browser bundle used the unversioned `POST /api/push` envelope `{subscription,label}` for renewal. When that obsolete JavaScript was still open in Chrome after the merge, the server could not distinguish its renewal from a normal registration and routed it to the INSERT/upsert `my_push` register operation. This is **consistent with** the evidence, but no exact historical HTTP request payload was retained, so an outdated open tab is not conclusively proven.

The older two Note 13 Pro records and Desktop Chrome were preserved. A total of four rows was observed immediately afterwards. Temporary registration was disabled again in **Supabase** and **Vercel**, and a new closed-gate Production Vercel deployment reached READY. Test and automatic safety notification gates remained OFF; no provider call was made.

## Proposed fail-closed fix

- The regular new-device path must now send exactly `{operation:"register",subscription,label}`. The server rejects the legacy two-field envelope with HTTP 409 `PUSH_CLIENT_OUTDATED` **before** the owner RPC can INSERT another row. No client can specify its own VAPID public key; the backend supplies it.
- The selected-device renewal keeps using exactly `{operation:"renew",deviceId,fingerprint,subscription,label}` and still routes to `my_push_renew` for a same-ID UPDATE.
- Authenticated `/api/push` responses include `pushProtocolVersion:2` as a public contract marker. The new browser checks the version before any browser unsubscribe and stops with a BG/EN explanation if the server is incompatible.
- If a tab from before this PR remains open, the server can reject its old request without writing another device row. A stale tab may already have unsubscribed locally before getting HTTP 409; the user must reopen the current site and verify the active subscription. **Do not automatically retry, delete records or silently resubscribe.**
- There is **no SQL migration** in this fix, and no change to the worker, VAPID keys, registration/test-delivery flags, operator permissions, or weather/earthquake push.

## How to review and recover

1. Verify GitHub unit, TS build/lint and local Chromium synthetic tests; no live FCM call or production database use.
2. After manual PR review and merge, let the normal main production deployment finish. Keep all registration and delivery gates OFF until a separately authorized test.
3. On the Redmi: close the old tab entirely and open the official Production site from a fresh tab, then use the read-only **Check registration** button on the newest, matching Note 13 Pro. Do not use **Renew** again merely because a duplicate exists.
4. Do not delete the old Note 13 Pro entries until the new subscription's owner-scoped fingerprint, key proofs and controlled delivery are verified. A matching local fingerprint alone is **not** evidence of FCM delivery.
5. Any later single-device FCM test requires explicit approval, a scoped target/permit and immediate gate shutdown; never enable the automatic safety sender as part of diagnosis.

The browser-visible mismatch is now safer, not proven cured: provider HTTP 400 remains independently unresolved until an explicitly approved real-device test.
