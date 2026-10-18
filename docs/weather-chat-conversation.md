# Weather chat conversation

`src/App.tsx` sends messages to `api/weather-chat.ts`. The API validates input,
classifies free questions with server-side Gemini (`server/weather-chat-semantics.js`), resolves explicit
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

`resolveSemanticTurn` consumes a validated Gemini interpretation without calling
any local intent, city-phrase or time-phrase parser. Its structured `turnType`
separates new questions, follow-ups, clarification replies and cancellation.
`citySource` selects an explicit canonical place, confirmed context, the selected
city or a genuinely missing location. `timeSource` selects an explicit period,
confirmed context or the default. `missing` identifies the actual missing slot;
it must agree with `needsClarification`.

The original validated input/context/pending state is supplied to Gemini.
Standalone questions discard old slots according to the validated turn metadata;
continuations retain confirmed slots when context is requested or the slot is
omitted (selected/default). Explicit new city, date and topic win. An old `timeScope: now` cannot erase a period whose source is
context. A clear general weather question about a city uses a labelled next-12-
hours forecast by default, with no intent clarification. Explicit current-condition
questions can use now. City-only fragments can still request the missing intent.

Numeric calendar literals are checked independently of semantics, explicit dates
are resolved in the destination timezone, and Open-Meteo geocoding still verifies
places/qualifiers and asks about ties. An AI intent alone does not fill an already
unresolved date or location slot. No weather numbers or free-form answers are
accepted from Gemini. The existing `clarificationTurn` phrase-based parser runs
only for unconfigured/unavailable/invalid/over-budget Gemini or a quick action;
its vocabulary is unchanged and has no AI-specific hooks or typo dictionary.

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

## Thunderstorms and Gemini clarification resolution

`thunderstorm` is a separate validated intent, supported by Gemini and the local
BG/EN parser (thunder, lightning, thunderstorms, гръмотевици, гърми, мълнии).
On a pending intent question, a valid Gemini weather intent can resolve the slot
even when local vocabulary/fragment rules do not recognize the wording. This
also applies to other weather intents; it is not a phrase-specific exception.
The semantic slot resolver handles confirmed city/period inheritance, explicit
changes and cancellation independently of fallback phrase recognition. Calendar
validation and geocoding remain local. A standalone question clears old slots.

The deterministic thunderstorm renderer uses only Open-Meteo WMO codes 95, 96
and 99. Current questions use current codes; calendar days use the daily code
and hourly evidence for that day; hourly windows use only matching hours, and
weekends are evaluated per requested day. Daily codes summarize the day's most
severe condition. Positive hourly evidence is retained even when daily data are
missing or disagree. An hourly-only negative requires complete timestamp/code
coverage; gaps, null/unknown codes or duplicate rows cannot substitute for the
missing hours. Without enough data the answer says so. A nonstorm forecast is
phrased as no indication, never a guarantee. Rain probability is not used as
thunderstorm probability. Responses do not invent warnings or lightning-strike
locations/times. An unspecified period (`general`) covers the next 12 hours and
is labelled accordingly.

## Safe server diagnostics

Diagnostics distinguish understanding, transport stages and the final decision,
joined by a random per-request `requestId` that is neither persisted nor a
user/session identifier:

- `[weather-chat:understanding]`, phase `invocation`, reason `gemini_invoked`:
  the client is about to be invoked. A failed discovery may not reach generation.
- The same prefix, phase `result`: `gemini_valid` means the entire semantic
  contract validated. Fallback reasons distinguish `missing_configuration`,
  `quick_action`, `budget_exhausted`, `invalid_json`, `invalid_structure`, `quota`,
  `authentication` (401), `permission` (403), `timeout`, `network_error`,
  `discovery_failed`, `model_unavailable`,
  `upstream_http` and `unexpected_error`.
- `[weather-chat:gemini-stage]` records `discovery` or `generation`, monotonic
  `durationMs`, `code` (`ok` on success) and HTTP error `status` (null otherwise).
  A direct configured-model request emits only generation. A 404 recovery emits
  generation failure, discovery, then at most one more generation. All share
  the handler request ID. See [latency budgets](bobi-gemini-production-latency.md).
- `[weather-chat:decision]` is emitted at the response boundary. `source` is the
  interpreter actually used (`gemini`/`local`, or `none` for a rejected request),
  `outcome` distinguishes an answer, clarification, unrelated request,
  unavailable data, rejection or error, and `reason` identifies the fixed
  decision category. A valid AI result followed by a geocoding/calendar
  clarification is visible as such; it is not logged as a local fallback.

