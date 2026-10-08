# Meteo Puls: ръчен архив и безопасно тестово възстановяване

## Обхват и ограничения

Безплатният план не трябва да се приема като гаранция за достъпни автоматични backups или PITR. Тази процедура използва официалните PostgreSQL `pg_dump`, `pg_dumpall`, `pg_restore` и `psql`, плюс `age` за криптиране. Няма cron, keep-alive, deployment или платени услуги. Няма извършен export, връзка с production или възстановяване при добавянето на инструмента.

Анализът е на кода и трите SQL миграции в хранилището, а не на живата база. Администраторът трябва да сравни действителните схеми, разширения и роли преди архивиране. Пълният dump обхваща всички достъпни схеми, включително `public`, `auth` и `storage`, без филтри, които могат да пропуснат зависимости. Липса на права или грешка прекратява операцията. RLS не се изключва в production; използва се администраторски DB достъп с необходимото право за прочит през RLS, а не anon/service-role API ключ.

| Обект | Данни и зависимости | Защита |
| --- | --- | --- |
| profiles | user_id → auth.users, display_name, timestamps | ENABLE/FORCE RLS; политики за собствен профил; service_role има ограничен SELECT/UPDATE |
| subscriptions | user_id → auth.users; free/pro, status, идентификатори на доставчика | ENABLE/FORCE RLS; без browser table grants; get_my_entitlements() връща правата на текущия потребител |
| favorite_places | UUID, user_id → auth.users, координати, генерирани ключове, GeoNames полета; уникалност по потребител и координати | ENABLE/FORCE RLS; собственикът добавя/чете/изтрива; ограничено UPDATE за GeoNames |
| place_settings | user_id → auth.users; съставен FK към favorite_places; изтриване на default поставя NULL | ENABLE/FORCE RLS; собственикът чете и задава default чрез set_my_default_place(uuid) |
| Supabase Auth | auth.users и останалите Auth таблици, включително identities и чувствителни сесии/хешове | Архивът е чувствителен дори без ясни пароли |

Dump запазва структури, индекси, ограничения, sequences, RLS, функции, тригери, ownership, GRANT/REVOKE и default privileges. Сред важните функции са `new_user_defaults`, `set_profile_updated_at`, `get_my_entitlements`, `set_my_default_place`; `on_auth_user_created` е върху `auth.users`. Не използваме `--no-acl` или `--no-owner`. Отделният roles.sql запазва роли и членства **без паролите им**. DB snapshot е консистентен; ролите са отделен export, затова по време на архивиране не променяйте DDL/роли. Самият архив не включва Dashboard настройки, OAuth/SMTP секрети, JWT signing keys, Edge Function deployment, DNS или файловете в Storage. Поддържайте отделен криптиран опис на тези настройки.

## Подготовка от администратора

Не предоставяйте секрети в чат, GitHub, PR, frontend или shell command line. На доверена административна машина инсталирайте Python 3.11+, PostgreSQL clients със същата major версия като сървъра и age. Проверете версията на сървъра частно. Осигурете:

- Direct DB или **session pooler** endpoint от Connect в Dashboard, DB user и DB password. Transaction pooler не е подходящ за тази процедура. Direct endpoint може да изисква IPv6.
- Частен libpq service файл извън всички Git хранилища, mode 0600, със service `[meteo_backup]`, host, port, dbname, user, `sslmode=verify-full` и подходящ `sslrootcert`. Не изключвайте TLS проверките. Паролата поставете в отделен `PGPASSFILE` mode 0600; избягвайте wildcard записи. Не записвайте password в service файла.
- age публичен recipient и частен identity за възстановяване. Съхранявайте identity отделно от архивите, с ограничен достъп и резервно копие на ключа.
- Частни директории mode 0700 извън хранилището за изход и staging. **Staging трябва да е върху криптиран диск/volume**: там временно има plaintext с лични данни. Изтриването не гарантира физическо заличаване върху SSD. Не използвайте споделени /tmp директории, не включвайте shell tracing.

Пример с пътища без секрети (заменете ги със собствени абсолютни пътища):

