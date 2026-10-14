# Favorite places synchronization diagnosis

Base: `b3ceeb834de225690469597f84b65f0c846ebc16`, current main after merged PR #88. The places client, session refresh and account-loading code predate #88; the planner presentation changes are not implicated.

## Confirmed findings

1. `restoreSession()` publishes a stored session before awaiting its refresh. `App.subscribeSession` starts `loadAccountPlaces`, which previously sent the captured access token straight to REST. A slow refresh can therefore leave both reads using an expired token. The same-account refresh notification updates the session but intentionally skips reloading places, leaving the initial error visible. The new slow-refresh browser regression fails on unchanged main with zero place chips, and succeeds with the fix.
2. A REST 401 previously had no refresh/retry path. The automatic recovery regression also fails on unchanged main. The fix permits one refresh and one retry of a read, using the shared auth promise and cross-tab lock. Writes do not automatically replay. A concurrent no-op session restore must finish before a forced 401 refresh; otherwise the rejected but locally unexpired token could be returned again. A dedicated unit regression covers this race. A token rotated by another tab while waiting for the lock is reused.
3. `rest()` previously threw backend message text, losing HTTP status, error code and source at the UI boundary. `placesError` was boolean. Every source and failure looked identical, so the supplied Production symptom alone cannot establish which request failed.
4. JSON parse failures became `null`; `favorite_places` null became an empty array and missing settings became a null default. This could silently replace valid client state. A successful snapshot now requires both array responses, valid essential place fields and a settings row shape. `[]`/`[]` is a valid empty account. The same validation is used for add responses, so a partial returned row cannot create a malformed local favorite.
5. Places REST requests had no finite timeout. They now use a ten-second timeout. Retry keeps the error visible and disables the retry button until the load completes. A load sequence protects against an older same-account load finishing after a newer one, in addition to the existing account epoch and manual-selection checks.

These are confirmed client defects and synthetic reproductions, **not a confirmed diagnosis of the live Production incident**. No live Supabase schema, deployment migration history, authenticated Production responses or user data were accessed. The execution environment has no configured Supabase credentials. Missing schema/grants, stale PostgREST cache, actual revoked tokens, network/CORS failures and temporary server failures remain hypotheses until a sanitized diagnostic is observed.

## Request and SQL compatibility audit

All REST requests use `apikey`, an account's bearer token and JSON. The client does not supply a user ID when inserting: the database defaults it to `auth.uid()`. Isolation relies on RLS; adding client filters would not fix missing RLS or missing grants.

| Operation | Request | Repository contract |
| --- | --- | --- |
| Load favorites | GET `/rest/v1/favorite_places?select=id,geoname_id,country_code,admin1_id,name,region,country,latitude,longitude&order=created_at.asc` | Base migration plus GeoNames migration; authenticated SELECT and own-user policy |
| Load default | GET `/rest/v1/place_settings?select=default_place_id` | Authenticated SELECT, own-user policy; zero or one row per user |
| Add/import | POST `/rest/v1/favorite_places?on_conflict=user_id,latitude_key,longitude_key` | Authenticated INSERT; default user ID; generated coordinate keys and unique constraint; ignore duplicate + return representation |
| Resolve ignored duplicate | Same two GETs as initial load | Find the existing place by rounded coordinates; no overwrite |
| Remove | DELETE `/rest/v1/favorite_places?id=eq.<encoded ID>` | Authenticated DELETE and own-user RLS; composite foreign key clears only the default place reference |
| Backfill GeoNames identity | PATCH `/rest/v1/favorite_places?id=eq.<encoded ID>` | Column-scoped UPDATE on the three identity columns; own-user RLS |
| Set/clear default | POST `/rest/v1/rpc/set_my_default_place`, `{place_id: ID or null}` | Security-invoker function; authenticated EXECUTE, settings INSERT and column UPDATE; ownership check |

`20260930010000_favorite_places.sql` defines both tables, generated coordinate keys, uniqueness, forced RLS, SELECT/INSERT/DELETE grants, settings policies and the default RPC. `20260930020000_place_geoname_identity.sql` adds `geoname_id`, `country_code`, `admin1_id` and grants UPDATE only on these columns. Without the second migration, the favorite SELECT and add/backfill requests are incompatible with the base schema. **Whether Production has either migration is unverified.** The current requests are compatible with the complete repository migration contract. No SQL files, RLS, grants or RPC definitions were changed in this PR.

The two reads are not a database transaction. A concurrent deletion can leave a default ID absent from the fetched list; the client preserves the ID and only selects a default found in the list. RLS can also return a valid empty array when a policy filters everything: a successful empty response alone cannot prove Production policies are correct.

## Safe diagnosis and recovery

