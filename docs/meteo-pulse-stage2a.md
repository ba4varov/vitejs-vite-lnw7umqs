# Meteo Pulse — Етап 2А: география и зареждане

База: актуалният `main` след PR #109 (`4762b3e7a1bf2a2ab27af74c3033df27e0620530`).
Двете направления са в отделни комити в един PR; допълнителен комит възстановява GPS съвместимостта с PR #90. Няма автоматично сливане,
промяна на Gemini модел/prompt/квота, SQL, секрети или billing. Всички upstream
отговори в проверките са симулирани; няма живи Gemini заявки.

## География: причина, поправка и доказателство

| Проблем | Първопричина в main | Поправка | Автоматизирано доказателство | Production проверка |
| --- | --- | --- | --- | --- |
| Отправна точка вместо дестинация | Кандидатите нямат роли; общото grounding може да приеме изрично избрания от AI изходен град. | Ясните BG/EN конструкции `от X до Y` / `from X to Y` отделят origin и destination. Дестинацията се проверява независимо чрез Open-Meteo, дори при stale AI origin/context. | `weather-geography-stage2.test.mjs`: правилен AI, грешен origin, context и fallback; координатите във всички forecast/AQI/marine заявки са на дестинацията, датата остава утре. | Препоръчителна smoke проверка с реалния геокодиращ каталог. |
| Сравнение на няколко места | Финалният explicit-AI shortcut може да избере един от няколко реални кандидата. Малки букви не дават proper-name evidence. | BG/EN сравненията и списъците събират отделни места независимо от главните букви и искат уточнение, вместо да приемат единичния AI избор. | Сравнение/дизюнкция с AI, избрал един град; lower-case `or/или`; нула weather заявки преди уточнение. | Препоръчителна smoke проверка; живият Gemini не е измерван. |
| Еднакви имена | `log10(population)` участва в score; разлика в населението може да премахне двусмислието. | Премахнато е population ranking. Изисква се уникална exact-name географска идентичност, област/държава или independently matched потвърден контекст. Квалификаторите не се изтриват, когато AI върне голото име. | Баня / Springfield с 100000 срещу 100 жители; областни уточнения с/без запетая, със/без AI; проверени координати на малкото населено място. | Да: реални варианти на областните имена и пълнотата на Open-Meteo каталога. Непотвърден квалификатор води до уточнение. |
| Ограничение до три кандидата | `add` безшумно прекратява събирането след третия; след това не е известно, че е имало още места. | Първо се събира bounded-by-input evidence, после се ограничават паралелните probes. Overflow/дълъг unresolved comma list блокира прогнозата с уточнение. | Четвърти град, включително comma-only lower-case списък със стар контекст и AI избор; няма weather заявка. Съществуващият probe budget е запазен. | Не е нужна за детерминистичната защита; полезна е smoke проверка. |
| Запазени координати за погрешен град | Съвпадение с голото име на избрания град прескача Open-Meteo и директно връща неговите координати. | Shortcut-ът е премахнат за изрично име. Потвърденият разговорен контекст се използва без ново място; при изрично същото име идентичността отново се проверява срещу Open-Meteo. | Избран same-name град с чужди координати не прескача geocoding; смяна Sofia → Varna и последващ въпрос запазват новите координати. | Препоръчителна проверка на реални запазени места. |

Географският набор съдържа **34** нови BG/EN handler сценария. Копиран без
промяна върху базовия main дава **9 pass / 25 fail**; върху поправката дава
**34 pass / 0 fail**. Очакванията са независимо зададени координати, не изход
от production parser-а. Проверяват се действителните URL параметри на всички
симулирани weather заявки.

`geoFixtures` вече включва избраната София: след премахването на shortcut-а
фикстурата трябва да предоставя реалния очакван geocoder отговор и за нея.
Нито един desired label, debt entry или тест от PR #109 не е отслабен.

## Зареждане и обновяване: причина, поправка и доказателство

