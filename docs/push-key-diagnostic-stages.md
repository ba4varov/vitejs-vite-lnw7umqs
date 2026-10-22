# Push key diagnostic stages

Based on main `40cba1602f7a53464fc5090c5c08d9c3e0ffda96` (verified with GitHub).

## Proven finding

The previous UI cannot identify the Redmi failure. `checkPushKeys` catches all
exceptions and returns two unavailable statuses; `requestPushKeyCheck` discards
all non-2xx responses; the API discards RPC HTTP errors, parsing failures and
transport exceptions. Successful registration checks only local subscription,
endpoint fingerprint and VAPID identity. They do not exercise the diagnostic API,
Auth verification, RPC execution or stored encryption key comparison.

The API already forwards the current user JWT to both Auth and RPC (the anon key
is only the apikey header). Therefore anon lacking EXECUTE is expected and is not
proof of the cause. Existence and authenticated EXECUTE alone do not establish
PostgREST schema-cache visibility, the deployed API configuration, session validity,
transport success, or successful execution of the function body.

## Safe capture

After a separately approved deployment of this change, open Push settings in
Chrome on the same Redmi, select the same first Note 13 Pro record and press
**Провери p256dh/auth / Check p256dh/auth**. Share only the two status words and
**Диагностичен етап / Diagnostic stage** code. No DevTools, request dumps or tokens
are needed. This PR performs no deployment.

| Code | Meaning / next evidence |
| --- | --- |
| session:* | Session gate before browser work, before HTTP, or after HTTP rejected/failed. |
| registration:rejected | Local registration precondition failed during this check. Re-run the separate registration check. |
| browser:subscription | Reading worker/subscription failed. |
| browser:identity | Subscription changed or selected record identifier is invalid. |
| browser:crypto | Browser digest/random generation failed. |
| browser:key-read / key-format / key-missing | getKey failed, bytes invalid, or key absent. |
| request:transport / timeout | Browser could not complete the application API request. |
| request:http / response | Gateway/non-diagnostic HTTP failure or invalid application response (including an older deployment). |
| api:configuration / method / input | Missing server configuration, wrong method, or invalid proof request. |
| auth:rejected / http / transport / timeout / response | Auth rejected the JWT, service HTTP failure, transport failure, timeout, or invalid Auth JSON/user shape. |
| rpc:unauthorized / forbidden / not-found / rejected | RPC returned HTTP 401 / 403 / 404 / other failure without a recognized code. |
| rpc:schema-cache | PostgREST PGRST202: signature not found in schema cache; this does not prove SQL function absence. |
| rpc:sql-permission | SQL 42501: insufficient privilege, including explicit account/session guard. Does not prove missing EXECUTE. |
| rpc:sql-ambiguous / sql-function | SQL 42702 / 42883: ambiguous reference / undefined function. |
| rpc:transport / timeout / response | RPC transport failure, timeout, or invalid JSON/result contract. |
| rpc:result-unavailable | RPC succeeded with unavailable status. Existing SQL deliberately merges ownership/fingerprint gate failure and malformed stored keys/helper failures. Requires private, authorized DB investigation; do not infer missing keys or expose record existence. |
| rpc:complete | RPC comparison completed (match, mismatch or missing). Does not establish delivery. |

Only fixed allowlisted strings are rendered. Unknown upstream codes map to a
fixed fallback. Raw messages, hints, details, payloads, HTTP headers, tokens,
keys, endpoints, fingerprints, nonces and UUIDs are never added to diagnostics.
The existing proof protocol still sends its required identifiers/digests to the
same authenticated API; they are not diagnostic output. No new logs, storage,
telemetry, clipboard collection, SQL migration, grants, registration mutation,
VAPID changes, operator changes or notification sending are introduced.

Browser key failures take precedence in the displayed code when RPC succeeds;
HTTP/RPC failures take precedence when the request fails. The two original key
statuses remain independent. Existing session/epoch guards suppress stale UI
results. Older successful API responses without a diagnostic code remain accepted.

## Validation

Synthetic unit tests cover browser gates/key failures, session changes, proof-only
payloads, API validation, Auth/RPC transports/timeouts/JSON errors, allowlisted SQL
codes, unknown/private error redaction, and a browser → client → API RPC failure.
BG/EN Playwright regression scenarios also assert safe stage rendering and
rejection of arbitrary diagnostic strings. All browser/API fixtures are synthetic;
no real notification, physical Redmi capture or Production DB access is involved.

Recorded checks:

- `npm run build`: passed (TypeScript projects and production bundle).
- `npm run lint`: passed; two pre-existing no-unsafe-finally operator warnings.
- `npm test`: 2122 passed, 0 failed, 10 existing TODO, 1 skipped (2133 total).
- Final focused unit suite: 20/20 passed (includes two subsequent contract/session regressions).
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/push.spec.ts --workers=1`: 47/47 passed on final code, including BG/EN safe stage rendering and simulated registration/renewal regressions.
- `git diff --check`: passed.

Initial sandbox runs could not access the package proxy or isolate test workers;
checks were completed with supported network/local-server access. Dependencies
were installed with scripts disabled; no application credentials were read.
