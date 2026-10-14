# PR #90 — startup timing follow-up after `5a7167d`

## Scope and interpretation

This report compares production bundles of `5a7167d1ff2d681551a68999ac968b98025bedc5` and the timing follow-up on the same branch. It uses Chromium with synthetic permissions, GPS, account responses and network delays; it is **not a measurement of the user's Android/Brave connection or the live Open-Meteo service**. No real device coordinates, names, account data or tokens are collected. The full safe timing evidence and medians are in [measurements.json](measurements.json).

The text “Preparing the forecast for Varna” is displayed only after initial location election has finished. Waiting while that text is visible can include the primary API request, response download/JSON parsing, processing and React rendering. The text alone cannot identify GPS as the cause.

## Change

The 4,500 ms location-election deadline is unchanged. With prompt/denied/unsupported geolocation permissions and no pending default place, both revisions start weather as soon as the permission decision is known; there is no unconditional 4.5-second sleep. Granted GPS at 3,800 ms is still accepted. A pending saved default still has priority over GPS within the bounded election; a manual selection settles the election immediately. Late automatic coordinates/defaults remain unable to switch a displayed forecast.

Previously, granted GPS coordinates were held until reverse geocoding completed, or until the election deadline. Now coordinates settle the election independently of the neighborhood name. Primary weather, marine and AQI start concurrently; reverse geocoding also runs independently. A fast label can populate the skeleton before the main response is processed. If it is slower than primary weather, the first card keeps the localized “My location” title; its coordinates, temperature and photo never change because of that late automatic label. Explicit location requests and user-triggered language changes retain localization. No exact GPS coordinates are persisted.

The forecast request generation/location guards, StrictMode microtask deduplication, same-location refresh retention and stable background remain in place. Source parameters and meteorological calculations are unchanged.

## Safe on-device diagnosis

Open the PR preview with `?startupTiming=1` (or append `&startupTiming=1` to existing parameters). After the card appears, inspect:

```js
window.meteoStartupTiming()
```

This opt-in function returns a bounded page-lifetime array of `{phase, ms}` objects. `ms` is elapsed time from navigation, rounded to 0.1 ms. It never returns URLs, coordinates, city names, response bodies, tokens or arbitrary payloads. It sends nothing, logs nothing automatically, writes no storage and is absent without the flag. A fresh navigation starts a fresh trace. Each phase records only its first occurrence, so this is startup diagnosis rather than per-refresh telemetry.

- `module`, `react`: navigation → diagnostic module evaluation → first WeatherApp render. The navigation-to-module interval includes document/bundle loading and earlier module work; it is not a pure JavaScript CPU measurement.
- `permission:start/end`, `gps:start/end`: permission query and native position callback. GPS phases are absent when it is not requested. A stalled permission query/GPS remains bounded by the existing election deadline; a missing end phase must not be read as zero duration (an unresolved or synchronously failed native operation may have no callback).
- `default:start/end`: pending saved-place restoration. These phases are absent without an account restore. This covers the raw preferred place; optional name localization does not gate weather.
- `location:ready`: the bounded election settles, including manual/default/fallback outcomes.
- `reverse:start/end`: optional reverse lookup completes or fails, independently of primary weather. Completion does not imply its late label was applied.
- `weather:start/response/parsed/processed`: primary fetch invocation → response headers available → JSON body parsed → forecast transformations finished. `weather:error` records a failed first attempt. Header availability is not full body availability.
- `card:commit/paint`: main-card DOM commit and a double-requestAnimationFrame observation after a paint opportunity. This is a visible-card proxy, **not an exact GPU presentation timestamp**; background tabs can delay animation frames. The browser test also asserts that the card is visible.
- `marine:end`, `aqi:end`: independent supplement completion/failure, never a prerequisite for the main card.

To diagnose a real 4–5 second trace, compare navigation→module, permission duration, GPS duration, pending default duration, location-ready→weather-start, weather-start→response, response→parsed, parsed→processed and processed→card-paint. GPS/default run concurrently and these intervals must not be added blindly. A slow primary network response is not removed by decoupling reverse lookup. Real-device attribution still requires this safe trace from that device; these controlled tests do not establish its network latency.

## Reproduction

