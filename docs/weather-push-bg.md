# Meteo Puls — автоматични Web Push предупреждения

11 октомври 2026 г. Некомерсиален проект, административен тестов Pro, Vercel Hobby и Supabase Free, потвърдени от потребителя. Няма нова платена услуга, външен акаунт, мобилен дизайн, Production SQL, secrets, активиран Cron или реално известие в тази промяна.

## Какво се използва и какво се добавя

Съществуващите `/api/push`, `my_push`, `PushSettings`, Service Worker, доброволна регистрация, настройки, категории, Free/Pro проверки и прегледаният RFC 8291/8292 транспорт се запазват. `push-test` остава отделен единичен тестов sender с непроменени операторски ограничения.

`push-check` вече е реален, изключен по подразбиране Edge dispatcher. Извиква се от Supabase Cron, когато има действително включени доброволни получатели. Не използва Vercel Cron, браузърни таймери или изкуствени заявки за активност. Разрешението за известия остава само в click handler. Service Worker няма токени, secret, fetch interception или външни destinations.

Потокът е: операторски secret → DB gate/15-min cadence/120-s lease → максимум 5 уникални града → сървърен Open-Meteo → валидирани epoch часове → съществуващите опасни прагове и Pro правила → устойчиви събития/опашка → текущи права, категории, градове, revisions и subscription → DNS allowlist/публични IP → повторна авторизация → криптиран HTTPS POST → Service Worker notification.

Опасните прагове са същите като в камбанката: ≥10 mm/час дъжд; WMO 95/96/99 буря; ≥60 km/h вятър; усещане ≤−15°C студ или ≥40°C жега. `walk/garden/sport` използват споделените правила и текущ активен Pro в SQL. Free опасните категории остават достъпни дори при downgrade и стари записани Pro категории. Предупрежденията са **производни ориентировъчни прогнози**, не официални предупреждения на НИМХ и не гарантирани измервания. Няма предупреждение при невалидна/непълна/стара прогноза. Source/units, последователността и диапазоните се проверяват; epoch часовете поддържат DST fallback.

Всеки акаунт запазва до 5 града. За ограничен Free rollout има общ лимит **20 различни координати + часова зона** сред включените настройки. При запълване API връща `409 PUSH_CITY_CAPACITY`, с BG/EN обяснение; спирането остава достъпно. Това е явен бюджетен лимит, не обещание за неограничен мащаб.

## Квоти и поведение при грешки

Един cycle през 15 min; всеки град е проверяван най-много веднъж на час; 5 града/cycle означава до 480 forecast calls/ден, 14 400/30 дни. Това е максимум само за новия worker: текущото приложение използва същите Open-Meteo квоти. Няма keepalive. При по-малко градове заявките са по-малко; без допустими устройства няма прогнозни заявки. Грешка на доставчика се пропуска безопасно до следващата планирана проверка на града, без измислено предупреждение.

Максимум 5 push опита/cycle и 6 опита/устройство/24 часа; общо максимум 14 400 опита/30 дни. При storm burst е възможна опашка и забавяне — 20 устройства с един нов риск изискват до 4 cycles. Това не е система за незабавна аварийна доставка. Началният доброволен cohort трябва да е малък; наблюдавайте опашката и квотите преди разширяване. Отделни функция invocations: до 2 880/30 дни. DB/RPC egress и всички други приложения делят общия Free бюджет. Ограниченията се прилагат на сървъра, не чрез доверие в UI.

Worker спира нова работа преди 95 s; DB lease е 120 s. Forecast timeout 8 s, DB 5 s, DNS 3 s, HTTPS POST 8 s. Не логва subscription, raw errors, provider body или ключове. Payload TTL е максимум 1 час и не надхвърля края на периода. BG/EN езикът се записва при запазване на настройките. Името на града и периодът са видими в OS/lock-screen известието.

Периоди със застъпване за един град/категория запазват event identity при rolling forecast; Pro дейностите са веднъж за локален ден. `(user, fingerprint, event)` unique jobs пазят резултата и след изтриване/повторна регистрация на същия endpoint. Нов endpoint означава ново устройство за тази система. Историята се пази 14 дни след края на периода; чисти се само в действителен разрешен cycle. Изтриване на Auth акаунта изтрива личните jobs чрез FK cascade. Глобалните прогнозни събития нямат потребителски данни.

Преди POST резервирането атомарно преминава в `uncertain`; повторен cycle, crash или загубен отговор не изпращат същия job отново. Това предпочита пропуснато известие пред дубликат. 404/410/невалиден криптографски subscription премахват само непроменената device revision. 429 въвежда точно provider cooldown, минимум 60 s; неопределим/над година Retry-After спира DB gate. Redirect не се следва. Профилът показва последния собствен резултат: приет от provider, отказан, невалиден или непотвърден. „Приет“ не доказва показване на устройството. При отказ на permission има инструкции за browser settings; неподдържан браузър и iOS Home Screen имат BG/EN съобщения.

