# Meteo Puls — Етап 4: управление на акаунти и ръчни планове

## Резултат и граници

Етап 4 добавя защитено ръчно Free → Pro → Free управление, история за избрания акаунт, търсене по имейл/име, филтри по план, Auth статус и дата, както и последни действия и ограничена проверка на състоянието на началното табло. Запазени са таблиците за потребители, любими градове, абонаменти и журнал. Публичните прогнози, Open-Meteo, Google OAuth, регистрацията, паролите, сесиите и логиката на любимите градове са запазени. Последната корекция поправя само типовете на Serverless чатбота и TypeScript build конфигурацията; детерминираният parser и текстовете на BG/EN са непроменени.

**Временното блокиране и възстановяването на достъп умишлено са недостъпни.** Това е предвиденият в заданието безопасен режим при недоказана защита срещу стари JWT. Бутоните са disabled с обяснение на BG/EN. Защитеният endpoint връща `BLOCKING_UNAVAILABLE` и не извиква Auth Admin API. Няма промяна на реални акаунти и няма окончателно изтриване.

Извършени са само изолирани тестове. Не са проверени Production, реалният Supabase GoTrue или публикуваният Vercel endpoint. Няма ръчен Production deployment, сливане на PR или Production SQL. Push към същия PR задейства автоматичния Vercel Preview; действителният статус се проверява отделно от локалния build.

## Актуализация на PR №54 — точни видове прочитания

При едно отваряне `AdminUserDetails` извиква `admin_users(selected_id)` за самоличност/регистрация/план и отделно `admin_user_favorites`. `AdminManagement` извиква `admin_management_account(selected_id)` за план, Auth статус, административно членство, произход на ръчния Pro и история. Предишната ревизия означаваше и двата различни прочита като `user_details_view`.

Решението запазва всички независими SQL записи и означава management прочита с точния нов вид `user_management_view`. Не се премахва журнализиране, не се връщат данни през private internal функция, не се добавя клиентски `skip_audit` и няма времеви кеш или глобално потискане на директни RPC прочитания. Старите исторически записи остават непроменени.

| Прочит при едно отваряне | SQL функция | Очакван запис |
| --- | --- | --- |
| Основни данни | `admin_users(..., selected_id)` | 1 × `user_details_view` |
| План, достъп и история | `admin_management_account(selected_id)` | 1 × `user_management_view` |
| Любими градове | `admin_user_favorites(selected_id)` | 1 × `user_favorites_view` |

Общо: **три смислово различни записа**, всеки с истинския `auth.uid()`, избрания акаунт и резултат. SQL и signed-JWT/PostgREST тестовете проверяват действителния брой редове, типовете, актьора и обекта. Директният management RPC записва по един `user_management_view` и за `success`, и за `not_found`. При отказ на журнала всички три чувствителни RPC отказват да върнат данни. Новият филтър има BG/EN означения и същата защита.

## Корекция на TypeScript грешките във Vercel Build Logs

Собственикът предостави шест конкретни diagnostics от `api/weather-chat.ts`. Установена е причината за тях: непълни декларации на помощните функции, твърде тесен inferred forecast обект и липса на изрична Node среда в конфигурацията за Serverless. Предишният `npm run build` проверяваше само `src/` и `vite.config.ts`, затова локалният PASS не покриваше API TypeScript.

| Diagnostic / стар ред | Причина | Корекция |
| --- | --- | --- |
| TS2591 / 124, `process` | Node globals не са изрично включени в Serverless конфигурацията | Root `tsconfig.json`: `types: ["node"]`, NodeNext; съществуващият `@types/node` се използва без нова dependency |
| TS2353 / 155, `requestedDates` | Inferred forecast обект не описва уикенд обобщение | Общ `WeatherSummary` с `requestedDates` и `targetDays` |
| TS2345 / 160, относителен период | `timeScope` е обявен като произволен string | Реални literal unions и type guard за петте относителни периода; `tomorrow_*` продължава да използва утре |
| TS2353 / 161, `requestedDate` | Inferred forecast обект не описва избраната дата за почасовите периоди | `requestedDate` е част от общия summary договор |
| TS2740 / 164, archive срещу forecast | Историческите данни нямат current/hourly/daily forecast полета | Общ договор с опционални forecast полета; archive запазва `historical` и `targetDay` |
| TS2345 / 166, `isQuick` | Renderer декларацията изисква поле, което Gemini не връща и renderer не използва | Базов `Understanding` за renderer; `DeterministicUnderstanding` отделно добавя задължителния `isQuick` |

