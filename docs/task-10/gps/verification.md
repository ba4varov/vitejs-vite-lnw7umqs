# GPS startup follow-up — draft PR #90

Amends `b952c5978135a734b1848f18782c7bbef7e9056f` on the existing PR branch. The primary/marine/AQI request pipeline from task 10 remains parallel and primary-driven.

## Confirmed cause

Previously, `coords` started at fixed Varna (`43.2141, 27.9147`). An unconditional forecast effect immediately requested those coordinates. A separate mount effect independently called `navigator.geolocation.getCurrentPosition`. A valid position arriving seconds later changed `coords`, starting a second set of forecast requests. Account default-place restoration was a third independent coordinate writer. Finally, every successful primary response selected another random background, including same-location refreshes. These behaviors predate the original PR #90 implementation.

The synthetic mobile reproduction uses the reported pattern: fallback Varna is 12°C; the Troshevo GPS coordinates are 13°C. It controls GPS delivery at 3.8 seconds and checks the first visible forecast, city/quarter and image, then advances another ten seconds. A DOM MutationObserver captures every distinct visible temperature/title/image tuple, rather than checking only the final value. Each primary/marine/AQI endpoint must have exactly one request for the final coordinates, with one image request.

## Final behavior

- One startup election owns the first location decision. Its promise is shared across the StrictMode effect rehearsal. The forecast effect does not run until the election, or an explicit city choice, is complete.
- Automatic GPS runs only when the Permissions API reports `granted`. `prompt`, denied access, unsupported APIs and failures use the fallback path without an automatic permission prompt. The visible BG/EN location button can explicitly request access, including when the Permissions API itself is unavailable.
- The complete startup budget is **4,500ms**, including permission lookup, GPS, GPS label lookup and initial account-default resolution. This deadline is independent of browser GPS timeout behavior. The sources run concurrently; no successive GPS/default/geocoding timeouts accumulate.
- A manual quick city, search result or favorite takes priority immediately. A validated account default arriving within the budget wins over GPS, including GPS that returned first. Its coordinates are elected before optional label-localization requests finish. Existing account-epoch and manual-choice guards still apply. Later logins/account switches retain the existing guarded default-place behavior.
- If the deadline expires with a valid GPS coordinate, that coordinate is used even if the optional reverse lookup has not finished. Otherwise fixed Varna is the safe fallback. A late initial default snapshot is still loaded into the favorites UI but does not automatically reorder a forecast already shown after the deadline. Users can explicitly select it. No stored default is changed or removed.
- Once elected, automatic GPS and late initial reverse-geocoding results cannot alter coordinates, city/quarter or background. If GPS labels were unavailable by the deadline, the initial title is “My Location” / “Моето местоположение”; subsequent explicit location use or language changes can resolve labels again. A valid label arriving within the budget is present before the first weather request.
- Explicit location use remains available after fallback. It has a separate bounded five-second attempt and request generation. A manual city choice cancels that attempt logically; a late explicit callback is ignored. Errors leave an existing forecast in place and show a localized retry/choose-city message.
- Weather effect setup is deferred by one microtask; StrictMode cleanup cancels its rehearsal before any network request. Dependencies use numeric coordinates. Re-selecting equal coordinates does not fetch again; the 15-minute interval still refreshes all three sources.
- A successful same-coordinate response retains the current background URL and image element. A genuine location change may select a new background once its primary response succeeds. Retry and background-refresh errors keep the last valid forecast and image.

The new location button shares the existing search row, has a minimum 44px touch target and localized accessible name, and supports both themes. During startup location selection, the skeleton uses neutral location-selection text rather than claiming a fixed Varna forecast is being prepared.

## Scope

No changes to Open-Meteo URL parameters, primary/marine/AQI numerical calculations, API keys, SQL, secrets, Push implementation, profile/plan components, Windy map or chatbot. Favorite-place CRUD and synchronization requests are unchanged; only the startup timing of applying their validated default coordinates is coordinated. Default restoration still passes through the existing account and manual-selection guards.

No merge, production deployment or SQL execution is part of this update.

[Mobile first forecast with Troshevo GPS](gps-first-forecast.png) · [Recorded request counts and complete DOM value history](stable-startup.json)

## Reproduction commands

```sh
npm run build
npm run lint
npm test
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.gps.config.ts
# Optional focused proof captures on a separate local port:
GPS_TEST_PORT=4175 CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.gps.config.ts --grep 'startup slow 390 bg false|same-coordinate|language change during' --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.loading.config.ts --output=work/gps-pr90-loading
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.forecast-regression.config.ts --output=work/gps-pr90-app
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/places-sync.spec.ts --workers=3 --timeout=60000 --output=work/gps-places
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.charts.config.ts --fully-parallel --workers=3 --timeout=60000 --output=work/gps-pr90-charts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.forecast-cards.config.ts --fully-parallel --workers=3 --timeout=60000 --output=work/gps-pr90-cards
```

The focused same-coordinate refresh check changes the mocked primary temperature from 12°C to 14°C at the 15-minute refresh and requires the new temperature with the original image URL and exactly one image request.

The original PR #90 timing fixture now distinguishes the independent unchanged base's StrictMode rehearsal from the updated app's single initial request. Production requests contain no fixture tags. GPS browser tests pause the clock before navigation and advance it explicitly, so CI execution time cannot accidentally consume the 4.5-second window.

## Results

- Build and lint: **passed**; `git diff --check`: **passed**.
- Unit: **399 passed, 1 skipped, 0 failed** (14 new startup-election tests).
- GPS: **64 matrix/edge scenarios passed**, followed by **1 passing language-race scenario**. The first-forecast DOM-history capture and a stronger refresh-data check each passed in a focused re-run.
- Original PR #90 loading suite: **37 passed**, including **120 loaded-section visual comparisons** over the complete 24-case viewport/language/theme matrix. Section dimensions match exactly; stored tolerances remain threshold 0.2 / maximum differing-pixel ratio 0.005.
- Original app regression suite: **163 passed**.
- Favorite/default-place synchronization: **46 passed**, including account switch, late responses, 401 recovery, failed refresh, retry and manual selection during pending default restoration.
- Chart regression/visual baseline suite: **71 passed**.
- Forecast-card regression/visual baseline suite: **72 passed**.
- Total: **454 distinct browser scenarios**, **456 successful executions** across the final commands (two focused repeats), **0 remaining failures**.

[Machine-readable results and visual matrix](results.json). The native Deno TLS test is the existing skipped test; no other tests were skipped. An initial harness run used a running clock and could consume part of the GPS budget during CI operations; the final GPS runs pause the clock before navigation and explicitly control elapsed time.

[Desktop 1440px EN dark before](desktop-1440-en-dark-before.png) · [Desktop after](desktop-1440-en-dark-after.png). These are fresh captures from the successful loaded-section comparison against the unchanged main baseline.

## Limits

Chromium with synthetic coordinates, permissions, weather and account responses, including 390px and 1440px × BG/EN × both themes. This reproduces the Android/Brave request order and reported 12°C/13°C distinction, but is not a new recording on physical Android/Brave hardware. The PR #90 suite additionally covers 320/360/390/430/768/1440px and loaded-forecast visual comparisons with the original main baseline. The existing native Deno TLS unit fixture remains skipped without DENO_BINARY.
