# Android: повторно начално зареждане — диагностика след PR #110

База: `main` след сливането на PR #110, `0aaa9ae`.
Production наблюдение: Redmi Note 13 Pro / Chrome, 21.10.2026, едно ръчно
презареждане и многократно връщане към началния skeleton в около 7 секунди.
Наблюдението е прието като реален Production проблем. **Първопричината не е
възпроизведена или установена в тази среда. Не се заявява поправка на симптома.**

## Какво е установено

| Проверка | Резултат и граница на доказателството |
| --- | --- |
| `initialLocationReady` | Инициализира се с false веднъж за App instance; setters задават само true. Forecast publish не я нулира. Повторна начална location election след forecast не е нормален преход в същия instance. |
| Forecast snapshot | `setWeather` публикува валидна прогноза и не я изчиства с null. При нови координати `hasCurrentForecast` може да стане false: това е location-specific forecast loading с `ready=true`, различно от началния надпис за определяне на място. |
| React root / keys | Един `createRoot` в `main.tsx`; App няма key според сесия или град. Account key е на WeatherNotifications, не на WeatherApp. Няма установен root-remount път при auth/GPS/reverse callbacks. |
| StrictMode | В production build няма development effect rehearsal. В development setup → cleanup → setup използва същия App instance. Контролиран remount на реалния App с нов React key дава различен instance counter без нов документ — диагностиката различава двата случая. Умишленият тест не е възпроизвеждане на Production причината. |
| Сесия / предпочитан град / GPS | Тестове с изтекла синтетична сесия, забавено token refresh и favorite lookup, с/без предпочитан град, GPS 800 / 3800 ms, бавен reverse и различни мрежови времена не връщат forecast към initial-location. Това не изключва различен Production отговор или Android lifecycle. |
| Service worker | Текущият `/push-sw.js` е push-only: install/skipWaiting и activate/clients.claim, без fetch cache handler, без reload/navigate. В app кода няма controllerchange → reload listener. Реално активиране и controller change на този worker в Chromium не презареждат документа. Исторически worker на телефона или реален upgrade към друга версия не са изключени. |
| Етикет My Location → Varna | Валиден късен reverse-label response може да смени името в същия forecast. Сам по себе си този преход не доказва reload/remount; координати или градски имена не се записват в новата диагностика. |
| Android / renderer / iframe | Няма физически Redmi в средата. Chromium Pixel 7 mobile emulation не е истински Android Chrome. Реални OS memory/discard, background/resume и външен Windy iframe lifecycle остават за устройството. |

Не са добавени sticky forecast флаг, timeout, reload guard, промяна на GPS
избора или автоматично изчистване на service worker: без доказана причина те
биха могли да скрият проблема или да нарушат легитимен избор на град.

## Какво е добавено

Съществуващото `?startupTiming=1` остава единственият opt-in. Старият
`window.meteoStartupTiming()` и формата му са запазени. Първата поява на всяка
фаза не е достатъчна за разграничаване на повторни стартове, затова има отделен
`window.meteoStartupLifecycle()` журнал:

- `document:start` с browser navigation enum, document counter, `discarded` и наличие на SW controller; pageshow/pagehide с persisted; visibility/freeze/resume.
- `module:evaluate` и `root:create`: повторен bootstrap може да бъде различен от нов документ. Един Window пази общ diagnostic singleton и не се брои за нов документ при повторна module evaluation.
- `app:setup` / `app:cleanup` с локален числов instance counter. StrictMode rehearsal пази counter-а; истински remount получава нов.
- `app:view`: само enum `initial-location`, `forecast-loading`, `forecast`, `error`, readiness/forecast boolean и enum на източника.
- `session:observed`: само authenticated/accountChanged booleans; `location:decision`: само source enum; `worker:controllerchange`: само controller boolean.