`findDailyForecast<T>` запазва целия тип на намерения ден вместо да го свежда до `{date}`. Hourly/current/daily upstream данните имат конкретни структурни типове. Gemini payload е `unknown` с безопасно прочитане на вложения текст. Не са добавени `any`, `@ts-ignore`, `noCheck` или изключени TypeScript проверки. `tsconfig.api.json` включва всички API TypeScript файлове, използва `strict: true` и е част от `tsc -b`. `allowJs` позволява съществуващите JavaScript помощни модули да се резолвират; не отменя проверката на TypeScript. Browser конфигурацията остава отделна.

Добавени са 30 регресии в `src/weather-chat-handler.test.mjs` и `src/weather-chat-types.test.mjs`, извън папката за Serverless endpoints. 28 runtime проверки изпълняват реалния handler/renderer с изолирани HTTP fixtures и фиксиран часовник: BG/EN, днес/утре/вдругиден/вчера/завчера, четирите `tomorrow_*` периода, конкретна дата, този/следващия уикенд, друг град с неговите координати, quick action и Gemini без `isQuick`. Две compiler проверки доказват приемането на валидните договори/Node globals, съвпадението на literal enums с runtime allowlists и отказа за неправилен относителен период или непълен weather обект. Runtime parser, forecast URL параметри, геокодиране и отговорите са запазени.

**Шестте diagnostics са реален поправен кодов проблем, но не доказват единствената причина за Failed deployment.** Според предоставената информация логовете стигат до „Build Completed“ и „Deploying outputs“. Пълният текст след тези редове и deployment error code още не са предоставени. Не е установена друга конкретна блокираща грешка и това не доказва липсата на такава. Последният статус на автоматичния Preview за новия commit се записва в описанието на PR №54 след push; локалният PASS не означава Vercel Ready.

## Vercel deployment — проверено и непотвърдено

Проверен е посоченият deployment **`dpl_BHiCrRjEyY7mmMUrK8AWUfPUuA1a`**, проект `weather`, team slug `ba4varov-projects`, за първоначалния PR commit `492de8bd83b5c024a45f822f61d8bfa2c33f5f81`.

