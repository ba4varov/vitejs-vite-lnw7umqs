# Weather chat conversation

`src/App.tsx` sends messages to `api/weather-chat.ts`. The API validates input,
classifies free questions with server-side Gemini (validated against `server/weather-chat-core.js`), resolves explicit
locations with Open-Meteo geocoding, fetches forecast/archive data, and renders a
deterministic answer. The local parser is the fallback when Gemini is unconfigured, unavailable, over budget or invalid;
weather values and advice never come from generated model text.

The client keeps the last successful response's `context` in a React ref. It
contains the resolved city and coordinates, weather intent, time scope, target
date and previous question. It is not persisted or shared between users. It is
cleared together with chat messages on interface language or selected-city changes.
Failed and unrelated requests do not replace it. Older clients can omit context.

The context-aware parser extracts new entities independently. A new date overrides
the prior date; a new city overrides the prior location; a measure-only question
retains location and date. Relative scopes are recomputed in the destination's
Open-Meteo timezone on each request. A specific calendar date remains fixed.
Quick actions retain their existing selected-city/next-12-hours behavior.

Context is bounded and validated as untrusted request data. It contains no weather
measurements. All measurements are fetched again. Missing measurements produce an
availability message or an unknown field, never a fabricated zero. Future or
historical AQI and marine questions cannot use current observations as substitutes.
Message language can select Bulgarian or English independently of the interface
preference; messages without a language signal use the existing preference.

Verification: `npm run lint`, `npm run build`, `npm test`. The conversation unit
suite covers inheritance, city/date overrides, missing measurements, both languages
and timezone/year boundaries. The handler suite exercises real request sequences
with mocked upstream responses, including a local-midnight date boundary and
message/interface language differences. No external service is called by these
chat tests.

Bare weekday names (понеделник–неделя and Monday–Sunday) select the nearest
occurrence, including today, using the selected location's local calendar date.
Qualified weekdays use Monday–Sunday calendar weeks: `този`/`тази`/`this` select
the day in the current week (possibly in the past); `следващия`, `следващият`,
`следващата`, `идния`, `идният`, `идната` and `next` select the day in the next
week. For example, on Sunday 2026-10-18, `в неделя` and `тази неделя` mean
October 18, `следващата неделя` / `next Sunday` mean October 25, and `this Monday`
means October 12. Calendar arithmetic uses the destination's local date, so DST,
midnight and year changes do not depend on the server's timezone. Dates outside
the returned forecast retain conversation context and produce an availability
message without substituting today's measurements. A weekday
follow-up inherits the city and measure, and never triggers geocoding for the
weekday itself. Weekday words inside compound place names remain part of the
location (for example Friday Harbor and Света Неделя).

A negative umbrella recommendation requires finite precipitation amount and
probability values for every selected hourly row. Explicit numeric zeros are valid;
null, undefined and non-finite values are missing. If the available data do not show
rain but are incomplete, the answer explains the uncertainty and suggests carrying
an umbrella as a precaution. Positive rain evidence can still support taking one.

## Pending clarification

The optional `pendingClarification` request/response field keeps a bounded,
data-only understanding (`intent`, explicit city, time scope, calendar date), the
original question, optional prior context, missing slot and attempt count. The
client sends it back on the next message. It uses an in-memory ref and clears it
on a completed/new turn or together with conversation reset on city/language
changes; stale/aborted responses cannot restore it. Older API clients still work
without this optional field. No UI or dependencies changed.

`clarificationTurn` wraps the existing deterministic conversation parser. A new
city without a measure asks “Какво Ви интересува за Пловдив?” (using the requested city). Without context it asks what weather information is wanted for
that city. Explicit questions proceed directly. Short measure, date and region
answers complete the pending request while preserving its other entities. A new
question with an explicit new city, unrelated request, cancellation or quick action starts a fresh turn.
A short complete measure question such as “Ще вали ли?” also completes the
pending city clarification and retains the known period.
Unresolved dates ask only for a day; geocoding ties ask for a region/country and
keep the original measure and date. A qualifier that still leaves a tie cannot
silently select a city. Missing place names can be corrected separately.

Both languages use the same transitions. Up to three clarification prompts are
retained; the next unresolved answer explains the missing information and drops
the pending state. Validation rejects extra fields, invalid coordinates/enums,
invalid calendar dates, questions over 400 characters, city names over 100,
clarification text over 180 and attempt counts outside 1–3. Pending context never
contains measurements and cannot nest another pending state.

Intent/date clarification returns before geocoding, forecasts, AQI or marine calls.
Gemini understanding runs first for free questions within the instance budget. Location ambiguity needs geocoding only; weather retrieval waits
until the location resolves. Relative scopes retain destination timezone behavior;
yearless calendar expressions remain available for local date resolution. Missing
weather measurements still use the existing deterministic availability rules.

Additional verification: `tests/unit/weather-clarification.test.mjs`, actual
request sequences in `src/weather-chat-handler.test.mjs`, and browser state/reset
coverage with:

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/weather-chat-clarification.spec.ts --workers=1
```

The handler and browser suites mock external services; they do not test live
Open-Meteo availability.