Журналът пази **до 200 събития** в tab-local `sessionStorage`, ключ
`meteo-startup-lifecycle-v1`, за да преживее reload. Времето `ms` е относително
спрямо документа; при нов документ започва отново. Редът и document counter-ът
дават последователността между документи. Няма wall-clock timestamps, URL-и,
имена на градове, координати, user IDs, email, токени, request/response bodies,
stack traces или telemetry. Само allowlisted enums, числови counters и booleans
се приемат, включително при четене на старо/подменено storage. Журналът се
копира при export и е ограничен и по входен размер; storage грешка не спира App.
При BFCache възстановяване старият Window добавя към по-новия tab journal,
без да изтрива следите на междинния документ или да връща counter-а назад;
това е покрито с отделен unit сценарий, а не с реален Android BFCache тест.

Без opt-in не се четат/пишат diagnostic storage, не се монтират diagnostic
browser listeners и няма lifecycle API. Няма промяна в дизайна, account/GPS/
forecast flow, service worker, SQL, секрети, Gemini или billing.

## Възпроизводим сценарий и доказателство

`playwright.lifecycle.config.ts` изпълнява реален Vite production build/preview
или development server. `Pixel 7` preset задава mobile viewport, touch и mobile
UA на Chromium. GPS, auth/profile, forecast и reverse отговорите са синтетични;
service worker регистрацията/активирането е реално. Няма Gemini/upstream заявки.
Външният iframe е симулиран, не е валидиран истинският Windy embed.

Матрица: GPS 800 ms + network 60 ms; GPS 3800 ms + network 180 ms; GPS 800 ms +
network 700 ms и предпочитан град. Reverse geocoding е забавен с 2800 ms,
възстановяването на изтеклата сесия и favorite lookup са отделно забавени.
След първата прогноза тестът прави **точно едно** `page.reload()`. След новата
валидна прогноза наблюдава още **7500 ms**, после проверява worker update и
синтетични freeze/resume notifications. Използва DOM MutationObserver и журнала:

- точно два main-frame документа общо (първоначално отваряне + едно reload);
- точно една weather заявка за всеки документ;
- един root и един App instance на документ; development rehearsal е същият instance;
- след първия forecast няма initial-location view или DOM с началния надпис;
- реален SW controller change, async session restore и location decision са отчетени;
- normal city switch е `forecast-loading` с `ready=true`, не initial-location;
- opt-out не създава diagnostic API или journal.

Тези проверки минават. Те доказват поведението за симулираните условия и
ограничения наблюдаван прозорец, **не универсална гаранция за Redmi/Android**.
Сценарият от Production не е възпроизведен естествено. Единственото възпроизведено
повторно initial loading е умишленият test-only React remount, който служи за
проверка на класификацията и не се включва в production `dist`.

## Production проверка на Redmi Note 13 Pro

1. След обичайното одобрение и deployment на PR проверете, че телефонът зарежда съответния build. Този PR не е слят и не е deployment. Не чистете cache, storage или SW предварително — може да изтриете доказателството за стар worker/build.
2. В същия Chrome tab отворете обичайния адрес с `startupTiming=1` в query (например `/?startupTiming=1`). Това отваряне е базовата навигация. Оставете същия профил и разрешен GPS. При USB debugging използвайте desktop Chrome `chrome://inspect/#devices` за тази страница.
3. След първа валидна прогноза запишете базовия журнал, след това натиснете Refresh **само веднъж**. Изчакайте поне 10–15 s; ако се повтори symptom-ът, не натискайте Refresh допълнително. Кратък screen recording е полезен за съпоставка с journal view transitions.
4. В Console копирайте само следните безопасни snapshots (не HAR, Authorization headers, localStorage или auth/session dumps):

```js
copy(JSON.stringify({
  lifecycle: window.meteoStartupLifecycle(),
  timing: window.meteoStartupTiming()
}, null, 2))
```

