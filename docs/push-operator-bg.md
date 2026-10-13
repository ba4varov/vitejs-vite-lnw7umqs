# Един изрично одобрен Production тест към регистрирания Note 13 Pro

След отделно одобрен rollout на SQL и Edge:

```sh
node scripts/push-operator.mjs PROJECT_REF USER_UUID DEVICE_UUID wind
```

Използвайте реалния Production reference и UUID на вече регистрирания телефон и неговия собственик. Няма нов Supabase проект, VAPID двойка, повторна регистрация, PostgreSQL клиент или DB административен достъп на лаптопа. Обикновената администраторска сесия и съществуващият операторски token се въвеждат на два скрити prompt-а и остават само в паметта на процеса. Не се приемат service-role/DB/deployment ключове; тези ключове остават само на Edge, както досега. Не поставяйте credentials в аргументи, environment, файлове, GitHub, браузърния/Vercel клиент или terminal recording.

1. Влезте с **избрания администратор** чрез съществуващия вход. Използвайте краткотрайния user access token на тази сесия; това е обикновен потребителски JWT, не административен/service-role ключ. Той не получава директни DB права. Инструментът не извежда token-а и не запазва refresh token, парола или credentials. Операторският token идва от съществуващия одобрен password manager.
2. Стартирайте командата. Edge проверява операторското удостоверяване, live Supabase Auth `/user`, избрания администратор в DB, server flag и VAPID двойката. Подготвя автоматично revoked разрешение за 2 минути за точно избраните owner/device/category и текущите revisions. Проверява съгласие, градове, категории, план, активни акаунти/администратор, cooldown, срок и валидността на съществуващия subscription и VAPID identifier. Endpoint, subscription ключове и частната VAPID двойка не се връщат към оператора.
3. Проверете показаните Production reference/account/device IDs и връзката на device UUID с Note 13 Pro. UUID/label сами по себе си не доказват хардуерен модел. Само точното въвеждане на показаната фраза `SEND ONE USER_UUID DEVICE_UUID` изпраща потвърждението. При отказ инструментът отнема разрешението; няма доставка.
4. Edge проверява отново сесията и текущото избрано членство, arm-ва scoped разрешението атомично и достига sender **веднъж**. DB проверява точната фраза, owner/device/revisions/current consent и изгаря permit-а. Duplicate/send retry, стар/отменен permit, променен администратор или произволен actor ID от клиента не могат да изпратят второ известие. При изгубен отговор няма автоматичен retry/resume; ново стартиране е отделен тест и изисква ново изрично одобрение и потвърждение.
5. Прочетете `category` и реалния числов `providerStatus`. `null` означава, че не е получен валиден финален HTTP статус. 2xx е приемане от доставчика, а не доказано показване на телефона. При 503/timeout/неизвестен резултат не повтаряйте. При 429 се запазва пълният provider cooldown; неограничим Retry-After паузира операторския режим до отделна owner проверка. Инструментът не нулира cooldown или pause. Няма ротация или автоматична повторна регистрация при грешка.

## Еднократен бъдещ rollout — единствените административни действия

Тази работа **не** изпълнява merge, deploy, Production SQL, Secret промени или реален тест. Преди използване собственикът отделно преглежда и прилага миграцията `20261013050000_push_operator.sql` върху съществуващата схема и публикува обновената `push-test`. SQL избира никого по подразбиране и затваря стария глобален test mode. В Supabase SQL Editor собственикът еднократно задава `push_controls.operator_admin_id` на конкретния одобрен, съществуващ администратор:

```sql
update public.push_controls
set operator_admin_id = '<ИЗБРАН_ADMIN_UUID>'::uuid
where singleton;
```

Това е административният избор на доверения инициатор; автоматичен избор по „първи admin“, имейл или client metadata би позволил нежелан достъп. Не се прави за всеки тест и не създава permit ръчно. Membership, блокиране/изтриване и изборът се проверяват отново при prepare/arm/claim/authorize. Клиентът не може да си назначи или смени избрания администратор.

