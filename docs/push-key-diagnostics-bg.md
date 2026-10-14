# Read-only проверка на p256dh/auth

В „Моят профил → Push известия → Моите устройства“ бутонът „Провери p256dh/auth“ сравнява текущия браузърен subscription с избрания собствен запис. За Note 13 Pro проверката се стартира от този телефон. Няма искане за Notification permission, subscribe/unsubscribe, сериализиране на subscription, запис на настройки или изпращане на Push в диагностичния път. Съществуващият екран запазва отделния си lifecycle за Service Worker.

Резултатът за всеки ключ е `match`, `mismatch`, `missing` или `unavailable`, с BG/EN текст. Missing означава липса в браузъра или записа; резултатът не разкрива коя страна липсва. Няма автоматично отстраняване на разминаване. **Съвпадението не доказва, че FCM ще приеме известие**, и не установява причината за предишния HTTP 400.

## Протокол и граници на сигурността

1. Клиентът проверява текущата Auth сесия и съответствието с потребителя на отворения екран. Проверява съществуващия root Service Worker, applicationServerKey и SHA-256 fingerprint на endpoint. Несъвпадение прекратява проверката преди четене на encryption keys или диагностичната API заявка.
2. Subscription се прочита повторно и fingerprint се проверява отново непосредствено преди getKey. Браузърът взема decoded bytes чрез `getKey('p256dh')` и `getKey('auth')`, без toJSON. Генерира нов случаен 32-byte nonce с Web Crypto.
3. За всеки ключ се изчислява SHA-256 върху UTF-8 контекст, последван от decoded key bytes:

   `meteo-pulse:push-key:v1\n<device UUID>\n<endpoint fingerprint>\n<nonce hex>\n<key name>\n` + key bytes.

   UUID, fingerprint и nonce са lowercase. Key name е точно p256dh или auth. Контекстът отделя устройства, endpoints, ключове и изпълнения. API получава само deviceId, fingerprint, nonce и двете 64-hex доказателства (или missing/unavailable). Не получава endpoint, сурови ключове или VAPID ключове. Digests са диагностични чувствителни данни: не се логват или съхраняват. Това не е механизъм за вход или разрешение за изпращане. Nonce няма server-side еднократна регистрация; replay може само да повтори read-only сравнение при все още валидна сесия и собственост.
4. POST `/api/push-key-diagnostics` удостоверява bearer токена през Auth `/user` преди RPC. Използва anon API key + същия user JWT, без service role. Допуска само точния набор полета и ограничен размер/формат. Неизвестни query параметри и сурови base64url ключове се отказват. Няма CORS разрешение; отговорите са `private, no-store`, `Vary: Authorization`.
5. SQL `check_my_push_keys` проверява auth.uid(), активен/небаннат потребител и запис с едновременно съвпадащи id, owner и fingerprint, преди сравняване. Чужд, изтрит или несъвпадащ запис дава еднакви unavailable статуси. Няма caller-supplied userId. Нормалният device snapshot остава без ключове и без техни устойчиви хешове.
6. Само вътре в базата stored base64url се декодира и проверява за дължина/canonical encoding. SQL изчислява същите nonce-bound SHA-256 доказателства. Сравнението на двата 32-byte digest-а използва фиксиран XOR/OR цикъл без ранно излизане при различен byte. Това избягва prefix comparison; не е твърдение за универсална гаранция за времето на изпълнение на PostgreSQL interpreter-а.
7. SQL и HTTP API връщат само отделните allowlisted статуси, никога очакваните доказателства или ключовете. Помощната SQL функция няма external execute grants. RPC е разрешено само на authenticated, проверява собственост и при директен PostgREST достъп. API филтрира схемата повторно и не връща произволни RPC/exception полета.
8. Клиентът проверява сесията преди заявката и след отговора. Смяна на account или unmount обезсилва pending резултата. Резултатите се изчистват при смяна на сесията и следваща диагностична проверка. Диагностичните данни не се записват в localStorage.

SHA-256 доказателството не е обратимо извеждане на ключа; auth е 128-bit случаен secret, а p256dh е публичен encryption key. Новият nonce предотвратява устойчив идентификатор между честни изпълнения. Собственик с валидна сесия все пак получава ограничен equality oracle за собствените си данни; това е целта на диагностиката. Злонамерен клиент може да симулира свои входни данни, затова match никога не се използва като authorization или FCM acceptance доказателство.

## Миграция — само за преглед

Необходима е `20261014060000_push_key_diagnostics.sql`: съществуващият API/RPC не предоставя безопасен достъп за това сравнение. Добавят се две функции и конкретни grants; няма нови таблици, колони, обновяване на записи или промяна на текущи абонаменти, gates, VAPID или настройки. Миграцията не е изпълнявана в Supabase. Изпълнява се само в disposable локални PostgreSQL тестове.

При липсваща миграция/API грешка UI показва unavailable. Няма fallback към извеждане на сурови ключове, service-role достъп, включване на регистрация или повторно регистриране.

## Проверки

- Unit: Web Crypto доказателства с изкуствени ключове, match/mismatch поотделно, нов nonce, missing/unreadable, грешен fingerprint/VAPID, subscription race, липсваща/сменена сесия, строга API схема и ред на удостоверяване, unavailable за чуждо устройство и неразкриване на raw данни.
- SQL: независимо генерирани Node SHA-256 тестови вектори срещу реалния SQL, match/mismatch, nonce binding, missing/malformed, wrong owner/fingerprint/device, липсващ/баннат потребител, private helper grants и непроменени snapshots на devices/controls/preferences/deliveries.
- `node scripts/test-push-key-sql.mjs`: само локален Docker daemon, предварително изтеглен postgres:17-bookworm, network none, без DB URL или project secrets. Използва точния основен table/policy DDL и новата миграция.
- `node scripts/test-admin-sql.mjs`: интегрира миграцията след реалните предходни migrations и проверява PostgREST с локални подписани/изтекли/подправени JWT.
- Playwright: BG/EN, изключена регистрация, fingerprint gate, статуси, nonce freshness, няма raw данни в заявките и няма subscription/settings mutations. Всички account/external API заявки са fixtures.

Не се правят hosted migration, Production deployment, real Push, промени на Secrets или настройки на телефона. PR е за преглед без merge.
