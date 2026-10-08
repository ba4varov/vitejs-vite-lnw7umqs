# Meteo Puls — Етап 5: административен UI/UX

Работата е върху `main` след сливането на етап 4, commit `d46feddf36a7e66ba65c2df8099f68940af781b3`, в отделен branch `feat/admin-stage5`.

## Визуални подобрения

- Постоянна навигация на настолен екран и компактно меню на телефон. BG/EN, видим фокус, 44 px бутони и собствена светла/тъмна тема за административните native контроли.
- Шест еднакви статистически карти с локални SVG икони, ясни стойности, по-малки разстояния и подравняване. Използват се същите показатели и стойности.
- Начално табло с графика, компактно пояснение за проверения достъп и последните пет действия от наличната заявка `management-summary`. Не се добавят заявки за системна диагностика на таблото; подробните проверки остават в съществуващия раздел.
- Компактен журнал: име на действието, локална дата/час, резултат и съкратен засегнат UUID. Native `details/summary` разгъва идентификаторите, копирането, UTC timestamp, код/номер на записа и наличните предишен/нов план и причина. Нито един вид събитие не е премахнат.
- Профилите запазват отделните секции за основна информация, любими градове, управление и история. Free/Pro имат разпознаваеми badges; показва се и съществуващият subscription status. Администраторският UUID също е разгъваем и може да се копира.
- Историята показва първоначално 3 записа. Бутонът разгъва останалите вече заредени записи и запазва максимума 50; няма допълнителна заявка. Таблото показва най-много 5.
- Free/Pro диалогът запазва предишен/нов план, изрично потвърждение, native modal клавиатурен фокус, Escape, cancellation, защита от двойно изпълнение, request identifier при retry и всички съществуващи грешки/права.
- Block/restore остават disabled. Подробното обяснение е прибрано в достъпен информационен елемент.
- Статистическите времеви серии са хоризонтално превъртаеми, с удобни UTC дати и точни стойности при hover, focus и click/touch. Нулевите стойности остават достъпни, без постоянни излишни надписи. Другите диаграми запазват реалните категории и точните съотношения.
- Диагностиката има компактни карти за Supabase, административния API и Open-Meteo, време за отговор, последна проверка и последен успех в сесията. Всички пояснения за ограниченията остават видими. Няма периодичен мониторинг или твърдение „всичко работи“.

## Дати и журнал

`Intl.DateTimeFormat` използва езика BG/EN и действителната часова зона на браузъра. Показва се името ѝ, например `Europe/Sofia`. Съхранените UTC стойности не са променени и оригиналният timestamp е в подробностите. UTC дневните/месечните статистически колони остават UTC и не се преместват между дни.

Съществуващият SQL договор поддържа `success` и `not_found`. Те са визуално различими и преведени. Не е добавен измислен журнален резултат за отказ; сървърните откази и обработката им остават непроменени.

## Проверки

| Команда | Резултат |
| --- | --- |
| `npm test` | PASS — всички 24 test-file резултата на съществуващия Node runner |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; остава съществуващото предупреждение за Vercel insights script без `type="module"` |
| `npm run test:admin:sql` | PASS — действителни disposable PostgreSQL/PostgREST, JWT, изолация, fail-closed журнал, Free/Pro, replay и конкурентни retries |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:admin:browser -- --workers=2` | PASS — 85/85, финален пълен прогон за 3.3 минути |

Регресионните проверки запазват търсене, филтри, странициране, favorites, правата/грешките, Free→Pro→Free, двойно натискане, cancellation, повторен request identifier и точния брой три журнализирани четения на профил. Допълнителните проверки покриват UUID copy, клавиатурно разгъване на журнала, 3→8→3 история без допълнителни заявки и реално преобразуване на часове в `Europe/Sofia` и `America/New_York`.

## Действителни screenshots преди/след

112 снимки преди и 112 след: 7 изгледа × 4 ширини × 2 езика × 2 теми. Изгледи: табло, потребител с favorites/управление/история, Free/Pro диалог, журнал, статистики, системно състояние и администраторски профил. Ширини: 320, 390, 768 и 1440 px. Проверена е липсата на overflow на цялата страница във всеки вариант.

Преди: отделен checkout на горния `main` commit. След: branch с редизайна. Еднакви изолирани fixtures и истински Chromium; CSS transitions в редизайна са изключени при заснемане на screenshots. Това са реални снимки на браузърния интерфейс с mocked API/Auth данни, **не Production тест**. Не са използвани реални потребители.

| Изглед | Преди | След |
| --- | --- | --- |
| Табло, 1440 EN dark | [PNG](admin-stage5-screenshots/before/dashboard-1440-en-dark.png) | [PNG](admin-stage5-screenshots/after/dashboard-1440-en-dark.png) |
| Табло, 320 BG light | [PNG](admin-stage5-screenshots/before/dashboard-320-bg-light.png) | [PNG](admin-stage5-screenshots/after/dashboard-320-bg-light.png) |
| Потребител, 390 BG light | [PNG](admin-stage5-screenshots/before/users-390-bg-light.png) | [PNG](admin-stage5-screenshots/after/users-390-bg-light.png) |
| Free/Pro, 390 EN dark | [PNG](admin-stage5-screenshots/before/confirm-390-en-dark.png) | [PNG](admin-stage5-screenshots/after/confirm-390-en-dark.png) |
| Журнал, 1440 BG light | [PNG](admin-stage5-screenshots/before/audit-1440-bg-light.png) | [PNG](admin-stage5-screenshots/after/audit-1440-bg-light.png) |
| Статистики, 320 EN dark | [PNG](admin-stage5-screenshots/before/statistics-320-en-dark.png) | [PNG](admin-stage5-screenshots/after/statistics-320-en-dark.png) |
| Система, 768 BG light | [PNG](admin-stage5-screenshots/before/system-768-bg-light.png) | [PNG](admin-stage5-screenshots/after/system-768-bg-light.png) |

Пълната матрица е в [screenshots](admin-stage5-screenshots/). Историческите снимки от предишните етапи не са подменяни; регресионните им актуални снимки са временни артефакти в `work/`.

## Запазени граници

Няма промени в `api/`, `server/`, `supabase/`, SQL миграции, `admin-client`, удостоверяване, OAuth, сесии, публичния UI, метеорологичните функции, чатбота, любимите градове или dependencies. Съществуващите пет API endpoints остават същите. Няма нови външни услуги, ръчни Production операции, реални промени на акаунти или SQL извън disposable тестовите контейнери.

SQL тестът използва минимална Auth схема и реални PostgreSQL/PostgREST. Пълният Supabase GoTrue и deployed Vercel API не са упражнени. Няма автоматично сливане на PR или ръчно deployment.
