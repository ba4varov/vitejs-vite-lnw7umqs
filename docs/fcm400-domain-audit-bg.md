# FCM HTTP 400 и Production домейн — read-only одит

Проверка на 2 ноември 2026 г., върху `main` след PR #121 (`3dd3a4260e6267ce4140c1e9c6c53944f3a36fbc`). Използвани са синтетични ключове/сесии, локален TLS доставчик и имитирани Auth/RPC/FCM отговори. Няма реални Push заявки, промени в Production данни/настройки, миграции, регистрация на устройства, deployment или активиране на флаг.

## Заключение и граници на доказателствата

**Точната причина за историческия FCM HTTP 400 не е установена.** Предоставеното наблюдение от 07:55 Europe/Sofia (05:55 UTC) доказва достигнат доставчик и отказ на заявката, но `request_rejected` е категория, извлечена само от HTTP статуса. Тя не различава невалидно удостоверяване, регистрация или друга структура на заявката.

Не е намерен възпроизводим дефект в генерирането или изпращането на валидната Web Push заявка. Новият тест проверява действителния native Node sender с независима проверка на JWT подписа и декриптиране от страната на получателя. Съществуващите тестове сравняват транспорта с официалния `web-push@3.6.7`. Това доказва локалния път със синтетичните данни, а не валидността на конкретния исторически FCM subscription token, ключове или отговор. Реалните стойности не са прочетени или извеждани.

Доказани са два диагностични дефекта:

1. Сървърните `providerReason` и `providerBodyStatus` се запазват през shared handler, operator adapter и session route, включително HTTP 502, но клиентският `pushTestDiagnostic` ги пропуска. Това е поправено с точни allowlists и BG/EN обяснение за известна/неустановена причина.
2. Node транспортът разпознава ограничено тяло, но игнорира HTTP reason phrase при празно тяло. Shared TLS транспортът вече поддържа тази възможност. Добавен е само точен allowlisted fallback, например `UnauthorizedRegistration` → `fcm_unauthorized_registration`. Диагностичният статус на тялото остава `empty`; не се твърди, че причина е прочетена от тяло. Разпозната причина от тялото има предимство. Произволният status message не напуска транспорта.

Тези поправки не променят изходящите HTTP headers/body, криптографията, DNS/TLS политиките, адресите, SQL авторизацията или броя опити. **Не се твърди, че с тях е отстранена самата историческа причина за HTTP 400.**

## Проверка на веригата и заявката

| Област | Проверка и резултат |
| --- | --- |
| Браузър → SW | Регистрация на `/push-sw.js`, scope `/`, `updateViaCache:none`; проверяват се точни origin, scriptURL и scope. `showNotification()` е локална проверка, не проверява FCM. |
| Абонамент | `subscribe()` ползва публичния applicationServerKey. Локалната проверка сравнява VAPID bytes и SHA-256 fingerprint на endpoint с устройството. Ключовете на получателя и endpoint не се показват от диагностиката. |
| Запис/съгласие | `push-core` ползва същия `PUSH_VAPID_PUBLIC_KEY`, проверява registration gate; shared `validateDevice` проверява endpoint, записания VAPID key, канонични p256dh/auth дължини и валидна P-256 точка. SQL проверките на permit, регистрация и съгласие остават действащи. |
| Endpoint | Node policy допуска само HTTPS `fcm.googleapis.com`, `/wp/<token>` или `/fcm/send/<token>`, без query, fragment, credentials или променен URL. Не се изрязва валиден query: такива адреси се отказват преди изпращане. Двата разрешени пътя са проверени локално; реалният endpoint не е прочетен. |
| VAPID Authorization | `web-push` генерира `vapid t=<JWT>, k=<publicKey>`. Node проверява формата и запазва стойността. Native TLS тестът независимо проверява ES256/P-256 подпис и включения публичен ключ. Невалиден синтаксис се отказва от тестовия verifier. |
| JWT | `aud` е origin на Push доставчика — `https://fcm.googleapis.com`, а не домейнът на Meteo Pulse. Проверени са `exp` в бъдещето и до 24 часа и `sub` с конфигурирания контакт. Неправилен audience и друг VAPID key се откриват от независимия verifier. |
| VAPID двойка | `validVapid` извежда публичния ключ от частния чрез P-256 и сравнява стойностите; несъответствие се отказва преди FCM. Съответствието с ключа, с който FCM първоначално е ограничил конкретния абонамент, не може да бъде доказано само от HTTP 400. |
| Криптиране | `Content-Encoding:aes128gcm`; fresh salt и ephemeral ECDH от библиотеката, RFC 8291 HKDF с p256dh/auth, 65-byte sender key, record size 4096, AES-GCM tag и final delimiter `0x02`. Независимият receiver декриптира payload; повреден/отрязан ciphertext и друг subscriber key се отказват. |
| Headers | `Content-Type:application/octet-stream`, точен `Content-Length`, `TTL:60`, `Urgency:very-low`; няма legacy Encryption/Crypto-Key или chunked request. Българският payload се измерва в bytes от библиотеката, не в брой Unicode символи. |
| Node 24 | Vercel project read-only показва `nodeVersion:24.x`. Локалните TLS тестове изискват Node 24 и `web-push@3.6.7`; `https.request` запазва POST, path, body, Host и SNI, ALPN HTTP/1.1. Не е възпроизведена Node 24 несъвместимост. |
| Защити | Един предварително проверен IP, проверка на TLS hostname/сертификат и действителния peer IP преди HTTP bytes; без redirect, family racing, fallback или retry. Локалният sendOnce latch и атомарната SQL авторизация остават непроменени. |
| Отговор → UI | Ограниченията за headers, body (1024 bytes), време, encoding и framing остават. Shared sender допуска само safeProviderReason/safeProviderBodyStatus; session route запазва diagnostic; клиентът вече филтрира и показва и двете полета, без raw/provider message. |

