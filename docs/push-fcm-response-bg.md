# FCM Web Push: липсващ providerReason след PR #79

Проверена база: main `c2c966c`, след PR #79. По потвърждение на оператора тази ревизия е публикувана успешно; новият реален отказ е HTTP 400 без providerReason. Това не се обяснява с непубликуван PR.

## Доказан пропуск в диагностиката

PR #79 допускаше само application/json и text/plain и разпознаваше точни кратки identifiers. Всички останали MIME формати, неизвестни тела, ранно EOF, read error, лимити и timeout даваха един и същ резултат: липсващ providerReason. HTTP reason phrase също се изхвърляше. Следователно липсата на reason не доказва празен response body.

Проверени са първични публични отчети за отговори от **FCM Web Push**, не само JSON документацията за FCM HTTP v1:

- [webpush-java #46](https://github.com/web-push-libs/webpush-java/issues/46), 2018: HTTP 400 и HTML body с UnauthorizedRegistration в TITLE/H1.
- [webpush-java #33](https://github.com/web-push-libs/webpush-java/issues/33), 2017: HTTP reason phrase UnauthorizedRegistration, Content-Type text/html; charset=UTF-8, Transfer-Encoding chunked. Нашият стар parser пропуска и двете възможности за разпознаване.
- [web-push #941](https://github.com/web-push-libs/web-push/issues/941), юли 2025: HTTP 403, text/plain и цяло изречение за несъответствие между VAPID credentials и ключа при създаването на абонамента. Това не е кратък identifier и не е HTTP v1 JSON. Добавено е точно съвпадение към фиксирания код fcm_vapid_subscription_mismatch.
- [web-push #495](https://github.com/web-push-libs/web-push/issues/495), 2019: HTTP 404 с plaintext пояснение за subscription URL. То е пример за други непознати свободни текстове; PR не ги връща и не извлича endpoint от тях.

Това са отчетени исторически отговори, не гарантиран актуален Google response schema. Не е правена заявка към FCM и няма доказателство, че Note 13 Pro е получил точно някой от тези откази. Генеричен Google HTML Bad Request остава unknown_format, а не измислена конкретна причина. HTTP v1 JSON parser се запазва като допълнителна възможност, не като предположение за Web Push endpoint-а.

## Обоснована промяна

Поддържат се text/html с точно един съвпадащ allowlisted TITLE и H1 и точна позната HTTP reason phrase. Няма substring търсене на грешки в произволно съдържание. Непознатите body/phrase/JSON message, ключове, URL, токени и IDs не излизат извън parser-а.

Ново опционално поле **providerBodyStatus**, филтрирано отново в handler и CLI:

| Стойност | Значение |
| --- | --- |
| recognized | Пълно body с разпознат allowlisted reason. |
| empty | Пълно body с нула bytes; не означава липсваща/непълна доставка на body. Reason phrase може независимо да даде providerReason. |
| unknown_format | Пълно непразно body, чиито MIME/структура/identifier не са разпознати. Не означава, че FCM няма пояснение. |
| incomplete | EOF преди декларираната Content-Length или края на chunked framing. |
| timeout | Изчерпани 300 ms за body или общият транспортен срок преди завършването му. Полученият финален HTTP статус се запазва. |
| too_large | Над лимита от 1024 body / 2048 wire bytes. |
| unsupported_encoding | Не се декомпресира непознат Content-Encoding. |
| invalid_framing | Двусмислен/неподдържан framing или дублирани важни headers. |
| read_failed | Грешка в четенето; произволният exception текст не се показва. |

Сроковете и byte лимитите не са увеличени. Няма endpoint, ключови fingerprints, subscription values, MIME/header текст, body snippets, exception текст или размери в публичната диагностика. HTTP статусът, единственият опит, consent/authorize/cooldown/cleanup и отказът на redirects остават. При failed finish известните reason/body status се запазват.

## Регистрация, URL и VAPID

Проверен е repository пътят, без четене или промяна на Production записи:

- `enrollPush` сравнява съществуващия браузърен applicationServerKey byte по byte; различен ключ води до KEY_ROTATION_REQUIRED, а нов subscribe получава очаквания ключ. Persist използва subscription.toJSON().
- API валидира subscription и подава съществуващия конфигуриран VAPID public key. SQL wrapper изисква съвпадение с push_controls и записва endpoint, p256dh/auth и vapid_public_key. Sender claim/authorize сравняват device/control/config VAPID ключа и revisions; `validateDevice` проверява canonical keys/P-256.
- **Записаният vapid_public_key е метаданна от нашия сървър.** PushSubscription.toJSON() не включва applicationServerKey. DB/config equality не доказва независимо обвързването на конкретния token при FCM. Текущият browser flow ограничава този риск, но не възстановява историческа регистрация и не удостоверява нейното текущо състояние при доставчика.
- URL се записва без преобразуване. Allowlist приема /fcm/send/… и /wp/…; preparePush/web-push@3.6.7/sendPinned запазват оригиналния path. Локален TLS тест сравнява стандартния sender и нашия за **двата** пътя, включително VAPID audience, подпис, binary length и успешно независимо дешифриране на приетите bytes.
- Публичният report [web-push-php #240](https://github.com/web-push-libs/web-push-php/issues/240) описва историческо пренаписване между двата пътя в друга библиотека. Това не е доказателство за нужда от такава смяна в web-push@3.6.7 или в този проект.
- p256dh е ключът за payload encryption, различен от VAPID/applicationServerKey и от ephemeral sender key. Те не са разменени в проверената реализация. Подписът използва съществуващата VAPID двойка и origin на endpoint-а.

## Какво точно остава непроверено

Не е установена причина за конкретните устойчиви 400. Не са проверени текущото браузърно subscription и applicationServerKey на Note 13 Pro спрямо съхранения row, актуалността/обвързването на token при FCM и конкретният response body/phrase/framing/timing от последния отказ. Production request bytes не са заснети; локалните fixture тестове доказват кода с тестови данни, а не валидността на реалния token.

Два еднакви 400 могат да произлизат от устойчиво състояние на регистрацията или заявката, но броят им не различава тези случаи. Текущата стара диагностика не позволява да се установи дори защо reason липсва. Без запазена безопасна информация от съществуващите изпълнения или бъдещ отделно разрешен тест с подобрената диагностика тази граница остава. Тази работа не разрешава и не извършва нов реален тест.

Няма предположителна промяна на endpoint, payload, TTL/urgency, VAPID или регистрация. PR поправя възпроизводим пропуск в диагностиката и добавя локални TLS/native Deno проверки. Няма Push, Production/SQL/Secrets/VAPID промяна, merge или deployment.
