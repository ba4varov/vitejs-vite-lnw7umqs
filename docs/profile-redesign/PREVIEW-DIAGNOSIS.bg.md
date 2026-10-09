# PR №62 — диагностика на стария интерфейс в Preview

## Извод и граници на проверката

Сигналът за стария профил на точния Preview адрес остава реален и не е опроверган от успешния build. Причината **не е установена**, защото средата не може да прочете Preview HTML или статичните файлове. Hosted проверката **не е успешна**.

На 09.10.2026 г., 12:48:44 Europe/Sofia, `curl` към `https://weather-git-redesign-profile-sections-ba4varov-projects.vercel.app/` връща `CONNECT tunnel failed, response 403`. Отговорът е от `envoy` proxy при CONNECT, преди HTTPS заявката да достигне Vercel. Това не е доказателство за Vercel Deployment Protection, дефект на сайта или потребителски HTTP 403. Мрежовата политика е `restricted/enforced` и Preview домейнът не е разрешен. Не са правени опити за заобикаляне на политиката.

## Commit, deployment и alias

При започване на диагностиката:

| Източник | Наблюдение |
| --- | --- |
| GitHub PR №62 | отворен, draft, branch `redesign/profile-sections`, head `e12e20d16a89d66ade6dba61e11213f673ff7bb2` |
| Локален branch след `git fetch origin redesign/profile-sections` | същият commit |
| GitHub status за този пълен SHA | Vercel `success`, inspector `https://vercel.com/ba4varov-projects/weather/4LRoC48aLPQcAuBayqFSBafYg4Zi` |
| Коментар от Vercel bot | същият inspector, Ready и посоченият branch Preview alias; `rootDirectory: null` в metadata на коментара |
| Реалният target на alias-а във Vercel | **непроверен**; няма достъп до Vercel управление/API или до Preview отговора |

GitHub свързва последния тогава commit с deployment и Preview линк. Това **не установява**, че домейнът реално доставя този deployment. Не е установено към кой commit действително сочи alias-ът. Новата Push поправка се публикува в същия branch/PR; текущият head е видим в PR.

## Доставени HTML, JavaScript и CSS

Няма получен Preview HTML, JS или CSS. Съответно остават непроверени:

- имената, съдържанието и SHA-256 на доставените файлове;
- наличието на `profile-dialog` и `profile-tabs` в **Vercel-доставения** JavaScript;
- наличието на правилата за 960 px и разделите в **Vercel-доставения** CSS;
- заглавките `Cache-Control`, `Age`, `ETag`, `x-vercel-cache`, `x-vercel-id` и евентуални HTTP redirects;
- дали стар HTML сочи стари hashed assets, дали alias-ът е грешен, или има кеш/друг deployment.

### Доказателства от локалния production build

Build от началния head `e12e20d` е записан в [baseline-assets.json](preview-diagnosis/baseline-assets.json). За използваната локална build конфигурация входните файлове са:

| Файл | SHA-256 |
| --- | --- |
| `assets/index-CzWllIKy.js` | `68a0a96b5be47fcccafbdedddb15c8c7cc94e2cb30f7cd887bd9ddc752d661cb` |
| `assets/index-d7g8Hij3.css` | `d750ec1c25370064e007c4ca6f0e51e4c589e1db031bbe078fe727144547909b` |

Имената и хешовете може да се различават при други `VITE_*` build настройки. За точна hosted съпоставка трябва build от същия commit, lockfile и същите публични build настройки или самите Vercel build artifacts. Различен hash сам по себе си не доказва грешен commit.

Новата регресия стартира `vite build` и `vite preview`, без dev server. Чете реалните HTTP JS/CSS отговори, сравнява SHA-256 с локалните build файлове, проверява маркерите и отваря профила с изолирана тестова сесия. Потвърдени са ширина 960 px, четири раздела и само един видим panel. Това доказва локалния compiled интерфейс, **не hosted Preview**.

Добавен е read-only инструмент за проверка след разрешаване на мрежата:

```sh
npm run build
node scripts/verify-profile-preview.mjs \
  https://weather-git-redesign-profile-sections-ba4varov-projects.vercel.app/ \
  dist work/preview-comparison.json
```

Инструментът използва `curl` с наследения proxy, не следва redirects, сравнява реалните входни JS/CSS файлове по път и SHA-256 и проверява маркерите на редизайна. При 403, login HTML, redirect, липсващи маркери или различни bytes записва `hostedVerified: false` и завършва с код 1. [Реалният резултат за Preview](preview-diagnosis/hosted-comparison.json) е `false`, с празен списък assets. Unit регресия доказва, че инструментът отхвърля стар JS и redirect към друг origin.

## Google OAuth и Supabase Auth

Прегледани са `src/google-oauth.js`, `src/auth-client.ts` и `src/AuthPanel.tsx`:

- Google OAuth задава `redirectTo = location.origin + '/?oauth=google'`. Няма фиксиран Production URL.
- Callback cleanup използва относителен `history.replaceState` и запазва текущия origin.
- Входът с имейл/парола публикува сесията и затваря диалога; не навигира към Production.
- Регистрацията, повторното потвърждение и reset използват текущия origin/path за callback.

Добавен е тест за Google callback с точния Preview origin. Самата OAuth логика не е променена.

