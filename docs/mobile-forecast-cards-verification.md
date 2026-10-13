# Task 4: mobile forecast cards

Base: `main` at `95547a95c259db0fba1cb6a56ee953715bd86d47`, after the merge of PR #74.

The existing `ForecastPeriodCard` gets CSS overrides only inside `(max-width: 640px)`. Both forecast strips retain their existing DOM, native buttons, accessible names, selection state, detail callbacks, arrows and mandatory horizontal scroll snapping. No forecast calculation, `forecastOverview`, weather unit, API or other product feature changes.

Cards use 136–158px widths, an 8px strip gap and a 220px minimum height. Content-sized grid rows replace the mobile fixed-height rows: long descriptions and values wrap and can increase the whole strip's card height. Ordinary fixture cards are 220px tall; readability takes precedence over the target height. The date uses 13px text, description and secondary metrics 14px, period 16px and temperature 26px. Existing theme tokens supply every color. Selection adds an inset outline, retaining the text contrast. The mobile strips use `touch-action: manipulation`, allowing horizontal card scrolling, vertical page scrolling even when a gesture starts on a card, and pinch zoom.

## Automated and visual coverage

- 32 real-app cases: 320, 360, 390, 430, 640, 641, 768 and 1440px × BG/EN × light/dark. Verify no page overflow, card dimensions, content bounds and non-overlapping rows, precipitation amounts and units, accessible button names, arrows, native keyboard horizontal scrolling, Space activation, touch activation, selection and detail opening.
- Mobile cases also verify text sizes, WCAG contrast of at least 4.5:1 before/after selection, roughly two visible cards at 360/390px, and real Chromium touch input with a diagonal horizontal swipe that advances the strip without changing page scroll.
- 20 isolated real-component cases: every mobile width/language/theme with long localized descriptions, long dates/day names, unusually long signed decimal observations, then absent temperature/rain/wind values. Assert wrapping, no overlap/clipping/page overflow, preserved exact values/units, missing-value em dashes and touch selection. The fixture renders the production component and production CSS; it does not patch rendered text.
- 20 mobile gesture cases: all five mobile widths × BG/EN × light/dark. On both strips, real touch sequences begin within a card. A predominantly horizontal swipe advances the strip without moving the page; a predominantly vertical swipe moves the page by more than 60px without changing the strip offset. Neither opens details accidentally. Chromium pinch input increases the actual visual viewport scale, reverse pinch restores it, and a subsequent tap still selects the card and opens details. The test waits for measured scroll offsets to settle before starting the next gesture.
- 40 committed mobile screenshot baselines in `tests/visual/forecast-cards/`, covering both forecast sections at every mobile width/language/theme. Long-content screenshots are additional review artifacts under ignored `work/browser-results/`.
- The existing `forecast-desktop-visual.spec.ts` compares section geometry and screenshots against a separate unchanged-main server at 641/768/1440px × BG/EN × light/dark.

Manual screenshot review covered 320px Bulgarian/light, 360px English/light, 390px Bulgarian/dark, 430px English/dark, 640px Bulgarian/light and long-content Bulgarian/light at 320px. The resize regression now compares the snapped card index rather than a fixed pixel offset, because card widths intentionally differ across the breakpoint. Its DOM-order helper also waits for asynchronous media-query notifications after resizing, retaining the same expected order and focus/state assertions.

Run the dedicated mobile/component/screenshot suite with:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:forecast:browser -- --fully-parallel --workers=3
```

Baseline creation is a separate, explicit review operation (`--update-snapshots`); normal runs compare against the committed screenshots. The general browser suite runs the functional cases without repeating the dedicated screenshot assertions.

For desktop comparisons, prepare unchanged main and start a second local server:

```sh
mkdir -p work/main-baseline
git archive 95547a95c259db0fba1cb6a56ee953715bd86d47 | tar -x -C work/main-baseline
ln -s ../../node_modules work/main-baseline/node_modules
VITE_SUPABASE_URL=https://auth.example.invalid VITE_SUPABASE_ANON_KEY=test-anon VITE_GOOGLE_AUTH_ENABLED=false VITE_TURNSTILE_SITE_KEY='' npx vite work/main-baseline --host 127.0.0.1 --port 4174
```

Then run:

```sh
BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test --fully-parallel --workers=3
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/mobile-forecast-order.spec.ts --fully-parallel --workers=2 --timeout=60000
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.signup.config.ts --fully-parallel --workers=3
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.profile-build.config.ts --workers=3
npm run build
npm run lint
npm test
```

## Initial Task 4 results

- Build and lint passed on the final product source. All 287 unit tests passed.
- Dedicated forecast suite: 52 passed; 40 mobile screenshot baselines generated.
- Comparison against committed screenshots (without updating them), plus both forecast resize cases: 22 passed. All 40 mobile images matched.
- Full development browser regression: 478 passed, one initial test failure and one compiled-only skip (480 cases). The failure was the existing English chat/DOM resize test reading the order immediately after `setViewportSize`, before the asynchronous media-query notification. The helper now polls for the same expected DOM order. All four BG/EN chat identity and forecast selection/scroll resize cases passed in an isolated final rerun. No product ordering or chatbot code changed.
- All 12 unchanged-main desktop geometry/screenshot comparisons passed within the full run.
- Final rerun of the complete PR #74 order/interaction/chat/resize suite with the corrected helper: 36 passed.
- Signup browser suite: 29 passed.
- Compiled profile/push browser suite: 64 passed, including the compiled-only case skipped in development.

Browser accounts and services are synthetic. No SQL/migration integration scripts, secrets changes, merge or production deployment are performed. Chromium's touch tests do not replace testing on physical iOS/Android devices.

The gesture correction uses Chromium's touchpad pinch input path (`Input.synthesizePinchGesture`, mouse source) to verify actual zoom in/out. Headless Chromium 151 in this environment does not change page scale for the touch-source pinch, including on a minimal control page. Horizontal and vertical gestures use real touch input in mobile contexts; phone two-finger pinch still requires a physical-device check. No page scale is forced to satisfy the zoom assertion.

## Gesture correction in PR #75

The only additional product change is replacing `pan-x pinch-zoom` with the standard `manipulation` value inside the existing mobile media query. Arrow, scroll-snap and detail handlers are unchanged. The existing computed-style assertion now expects `manipulation`; native gesture tests verify the resulting behavior separately.

A 390px Bulgarian control check applied the old touch-action override to the same real app and dispatched the same vertical touch sequence starting inside an hourly card. The page moved 0px with the old value and 148px after removing the override and restoring the production `manipulation` rule. Build and lint passed after the correction.

The final affected browser suite passed all 72 cases, including the 20 new mobile gesture cases and all previous layout, long/missing content, keyboard, arrow, selection and detail checks. All 40 committed mobile screenshots matched without updating baselines. Run it with the dedicated `test:forecast:browser` command above.
