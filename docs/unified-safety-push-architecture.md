# Meteo Pulse — unified safety Push delivery (weather + earthquakes)

## Product contract

Automatic Push delivery must serve **two independent safety needs** through **one secure delivery infrastructure**. This is not earthquake-only Push.

1. **Forecast danger, ahead of time:** heavy precipitation, thunderstorms, high wind, extreme heat and extreme cold, according to an up-to-date Open-Meteo forecast, scoped to the user's **saved cities and selected weather risk categories**. Send sufficiently early to be useful; the initial proposed preview horizon is **24 hours** (only after the user opts in). Forecast estimates are *not official government warnings*.
2. **Official NIMH severe-weather color codes for Bulgaria:** yellow/orange/red alerts where the administrative district/municipality is confidently resolved and the warning source confirms validity. Such messages must explicitly say **"Официален код от НИМХ"** with source/date/area. This is a separate ingestion and authorization task: the current `OfficialWarnings` UI does **not** by itself authorize automatic sending. Never infer an official code from Open-Meteo. No NIMH outside Bulgaria.
3. **Recorded earthquakes:** USGS verified feed, **M 3.0+**, within **300 km** of the separately opted-in saved city, up to **45 minutes after event origin**, and strictly **after** the opt-in time. Not prediction or earthquake early warning.

The Push settings in `src/PushSettings.tsx` already support weather hazard categories `rain/storm/wind/cold/heat`, selected cities (up to five), and device enrollment. `src/EarthquakePushOptIn.tsx` supplies a **different opt-in** for a selected saved earthquake city. An opt-out in either channel must never silently modify the other channel.

## Already implemented foundation

- Weather forecast input: `server/push-forecast.js` fetches up to 72 hours of forecast data from a fixed Open-Meteo origin and validates freshness, values, hourly sequence and time zone; `evaluatePushForecast` uses `forecastRisks` (hourly rain ≥10 mm, wind ≥60 km/h, WMO thunderstorms 95/96/99, feels-like ≤−15°C or ≥40°C).
- Recorded events: `server/earthquakes-core.js` validates the USGS feed and geographic distance; `server/earthquake-push-eligibility.js` plans dry-run events by device/user.
- Consent persistence: existing weather `public.push_preferences`; separate `public.earthquake_push_optins` in migration `20261118093000_earthquake_push_opt_in.sql`. Check whether that migration has actually been applied before exposing controls as working—Git merge alone **does not apply it**.
- Future dedup ledger: existing `public.push_deliveries` unique key `(device_id,event_key)`; **NO active dispatcher** currently uses it.
- Current automated delivery is **disabled for both weather and earthquakes**. The existing `supabase/functions/push-check/index.ts` returns HTTP 503. The current Node sender is limited to a controlled one-off diagnostics flow.

## This PR: one pure safety-candidate planner, zero sends

- `server/safety-push-preview.js` unifies **weather** risk candidates from existing validated server forecast logic and **earthquake** candidates from the previously tested USGS logic.
- Weather uses the user's saved cities, enabled categories, owner-bound registered device, valid non-expired registration, fresh forecast and the initial **24h lead window**; stale/invalid data cause no candidates rather than a misleading `all-clear`.
- Weather event keys have stable identities `weather:open-meteo:<SHA-256 city fingerprint>:<risk kind>:<local YYYY-MM-DD>`, capped at one per **device, saved city, hazard and local day**. This avoids repeated notifications when forecast start times drift by an hour.
- Earthquake event keys remain `earthquake:usgs:<USGS event id>`, scoped to the device through the same unique ledger key. The planner returns separate channels and source classifications. For real delivery a shared transactional dispatcher **must use DB-level unique claims**, because the preview's in-memory Set is insufficient for concurrency.
- The preview contains no credentials, Web Push transport, network calls, Cron schedules, database writes or automatic permission requests. Both delivery gates remain **false**.
- Unit tests cover risk filtering (rain/wind/storm/cold/heat), weather-vs-quake consent independence, saved cities and account ownership, 24h time horizon, stale forecasts, dedup and no-delivery.
- **No new API functions**, no Supabase migration, no Vercel Preview/Production deployment in this PR.

## Pending Stage B2 – shared safe dispatcher (new review and PR)

**One** authenticated scheduled worker, not a public or browser-triggered endpoint:

1. Read only currently enabled weather preferences and separately enabled earthquake consents from durable Supabase storage. Verify an active, registered, non-expired device and permission/provisioning readiness.
2. Use **batched city-level Open-Meteo forecasts** (reuse per city, not per device) and a single cached USGS feed across users. Verify USGS freshness. For Bulgaria only, add a trusted, explicitly scoped NIMH official-warning ingestion pipeline and a source/date/area contract before enabling that subchannel.
3. Generate bounded candidates. Respect opt-in timestamp and current city/category preferences. Send weather alerts before the forecast hazard (initially within 24h); prioritize immediate severe hazards, avoid multiple daily alerts for the same risk. Clarify forecast uncertainty. For earthquakes, announce already **recorded** events only.
4. In a single privileged SQL transaction, verify **user, current consent, registered device, provider keys, source freshness, event identity** and uniquely insert `(device_id,event_key)`. Claim exactly once; mark `uncertain` immediately before the irreversible provider call. No retries of unknown outcomes. Suppress repeat notification on refresh, multi-worker overlap and category changes. Add bounded per-user/device rate limits and quiet-hour policy for noncritical events.
5. Use the existing validated provider transport, VAPID and encryption contracts. Preserve DNS pinning/TLS; never permit redirects or untrusted URLs. Track accepted/rejected/unknown provider results separately from device delivery (provider HTTP 201 does not prove display).
6. Deliver with a **new, default-OFF operator gate**, staging only, explicit single-device user consent, and end-to-end mobile/browser verification. Confirm resource use under the **11 Vercel API function** limit and keep per-device polling out of the client.
7. After the user approves both behavior and safety checks, activate production delivery in one controlled release. Opt-outs must take effect before the next dispatch; no historical backfill.

### Message labels (illustrative, not dispatched)

- Weather forecast: `Очаква се силен вятър във Варна следобед. Прогноза: Open-Meteo. Възможни са промени.`
- Official weather: `НИМХ: оранжев код за област Варна, валиден на [дата].` **Only after confirmed NIMH source and administrative area.**
- Earthquake: `Регистрирано земетресение M 3.6 на 180 км от Варна. Източник: USGS.` **Only after verified event coordinates and calculation.**

These are examples of the intended wording, not claims about current conditions.
