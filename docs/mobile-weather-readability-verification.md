# Task 5: current mobile weather readability and compact advice

Base: `bdb48f314338bc2c0b52a8c7f337090ee7dea78c`, the merge of PR #75 into main. Remote main was fetched and matched this commit.

## Implementation

All visual changes are scoped to the current weather card at widths <=640px. The original image, temperature-dependent color overlay and icon animations remain. A translucent navy gradient above the existing overlay has alpha .60–.66. Even over a pure-white image, its lightest stop provides at least 4.5:1 contrast for white text. Additional advice and metric surfaces increase that margin; the image remains visible through the gradient.

The header reserves separate columns for the city/favorite button and animated weather icon. Long names wrap, including names with unbroken words. Temperature, description, feels-like/min/max, update time, advice and the four PR #72 metrics keep their mobile hierarchy. The existing All metrics control and handlers are unchanged.

`WeatherAdvice` only controls presentation. Mobile initially clamps the original advice text to two lines, with BG/EN read/collapse buttons, aria-expanded/aria-controls, native Enter/Space handling, visible focus and a minimum 44px touch height. Expansion removes clamping and preserves the complete text, whitespace and line breaks. It does not call the API. The component key contains the forecast request identity and advice text, resetting disclosure for new forecasts/advice. Pending, null and whitespace-only advice produce no section or control. Existing generation/fallback and stale-response guards are unchanged. Empty API responses still use the existing fallback advice; that behavior was deliberately retained.

Advice keeps its robot icon and Meteo advice label. Existing severe-weather alerts remain outside the card with their original full content. No alert generation or official-warning semantics were added to advice.

Above 640px the disclosure button is hidden, the text span remains inline and the original advice styling/full text and card layout are preserved. The favorite button gains an accessible name and pressed state without changing its behavior or desktop appearance. Forecast cards, chat, API, AI generation, auth, notifications and profiles have no product changes.

## Browser coverage

`tests/mobile-weather-readability.spec.ts` adds 68 cases:

- 64 combinations: 320/360/390/430/640/641/768/1440px × BG/EN × light/dark theme × bright/dark deterministic background images. Real UI search selects a long settlement name. Advice arrives through the existing API with a long original string and line break; severe-weather data triggers all four applicable alerts.
- Mobile assertions cover two-line clamping, exact original text before/after expansion, no extra advice request, Enter/Space/focus, 44px touch targets, icon/name/favorite separation, visible primary values and four metrics, full warning count, loaded background image and no page overflow. Collapsed/expanded screenshots are saved under ignored `work/browser-results/` for review.
- Two language cases check no section while advice is pending, reset of an expanded advice for a later forecast, an actual late response from the superseded request, and absence of a whitespace-only advice section.
- Two theme cases calculate a conservative contrast bound from the browser's computed gradient stops over pure white, check alpha stays <=.66, and check the visible text's white color and full opacity.

The existing current-weather browser cases verify the All metrics disclosure. The existing desktop comparison suite compares exact geometry, metric styles and section screenshots against an independent unchanged-main server at 641/768/1440px in both languages and themes. The existing forecast screenshot suite retains strict pixel comparison. Capture now offsets only the section under test with relative positioning by at most half a pixel onto the device-pixel grid, and keeps the complete screenshot clip inside the viewport, then restores its original positioning before interactions. This avoids false changes from fractional vertical positions when the current-card height changes. Reference images are generated exclusively from the independent unchanged-main server, never from the modified app. There are no forecast-card product changes.

## Reproduction

```sh
npm ci --cache work/npm-cache
npm run build
npm run lint
npm test
mkdir -p work/main-baseline
git archive bdb48f314338bc2c0b52a8c7f337090ee7dea78c | tar -x -C work/main-baseline
ln -s ../../node_modules work/main-baseline/node_modules
VITE_SUPABASE_URL=https://auth.example.invalid VITE_SUPABASE_ANON_KEY=test-anon VITE_GOOGLE_AUTH_ENABLED=false VITE_TURNSTILE_SITE_KEY='' npx vite work/main-baseline --host 127.0.0.1 --port 4174
# In a second terminal:
BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test --fully-parallel --workers=3
CHROMIUM_PATH=/usr/bin/chromium npm run test:forecast:browser -- --fully-parallel --workers=3
CHROMIUM_PATH=/usr/bin/chromium npm run test:signup:browser -- --fully-parallel --workers=3
CHROMIUM_PATH=/usr/bin/chromium npm run test:profile:build -- --workers=3
```