Only fixed enums, numeric durations/status codes and random request IDs are
logged. No messages,
cities, coordinates, keys, model prose, raw errors or stable personal identifiers
are included. The Gemini client's error log also omits upstream prose, upstream
status strings and model names, which can contain untrusted data.

## Generated language checks and their limits

`tests/helpers/bobi-language-corpus.mjs` generates BG/EN variants for six intent
families using seeded character deletion, insertion, repetition, transposition,
phrase reordering, informal wrappers, punctuation and case changes. The expected
interpretation comes from a semantic fixture, never from parsing the mutated
text. Unit/real-handler tests assert that valid mock semantics reach the final
answer and the matching decision log. Other tests cover context transitions,
explicit overrides, the default period, genuinely missing slots, geocoding ties,
invalid calendar dates, unrelated/instruction requests and fallback. No typo
variants enter production dictionaries or decision rules.

These mock tests prove the semantic pipeline's invariance; they do not establish
the live model's recognition accuracy. The real Gemini-client transport tests
also simulate HTTP. For an opt-in live check with the existing server key, run
`node scripts/test-bobi-semantics-live.mjs`. It samples at most 12 generated cases,
prints aggregate counters only and skips explicitly if the key is absent. It
is not part of `npm test`, does not create a service, and is not automatically run
against a configured account. The current development environment has no Gemini
key, so live Google API/production recognition has not been confirmed.

## Explicit-place evidence before weather retrieval

A post-#101 regression was reproduced with a selected/prior Sofia and an explicit
Varna after a damaged locative connector. The existing request diagnostics showed
two independent paths: local fallback returned an answer using old coordinates,
and a valid Gemini interpretation incorrectly marking the place as context did
the same. Correct explicit Gemini metadata used the new coordinates. These are
controlled handler reproductions; no production logs or live model credentials
were available to identify which path occurred in a particular deployed request.

The root gap was reliance on a single city extractor/metadata decision, followed
by automatic inheritance, without checking the current utterance for conflicting
place evidence. The fix is shared validation after semantic/fallback interpretation
and before any weather fetch, in `server/weather-location-evidence.js`:

- Collect at most three candidate names using existing locative grammar,
  generic one-character edit/transposition comparison with that grammar's
  connectors, and bounded proper-name spans. There is no typo/city dictionary.
  Existing temporal/measure recognition filters candidate fragments only; it
  does not reclassify the full weather question or overwrite its intent/time.
- Verify candidates against Open-Meteo geocoding. Matching requires normalized
  name agreement and finite, in-range coordinates. A geocoder result for another
  place cannot stand in for the requested name. The query's name script selects
  the geocoding language independently of answer language. Region/country
  qualifiers are checked as part of the full requested place.
- One verified locative mention is bound to the actual `Place` object used for forecast,
  air-quality, marine and archive requests. It takes precedence over inherited or
  selected coordinates, including stale explicit AI city metadata. Canonical AI
  corrections/qualifiers remain supported when anchored to name evidence.
- Unanchored proper-name conflicts and several verified places require clarification unless explicit Gemini semantics
  selects a verified one. Strong unsupported place evidence also asks for a name
  and region/country. Geocoding failure blocks retrieval instead of issuing a
  forecast for the old place. Unverified weak capitalization alone is not proof
  of a new location. No-place follow-ups retain confirmed context normally.

Candidate lookups and any anchored canonical AI lookup run in parallel (at most
four queries), using the existing geocoding timeout and a per-request cache.
Qualified-region replies use their full resolved name rather than interpreting
the region/country as a replacement city. No weather data is fetched until a
place decision succeeds. The mechanism is bounded evidence validation, not a
complete gazetteer or a guarantee of arbitrary natural-language recognition.

`[weather-chat:location]` uses the same random request ID as understanding/decision
logs. It records only interpreter, evidence status, bounded candidate count,
resolution and whether old-coordinate inheritance was prevented. Statuses expose
verified, ambiguous, unverified and unavailable evidence; final clarifications
are recorded with reason `location_evidence`. No names, user text, coordinates,
keys or upstream prose are written to these diagnostics.

The generated location suite covers 12 BG/EN city fixtures, multiword names,
connector deletions/insertions/substitutions/transpositions, case changes and
phrase reordering. Each variant runs with correct Gemini, wrong context/selected
Gemini metadata, absent Gemini and failed Gemini. Tests assert both latitude and
longitude in every weather request, plus successive conversation changes, real
ambiguity, explicit country qualifiers, mismatched/invalid geocoding, provider
failure, unrelated requests and safe correlated diagnostics. These are simulated
upstream tests; production/live Gemini or geocoding behavior is not inferred from
them.
