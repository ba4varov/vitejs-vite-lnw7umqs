# Forecast rainfall warning

The homepage derives a single warning directly from its existing Open-Meteo hourly snapshot, for every account tier and guests. No persisted alert kinds, notification contracts or backend configuration change.

`src/rain-warning.js` scans every complete sliding 1/6/24-hour window ending within the next 72 hours, keeping the maximum for each duration. Only finite nonnegative rainfall observations qualify. Missing values, gaps, duplicate times and ambiguous DST folds invalidate the affected windows. The existing IANA resolver handles time zones; spring-forward hours remain consecutive in elapsed time. A partially started hour is excluded without estimating its remaining precipitation.

Thresholds are inclusive: 15/35/65 mm over 24 hours, 20 mm over 6 hours, and 10 mm over one hour. The highest severity wins; ties prefer the longer duration. A qualifying 6-hour maximum is shown inside a 24-hour warning as additional intensity evidence. These are indicative product thresholds, not official warning codes.

The existing coordinate ownership and request guards prevent stale forecasts on city changes. The warning also disappears while explicit GPS resolution is pending. Refresh replaces the same section; no toast, history write or repeated live announcement is generated.

Tests use controlled hourly data and intercepted browser requests. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/rain-warning.spec.ts`.
