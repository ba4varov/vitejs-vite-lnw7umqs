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

Production configuration is reported as `GEMINI_MODEL=gemini-3.8-flash`.
Production confirmation is still required for finishReason, part distribution
and token usage in the reported incident. No paid service or
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
`thinkingLevel: low`. The exact Production model `gemini-3.8-flash` uses
`thinkingLevel: low` (never `minimal`) and omits REST generation parameters
`temperature`, `topP`, `topK` and unsupported `candidateCount`. Unknown versions and older models receive no speculative
thinking control. Other endpoints are unchanged. Future families need explicit
capability review. Model control mapping, nonmutation, preservation of JSON schema/MIME and the
actual mocked HTTP request for Production 3.8 Flash are tested. Other supported
models retain their existing settings; unknown models get no new thinking controls.

Google references checked on 2026-10-19:
- [3.8 Flash capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): low/medium/high thinking; minimal unsupported.
- [GenerateContent migration](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.8): remove deprecated sampling parameters and candidate count.

No Google generation/discovery requests were sent during validation; HTTP request
assertions use a synthetic fetch implementation.

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

## Validation after Production model review

Baseline: fetched `origin/main` at `d30e0ca604fd36d0ff572b058d53169229d15d25`,
checked out separately in an isolated worktree. Same installed package versions
and system Chromium; synthetic accounts and disposable local services only.

| Check | PR branch | main baseline |
| --- | --- | --- |
| `npm run build` | Passed; frontend asset hashes unchanged | No frontend changes in PR |
| `npm run lint` | Passed, two existing `no-unsafe-finally` warnings in `scripts/push-node-operator.mjs` | Warning source unchanged |
| `npm test` | 1765 passed, 0 failed, 1 skipped (optional native Deno TLS) | Not rerun; baseline used for browser blockers |
| Focused Chromium: weather clarification BG/EN and city/language resets; admin direct open/reload | 5 passed, one worker | Same 5 passed, one worker |
| `test:activity:integration` | GoTrue/JWT/RLS and initial consent/withdrawal browser flows passed, then 30s login selector timeout | Reproduced the same 30s timeout at the same script line/selector |
| `test:push:edge` | Earlier run blocked by missing Deno cache/executable | Reproduced same missing `work/deno-cache` prerequisite assertion; Deno executable absent |

Focused browser command on each checkout:

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/weather-chat-clarification.spec.ts tests/admin.spec.ts --grep 'pending chat state|admin direct open' --workers=1 --reporter=line
```

The activity failure is in `scripts/test-activity-integration.mjs:302`: the test
creates a 390px owner page and directly clicks `.auth-nav` / `Вход` without opening
the collapsed mobile header menu. `HeaderNavigation.tsx` and the existing
`tests/header-navigation.ts` helper show the menu must be opened first. The script,
header implementation and relevant styles are identical in main and this PR.
This is a reproduced pre-existing test-flow blocker, not an observed Gemini
regression. The test harness and UI were left unchanged.

The earlier broad 1127-case Chromium run stopped after 27 passed / 1 admin reload
timeout, with 8 interrupted / 1091 not run. That admin test now passes in focused
single-worker runs on both main and PR. Its earlier parallel-run failure is not
claimed to be proven on main. The full browser suite remains unverified; no
claim is made that every repository integration check is green.

Earlier `test:admin:sql` and `test:signup:sql` passed using disposable local
PostgreSQL/PostgREST containers. All regenerated screenshots were excluded.
The same PR remains draft; no auto-merge or deployment is enabled.
