# Mobile forecast and chat order

Base: `main` at `663a1d51994b6a1301929ab6bffd52019dfad107`, merge of PR #73.

At widths up to and including 640px, the dashboard now presents current weather, the 24-hour forecast, the 14-day forecast, the weather chatbot, then the existing charts and remaining sections. Above 640px, the original chat-before-forecasts order and desktop grid are retained.

`ForecastSectionOrder` subscribes to `(max-width: 640px)` through `useSyncExternalStore`. It returns the same explicitly keyed sections in the appropriate order under one React parent. React moves the existing DOM nodes without introducing wrappers, duplicate instances, conditional copies or CSS ordering. DOM, screen-reader reading order and native keyboard order therefore follow the visible layout. Scroll offsets are captured before each responsive reorder and restored in a layout effect before paint; existing scroll-snap and responsive margins remain intact. Chat state and request handlers remain in `App`; neither their implementation nor forecast components, styles or API calls change.

## Automated coverage

- 32 browser cases: 320, 360, 390, 430, 640, 641, 768 and 1440px, BG/EN, light/dark. Assert DOM and vertical order, single chat instance, 24 hourly cards and 14 daily cards, accessible chat name/live region, native Tab traversal, horizontal scroll controls and keyboard opening/closing of forecast details.
- Two additional resize cases verify preserved scroll position and selected forecast details.
- Two chat cases: BG/EN, repeated transitions across 640/641px, preserved DOM identity, draft and focus; submit, pending response during resize, returned response, suggestions, message history and a later draft.
- 12 optional visual comparison cases: unchanged main vs branch at 641, 768 and 1440px in both languages/themes. Compare exact geometry and screenshots with Playwright’s perceptual comparator (threshold 0.2, maximum differing-pixel ratio 0.005) of current weather, chat and both forecast sections. Use a fixed clock, synthetic services, neutral mouse position, stopped animations. Current-weather metric text, geometry and computed fonts/colors are compared exactly as well, so the rasterization tolerance does not hide layout or typography changes.

Run functional cases with:

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/mobile-forecast-order.spec.ts --fully-parallel --workers=4
```

For pixel comparisons, start unchanged main on a second local port:

```sh
mkdir -p work/main-baseline
git archive 663a1d51994b6a1301929ab6bffd52019dfad107 | tar -x -C work/main-baseline
ln -s ../../node_modules work/main-baseline/node_modules
VITE_SUPABASE_URL=https://auth.example.invalid VITE_SUPABASE_ANON_KEY=test-anon VITE_GOOGLE_AUTH_ENABLED=false VITE_TURNSTILE_SITE_KEY='' npx vite work/main-baseline --host 127.0.0.1 --port 4174
```

In another terminal:

```sh
BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/forecast-desktop-visual.spec.ts --fully-parallel --workers=4
```

The comparison cases skip explicitly when `BASELINE_URL` is absent. Screenshots and logs go under ignored `work/`, with generated main screenshot baselines under `work/visual-snapshots/`. Some existing browser specs regenerate existing documentation screenshots; those unrelated generated images are excluded from the PR.

## Validation results

- `npm run build`: passed (`tsc -b` and Vite production build).
- `npm run lint`: passed without warnings.
- `npm test`: 287 passed on the final implementation.
- Full development Chromium run: 409 passed, 16 initially failed, 1 compiled-only case skipped. All 13 nonvisual failures passed on isolated final-source rerun (one worker, 60-second test timeout), including alerts, navigation/search/auth focus, current weather and planner. Their initial failures were loading/test timeouts under concurrent load; no related product logic was changed.
- All 34 new order/interaction/chat cases passed in the full run; the two additional forecast scroll/selection resize cases passed separately (36 functional cases total).
- Final desktop comparisons: all 12 passed. The final harness compares section geometry and metric text/geometry/computed typography exactly, plus screenshots with the documented 0.5% rasterization tolerance. The initial full run's three remaining failures were stricter raw screenshot comparisons; the final comparison suite covers all 12 combinations.
- Separate signup browser suite: 29 passed.
- Compiled profile/push suite: 64 passed, including the compiled-only case skipped in development.

Final regression commands:

```sh
BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test --fully-parallel --workers=4
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.signup.config.ts --fully-parallel --workers=4
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.profile-build.config.ts --workers=4
```

For loaded-environment failures, rerun the named cases using `--grep`, `--workers=1` and `--timeout=60000`. Final desktop verification ran with one worker. Functional tests use synthetic services; they verify reading order through the DOM and real native Tab navigation, not a live screen-reader application.

SQL migration/integration scripts and the Docker/Deno edge suite are outside this UI change's validation: no SQL migrations, database operations, production deployment, merge or secret changes are performed. Browser services and accounts are synthetic.