```bash
export PGSERVICEFILE=/secure/admin/pg_service.conf
export PGPASSFILE=/secure/admin/pgpass
export PGSERVICE=meteo_backup
python3 scripts/supabase-backup.py \
  --output-dir /secure/backups \
  --staging-dir /encrypted/backup-staging \
  --recipient age1YOUR_PUBLIC_RECIPIENT \
  --encrypted-staging-confirmed
```

Инструментът не чете `.env`, не приема connection URL и не отпечатва диагностиките на DB инструментите. Проверява TOC за данните на четирите таблици и auth.users, криптира tar и публикува `.tar.age` само след успешни стъпки. Пакетът включва `database.dump`, `roles.sql`, `contents.txt` и `manifest.json` с SHA-256. Външен `.sha256` открива случайна повреда, но не доказва автентичност; криптографската проверка на age и вътрешните hashes са задължителни. Успешен export не доказва успешно възстановяване.

Копирайте само криптирания архив и checksum на второ отделно място с ограничени права. Проверете копието с `sha256sum -c FILE.tar.age.sha256` в неговата директория. Използвайте например два външни криптирани диска, един офлайн. Определете retention според нуждите и личните данни (например 4 седмични версии) и изтривайте изтеклите архиви безопасно. Free планът не отменя възможните ограничения за egress; следете quota, без активиране на платени услуги.

## Storage: отделен метод за файлове

В `src`, `api` и миграциите няма Storage API calls или създаване на buckets. Browser localStorage не е Supabase Storage и не е включен в DB архива. Не можем да потвърдим дали администратор е добавил buckets извън кода. Проверете Dashboard → Storage и частно `select count(*) from storage.buckets; select count(*) from storage.objects;`. Това са ръчни проверки, не keep-alive. Ако има файлове, **DB архивът сам по себе си не е достатъчен**.

За отделен export използвайте официалния Supabase Storage API/SDK от доверена административна машина, с service-role ключ само в частен environment/file. За всеки bucket изпълнете list с пагинация и рекурсивно обходете всички prefixes; използвайте download за всяко пълно име, включително private buckets. Не използвайте public URLs или временни signed URLs като архив. Запазете файловете на криптирания staging volume, както и manifest с bucket, exact object key, size, SHA-256, content type, cache-control, bucket public/private и ограничения. Съхранявайте object keys като данни в manifest; генерирайте локални UUID имена, за да не допуснете path traversal от ключове. Прекратете при всяка грешка, проверете counts и hashes и криптирайте целия пакет с age преди прехвърляне. Не публикувайте manifest, защото имената също могат да съдържат лични данни.

Спрете временно upload/delete от приложението в договорен прозорец: Storage и PostgreSQL не споделят атомарен snapshot. Повторен inventory трябва да съвпадне с първия; при промени повторете целия export. При тестово възстановяване на Storage използвайте upload API на **локален изолиран Supabase**, пресъздайте buckets с техните ограничения, проверете всяко име/size/hash, public/private достъп и owner/RLS semantics. Upload може да промени owner и timestamps: документирайте разликите и проверете политиките, преди да обявите пълно възстановяване. Не пишете директно файлове в backend и не приемайте restore на storage.objects за restore на съдържанието.

## Възстановяване само в изолирана среда

Тук умишлено няма команда, която приема target production URL. Не изпълнявайте `supabase db push`, reset или pg_restore срещу реалния проект. Няма нужда от нов облачен Supabase проект.