Между финалната DB авторизация и POST има неизбежен малък прозорец; вече прието съобщение не може да бъде изтеглено. OS/browser настройките, battery restrictions и push provider влияят върху показването. Supabase Free може да се паузира и няма SLA; няма заявки за предотвратяване на паузи.

## SQL миграция — първо само в изолиран проект

Приложете липсващите съществуващи миграции по ред; след тях **точно**:

`supabase/migrations/20261011000000_weather_push_dispatcher.sql`

Файлът се прилага веднъж след `20261009050000_web_push_test_delivery.sql`. Не заменя и не редактира стари миграции. Не включва никакъв gate, schedule, opt-in или HTTP. Таблиците са ENABLE/FORCE RLS без direct grants за anon/authenticated/service_role. Вътрешните predicates и старите `my_push` версии нямат външни grants. Само шестте тесни worker RPC са разрешени за service_role. `my_push` остава owner JWT-only. Потребителят не подава user ID или delivery text.

Проверка като DB owner след прилагане:

```sql
select registration_enabled, population_registration_enabled, test_delivery_enabled,
       delivery_enabled, registration_test_user_id, run_id, lease_until
from public.push_controls;
-- Новите population_registration_enabled/delivery_enabled трябва да са false.
-- Миграцията не променя вече съществуващите registration/test gates.
select count(*) from public.push_weather_jobs;
```

## Environment variables — точни места

| Променлива | Място | Стойност/действие |
|---|---|---|
| `PUSH_REGISTRATION_ENABLED` | Vercel server env | Съществуваща; `false` до доброволния staging enrollment |
| `PUSH_VAPID_PUBLIC_KEY` | Vercel server env, Supabase Edge secrets, DB control | Една и съща публична стойност за съответната среда |
| `PUSH_VAPID_PRIVATE_KEY` | Само Supabase Edge secrets | Съществуващата прегледана двойка; staging е отделна от Production |
| `PUSH_VAPID_SUBJECT` | Само Supabase Edge secrets | Реален наблюдаван `mailto:` или HTTPS контакт |
| `PUSH_WEATHER_DELIVERY_ENABLED` | Само Supabase Edge secrets | **Нова**, `false` по подразбиране |
| `PUSH_WEATHER_OPERATOR_TOKEN` | Само Supabase Edge secrets и Supabase Vault | **Нов**, случаен base64url ≥32 bytes; отделен от test/operator/user tokens |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase автоматично предоставя на Edge | Не се копират в браузъра или Vercel Preview |

Не са нужни нови публични `VITE_*` променливи или paid API key за потвърдената некомерсиална употреба. Не променяйте ключовете на старите устройства мълчаливо. Ключова ротация изисква нова доброволна регистрация; старите key identifiers се отказват от worker.

Генерирайте отделни staging VAPID keys със съществуващия `node scripts/generate-vapid.mjs work/isolated-vapid.json`. Файлът е private и git-ignored. Генерирайте операторски token в password manager/доверена машина и го прехвърлете през Dashboard; не го поставяйте в CLI аргументи, документация или логове. В избрания Supabase project → Edge secrets оставете weather flag `false`. Vercel Preview трябва да сочи **само изолирания Supabase проект**.

Публикуване на staging функцията след преглед (публикуването не включва gates):

```sh
supabase functions deploy push-check --project-ref <STAGING_PROJECT_REF> --use-api
```

`supabase/config.toml` задава `verify_jwt=false` само за конкретните sender functions, защото независимият операторски token е задължителен. Без него отказът е преди DB. Не извиквайте send endpoint с потребителски JWT или anon key.

## Доброволен staging тест — преди Production доставка

1. Изпълнете автоматизираните проверки по-долу. Прегледайте RLS/grants, ключовата двойка и default-off flags. Без `PUSH_WEATHER_DELIVERY_ENABLED=true` endpoint трябва да върне `503 PUSH_WEATHER_DISABLED`, без DB/send.
2. Създайте отделен тестов акаунт в staging. Оставете `population_registration_enabled=false`; използвайте съществуващия `registration_test_user_id` и задайте staging публичния key в `push_controls.vapid_public_key`. Включете само staging `registration_enabled` и Vercel Preview `PUSH_REGISTRATION_ENABLED=true`.
3. В профила запазете градове/категории. Проверете BG/EN, отказано/затворено permission, регистрация само чрез бутона и отписване. Проверете 5 града и Free отказ за Pro категории, както и current Pro → Free downgrade. Частен ключ никога не стига до browser/SW.
4. **Само за доброволния staging получател:** включете Edge weather flag и DB `delivery_enabled=true`. Оставете Cron неактивен. Извикайте един POST към staging `/functions/v1/push-check` с независимия operator Bearer и тяло `{}` чрез инструмент, който не записва secret в command history/logs. Реалният worker изпраща само при действително прогнозирано избрано явление; не променяйте forecast source/праговете, за да произведете изкуствено предупреждение. За базов OS encrypted-push smoke test без актуално опасно време използвайте съществуващия еднократен `push-test` permit по `docs/web-push-stage6gb-bg.md`.
5. Затворете таба/сайта и проверете физически поддържан браузър; при iOS ≥16.4 стартирайте инсталираното Home Screen приложение. Кликът върху известието трябва да отвори само `/` на собствения origin. Проверете provider acceptance отделно от OS показването.
6. Проверете втори cycle след cadence: същото предупреждение не се повтаря. Спрете известията/изтрийте устройството и потвърдете отказ на нови изпращания. При симулираните автоматизирани тестове се проверяват 404/410, 429, redirects, uncertainty, нова revision, account ban и downgrade; не насочвайте Production endpoints към тестови доставчици.
7. Върнете staging Edge/DB gates `false`. Запишете тестовите резултати и реалните quota/CPU/DB показатели. Няма автоматично включване за реални потребители или мълчаливо съгласие. Production gates/secrets/SQL/Cron се настройват отделно след успешни staging проверки.

