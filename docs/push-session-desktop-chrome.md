# One-shot desktop Chrome session test — proposed rollout only

This PR does not authorize any device. The new `push_controls.session_target_device_id`
is NULL by default. Existing registrations, preferences, VAPID keys and deployment
configuration are untouched. Preview remains unable to contact control/provider APIs.
Only synthetic subscriptions are used in automated tests.

## Controls and guarantees

The selected DB operator must be a current administrator and own the selected device.
The browser cannot supply a target user/device, endpoint, payload or provider options.
`push_session_target` supplies the server's target; `prepare_push_session` independently
chooses it under the controls lock. `push_session_scope` checks the server's permit
before arm, and `push_session_permit` independently checks it again in SQL. Only
session-scoped permits are accepted. `push_test_allowed` rechecks the current target
at claim and final authorization, in addition to all existing revisions, consent,
account, subscription, cooldown and expiry checks.

Preparation expires in two minutes, the armed lease lasts at most 60 seconds, and
the claim must be authorized within 30 seconds. There is one claim and one burned
provider attempt. Final authorization closes the gate, revokes the permit and clears
the selected session target before FCM. Concurrent/replayed sends cannot reuse it.
Provider acceptance does not prove delivery. Unknown responses are never retried.
The existing separate CLI operator path retains its independent token and DB controls;
it cannot produce a permit accepted by the browser session adapter.

The UI checks the current root Meteo Pulse worker, subscription fingerprint and VAPID
key, then verifies nonce-bound p256dh/auth proofs before confirmation and again before
send. The send button is disabled until the browser matches the allowed target. The
confirmation includes the selected label and UUID. `FCM` shows only `fcm-wp`, `fcm-send`
or `unsupported` from a read-only lookup of the current subscription. Neither the
endpoint nor its token is displayed, logged or persisted by this diagnostic.

## Later: register and explicitly authorize desktop Chrome

These are **future, separately authorized operator steps**, not actions performed by
this PR. Do not run them merely to review the draft.

1. Review/merge/deploy separately, then apply the new migration through the normal
   reviewed migration process. Verify the target is NULL and test delivery is false.
   Existing required server flags/secrets must already be approved and configured;
   if the session route reports `configuration:disabled`, stop. This procedure does
   not require rotating keys or changing Vercel environment variables.
2. Record the existing safe control values (booleans, timestamps and selected UUIDs
   only) for review. Do not select/export keys, endpoints, subscriptions or tokens:

   ```sql
   select registration_enabled, registration_test_user_id, operator_admin_id,
          operator_paused, test_delivery_enabled, operator_permit_id,
          operator_expires_at, next_test_after, session_target_device_id
   from public.push_controls where singleton;
   ```

3. Identify the intended account UUID. Check its current admin membership and active,
   unbanned account/subscription. In a privileged SQL session, allow registration
   only for that user, keeping delivery and the test target closed:

   ```sql
   begin;
   update public.push_controls
   set registration_enabled=true, registration_test_user_id='<OWNER_UUID>'::uuid,
       test_delivery_enabled=false, session_target_device_id=null
   where singleton;
   commit;
   ```

4. On the intended desktop Chrome profile, sign in as that same user, open Push
   settings, set a unique label such as `Desktop Chrome — one-shot test`, and use
   the existing explicit registration button. Grant permission in Chrome. Do not
   renew, delete, relabel or otherwise operate on Redmi. If the desktop is already
   registered, use the read-only registration/key checks instead of renewing it.
   Do not re-register after an ambiguous registration result without first checking
   whether the same registration was stored.
5. Close the registration gate immediately after confirming that registration:

   ```sql
   update public.push_controls
   set registration_enabled=false, registration_test_user_id=null
   where singleton;
   ```

