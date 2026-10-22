# Android diagnostic panel

Base: latest `main` verified as `aa9903a`, including PR #111 and #115.

Open the normal forecast page with `?startupTiming=1`. Expand **Диагностика /
Diagnostics**, then press **Копирай диагностиката / Copy diagnostics**. No computer
or DevTools is required. UI language follows the existing BG/EN language switch.

The button reads only `meteoStartupLifecycle()` and `meteoStartupTiming()`.
Before either clipboard or manual export, the entire snapshot must match the
existing fixed event/phase names, enums, booleans, bounded local counters and
finite elapsed times. Unknown fields or invalid values block the whole export;
there is no arbitrary text or metadata in the report. The existing document and
instance numbers are local diagnostic sequence counters, not account/device IDs.
No coordinates, cities, emails, tokens, subscriptions, secrets, URLs, browser IDs,
request/response bodies, localStorage or auth payloads are collected by the panel.

If Clipboard API is missing, unavailable on an insecure origin, or rejects the
write, a readonly report and **Избери целия текст / Select all text** button appear.
Select the report and use the phone's native Copy menu. Focusing via the button
uses `preventScroll`; font size 16px avoids text-field zoom. The collapsed fixed
panel is outside document flow; expansion has bounded width and scrollable height.
It does not scroll the page or focus a field automatically.

The existing bounded tab-local sessionStorage lifecycle journal is unchanged and
survives reloads in the same tab. Copying does not clear it. Timing remains a
snapshot of the current document. Storage denied by browser policy or opening a
new tab can lose the earlier journal, as before. No automatic telemetry, network
requests, server uploads or automatic copying are added.

Without the exact opt-in value `startupTiming=1`, the panel is not mounted and
existing disabled diagnostic behavior remains in place. There are no changes to
GPS, forecast loading, auto refresh, Service Worker, Push, Supabase, Gemini or
Nimbo. This adds a capture tool, not a fix for the previously observed Android
startup symptom.

## Phone verification after a separately approved deployment

1. On Redmi Note 13 Pro / Chrome, open the forecast with `?startupTiming=1`.
2. Wait for forecast, reload once, and wait 10–15 seconds without clearing storage
   or unregistering the worker.
3. Expand the panel and copy. If copying fails, select all and use native Copy.
4. Paste the JSON into a local note and check that lifecycle contains events from
   both document counters. Share only this report when desired.
5. Remove the query parameter to disable the panel on the next navigation.

Automated browser tests use mobile Chromium emulation, synthetic GPS/auth/weather
responses, and the real local worker. They do not establish behavior of the
physical Redmi, Android OS lifecycle, or its native selection/clipboard menu.

## Validation

- `npm run build`: passed.
- `npm run lint`: passed; two existing `no-unsafe-finally` warnings in
  `scripts/push-node-operator.mjs`.
- `npm test`: 2116 passed, 0 failed, 10 existing TODO, 1 optional skip (2127 total).
- Mobile lifecycle + panel, production build: 10/10.
- Mobile lifecycle + panel, development/StrictMode: 11/11.
- GPS/refresh/scroll regression suite: 97/97.
- `git diff --check`: passed.

The first English browser scenario attempted to click the language control while
its mobile menu was closed. The test was corrected to open/close the real menu;
final full runs use that correction. Initial sandbox runs could not install
packages or bind local test servers; final runs used the authorized environment
network/local-server access. No production deployment or merge was performed.

Reproduce the browser checks with `/usr/bin/chromium` or an installed Playwright
Chromium binary:

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.lifecycle.config.ts
CHROMIUM_PATH=/usr/bin/chromium LIFECYCLE_PRODUCTION=0 npx playwright test --config=playwright.lifecycle.config.ts
CHROMIUM_PATH=/usr/bin/chromium GPS_TEST_PORT=4193 npx playwright test --config=playwright.gps.config.ts
```