5. Ако има съмнение за нов документ, включете Preserve log в DevTools Network и пребройте main-frame Document навигациите, без да експортирате чувствителни headers/response bodies. Запишете проверения deployment SHA, версията на Chrome/Android и дали tab-ът е бил background/resumed. Проверете в Application → Service Workers дали controller е текущият `/push-sw.js` или останала стара регистрация; не я изтривайте преди capture.
6. Класифицирайте събитията с таблицата по-долу. Запазете JSON и кой точно видим надпис е бил показан. Ако API липсва въпреки query, проверете build/bootstrap/network failure; липсващ journal не доказва липса на reload.
7. За изключване премахнете `startupTiming=1` при следващото отваряне. Старият tab-local journal се освобождава при затваряне на tab-а; може изрично да се премахне само `sessionStorage.removeItem('meteo-startup-lifecycle-v1')` след събирането на доказателствата. Няма автоматично изчистване на профил или SW.

| Следа | Какво доказва / какво не доказва |
| --- | --- |
| Нов `document:start`, увеличен document counter, navigation=reload/navigate | Нов документ. Не различава кой е инициаторът на reload; съпоставете с единственото ръчно действие и Network Document заявките. |
| Същият document, `app:setup` с нов instance | React remount в същия документ; търсете preceding session/location/root events. Не е доказателство коя от тези операции го е причинила. |
| Същият document и instance, setup/cleanup/setup | Очаквано development StrictMode rehearsal. В production build това не е нормален development replay. |
| Същият document, повторен module:evaluate/root:create | Повторен JS bootstrap в същия Window, различен от navigation. Не се обозначава автоматично като нов документ. |
| forecast → forecast-loading с ready=true | Зареждане за нов избран location key, не нов startup election. Проверете дали е имало действителен user selection или късно account/default действие. |
| forecast → initial-location с ready=false | Нарушение на очаквания invariant за същия instance; нужен е capture на build и пълната последователност, без да се прикрива с UI guard. |
| pageshow/pagehide с persisted=true, същият документ | BFCache lifecycle; не е пълно reload. |
| discarded=true на нов документ | Browser е отчел tab discard. false/липса на флага не изключва OS/process crash или всички Android lifecycle причини. |
| controllerchange преди new document | Корелация със SW lifecycle, не доказана причина. Текущият worker не съдържа reload handler. Проверете версията и оставащи регистрации на устройството. |

При забранен/изчистен sessionStorage или нов tab document counter-ът може да
се рестартира; тогава използвайте Network и navigation metadata като допълнително
доказателство. Freeze/resume events в автоматизирания тест са синтетични;
реалният Android lifecycle остава непроверен.

## Верификация

- Production lifecycle: **5/5**; development lifecycle: **6/6**, включително контролиран реален App remount.
- GPS/refresh/scroll regression suite: **97/97**. GPS до 4500 ms, приемане при 3800 ms, бърз unavailable fallback, предпочитан/ръчен избор, late reverse, тих 15 min refresh и scroll са запазени.
- Пълни Node: **2065 pass / 0 fail / 10 TODO / 1 optional Deno skip**, 2076 общо. Географските регресии на Боби са включени; known debt от #109 не е променен.
- Build и lint: успешни; lint има само двете съществуващи no-unsafe-finally предупреждения.
- `git diff --check`: успешно.

```sh
npm run build
npm run lint
npm test
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.lifecycle.config.ts
CHROMIUM_PATH=/usr/bin/chromium LIFECYCLE_PRODUCTION=0 npx playwright test --config=playwright.lifecycle.config.ts
CHROMIUM_PATH=/usr/bin/chromium GPS_TEST_PORT=4193 npx playwright test --config=playwright.gps.config.ts
```

Извод: има проверена opt-in диагностика и regression coverage, **няма доказана
Production първопричина или обявена поправка на Redmi симптома**. Следващата
необходима стъпка е capture на реалния телефон със същия deployment и lifecycle
journal, без допълнителни ръчни reload-и.

За capture без компютър вече е добавен opt-in панел. Вижте
[Android diagnostic panel](android-diagnostic-panel.md) за копиране, ръчен fallback
и ограничения. Старите console API и форматите им остават същите.