**Непроверено:** Supabase Authentication → URL Configuration, Redirect URLs allowlist, Site URL и действителният redirect след реален Google/Supabase вход. Недопуснат Preview callback може да доведе до fallback към Site URL. Това е възможна конфигурационна причина, не установена диагноза. Не са използвани реални акаунти или променяни Auth настройки.

## PWA / Service Worker

Текущият `public/push-sw.js` няма `fetch` handler, precache или Cache API; не може да сервира стари JS/CSS от свой кеш. Регистрацията е на `/push-sw.js`, със scope `/` и `updateViaCache: 'none'`. Vercel конфигурацията задава `no-cache, no-store, must-revalidate` за worker скрипта. Worker-ът и notificationclick използват текущия origin. Production worker не може да контролира друг Preview origin.

Unit и Chromium регресиите проверяват текущия worker, root scope, празен Cache Storage и липса на автоматична заявка за разрешение. **Непроверено:** кой worker действително е инсталиран в браузъра на потребителя и какъв worker скрипт доставя Vercel в момента. По-стар или различен worker не е изключен като причина без тази проверка.

## Поправка на излишното Push предупреждение

Потвърден клиентски дефект: `unsavedInputs` отчита непразното `city.name`. След успешно `add(city)` градът вече е в `draft.cities`, но името остава в помощната форма. След успешен PATCH предпочитанията са чисти, а това поле продължава да показва незапазени промени.

`add` вече връща резултат. Формата за координати се нулира **само след валидно, успешно добавяне на нов град**. Предпочитанията остават чернова до успешното сървърно запазване. При невалиден/дублиран град, лимит или грешка при запис не се губят незапазени данни. Не са променени API, права, SQL, реални предпочитания или Push доставка/регистрация.

BG/EN регресиите проверяват добавяне → изчистване на формата → неуспешен запис със запазена чернова → успешен запис без предупреждение → дублирано добавяне със запазен input → Escape с реална чернова и чисто затваряне без излишен диалог.

## Точни необходими действия за hosted диагностика

1. Разрешете в cloud network конфигурацията точния Preview домейн. За read-only Vercel управление може да е нужен отделен достъп/връзка към Vercel; не е конфигуриран тук.
2. В Vercel → project `weather` → Deployments намерете Preview deployment за **текущия пълен head SHA на PR №62**. Проверете Git repo `ba4varov/vitejs-vite-lnw7umqs`, branch `redesign/profile-sections`, source SHA, Environment **Preview** и Deployment URL. Сравнете директния deployment URL с branch alias-а, преди и след вход.
3. В Domains/Aliases на този deployment проверете дали `weather-git-redesign-profile-sections-ba4varov-projects.vercel.app` сочи към него. Ако директният deployment е нов, а alias-ът стар, насочете **само този Preview alias** към правилния deployment. Не използвайте Promote to Production и не променяйте Production domains.
4. Проверете Framework Preset **Vite**, Root Directory за repo root, Build Command **npm run build**, Output Directory **dist**, Ignored Build Step и Preview build environment. Ако deployment artifacts не съдържат маркерите, направете Redeploy на правилния SHA в **Preview**, с изключено използване на съществуващия build cache. Ready не е финална проверка.
5. От достъпна среда свалете HTML и входните JS/CSS както от директния deployment URL, така и от alias-а. Запишете status/cache заглавките, asset URLs и SHA-256; съпоставете с artifacts от същия Vercel deployment или еквивалентен build. Изпълнете инструмента по-горе.
6. В браузъра сравнете без вход и след вход; записвайте само `location.origin + location.pathname`, без OAuth code, токени или лични данни. Ако origin стане Production, в Supabase Authentication → URL Configuration проверете дали exact callback `https://weather-git-redesign-profile-sections-ba4varov-projects.vercel.app/?oauth=google` и нужните имейл callback адреси са разрешени. Добавяне на Preview allowlist трябва да е одобрено; не променяйте Production Site URL или Google provider callback към Supabase самоволно.
7. В DevTools → Network изключете browser cache и сравнете първоначалния document и assets. В Application → Service Workers проверете script URL/scope и Cache Storage. Първо използвайте Bypass for network или нов browser context. Ако се докаже стар worker, unregister само за Preview origin и презаредете; не изчиствайте auth storage или Push subscriptions като обща „поправка“.
8. Финално отворете профила на alias-а и директния deployment, потвърдете 960 px/четири раздела на desktop и compact tabs на mobile, и документирайте фактическия origin след вход. Едва тогава hosted проверката може да бъде отбелязана като успешна.

## Проверки и статус

| Проверка | Резултат |
| --- | --- |
| `npm test` | 258/258 успешни |
| `npm run lint` | успешен |
| `npm run typecheck` | успешен |
| `npm run build` | успешен |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:profile:build -- --workers=3` | 49/49 успешни срещу локално сервирания compiled build |
| Hosted asset comparison | неуспешен/блокиран: proxy CONNECT HTTP 403; няма доставени assets за сравнение |

Логовете са приложени в `preview-diagnosis/`. Пълната 277-test dev-server регресия от първоначалния редизайн не е представяна като повторно изпълнена в тази диагностика; тук са изпълнени фокусираните profile/Push/compiled bundle проверки. PR №62 остава отворен и draft, без сливане. Production конфигурация не е променяна. Публикуването в същия branch задейства само обичайния Preview deployment.
