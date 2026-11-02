# First-visit location permission

Base: main after PR #124, `15669f45a5dca4e6023551fe1a301d5ff1a42125`.

- First visit, `prompt`: call standard `getCurrentPosition` once, after resolving any account default. Keep a visible “Разреши местоположението” / “Allow location” button for browsers requiring a user gesture. Manual search and city buttons remain usable throughout.
- `granted`: accept accurate GPS immediately. A previously confirmed GPS location can follow travel silently. A saved manual city and an account default take priority and cause no GPS request.
- `denied`: issue no automatic GPS request. Explain in BG/EN how to allow Location in this site's browser settings, with an explicit retry button. Retry uses the standard Geolocation API, so a subsequent `prompt` or `granted` state works without resetting profile/storage. No polling or browser restrictions bypass.
- Missing or rejecting Permissions API: use the standard Geolocation permission flow. A stalled Permissions query remains bounded and cannot launch a delayed automatic request after startup has settled.
- Release the initial loading state at 4500 ms. An outstanding first-visit GPS callback may still provide one accepted result after that budget; a manual selection, explicit GPS action, default, failed callback, or component cleanup prevents obsolete application updates. StrictMode shares the election and replaces its subscription during rehearsal, without a second automatic request.
- Existing explicit GPS retains its separate five-second timeout and generation guards. Forecast refresh still uses accepted coordinates every 15 minutes, without GPS or new permission requests.
- PR #124's shared accuracy validator remains unchanged: forecast accuracy ≤3000 m, street address accuracy ≤100 m. Permission alone never accepts inaccurate coordinates; 259471 m is rejected. Confirmed/manual storage and reverse-geocoding guards remain in place.

## Coverage and validation

The GPS Playwright configuration now runs desktop Chrome and Pixel 7 Android Chrome emulation projects. Deterministic fixtures cover BG/EN, permission prompt/denial/settings retry, missing Permissions API, the startup deadline and late GPS, manual selection during permission, saved manual city reload, travel through explicit GPS, StrictMode request counts and 15-minute refresh. Existing accuracy and stale reverse-response coverage remains.

Executed in this environment:

- Focused location unit suite: **45 passed**, including 20 startup-election tests (`node --test --test-isolation=none src/initial-location.test.mjs src/location-accuracy.test.mjs src/current-location-localization.test.mjs src/reverse-geocoding.test.mjs`).
- Syntax parsing of changed TSX/TS files using the environment's bundled Babel parser: passed.
- Whitespace check: passed.

Blocked checks (not passing results): full `npm test` fails because dependencies including `@supabase/auth-js` and `web-push` are absent. Lint, typecheck, build and application Playwright tests cannot run without the project dependencies (`oxlint`, `tsc`, Vite, `@playwright/test`). The environment's configured HTTP proxy refuses connections, and offline `npm ci` reports `ENOTCACHED`. These checks must run after dependency/network access is restored.

Browser tests mock the reported permission state and GPS callbacks; they do not claim to automate a native permission dialog or validate physical Android positioning. No Production deployment or merge is requested. Push, VAPID, Supabase, weather alerts and deployment/domain settings are unchanged.
