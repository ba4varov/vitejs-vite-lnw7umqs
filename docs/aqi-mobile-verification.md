# Meteo Pulse task 8: compact AQI cards

Base: `fd11d04ed5266e5ea07a4fdf4c7f9e1547d53930`, current main after merged PR #86.

At <=640px AQI spans both columns, followed by PM10 left and PM2.5 right. The scoped rule follows the existing <=760px AQI `!important` override. Cards no longer inherit the 116px minimum height on mobile. Labels are opaque 14px text in the existing theme foreground; values are 18px. Long numeric text can wrap without clipping, ellipsis, or rounding. Existing backgrounds and colors remain unchanged.

Above 640px existing columns, spacing, padding, typography and card heights remain unchanged. The only shared CSS guards allow unusually long values to wrap and grid children to shrink; ordinary observations retain their original appearance.

The display formatter accepts finite numbers, preserving zero and precision. Missing/non-finite observations use `Няма данни` / `No data`, without a concentration unit. The section now remains visible when current AQI is missing, allowing PM readings and the existing hourly chart to remain available. This missing-data state is intentional at every width. Fetching, rounding, interpretation, scales, and chart implementation are unchanged. The same 24-hour AQI chart stays immediately below the metrics.

## Automated verification

- `npm run build`
- `npm run lint`
- `npm test` — 335 passed, 1 skipped (Deno check).
- `BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/aqi-mobile.spec.ts tests/aqi-desktop.spec.ts --workers=3` — 32/32 AQI matrix cases and 8/8 comparisons at 641/768px passed.
- `BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/aqi-desktop.spec.ts --grep 1440 --workers=2 --output=work/desktop-rerun` — 4/4 desktop comparisons passed after the test adjustments described below. All 12 desktop combinations are verified.
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/mobile-charts.spec.ts tests/mobile-forecast-order.spec.ts --fully-parallel --workers=3 --output=work/regression-results` — 107 passed (71 chart checks, 36 forecast-order/interaction/resize checks). The legacy chart suite baseline under `work/chart-baseline/` was reconstructed from the same base commit using `git show`: `WeatherCharts.tsx`, `chart-utils.js`, `chart-copy.js`, `App.css`, and `index.css`, plus its unchanged chart fixture with local import paths. All 12 legacy desktop chart comparisons ran successfully; none were skipped.

AQI matrix: 320, 360, 390, 430, 640, 641, 768, 1440px × BG/EN × light/dark. Each case checks normal, long, missing/omitted, and zero observations. Assertions cover card order and spanning, compact height, chart position, labels/units, containment, horizontal overflow, and mobile font size/contrast (>=4.5:1). The dark theme is reapplied and asserted after each reload. Unit tests additionally cover NaN, infinity, undefined, null, and invalid string observations.

Desktop comparison: an unchanged checkout of the base commit runs on port 4174 with the same test dependencies, environment and mocked data. At 641, 768 and 1440px in both languages/themes, compare exact document geometry for AQI, the main chart section, Windy, current weather, chatbot, hourly and daily forecasts. AQI, charts and Windy screenshots require zero differing pixels. The other sections retain the existing forecast-suite rasterization tolerance (threshold 0.2, at most 0.5% pixels); current-weather text, font, color and geometry are additionally compared exactly. The initial strict run found only text rasterization differences in the unchanged current-weather labels at 1440px, plus one loading timeout under concurrent browser load; the corrected comparison uses this existing tolerance and a 15-second data wait. Runtime baselines and browser artifacts are under ignored `work/`.

To reproduce the baseline server:

```sh
git worktree add work/unchanged-main fd11d04ed5266e5ea07a4fdf4c7f9e1547d53930
ln -s ../../node_modules work/unchanged-main/node_modules
cd work/unchanged-main
VITE_SUPABASE_URL=https://auth.example.invalid VITE_SUPABASE_ANON_KEY=test-anon VITE_GOOGLE_AUTH_ENABLED=false npm run dev -- --host 127.0.0.1 --port 4174
```

## Limits

Browser checks use installed headless Chromium and synthetic weather/AQI responses. Live API availability, real Windy tiles, physical devices, Safari/Firefox, OS text scaling and screen-reader behavior have not been tested. The full unrelated admin/profile/Push/planner browser suites and integration/SQL tests are outside this presentation-only change. No migrations, secrets, production deployment, or merge are performed.

## Review images

320px: [BG light](visual/aqi/320-bg-light.png), [BG dark](visual/aqi/320-bg-dark.png), [EN light](visual/aqi/320-en-light.png), [EN dark](visual/aqi/320-en-dark.png).