| Проблем | Първопричина / установено поведение | Поправка | Автоматизирано доказателство | Production проверка |
| --- | --- | --- | --- | --- |
| Начално зареждане и разрешен бавен GPS | Първоначалният PR #110 съкрати прозореца от 4500 на 1000 ms и така отхвърляше валиден мобилен GPS при 2 s / 3,8 s. | Възстановен е общият таван 4500 ms от PR #90. Успехът, отказът и неподдържаният GPS приключват веднага; няма минимално изчакване. Header, изборът на град и loading skeleton се показват, докато се избира един окончателен източник. | Unit и browser проверки при 800 / 2000 / 3800 ms; след 4500 ms; denied/missing Permissions/unsupported GPS без advancing clock; предпочитан град и ръчен избор. Първата и единствена прогноза ползва правилните координати. | Да: реален Android/iOS lifecycle и permission/GPS latency. При действително чакащ разрешен GPS прогнозата започва след fix или след общия таван, без междинна прогноза за погрешния град. |
| Конкуренция на default, GPS и ръчен избор | Startup election и account guard вече пазят приоритетите, но async label/data responses трябва да се обезсилват и преди следващия React commit. | Синхронно обновяване на location key и revision при нов избор; reverse/localization проверяват revision, координатен ключ и език. Запазен изричен default остава предпочитание при startup; ново ръчно/GPS действие го отменя. | Saved Varna с чакащ default, нов изричен GPS, след това стар automatic GPS/default; ръчен град при pending GPS/reverse. Старите отговори не сменят град или координати. | Да: реално account възстановяване и device permission lifecycle. |
| Прогнозата се вижда, но правилното GPS име никога не идва | При първия weather snapshot `initialGpsLabelRef.pending=false` замразява fallback името и отхвърля по-късния валиден reverse response. | Премахнато е замразяването по weather completion. Label enrichment е независимо от forecast snapshot и се приема само за текущия избор. Повторен GPS със същите координати има нова label generation. | Задържан reverse response: първо температурата, после Varna/Troshevo, без нова прогноза/фон. Manual city отхвърля стария label. Same-coordinate GPS не повтаря weather заявката. | Да: отговори и наличност на Nominatim в Production; неуспехът му запазва forecast и fallback label. |
| Грешка при автоматично обновяване и мигане | Всеки refresh задава `loading=true`, изчиства advice и връща supplemental статуса на loading; generic error card се вмъква пред валидната прогноза. Няма guard срещу нов interval при вече чакаща main заявка. | Тих refresh пази forecast/advice/допълнителни данни, не включва loading banner и не дублира in-flight заявка за същия ключ. Грешка пази snapshot-а и показва forecast-specific статус с retry извън document flow; успехът го изчиства. | Network 503 на 15 min, после успешен refresh; същата температура/име/фон при отказ; recovery с нова температура; точно една GPS заявка; два интервала при held main не създават дубликат. | Да: реални мрежови прекъсвания и background throttling. В main interval-ът вече извиква само `fetchWeather`, не GPS; Production симптомът за GPS грешка на 15 min **не е възпроизведен като GPS повикване**. `gpsError` се задава само от изричния бутон. Трябва да се провери deploy SHA и конкретното съобщение на реално устройство. |
| Пълно Refresh връща стар scroll offset | Няма изрична политика за browser scroll restoration. | `history.scrollRestoration=manual` в head преди mount и еднократно `scrollTo(0)` при document bootstrap. Няма scroll reset в data effects, interval или reverse callback. Refresh error статусът не променя document geometry. | Реален Chromium `scrollY`: от >500 px пълно reload → 0, включително held forecast; тих 15 min failure/recovery → предишен offset ±2 px. Проверено при 390 и 1440 px. Съществуващите focus операции са за изрично отворени контроли; startup не autofocus-ва карта/форма. | Да: Safari/Firefox restoration и реалният Windy iframe могат да имат различен device lifecycle; изисква smoke проверка. |

Еднократният startup election запазва защитата срещу StrictMode дублиране.
Няма ново GPS определяне на всеки 15 минути. PR #90 е запазен: primary,
marine и AQI се стартират паралелно; main не чака supplement-и или reverse label.
Основният дизайн и responsive layout са запазени; новият fixed refresh error
статус е видим само при действителен отказ и не измества четящия потребител.
Не се логват точни координати/URL-и от forecast exception-и.

## Корекция след прегледа: съвместимост с PR #90

Намаляването до 1000 ms беше регресия, а не безопасно ускоряване. Новият комит
в PR #110 възстановява **4500 ms като общ максимален срок**, без безусловно
чакане до него. Срокът започва само веднъж за startup election; StrictMode
повторението споделя същия избор. Няма втори автоматичен GPS опит или подмяна
след окончателния избор.