Съществуващите `PUSH_TEST_OPERATOR_TOKEN`, VAPID ключове и `PUSH_TEST_DELIVERY_ENABLED` не се сменят от инструмента. Server flag остава независим аварийно изключващ механизъм. Ако вече е `true`, няма действие по Secrets за тестовете. Ако е `false`, тестът се отказва: собственикът трябва **еднократно**, при отделно одобрено включване на защитената функция, да разреши тази възможност. Автоматично игнориране/превключване на flag би премахнало съществуващата защита. Не е нужно включване/изключване около всяко изпращане: true дава достъп само до този строго удостоверен протокол, не до свободен sender или постоянно отворен DB gate. Старият bearer-only `{"permitId":...}` endpoint е отказан от новия entrypoint.

## Кратки разрешения и затваряне

Глобалният `test_delivery_enabled` остава false между DB транзакциите. Scoped gate е за един конкретен permit и максимум 60 секунди след потвърждението; получава се само чрез service-role RPC от удостоверения Edge с actor от Auth `/user`. Към authenticated/anon няма grants за prepare/arm/send/inspection или за таблиците. Обикновените потребителски JWT сами, операторският token сам или друг администратор не са достатъчни.

При authorize разрешението се изгаря и scoped gate се затваря **в същата транзакция преди provider POST**. Edge `finally` и CLI cancel затварят/отнемат разрешението при отказ/грешка. Cancel консумира и непотвърденото разрешение; то не може да се arm-не по-късно. Request UUID осигурява idempotent preparation, но използвано/изтекло/отменено разрешение не се възобновява. Затваряне на стар permit не затваря чужд нов scoped gate. При SIGKILL/offline DB незабавният физически cleanup не е гарантиран: boolean остава false и scoped правото изтича според DB clock до 60 секунди. Неизползваната подготовка е revoked и изтича до 2 минути. Няма background dispatcher, Cron, постоянно отворен глобален gate или fallback към незащитен маршрут.

Двете credentials пътуват само в стандартния `Authorization` header като `Bearer OPERATOR_TOKEN.USER_JWT`; няма допълнителни secret headers или credentials в JSON body, URL, log или диагностиката. Auth проверката е сървърна, не decode/доверие на клиентски claims. Endpoint allowlist, canonical ключове/P-256, encryption, DNS pinning, проверен TLS hostname, фиксирано съдържание, отказ на redirects, bounded transport, dedupe и всички стари consent/account/plan/cooldown predicates остават.

## Съвместимост и проверки

Миграцията е за схемата от `main` след PR #69 и `20261009050000_web_push_test_delivery.sql`, а не за предишната неодобрена изолирана версия на PR #70. Не се редактират съществуващите device/preferences/public VAPID данни; не се изисква `registration_test_user_id` да остане избран след регистрацията. Старите вътрешни функции се запазват зад wrapper-и с отнети външни grants. `my_push`, registration gates и browser/SW не се променят.

Локалните проверки възстановяват действителните миграции от `main`, **преди** новата миграция добавят съществуващ device/preferences/key fixture и сравняват snapshots след миграцията. SQL проверките включват избран/друг администратор, current consent/revisions, точна фраза, scoped expiry, idempotency, отменяне, duplicate authorization, finite и indefinite provider cooldown и затворен boolean. Edge/CLI тестовете използват само deterministic тестови keys, mocked Auth/RPC/provider и локален TLS; няма реален Push.

Live Production schema не е прочетена: в средата няма разрешен Production DB/API connection или schema snapshot. Не твърдим, че реконструкцията от repository доказва live deployment. Преди бъдещ rollout собственикът изпълнява **само read-only** `scripts/push-operator-compatibility.sql` в Supabase SQL Editor; той проверява required functions/columns/grants и връща само `PUSH_SCHEMA_CONTRACT_OK`, без device/user/subscription/VAPID/secret values. Това е еднократна проверка на rollout, не ръчен permit или PostgreSQL настройка на лаптопа. При различна live схема се спира за преглед, без опит за доставка.

Локална верификация на преработката: **287 unit проверки**, **24 целеви Push/operator проверки**, реалните SQL миграции и PostgreSQL/PostgREST регресии са успешни. Before/after device и consent snapshots са равни след миграцията. Read-only schema contract check мина върху реконструираната схема от main. `lint` е без предупреждения; `typecheck`, actionlint, `git diff --check` и frozen Deno 2.5.6 entrypoint check минаха. GoTrue, конкретната публикувана Production Edge версия и показване на Note 13 Pro не са изпълнявани/проверявани с реален тест.
