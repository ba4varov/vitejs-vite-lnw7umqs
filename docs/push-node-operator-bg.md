# Изключен Node.js операторски sender в `weather`

Предложен е един нов server-only маршрут `/api/push-operator` в съществуващото приложение. Не се създава втори Vercel проект. Използва се същата променлива `SUPABASE_SERVICE_ROLE_KEY`, която вече се чете от `server/profile-core.js`. Не са нужни нов service-role ключ, SQL, grants или достъп до таблиците: необходимите RPC вече имат `EXECUTE` за `service_role` в съществуващите миграции. Това е проверка на договора в хранилището; Production конфигурацията и тайните не са четени.

## Състояние и отказ по подразбиране

Маршрутът връща `503 PUSH_NODE_DISABLED`, преди Auth, RPC, DNS или HTTPS към доставчик, освен ако едновременно:

- платформеното `VERCEL` е точно `1`;
- платформеното `VERCEL_ENV` е точно `production`;
- отделното сървърно `PUSH_NODE_OPERATOR_ENABLED` е точно `true`;
- действителният Node runtime е версия 24.x.

`NODE_ENV`, HTTP headers, hostname и име на branch не участват в разрешаването. Preview и Development отказват дори със случайно налични валидни ключове и включен флаг. Друга версия на Node отказва. PR не променя project runtime, `vercel.json`, глобални `engines`, Production настройки или deployment конфигурация. Пакетът съдържа 11 API entrypoint-а, под проверявания лимит 12.

При разрешена среда всички липсващи/невалидни настройки водят до `503 PUSH_NODE_UNCONFIGURED` преди външен I/O. Не е добавена стойност на флага или каквато и да е тайна. Това не е инструкция за активиране.

| Сървърна настройка | Предложено бъдещо използване |
| --- | --- |
| `SUPABASE_URL` | Съществуващият фиксиран HTTPS Supabase project URL; без произволен host/path/query |
| `SUPABASE_SERVICE_ROLE_KEY` | Съществуващата променлива в същия проект; без второ копие, нов ключ или по-широки grants |
| `PUSH_TEST_OPERATOR_TOKEN` | Операторското удостоверение; същият формат и протокол; без предоставена стойност |
| `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_SUBJECT` | Проверена двойка с бъдещия private key и валиден subject |
| `PUSH_NODE_VAPID_PRIVATE_KEY` | Бъдеща Sensitive променлива, ограничена само до Production; не `VITE_*`, не Preview/Development/build аргумент, не клиентски код |
| `PUSH_NODE_OPERATOR_ENABLED` | Отделен флаг; липсващ или различен от `true` означава изключено |

Бъдещото добавяне на private key изисква отделно разрешение. Не са четени, копирани или прехвърляни настоящите VAPID/абонаментни тайни. Сървърните модули не се импортират от frontend. HTTP отговорите и приложният код не отпечатват Authorization, service key, endpoint, ключове, subscription secrets, сурови provider/Supabase отговори или stack traces. Диагностиката по подразбиране няма log sink. Бъдещи платформени request/body logging интеграции трябва също да запазват тази граница; PR не променя такива настройки.

## Непроменен операторски договор и DB авторитет

Използват се директно съществуващите `createOperatorHandler`, `createTestHandler`, `validateDevice` и `preparePush`. Shared файловете, `sendPinned`, Supabase entrypoint-ите и SQL не са променяни. Node adapter винаги подава изрично стандартния Node HTTPS sender; няма избор чрез HTTP поле, fallback или retry.

1. Само POST без Origin и query. Ограничено тяло до 1024 bytes и 2 секунди. Удостоверението и живият user JWT остават в комбинирания Authorization header; постоянновремева проверка на операторското удостоверение.
2. `/auth/v1/user` валидира сесията. Само върнатият UUID става `actor_id`. `push_operator_access` проверява избрания администратор и текущите DB контроли. Потребителят не може да задава actor/права.
3. `prepare_push_operator` → `inspect_push_operator`: DB избира един потребител, устройство, категория и permit. Node adapter допълнително ограничава подготовката до FCM. Проверяват се текущите subscription и VAPID публични ключове. При неуспех подготовката се отменя.
4. `arm_push_operator` приема само точната потвърждаваща фраза за тези user/device UUID. `claim_push_test` създава еднократната резервация; криптираната заявка и DNS проверката се извършват преди последното DB разрешаване.
5. `authorize_push_test` проверява актуалните права, съгласие, revisions, lease и claim. DB изразходва разрешението и отнема permit **преди** мрежовия опит. Само потвърден `true` стига до sender.
6. `finish_push_test` отчита фиксирания резултат. `close_push_operator` се опитва във `finally`; `cancel_push_operator` остава отделна изрична операция. Cleanup използва собствен ограничен сигнал, за да може да се изпълни при отказ/прекъсване на първоначалния Request.

Съществуващите срокове са DB авторитетни: подготовка до 2 минути, arm lease до 60 секунди и claim до 30 секунди. Node не ги удължава, не ги пресъздава и не ги замества с локален часовник. RPC timeout е 5 секунди, response JSON до 8 KiB (Auth до 32 KiB); redirect е забранен и за control-plane fetch. Основната операция има 40-секунден сигнал; finish/close cleanup е отделно ограничен. Function maxDuration е 60 секунди.