- [Vercel deployment](https://vercel.com/ba4varov-projects/weather/BHiCrRjEyY7mmMUrK8AWUfPUuA1a) и [Vercel bot съобщението в PR №54](https://github.com/ba4varov/vitejs-vite-lnw7umqs/pull/54#issuecomment-6060495333) потвърждават `Error`/GitHub status `failure`.
- GitHub status description препраща към `npx vercel inspect dpl_BHiCrRjEyY7mmMUrK8AWUfPUuA1a --logs`; не съдържа първопричината или error code.
- GitHub check `Vercel Preview Comments` е успешен само за липса на нерешени коментари. Това **не е** успешно build/deployment състояние.
- Vercel dashboard/build logs не са достъпни чрез наличната връзка. Открит е Vercel plugin, но той още не е свързан с проекта. Средата няма конфигурирана Vercel самоличност/credential; не е започван интерактивен login и не са търсени стойности на секрети.
- **Окончателната причина за Failed след „Deploying outputs“ остава непотвърдена.** Предоставените впоследствие шест TypeScript diagnostics са поправени, както е описано по-горе. Не се променят Vercel settings по предположение и няма потвърден Ready в наличните стари deployment данни.

След корекцията е проверен и автоматичният Preview за commit `0f1724a61cfdfc48f197ab22943d74485a50148c`: **`dpl_FRjakN9r8bzZi6Zh41ETh9hndHwy`** също има GitHub Vercel status **`failure`**. [Новият deployment](https://vercel.com/ba4varov-projects/weather/FRjakN9r8bzZi6Zh41ETh9hndHwy) не е успешен въпреки всички локални PASS проверки. И този status препраща към CLI inspect, без да разкрива error code или Build Logs. Това не установява дали причината е в кода, Vercel конфигурацията или правата; не се прави предположение.

За завършване собственикът трябва да предостави едно от следните:

1. Свързан Vercel достъп до проекта `weather` в `ba4varov-projects`, позволяващ преглед на deployment details, error code и Build Logs; или
2. Редактирани Build Logs и точния deployment error code от първоначалния и новия deployment. Ако собственикът вече е логнат във Vercel CLI, може да изпълни `npx vercel inspect dpl_BHiCrRjEyY7mmMUrK8AWUfPUuA1a --logs --scope ba4varov-projects` и също `npx vercel inspect dpl_FRjakN9r8bzZi6Zh41ETh9hndHwy --logs --scope ba4varov-projects`, като предостави изхода без секрети.

При установен кодов проблем ще е нужна доказана корекция и проверка на новия автоматичен GitHub Preview за точния нов commit. Локалните PASS резултати по-долу не заместват такова потвърждение. Не е стартиран ръчен Production deployment.

## Реализация

- `/api/admin-management`: POST, валиден JWT чрез Supabase Auth `/auth/v1/user`, действително административно членство чрез SQL RPC, UUID и allowlist на входните полета, изрично `confirmed: true`. Няма клиентски `admin_id`, service-role ключ или произволна операция.
- `admin_set_manual_plan`: SQL проверка на `auth.uid()` и членство; shared lock на членството до commit срещу едновременна отмяна; заключване на абонамента срещу конкурентна промяна; проверка на предишния план; атомарен UPDATE и INSERT в стария журнал.
- Един глобален UUID на заявката: advisory lock и уникален индекс в журнала. Еднакви повторения връщат потвърдения оригинален резултат; друг актьор/акаунт/параметри със същия UUID получават конфликт. Старо повторение след по-късна промяна не извършва UPDATE отново. Отговорът описва оригиналната операция; актуалният план се прочита отново.
- При timeout резултатът е **непотвърден**, а не успешен. Диалогът запазва UUID за безопасно повторение. Ако се затвори, следващият опит проверява стария план и не може безусловно да презапише вече извършена промяна.
- Отказът на журнала връща цялата SQL транзакция. Не се записва фиктивен успешен запис. Неуспешна SQL операция не оставя отделен запис за грешка в тази транзакция; интерфейсът показва отказа. Не се логват токени, пароли или сурови SQL грешки.
- `subscriptions` остава без директни UPDATE права за обикновените потребители. Няма нови таблици със повторени планове или лични данни. Ръчният произход се доказва от успешния журнален запис с точния `subscriptions.updated_at` timestamp.
- Защитени са всякакви непразни provider идентификатори, неактивен `status` и съществуващ Pro без доказан ръчен произход. Платеният или неясен Pro не се класифицира като ръчен само по `plan`. Няма плащания, фактури, Stripe или автоматично подновяване.
- `get_my_entitlements()` остава непроменена. Проверена е реалната промяна на плана и `future:premium` след нов RPC прочит. Отворен потребителски екран трябва да обнови профила/правата чрез съществуващия поток; няма push или периодични проверки.
- `admin_management_account` връща план, статус, ръчен произход и последните 50 журнални записа. Прегледът се журнализира атомарно. Любимите градове продължават да идват от съществуващия защитен RPC, до стария лимит 500.
- `admin_management_users`: име/имейл, страници по 20, план, `banned_until > now()` и включителни граници на регистрация по UTC. Старият `admin_users` е запазен.
- Журналът запазва старите записи и филтри и добавя `user_management_view`, `manual_pro_grant`, `free_restore`, `account_block`, `account_restore`. Последните два са само подготвени видове операции; в този PR няма успешни Auth мутации.
- Началното табло показва реалния брой Auth bans, последните пет действия и точен обхват/време на проверката. Празната регистрационна серия показва компактно обяснение вместо несъразмерна празна графика. Няма фонови или периодични health checks. Липсваща миграция и отказ се показват като липсващи данни, а не като нула.
- Native `<dialog>`: потвърждение на стара/нова стойност, начален фокус върху „Отказ“, focus trap, Escape, disabled бутони и синхронна защита от двоен submit. Таблицата може да получи клавиатурен фокус за хоризонтално превъртане. BG/EN и двете теми са проверени.

## Защо блокирането не е активирано

Проверен е действително инсталираният `@supabase/auth-js` **2.117.3** от lockfile и SDK сорса: `GoTrueAdminApi.updateUserById(uid, attributes)` поддържа `AdminUserAttributes.ban_duration`, а `'none'` вдига блокирането. Официален източник: [Supabase auth-js](https://github.com/supabase/auth-js), `src/GoTrueAdminApi.ts` и `src/lib/types.ts`; съответният REST endpoint е `PUT /auth/v1/admin/users/{id}`. API поддръжката сама по себе си не доказва незабавно прекратяване на достъпа с вече издаден JWT.

Прегледът на кода установи следните незатворени пътища:

| Път | Текуща защита | Какво липсва за блокиране със стар JWT |
| --- | --- | --- |
| Директни `favorite_places` и `place_settings` | RLS проверява собствеността чрез `auth.uid()` | Live проверка за забранен акаунт във всички USING/WITH CHECK политики |
| `set_my_default_place` | SECURITY DEFINER проверява собствеността | Live проверка на достъпа преди четене/писане |
| `get_my_entitlements` | SECURITY DEFINER, само собственият план | Live проверка на достъпа без промяна на съществуващата логика за плана |
| `/api/profile` | Auth JWT, service-role само за избрания потребител | Надежден live gate преди service-role четене/UPDATE; RLS не спира този ключ |
| Admin RPC и `/api/admin`, `/api/admin-management` | JWT + актуално членство | Съгласуван live gate за достъпа, включително при стар административен JWT |
| Други deployed Supabase Storage/RPC/Realtime ресурси | Не присъстват в този repository | Инвентар на действително публикуваната конфигурация и отделни проверки |

Публичните weather/chat/advice endpoints нямат потребителски Supabase частни данни и не трябва да се затварят за гости. Текущото Auth блокиране е показано като Auth статус; не обещава, че всички стари сесии са прекратени.

Преди активиране е нужен отделен проверен процес:

1. Един защитен източник на access gate и проверка във всички частни endpoint/RLS/RPC пътища, с ограничени функции и без таблици, които браузърът може да променя. Докажете отказ на всички изброени операции с JWT, издаден **преди** блокирането, и приемане след възстановяване. Инвентаризирайте конфигурацията извън Git.
2. Сървърна операция с реално членство, фиксирани причини (`abuse`, `security`, `policy`), фиксирана продължителност, request UUID и отделно потвърждение. Забранете собствен акаунт и всички администраторски акаунти; защитете едновременна промяна на членство, така че единственият администратор никога да не загуби достъп.
3. Service-role само в сървъра след тези проверки. Auth API и SQL не са една обща транзакция. Използвайте надежден intent/result журнал с ключ на операцията, serialized per-account transitions и потвърждение чрез повторен Auth read. Не записвайте успешно завършена операция при неизвестен резултат.
4. При блокиране: първо deny gate в SQL + intent, след това Auth ban, после потвърден резултат. При неизвестен Auth резултат запазете безопасния deny gate и pending/failed статус; ръчно повторение/възстановяване със същия UUID. При възстановяване: първо потвърдете Auth unban, после атомарно махнете gate и запишете резултата. Не компенсирайте сляпо към allow след отказ на журнала.
5. Проверете Auth отказ, успешна Auth промяна + SQL отказ, timeout след Auth commit, повторен опит, конкурентни block/restore, отнети права и последващо ръчно reconciliation. Процесът трябва да работи без cron, keep-alive или постоянни заявки.
6. Тестове с действителен изолиран Supabase GoTrue и стар JWT; едва тогава отключете бутоните. Настоящият PR не симулира такива проверки като успешен Production поток.

## Единствена нова миграция

`supabase/migrations/20261008030000_admin_management.sql`

Миграцията е транзакционна и не изпълнява Auth заявки. В същия несливан PR №54 е коригиран типът на management прочита; Етапи 1–3 остават непроменени. Ако старата ревизия на Етап 4 вече е прилагана в изолирана staging база, не пускайте целия файл повторно: пресъздайте disposable staging база с актуалните миграции. Не се предписва автоматично пренаписване на Production schema или на историческите записи. Добавя четири ограничени nullable audit колони (`reason`, `previous_value`, `new_value`, `request_id`), индекси и четири нови RPC функции, като разширява стария `admin_audit_entries`. Всички нови функции са SECURITY DEFINER с празен search_path и ограничен EXECUTE. Старите миграции са непроменени.

### Ръчно активиране от отговорен оператор

Тези стъпки са инструкции, **не са изпълнени върху Production**.

1. Прегледайте и одобрете PR. Направете проверен backup по съществуващите инструкции. Проверете, че Етапи 1–3 вече са приложени, че има реално административно членство и че `auth.users.banned_until` съществува. Не пускайте старите миграции отново.
2. В отделна staging база приложете само новия файл чрез доверен собственик на базата. Проверете Free → Pro → Free, отказ при provider идентификатор/неактивен статус/съществуващ неясен Pro, ordinary RPC отказ и rollback на журнала. Не използвайте реални акаунти като тестови fixtures.
3. Публикуването на приложението може да предшества миграцията: PGRST202 означава липсващ Етап 4. Старите статистики, потребители, любими градове и журнал остават достъпни. Новите действия са недостъпни с обяснение; няма автоматично прилагане на SQL.
4. Когато операторът реши да активира, приложете само този SQL файл еднократно. Изчакайте PostgREST schema cache; при необходимост собственикът може да изпълни `NOTIFY pgrst, 'reload schema';`. Не добавяйте постоянни background заявки.
5. В административния интерфейс проверете наличността на новите филтри и management данните. Статусът за блокиране трябва да остане **недостъпен**, дори след миграцията.

### Проблеми и възстановяване

- Липсващи таблици, стари функции или constraint имена: STOP; проверете реалния schema drift спрямо Етапи 1–3. Не измисляйте заместители и не пресъздавайте данните.
- Ако миграцията откаже преди COMMIT, цялата транзакция се връща. Ако SQL клиентът остави failed transaction, изпълнете ROLLBACK преди следващата операторска стъпка.
- PGRST202 след миграцията: проверете наличните signatures и schema cache. Браузърът не трябва да заобикаля отказа.
- Непотвърден POST: повторете в същия диалог или проверете request UUID в журнала чрез доверен оператор. Не обявявайте успех само по това, че заявката е изпратена.
- `STALE_PLAN`: затворете диалога и обновете данните. `EXTERNAL_SUBSCRIPTION_PROTECTED`: използвайте отделен разработен процес за външния доставчик.
- Спиране на новите промени: rollback на приложението и/или операторско `REVOKE EXECUTE ON FUNCTION public.admin_set_manual_plan(uuid,text,text,uuid) FROM authenticated;`. Това е инструкция, не е изпълнено.
- Предпочитано възстановяване е старият UI с оставена additive schema и запазен журнал. Не изтривайте журнални колони/записи, не връщайте масово всички Pro към Free. Отделно коригирайте само потвърдени ръчни грешки с нова журнализирана операция, след преглед на актуалните provider полета.
- Преди връщане на стара версия следете, че тя игнорира новите audit колони/видове. Не пускайте обратен DDL автоматично.

## Проверки

| Команда/проверка | Резултат и обхват |
| --- | --- |
| `npm test` | 208/208 PASS — съществуващи и нови endpoint тестове; Auth отговорите в новите unit тестове са контролирани doubles |
| `npm run lint` | PASS |
| `npm run build` | PASS, включително strict TypeScript на всички API файлове; съществуващо Vite предупреждение за Vercel insights script |
| `npm run test:admin:sql` | PASS — истински PostgreSQL 17 + PostgREST 13.0.7 в disposable network-isolated Docker, реалните migrations, JWT подписи/expiry, direct RPC isolation, revoked membership, atomic audit rollback, Free/Pro entitlements, concurrent duplicate requests |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:admin:browser` | 67/67 PASS — истински Chromium; API и Auth тестовите данни са изолирани mocks |
| Production/GoTrue/deployed endpoint | Не е тествано и не е променяно |
| Auth Admin отказ/частичен Auth+SQL отказ | Няма активен Auth mutation поток; block/restore връщат отказ без Auth заявка. Изпълнението на такива recovery тестове е условие за бъдещо активиране |

SQL тестовият runner никога не приема DB URL и създава временна минимална Auth schema. Проверява и паралелни retries с две отделни PostgreSQL връзки. Поправена е стартова надпревара на Docker PostgreSQL: readiness чака крайния TCP listener, а не временния init socket.

Browser проверява точно един identity, management и favorites прочит при отваряне, липса на нови прочити при език/тема, повторно журнализиране при ново отваряне и новия audit филтър. Browser покрива cancel, предишна/нова стойност, двоен клик, изпълнение, обновяване, retry със същия UUID, 401/403/503, protected subscription, липсваща миграция, филтри, клавиатура, липса на периодични заявки и регресия на Етапи 1–3. 40 действителни screenshots са в `docs/admin-stage4-screenshots/`: потребител, начално табло и диалог; 320/390/768/1440 px, BG/EN, светла/тъмна тема. Имейлите са `example.invalid`, токените са изолирани тестови стойности и никога не се визуализират.

## Променени файлове

- `api/admin-core.js`: новите read actions и разширен allowlist на audit filters.
- `api/admin-management-core.js`, `api/admin-management.ts`: защитен POST за плановете и отказ на block/restore.
- `api/admin-management.test.mjs`: права, валидиране, грешки, повторения и read parameters.
- `src/AdminApp.tsx`, `src/AdminRegistrationChart.tsx`, `src/AdminManagement.tsx`, `src/AdminApp.css`, `src/admin-client.ts`, `src/admin-i18n.js`: интерфейс, достъпност, език, тема, заявки и fallback.
- `supabase/migrations/20261008030000_admin_management.sql`: единствената нова миграция.
- `scripts/test-admin-sql.mjs`, `tests/sql/admin-bootstrap.sql`, `tests/sql/admin-stage4.sql`, `tests/sql/admin-profile-audit.sql`: изолирани реални SQL/PostgREST проверки; bootstrap добавя тестовото Auth banned_until.
- `tests/admin-stage4.spec.ts`: новите Chromium проверки и screenshots.
- `tests/admin.spec.ts`, `tests/admin-stage2.spec.ts`: fixtures изрично моделират липсващата Етап 4 миграция в старите deployments.
- `docs/admin-stage4-bg.md`, `docs/admin-stage4-screenshots/*`: настоящият отчет и действителните Chromium изображения. Историческите screenshots от Етапи 1–3 се запазват.

Последната TypeScript корекция не променя административните компоненти/RPC, миграциите или Supabase. Изискваните останали Build/Deployment Logs трябва да съдържат края след „Deploying outputs“, точния error code и commit SHA; собственикът може да ги предостави редактирани без секрети или да свърже Vercel достъп до проекта.
