# Initial forecast loading correction — PR #87

The forecast now owns the loading state. Initial opening and switching coordinates show a compact, localized weather placeholder. Projects and advertising mount only after a valid forecast for the selected coordinates. Refreshing those coordinates keeps the existing forecast visible with a polite updating indicator; a failed refresh retains the last valid forecast and offers the existing retry control. Initial failure keeps promotional sections absent.

The successful forecast records its coordinates. Coordinate changes hide the previous dashboard immediately, including open detail popups, and request cleanup invalidates late responses. Existing request ID guards remain in place. API URLs, the 15-minute interval, weather calculations, Push and account/profile logic are unchanged. The AQI changes already in PR #87 are retained.

Validation:
- Build: passed.
- Lint: passed.
- Unit: 335 passed, 1 skipped, 0 failed (336 total).
- New loading browser scenarios: 11 passed. Includes BG/EN, light/dark, 390/1440px, delayed initial response, refresh, location change, errors/retry, geolocation and stale responses; a DOM observer checks no promotional section appears without the forecast.
- Final sequential browser run: 223 passed, 0 failed. Covers all 11 loading scenarios, 32 AQI cases, forecast cards and native gestures, section order/detail interactions, navigation and current weather cards. Earlier concurrent runs hit resource-related timeouts; the complete sequential rerun passed.

All browser checks use mocked providers and local Chromium. This is mobile viewport coverage, not a physical Android device test. No merge, production deployment, migration or secret changes.