HTTP 400 сам по себе си не изключва VAPID проблем: документацията на Chrome/FCM показва `UnauthorizedRegistration` с Error 400 при липсващо/невалидно удостоверяване, различен applicationServerKey, невалидна дата или JWT. Следователно „щеше да е 401/403“ не е достатъчно основание да се отхвърли тази хипотеза. 404/410 обичайно означават липсващ/изтекъл абонамент; 413 е размер; криптографски отказ при декриптиране в браузъра може да е след успешно HTTP приемане. Нито една от тези общи категории не доказва историческия случай.

## Read-only проверка на домейните

Vercel потвърди READY Production deployment `dpl_HkDe5uxnqSzvoG4X7jecWnYmXmts` от същия `main` commit. Списъкът с project domains съдържа:

- `ba4varov-wheater.vercel.app`: verified, без domain redirect.
- `vitejs-vite-lnw7umqs.vercel.app`: verified, redirect 307 към `ba4varov-wheater.vercel.app`.
- `ba4varov-weather.vercel.app`: липсва от project domains; наличност/собственост не са установявани.

Project redirect routes API върна празен списък. Bulk redirects API отказа read-only достъп с `403 upgrade_required` поради ограничения на плана; тази настройка не е потвърдена независимо. Не е правен upgrade или промяна на маршрути.

Runtime absolute-URL прегледът на src/server/api/public/scripts/index/vercel установи един твърдо зададен Production URL за този домейн: `scripts/push-node-operator.mjs` използва сегашния `wheater` адрес. README и Google OAuth/CLI документацията също използват последователно `wheater`. Не е намерена runtime зависимост към `ba4varov-weather.vercel.app`. Другите абсолютни адреси са външни доставчици, публични ресурси/промоционални проекти (например Nameri Go в `src/project-data.js`) или XML namespace адреси, а не алтернативен Meteo Pulse origin. Тестовете, Preview verifier конфигурациите и историческите отчети съдържат localhost, синтетични и фиксирани Preview URL адреси; те не са Production canonical адрес и не се използват от Node sender към FCM.

Push API адресите са относителни; `window.location.origin`/`self.location.origin` определят worker проверките и целта при отваряне на известието. Manifest id/scope/start_url/icons са относителни. `vercel.json` съдържа SW cache/scope headers и admin rewrites, без domain redirect или CSP/CORS изключение за `weather`. Session operator endpoint изисква точния собствен Origin; няма cross-origin разрешение за другото изписване.

Supabase Site URL/redirect allowlist и Google Cloud OAuth клиентът **не са проверени remotely**: наличните свързани инструменти не предоставят read-only Auth URL Configuration или Google Cloud OAuth client settings. Проверени са само кодът и setup документацията: `AuthPanel` конструира redirect от текущия origin, Google OAuth използва `${location.origin}/?oauth=google`, а Google → Supabase callback е отделен от frontend redirect. Не е прочитан OAuth client secret или служебен ключ.

**Не е установена причинна връзка между правописа и FCM HTTP 400.** VAPID audience сочи FCM, не сайта; sender endpoint също е FCM. Различен origin действително има отделни сесии, разрешения, Service Worker и Push subscription, но това не доказва, че при наблюдавания тест е използван друг origin. Предварителните проверки допълнително ограничават такъв сценарий.

## Отделен бъдещ план за домейна