## Supabase Cron + Vault — подготвяне, не активиране

В избрания **staging** Dashboard включете наличните `pg_cron`, `pg_net`, `supabase_vault` extensions. В Vault добавете чрез Dashboard:

- `meteo_push_weather_url`: `https://<STAGING_PROJECT_REF>.supabase.co/functions/v1/push-check`
- `meteo_push_weather_operator`: същия staging `PUSH_WEATHER_OPERATOR_TOKEN`

Не съхранявайте service_role като Cron secret. Следващият SQL създава **неактивна** задача. Изпълнете го веднъж като owner, след успешните автоматизирани проверки; job не може да тръгне между schedule и deactivate, защото са в една транзакция.

```sql
begin;
select cron.schedule('meteo-weather-push', '*/15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='meteo_push_weather_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='meteo_push_weather_operator')),
    body := '{}'::jsonb,
    timeout_milliseconds := 125000
  ) from public.push_controls where singleton and delivery_enabled;
$job$);
select cron.alter_job(jobid, active := false)
from cron.job where jobname='meteo-weather-push';
commit;
select jobname, schedule, active from cron.job where jobname='meteo-weather-push';
```

След **успешен физически staging тест**, за staging scheduler тест, активирайте тази staging задача чрез `cron.alter_job(jobid, active := true)` и после отново я деактивирайте. Production не е активиран от PR или CI. При разрешен rollout DB owner може да включи `population_registration_enabled` за доброволно enrollment; това не включва `delivery_enabled`, Edge flag или Cron само по себе си. Не променяйте Pro subscriptions или entitlements.

## Спиране и rollback

Първо спрете доставката и задачата; спрете и регистрацията, ако е необходимо. Като owner:

```sql
begin;
update public.push_controls
set delivery_enabled=false, population_registration_enabled=false, registration_enabled=false;
select cron.alter_job(jobid, active := false)
from cron.job where jobname='meteo-weather-push';
commit;
```

Задайте и Edge `PUSH_WEATHER_DELIVERY_ENABLED=false`, Vercel `PUSH_REGISTRATION_ENABLED=false`. Ако Cron extension не е инсталиран, изпълнете само update частта; няма job за спиране. При окончателно спиране `cron.unschedule('meteo-weather-push')` премахва задачата. Не използвайте спрения worker за активност. UI hiding не е kill switch. Не изтривайте таблици/стари настройки за rollback; owner unsubscribe/settings продължават да работят. Пазете DB gate false, докато възстановявате старата функция; старият API може да вижда `deliveryEnabled=false` без промени по други функции.

## Автоматизирани проверки

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run lint
npm test
npm run test:admin:sql
# За локалния Edge Runtime тест първо кеширайте зависимости с Deno и осигурете
# съществуващите образи supabase/edge-runtime:v1.76.2 и node:24-bookworm-slim.
DENO_DIR=work/deno-cache deno cache --config tests/edge-weather/deno.json tests/edge-weather/index.ts tests/edge-push/index.ts
npm run test:push:edge
CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/push.spec.ts tests/profile-plan.spec.ts tests/alerts.spec.ts tests/planner.spec.ts --workers=2
deno check --frozen --config supabase/functions/push-check/deno.json --lock supabase/functions/push-check/deno.lock supabase/functions/push-check/index.ts
```

SQL командата използва временни PostgreSQL/PostgREST Docker контейнери с `network none` и временни JWT keys, никога Production URL. Browser проверките използват изолирани API и PushManager fixtures; не изпращат реални notifications. Unit тестът дешифрова **реалния метео payload** с временен симулиран получател. CI няма deploy, scheduler, Production secrets или real send. Резултатите и ограниченията са в `docs/weather-push-verification.json`. Физическият OS/staging smoke test остава задължителен преди Production.

Източници: [Open-Meteo условия](https://open-meteo.com/en/terms), [Vercel Hobby Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Supabase Cron](https://supabase.com/docs/guides/cron), [Supabase Free](https://supabase.com/pricing). Промяна към платен Pro/реклами изисква отделно разрешен commercial forecast API/hosting; настоящото решение използва потвърдената некомерсиална употреба.
