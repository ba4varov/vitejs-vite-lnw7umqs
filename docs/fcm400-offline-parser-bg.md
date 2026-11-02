# FCM HTTP 400 — целева офлайн проверка след PR #122

Проверено върху актуалния `main` `72ef9df30a08f1a30e812d5189bc332fe5c5f826` на 2 ноември 2026 г. SHA е потвърден през GitHub преди работа. Само синтетични локални фикстури; без реален Push, прочит на реални ключове/токени, ротация, регистрация на Redmi, промяна на услуги/домейн, флагове, merge или Production deployment.

## Установени факти

- Публикуваният [Chrome/FCM HTML пример](https://web.dev/articles/push-notifications-common-issues-and-reporting-bugs#on_chrome_and_fcm) за `UnauthorizedRegistration` се разпознава от двата класификатора при `text/html`. Няма доказан дефект в този шаблон. Кодът означава категория проблеми с VAPID/Authorization, а не еднозначно несъответствие на ключовете.
- Двата [FCM HTTP v1 JSON примера](https://firebase.google.com/docs/cloud-messaging/error-codes) се разпознават като `fcm_invalid_argument`: както `google.rpc.BadRequest` със status, така и `google.firebase.fcm.v1.FcmError` с errorCode. Произволните message/fieldViolations не се извеждат. HTTP v1 API форматът не е гаранция за Web Push `/wp/` и `/fcm/send/` отговорите.
- `text/plain` допуска точен allowlisted идентификатор или вече съществуващата точна VAPID mismatch фраза. HTML изисква целия известен шаблон и еднакви title/H1; JSON изисква allowlisted структурирано поле. Поднизове, свободен текст и непознати тела остават неизвестни.
- Media type е без значение на регистъра; параметрите, включително charset, се отстраняват. Тялото винаги се декодира като UTF-8; ASCII примерите работят и с други ASCII-съвместими charset етикети. Няма общ transcoder; UTF-16 пример остава `unknown_format`.
- Липсващ или неподдържан Content-Type дава `unknown_format` дори при иначе познато тяло. Това е възпроизведен път към наблюдавания статус, но **не е доказано**, че реалният отговор е бил такъв. MIME sniffing не е добавен.
- Content-Length, обикновен chunked и close-delimited framing се обработват от shared парсера. Node делегира HTTP framing на `https.request`. И двата запазват строгите body/времеви лимити и не декомпресират gzip.

## Доказан отделен дефект и минимална поправка

Shared `readProviderDiagnostic` отхвърля валидни chunk extensions и непразни trailers като `invalid_framing`. Фикстура с точно `UnauthorizedRegistration` се разпознава при обикновен chunked, но не и при добавено `;fixture=yes` или `X-Fixture` trailer. Това противоречи на [RFC 9112 §7.1–7.1.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-7.1).

Поправката валидира token/quoted-string extension синтаксиса и изчаква крайния празен ред след trailers. Стойностите се изхвърлят; trailers никога не заменят headers, причина или статус. Запазени са 1024-byte body, 2048-byte wire и 300 ms лимитите, първоначалният 1–4 hex размер, отказът на двусмислен TE/Content-Length, невалиден framing и неподдържано encoding. Allowlist кодовете са непроменени. Няма промяна в Node транспорта.

**Този shared framing дефект не обяснява съобщения Node `unknown_format`.** Няма доказателство, че FCM е изпратил extensions/trailers в реалния случай. Не се твърди поправка на историческия HTTP 400.

## VAPID верига — статична проверка и локални тестове

1. `server/push-core.js` връща конфигурирания публичен ключ след authentication; регистрацията изисква съвпадение с DB registration gate. Клиентът не може да избере друг записан VAPID ключ.
2. `src/push-browser.js` подава декодирания ключ като `applicationServerKey`; съществуващ subscription с различен или неизвестен ключ се отказва, без тихо unsubscribe или преетикетиране. Read-only проверката сравнява key bytes, origin/scope/SW и endpoint fingerprint.
3. SQL регистрацията сравнява подадения публичен ключ с `push_controls`, записва го в устройството; claim/authorize сравняват controls, device и server public key. Еднократната авторизация остава непроменена.
4. Session/Node adapter използва `PUSH_VAPID_PUBLIC_KEY` и `PUSH_NODE_VAPID_PRIVATE_KEY`; shared конфигурацията получава същата двойка. `validVapid` извежда P-256 public от private и сравнява bytes преди изпращане.
5. `validateDevice` изисква записаният VAPID public да съвпада с конфигурацията. `preparePush` използва същата двойка за `web-push`; `p256dh`/`auth` са отделни ключове на получателя. JWT audience следва origin на Push доставчика, не домейна на сайта.

Няма установен логически пропуск. Реалното съвпадение между браузъра, DB, конфигурацията и първоначалната FCM binding не е доказуемо от офлайн кода. Не са четени секрети или живи данни. DNS/IP pinning, TLS, криптиране, авторизация и еднократност не са променени.

## Проверки и ограничения

- Нов самостоятелен тест `tests/unit/push-provider-framing.test.mjs`: валидни/невалидни extensions и trailers, разцепване на 1/7/4096 bytes, buffered initial bytes, липсващ краен ред, няколко chunks, точни/превишени лимити, timeout, encoding, двусмислен framing, HTML/JSON/plaintext/charset/липсващ MIME и synthetic private sentinel.
- Новите регресии са изпълнени и върху оригиналния модул: провалят се; поправеният модул минава.
- Общ фокусиран набор: `node --test --test-isolation=none tests/unit/push-provider-framing.test.mjs tests/unit/push-registration.test.mjs tests/unit/push-key-diagnostics.test.mjs tests/unit/push.test.mjs` — 49 passed, 0 failed.
- 24 допълнителни локални проверки на действителната непроменена `classifyBody` функция, изолирана чрез VM: публикуван HTML, двата JSON примера, plaintext, media type/charset, липсващ MIME, UTF-16 и неразпознати/частни тела. Това е проверка на класификатора, **не native TLS интеграционен тест**.
- Syntax и `git diff --check` минават. Пълният npm/TLS/wire набор, lint и build не са изпълнени: checkout няма инсталирани зависимости; offline cache е непълен, а инсталацията през runtime proxy не работи. Не са заменяни библиотеки или отслабвани проверки, за да се заобиколи ограничението.
- Supabase changelog markdown не може да се прочете чрез наличния web fetch (unsupported content-type). Няма промени в Supabase API, schema или runtime configuration; поправката е чист локален JavaScript parser.

Остава неизвестен точният Content-Type/charset/body shape на историческия отговор и самата причина за FCM HTTP 400. Не са добавени спекулативни корекции на заявката или криптографията.