For the one-time reference capture, a temporary config inheriting `playwright.forecast-cards.config.ts` points `use.baseURL` to the unchanged-main server on 4174, sets the test directory to the repository's tests and disables its own webServer. Its basename remains `playwright.forecast-cards.config.ts` so the existing dedicated screenshot assertions run. The command is:

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=work/baseline/playwright.forecast-cards.config.ts --grep 'forecast cards (320|360|390|430|640) ' --update-snapshots --workers=2 --fully-parallel --timeout=60000
```

Normal comparison runs against the changed app omit `--update-snapshots`.

## Results

- Build and lint passed; all 287 unit tests passed.
- Full development regression exercised all 568 cases: all 499 existing cases passed, with one compiled-only case skipped. The first collected version of the new fixture omitted the marine response, causing 24 new desktop metric-count failures (13 instead of 14). The completed fixture supplies the original 20°C sea temperature. All 68 new cases passed in a fresh final run, including those 24 desktop cases. Combined final development coverage is 567 passing cases and one compiled-only skip.
- All 12 unchanged-main desktop geometry/style/screenshot comparisons passed at 641/768/1440px in BG/EN and both themes.
- All 29 signup browser tests passed.
- All 64 compiled profile/push cases passed, including the development-only skip.
- Dedicated forecast coverage: all 72 cases passed across the dedicated run and the final affected-case rerun. The dedicated run passed 68 cases and exposed four viewport-edge screenshot failures. After completing capture positioning and recapturing references from unchanged main, all 20 mobile screenshot/interaction cases passed in the final rerun; the other 52 cases already passed. All 40 strict screenshot comparisons matched without updating snapshots in that final run. Thirty-six reference PNG files changed from their old capture; all are rendered by unchanged main.

The reference operation validates 40 mobile forecast images against unchanged main. Initial snapshot failures reflected fractional placement and a blank final row when a rounded clip extended past the viewport edge. Capture positioning was corrected without relaxing the pixel comparison or changing forecast UI/styles. The references come from unchanged main with that same corrected capture, rather than from the modified app. Parallel isolated runs used temporary configs on ports 4175/4176 with separate output directories; profile/push fixtures used their matching local Preview URL variables. Cold-start advice readiness uses a 15-second wait, matching the existing forecast fixture, instead of the default five-second assertion timeout.

Services, accounts and weather/background data in browser tests are synthetic. Physical iOS/Android and screen-reader checks are not claimed. SQL/migration integration scripts are not run. The push Edge Runtime harness is unavailable here (Deno is not installed and the required test dependency cache is absent). No merge, production deployment, SQL migrations or secret changes.

## PR #76 correction: show advice controls only for actual overflow

Short advice now has no disclosure button and no reserved button margin/height. `WeatherAdvice` measures an invisible, inaccessible, absolutely positioned copy of the original text at the live span's exact width, with the same inherited typography and whitespace. The copy is unclamped and removed synchronously after measuring. A button is rendered only when the natural text height exceeds two computed line heights (with a half-pixel rounding tolerance). This uses rendered geometry, never character counts. It also works while expanded; measuring the expanded live span's scrollHeight would incorrectly remove the collapse control.

Initial measurement uses a layout effect before the first paint. A ResizeObserver watches wrapping width and line-height changes, ignoring height-only expansion notifications. Its work is coalesced in one animation frame outside observer delivery, preventing resize notifications caused by synchronous commits during RO delivery. Native font-load and mobile breakpoint events also remeasure; advice/language changes recreate the measurement effect. If text starts fitting, expansion resets and the button is removed. Listeners, pending frames and stale font-ready callbacks are cleaned up on unmount. The existing forecast/advice key and API stale-response guards are unchanged. No product CSS, forecast, warning, metric or desktop styling was changed in this correction.

Added browser coverage: 20 combinations of 320/360/390/430/640px × BG/EN × light/dark, each checking a one-line advice, an exactly two-line original advice, no button/empty bottom space, and long advice with keyboard expansion/collapse and no extra request. Four additional cases verify 320↔640↔641 resizing while expanded, language switching, font-size changes at a fixed width, content replacement, preserved raw text and absence of page errors/ResizeObserver-loop/flushSync errors. Language initialization in the test fixture is restricted to the top-level document, because sandboxed advertising frames intentionally have no localStorage. A longer English resize fixture is used to cross the actual two-line threshold at 320px; the original shorter English wording correctly fits and has no button.

Correction validation:
- Build and lint passed on the corrected source.
- All 20 short/two-line/long matrix cases and both existing stale-response cases passed with the final observer scheduling. All four resize/language/font/content cases passed in the final rerun.
- The 68 existing readability/contrast/stale cases and 24 current-metric cases passed during the affected browser run. The newly added error assertions initially exposed the sandboxed-frame test initialization and the observer-delivery issue; both were corrected and affected cases rerun. All 24 current-metric cases also passed in the final rerun, with no ResizeObserver/flushSync errors in its log.
- All 12 unchanged-main desktop comparisons passed at 641/768/1440px in BG/EN and both themes.
- All 20 mobile forecast screenshot/interaction cases passed; all 40 committed baseline images matched without updating snapshots.

Commands (temporary isolated configs only change port/output directory):

```sh
npm run build
npm run lint
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/mobile-weather-readability.spec.ts tests/mobile-weather-card.spec.ts --workers=3 --fully-parallel --timeout=60000
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=work/playwright.task76.overflow.config.ts --grep 'advice actual line overflow|advice remeasures|advice absence' --workers=3 --fully-parallel --timeout=60000
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=work/playwright.task76.overflow.config.ts --grep 'advice remeasures' --workers=2 --fully-parallel --timeout=60000
BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=work/playwright.task76.desktop.config.ts --workers=2 --fully-parallel --timeout=120000
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=work/playwright.forecast-cards.config.ts --grep 'forecast cards (320|360|390|430|640) ' --workers=2 --fully-parallel --timeout=60000
```

The correction remains on the original draft PR #76. No new PR, merge, production deployment, SQL migrations or secret changes. Browser results use Chromium fixtures; a physical Android retest is still a separate check.