```sh
git worktree add --detach work/timing-baseline 5a7167d
ln -s ../../node_modules work/timing-baseline/node_modules
(cd work/timing-baseline && VITE_SUPABASE_URL=https://auth.example.invalid VITE_SUPABASE_ANON_KEY=test-anon VITE_GOOGLE_AUTH_ENABLED=false npm run build)
VITE_SUPABASE_URL=https://auth.example.invalid VITE_SUPABASE_ANON_KEY=test-anon VITE_GOOGLE_AUTH_ENABLED=false npm run build
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.timing.config.ts
```

Run the timing suite alone. It uses real timers and production previews on ports 4185/4186, one browser worker, three repetitions per revision/scenario. Both revisions use the same synthetic fixtures, a 120 ms primary response (except 4,000 ms in the slow-weather case), a 40 ms reverse response (except 5,000 ms in slow-reverse), and 6,000 ms supplemental responses. The external observer records response-header completion for reverse/default/supplement fetches and JSON completion separately for primary weather. The integrated reverse/default phases capture their application-level completion. The external observer is identical for both revisions; the new integrated diagnostics provide additional phase detail only after the change. The default scenario delays both saved-place endpoints 2,000 ms. No expected elapsed-time threshold is used to hide rendering or scheduling cost; the exported measurements retain it.

## Results

At a synthetic 5,000 ms reverse response, the old election held already available GPS coordinates: **GPS callback → main request 4,386.1 ms before / 21.6 ms after** (medians). Navigation → visible-card proxy fell from **5,268.1 ms to 1,104.7 ms**. This removes a dependency wait, rather than shortening the GPS budget. The optional reverse response still took 5,022.2 ms after the change and did not rename the shown card.

With GPS delivered at 3,800 ms, actual GPS duration remained **3,800.5 ms**, main started **12.2 ms** after the position callback, and the card appeared at **4,484.0 ms**. This wait is intentional coordinate election. A slow preferred-place restore took **2,028.4 ms** and still won over the faster GPS. With a 4,000 ms primary delay, response headers arrived after **4,015.2 ms** and the card appeared at **4,791.1 ms**; that network wait remains. These controlled scenarios separate removable label dependency time from intentional GPS/default waiting and primary-network latency.

For desktop without granted GPS, primary starts **188.5 ms before / 163.4 ms after** the permission-query start, not 4,500 ms. There is no evidence of an unconditional desktop GPS wait in either revision. Fast/denied/no-GPS total timings are broadly unchanged; three repetitions on a shared VM are insufficient to claim a speed improvement from small differences. Width 390 emulates the layout and GPS timing, not physical Android CPU/network performance.

All **42/42** records show the main card before either 6,000 ms supplementary response. Each navigation issues exactly one request to each weather source and one background image request. Slow reverse tests observe another 5.3 seconds after first paint and assert unchanged temperature, heading and photo; the StrictMode GPS suite separately covers manual/default priority, late results and same-coordinate 15-minute refresh.

| Scenario | Permission → main before / after (ms) | Navigation → card before / after (ms) |
|---|---:|---:|
| denied-gps | 60.6 / 122.8 | 961.7 / 1044.7 |
| desktop-no-gps | 188.5 / 163.4 | 1067.4 / 1097.4 |
| phone-fast-gps | 178.5 / 194.5 | 969.3 / 942.1 |
| phone-gps-3800 | 3854.5 / 3812.8 | 4578.9 / 4484 |
| slow-default | 2176.3 / 2199.6 | 2830.2 / 2867.9 |
| slow-reverse | 4506.2 / 275.4 | 5268.1 / 1104.7 |
| slow-weather | 113.0 / 173 | 4708 / 4791.1 |

After-change phase medians (ms; `—` means the phase was not needed):

| Scenario | Boot → permission | Permission | GPS | Default restore | Main headers | Body parse | Processing | Commit → paint |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| denied-gps | 474.9 | 0.1 | — | — | 170.1 | 8.6 | 27.7 | 175.2 |
| desktop-no-gps | 352.7 | 0.1 | — | — | 178.4 | 2.3 | 45.0 | 296.7 |
| phone-fast-gps | 432.5 | 0.0 | 150.7 | — | 128.2 | 1.7 | 24.5 | 152.5 |
| phone-gps-3800 | 280.6 | 0.1 | 3800.5 | — | 134.4 | 0.8 | 19.4 | 205.1 |
| slow-default | 346.9 | 0.0 | 134.7 | 2028.4 | 127.8 | 1.3 | 22.8 | 140.4 |
| slow-reverse | 367.2 | 0.1 | 253.7 | — | 132.4 | 1.6 | 34.5 | 200.9 |
| slow-weather | 316.1 | 0.1 | — | — | 4015.2 | 4.2 | 27.7 | 180.7 |

