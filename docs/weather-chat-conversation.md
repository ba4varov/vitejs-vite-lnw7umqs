# Weather chat conversation

`src/App.tsx` sends messages to `api/weather-chat.ts`. The API validates input,
classifies the question with `server/weather-chat-core.js`, resolves explicit
locations with Open-Meteo geocoding, fetches forecast/archive data, and renders a
deterministic answer. The existing optional Gemini understanding fallback remains;
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

Weekday names (понеделник–неделя and Monday–Sunday) select the nearest occurrence,
including today, using the selected location's local calendar date. A weekday
follow-up inherits the city and measure, and never triggers geocoding for the
weekday itself. Weekday words inside compound place names remain part of the
location (for example Friday Harbor and Света Неделя).

A negative umbrella recommendation requires finite precipitation amount and
probability values for every selected hourly row. Explicit numeric zeros are valid;
null, undefined and non-finite values are missing. If the available data do not show
rain but are incomplete, the answer explains the uncertainty and suggests carrying
an umbrella as a precaution. Positive rain evidence can still support taking one.