6. Identify the desktop row without reading any endpoint or key:

   ```sql
   select id,user_id,label,created_at,updated_at
   from public.push_devices where user_id='<OWNER_UUID>'::uuid
   order by created_at desc;
   ```

   Copy the desktop UUID only after matching the unique label and successful
   current-browser registration/key checks. Labels alone are not authorization.
   Confirm that the UUID is not Redmi. Select the sole operator/target under lock;
   the guarded update must affect exactly one row (otherwise roll back and stop):

   ```sql
   begin;
   select singleton from public.push_controls where singleton for update;
   update public.push_controls c
   set operator_admin_id='<OWNER_UUID>'::uuid, operator_paused=false,
       session_target_device_id=d.id, test_delivery_enabled=false
   from public.push_devices d
   join public.admin_memberships a on a.user_id=d.user_id
   join auth.users u on u.id=d.user_id
   where c.singleton and d.id='<DESKTOP_DEVICE_UUID>'::uuid
     and d.user_id='<OWNER_UUID>'::uuid
     and (u.banned_until is null or u.banned_until<=clock_timestamp())
     and (to_jsonb(u)->>'deleted_at') is null
     and c.next_test_after<=clock_timestamp()
     and c.operator_permit_id is null;
   -- Verify exactly one UPDATE before COMMIT; otherwise ROLLBACK.
   commit;
   ```

   Do not reset cooldown, override throttling, extend leases or clear an existing
   operator permit to force readiness. Resolve any existing lease first.
7. Reload Push settings in desktop Chrome. Verify `Authorized device` names the
   desktop UUID, `FCM` is `fcm-wp` or `fcm-send`, browser registration matches and
   both key checks match. Ensure saved preferences enable the intended city/category.
   Stop on `unsupported`, any mismatch, missing permission or unavailable check.
8. Only after separate approval for the real test, click Send once and review the
   device-specific confirmation for exactly ONE notification. Cancel if anything
   differs. Do not click again after any unknown, refused or lost response. Inspect
   the desktop visually; FCM acceptance is not delivery confirmation. Successful
   authorization automatically clears the session target before contacting FCM.

## Separate shutdown procedure after the future test (including failed/unknown tests)

Run promptly after the single attempt or cancellation. Do not retry to diagnose an
unknown result. A request already authorized/in flight cannot be recalled by changing
DB controls. Allow the existing maximum 40-second server request deadline to settle,
then perform/verify shutdown again; do not infer nondelivery from a closed gate.

```sql
begin;
select singleton from public.push_controls where singleton for update;
update public.push_controls
set session_target_device_id=null, test_delivery_enabled=false,
    registration_enabled=false, registration_test_user_id=null,
    operator_paused=true, operator_admin_id=null,
    operator_permit_id=null, operator_expires_at=null
where singleton;
update public.push_test_permits
set revoked=true, operator_armed_at=coalesce(operator_armed_at,clock_timestamp())
where session_scoped;
commit;

select session_target_device_id is null as target_closed,
       not test_delivery_enabled as delivery_closed,
       not registration_enabled and registration_test_user_id is null as registration_closed,
       operator_paused and operator_admin_id is null as operator_closed,
       operator_permit_id is null and operator_expires_at is null as lease_closed
from public.push_controls where singleton;
```

All five checks must be true. Reopen desktop settings and verify no target/send access;
no notification is needed for this verification. Preserve cooldowns, delivery history,
VAPID keys and all device registrations (especially Redmi). This intentionally restores
closed restrictions, not a previously open gate. Reauthorizing any later test requires
another explicit target selection and approval. No rollback to the fixed Redmi UUID
is necessary or recommended.

## Verification

- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- `node scripts/test-push-session-sql.mjs`: all migrations and synthetic scenarios in
  disposable PostgreSQL 17, `--network none`, no database URL accepted.
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/push.spec.ts`: isolated
  browser fixtures; account and Push API requests are intercepted.
- Existing complete admin SQL suite also applies the migration and runs the new SQL
  scenarios, after verifying the earlier fixed-scope migration against its old contract.

### Results on this draft

- Build and TypeScript passed. Lint passed with the two existing `no-unsafe-finally`
  warnings in `scripts/push-node-operator.mjs`; no new lint warnings.
- Complete unit suite: 2205 tests, 2194 passed, 0 failed, 1 skipped, 10 existing TODO.
- Push-only unit/transport suite: 169 tests, 168 passed, 1 skipped, 0 failed.
  The final ownership check and endpoint diagnostic tests also passed after review.
- All migrations plus the SQL target scenarios passed on disposable PostgreSQL 17.
- Chromium Push suite: 100/101 passed initially; the single timeout occurred in the
  existing preference-checkbox setup before the tested operation and passed on
  isolated rerun. The additional changed-key test passed (102 scenarios verified
  across these runs). No real subscription or Push provider was used.
- The optional Edge Runtime suite was not run: its required pre-cached Deno
  dependencies/Edge Runtime image are absent. The changed path uses the Node route.
