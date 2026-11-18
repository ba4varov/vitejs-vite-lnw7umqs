# Meteo Pulse – earthquake history (Bulgaria and Balkans)

This feature is a **browse-only catalog**. It is independent of the selected weather city, the live 300 km/M3.0 notification panel and the existing Push infrastructure. No early-warning claims.

## User experience

- Collapsed **"Последни земетресения / Recent earthquakes"** section is always discoverable on the dashboard, including before accepting geolocation or choosing a city.
- No network request for history until a visitor opens it.
- Two region filters: **"България и близки райони / Bulgaria and nearby areas"** and **"Балкански регион / Balkan region"**, with explicit disclaimer that these are approximate coordinate rectangles rather than national borders.
- Time range: **last 7 or last 30 days**, USGS **M 3.0+**, 10 entries initially, optional "Show more" up to 100.
- Show origin time converted to **Europe/Sofia**, source name, epicenter description, depth and source link. USGS may update its preliminary earthquake solutions. Do not misrepresent a missing event as proof of no seismicity.
- The live nearby panel retains **300 km radius, M3.0 and last 24h**. Browse-only history never requests notification permission, never invokes Push endpoints and does not send location coordinates.

## Architecture

- Public endpoint: `GET /api/alerts?source=earthquake-history&period=7` (or `period=30`), routed through existing Vercel `api/alerts.ts` Lambda. No additional Vercel functions.
- Backend FDSN USGS Event API: `https://earthquake.usgs.gov/fdsnws/event/1/query` with **fixed server-owned** bounding box 34.5–47.5 N / 12.5–31.5 E, `eventtype=earthquake`, `minmagnitude=3`, `orderby=time`, `limit=500`, and 7/30 day UTC starttime. Only these two periods are accepted. Client location, coordinates and arbitrary filters are not sent upstream.
- Reuse `normalizeUsgsEarthquakes` with a validated *optional* age window. Its default 24-hour, M3.0 behavior remains unchanged for the existing nearby service.
- Limit upstream payload to 2.5 MB, set 8.5s timeout, validate earthquake fields/types/times, deduplicate event IDs, reject invalid links, cap output to 500. Return API `503` on unverified outage, explicitly marked stale cached records for up to 30 minutes, no misleading "all clear".
- Per-period single-flight caching in server instance: 10 minutes, CDN cache `s-maxage=600`, client cache 10 minutes, only fetch when expanded, not every weather auto-update. Region switching performs a local geospatial filter, not a new fetch.
- Bulgaria/nearby filter: 41.0–44.4 N / 22.0–29.3 E (includes border/nearby waters). Balkan region: full query rectangle. The labels **must not claim precise country boundaries**. For exact national borders, a future version would require geographic polygons with provenance.
- If USGS reaches the 500 result cap, explicitly disclose that the listing might be incomplete.
- No Supabase migrations, accounts or location permissions required; no push notifications.

## Validation and constraints
- API contract, region filtering, old events and unchanged 24-hour alert semantics, cache freshness/staleness, empty USGS 204 responses, strict period query and NO user GPS.
- Playwright visual regression in Bulgarian/English, four widths and both themes; history open/close, lazy fetch, 7/30 days, more rows, outage, stale badge and no selected location.
- Verify the live FDSN endpoint and actual event coverage after approved merge. Automated network fixtures establish data parsing and safety, **not completeness of the real catalog**. USGS may not include all smaller earthquakes that local regional networks report.

Reference: https://earthquake.usgs.gov/fdsnws/event/1/ (USGS official FDSN event catalog documentation).
