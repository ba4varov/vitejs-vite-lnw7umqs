# Geolocation accuracy review

Base: main after PR #123, 36f7e8127508cb71eb76be9404aecb30d5f38e8d.

## Policy

- Accept finite, valid coordinates only when reported accuracy is finite, nonnegative and at most 3000 metres. Missing, null, string, negative or non-finite accuracy is rejected. This is a city-forecast tolerance: a few kilometres permits ordinary Wi-Fi fixes, while regional ISP estimates (including the reproduced 259471 m) are unsuitable. It is a pragmatic limit, not a guarantee of municipal-boundary identity.
- Show street/neighborhood detail only at at most 100 metres. Both reverse helpers request city zoom 10 for less precise or unknown fixes and suppress address fields even if the response supplies them; precise fixes use zoom 18.
- Keep a current accepted location on a failed explicit request. On startup failure, restore only the new versioned confirmed-location record. If none exists, show BG/EN manual-choice guidance without requesting a forecast for a universal default city.
- Persist manual city choices and accepted GPS positions in a separate local record. Never save rejected GPS, the inert initial coordinates, account IDs or street addresses. Existing favorites and account default storage/contracts are unchanged. Unverifiable older defaults are not migrated into confirmed history.
- A fresh granted automatic GPS fix still takes precedence over the fallback history when traveling. Existing explicit account-default priority is preserved.

## Async and loading behavior

The shared StrictMode startup election retains its 4500 ms ceiling and no-prompt permission check; invalid accuracy settles immediately once the default lookup is complete. Reverse geocoding stays outside the forecast critical path. Explicit GPS retains its 5000 ms timeout and uses the same validator. Request generation, coordinate keys, revision checks and aborts continue to reject stale responses; failed explicit callbacks now invalidate their generation too. The 15 minute forecast timer keeps using accepted coordinates and does not request GPS on refresh.

## Coverage

Unit: threshold boundaries; precise GPS; 259471 m, missing/invalid accuracy; denial and startup deadline; default/manual precedence; storage restore/corruption/failure; street suppression and reverse zoom.
Browser: mobile/desktop, BG/EN, dark/light startup matrix; no-history denial and 259 km rejection; manual city persistence/reload; accurate travel fix; city-level street suppression; delayed/stale GPS/reverse responses; same-coordinate GPS; 15 minute refresh and quiet failure/recovery.

No changes to Push, VAPID, Supabase, weather-warning thresholds or Production configuration. No merge or Production deployment.

## Validation

- `npm test`: 2203 total; 2192 passed, 0 failed, 1 skipped, 10 pre-existing TODO.
- Focused location unit tests: 54 passed.
- Chromium GPS matrix: 102 passed (390/1440px, BG/EN, light/dark).
- Production-build startup/lifecycle browser suite: 10 passed.
- Repeat of new accuracy/reload/travel/address and stale/same-coordinate scenarios: 9 passed.
- `npm run lint`: exit 0; two existing no-unsafe-finally warnings in scripts/push-node-operator.mjs (unchanged).
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Browser network dependencies use deterministic fixtures; these checks validate application handling of browser GPS reports, not physical device positioning or live provider accuracy.
