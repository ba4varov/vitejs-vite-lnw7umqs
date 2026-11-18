# Meteo Pulse — Android Web Push readiness (B2c, no-send)

## Scope of this draft

No dispatch is enabled. This changes only **Web Push TTL and urgency policies**
for future safety events, while preserving the original low-urgency diagnostic
request. It does not change `SAFETY_WORKER_CODE_ENABLED=false`, Vercel
`PUSH_SAFETY_WORKER_ENABLED`, the Supabase safety gate, a user's consent,
stored device enrollment, Cron, or existing VAPID keys.

The FCM-only pinned HTTPS transport now recognizes **exactly** these policies:

| Sender and message type | TTL | Urgency | Reason |
| --- | ---: | --- | --- |
| Explicitly approved diagnostic test | 60 s | very-low | Keep short, low-impact existing test |
| USGS recorded earthquake within 300 km / M3+ | 900 s (15 min) | high | Do not hold an outdated earthquake notification for hours |
| Open-Meteo forecast dangerous weather | 3600 s (1 h) | high | Alert while near-term forecast is still useful |

The safety worker chooses the policy from the trusted event key; the browser
cannot supply urgency, TTL, target device, location, or event key. The transport
rejects other combinations **before DNS or sockets**, preserving one-shot
VAPID encryption and source/consent checks. These policies do **not**
guarantee instant Android delivery or bypass battery restrictions. The
provider's accepted HTTP response does not prove the phone displayed it.

Official references:
- RFC 8030: https://datatracker.ietf.org/doc/html/rfc8030#section-5.2
- RFC 8030 urgency: https://datatracker.ietf.org/doc/html/rfc8030#section-5.3
- Firebase priority: https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-priority
- web-push Node: https://github.com/web-push-libs/web-push#api-reference

## Read-only live preflight (2026-11-18)

Connected Supabase Production has **3 FCM subscription rows**, none
subscription-expired and all registered against the current VAPID public
key. Three devices belong to an account with enabled weather categories/cities;
zero earthquake opt-ins exist. The safety dispatch gate, test delivery gate,
and new-device registration gate are all OFF. The delivery ledger retains
12 old records. This checked **aggregate counts only**, with no endpoints,
coordinates, user IDs, tokens or secret values retrieved.

Vercel Production has the existing `PUSH_SESSION_TEST_ENABLED` and
`PUSH_NODE_OPERATOR_ENABLED` environment variable *names*, as well as
VAPID and Supabase key names; no secret values were read. Listing a variable
does **not** establish its effective enabled/disabled value.

## Proposed single-device field-test sequence (requires separate approval)

1. On the registered Android phone, visit the **Production** Meteo Pulse URL,
   sign in to its existing account and open **Profile → Push notifications**.
   Do not send or register a new device yet.
2. Confirm the OS/browser notification permission is `granted`. Use the
   existing **local notification** button and visually verify appearance.
   This checks `showNotification()`, **not** FCM.
3. Use **check registration** and **check keys** on the phone's own device
   row. Confirm both `p256dh` and `auth` match, as does the registered
   VAPID key. This is read-only diagnostics; report only the human-readable
   status, never a subscription endpoint or cryptographic key.
4. Confirm the account has at least one saved city and the intended
   **weather risk category**. Earthquake Push requires a separate opt-in;
   there is no reason to enable it solely for diagnostic delivery.
5. Only after the account owner explicitly approves **one real test**:
   review the already existing operator authorization/permit state;
   temporarily allow **test-only** delivery to the one selected device
   through its own gated path, not through the global safety worker.
   The device owner must confirm the browser's **SEND ONE** dialog.
   Keep the safety dispatch gate OFF, no Cron and no bulk sends.
6. Compare **FCM accepted/rejected/unknown** with **visual receipt
   on the specific phone**. A provider 201 is not proof of display.
   Never automatically resend unknown outcomes, and restore the
   test-only gates to OFF immediately afterward.

## Still blocking automatic notifications

- The unified worker is intentionally hardcoded OFF and no scheduler is
  configured. B2b SQL is installed but sender activation is not approved.
- Existing `prepareNodeAttempt` is FCM-only; no Apple/Mozilla/Windows
  coverage has been validated.
- Current candidate/worker budget is only 20 devices, 10 cities and
  3 attempts per invocation; this needs fair continuation at scale.
- Provider expiry/priority may reduce delays but is not a delivery SLA.
- Separate, authoritative НИМХ color-code ingestion for Bulgaria
  requires its own source validation before claiming official warnings.

**No real Push was sent in this PR or its CI tests.**
