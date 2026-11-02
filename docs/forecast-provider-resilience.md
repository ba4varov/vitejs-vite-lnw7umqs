# Open-Meteo 503 investigation

Baseline: main e76b5929ff7c98615754df69e387ea23469301b3, verified through
GitHub on 2026-11-02. No live requests to Open-Meteo were used.

## Findings supported by code and synthetic tests

- App's forecast effect depends on readiness and numeric coordinates, not city
  labels, translations, supplementary responses or ordinary rerenders.
- One queued microtask suppresses the StrictMode rehearsal request. fetchWeather's
  same-coordinate in-flight guard suppresses overlapping 15-minute ticks.
- Effect cleanup aborts all three sources and invalidates the request ID.
  createForecastRequests also checks generation and current coordinates, including
  JSON completion after ignored aborts. Abort cannot recall work already received
  by the provider.
- Latest location changes (f106ab3) request GPS once, persist confirmed choices,
  and accept at most one late precise GPS result. A first visit with neither GPS
  nor a confirmed place waits for explicit city selection; it does not first fetch
  a default forecast. Choosing a genuinely different location starts a new request.
- main.tsx has one root and no dynamic App key. An actual remount/reload can start
  a new request; diagnostic support exists, but this investigation has no Production
  lifecycle trace proving unexpected remounts. Development StrictMode is distinct.
- Every refresh starts exactly one weather, one marine and one AQI request.
  Secondary hosts are independent; their success does not establish availability
  of the forecast service. There was no automatic retry loop on main.
- Previously all HTTP failures lost status, manual retries had no cooldown, and a
  failed refresh could retain a snapshot and its warnings without an age limit.

## Request size

Keep forecast_days=15: day zero supplies today's overview, indices 1..14 supply
14 future days. Hourly humidity, pressure, visibility, dew point and cloud cover
supply each daily card's means; temperature/code/precipitation/wind/apparent
values supply hourly cards; probability and other hourly fields also supply
72-hour rain/planner/notification input. Daily extrema, sums, UV and sunrise/sunset
have visible consumers. Shortening hourly coverage or deleting fields would lose
existing details. Splitting into short/long calls adds requests and complexity.
No request-size change is justified by current evidence.

## Limited protection in this draft

- No new automatic retries or retry timer. Keep the existing 15-minute refresh.
- After weather HTTP 503/429, wait at least 15 minutes or a longer valid
  Retry-After (seconds/date). Manual attempts, city changes and React remounts in
  the same document cannot bypass this provider-wide gate. Blocked attempts do
  not launch supplementary requests either. A full reload/new tab resets the gate;
  this is a small client safeguard, not global provider rate limiting.
- Preserve the last structurally valid same-location snapshot in React memory;
  failures never advance its received timestamp. No new persistent location or
  weather storage. A full reload has no saved forecast to fall back to.
- Receipt age below 15 minutes: fresh. From 15 through 30 minutes: show the
  snapshot with explicit date/time and non-current notice; hide derived warnings,
  AI advice and forecast input to rain/planner/notification components. After
  30 minutes: hide the snapshot, even without another request. A 30-second UI
  clock and visibility resync enforce expiry; these do not make network requests.
- These are conservative UI age limits measured since successful receipt, not a
  provider validity guarantee or the model's issuance time. Existing supplementary
  enrichment semantics are unchanged.
- Reject provider error bodies, empty hourly timelines and truncated daily
  horizons before publishing. Present provider-specific 503/429 guidance and
  separate invalid-response guidance, instead of the generic load error.

## Validation

- New forecast-resilience.test.mjs: 10 tests, 503/429, Retry-After seconds/date/
  invalid/missing, remount/city cooldown, recovery, invalid JSON and age boundaries.
- Existing focused tests: forecast-sources 10, initial-location 27,
  startup-lifecycle 6, all passing when executed directly.
- New mocked Chromium suite: 7 passing; startup count, bounded manual retry,
  city change, 15-minute recovery, malformed/truncated response, age expiry, overlapping
  interval ticks and stale city response. All external requests are intercepted.
- npm test: 2,204 pass, 0 fail, 1 skip, 10 pre-existing local-parser TODOs.
- npm run build passes. npm run lint passes with two existing no-unsafe-finally
  warnings in scripts/push-node-operator.mjs. git diff --check passes.

## What remains unproven

The supplied Production body explicitly says the service is overloaded, but the
scope and root cause of that overload require provider evidence. There is no
Production HAR/traffic count here proving that this app caused it, that request
size triggers it, or that unexpected remounts occurred. Synthetic tests demonstrate
client behavior, not upstream capacity. No load tests, Supabase/Vercel changes,
merge, or Production deployment were performed.
