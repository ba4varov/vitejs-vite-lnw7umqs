# Task 10 — primary forecast without supplementary blocking

This records the original PR #90 revision `b952c59`. The subsequent GPS startup update and its fresh validation are documented in [the GPS follow-up](gps/verification.md).

Base: `c9a384aecf82104d50b1a2802baeae9e0010c9aa`, main after merged PR #89.

## Behavior

`fetchWeather` starts the primary Open-Meteo, marine and air-quality requests together. Only the primary response is awaited by the main forecast flow. Once its structure and calculations are processed, the current card, hourly cards, 14 daily cards, main charts and subsequent existing sections (including Our projects) appear. Marine/AQI results enrich that snapshot independently. An already-open hour/day detail also receives late supplementary observations.

Supplementary snapshots are keyed by the exact requested latitude/longitude. A same-location refresh retains each source's latest successful snapshot during pending requests and HTTP/network/JSON/structural failures. A valid response containing null observations remains a valid unavailable observation, rather than an error or zero. Changing coordinates resets supplementary snapshots. The existing main-location render gate immediately hides a different city's forecast.

Every source belongs to a request generation and AbortController. Both generation and current-location checks apply after JSON parsing; supplementary React updates recheck the request ID inside the state updater too. Cleanup and a newer request abort older requests. Unit tests additionally simulate a fetch implementation ignoring abort and delayed JSON parsing, proving the checks do not depend on abort alone.

Primary failure on first load retains the existing error/retry UI. Primary failure or a malformed primary snapshot during refresh preserves the last valid main forecast. Primary calculations are prepared before publishing setters, avoiding partial replacement of a valid snapshot. Planner/notification forecast payload calculations and their existing location gates remain intact; their valid same-location snapshot is retained during refresh.

Loading is distinct from unavailable observations in supplementary metrics, sea detail and the AQI chart summary. Real zero observations retain their units and values. Missing primary observations show an em dash. Rounding, decimal PM units, hourly API-local timestamp joins, and daily means over the original primary hourly slices remain intact for finite values.

The responsive skeleton reserves space for the current card, hour/day strips and chart. At desktop widths the strips sit side by side, following the forecast layout. Its cards support both themes, and shimmer respects reduced motion. Visual inspection caught an inherited global heading color with low dark-theme contrast; the skeleton heading now explicitly inherits its card text color, with a 4.5:1 contrast assertion across the full matrix. The footer follows the skeleton in document flow. It is below the initial 900px viewport in every tested combination.

## Scope audit

The three Open-Meteo URL expressions were compared verbatim with the base and are unchanged, including all parameters. No API key, secret, SQL, Push implementation, profile, favorite-place implementation, AI request/calculation, Windy or Pro planner component was changed. The change prepares and publishes their existing primary forecast payloads without supplementary waiting. No merge, production deployment, SQL execution or data deletion was performed.

## Reproduction

```sh
npm ci
npm run build
npm run lint
npm test
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.loading.config.ts
# Recheck only the skeleton/contrast matrix (does not run loaded comparisons):
FORECAST_TEST_PORT=4175 SKELETON_ONLY=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.loading.config.ts --grep 'skeleton and loaded' --workers=1 --output=work/skeleton-results
node scripts/prepare-chart-baseline.mjs ac42d97520f553b8fcf7a080f373ddf0f4d31e7c
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.forecast-regression.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.charts.config.ts --fully-parallel --workers=3 --timeout=60000 --output=work/charts-results
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.forecast-cards.config.ts --fully-parallel --workers=3 --timeout=60000
```

The existing app-level regression suite uses a scoped 15-second assertion timeout and three workers for asynchronous development rendering on this CI worker. An earlier four-worker run exceeded the original five-second UI wait, with the expected forecast present in the failure snapshot; the scoped suite was rerun in full and all 163 scenarios passed.

The loading config prepares an independent detached checkout of the exact base under ignored `work/baseline`, sharing only installed dependencies. Its second server listens on 4174. Fixtures mock all external services. To distinguish development StrictMode's rehearsed request from the actual mount, the new browser fixture tags mocked request generations in a test-only fetch wrapper; production requests have no fixture headers.

## Validation results

