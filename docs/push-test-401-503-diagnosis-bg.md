# push-test: диагностика на 401 и 503, 12.10.2026

Read-only анализ на commit `90f2542`. Production проект: `qrsozxuqvjxeikyducls`.
Няма промяна на runtime, secrets, SQL или gates; няма извикване на Production функцията.
Публикуваният SHA и логовете не са достъпни, затова причините по-долу са отделени от доказаното в кода.

## Установено от кода

`supabase/config.toml` има `[functions.push-test] verify_jwt = false`.
Ръчният deploy workflow подава и `--no-verify-jwt`; `project_id = "meteo-puls"`
не е Production reference. Реалната цел идва от `SUPABASE_PROJECT_REF`.

Редът в `createTestHandler` в `_shared/push-test.mjs` е:

1. Edge flag, различен от точния string `true`: 503, JSON `PUSH_TEST_DISABLED`.
2. Метод, различен от POST: 405, `METHOD_NOT_ALLOWED` (само при включен flag).
3. Server token извън `[A-Za-z0-9_-]{43,128}`: 503, `PUSH_TEST_UNCONFIGURED`.
4. Header, различен byte-for-byte от `Bearer ` + token: 401, `UNAUTHORIZED`.
5. Origin/query или невалидно тяло: 400, `INVALID_REQUEST`.
6. Невалидни VAPID настройки: 503, `PUSH_TEST_UNCONFIGURED`.
7. RPC/DNS/подготовка/transport/finish грешка: 503, `PUSH_TEST_UNCERTAIN`.

Всеки такъв отговор има JSON, Content-Type application/json и Cache-Control no-store.
Полето `deliveryEnabled:false` е константно дори при успех и НЕ показва реалния flag.
Няма application logs. Липсата на logs сама по себе си не доказва gateway отказ.

## Съпоставка със съобщените събития

На тази дата Europe/Sofia е UTC+3:

| Българско време | UTC | Събитие | Извод |
|---|---|---|---|
| 12:15:20 | 09:15:20 | GET 503 EDGE_FUNCTION_ERROR | Не съвпада с контролирания GET отговор на този код. Проверете deployment/version, boot и runtime logs и пълното response body. |
| 12:34:51 | 09:34:51 | POST 400, content-length 1 | Ако това е request content-length и отговорът е INVALID_REQUEST от този handler, POST е преминал Edge flag и операторската проверка, но един byte не може да съдържа необходимия JSON обект. Това е отделна заявка. |
| 12:35:48 | 09:35:48 | curl 401, без видим JSON, липсва в Invocations | Gateway/маршрутизация е вероятна, но curl може да е скрил тялото с --fail, пренасочване на stdout или последваща обработка. Само тази информация не определя източника. |

Текущото изключване на доставката не доказва състоянието в тези три момента.
Смененият след 401 token не позволява да се възстанови старото сравнение.
Не използвайте отново стария token.

## Read-only проверки, без повторно извикване

- В gateway/Edge logs намерете точния path, UTC време, request ID, function ID,
  execution ID и version за всяко събитие. Проверете филтъра и задържането на логове.
- Сверете deployment source SHA, entrypoint, import map `push-test/deno.json`,
  lock файл и verify_jwt metadata със същата версия и проект. Import/check успех
  не доказва успешен runtime boot или наличие на runtime secrets.
- За 503 потърсете `BootFailure` и `worker boot error:`; проверете invalid imports,
  Node compatibility и грешки при module initialization. `EDGE_FUNCTION_ERROR`
  сам по себе си не означава доказан `BOOT_ERROR`. GET не стига до provider POST.
- За платформен 401 потърсете Missing authorization header/Invalid JWT и gateway
  error metadata. Ако verify_jwt действително е OFF за точната версия, проверете
  различен project/path/version или друг auth слой; не включвайте JWT като „поправка“.
- За приложен 401 проверете `UNAUTHORIZED`. Token не е user JWT, anon key,
  service-role key или VAPID key. Bearer prefix е точно `Bearer ` (една пауза).
  Проверете празна променлива, неизпълнена shell interpolation, whitespace,
  CR/LF и дублирани Authorization headers, без да показвате стойността.