1. Подгответе disposable локална VM без достъп до production/Интернет, с криптиран диск и PostgreSQL със същата major версия. Дайте име на празната DB `meteo_restore_test`. Използвайте Unix socket само в VM, не remote host. Настройте нужните разширения по inventory от dump; обикновеният PostgreSQL може да няма Supabase разширения. При липса използвайте съответстващ локален Supabase stack в отделна VM; неговите предварително създадени managed schemas изискват прегледан restore план, а не сляпо изпълнение на пълен dump.
2. Копирайте криптирания архив и проверете външния checksum. Декриптирайте с `age --decrypt --identity /secure/age-identity --output /encrypted/restore/backup.tar FILE.tar.age`. Разопаковайте само четирите очаквани обикновени файла в частна директория, без абсолютни пътища, symlinks или `..`. За архив от този инструмент: `tar -tf` за преглед, след това `tar -xf` с изрично изброени четири имена.
3. Проверете всеки файл спрямо sha256 в manifest.json и `pg_restore --list database.dump`. Сравнете версията и TOC с очакваните таблици, Auth, политики, функции, тригери и ACL. Повреден/непознат архив се отхвърля. Dump съдържа изпълним SQL: възстановявайте само доверен архив.
4. Прегледайте roles.sql **частно**. Supabase има managed роли и някои изискват superuser. Пресъздайте необходимите имена/членства в disposable VM без пароли. Ако роли вече съществуват, адаптирайте копие на roles.sql за конкретната среда; не игнорирайте всички грешки и не изпълнявайте непрегледан roles.sql срещу локален stack. Запазете протокол за отклоненията. Приложете прегледания файл с `psql -X --set ON_ERROR_STOP=1 --host /var/run/postgresql --dbname postgres --file reviewed-roles.sql`.
5. За празен PostgreSQL с подготвени роли/разширения използвайте командата по-долу **само във VM**. Не добавяйте `--clean`, `--no-owner`, `--no-acl`, не прилагайте миграциите повторно върху възстановените таблици. При грешка транзакцията се отменя; отстранете причината в disposable средата и започнете с нова празна DB. Логовете съдържат потенциално чувствителна информация, пазете ги частно.

```bash
# Само в изолираната VM; изчистете наследените PG* connection variables.
env -u PGSERVICE -u PGSERVICEFILE -u PGHOST -u PGHOSTADDR \
  -u PGPORT -u PGDATABASE -u PGUSER -u PGPASSWORD -u PGOPTIONS \
  pg_restore --host /var/run/postgresql --dbname meteo_restore_test \
  --exit-on-error --single-transaction /encrypted/restore/database.dump
```

За пълен application/Auth smoke test използвайте изолиран локален Supabase с подходяща версия и локални JWT ключове, забранени SMTP/OAuth/webhooks и production endpoints. Възстановяването на Auth SQL данни не възстановява външните providers и JWT конфигурацията. Не изпращайте имейли на реални потребители и не използвайте реалните сесии за тестове. За browser проверки използвайте синтетични акаунти. Production recovery е отделна одобрена операция и не е част от това ръководство.

## Критерии за успешен restore

- Сравнете counts на всички таблици с отделен частен inventory, получен при архивиране в същия прозорец; не публикувайте резултати с лични данни. Проверете FK orphan rows, уникалност, generated координатни ключове и последователности.
- Проверете ENABLE/FORCE RLS на четирите таблици, pg_policies, pg_proc (security definer/invoker и search_path), pg_trigger включително on_auth_user_created, owners и grants/default ACL спрямо TOC/schema dump. Проверете, че subscriptions остава без browser write права, а entitlement RPC е само за authenticated.
- С два синтетични потребителя A/B тествайте favorite CRUD, default и delete→NULL; A не може да чете/променя B, нито да задава B favorite като default. Проверете профилните ограничения и че нов Auth потребител получава profile и free subscription чрез trigger.
- Проверете вход/logout/account switch, езиците BG/EN и работата на съществуващото приложение само с локални endpoints. Не считайте superuser SELECT за RLS тест.
- При Storage проверете и файловете по описаната отделна процедура. Документирайте версии, checksum на криптирания архив, дата, резултат и ограничения без лични данни. Успех се обявява само след тези проверки; изтрийте disposable средата и plaintext след приключване.

## Официални справки

- https://www.postgresql.org/docs/current/app-pgdump.html
- https://www.postgresql.org/docs/current/app-pg-dumpall.html
- https://www.postgresql.org/docs/current/app-pgrestore.html
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/reference/javascript/storage-from-download
- https://supabase.com/docs/reference/javascript/storage-from-list
