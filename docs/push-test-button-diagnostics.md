# Push test button diagnosis

Scope: client-only changes after PR #120. No live Push, Supabase writes, deployment, environment or key changes. All browser account APIs are intercepted fixtures.

## Proven defects versus incident attribution

The old handler had no initial status. Its registration check awaited browser APIs without a deadline. It silently returned when the diagnostic epoch changed, when the second session check failed, and when confirm returned false (including browser-suppressed dialogs). The epoch effect depends on access_token: restoreSession can rotate tokens, publish a new session and cause React to invalidate an in-flight attempt. Unmount also invalidates it. HTTP errors were parsed without checking response.ok and malformed responses collapsed into network:unknown.

These were reproducible client paths in the original implementation. The same-account token interruption is now removed, as described below. Zero preparation/attempt/delivery records alone cannot identify which path occurred on Redmi; there is no historical client trace. A preparation rejected before its database write also produces no preparation row. Local showNotification success proves neither subscription identity nor end-to-end delivery.

## Complete client path and exits

1. Access POST: restore same account, then default-disabled operator authorization. Access pending/refused/failed now has a visible code; it never authorizes the button on failure.
2. Button disabled: busy, unsaved preferences, unsupported browser, target device missing. A visible explanation accompanies disabled controls.
3. Click lock/busy/dirty guard: no request, visible blocked reason.
4. Target device, permission and support checks: no prepare on failure.
5. Read-only registration check: public key, secure context, root active worker/script/scope, PushManager, subscription, application key, endpoint fingerprint. Preserve precise registration status. Bound to 10 seconds; late completion cannot continue the handler.
6. Epoch/liveness guard: account change, logout or unmount invalidates the operation synchronously through the session subscription. Same-account token rotation preserves the epoch. Even a batched account A → B → A change invalidates the old operation. Unmounted components cannot display status; no confirmation or send follows.
7. Prepare: restore session, same-account guard, single POST with category and request UUID; require device:ready and permit. No retry.
8. Recheck session and epoch after asynchronous boundaries. Before confirmation and again after confirmation, reload administrator access and the current preference/device snapshot, check consent/category/city and VAPID consistency, and repeat the bounded local registration/permission check. Any failure prevents send. An unused permit is cancelled once in finally, best effort, with no retry.
9. Native confirmation: false means no confirmation received, whether dismissed or suppressed. Visible cancelled status; no send. Check epoch again before send.
10. Resolve the latest same-account, non-expired session immediately before the single send fetch; check lifecycle once more after the async restore and before fetch. Consume local permit before one send request. Never cancel/replay an unknown send. Report FCM acceptance as unconfirmed phone delivery. Known HTTP diagnostic codes and numeric statuses survive; arbitrary body strings are excluded.
11. Finally releases local UI locks. Server one-attempt authorization and all existing protective checks remain unchanged. No automatic send retries are introduced.

Unmount makes the component unavailable by definition; this change does not persist diagnostics or credentials outside it. Cancellation failure cannot revoke a consumed attempt and is not retried.

## Same-account refresh continuation

`App` keeps `AuthPanel` mounted. `AuthPanel` subscribes to session changes without resetting the profile view on a token rotation; its Push child key is `push-` plus user ID, not the token. Profile tabs hide panels rather than unmounting them. No parent component change is required. Browser tests retain the actual Push section DOM node through each rotation.

The Push lifecycle subscription now distinguishes account identity from token value. Token-dependent access checks may update button availability but do not invalidate an in-flight attempt. Preference loading and liveness are no longer reset by a token refresh. Every operator request uses `accountSession` to obtain the latest token for the original account and rejects missing, changed or expired sessions. The send request additionally checks the captured operation epoch after that asynchronous session resolution, closing the unmount/account-switch race immediately before fetch.

Refresh before prepare, after prepare and after explicit confirmation can therefore continue with the new bearer token. This does not reuse authorization decisions across the final send: current rights, consent, device/VAPID and local registration are checked again after confirmation. The unchanged server then performs its authoritative atomic SQL checks. Loss of rights or consent and invalid registration still stop the operation. A send with unknown outcome is never retried or cancelled as an unused permit.

Tests use only synthetic tokens and mocked API/auth responses, including the actual shared auth refresh path with an expired synthetic session. Account switch, logout and batched A → B → A changes are tested at all three boundaries. Server, SQL, Vercel, VAPID, dependencies and deployment configuration are unchanged; the test flag stays off.

## Final validation

- Full Chromium Push browser suite: **91 passed**. Includes refresh before prepare, after prepare, and after explicit confirmation before send, in BG/EN; exact latest bearer token and one send are asserted. A mocked automatic auth refresh also succeeds without remounting.
- Account switch, logout, and batched A → B → A invalidate the original operation at all three boundaries; no send. Final rights, consent and registration revocation tests also stop before send.
- Unknown send outcome remains one request, without replay; existing confirmation and diagnostic regressions pass.
- `npm test`: **2167 total, 2156 passed, 0 failed, 1 skipped, 10 pre-existing TODO**. Three new client tests verify latest-token selection, lifecycle invalidation during async restore, and unknown-result no-retry behavior.
- Lint, typecheck, build and diff whitespace checks passed. Lint retains two existing no-unsafe-finally warnings in scripts/push-node-operator.mjs.
- Parent components were inspected and kept unchanged. Server/API, SQL/Supabase, Vercel/VAPID configuration and dependencies are unchanged. No true tokens, live Push traffic, Production deployment or flag enablement were used.