Browser console events use the fixed tag `places_sync` and only four fields: `source`, `category`, numeric HTTP `status` or null, and allowlisted SQL/PostgREST `code` or null. Sources are `favorite_places`, `place_settings`, `default_place`, or `client`. No request URL, token, refresh token, headers, user ID, email, coordinates, city names, raw response, backend message, exception stack or request body is logged. Unknown backend codes are dropped. There is no telemetry endpoint, persistence or analytics change. Failures outside the REST contract, for example local import discovery/storage exceptions after a successful read, produce a safe `client`/`unknown` diagnostic and the generic visible error; no raw exception is exposed.

| Category | Examples | Action |
| --- | --- | --- |
| session | 401; PGRST301/302/303; expired token after unsuccessful refresh | Read: shared refresh and at most one automatic replay; then visible error + manual retry/sign-in guidance |
| permission | 403; SQL 42501 | Visible error; verify authenticated grants and RLS contract before proposing changes |
| schema | 404; PGRST200/202/204/205/106; 42P01/42703 | Visible error; compare migrations/columns/RPC and schema cache |
| response | Invalid JSON, non-array, missing essential fields; PGRST116 | Reject snapshot; retain last valid favorites/default |
| network / timeout | Fetch rejection / ten-second deadline | Preserve local session and snapshot; manual retry |
| server / request | 5xx / other HTTP failure | Preserve snapshot; manual retry |
| configuration | Missing build-time Supabase configuration | Visible configuration error; no changes to secrets |

A fresh account session is obtained before every places request. A different account, logout, or still-expired session stops the request before REST. Auth refresh still preserves local sessions on transient failures and logs out only for existing explicit invalid/revoked refresh-token codes. A 403 does not refresh or relax access protections. Duplicate reads share refresh work; a newer token already obtained by another caller is reused. Mutations remain non-replayed to avoid an ambiguous write being repeated after a lost response.

BG/EN messages retain “Places could not be synchronized” plus a safe reason and the existing Retry button. Existing favorites, local guest migration, IDs, default selection, GeoNames localization and account-based device synchronization retain their contracts. No local fallback replaces a failed account fetch. Local import remains an explicit user action. Account-switch clearing and manual selection guards remain intact.

## Validation

- `npm run build`: passed (TypeScript + Vite).
- `npm run lint`: passed; `git diff --check`: passed.
- `npm test`: **375 passed, 1 skipped, 0 failed**. The existing native Deno TLS fixture requires unavailable `DENO_BINARY`. Tests needing local processes/sockets were run with local process access after the default sandbox blocked existing fixtures.
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/places-sync.spec.ts tests/profile-plan.spec.ts tests/profile-redesign.spec.ts tests/mobile-navigation.spec.ts --workers=4 --timeout=60000`: **118 passed, 0 failed** (45 places scenarios, 10 profile-plan, 15 profile-workspace and 48 navigation).
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/places-sync.spec.ts tests/planner.spec.ts --grep 'incomplete add response|401 refresh recovers automatically|failed calculation clears|guest invitation opens|missing data, unsuitable|logout discards a late calculation' --workers=1 --timeout=60000`: **6 passed, 0 failed**. This includes the final incomplete-add scenario, four planner session/entry regressions and a repeat of 401 recovery.
- Final coverage: **123 distinct browser scenarios**, 124 successful executions across the two commands (one intentional overlapping recovery check).

Coverage includes successful load/default, a truly empty account, each source failing, 401/403/404 and SQL/PostgREST codes, network/timeout classification, invalid JSON and incomplete snapshots, invalid default ID, expired session with successful/failed/revoked refresh, concurrency with a no-op restore, shared forced refresh and cross-tab token rotation, manual retry, error retention while retry is pending, preserving the previous snapshot on failure, add/remove/default changes, incomplete add responses, language changes, logout/login, account switching and manual selection during a pending default load.

Initial browser runs exposed a missing forced refresh when a concurrent no-op restore was in flight; that defect was corrected and covered by unit and browser regressions. One navigation focus assertion failed during the initial concurrent run, then passed in the final full navigation matrix without navigation implementation changes. The test fixture now preserves explicitly set sessions on reload for expiry tests and returns valid empty arrays for places in profile tests. The new POST fixture uses distinct IDs for Sofia and Varna. Browser checks use synthetic isolated responses and headless Chromium at 390px and 1440px in BG/EN, plus existing navigation/profile matrices. They do not exercise physical devices, Safari/Firefox or live cross-device Supabase synchronization.

Baseline reproduction: isolated worktree of unchanged `b3ceeb8`, copied test fixtures only, independent local port 4174. `PROFILE_PREVIEW_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/places-sync.spec.ts --grep '401 refresh recovers automatically|expired initial load waits' --workers=1 --timeout=15000`: both expected regressions failed with zero favorite chips after the REST rejection. No baseline application files were edited.

## Production follow-up, separately for approval

See [the conditional migration proposal](favorite-places-production-proposal.md). Do not execute SQL based on the generic UI error. First obtain only the sanitized source/category/status/code, then have the operator compare the deployed contract with the repository. There is no Production SQL execution, migration application, secrets change, user-data deletion, merge or Production deployment in this work.