1. При изрично одобрена отделна задача проверете собственост/достъпност и добавете правилния alias, HTTPS и тестова среда; не премахвайте стария origin първо.
2. Преди смяна на canonical адреса прегледайте Supabase Site URL и точните redirect URLs, Google Authorized JavaScript origins/redirect URIs, callback през Supabase, email links и защитите на Origin. Добавянето на frontend домейн не означава автоматично преместване на OAuth callback.
3. Проверете login, logout, refresh, password/email callbacks и Google PKCE на новия origin. Не прехвърляйте JWT през URL; localStorage и браузърните разрешения не се пренасят автоматично между origins.
4. Проверете manifest, инсталираната PWA и новия root worker. Новият origin изисква отделно разрешение и изрична нова Push регистрация; запазете VAPID ключовете. Не пререгистрирайте устройствата скрито.
5. Планирайте преход на старите subscriptions и премахване на дубликати с одобрение, без двойно изпращане. Старият worker остава под стария origin. Не пренасочвайте автоматично привилегировани POST Push заявки с 307 към друг origin.
6. След проверките сменете canonical/docs/CLI URL и redirect политиката, наблюдавайте старите login/PWA пътища и запазете план за връщане. Това е отделна промяна, не част от този PR.

## Най-малката следваща диагностична стъпка

В тази задача не е нужен и не е разрешен нов реален тест. Без запазен безопасен reason/body status не може да се възстанови точният исторически отказ. Първо прегледайте този Draft PR и локалните доказателства. При отделно бъдещо одобрение за rollout и точно един реален тест:

- Потвърдете текущия Production origin и версията на диагностиката; активна администраторска сесия, локална регистрация/VAPID/fingerprint/p256dh/auth проверки, актуално съгласие, разрешение и липса на активен/неясен предишен опит; прегледайте ledger/cooldown read-only.
- Не въртете ключове и не пререгистрирайте устройство преди причината. Не копирайте headers, endpoint, subscription keys, JWT или raw FCM body в отчети/логове.
- Само с отделно одобрение за временно активиране: един клик и едно потвърждение, запис на безопасните category/providerStatus/providerReason/providerBodyStatus и визуално наблюдение на телефона. После изключване на тестовия флаг по одобрения процес. Това не е автоматично разрешение за такава операция.
- При неизвестна причина/резултат не повтаряйте. Разпознат `fcm_unauthorized_registration` още не различава ключ, подпис, audience или срок; нужна е целева проверка преди друга промяна. HTTP приемането не доказва физическа доставка.

## Източници

- [RFC 8292 — VAPID, audience, expiry, restricted subscriptions](https://www.rfc-editor.org/rfc/rfc8292)
- [RFC 8291 — Web Push encryption](https://www.rfc-editor.org/rfc/rfc8291)
- [RFC 8188 — aes128gcm framing](https://www.rfc-editor.org/rfc/rfc8188)
- [RFC 8030 — TTL, urgency и статуси](https://www.rfc-editor.org/rfc/rfc8030)
- [Chrome/FCM — общи проблеми, UnauthorizedRegistration и HTTP 400](https://web.dev/articles/push-notifications-common-issues-and-reporting-bugs)
- [Node 24 HTTPS API](https://nodejs.org/download/release/latest-v24.x/docs/api/https.html)
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

Източниците са проверени при одита; те подкрепят протоколните изисквания, а не доказват конкретния исторически отказ. Vercel наблюденията са от свързаните read-only project/deployment/domain/route API инструменти.

## Резултати от проверките

- `npm test`: **2172 общо, 2161 успешни, 0 провала, 1 skipped, 10 съществуващи TODO**. Skipped е незадължителният Deno runtime probe; Node 24 wire/crypto тестовете са изпълнени.
- Цялата Chromium Push серия: **99/99 успешни**. Включва BG/EN известна, непозната, празна и злонамерена provider диагностика; token refresh, смяна на акаунт, изход, съгласие/права, едно потвърждение и липса на retry.
- Допълнителна целева server/client/Node TLS/wire серия след разширяването на session-adapter теста: **32 успешни, 0 провала, 1 skipped**. Покрива реален локален native HTTPS, криптографска проверка, повредени payload/JWT/audience/key, невалиден JSON, празен/непознат/прекомерен/незавършен отговор, safe field propagation и еднократност.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`: успешни. Lint има само двете съществуващи `no-unsafe-finally` предупреждения в `scripts/push-node-operator.mjs`.
- Няма промени в shared Supabase код/SQL, API route/session/operator authorization, dependencies, Vercel конфигурация, домейни, ключове или изключения тестов флаг. Промяната в Node транспорта е само извличане на точен безопасен диагностичен код от reason phrase.
