# Ръчно публикуване на `push-test` за Meteo Puls

Този workflow публикува само съществуващата Edge Function `push-test`. Не изпълнява SQL миграции, не извиква функцията и не активира доставка. Не е необходим локален Supabase CLI.

## Настройки, които собственикът въвежда ръчно

1. В GitHub → Settings → Environments създайте **`supabase-push-test`** преди първото стартиране. В Deployment branches and tags изберете **Selected branches and tags** и разрешете само branch **`main`**, без tags. Добавете Required reviewers и Prevent self-review, когато планът позволява; забранете bypass на защитите, когато тази настройка е налична. Самото име на environment в YAML не създава тези защити. Ако планът не поддържа reviewers, потвърждението в dispatch остава задължително; за отделно независимо одобрение първо осигурете поддържащ план.
2. В този environment добавете GitHub Actions **Secret `SUPABASE_ACCESS_TOKEN`**: личен access token от Supabase акаунт с право да публикува функции в целевия проект. Това не е anon key, service-role key или операторският token. Ограничете достъпа до целевия проект според наличните Supabase роли, следвайте политиката за срок и ротация. GitHub `contents: read` не ограничава правата на този Supabase token.
3. В същия environment добавете **Variable `SUPABASE_PROJECT_REF`**: реалния Project Reference от Supabase → Project Settings → General. Обикновено е 20 малки латински букви. Това е идентификаторът от адреса `<project-ref>.supabase.co`, а не името „Meteo Puls“ или локалното `project_id = "meteo-puls"`. Проверете, че сочи точно желания проект. Няма стойност по подразбиране.
4. В целевия Supabase проект проверете, че съществуващият runtime secret **`PUSH_TEST_DELIVERY_ENABLED` е точно `false`**. Ако не можете да установите това, не стартирайте workflow. Настройката `false` на GitHub runner НЕ променя remote secret; workflow умишлено не изпълнява `supabase secrets set`. Не променяйте операторското удостоверяване, VAPID ключовете или останалите runtime secrets.
5. Разрешете GitHub Actions за хранилището и pinned `actions/checkout`, ако организационната allowlist го изисква. Workflow иска само `contents: read`; не изисква write, OIDC, packages или права за SQL. За редакция/сливане на workflow е нужен потребителски достъп до хранилището и workflow файловете; това е различно от правата на runner.

Не записвайте ключове в PR, документацията, inputs или логове. Не включвайте shell tracing (`set -x`), CLI `--debug` или debug logging на Actions.

## Безопасно публикуване след преглед

1. Прегледайте и слейте PR ръчно в `main`, след като сте готови. Създаването и сливането на PR не публикуват функцията. В този PR няма реално публикуване.
2. Проверете целевия Project Reference и remote `PUSH_TEST_DELIVERY_ENABLED=false`. Не натискайте бутон за тестово известие и не извиквайте endpoint-а.
3. GitHub → Actions → **Publish push-test manually** → Run workflow. Изберете **`main`**, въведете точно **`DEPLOY push-test`** и отметнете потвърждението за изключена доставка само след реалната проверка в Supabase.
4. Проверете SHA на избрания run и при configured reviewers одобрете чакащия environment deployment. Checkout използва SHA на dispatch събитието, така че последващо движение на `main` не сменя кода на този run.
5. Workflow проверява конфигурацията, инсталира инструментите с SHA-256 проверка, проверява импортите с `deno check --frozen`, след което изпълнява единствено:

   ```sh
   supabase functions deploy push-test --project-ref "$SUPABASE_PROJECT_REF" --use-api --no-verify-jwt
   ```

6. Проверете статуса на run и публикуваната версия в Supabase Dashboard без извикване на функцията. Доставката остава изключена; този процес не включва тестово известие.

Друг клон, tag, грешно потвърждение, неотметнато поле или Re-run на стар run пропускат job-а без публикуване. Няма push, pull_request, schedule или workflow_call trigger. Concurrency не прекъсва започнала публикация; следващите изрично стартирани run-ове могат да чакат. Не стартирайте дублирани run-ове. След грешка първо проверете дали Supabase вече е приел публикацията; за нов опит е нужен нов ръчен dispatch и нов преглед. Няма автоматичен retry wrapper.

## Запазени файлове и версии

Пълен checkout запазва `supabase/config.toml`, `push-test/index.ts`, `push-test/deno.json`, `push-test/deno.lock`, `_shared/push-test.mjs` и `_shared/push-deno.ts`. `verify_jwt = false` остава само за конкретната функция; собственото операторско удостоверяване остава непроменено. `--no-verify-jwt` потвърждава същото при тази конкретна публикация. API bundling премахва необходимостта от локален CLI и от Docker за публикацията.

- `actions/checkout` **v4.2.2**, фиксиран commit `11bd71901bbe5b1630ceea73d27597364c9af683`.
- Официален Supabase CLI **2.75.0**, Linux amd64 архив с SHA-256 `e5597462f865d5ac72af0453358e37ecb0d85962ad6914a114a53de847303bde`.
- Официален Deno **2.5.6**, Linux x86_64 архив с SHA-256 `fd4f6abc1b6a134fa9a4dba56519f1631f44c88e04e4e3e9a8ff5975dfa66e1a`.
- Оригиналните `web-push@3.6.7`, `ipaddr.js@2.5.0` и транзитивните зависимости от `deno.lock`. Проверка с `--frozen` отказва промяна на lock файла и не изпълнява функцията.

Версиите и checksum-ите на архивите са сверени с официалните GitHub releases; checkout SHA е сверена с официалния tag. Ubuntu runner е `ubuntu-24.04`; системните Python 3.12, Bash, curl, tar, unzip и sha256sum се предоставят от обновявания GitHub runner image, който не е неизменен. Собствената функция, защитната логика, Vercel, Production SQL, VAPID, потребителското съгласие и устройствата не се променят.

## Проверки при подготовката на PR

Преминаха: YAML parse, Bash синтаксис на всички `run` стъпки, `git diff --check`, проследяване на всички локални импорти, наличие и вътрешна свързаност на директните и транзитивните npm записи в lock файла, запазено `verify_jwt=false`, единствен dispatch trigger, main/confirmation/run-attempt guards, минимални permissions и една команда само за `push-test`. Сверени са официалните release checksum-и и CLI изходният код за import-map discovery и single-function API deploy.

Неприключили проверки в работната среда: изпълнение на `actionlint`, `deno check --frozen` и CLI `--help/--version` не бе възможно, защото мрежовият proxy отказва връзка и инструментите не са инсталирани. Съществуващите unit тестове `push-delivery` и `push-transport` бяха опитани, но спряха при зареждане заради липсващ `web-push`; това не е преминал тест. Не е изпълнявана реална публикация или заявка към функцията.

Преди сливане завършете `actionlint` и `deno check --frozen --config supabase/functions/push-test/deno.json supabase/functions/push-test/index.ts` в среда с достъп до зависимостите. Повторете двата съществуващи unit теста след инсталиране на заключените зависимости. Това са проверки без реален Supabase проект и без изпращане на известие. Workflow допълнително изпълнява Deno проверката преди публикацията и спира при грешка.
