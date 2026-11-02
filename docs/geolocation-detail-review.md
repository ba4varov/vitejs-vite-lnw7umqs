# Reverse-geocoding detail review

Reviewed PR #125 head `129ace8a` against pre-#124 main `36f7e812`.

## Finding

Both reverse helpers previously requested zoom 18 unconditionally. The current app calls the helper in `current-location-localization.js`; the alternative `reverse-geocoding.js` helper currently has only test callers. PR #124 changed both to zoom 10 when browser accuracy exceeds 100 m or is unknown. It also hid the combined detail field above that threshold. That field contained a street if available, otherwise a suburb/neighbourhood/city_district. Thus both changes can remove neighborhood information; the filter also discards a neighborhood even if the provider supplies one at zoom 10.

This proves the code path, not the cause on a particular computer. The browser's actual accuracy and provider response on that computer have not been measured here. The same computer may receive different Wi-Fi/IP positioning estimates over time. A previous detailed label from the nearest map feature was not evidence that its precision was justified.

## Limited correction

- Parse street and neighborhood separately using one shared policy in both helpers. A provider district is never returned as an exact street address. Display it as “Приблизително местоположение” / “Approximate location”, including when no street is available. Never invent a district from display_name, county, an empty value, or a city name.
- Keep the existing conservative ≤100 m detail threshold and zoom 18/10 selection. A precise fix can show the provider's street, its separately labeled district, or just city if no detail is returned. Accuracy is the browser's estimate, not a guarantee of an exact address or district boundary.
- For >100–3000 m, retain city only. A single nearest-feature reverse response supplies no district-boundary or uncertainty-area evidence. Introducing an arbitrary 500 m/1000 m “district threshold”, or requesting zoom 18 for a coarse fix, would create detail without proving it reliable.
- Keep >3000 m rejection and the existing last accepted city behavior. The initial-location module adds only an in-memory observation/getter for reported accuracy; permission queries, GPS request options, elections, deadlines, StrictMode and late-callback guards remain unchanged.
- Show last reported browser GPS accuracy locally, rounded upward to whole metres, including a rejected 259471 m observation. Diagnostics contain no coordinates, provider payload, street, district or account ID. They add no fetches, telemetry or persisted diagnostic record. Existing reverse requests and existing confirmed-location storage remain unchanged. Automatic observations are consumed only by the active guarded subscriber; explicit observations use the existing request generation check.
- Preserve manual selection, language/reverse response guards and forecast refresh behavior.

This deliberately does **not** restore neighborhoods for accuracy above 100 m. To investigate a device, read the new metre-only diagnostic. If it exceeds 100 m, use the city forecast and an explicit manual city choice, or retry location with more accurate browser/system positioning. A future broader neighborhood policy would need trustworthy district polygons and a check that the reported uncertainty area lies within a district; a point label or bounding box alone is insufficient. Such a data integration is outside this limited change.

## Validation

77 focused location unit tests passed, including unchanged permission/startup scenarios plus exact street, district-only, street plus district, city-only, 100 m boundary, unknown accuracy, coarse 259471 m rejection, helper parity and scalar-only accuracy diagnostics.

Changed TSX/TS syntax parsing and whitespace checks passed. Added BG/EN Playwright coverage for exact street, approximate district without street, city-only at 250 m, preservation after a coarse fix, and diagnostics without coordinates. Application Playwright, lint, typecheck and build remain blocked by absent project dependencies and the previously observed unavailable environment proxy; these are not recorded as passing. No live provider result or physical-device measurement is claimed.

No permission-flow change, Push/Supabase/Vercel/domain change, merge or Production deployment.
