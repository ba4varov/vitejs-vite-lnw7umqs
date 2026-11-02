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

## Future procedure: three separate stages

These are **future, separately authorized operator actions**. Editing/reviewing this
draft does not authorize deployment, migration, registration or a real notification.
The user verified that Production currently has both
`PUSH_REGISTRATION_ENABLED=false` and `PUSH_SESSION_TEST_ENABLED=false`.
Changing a Vercel environment value alone does not update the running deployment:
every flag transition below requires a new Production deployment and verification
on the **active Production domain/alias**, not just a deployment URL or dashboard value.
Never promote/reuse an old deployment that was built with either flag enabled.

### Before any stage: capture the baseline and establish exclusive ownership

1. Review/merge, deploy and apply the migration only through a separately authorized
   rollout. Confirm the new session target is NULL and delivery is false. Keep both
   Vercel flags false. Do not rotate VAPID keys or modify existing device registrations.
2. Reserve an exclusive maintenance/test window: no concurrent old Node operator,
   session tests or control changes. Record a run start timestamp, intended owner UUID,
   desktop UUID when identified, and every prepared permit UUID. Stop if an existing
   permit/lease is active, a cooldown has not elapsed, or a baseline gate is unexpectedly
   open. Do not clear a lease, unpause throttling or reset cooldown to force readiness.
3. Save the following safe baseline in a private operator worksheet, outside the repo,
   PR, application logs and analytics. Preserve exact booleans, NULLs, UUIDs and timestamps:

   ```sql
   select registration_enabled, registration_test_user_id, operator_admin_id,
          operator_paused, test_delivery_enabled, operator_permit_id,
          operator_expires_at, next_test_after, session_target_device_id
   from public.push_controls where singleton;
   ```

   Require `registration_enabled=false`, `registration_test_user_id IS NULL`,
   `test_delivery_enabled=false`, `session_target_device_id IS NULL`,
   `operator_permit_id IS NULL`, `operator_expires_at IS NULL`, and no unrevoked
   session permits before proceeding. If not, stop and resolve separately.
   **Do not require or force a particular baseline `operator_paused` or
   `operator_admin_id`.** Save their actual values for exact restoration.
4. Record the Production deployment identity and non-secret flag values, including
   `PUSH_NODE_OPERATOR_ENABLED` and any pre-existing `PUSH_TEST_DELIVERY_ENABLED`
   setting (including whether unset). Keep all old Node operator environment values,
   its token and keys unchanged throughout; never copy or print credential values.
5. Identify all existing Redmi registration UUIDs before the window. Save only an
   integrity digest and safe metadata for each row; the endpoint/keys must never
   leave the database. Use the exact same UUID set after the window:

   ```sql
   select d.id,d.user_id,d.created_at,d.updated_at,
          encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') as row_integrity
   from public.push_devices d
   where d.id in ('<REDMI_DEVICE_UUID>'::uuid); -- Include every known Redmi row.
   ```

   Record the returned count and UUID set as well as the digests. Labels alone cannot
   identify the baseline. Any missing/added/changed Redmi row at final comparison
   requires investigation; do not attempt automatic repair, deletion or re-registration.

### Stage A — register desktop Chrome; no test preparation or sending

1. Verify the intended account and its ownership. In Supabase temporarily set
   `registration_enabled=true` and `registration_test_user_id=<OWNER_UUID>`.
   Leave `test_delivery_enabled=false` and `session_target_device_id=NULL`.
   Do not change the old operator settings.
2. In **Vercel Production**, temporarily set `PUSH_REGISTRATION_ENABLED=true`;
   keep `PUSH_SESSION_TEST_ENABLED=false`. Create a new Production deployment,
   wait for readiness, confirm the Production domain points to that deployment,
   and verify its effective registration state in authenticated Push settings.
   Registration is authorized only while both the Vercel and Supabase gates agree.
3. In the intended desktop Chrome profile, sign in as the same owner and use a unique
   label such as `Desktop Chrome — one-shot test`. Use the existing explicit
   registration button and grant Chrome notification permission. Never renew, delete,
   relabel or otherwise operate on Redmi. If Chrome is already registered, verify
   that existing registration read-only instead of renewing it.
4. **Immediately after a confirmed successful save**, close Supabase registration
   (`registration_enabled=false`, `registration_test_user_id=NULL`) and set
   **Vercel Production `PUSH_REGISTRATION_ENABLED=false`**. Create another
   Production deployment and verify the active Production domain uses it.
   Keep `PUSH_SESSION_TEST_ENABLED=false` throughout. Verify the authenticated
   registration state is disabled and both Supabase registration fields are closed.
   Do not submit a registration POST just to verify closure.
