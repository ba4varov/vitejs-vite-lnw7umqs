# Meteo Pulse — earthquakes nearby: architecture and rollout gates

## Confirmed product defaults
- **Radius:** 100 km around the selected / confirmed city or accepted location.
- **Magnitude:** M 3.0 or stronger.
- **Desired Push:** ON in product configuration, **NOT authorization** to deliver a notification.
- Language: Bulgarian and English. All timestamps of events are UTC epoch; display in the selected city's forecast timezone.
- Notifications concern **recorded** earthquakes, not an early-warning or evacuation system.
- Attributing agency and status: USGS preliminary data; event parameters are subject to revision. Never claim that shaking was experienced merely from magnitude or distance.

## Stage A — implemented in this PR
1. Public, existing Vercel endpoint `GET /api/alerts?source=earthquakes` polls the fixed USGS `2.5_day.geojson` feed, checks shape, removes invalid/non-earthquake/old events, returns a bounded sanitized list. USGS recommends GeoJSON for real-time map displays.
2. CDN cache `s-maxage=60`, instance cache 60 s, and 90-second visible-tab polling. **No visitor coordinates are sent to USGS or to the API**; the browser uses its already accepted location to compute Haversine distance.
3. Only M≥3.0 events inside 100 km and in the last 24 hours are displayed, max five rows. When there is no matching event, hide the section entirely. If the feed is unavailable, never claim "no earthquakes"; fresh previously confirmed data may be marked stale for up to 5 minutes.
4. Each row shows source, event magnitude, distance, depth (if available), local time and direct link to the USGS event detail. Separate visually from NIMH official *weather* warnings.
5. `EARTHQUAKE_DEFAULTS.pushRequested=true` is **a planned product preference only**; `EARTHQUAKE_PUSH_DELIVERY_ENABLED=false` is hard-coded and the feature never sends or asks browser permission.

## Stage B — separate reviewed PR before any automatic delivery
1. Decide EMSC terms, ingestion reliability and provider cross-catalog matching. USGS is the live Stage A source; EMSC is not yet a second live input. Avoid double-counting when two agencies revise the same event.
2. Persist **explicit opt-in** per authenticated user and city, with default proposed radius 100 km, M3.0, provider scope, updated timestamp, granted notification permission, device subscription and a clear disable/delete control. Do not persist precise GPS: prefer user-selected city centres. User profiles and RLS must isolate recipients.
3. Server-side scheduler or durable worker, NOT a per-device WebSocket: fetch one shared feed per minute or use a single EMSC subscription. Filter per saved city and account, require event time AFTER consent, require recent event (at most 45 minutes), require an active user-controlled consent, available provider rights and a valid device. No backfill on first registration.
4. Persistent, atomic outbox with unique key `(user_id, event_provider, event_id, notification_type)` and explicit state `prepared/attempted/accepted/failed/uncertain`. Insert **before** dispatch. Recheck account+device consent before each attempt. An uncertain provider result must not trigger automatic retry. Source event revisions update the existing record but don't create another alarm.
5. Integrate via the existing `push_devices` and `push_preferences` system, not a second push sender. **Existing `supabase/functions/push-check` returns 503 `PUSH_DELIVERY_NOT_IMPLEMENTED` and `server/push-core.js` returns `deliveryEnabled:false`. This is intentional. No automatic earthquake send may bypass those controls.
6. Review rate limits, privacy, opt-out, feedback, anti-spam, provider restrictions, and staging delivery tests before flipping any feature flag. Monitor missing/stale source and duplicate-ID rates. Neither a successful local notification nor an HTTP 2xx alone proves successful delivery on Android.
7. Explicit notification text: **"Регистрирано земетресение M 3.5 на 62 км от [град] — предварителни данни, USGS, [час]"**, NOT "земетресение ще има" or an unsupported instruction to evacuate. Do not notify a user again for mere changes in magnitude/depth unless a separately approved update policy exists.
8. Hide/stale if data freshness is outside the contract; no misleading "all clear"; emergency preparedness content should defer to authorities.

## Performance and usage estimates
USGS updates its GeoJSON summary feeds every minute; site display can lag due to upstream publication, CDN (60 s), visible-tab polling (90 s), and device scheduling. **This is near-real-time, not instant.** User positions are not uploaded as HTTP query parameters. API is shared/cached per edge/instance and has fixed provider URL, 7.5-second timeout, response-size limit and no arbitrary parameters.

## Security and tests
- Input sanitization: only earthquake events, valid numeric longitude/latitude, range/time/magnitude checks, safe provider URLs, bounded response.
- Protect against provider outage vs confirmed empty feed, stale data, cache duplication, false alerts for far-away or weak quakes.
- Client never invokes `Notification.requestPermission()`, `showNotification()` or the existing Push API for this feature.
- Tests: pure Haversine / feed validator / 100 km+M3.0, API cache and errors, fail-closed push contract, visual BG/EN at 360/390/768/1440 and location switching.
- Acceptance for future Push is **explicit human opt-in and successfully tested authenticated server delivery**, which is outside the scope of this Draft PR.

## Public references
- USGS GeoJSON feeds: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
- USGS Earthquake API: https://earthquake.usgs.gov/fdsnws/event/1/
- EMSC FDSN-WS Event: https://www.seismicportal.eu/fdsn-wsevent.html
- EMSC near-real-time notifications: https://www.seismicportal.eu/webservices.html

### Vercel Hobby function count
The existing eleven API functions are already at the project limit. This feature adds **no new Lambda**: it routes `/api/alerts?source=earthquakes` to the dedicated feed core while leaving the authenticated `/api/alerts` and `?source=nimh` untouched. The existing Node security workflow must remain successful.
