# Google вход за Meteo Puls

## Архитектура

Съществуващият `auth-client.ts` използва Supabase Auth REST API, `meteo-pulse-auth` в localStorage, обновяване с refresh token, Web Locks и синхронизация между табове. Запазваме този единствен източник на сесия. Официалният `@supabase/auth-js` се зарежда само за Google OAuth: `signInWithOAuth` и `exchangeCodeForSession`, с PKCE, `persistSession: true` с ограничен storage adapter (съхранява единствено PKCE verifier, игнорира SDK session reads/writes), `autoRefreshToken: false`, `detectSessionInUrl: false`. SDK няма постоянна сесия и не обновява токени; резултатът влиза през `saveSession` в общия клиент.

PKCE verifier е в sessionStorage и изисква завършване в същия браузърен таб. След callback или отказ се изтрива. Кодът и грешките се премахват от адреса преди обмена. Няма implicit Google токени в URL fragment. Съществуващите email confirmation/recovery fragments запазват поведението си. Google callback връща началната страница със затворен профил. Невалиден/изтекъл callback, отказ, мрежова грешка или ръчно връщане след прекъсване показват BG/EN съобщение и възможност за нов опит. Опитът изтича след 10 минути. Затварянето на таба прекратява опита.

## Google Cloud Console

1. Изберете предназначения за Meteo Puls Google Cloud проект. В **Google Auth Platform → Branding** попълнете име Meteo Puls, support email, developer contact, начална страница `https://ba4varov-wheater.vercel.app/`, реалните адреси за Privacy Policy и Terms of Service. Добавете собствените потвърдени домейни, когато е приложимо; не заявявайте собственост върху общия `vercel.app` домейн.
2. В **Audience** изберете External за публичен продукт. Докато статусът е Testing, добавете тестовите Google акаунти. Публикуването на consent screen е отделна административна стъпка след проверките.
3. В **Data Access** използвайте само `openid`, `email`, `profile`. Не са необходими Gmail/Drive права или offline Google достъп.
4. В **Clients → Create client → Web application** добавете **Authorized JavaScript origins**: `https://ba4varov-wheater.vercel.app` и `http://localhost:5173` (без краен slash).
5. В **Authorized redirect URIs** добавете точния **Callback URL (for OAuth)** от Supabase Google provider. При стандартен Supabase домейн той е `https://<PROJECT_REF>.supabase.co/auth/v1/callback`. Заменете `<PROJECT_REF>` с реалния project ref. При custom Auth domain използвайте точно адреса, показан в Dashboard. Това е Google → Supabase callback, а не frontend адресът.
6. Client ID и Client Secret се въвеждат само в Supabase Dashboard. Не ги изпращайте в Codex и не ги записвайте във frontend или GitHub.

## Supabase Dashboard

1. **Authentication → Sign In / Providers → Google**: включете Google, въведете Web Client ID и Client Secret. Запазете проверката за nonce включена. Не включвайте разрешение за потребители без email.
2. **Authentication → URL Configuration → Site URL**: `https://ba4varov-wheater.vercel.app/`.
3. Добавете точните **Redirect URLs** за Supabase → Meteo Puls:
   - `https://ba4varov-wheater.vercel.app/?oauth=google`
   - `http://localhost:5173/?oauth=google`
   - При одобрен preview добавете `https://<EXACT_PREVIEW_HOST>/?oauth=google`; не добавяйте общ wildcard за всички Vercel домейни.
   Съществуващите разрешения за email confirmation/recovery се запазват. Ако local Vite избере друг порт, разрешете точния адрес за него изрично.
4. Supabase управлява безопасното автоматично свързване на Google идентичност към съществуващ потребител с потвърден съвпадащ email. Приложението не търси и не обединява акаунти по email, не извиква admin APIs и не включва manual linking. При конфликт използвайте съществуващия вход и административните инструменти на Supabase след проверка на собствеността.
5. Съществуващият `on_auth_user_created` trigger създава стандартен профил и `free` абонамент за нов `auth.users` запис. При свързана идентичност user ID остава същият: профил, план, любими места и default place не се презаписват. Не е нужна SQL миграция или промяна на RLS.

## Включване и проверки

`VITE_GOOGLE_AUTH_ENABLED=false` е безопасната настройка по подразбиране. Липсваща променлива също скрива бутона. След настройка на provider и redirect адресите използвайте `VITE_GOOGLE_AUTH_ENABLED=true` в одобрена тестова среда. Флагът се вгражда от Vite при build; последващо Production включване изисква отделно публикуване. Този PR не публикува приложение и не променя Dashboard.

Google входът не изисква Turnstile challenge: той използва Supabase provider redirect поток. Съществуващите password signup/login/recovery/resend операции продължават да изискват актуален Turnstile токен. Refresh и logout остават в общия клиент.

Автоматизираните mock тестове проверяват callback, отказ/грешка/прекъсване, повторен опит, изчистване на URL/verifier и запазване на идентичността; съществуващите тестове покриват refresh, logout, състезания и синхронизация между табове. Изпълнете `npm test`, `npm run lint`, `npm run build`.

След конфигурация проверете реално: нов Google потребител с точно един профил и free абонамент; повторен вход; съществуващ потвърден password акаунт със същия email и запазен user ID/любими/default place/план; отказ в Google; прекъсване и повторен опит; logout и друг таб; BG/EN и светла/тъмна тема на мобилен и desktop екран. Проверете отделно password login/signup/reset и Turnstile. Mock тестовете не доказват реалната Google/Supabase конфигурация. Не са необходими service-role или Google secret ключове за frontend тестовете.