5. Identify the desktop row without reading an endpoint or key:

   ```sql
   select id,user_id,label,created_at,updated_at
   from public.push_devices where user_id='<OWNER_UUID>'::uuid
   order by created_at desc;
   ```

   Match the unique label, owner, current-browser registration and read-only key checks;
   confirm its UUID differs from every recorded Redmi UUID.

**Abort Stage A:** on permission denial, failed/ambiguous save, mismatch or deployment
failure, immediately close the Supabase gate and set the Vercel registration flag
false, deploy and verify the active Production domain. Leave the session flag false
and session target NULL. Do not resubscribe, unsubscribe or retry an ambiguous save;
first inspect safe metadata to establish whether the same registration was stored.
If the closing deployment cannot become active, keep the DB gate closed, stop the
procedure and report incomplete deployment cleanup. No sending is authorized.

### Stage B — prepare the target; session sending remains disabled

1. Confirm Stage A closure, the exclusive window, elapsed cooldown and empty lease.
   Verify the account is an unbanned current administrator with an active eligible
   subscription. Save any preferences before proceeding. Check the root Meteo Pulse
   worker, current Chrome registration, VAPID key and both p256dh/auth proofs read-only.
   `FCM` must be `fcm-wp` or `fcm-send`; stop on `unsupported` or any unavailable
   or mismatched check.
2. With separately approved preparation, temporarily select the intended operator
   and the single desktop target under the controls lock. The following change to
   shared old-operator DB settings is temporary: retain the baseline from above.

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
     and not c.registration_enabled and c.registration_test_user_id is null
     and not c.test_delivery_enabled and c.session_target_device_id is null
     and c.next_test_after<=clock_timestamp()
     and c.operator_permit_id is null and c.operator_expires_at is null;
   -- Verify exactly one UPDATE before COMMIT; otherwise ROLLBACK and stop.
   commit;
   ```

   Recheck immediately before this transaction that shared operator values still
   equal the saved baseline. If they changed, stop; do not overwrite another operator.
   Never unpause a rate-limit stop without separate review.
3. Keep **both Vercel flags false**. The session route correctly reports
   `configuration:disabled` at this stage; it cannot prepare a browser permit.
   Verify the selected target/owner through safe DB metadata. Do not click Send or
   call prepare/send APIs. Do not interpret target preparation as permission to send.

**Abort Stage B:** if any check fails or approval is withdrawn, clear the session
target, revoke only this run's session permits if any, close its lease, and restore
the saved old-operator DB settings using the shutdown procedure below. Keep both
Vercel flags false; verify their active Production deployment. Do not start Stage C.

### Stage C — separately authorize and send exactly once

1. Obtain **explicit approval for one real notification to this exact desktop UUID**.
   Only then temporarily set **Vercel Production
   `PUSH_SESSION_TEST_ENABLED=true`**, keep `PUSH_REGISTRATION_ENABLED=false`,
   and create a new Production deployment. Verify the active Production domain
   points to it. Do not enable the old Node operator environment flag or change its
   token/keys. Confirm Supabase registration remains closed and the desktop target
   and temporary operator settings still match the approved values.
2. Reload desktop Push settings on the active Production address. Verify the named
   target/UUID, matching current browser, both keys, saved consent/category and safe
   FCM shape. A mismatch, disabled route or unavailable check means stop, not fallback.
3. Click Send once. This starts the application's bounded permit preparation; record
   its UUID in the private run worksheet if available. Review the actual device-specific
   confirmation for exactly ONE notification. Cancel if anything differs. The app
   revalidates before sending; final SQL authorization burns the permit and clears
   the target before FCM. Never click again after any refusal, lost or unknown response.
   Inspect Chrome visually: FCM acceptance is not delivery confirmation.
4. **Immediately after the attempt, cancellation or any error**, set
   **Vercel Production `PUSH_SESSION_TEST_ENABLED=false`**, keep registration false,
   and create a closing Production deployment. In parallel with arranging that
   deployment, close this run's DB target/permits/lease using the procedure below.
   Verify the **active Production domain** now points to the closing deployment
   built with both flags false. Do not stop at an environment-variable edit.

**Abort Stage C:** failed deployment, changed identity/registration, expired permit,
missing confirmation, provider refusal or ambiguous result all go directly to
shutdown, never retry or fallback. A request already authorized/in flight cannot be
recalled by closing a gate. Wait for the existing maximum 40-second server request
deadline to settle, then repeat closure verification; do not infer nondelivery from
a closed gate. If deployment/DB cleanup fails, keep every gate you can close closed,
report the remaining failure and stop. Do not restore or promote an enabled deployment.

## Separate shutdown and exact restoration after any stage

Use the baseline and exclusive-window checks; do not invent default operator values.
The following SQL is a **template**, not a ready-to-run script: substitute the saved
boolean and UUID-or-NULL literals, run start timestamp, owner and desktop UUID first.
Before restoring operator fields, check that no new rate-limit pause was raised.
If throttling or another operator changed them, skip that restoration and report it
for explicit review; never bypass a new protection to recover the old baseline. Close the session-specific target/permits promptly
even if restoration needs manual reconciliation.

```sql
begin;
select singleton from public.push_controls where singleton for update;
update public.push_controls
set session_target_device_id=null, test_delivery_enabled=false,
    registration_enabled=false, registration_test_user_id=null
