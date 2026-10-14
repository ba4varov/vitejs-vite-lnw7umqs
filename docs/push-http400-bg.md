# Web Push HTTP 400: проверка на заявката и безопасна диагностика

Продължение след потвърдено публикуване на PR #79: [FCM Web Push формати и providerBodyStatus](push-fcm-response-bg.md).

Проверена база: `03169a8` (main след PR #78). Историческият резултат `request_rejected / 400` доказва получен финален отказ, но не доказва грешно VAPID удостоверяване, криптиране или Content-Length. Успешното отнемане на разрешението не обяснява отказа и не означава доставка.

## Проследен път

1. `createOperatorHandler` подготвя избраните account/device/category, проверява текущата операторска Auth сесия и DB membership, и приема пълното потвърждение чрез атомарния arm gate. След него извиква `createTestHandler`.
2. `createTestHandler` прави claim, валидира endpoint, canonical subscription keys и съвпадение с конфигурирания публичен VAPID ключ. `preparePush` делегира директно на `web-push@3.6.7.generateRequestDetails`.
3. Payload е UTF-8 JSON с локализиран текст и eventId. Библиотеката създава RFC 8291/8188 `aes128gcm` body: salt, rs=4096, 65-byte ephemeral P-256 key, AES-GCM ciphertext, final-record delimiter и authentication tag. Няма собствено преизпълнение на криптирането в sender-а.
4. Всички DNS адреси се проверяват преди финалното DB authorize. `sendPinned` използва проверен числов адрес, а `denoConnector` прави `Deno.connect` → `Deno.startTls` → `handshake`, със SNI/проверка на сертификата за оригиналното име и ALPN `http/1.1`.
5. `sendPinned` пише POST към оригиналния path, запазва VAPID/Content-Encoding/Content-Type/TTL/Urgency и задава Host, Connection: close и точно една Content-Length от **двоичните bytes**, включително при частични TLS writes. Няма redirects, втори DNS lookup към мрежата или втори опит след отказ/неизвестен резултат.
6. HTTP 400 остава `request_rejected`, finish outcome е `failed`, а finally затваря gate. Операторският инструмент отнема разрешението и показва само разрешените диагностични полета. Правилата за съгласие/cooldown/един опит не са променени.

## Проверени свойства

| Свойство | Локално доказателство |
| --- | --- |
| Сравнение със стандартния sender | Локалният TLS сървър получава едни и същи body bytes и еквивалентни headers от стандартния `web-push@3.6.7.sendNotification` и `sendPinned`. Replay използва еднократно генерираните details, защото отделни encrypt операции имат различни salt/ephemeral key. Тестът нарочно подава грешен входен Content-Length на `sendPinned`; на wire стойността е коректна. |
| VAPID / RFC 8292 | Независима ES256 signature проверка; `aud=https://fcm.googleapis.com`, валиден exp, очакван sub и публичен ключ в `Authorization: vapid t=…, k=…`. |
| Payload / RFC 8291 | Независим приемник дешифрира **полученото по TLS** съобщение, проверява record layout, final delimiter и точния български JSON. |
| HTTP / FCM Web Push формат | POST, Host fcm.googleapis.com, Content-Type application/octet-stream, Content-Encoding aes128gcm, TTL 60, Urgency very-low, точна byte length; няма Transfer-Encoding, legacy Encryption/Crypto-Key или дублирана Content-Length. Това е Web Push endpoint, не FCM HTTP v1 JSON send API. |
| Native Deno | Същите проверки върху заявките от Deno 2.5.6 през оригиналния `denoConnector`, включително частични writes и отказ при грешно сертификатно име преди HTTP payload. |
| HTTP 400 | Локален доставчик връща 400 с Content-Length и chunked body. Handler връща 502 с точния upstream status и разрешен reason; прави само един опит и затваря gate. |

Не е открит възпроизводим дефект в формирането на заявката, който да обяснява реалния HTTP 400. Локалният симулатор проверява изброените свойства; не изпълнява частните проверки на Google и не доказва валидност на реалния абонамент. Native Deno тестът не е изпълнение на публикуваната Supabase Edge Runtime версия.

## Какво е поправено в диагностиката

Преди тази промяна транспортът връщаше само status/Retry-After и затваряше връзката веднага след headers. Причината в response body се губеше. Това е доказан диагностичен пропуск, а не доказана причина за отказа.

Само при FCM отговор >=400 се допуска четене до 300 ms, до 2048 wire bytes и до 1024 body bytes. Поддържат се Content-Length, прост chunked framing и затваряне на връзката. Компресирани, двусмислени, непълни, прекалено големи и непознати тела не се публикуват. Вече полученият HTTP статус остава валиден и при грешка или timeout в диагностичното четене; няма retry.

Полето `providerReason` е опционално и съдържа само фиксирани стойности от allowlist. Разпознават се canonical JSON `error.status`, `google.firebase.fcm.v1.FcmError.errorCode` и точни познати plaintext identifiers. Например `INVALID_ARGUMENT` → `fcm_invalid_argument`, `SENDER_ID_MISMATCH` → `fcm_sender_id_mismatch`, `InvalidRegistration` → `fcm_invalid_registration`. Кодът описва съобщеното от доставчика; generic INVALID_ARGUMENT не посочва кое поле е грешно. Тези формати са възможности за диагностика, не обещание за конкретния отговор на Web Push endpoint-а.

Raw body, JSON message/field descriptions, произволни headers, exception текст, endpoint, IP, subscription, токени, IDs и ключове не се връщат и не се логват. Allowlist се прилага отново в handler и CLI. При failed finish RPC известните status/reason се запазват. Неуспешната диагностика не влияе на разрешението или доставката.

## Каква информация липсва за историческия отказ

- Безопасният точен provider reason от онзи отговор; старият код не го е запазил. Само `request_rejected / 400` не различава грешна заявка, невалидна регистрация и други откази.
- Точната публикувана ревизия/runtime при теста. Провереният repository и локалният Deno runtime не доказват байтовете, изпратени от историческата Production версия.
- Ако доставчикът върне само generic INVALID_ARGUMENT, ще е нужна допълнителна конкретна, предварително разрешена диагностика на нарушеното поле. Настоящият PR умишлено не извежда неговия произволен message/fieldViolations текст и не търси Production subscription/secret стойности.

Не е обоснована промяна на ключове, повторна регистрация, смяна на encoding/urgency или replay само въз основа на HTTP 400. PR не възстановява липсващия исторически body и не разрешава нов реален тест. В тази работа няма реален Push, Production/SQL/Secrets/VAPID промяна, merge или deployment.

Протоколи и формати: [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030), [RFC 8188](https://www.rfc-editor.org/rfc/rfc8188), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291), [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292), [FCM error codes](https://firebase.google.com/docs/cloud-messaging/error-codes).