Medians are calculated independently for each phase; their sums need not equal a median total. Navigation → card includes bundle/document loading, application startup, intentional election/network waits, transformations, DOM commit and the paint proxy. Full before/after phase values remain in the JSON.


## Visual comparisons and regression coverage

The 24 loading-layout cases compare the current branch against independent main-after-PR-#89 (`c9a384a`), five populated sections each: main card, hourly, daily, primary charts and AQI. Pixel threshold 0.2 / maxDiffPixelRatio 0.005; section dimensions must match exactly. The matrix covers 320, 360, 390, 430, 768 and 1440 px × BG/EN × light/dark. It also verifies that the initial skeleton reserves substantial content space and the footer follows naturally.

Current-run representative comparisons (synthetic fixtures):

| View | Before | After |
|---|---|---|
| Production desktop, supplements still loading | [5a7167d](desktop-no-gps-before.png) | [Follow-up](desktop-no-gps-after.png) |
| Production phone, fast GPS | [5a7167d](phone-fast-gps-before.png) | [Follow-up](phone-fast-gps-after.png) |
| Production phone, slow reverse | [5a7167d](slow-reverse-before.png) | [Follow-up](slow-reverse-after.png) |
| Fully populated 390 px BG light main card | [Main after PR #89](loaded-390-bg-light-before.png) | [Follow-up](loaded-390-bg-light-after.png) |
| Fully populated 1440 px EN dark main card | [Main after PR #89](loaded-1440-en-dark-before.png) | [Follow-up](loaded-1440-en-dark-after.png) |

Initial skeleton: [390 px BG light](skeleton-390-bg-light.png), [1440 px EN dark](skeleton-1440-en-dark.png). The full-page production pictures are observational comparisons, not pixel assertions; the populated-section matrix provides the automated assertions. Screenshot fixtures use synthetic city names and a deterministic background. No real GPS data is captured.

Build, lint and `git diff --check` passed. Full unit suite: **400 passed, 1 skipped, 0 failed**. The existing native Deno TLS test requires unavailable `DENO_BINARY`; no additional skips were introduced. The final targeted election/source/privacy unit check passed 25/25.

| Browser suite | Passed | Duration |
|---|---:|---:|
| gps | 65 | 3.6m |
| production_timing_comparison | 42 | 2.8m |
| pr90_loading | 37 | 2.4m |
| pr90_app | 163 | 8.6m |
| places_sync | 46 | 3.9m |
| pr90_charts | 71 | 3.1m |
| pr90_forecast_cards | 72 | 5.6m |

**496 successful browser executions, 0 remaining failures** (468 scenarios when the 14 production-timing scenarios repeated three times are counted once). All 120 populated-section pixel comparisons passed with exact dimensions; **96/120 screenshot pairs are byte-identical**. The other pairs remain within the stated pixel tolerance. Existing chart/card snapshot assertions also passed.

Browser/build/lint/unit logs are saved alongside [checks.json](checks.json), the [42 production traces](measurements.json), and the separate [primary-before-supplements proof](primary-before-supplements.json). The latter asserts 24 hourly cards, 14 daily cards, primary charts and project sections while both supplemental routes are explicitly held pending.

Commands for the remaining regression suites (run serially to avoid shared-port conflicts):

```sh
npm run build
npm run lint
npm test
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.gps.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.loading.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.forecast-regression.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/places-sync.spec.ts --workers=3 --timeout=60000
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.charts.config.ts --fully-parallel --workers=3 --timeout=60000
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.forecast-cards.config.ts --fully-parallel --workers=3 --timeout=60000
```

The initial timing-harness experiments used the default 5-second visibility expectation, which was too short for the deliberately held 4.5-second baseline plus network/rendering. The final clean 42-case run uses a 15-second assertion timeout, retains actual measured times without capping them, and runs without concurrent browser suites. The timings JSON contains only that final run.

No merge, deployment, SQL migration or secret changes were performed. PR #90 remains a draft awaiting approval.
