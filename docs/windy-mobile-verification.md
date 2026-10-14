# Task 7: mobile Windy map

Base: current `main`, `4b2f0f1ecebd914362036369c25037c18824dc3e` (14 October 2026).

Only the Windy wrapper changes. Forecasts, charts, chatbot, Push, profiles, API logic, secrets and SQL are unchanged.

## Behavior

- At widths up to and including 640px the map canvas is 320px tall. BG/EN controls and instructions appear above it, with theme colors and 44px minimum button height.
- Page scrolling is the default: a transparent parent overlay receives touch gestures with `touch-action: pan-y`, while the iframe has `pointer-events: none` and is removed from sequential keyboard navigation.
- “Interact with map” removes that overlay and enables iframe pointer/keyboard interaction. “Return to scrolling” restores the default. Closing the expanded view or crossing the mobile breakpoint resets interaction mode.
- “Fullscreen” promotes the **same, continuously mounted iframe** into the native dialog top layer. This is an available-viewport view, using `100dvh` with a `100vh` fallback; it does not require or call the Fullscreen API. Browser chrome may remain visible.
- A separate header keeps “Close” outside the iframe. It remains visible in landscape, with safe-area padding. Native modal behavior makes the background inert; focus starts on Close, Shift+Tab enters the iframe, Escape closes the dialog, and focus returns to the opener on mobile (or to the map if rotation has made the normal view desktop-sized). The browser owns focus traversal inside the cross-origin iframe.
- Body scrolling is locked while expanded, including fixed-body treatment for mobile browsers. Closing restores the original body styles and vertical scroll position.
- No portal, iframe replacement, URL changes or DOM access inside Windy occurs on mode changes. The existing rain/ECMWF URL and km/h, °C, mm units remain intact. City coordinate changes still update the URL normally.
- Above 640px, normal map layout, heights and direct interaction retain the previous design. Mobile controls are hidden. An expanded view opened on a phone stays closable if rotation makes its width exceed 640px.

## Automated verification

`npm run build` and `npm run lint` pass. `npm test`: 333 passed, 1 skipped (the native Deno TLS wire test; Deno is not configured in this environment).

Windy: 33 passed; the strengthened native-modal/background-focus touch test also passed independently. Desktop map: 12 passed with zero differing pixels; the existing weather/chat/forecast comparison passed all 12 combinations.

The existing mobile charts, forecast-card and forecast-order specs finish with **167 passed and 12 skipped** (chart comparisons requiring their optional `BASELINE_URL`; map and weather/forecast main comparisons were verified separately). The local test server stopped during this selection; 35 tests failed with connection errors and all 35 passed after restarting it and rerunning only those tests.

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  tests/mobile-charts.spec.ts tests/mobile-forecast-cards.spec.ts \
  tests/mobile-forecast-order.spec.ts --workers=1
```

 The full 667-test browser selection was started, then stopped to isolate visual comparisons from resource contention: 102 passed, 4 interrupted, 561 did not run. This is not a claim that the full browser suite passed. Database/remote integration and SQL checks are not run; this task does not modify those paths or authorize SQL execution.

Windy suite:

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.windy.config.ts
```

The 32 combinations cover 320, 360, 390, 430, 640, 641, 768 and 1440px × BG/EN × light/dark. All mobile combinations cover opening, Close, Escape, focus restoration, body locking, interaction toggling, portrait/landscape controls, stable iframe identity, unchanged URL, and exactly one iframe request across repeated mode changes. Seventy-two committed screenshots cover normal mode plus portrait/landscape expanded views. One additional test checks a CDP touch swipe, selection of Varna, preserved coordinates/city after expansion, and Shift+Tab containment.

Desktop comparison:

```sh
# Serve an unchanged checkout of the base main commit on port 4174.
BASELINE_URL=http://127.0.0.1:4174 CHROMIUM_PATH=/usr/bin/chromium \
  npx playwright test tests/windy-desktop.spec.ts tests/forecast-desktop-visual.spec.ts
```

The new desktop comparison checks exact document geometry of the map, iframe and footer, and **zero differing map screenshot pixels**, at 641, 768 and 1440px × both languages/themes. The existing comparison also checks main weather, chatbot and forecast sections against unchanged main. Temporary comparison artifacts stay under ignored `work/`.

## Limits and manual device verification

The environment restricts outbound network access and provides Chromium, not physical Android/iOS devices. Browser tests replace Open-Meteo responses and the Windy network response with deterministic fixtures. The iframe fixture remains at a separate origin, and verifies the parent wrapper and browser behavior; screenshots show a synthetic canvas rather than Windy's live tiles. Production app code never reads or modifies iframe contents.

These checks cannot establish live Windy tile rendering, Windy's own gestures, internal keyboard behavior, timeline/layer changes, resize responsiveness, performance, or availability. Native device browser bars, notches, nonzero safe-area insets, VoiceOver/TalkBack and Safari viewport behavior also require manual checks. The current viewport meta tag is retained; browsers that constrain the viewport to the safe region continue doing so, while the expanded header additionally uses the safe-area environment values when exposed.

Before approval, test real Windy on Android Chrome and iOS Safari (native dialog support is required; Fullscreen API is not): swipe across the ordinary canvas, activate and pan/zoom, return to page scrolling, open/rotate/close repeatedly, confirm Close remains reachable around browser bars/notches, and verify selected city, rain layer and units remain intact. Check VoiceOver/TalkBack navigation and focus return. Do not treat fixture screenshots as verification of live Windy controls.

No merge, production deployment, SQL execution or secret changes are part of this task.