- Сверете оригиналната curl конфигурация след редактиране на секретите:
  `curl --config -` използва stdin за конфигурацията; `data = "@-"` или
  `data-binary = "@-"` не трябва едновременно да използва същия stdin за тялото.
  JSON трябва да е curl-config quoted string с правилно escaped двойни кавички.
  Без оригиналния config това остава хипотеза, не доказана причина за 400.

Не е установена runtime поправка, която обосновано да отстрани историческите
401/503. Не сменяйте imports, transport или auth само въз основа на status code.
Този PR добавя проверим runbook и безопасна бъдеща команда, без deploy промени.

## Една бъдеща тестова заявка — НЕ е изпълнявана

Изпълнява се само след отделно одобрение за реалния тест и когато собственикът
вече е проверил gates и валиден permit за точно Note 13 Pro. Тази команда не
създава permit, не активира gates и не променя secrets. Докато Edge flag е OFF,
handler-ът ще върне PUSH_TEST_DISABLED, без доставка.

Permit трябва да е неизползван, неоттеглен, неизтекъл (максимум 15 минути),
за точния device/user и актуалните device/preferences revisions. SQL проверява
съгласие, категории, активен абонамент, approver, VAPID и DB gate.
claim е атомарен; authorize изразходва reserved състоянието преди network send.
Това ограничава до **най-много един provider опит** за permit; точно една видима
нотификация не може да се гарантира от HTTP заявката.

Командата изисква Bash, Python 3 и curl >= 7.76. Token се въвежда през /dev/tty
без echo; не влиза в argv, shell history, файл или отпечатан config. UUID се
въвежда отделно. stdin на curl съдържа само config, а JSON е inline config value.

```bash
python3 - <<'PY'
import getpass
import json
import re
import subprocess
import sys
import warnings

# Never fall back to an echoed/stdin token prompt.
warnings.simplefilter('error', getpass.GetPassWarning)
with open('/dev/tty', 'r+') as tty:
    tty.write('Неизползван permitId за Note 13 Pro: ')
    tty.flush()
    permit = tty.readline().strip()
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', permit):
        sys.exit('Невалиден permitId; няма заявка.')
    token = getpass.getpass('Текущ операторски token (скрит): ', stream=tty)
if not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', token):
    sys.exit('Невалиден формат на token; няма заявка.')

body = json.dumps({'permitId': permit}, separators=(',', ':'))
# json.dumps supplies curl config quoting for these validated ASCII values.
config = '\n'.join([
    'url = "https://qrsozxuqvjxeikyducls.supabase.co/functions/v1/push-test"',
    'request = "POST"',
    'header = ' + json.dumps('Authorization: Bearer ' + token),
    'header = "Content-Type: application/json"',
    'data-binary = ' + json.dumps(body),
]) + '\n'
result = subprocess.run([
    'curl', '--disable', '--config', '-',
    '--silent', '--show-error', '--fail-with-body',
    '--proto', '=https', '--connect-timeout', '10', '--max-time', '45',
    '--write-out', '\nHTTP %{http_code}\n',
], input=config, text=True)
sys.exit(result.returncode)
PY
```

`--disable` е първата curl опция и игнорира локалния .curlrc. Няма retries,
redirects, verbose или trace. Има точно едно curl изпълнение, без automatic retry.
При timeout, PUSH_TEST_UNCERTAIN или 502 не повторяйте и не създавайте нов permit
преди read-only проверка на ledger/logs. 200 PUSH_TEST_ACCEPTED означава provider
acceptance, не доказва показване на Android. 409 означава отказ на permit/gates.

Официални източници:
- https://supabase.com/docs/guides/troubleshooting/edge-function-401-error-response
- https://supabase.com/docs/guides/troubleshooting/edge-function-503-response
- https://supabase.com/docs/guides/functions/auth-headers
- https://curl.se/docs/manpage.html (--config, --disable, --fail-with-body)