where singleton;

-- Revoke this run only; preserve earlier permits and all delivery history.
-- The timestamp also covers a prepared permit whose response/UUID was lost.
update public.push_test_permits
set revoked=true, operator_armed_at=coalesce(operator_armed_at,clock_timestamp())
where session_scoped
  and approved_by='<OWNER_UUID>'::uuid and user_id='<OWNER_UUID>'::uuid
  and device_id='<DESKTOP_DEVICE_UUID>'::uuid
  and created_at>='<RUN_START_UTC>'::timestamptz;

-- Preflight required an empty lease; clear only a lease belonging to this run.
update public.push_controls c
set operator_permit_id=null, operator_expires_at=null
where c.singleton and exists (
 select 1 from public.push_test_permits t
 where t.id=c.operator_permit_id and t.session_scoped
   and t.approved_by='<OWNER_UUID>'::uuid and t.user_id='<OWNER_UUID>'::uuid
   and t.device_id='<DESKTOP_DEVICE_UUID>'::uuid
   and t.created_at>='<RUN_START_UTC>'::timestamptz
);

-- Only if Stage B changed these fields and their current values still belong
-- to this run: restore the exact saved values, including a previously NULL admin.
update public.push_controls
set operator_paused=<SAVED_OPERATOR_PAUSED_BOOLEAN>,
    operator_admin_id=<SAVED_OPERATOR_ADMIN_UUID_OR_NULL>
where singleton and operator_admin_id='<OWNER_UUID>'::uuid
  and not operator_paused;
-- If this guarded restoration affects zero rows, stop for reconciliation;
-- never force an overwrite of a new pause or another operator's selection.
-- Do NOT assign next_test_after. Do NOT reset/shorten cooldown.
commit;
```

If Stage A aborted before any desktop UUID exists, no session target/permit was
authorized and no operator settings were changed: close the two registration gates,
verify session target/lease remain NULL, and skip the run-permit/operator restoration
statements. Never execute placeholders or blanket-revoke unrelated operator permits.

Restore/verify the old Node operator's Vercel values against the saved baseline;
they should be unchanged. **Do not automatically set `operator_paused=true` or
`operator_admin_id=NULL`**: restore exactly their prior values. If their baseline
allows the separate Node operator, that is distinct from session test closure and
must not be silently disabled or re-enabled by this procedure.

Read-only SQL closure checks (then compare the operator values/cooldown with the
private baseline; those comparisons are not replaced by assuming default values):

```sql
select not registration_enabled and registration_test_user_id is null as registration_closed,
       session_target_device_id is null as target_closed,
       not test_delivery_enabled as delivery_closed,
       operator_permit_id is null and operator_expires_at is null as lease_closed,
       operator_paused,operator_admin_id,next_test_after
from public.push_controls where singleton;
select count(*) as unrevoked_session_permits
from public.push_test_permits where session_scoped and not revoked;
```

All four closure booleans must be true and the permit count must be zero.
Complete all of these checks after shutdown (and again after any in-flight deadline):

- On the **active Production domain**, verify the closing deployment identity and
  effective `PUSH_REGISTRATION_ENABLED=false` and `PUSH_SESSION_TEST_ENABLED=false`.
  In the authenticated UI registration must be disabled. A read-only session
  `operation:access` POST to `/api/push-operator` must return HTTP 503 with
  `code:configuration:disabled`. Never use prepare/send or registration as a probe;
  keep credentials in redacted Authorization handling, never logs or shell history.
- Supabase: registration is false with NULL registration user; session target is NULL;
  delivery is false; operator permit/expiry are NULL. No unrevoked session permits
  may remain. Compare `operator_paused` and `operator_admin_id` with their saved
  baseline using NULL-safe equality (`IS NOT DISTINCT FROM`).
- Compare `next_test_after` with the saved baseline: it must never be moved earlier.
  Preserve any later value, including infinity or a provider-throttling extension.
  Do not restore the old timestamp after a claim. If a rate-limit stop changed
  `operator_paused`, stop for explicit review rather than restoring a value that
  would bypass that new protection.
- Repeat the exact Redmi metadata/digest query with the original UUID set; require
  identical row count, IDs, ownership, timestamps and integrity digests. Do not
  inspect/export endpoints or keys. Preserve desktop registration, cooldowns,
  delivery history and all VAPID keys as well.
- If any check fails, report incomplete cleanup and do not resume testing.
  A later test requires a new explicit authorization and target selection.

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
