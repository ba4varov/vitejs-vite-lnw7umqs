# Gemini quota RPC: diagnosis and production verification

## Evidence and limits

After #105, production reports `ai_preferred`, an RPC POST, `quota_unavailable`
at approximately 1040 ms, zero Gemini calls and an empty quota table.
The old implementation has two independent 1000 ms timers and discards all HTTP,
transport and payload errors. The elapsed time is consistent with its deadline,
but cannot distinguish a slow request from a concurrent HTTP/configuration failure.
An empty table does not establish which failure occurred: the request might never
reach the function, target another project, or fail before a transaction commits.

Controlled before/after diagnostic using the actual main implementation and the
new implementation, with an identical synthetic RPC resolving after 1500 ms:

| Guard | Observed duration | Result |
| --- | ---: | --- |
| main ab36b73 | 1001 ms | quota_unavailable |
| fix | 1527 ms | reserved |

Confirmed code defects: the deadline rejects healthy responses slower than one
second; error masking prevents production root cause diagnosis. **The specific
production root cause remains unconfirmed.** This workspace has no production
Supabase bindings or production log access. No live reservation or SQL change was
performed. HTTP 401/403/404, missing migration, project mismatch and network failure
remain hypotheses until the new metadata is observed.

## Change and guarantees

One 3000 ms deadline aborts the fetch signal through response JSON reading. The
same cancellation race bounds a transport that ignores abort; late results cannot
authorize Google. Parent cancellation exits earlier. Timers and abort listeners
are removed on all exits. Redirects fail rather than forwarding service credentials.

The `[gemini-quota:rpc]` event contains only `action`, `durationMs`, `status`, `code`
and a fixed `configError` enum for configuration failures. Codes are `reserved`,
`daily_limit`, `cooldown`, `http_error`, `timeout`, `aborted`, `network_error`,
`invalid_response`, `configuration_error`. A received HTTP status is retained even
when body reading times out. Error bodies are not parsed or logged. URLs, keys,
exception messages, user messages and response payloads are never logged.

The external failure remains `quota_unavailable`, so existing fallback behavior
stays intact. SQL, row locking, daily limit, Pacific rollover and shared breaker
are unchanged. There are no RPC retries or refunds: a timed-out reservation may
already have committed and consumes quota conservatively. A later independent
request must obtain its own atomic reservation. This may waste allowance, but
cannot authorize an unreserved Google request. Retry after a Google 404 still
requires a new reservation as before; a failed reservation stops that path.

## Production confirmation after review and deployment

1. Verify the existing migration `20261018170000_gemini_quota.sql` is applied in
   the intended Supabase project, and the backend has the server-only
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Inspect presence/project match
   in the deployment settings without copying secret values into logs or issues.
2. Send one controlled AI-preferred question with daily allowance available.
   Observe `action=reserve`, `status=200`, `code=reserved`, then a Gemini usage
   event. Check the intended project's `gemini_project_quota` row and that `used`
   increased once for the initial reservation. A Google 404 recovery can reserve
   a second call; discovery failure can consume a reservation without generation.
3. A successful reservation taking 1000–3000 ms confirms the old deadline was
   insufficient for that request. Consistent sub-second success alone does not
   establish the historical cause. Compare repeated samples and error rates.
4. If it fails, use the exact metadata: 401 points to credentials/authentication;
   403 to privileges; 404 to endpoint/function availability or schema cache;
   other HTTP errors retain their actual status. `configuration_error` identifies
   local validation failure; `network_error` identifies transport failure;
   `invalid_response` identifies JSON/schema failure; `timeout` near 3000 ms
   identifies the deadline (with any received HTTP status). Investigate that
   cause before considering another timeout increase. Do not manually retry an
   ambiguous reservation or decrement its counter.
5. Confirm `daily_limit`/`cooldown` still produce zero Google calls and local
   fallback. Do not exhaust the production allowance for testing; these paths
   are covered by automated tests. Inspect aggregate metadata only, without
   recording the controlled question or credentials.

## Validation

- `npm run build`: passed.
- `npm run lint`: passed, with the two pre-existing `no-unsafe-finally` warnings
  in `scripts/push-node-operator.mjs`.
- `npm test`: 1732 passed, 1 skipped, 0 failed (1733 total). The existing optional
  native Deno transport test is skipped when that runtime is unavailable.
- Coverage includes slow headers/body, timeout with abort, late results, parent
  cancellation, HTTP 401/403/404/429/500/503, network/body transport errors, invalid
  JSON/schema, configuration failure, successful reservations and real handler
  fallback without retry or Google. Existing concurrent-client daily cap and
  Google 429/404 tests remain green.
- Existing migration plus `tests/sql/gemini-quota.sql`: passed in disposable
  in-memory PGlite, including permissions, daily cap, rollover and shared breaker.
  This is not a live Supabase or multi-region load test.
- `git diff --check`: passed.