| Състояние | Начално показване и приемане на местоположението |
| --- | --- |
| Разрешен GPS при 800 ms / 2 s / 3,8 s | Приема се автоматично веднага след callback, без бутон и без изчакване до 4,5 s. Shell/skeleton е наличен преди fix; след него основната прогноза не чака reverse geocoding, marine или AQI. |
| Отказано/prompt разрешение, липсващ Permissions API | Fallback веднага след известния резултат, без GPS prompt и без advancing clock в тестовете. |
| Неподдържан geolocation API | Fallback веднага, дори ако наличният Permissions API никога не отговори. Чакащ собствен lookup за предпочитан град запазва своя bounded startup избор. |
| Неразрешил се Permissions lookup при наличен GPS | Ограничен от същия общ таван; не се добавя отделен срок или retry. |
| Валиден запазен предпочитан град | Приоритетът му от PR #90 е запазен; пристигнал по-късно автоматичен GPS не го сменя. Нов изричен GPS/ръчен избор продължава да има приоритет над старите отговори. |
| Ръчен избор при pending GPS | Показва се избраният град; старият GPS callback при 3,8 s не го презаписва. |
| GPS след общия срок | При 4,5 s се избира fallback; по-късен callback не сменя forecast, фон или scroll позиция. |

Компромисът е ранно показване на управляемия интерфейс и skeleton, последвани
от **една прогноза за окончателно избраното място**. Не се показва предварителна
прогноза за резервния град, която да бъде заменена автоматично след 2–3,8 s.
Така не жертваме приетия GPS прозорец, не въвеждаме грешни координати, мигане,
дублирани forecast заявки или нежелано пренареждане. Когато GPS е бърз или
недостъпен, този прозорец не добавя изкуствено изчакване.

Production логиката в този допълнителен комит е само в `initial-location.js`.
Географията на Боби, късното reverse-label enrichment, quiet refresh и scroll
политиката от PR #110 са запазени и проверени повторно. Тестовете от PR #90
отново доставят slow GPS при **3800 ms**, вместо да заменят случая с 800 ms;
има и отделни случаи за 800 / 2000 / 3800 ms при мобилен и настолен изглед.
Unit startup suite: **23/23**. Пълният browser набор проверява първоначалния
skeleton, GPS координатите в заявките, един weather request и стабилен фон.

Конкретното Production съобщение за грешка при обновяване на местоположението
**остава невъзпроизведено и не се обявява за окончателно поправено**. Симулираните
refresh failure/recovery сценарии потвърждават поведението на кода, но не
установяват първопричината на този Production симптом. Необходима е проверка
на deploy SHA, точното съобщение и реалния device/background lifecycle.

## Проверки

- `npm run build`: успешно.
- `npm run lint`: успешно; само двете предишни `no-unsafe-finally` предупреждения в `scripts/push-node-operator.mjs`.
- `npm test`: **2059 pass / 0 fail / 10 TODO / 1 optional skip**, 2070 теста.
- `BOBI_STRICT_LOCAL=1 node --test tests/unit/bobi-regression.test.mjs`: **134 pass / 10 fail** — същите известни дефекти, неизменени labels.
- Историческо сравнение: **62/62**, **62 → 32** симулирани generate извиквания, 48.4%, нула отклонения.
- Географски handler regressions: **34/34**, срещу **9/34** на базовия main.
- GPS/loading browser suite: **97/97**, включително same-coordinate label и новата PR #90 времева матрица. Симулирани GPS, network, reverse и account responses; действителен Chromium scroll.
- Относимите progressive browser regressions: **11/11** — pending supplement-и, optional failure, main retry, stale city requests, четири варианта на 15 min refresh.
- `git diff --check`: успешно.

Един optional skip е съществуващият native Deno TLS тест без Deno runtime.
TODO дефектите са изпълнени и видими; не се броят за успешни интерпретации.
Production deploy, жив модел и billing не са използвани за валидиране.

Команди за възпроизвеждане (browser executable според средата):

```sh
npm ci
npm run build
npm run lint
npm test
BOBI_STRICT_LOCAL=1 node --test tests/unit/bobi-regression.test.mjs
node --test tests/unit/weather-geography-stage2.test.mjs
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.gps.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.loading.config.ts --grep 'main renders|supplements finish|optional failures|main fails|switch cities|15 minute refresh'
mkdir -p work/before-efficiency
git archive 7d89cbd437392415f71cd42ed834453ad1704666 server api tests/helpers | tar -x -C work/before-efficiency
ln -sfn ../../node_modules work/before-efficiency/node_modules
node scripts/compare-bobi-gemini-usage.mjs work/before-efficiency
```

Самостоятелно повторение на before/after географията:

```sh
mkdir -p work/geography-before/tests/unit
git archive 4762b3e7a1bf2a2ab27af74c3033df27e0620530 server api tests/helpers | tar -x -C work/geography-before
cp tests/unit/weather-geography-stage2.test.mjs work/geography-before/tests/unit/
ln -sfn ../../node_modules work/geography-before/node_modules
node --test work/geography-before/tests/unit/weather-geography-stage2.test.mjs
# Очаквано exit 1: 25 failure; със същите labels текущата версия минава 34/34.
```
