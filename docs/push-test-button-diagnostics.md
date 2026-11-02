# Push test button diagnosis

Scope: client-only changes after PR #120. No live Push, Supabase writes, deployment, environment or key changes. All browser account APIs are intercepted fixtures.

## Proven defects versus incident attribution

The old handler had no initial status. Its registration check awaited browser APIs without a deadline. It silently returned when the diagnostic epoch changed, when the second session check failed, and when confirm returned false (including browser-suppressed dialogs). The epoch effect depends on access_token: restoreSession can rotate tokens, publish a new session and cause React to invalidate an in-flight attempt. Unmount also invalidates it. HTTP errors were parsed without checking response.ok and malformed responses collapsed into network:unknown.

These defects are reproducible client paths. Zero preparation/attempt/delivery records alone cannot identify which path occurred on Redmi; there is no historical client trace. A preparation rejected before its database write also produces no preparation row. Local showNotification success proves neither subscription identity nor end-to-end delivery.

## Complete client path and exits

1. Access POST: restore same account, then default-disabled operator authorization. Access pending/refused/failed now has a visible code; it never authorizes the button on failure.
2. Button disabled: busy, unsaved preferences, unsupported browser, target device missing. A visible explanation accompanies disabled controls.
3. Click lock/busy/dirty guard: no request, visible blocked reason.
4. Target device, permission and support checks: no prepare on failure.
5. Read-only registration check: public key, secure context, root active worker/script/scope, PushManager, subscription, application key, endpoint fingerprint. Preserve precise registration status. Bound to 10 seconds; late completion cannot continue the handler.
6. Epoch/liveness guard: token/account change or unmount invalidates the operation. Mounted UI reports interrupted/unconfirmed. Unmounted components cannot display status; no confirmation or send follows.
7. Prepare: restore session, same-account guard, single POST with category and request UUID; require device:ready and permit. No retry.
8. Recheck session and epoch after every asynchronous boundary. Any failure prevents confirmation/send. An unused permit is cancelled once in finally, best effort, with no retry.
9. Native confirmation: false means no confirmation received, whether dismissed or suppressed. Visible cancelled status; no send. Check epoch again before send.
10. Consume local permit before one send request. Never cancel/replay an unknown send. Report FCM acceptance as unconfirmed phone delivery. Known HTTP diagnostic codes and numeric statuses survive; arbitrary body strings are excluded.
11. Finally releases local UI locks. Server one-attempt authorization and all existing protective checks remain unchanged. No automatic send retries are introduced.

Unmount makes the component unavailable by definition; this change does not persist diagnostics or credentials outside it. Cancellation failure cannot revoke a consumed attempt and is not retried.

## Validation

- Complete Chromium Push suite: 68 passed. After the final diagnostic-category filtering change, the focused BG/EN session suite passed 24/24, including provider HTTP refusal and untrusted diagnostic bodies.
- Browser fixtures cover missing registration, explicit dismissal, suppressed confirmation (no dialog displayed), token rotation while registration is pending (zero prepare/send), registration timeout with late completion, HTTP 403, malformed HTTP 503, lost prepare response and lost send response (one send, no replay).
- `npm test`: 2164 total, 2153 passed, 0 failed, 1 skipped, 10 pre-existing TODO.
- `npm run build`, `npm run typecheck`, `npm run lint`, `git diff --check`: passed. Lint retains two existing no-unsafe-finally warnings in scripts/push-node-operator.mjs.
- No changes to server/API, Supabase files, dependencies, VAPID, Vercel configuration, or the disabled test flag. No real phone delivery or Production deployment was attempted.
