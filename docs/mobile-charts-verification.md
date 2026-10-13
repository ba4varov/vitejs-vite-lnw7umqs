# Task 6: mobile 24-hour charts

Base: current main `ac42d97520f553b8fcf7a080f373ddf0f4d31e7c`, the merge of PR #76. Branch: `task-6-mobile-charts`.

## Changes

At viewport widths up to and including 640px, the existing four metric buttons use a 2×2 grid with full names, 44px minimum height, 14px text, contrasting active colors in both themes and a visible focus outline. The existing metric switching breakpoint (760px), all four desktop charts and all layout/styles above 640px remain unchanged.

Mobile canvas labels use 14px text and measured widths. Intermediate time labels are omitted only when needed to avoid collisions, while retaining the first and last hour. Edge labels stay inside the canvas. Summary text and units wrap within the header.

Mobile charts reserve a permanent upper information area, so selection text cannot cover axis labels. The canvas is 264px tall on mobile, leaving space for both that area and the plot. The selected hour/value field spans the available inner width and stays inside the frame at both endpoints. A missing selected value is explicitly identified as “Няма данни” / “No data”; period summaries and the existing all-zero rain state remain available without inventing values.

Touch start and touch move select the nearest hour. No touch handler calls `preventDefault` or captures scrolling. Existing `touch-action: pan-y` keeps native vertical page scrolling available. Mouse, focus, blur and left/right keyboard selection remain; arrow keys prevent page scrolling while exploring values. Selected values use a live status field.

`Chart` and `SingleChart` are extracted into `WeatherCharts.tsx` so browser fixtures exercise the actual components independently of live APIs. `chart-copy.js` contains BG/EN translations for Now, summaries, missing data, zero precipitation, period and keyboard instructions. The app passes its explicit language, including to the existing AQI chart. AQI keeps its original mobile sizing/style; its copy is localized. English chart text on desktop changes intentionally as a language correction, not a layout redesign. Existing number formatting and units remain unchanged.

No changes to `chartValues`, `valueRange`, forecast data structures, weather calculations, API requests, current weather card, hourly/daily cards, chatbot, interactive map or profiles.

## Automated and visual coverage

`tests/mobile-charts.spec.ts` covers:

- 320/360/390/430/640/641/768/1440px × BG/EN × light/dark, all four metrics, native keyboard button activation/focus, first/last values, negative temperatures, no page overflow, mobile button geometry and active-text contrast >=4.5:1.
- Actual canvas text extents: all rendered mobile labels stay within the canvas, time labels do not collide, and selected-hour information remains above the axis text.
- Missing values, missing first-hour values and all-zero precipitation, with both languages and every applicable metric.
- Metric selection survives 640↔641 and desktop overview resizing.
- Chromium native touch events across all five mobile widths, BG/EN and both themes: scrub all four metrics from first to last hour, then vertically scroll starting on the canvas.
- 12 unchanged-main comparisons at 641/768/1440px × BG/EN × themes. Exact outer chart/button/frame geometry and styles match the independent original implementation. Bulgarian screenshots compare byte-for-byte. English screenshots mask the chart header/canvas containing the intentionally localized text; layout/style geometry remains exact in both languages.

80 committed mobile chart reference PNGs cover all five widths, languages, themes and metrics. These are intended new-design references, captured once with `--update-snapshots` after reserving the information area, then verified without updating them. Existing forecast references are not updated.

[Before/after review](mobile-charts-review/README.md) contains 32 independent images from original main and the final implementation, including the last hour. Its offline HTML selector is in the same directory.

## Reproduction

```sh
git fetch origin main
npm ci
npm run build
npm run lint
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run test:charts:browser -- --workers=2 --fully-parallel
```

The dedicated chart config prepares the original implementation/CSS from the pinned main commit under ignored `work/chart-baseline/` before starting Vite. To run the regular browser suite with the existing complete-app desktop comparison, start a second independent original-main server:

