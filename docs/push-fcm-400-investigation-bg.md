# Meteo Pulse: три FCM HTTP 400 след потвърдено съвпадение на subscription

Проверена база: `04bc08a7baa915d4e2c3d8a2e99698cffdd41d70` (main след PR #83), 14 октомври 2026. `push-test.mjs`, `push-provider.mjs` и `push-deno.ts` са идентични с ревизията след PR #80. За тази задача потвърденото съвпадение на браузърния и записания endpoint fingerprint, applicationServerKey/VAPID public key, p256dh и auth се приема като факт. Не е извличан реален subscription или конфигурация.

**Не е установена причината за трите реални HTTP 400.** Не се възпроизвежда дефект в генерираната HTTP заявка или native Deno TLS транспорта с тестови данни. Доказан е отделен диагностичен пропуск: два публично отчетени FCM plaintext отговора за невалиден JWT се класифицират като `unknown_format`. Минималната поправка разпознава само тях. Публичните примери са HTTP **403**, затова поправката не е доказано решение на настоящия HTTP **400**.

## Генериране и изпращане

`preparePush` валидира canonical subscription keys и P-256 точката, сравнява device public key с конфигурацията и делегира на заключения `web-push@3.6.7`. Преди него handler-ът проверява VAPID двойката чрез извеждане на public key от private key и равенство. Payload е малък UTF-8 JSON. Библиотеката избира `aes128gcm` и генерира нови salt/ephemeral encryption key и VAPID JWT. Няма замяна на endpoint или собствено криптиране в sender-а.

| Изискване | Проверка и резултат |
| --- | --- |
| Endpoint / метод | POST към оригиналния `/wp/…` или `/fcm/send/…` path на `fcm.googleapis.com`. Няма пренаписване към FCM HTTP v1, query или следване на redirects. Локалният TLS тест проверява и двата разрешени FCM пътя. |
| VAPID Authorization | `vapid t=<JWT>, k=<public key>`; JWT е ES256 с 64-byte P1363 signature, `aud=https://fcm.googleapis.com`, зададения `sub` и future integer `exp` в рамките на 24 часа. Библиотеката използва 12 часа по подразбиране. Независимо криптографско проверяване на получения по TLS подпис преминава и за Node, и за Deno. |
| Content-Encoding | `aes128gcm`, двоично body с 16-byte salt, rs=4096, 65-byte ephemeral P-256 key, ciphertext и 16-byte GCM tag. Независим приемник дешифрира получените bytes и проверява точния JSON и final-record delimiter `0x02`. |
| Crypto-Key / Encryption | Отсъстват. При тази комбинация encryption key/salt са в body, а VAPID public key е параметър `k` в Authorization. Добавяне на legacy `Crypto-Key: dh=…`/`p256ecdsa=…` или `Encryption: salt=…` не е необходимо. VAPID signing key и ephemeral encryption key са различни. |
| TTL / Urgency | Точно едно TTL=60 и Urgency=very-low; няма Topic. Стойностите са допустими според RFC 8030. |
| Content-Type / Content-Length | `application/octet-stream`; точно една Content-Length, преизчислена от двоичната byte length, а не от дължината на JSON текста. Умишлено грешна входна Content-Length се заменя с вярната. Няма Transfer-Encoding в заявката. |
| HTTP framing | HTTP/1.1, CRLF separators, Host=fcm.googleapis.com, Connection=close, без допълнителен body delimiter. Body bytes се запазват при частични writes. Header/body лимитите не се достигат от тестовия payload. |

`sendPinned` проверява всички DNS резултати за публични адреси, избира един числов адрес и го подава на connector-а. Не прави втори мрежов DNS lookup. `denoConnector` изпълнява `Deno.connect` към този адрес и порт 443, после `Deno.startTls` със сертификатното име/SNI на доставчика, ALPN `http/1.1` и explicit handshake. Не изключва certificate validation. Тестов адаптер пренасочва само към loopback и локален CA; грешно сертификатно име се отказва преди HTTP payload. Deno процесът има `--allow-net=127.0.0.1`, така че не може да се свърже с FCM.

Стандартният `web-push.sendNotification` и `sendPinned` изпращат едни и същи encrypted body bytes и еквивалентни headers към локалния TLS сървър, когато replay използва едни и същи generated details. Сравнение между две независими encrypt операции не би имало равни bytes заради случайните salt/ephemeral key. Deno тестът допълнително ограничава всяко write до 31 bytes.

Получен HTTP 400 означава завършен обмен до финален HTTP отказ. Обикновена TCP/TLS/certificate грешка би дала транспортна категория, не `providerStatus:400`. Локалните проверки доказват описаната реализация с fixtures; не доказват историческите Production bytes или приемането на реалния token от Google.

## Какво доказва unknown_format

`sendPinned` запазва финалния status преди диагностичното четене. `readProviderDiagnostic` има 300 ms срок, до 2048 wire bytes и до 1024 decoded body bytes. Поддържа Content-Length, прост chunked framing и close-delimited body. Diagnostic failure не променя вече получения status и не води до retry.

`unknown_format` се връща само след прочитане на пълно непразно body, за което няма разпознат allowlisted reason. Възможни са валидно plaintext пояснение, друг HTML шаблон, липсващ/друг Content-Type или JSON без познат `error.status`/FCM errorCode. То не означава невалиден HTTP, празно body или грешен subscription. Timeout, truncated body, gzip/друго Content-Encoding, byte лимит или неподдържан framing имат различни body statuses. Например chunk extensions/trailers не се поддържат изцяло от ограничения parser и не обясняват именно `unknown_format`.

Добавеният локален тест връща HTTP 400 с правилна Content-Length и пълни синтетични text/plain, text/html и application/json тела без конкретен познат reason. И трите закономерно остават `unknown_format`. Generic Bad Request не се преобразува в измислена по-точна причина.

Отделният пропуск е възпроизведен с отчетените от FCM text/plain варианти `invalid JWT provided` и `permission denied: invalid JWT provided`, след съществуващото премахване на водещ/краен whitespace. Преди поправката тестът очаква `recognized / fcm_invalid_jwt`, но получава `unknown_format` без reason. След поправката преминава при Content-Length, chunked и EOF framing и read splits от 1, 7 и 4096 bytes. Exact match и MIME ограничението се запазват: произволен prefix/suffix, URL в текста, HTML или JSON message не се разпознават по substring.

Първични публични отчети: [web-push #532](https://github.com/web-push-libs/web-push/issues/532) (2019 и коментар от 2025) и [web-push #679](https://github.com/web-push-libs/web-push/issues/679). Това са наблюдавани отговори, а не гарантирана текуща FCM schema. Те доказват пропуск в покритието на parser-а, без да доказват съдържанието на последния отговор от Note 13 Pro.

Поправката добавя един фиксиран allowlisted reason и exact recognition на тези два plaintext текста. Не променя `preparePush`, `sendPinned`, TLS, retry/consent/cleanup, лимитите, HTTP headers или ключовете. Handler/CLI използват същия `safeProviderReason`, затова новият reason преминава съществуващото повторно филтриране. Тестът проверява и запазването му след failed finish RPC. Никакъв raw response или subscription не се добавя към публичната диагностика.

## Локално възпроизвеждане

Използвани са Node 24.19.0 и native Deno 2.5.6, dependency lock-овете на проекта и публичните детерминистични fixture keys. Няма SDK клиент към Supabase, реален provider connection или SQL изпълнение в локалните команди за тази задача.

```bash
npm ci --cache work/npm-cache --ignore-scripts --no-audit --no-fund

# При вече инсталиран Deno 2.5.6:
DENO_DIR=work/deno-cache DENO_TLS_CA_STORE=system deno cache --frozen \
  --config supabase/functions/push-test/deno.json tests/edge-push/wire-client.mjs

DENO_BINARY="$(command -v deno)" node --test \
  tests/unit/push-provider.test.mjs tests/unit/push-wire.test.mjs \
  tests/unit/push-diagnostics.test.mjs

DENO_DIR=work/deno-cache DENO_TLS_CA_STORE=system deno check --frozen \
  --config supabase/functions/push-test/deno.json supabase/functions/push-test/index.ts
```

Проверки: baseline sender/provider/TLS suite — 25 passed, native Deno първоначално skipped до инсталиране; после native Deno baseline — 3/3 passed. Новите регресии преди поправка се провалят с конкретната разлика `unknown_format` срещу `recognized/fcm_invalid_jwt`. След поправката целевият suite е 20/20 passed, включително native Deno и двата JWT варианта. Пълният unit suite е 331/331 passed с Deno; lint и TypeScript typecheck преминават. Финалната целева проверка се повтаря след добавяне на втория JWT вариант.

Native Deno не е exact публикувания Supabase Edge Runtime. Не е стартиран Edge контейнер в тази работа и не е извиквана публикуваната функция. Тази граница е съществена за окончателна root-cause диагноза.

## Оставащи възможности и липсващо доказателство

1. **Конкретен FCM отказ, който настоящата безопасна диагностика не описва.** От последния резултат знаем status и че body е прочетено, но нямаме MIME/структура или разпознат reason. Не може да се реши дали е общ HTTP parsing отказ, registration/auth rejection или друга проверка на Google. Parser-ът не запазва raw body; добавяне на нови mappings не възстановява минали отговори.
2. **Разлика между проверения source/локален runtime и историческото изпълнение.** Не са предоставени immutable deployed function revision, runtime version, безопасни данни за JWT claims/signature или HTTP bytes при трите теста. Възможна runtime/configuration разлика остава непроверена. Генерираните тестови JWT claims/signature са коректни; реалните subject, clock/exp и изпратен Authorization не са проверявани. Няма основание да ги обявим за дефектни.
3. **Provider-side състояние на реалния token.** Потвърденото browser/DB equality отстранява установимо локално разминаване на тези стойности. То не е потвърждение от FCM за актуалност или приемане на token-а. Няма доказателство за invalid/expired/unauthorized registration и трите отказа сами по себе си не го установяват.

Не се приписва причина на Note 13 Pro, Service Worker, notification permission или фоновите ограничения на телефона само по HTTP 400: отказът е преди потвърдено приемане от доставчика. Не са обосновани смяна на endpoint, encoding, TTL/urgency, ключове или повторна регистрация.

Следващото полезно доказателство би било вече налична, редактирана безопасна диагностика от съществуващите три изпълнения и immutable deployed revision/runtime, ако такива са запазени. Настоящата задача не разрешава нов Push и такъв не е извършен. Без тези данни причината остава неустановена.

Протоколи: [RFC 8292 — VAPID](https://datatracker.ietf.org/doc/html/rfc8292), [RFC 8291 — Web Push encryption](https://datatracker.ietf.org/doc/html/rfc8291), [RFC 8188 — aes128gcm](https://datatracker.ietf.org/doc/html/rfc8188), [RFC 8030 — TTL/urgency](https://datatracker.ietf.org/doc/html/rfc8030), [RFC 9112 — HTTP framing](https://datatracker.ietf.org/doc/html/rfc9112).

Няма реален Push, subscribe/unsubscribe, промяна на Production/Supabase/SQL/Secrets/VAPID, deployment или merge. Source поправката е само предложение в PR.
