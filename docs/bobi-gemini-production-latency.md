# Боби: Gemini Production latency

## Установена причина

Production наблюдението показва discovery (`GET /models`), generation
(`POST ...:generateContent`), `timeout`, след това `source: local`, при общо
около 5,9 секунди. Предишният клиент задължително правеше discovery при cold
start, дори с `GEMINI_MODEL`, и използваше един 5000 ms AbortSignal за discovery,
generation и 404 retry. Така generation получаваше само остатъка от петте секунди.
Тези записи доказват изчерпан бюджет, а не невалиден API ключ. Без измервания
по етапи не може да се определи точно колко е отнело всяко Google извикване.

## Нов път и ограничен бюджет

- Конфигуриран versioned stable text модел се нормализира (`models/` е допустим)
  и проверява локално: `gemini-<version>-flash`, `flash-lite` или `pro`, с
  незадължителен трицифрен revision suffix. Preview/image/audio/live/embedding,
  URL адреси и произволни имена не се изпращат. Няма речник с налични версии;
  Google проверява действителната наличност чрез самото `generateContent`.
- При такъв `GEMINI_MODEL` първата заявка е директно POST, без GET. Успешният
  модел се кешира в топлия instance. Без настройка се открива стабилен Flash
  с декларирана поддръжка на `generateContent`, както досега.
- Само HTTP 404 изчиства кеша и разрешава еднократно discovery, което изключва
  липсващия модел и избира съвместим Flash. Следва най-много един повторен POST.
  Няма retry при други HTTP грешки, мрежова грешка или timeout.
- Discovery има до **1500 ms**, generation до **6500 ms на опит**, цялото AI
  разбиране до **8000 ms**, включително response JSON и 404 recovery. Retry
  не рестартира общия срок. При timeout реалната fetch заявка се прекъсва;
  чакането също е ограничено, дори ако transport/body не приключи коректно.
  Таймерите и listener-ите се освобождават при приключване.

6500 ms дава на директната generation 30% повече време от стария общ 5000 ms
срок и премахва конкуренцията с discovery. Ограничението 1500 ms не позволява
метаданните да поглъщат бюджета; при бавен discovery се преминава бързо към
локалния parser. 8000 ms е твърд AI таван за cold start или 404 recovery, а не
безкрайно удължаване. Това е начална ограничена политика, не извод за Production
percentiles от един запис. Новите измервания позволяват последваща оценка.

Нормален конфигуриран модел прави **1 HTTP заявка**, при 404 — до **3**.
Без настройка са до **2**, при 404 — до **4**, както преди. Запазени са 20 AI
разбирания и 120 валидни chat заявки на минута за instance, token лимитът и
локалният fallback. Това не е глобална разпределена квота. Open-Meteo остава
единствен източник на метеорологични стойности. Неговите отделни 15 s fetch
срокове не са част от AI тавана: цялата chat заявка може да отнеме повече от 8 s.

## Диагностика и класификация

`[weather-chat:gemini-stage]` съдържа `phase: discovery | generation`,
`durationMs`, `code` и HTTP error `status` (null иначе), плюс същия случаен
`requestId` като `gemini_invoked`, `gemini_valid` и окончателния `decision`.
Продължителностите включват четенето на JSON и използват monotonic clock.
Логовете не съдържат моделни имена, Google error prose, въпроси, градове,
координати, API ключове или лични данни.

HTTP 401 → `authentication`, 403 → `permission`, 429 → `quota`, окончателен 404
или липса на заместник → `model_unavailable`. Останалите HTTP грешки запазват
статуса и се отчитат като `upstream_http`/`discovery_failed`. HTTP 400 не се
обявява автоматично за грешен ключ. Мрежова грешка и timeout са отделни случаи;
timeout никога не се представя като невалиден API ключ. Валиден transport JSON
още не означава валидно разбиране: `gemini_valid` се записва след семантичната
валидация, а `decision.source` показва кой interpreter е използван накрая.

## Проверка и Production граница

Тестовете с контролиран часовник проверяват 6 s директна generation и 1 s
discovery + 6 s generation (успешни), прекъсване на бавните етапи, общия 8 s
таван при 404 recovery, блокирали response bodies, кеш, HTTP грешки и мрежови
грешки. Тестове през реалния handler проверяват Gemini отговор, локален fallback,
корелацията на диагностиката и Open-Meteo като източник на стойностите.

Промяната премахва установения кодов път „задължителен discovery изяжда общия
5 s срок“. Тя не гарантира успешен Google отговор при всякаква латентност.
Реално Production потвърждение изисква deployment и нови Vercel записи:
конфигуриран модел → само generation → `gemini_valid` → `source: gemini`.
Няма извършен deployment, промяна на secrets или live Google извикване като
част от тази проверка. API ключът остава само на сървъра; дизайнът е непроменен.

Проверено на branch-а към `main` след PR #102:

- `npm run build` — успешно (TypeScript + Vite).
- `npm run lint` — успешно; само двете съществуващи `no-unsafe-finally`
  предупреждения в `scripts/push-node-operator.mjs:68–69`.
- `npm test` — 1461 успешни, 0 неуспешни, 1 пропуснат native Deno TLS тест.
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test tests/weather-chat-clarification.spec.ts --workers=1`
  — 4/4 успешни BG/EN браузърни проверки.