Старият Edge и новият Node път използват **един и същ** ledger и permits. Конкурентни функции или повторен HTTP request не могат да получат второ DB разрешаване за същата резервация. При загубен authorize отговор не се изпраща; при загубен finish отговор не се повтаря. Отнемане преди authorize спира изпращането; отнемане след него не може да върне вече започнал опит. Гаранцията е максимум един разрешен опит, а не гарантирана еднократна доставка. При насилствено спиране на процеса DB изразходваният permit и сроковете остават защитата, дори cleanup да не се изпълни.

Операторът не подава endpoint, payload, batch, transport, DNS, proxy, CA или агент. Payload се генерира само от съществуващия `preparePush`. Няма UI или клиентски sender. Съществуващият CLI остава насочен към Edge и не се пренасочва автоматично; този PR не включва активиране или реален операторски тест.

## Стандартният HTTPS транспорт

`web-push@3.6.7.generateRequestDetails` генерира криптираните body bytes и шестте HTTP headers. Версията и `ipaddr.js@2.5.0` са преместени от dev в runtime dependencies без смяна на версии. Изпращането използва само `node:https.request` и нов `https.Agent` за един адрес.

- Строг canonical HTTPS FCM endpoint, само `fcm.googleapis.com` с допустим `/wp/` или `/fcm/send/` path. Без credentials, порт, query, fragment, IP URL или сходен домейн.
- Проверка на всички DNS резултати: публичен unicast, съгласувано IP семейство, максимум 32 записа. Частен/loopback/link-local/mapped адрес в който и да е резултат отказва целия набор. DNS timeout 3 секунди. След authorize се използва кешираният проверен DNS набор, без повторна външна резолюция.
- Само един избран IP. Agent lookup го фиксира; няма family racing, socket reuse или втори IP при грешка. Оригиналното име се запазва за Host, TLS SNI и certificate validation; `rejectUnauthorized:true`.
- Проверява се и действителният `socket.remoteAddress` след TLS. HTTP headers/body се подават чрез `req.end` чак след успешно TLS удостоверяване и съвпадение с избрания IP. Различен peer или сертификат с грешно име отказва преди HTTP.
- Няма следване на redirects. Има timeout 8 секунди, header budget 4096 bytes, ограничени interim responses и body diagnostics до 1024 bytes/300 ms. Success/redirect body се отхвърля. Криптираният request body е до 2048 bytes; заглавките и точният Content-Length се проверяват, без преопаковане или chunked request framing.
- Само фиксиран статус/категория, allowlisted provider reason/body status. Известен HTTP 400 се запазва дори диагностичният body да прекъсне или да е твърде голям. Невалиден или прекалено дълъг Retry-After води до съществуващото DB поведение за пауза, без скъсяване на provider cooldown.
- Локалният latch допуска едно извикване на подготвения sender; DB permit е защитата между инстанции. При наблюдаван Request abort сокетът се унищожава; независимо дали платформата предава disconnect като abort, повторно изпращане няма. Не се твърди доказано поведение на hosted Vercel disconnect signal от локален artifact тест.

Factory injection за CA, loopback, порт или синтетичен resolver е само доверена тестова конструкция. API използва фиксираната production policy и не приема такива стойности от заявката.

## Доказателства и граници

Локално: Node **24.19.0**, `web-push` **3.6.7**, официален `@vercel/node` **23.0.0**, `@vercel/build-utils` **14.20.0**. Builder генерира Lambda **nodejs24.x** с 72 traced файла. Изпълнен е действителният emitted handler със синтетични настройки: изключен Production, Preview с включен флаг и валидни синтетични тайни, Development — всички `503`, **0 network calls**. Това доказва локално пакетиране и gates, не hosted deployment.

`tests/unit/push-node-transport.test.mjs` използва временна локална CA, синтетични ECDH/VAPID ключове, `.invalid` имена и TLS listeners само на `127.0.0.1–4`. Проверява точните bytes/headers спрямо стандартния `web-push.sendNotification`, действителния peer IP (включително умишлено нарушен Agent lookup с валиден сертификат на друг IP), грешно certificate име, redirect без втора връзка, DNS/snapshot ограничения, response limits, timeout, HTTP 400, disconnect и отменяне. Накрая цялата Node operator верига с fake Auth/RPC изпраща точно една заявка към локалния TLS fixture при конкуренция, 400 и прекъсната provider връзка.

`tests/unit/push-node-operator.test.mjs` проверява конфигурация/Preview преди четене на тайни, всички удостоверявания, строг input, prepare/cancel, 16 конкурентни инстанции, изтекли/отнети разрешения и leases, загубени authorize/finish отговори, ограничен control-plane stream, безопасна диагностика и abort cleanup. Това е атомарен in-memory модел на RPC договора; реалните SQL/grants се проверяват отделно от съществуващия disposable SQL CI, без връзка с реален Supabase.

Възпроизвеждане без тайни, реален Supabase, FCM или Vercel API:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/unit/push-node-operator.test.mjs tests/unit/push-node-transport.test.mjs
npm ci --prefix tests/push-node-build --ignore-scripts --no-audit --no-fund
node scripts/verify-push-node-build.mjs
```

Новият Actions workflow изпълнява тези проверки и пълните unit/build/lint проверки, без secrets, deployment job или environment. Запазва само безопасния `work/push-node-build/evidence.json`, без Lambda пакета, ключове или TLS файлове. CI инсталацията изтегля публичните npm зависимости; самите функционални тестове използват само синтетични/локални endpoints.

Няма реално изпращане, достъп до реален абонамент или промяна на Note 13 Pro, SQL, Secrets, VAPID, Production настройки, `sendPinned` или CLI маршрута. PR е draft за преглед; merge и deployment не са част от тази промяна.