- Build (TypeScript + Vite): passed.
- Lint: passed; `git diff --check`: passed.
- Unit: **385 passed, 1 skipped, 0 failed** (386 total; ten new source/enrichment tests).
- New browser suite: **37 passed, 0 failed**. Includes 13 functional scenarios and 24 viewport/language/theme combinations.
- Visual matrix: **120 section comparisons passed**, all section dimensions exact. 96 before/after PNG pairs are byte-identical; 24 current-card pairs differ slightly due to text rendering after missing-value-safe formatting and pass the stated comparator. SHA-256 values for every captured image are in [visual-manifest.json](visual-manifest.json).
- Skeleton contrast follow-up after the isolated heading-color fix: **24 passed, 0 failed**, including at least 4.5:1 heading contrast in all six widths × BG/EN × both themes. The committed skeleton screenshots and manifest contain this final capture. The loaded-section comparisons above predate this skeleton-only selector correction; loaded-section styles are unaffected.
- Existing app regressions: **163 passed, 0 failed** (loading lifecycle, forecast order/interactions, current card, readability).
- Existing chart regressions and stored visual baselines: **71 passed, 0 failed**.
- Existing forecast-card regressions and stored visual baselines: **72 passed, 0 failed**.
- Total: **343 distinct browser scenarios**, plus **24 repeated skeleton/contrast checks**; **367 successful executions** across the final commands, no remaining failures.

The recorded primary-release event was followed by observed main readiness 4,347ms later in this CPU-loaded synthetic run. Both supplementary routes remained held until 6,016ms after observed main readiness. See [timing.json](timing.json) and [the screenshot before releasing supplements](primary-before-supplements.png). These intervals describe this test run and its assertions/screenshot capture, not production latency.

## Evidence and limits

The timing regression holds both supplementary HTTP routes unresolved, releases only primary, and asserts current temperature, all 24 hourly cards, all 14 daily cards, main charts and Our projects before releasing either supplementary route. It saves a full-page screenshot at that point and a wall-clock event JSON. This proves the readiness dependency; it is not a production network benchmark or a promised loading duration.

The visual matrix covers 320, 360, 390, 430, 768 and 1440px × BG/EN × light/dark (24 combinations). Each compares five fully populated sections against the independent base: current card, hourly, daily, charts and AQI. Dimensions must match exactly. Playwright's comparator uses threshold 0.2 and maximum differing-pixel ratio 0.005 to allow small font/antialiasing rendering differences; it does not claim byte-identical PNGs. All screenshots are retained under ignored `work/browser-results` and in the workspace evidence archive `work/task10-deliverables/meteo-pulse-task-10-evidence.zip`; selected before/after images are committed alongside this report. Running the loading config regenerates the complete capture.

Functional checks cover both response orders, each/both supplementary failures, first-load main error and retry, city changes with pending requests, refresh with pending/failed supplement requests, main refresh failure, malformed responses, zero versus null, timestamp joins, daily sea means, live detail enrichment and AQI chart keyboard values.

These are deterministic Chromium checks with synthetic data. Real devices, Safari/Firefox and live Open-Meteo latency were not measured. The native Deno TLS unit fixture remains skipped because this environment does not provide DENO_BINARY.

## Selected visual comparisons

The full 24-case matrix is recorded in the manifest and can be regenerated with the loading config. These samples show the responsive skeleton and the same loaded main card before/after this change.

| Case | Initial skeleton | Base loaded | Changed loaded |
| --- | --- | --- | --- |
| 390-bg-light | [Skeleton](visual/390-bg-light-skeleton.png) | [Before](visual/390-bg-light-before-main-card.png) | [After](visual/390-bg-light-after-main-card.png) |
| 390-en-dark | [Skeleton](visual/390-en-dark-skeleton.png) | [Before](visual/390-en-dark-before-main-card.png) | [After](visual/390-en-dark-after-main-card.png) |
| 1440-bg-light | [Skeleton](visual/1440-bg-light-skeleton.png) | [Before](visual/1440-bg-light-before-main-card.png) | [After](visual/1440-bg-light-after-main-card.png) |
| 1440-en-dark | [Skeleton](visual/1440-en-dark-skeleton.png) | [Before](visual/1440-en-dark-before-main-card.png) | [After](visual/1440-en-dark-after-main-card.png) |
