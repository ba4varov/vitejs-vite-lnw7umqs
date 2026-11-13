# Official NIMH warnings — local investigation, 13 November 2026

## Sources and reuse

- https://meteo.bg/ explicitly links its “Опасни явления” and warnings panels to https://weather.bg/obshtini/.
- https://weather.bg/obshtini/index.php?z=d&o=VAR and `z=u` returned HTML tables with explicit municipal cell background colours, hazard column headings, regional warning text, issue timestamps and forecast dates. No pixels, map fill colours, or forecast thresholds are used to infer official codes.
- Municipality cells explicitly use `#ffff00`, `#ff8000`, `#ff0000`; the adapter accepts those and explicit green cells only. Regional rows carry explicit `bgcolor` values. Hazards use the source's icon legend, not image recognition.
- No documented public API, stability contract or automation-specific licence was found on the inspected pages. meteo.bg's copyright notice permits distribution with attribution to НИМХ and requires that content not be modified. Original warning text is retained (HTML whitespace and line breaks normalized), attributed and linked. English UI labels are translated; official Bulgarian text is shown verbatim as Bulgarian, with an English explanation. This is not a guarantee of future access or a blanket licence for other products.
- meteo.bg/robots.txt specifies Crawl-delay: 10 and does not disallow the inspected home page. weather.bg/robots.txt returned 404. Robots instructions are not a licence. The runtime fetches weather.bg only, not meteo.bg or its image host. No domains were added.
- The initial request for tomorrow returned 502; a later diagnostic request succeeded. The implementation independently handles failure of either date.

## Varna: data actually obtained

For 13 November 2026, municipality Варна has **yellow / wind**, with source text:

> Силен вятър: скорост 14-19 m/s (50-69 km/h) и/или пориви до 24 m/s (90 km/h)

The district is separately **orange / wind**:

> Фьон с пориви до 32 m/s.

The separate **orange marine warning** reads:

> Силен вятър от юг-югозапад с пориви 22-25 m/s (9-10 бала по Бофорт). Вълнение на морето 4 бала.

The regional issue timestamps were 2026-11-12 11:02:07 (land) and 2026-11-11 12:03:34 (marine). For 14 November, both regional rows and municipal cells were green; no yellow/orange/red warnings were returned for Varna. These are investigation snapshots, not permanently current warnings.

The municipal forecast says its text is standard wording based on NIMH thresholds. An orange district code must never replace Varna municipality's yellow code. Other municipalities in the same district differ (e.g. Аврен orange, Аксаково yellow on 13 November).

The source specifies a forecast calendar date, not municipality-specific start/end instants. UI displays that date with the calendar-day/Europe/Sofia qualification; it does not invent more precise times. The current adapter supports the two dates published by the source, not a 72-hour official forecast.

## Implementation and resource limits

`GET /api/alerts?source=nimh&id=<GeoNames settlement ID>` is an isolated public read branch in the existing alerts function. Other requests continue through the existing authenticated alerts handler. No Serverless Functions, database tables, cron jobs, dependencies or secrets were added. Push and Nimbo code is untouched.

The server resolves the selected settlement ID via geocoding-api.open-meteo.com/v1/get in Bulgarian, requires BG, maps admin1 to an official district selector, and requires an exact municipality row after removing the explicit “Община” prefix. Sofia city and Sofia province are distinct; the verified Stolichna municipality ID 6458974 maps to the source's “Столична”. Other missing or ambiguous names fail closed. English selections resolve through the same Bulgarian administrative names. Built-in Bulgarian city buttons carry verified settlement IDs.

GPS-only and older saved locations without a settlement ID are explicitly unverified: users can select the settlement from search. No boundary polygon service or nearest-town inference was introduced. This is a deliberate coverage limitation, not an assertion that no warning applies.

One geocoding lookup is cached for 24 hours. Two regional pages are cached for 15 minutes and shared across municipalities and concurrent requests on a warm instance. Cache size is bounded to 160 entries; failures cool down for one minute. Cache keys include the Sofia forecast date. HTTP caching is 60 seconds browser / 300 seconds shared; no stale-while-revalidate. The document shares in-flight requests and 15-minute results, capped at 100 entries. Visible tabs refresh every 15 minutes; return-to-tab checks have a five-minute cooldown. A failed refresh clears visible official codes. Records older than 20 minutes or before today's Sofia date are hidden. A cold instance has its own cache; this is not a globally enforced upstream rate limit.

Fetch targets are fixed to weather.bg and geocoding-api.open-meteo.com; redirects are rejected, requests time out, and unknown HTML structure, colours, dates, hazards, columns or municipality names stop verification. District and marine rows remain distinct. A failure never produces a fabricated green/yellow/orange/red code.

Open-Meteo wind_gusts_10m is added to the existing hourly forecast request, without an extra request. Gusts of at least 65 km/h in the next 24 available hourly samples trigger a clearly labelled indicative notice. Existing forecast notices and RainWarning remain separate from official NIMH cards. The new warning path uses only the five allowed weather domains; pre-existing marine, reverse-geocoding, map and other features were not changed.

## Local validation

- Real-source fetch through the production handler using local Node and the environment proxy resolved Varna and returned all three scoped warnings plus verified green data for tomorrow.
- Original source table excerpts are fixtures with attribution. Unit tests cover Varna/Аврен scope differences, green/red, unknown colours, reordered columns, stale/impossible dates, unknown municipality/country, Sofia midnight and daylight saving time, concurrent request sharing, cache expiry and upstream failures.
- Browser tests cover 390px/1440px, BG/EN, light/dark, card placement above the main weather card, no horizontal overflow, gust notices, deduplication, failure refresh and city changes. They use controlled API data, not live-browser access to NIMH.
- Deployment is disabled for branch `fix/nimh-warnings` in vercel.json before the branch is published. No Preview or Production deployment is requested. The intended deliverable is a Draft PR only.

### Results

- Full unit suite: 2,218 passed, zero failed, one skipped, ten pre-existing TODO tests (2,229 total at run time). The TODO assertion diagnostics are printed by Node but the suite exits successfully.
- Final focused suite: eight passed, including public/private route dispatch, Sofia/municipality normalization and the existing eleven-endpoint budget guard.
- Browser regression suite: all 17 passed (eight official-warning combinations and nine existing rainfall-warning cases).
- TypeScript/frontend build passed. Lint passed with only the two existing `no-unsafe-finally` warnings in the unrelated push operator script.
- Actual Open-Meteo Varna request returned 24 hourly gust samples in km/h (daily maximum 56.5 km/h at investigation time). This illustrates why forecast-derived notices cannot substitute for NIMH codes.