```sh
mkdir -p work/full-main
git archive ac42d97520f553b8fcf7a080f373ddf0f4d31e7c | tar -x -C work/full-main
ln -s ../../node_modules work/full-main/node_modules
VITE_SUPABASE_URL=https://auth.example.invalid VITE_SUPABASE_ANON_KEY=test-anon VITE_GOOGLE_AUTH_ENABLED=false VITE_TURNSTILE_SITE_KEY='' npx vite work/full-main --host 127.0.0.1 --port 4174
# In a second terminal:
node scripts/prepare-chart-baseline.mjs ac42d97520f553b8fcf7a080f373ddf0f4d31e7c
BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test --workers=4 --fully-parallel
CHROMIUM_PATH=/usr/bin/chromium npm run test:forecast:browser -- --workers=1 --fully-parallel
CHROMIUM_PATH=/usr/bin/chromium npm run test:signup:browser -- --workers=2 --fully-parallel
CHROMIUM_PATH=/usr/bin/chromium npm run test:profile:build -- --workers=2
```

Parallel verification uses temporary configs under ignored `work/configs/`, changing only ports and output directories. Profile/push fixtures receive the matching local `PROFILE_PREVIEW_URL` / `PUSH_PREVIEW_URL`. No product configuration changes are required.

## Results and limitations

- Final build and lint passed; all 288 unit tests passed.
- All 71 final chart cases passed, including 80 strict mobile screenshot comparisons, all 20 native touch width/language/theme combinations (scrubbing every metric and native vertical scrolling), missing/zero/negative values and responsive selection retention.
- All 12 independent chart desktop comparisons passed in the final matrix and again with explicit first-paint readiness after the general run. Bulgarian screenshots are exact; English localized regions are masked as documented above. Geometry/style assertions remain exact.
- All 72 dedicated forecast-card cases passed in the final isolated run; all 40 existing forecast reference images matched without updating snapshots. This run used two workers and a 120-second whole-test budget, without changing assertions or screenshot thresholds.
- All 29 signup cases and all 64 compiled profile/push cases passed.
- The general development run collected 643 cases and finished with 629 passed, 13 failed and one expected compiled-only skip. One failure was a stale collected touch title while its coverage was expanded into the final matrix; the final 71-case suite covers the replacement. Two chart desktop captures raced the first canvas paint: canvas intrinsic width defaults to 300 even before drawing. Readiness now requires the explicit painted CSS width, and all 12 comparisons passed again with that check. Ten existing cases (nine forecast-card cases and one gardening notification case) timed out while concurrent browser jobs exceeded this host's three CPU cores. All nine card cases passed in the final isolated 72-case run; the notification case passed in its isolated rerun. No unrelated product code or assertions were changed to make them pass.
- Combined final development coverage is all 591 existing cases passing, one compiled-only skip and all 71 new cases passing (662 passing cases plus one skip). The compiled-only case passed in the dedicated build run.
- Incidental screenshots regenerated by existing tests under other documentation directories were restored; existing forecast references and unrelated documentation are unchanged.

Final commands additional to the reproduction above:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:forecast:browser -- --workers=2 --fully-parallel --timeout=120000
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=work/configs/alerts-retry.config.ts --grep 'daily garden hide.* bg$' --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=work/configs/playwright.charts.config.ts --grep 'unchanged main chart layout' --workers=1
```

The temporary notification config inherits the regular config and selects `alerts.spec.ts`, using local port 4178 and a separate output directory. The temporary charts/forecast/signup/profile configs use ports 4178/4177/4176/4177, respectively; the compiled profile run receives the matching fixture origin variables. The final 72-case forecast rerun uses the original committed forecast config on port 4173.

Tests use synthetic local weather/account/API responses and Chromium. Physical iOS/Android and screen-reader results are not claimed. SQL/migration/integration scripts are not executed. The unrelated push Edge Runtime harness requires an absent Deno dependency cache, so it is not available in this environment. No merge, production deployment, SQL migrations or secret changes. Draft awaits approval.
