# GPS administrative warnings after PR #131

## Reproduction before the fix

Base: `b9abdb2` (merged PR #131). The new Chromium test `initial GPS accuracy 500` failed before application changes: expected one district warning article, received zero. The forecast accepted the same synthetic 500 m fix. The test intercepts the existing reverse service and `/api/alerts`; it does not call production.

`gpsWarningArea` rejected every fix above 100 m, including an explicit Bulgarian province ISO code. That threshold was also used for address display; it was incorrectly an all-or-nothing gate for both administrative levels. The reverse request switched to city zoom 10 above 100 m, reducing available administrative detail. The warnings component then showed a generic unconfirmed-municipality message rather than the actual GPS limitation.

## Location paths

- Initial election: `createInitialLocation` coordinates saved preferences, permission and the initial GPS deadline. A manual saved selection retains ownership; a saved GPS selection can follow a new granted fix. Existing manual/default ownership and late-result guards remain intact.
- Restore: `choosePlace(..., false)` restores the selected place. Restored GPS coordinates discard old administrative identity and request fresh reverse evidence. The warning section explicitly says these are saved coordinates, not a new fix. A fresh reverse response validates administrative metadata for that saved place; it cannot establish the user's current presence there.
- Explicit GPS: `useMyLocation` invalidates older location operations. The accepted fix clears previous administrative data, then reverse evidence resolves the warning scope. A new selection generation repeats this work even at the same coordinates. Manual selection still invalidates late reverse replies.

## Conservative criteria

Forecast: unchanged, finite valid coordinates and reported accuracy up to 3000 m.

District: accuracy up to 1000 m, `country_code=bg`, and a recognized `ISO3166-2-lvl4` province code. Municipality: accuracy up to 100 m plus an explicit Bulgarian `municipality`, or `county` explicitly prefixed with `община`. The server additionally checks the municipality against the NIMH province page. City/town/village and nearest-city inference are never used to select a municipality.

The 1 km district cap is deliberately below the forecast tolerance; the smaller administrative level retains the existing 100 m cap. These are conservative uncertainty limits, not polygon containment guarantees near administrative boundaries. Unknown, foreign, malformed, missing or overly coarse evidence fails closed. Unsupported translated municipality labels yield district-only coverage rather than guessing an identity.

The existing reverse request uses zoom 18 so explicit administrative fields can be returned. Street display remains gated at 100 m. No extra reverse requests or external services are introduced. The request has a 12 second deadline, and cleanup/selection guards reject stale results.

The UI distinguishes pending verification, insufficient accuracy, missing administrative evidence, unavailable reverse service, and saved GPS restoration. District-only responses retain their existing explanation that municipality warnings are unverified. Unavailable official source data retains its existing warning that absence of verified data does not mean absence of danger.

## Resource and privacy scope

No new domains, services, functions, endpoints, database changes, or diagnostic payloads. Diagnostic additions contain no coordinates (none were added). Tests use synthetic fixtures. Nimbo, Push, and manual place identity resolution are unchanged.

`vercel.json` disables Git deployments only for `codex/gps-official-warnings` before its first push. No deployment, promotion, merge or manual workflow dispatch is part of this change.

## Validation

- Red proof on the PR #131 base: Chromium `initial GPS accuracy 500` failed (expected 1 article, received 0). The same scenario passes with the patch.
- Focused unit suite: 72 passed, 0 failed (initial election, accuracy, localization and NIMH).
- Full `npm test`: 2238 cases, 2227 passed, 0 failed, 1 skipped and 10 existing TODO cases.
- `npm run build`: passed, including TypeScript compilation. `npm run lint`: passed with two existing `no-unsafe-finally` warnings in the unchanged push operator script. `git diff --check`: passed.
- Browser results: 36 selected scenarios passed across the final runs (28 unaffected cases plus 8 rerun after correcting the startup fixtures). No remaining failures in the selected set.
- Chromium fixtures cover initial GPS at 25, 100, 101, 500, 1000, 1001 and 3000 m; explicit municipality versus nearest city; district-only coverage; missing admin data; service error and timeout; denial; manual and old GPS restoration; GPS → manual → GPS; manual selection while GPS/reverse is pending; repeated coordinates; address suppression; manual Varna across BG/EN, desktop/mobile and light/dark; Nimbo clarification state and Push default-off behavior.
- Two existing browser fixtures were brought in line with the current startup contract: reverse-race cases restore a saved GPS origin, while Nimbo cases start with an explicitly saved place. Their assertions are retained.

All browser services are intercepted locally with synthetic data. These checks validate the client integration and existing server unit contract, not live GPS sensor accuracy or production reverse-service availability. No production credentials, push delivery, or live Nimbo model calls are used.
