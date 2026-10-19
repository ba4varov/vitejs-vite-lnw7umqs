# Боби: ограничена оптимизация на Gemini latency

## Критичен път и Production доказателства

База: `main` commit `a5899090120c361ec1150d884c85c81fa1d29132` (PR #107).
Production потвърди reservation 1533 ms / HTTP 200 / reserved, следвана от
Gemini timeout след 6468 ms и коректен local fallback. При общ срок 8000 ms
остатъкът след reservation е 6467 ms: общият срок изтича около 33 ms преди
самостоятелния generation лимит 6500 ms. Разликите от няколко ms са съвместими
с реалното планиране и закръгляне; това не измерва вътрешното време на Google.
Няма завършен payload и JSON диагностиката правилно не се изпълнява.

Последователност за AI маршрута:

1. Валидация, local routing и евентуална независима проверка на изрично място.
2. Общ AI deadline започва **преди** Supabase reservation. RPC има собствен
   лимит 3000 ms за headers и body; неуспехът спира Google изцяло.
3. Конфигурираният `gemini-3.8-flash` се проверява локално, без discovery.
   Само ако няма конфигуриран/кеширан модел, discovery е ограничено до 1500 ms
   и също използва остатъка от общия срок.
4. Една generation заявка: headers, body и декодиране. При успех следват строг
   JSON parser, `finishReason: STOP`, семантична валидация и location evidence.
5. При неуспех — съществуващият local fallback. После геокодиране/Open-Meteo и
   детерминистичен отговор. Координатите винаги остават в сървърното състояние.

AI deadline не е общ срок за целия HTTP handler: геокодирането и Open-Meteo
имат отделни, непроменени срокове. Еднозначните локални въпроси и quick actions
заобикалят Supabase/Gemini. Няма изчакване за изкуствено запълване на бюджета.

## Избран компромис за сроковете

Общ срок **8500 ms**, generation **7000 ms**. Ефективното време за generation е:

```
min(7000, 8500 - reservation - optional_discovery - preparation_overhead)
```

Увеличението на максималното AI чакане е 500 ms (6.25%), а не нов пълен срок
след reservation. Reservation/discovery лимитите са непроменени. Headers и body
остават в същия deadline; частичен отговор никога не се показва.

Аналитични алтернативи при reservation 1533 ms, без discovery:

| Политика: общо / generation | Ефективен generation срок | Оценка |
| --- | ---: | --- |
| 8000 / 6500 (база) | 6467 ms | Наблюдаваният timeout |
| 8000 / 7000 | 6467 ms | Само увеличаване на generation не помага на този случай |
| **8500 / 7000** | **6967 ms** | Допуска 6800 ms отговор с максимум +500 ms чакане |
| 9000 / 7500 | 7467 ms | До +1000 ms чакане; няма Production доказателство, че е нужно |

Това е ограничен начален компромис, не статистически доказан оптимум. Ако
Production отговорите остават над 6967 ms, тази промяна сама не ги спасява.
Значително по-дълго чакане, streaming на непълен JSON, паралелен Google опит и
преминаване към друг модел не са добавени.

Премахнат е старият еднократен 404 recovery. При 404 кешът се инвалидира за
бъдеща независима заявка, но текущото разбиране приключва без втори POST,
втора reservation или мълчалива смяна на модел. За невалиден конфигуриран модел
е нужна конфигурационна поправка; той вече не се прикрива с автоматичен retry.

## Prompt, контекст и схема

- System prompt: **3010 → 1972 UTF-8 bytes**, намаление 34.5%. Премахнати са
  повторените списъци с enum стойности (вече са в схемата) и излишни повторения.
  Запазени са правилата за BG/EN, печатни грешки, свободен словоред, недоверен
  текст, ограничения на темите, thunderstorm, city/date/intent независимост,
  двусмислие, qualifiers, pending clarification, topic reset и наследяване.
- AI контекстът вече не съдържа latitude/longitude и retry attempts. Запазени са
  city, intent, timeScope, targetDate, **целият previousQuestion**, pending message,
  understanding, missing и locationMode. Текущият въпрос и текстовите референции
  не се режат. Оригиналното валидирано сървърно състояние не се променя.
- Измерен пример с context + pending: **730 → 651 bytes**. При липса на контекст
  няма такова намаление. Реалните размери зависят от въпроса; това не са token
  измервания и не доказва определен процент по-ниска model latency.
- JSON схемата е **идентична** на базата: всички 10 required полета, enum-и,
  nullable полета и строгата семантична валидация са запазени. Премахването на
  derived полета би изисквало нов wire contract и проверка на точността; не е нужно
  за тази ограничена промяна. Budget остава **1024 tokens**.
- `gemini-3.8-flash`: **thinkingLevel: low**, без deprecated sampling параметри,
  без minimal. Настройките за останалите поддържани модели са непроменени.

## Симулации: доказани резултати

Изпълнение без мрежа и без истински credentials/AI заявки:

```sh
node scripts/measure-bobi-gemini-latency.mjs
```

Скриптът зарежда реалния клиент от фиксирания main commit и текущия клиент,
използва еднакви синтетични Supabase/Google отговори и виртуален ms часовник.
И двата клиента използват реалния, непроменен quota guard. Няма промяна в
симулираното време на Google между before/after. Пълният резултат е в
[bobi-gemini-latency-simulation.json](bobi-gemini-latency-simulation.json).

| Reservation / discovery / Gemini (headers + body) | База | Нов код |
| --- | --- | --- |
| 100 / 0 / 900 ms | успех 1000 ms | успех 1000 ms |
| 500 / 0 / 4000 ms | успех 4500 ms | успех 4500 ms |
| 1533 / 0 / 6000 ms | успех 7533 ms | успех 7533 ms |
| 1533 / 0 / 6800 ms | timeout 8000 ms | **успех 8333 ms** |
| 100 / 0 / 6800 ms | timeout 6600 ms | **успех 6900 ms** |
| 1533 / 0 / увиснал Gemini | timeout 8000 ms | timeout 8500 ms |
| 2800 / 0 / 5400 ms | timeout 8000 ms | **успех 8200 ms** |
| 3100 / — / — | quota_unavailable 3000 ms, 0 Google | същото |
| 100 / 0 / увиснал Gemini | timeout 6600 ms | timeout 7100 ms |
| 1533 / 1000 / 5800 ms | timeout 8000 ms | **успех 8333 ms** |
| 100 / 1600 / — | discovery timeout 1600 ms | същото, 0 generation |
| 1533 / 0 / 100 headers + 6700 body | timeout 8000 ms | **успех 8333 ms** |
| 100 headers + 1433 quota body / 0 / 6800 ms | timeout 8000 ms | **успех 8333 ms** |

Във всеки сценарий има една reservation и най-много една generation. Клиентските
регресии доказват липса на retry при HTTP/JSON/timeout грешки, включително 404.
Истинският serverless handler е изпълнен със същите симулирани времена: коректни
intent/date/selected coordinates при успех и fallback, няма JSON diagnostic при
незавършен Gemini, quota timeout приключва на 3000 ms. Ясният локален въпрос
приключва без симулирано изчакване, reservation или Google заявка. Open-Meteo в
тези тестове е фикстура с нулево забавяне — таблицата не измерва реален UI latency.

## Диагностика и Production хипотези

Generation stage логът добавя само числа/фиксиран enum:
`preparationMs` (от началото на AI операцията до generation), `availableMs`
(ефективен остатък), `totalDurationMs`, `timeoutSource: total|stage` при timeout.
Request ID остава генериран от сървъра. Няма въпроси, координати, payload-и,
моделни мисли, exception текст или нови лични данни в логовете.

**Доказано:** по-малък вход; идентична схема; запазени linguistic referents и
сървърни координати; работещи validators/location guards; еднократен Google опит;
ограничени deadline-и и fallback; успешен близък до границата отговор в избраните
синтетични сценарии. Бързите сценарии не получават изкуствено забавяне.

**Изисква Production проверка:** по-краткият prompt може да намали prefill/latency,
но не е измерена реална скорост на Google. Mocked language/typo/context corpus
проверява преноса на входа и обработката на независимо зададени интерпретации,
не способността на модела да ги предвиди. Няма доказателство за равна/по-добра
реална семантична точност или по-висок процент успех. Пазарни/платени benchmark-и
и реални AI заявки не са използвани.

След ръчен rollout сравнете metadata p50/p95 и timeout rate за сложни въпроси,
`preparationMs`, `availableMs`, `timeoutSource`, source=gemini/local и
invalid_structure/invalid_json. Проверете BG/EN, typos, qualifiers, topic reset и
context accuracy с одобрен тестов набор; не включвайте сурови въпроси в логове.
Ако p95/точността се влошат, prompt/deadline промените могат да се върнат без
миграция на quota схемата. Няма промяна по дизайна, billing или Open-Meteo.

## Изпълнени проверки

- `npm run build`: успешно; frontend asset hashes са непроменени.
- `npm run lint`: успешно; две съществуващи `no-unsafe-finally` предупреждения в
  `scripts/push-node-operator.mjs`.
- `npm test`: **1882 успешни, 0 неуспешни, 1 пропуснат** optional native Deno TLS.
  Включва language/typo/context corpus, JSON/STOP/structure checks, quota/cooldown,
  грешен град, 13 latency сценария и 6 изпълнения на реалния handler с mock clock.
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/weather-chat-clarification.spec.ts --workers=1 --reporter=line`:
  **4 успешни** BG/EN проверки на pending state и city/language resets.
- Offline before/after simulation script: успешно; идентична JSON схема,
  резултатите са записани в придружаващия JSON файл. Няма живи AI заявки.

Това не е ново пълно изпълнение на всички несвързани UI/SQL/Edge suites.
Известните ограничения от предишния PR не се представят като отстранени.
