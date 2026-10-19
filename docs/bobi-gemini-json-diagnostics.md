# Gemini structured interpretation diagnostics

HTTP 200 and generation `code: ok` establish HTTP/envelope decoding success,
not completion or semantic validity. The supplied Production evidence does not
establish which response failure occurred. Quota `reserved` rules out a quota
reservation denial for that attempt.

## Causes and evidence

| Cause | Evidence and handling |
| --- | --- |
| Invalid outer HTTP JSON | Client throws `invalid-json`; real-client handler regression verifies local fallback without retry. Generation stage records failure, unlike the supplied `ok` event. |
| Missing candidates/content/parts or blank final text | Handler tests reproduce local fallback; extraction reason distinguishes missing candidate from missing text. Safety/prompt blocking can cause this shape in Production. |
| First part is metadata, nontext or thinking | Previous extractor read only index zero. Tests verify final text after metadata and thoughts is accepted while thoughts alone are rejected. |
| JSON split over final text parts | Tests verify ordered concatenation and strict whole-document parsing. Two independent objects and malformed text are rejected. |
| MAX_TOKENS or another non-success finish | Tests reject both partial and syntactically valid JSON on MAX_TOKENS, safety and unknown termination. A parsed prefix is not proof of completion. |
| JSON syntax/prose/fencing issue | Only a whole JSON document or a complete, anchored JSON code fence is accepted. No brace extraction, repair, fragment selection or alternate candidate search. |
| Valid JSON with invalid semantics | Remains `invalid_structure`; existing strict schema and cross-field validation are unchanged. JSON null remains `invalid_json`, matching prior behavior. |

Production confirmation is still required for the actual model, finishReason,
part distribution and token usage in the reported incident. No paid service or
live Gemini call was used for this investigation. Tests demonstrate failure modes
and safe behavior, not that any one mode caused the historical incident.

## Budget and reasoning

Semantic interpretation uses a 1024-token ceiling instead of 320, with the same
JSON schema and MIME type. The ten-field structured result needs headroom for
city/date strings; thinking can consume the generation allowance. Raising the
ceiling alone is not evidence that 320 caused the incident or a guarantee of
completion. Existing total/discovery/generation deadlines remain unchanged.

The client applies controls after model selection, including existing 404 model
recovery: Gemini 2.5 Flash/Flash Lite use `thinkingBudget: 0`; 2.5 Pro uses its
minimum 128 budget; Gemini 3 Flash uses `thinkingLevel: minimal`; 3 Pro uses
`thinkingLevel: low`. Unknown versions and older models receive no speculative
thinking control. Other endpoints are unchanged. Future families need explicit
capability review. Model control mapping and nonmutation are unit tested.

## Safe Production verification

`[weather-chat:gemini-response]` correlates through the generated request ID and
contains only allowlisted finish reasons (unknown values become `unknown`),
candidate/part/final-text-part counts, final-text presence, extraction category,
and nonnegative integer `outputTokens` / `thoughtTokens` from Google usage
metadata. Missing/invalid counts are null, never guessed zero. No text, questions,
cities, coordinates, signatures, raw payloads or arbitrary upstream messages are
logged. A missing finishReason or any non-STOP termination rejects the result, even
when the text alone is syntactically complete JSON.

After manual rollout, correlate reservation, generation timing, response metadata,
understanding result and final decision for a request. MAX_TOKENS confirms a
termination limit; output and thought counts show the reported distribution.
STOP plus malformed_json points to final-text parsing; missing_text points to
content absence; invalid_structure points to semantic validation. Do not enable
raw response logging to diagnose these cases.

Supabase quota reservation/cooldown, Open-Meteo retrieval, location evidence and
wrong-city safeguards remain in place. No new retries are introduced. Existing
404 recovery remains unchanged and still reserves each generation attempt.

## Validation

- `npm run build`: passed.
- `npm run lint`: passed with two pre-existing `no-unsafe-finally` warnings in
  `scripts/push-node-operator.mjs`.
- `npm test`: 1756 passed, 0 failed, 1 skipped (optional native Deno TLS test).
  This includes quota RPC timeout/reservation, generation deadlines, strict
  semantics, location evidence and all new response/configuration regressions.
- `npm run test:admin:sql` and `npm run test:signup:sql`: passed using
  disposable local PostgreSQL/PostgREST containers.
- Focused Chromium run (weather clarification BG/EN, city/language reset, and
  admin direct-open/reload): 5 passed with one worker.
- Broader 1127-case Chromium run: stopped to investigate an admin reload timeout
  after 27 passed / 1 failed; 8 interrupted / 1091 not run. The failed admin
  test passed when rerun alone with the weather tests. Full browser coverage is
  therefore not established; do not describe all repository checks as green.
- `npm run test:activity:integration`: local GoTrue/PostgreSQL/JWT/RLS checks and
  initial real-browser consent/withdrawal flows passed, then the unrelated login
  selector `.auth-nav` / `Вход` timed out. No UI files were changed.
- `npm run test:push:edge`: blocked by missing `work/deno-cache` dependencies;
  Deno is not installed in this environment. The ordinary Node push tests pass.

The PR remains a draft because broader UI/integration verification is incomplete.
All screenshots regenerated by existing tests were excluded from the change.
