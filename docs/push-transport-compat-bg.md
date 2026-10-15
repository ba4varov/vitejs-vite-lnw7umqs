# Изолиран HTTPS compatibility тест

Това е тестов механизъм, без Production интеграция. `sendPinned` и всички Supabase файлове са непроменени. Няма достъп до реални абонаменти, SQL, Secrets, VAPID или Note 13 Pro.

## Възпроизводима среда

Workflow: `.github/workflows/push-transport-compat.yml`, включително за draft PR. Ubuntu 24.04, Node 24.14.0 и отделен официален контейнер Deno 2.1.4 само за подготовка на npm cache. Версията на cache preparer се проверява чрез `--version`; той не изпълнява експеримента. Самият експеримент се изпълнява единствено в:

```
supabase/edge-runtime:v1.76.2@sha256:edd22bef4477b900d5c300e287ce9b18bff9b81a0291bee14ee0b7c7b71a2899
```

Runner независимо изтегля release tag `supabase/edge-runtime:v1.76.2` и изисква неговият image ID да съвпада с digest-pinned образа. Записва image ID, RepoDigests, CLI output и `Deno.version` от действителния runtime. Образът отчита generic Cargo версия `edge-runtime 0.1.0` и `deno 2.1.4`; този CLI текст самостоятелно не удостоверява release версията. Първата runtime подготовка спря точно на тази разлика, преди пробите. Липсващ образ, несъвпадащ tag/digest, неработещ cache или runtime са неуспех на възпроизвеждането; няма замяна с обикновен Deno. GitHub-hosted runner предоставя Docker.

## Мрежа и синтетични данни

Edge контейнерът е `--network none`; Node TLS fixture споделя неговия network namespace. Няма публикувани портове, външен DNS или достъп до Интернет по време на пробите. Зависимостите/образите се изтеглят предварително.

Тестовият Deno config изисква `nodeModulesDir: none`, за да запълни глобалния offline npm cache независимо от Node инсталацията на runner. Само Node референтният контейнер монтира `node_modules`; Edge използва подготвения Deno cache. Cache се създава със съответстващия Deno 2.1.4; първоначалната подготовка с 2.5.6 не позволи offline bootstrap. В `work/` се създава тестово v4 представяне на съществуващия lock със същите npm версии/integrities, без промяна на Production lock.

Един локален CA подписва сертификат за `push.test.invalid` и redirect името. `wrong.test.invalid` не е в сертификата. Избраният адрес е 127.0.0.1, но hostname е свързан чрез `/etc/hosts` с 127.0.0.2, където втори TLS listener има същия валиден сертификат. Redirect target е 127.0.0.3. Тези loopback адреси са само fixtures; това не разрешава private endpoints в Production.

Генерират се временни синтетични VAPID/subscriber ключове и payload. VAPID private key не се записва. TLS leaf private key и синтетичната подписана заявка се монтират само за теста и се изтриват при cleanup. Artifact съдържа единствено версии, статуси, фиксирани категории, броячи, времена и булеви сравнения — без ключове, Authorization или raw provider response.

## Проби

Първо оригиналният `web-push@3.6.7.sendNotification` в Node изпраща локално чрез стандартен HTTPS Agent към избрания IP. За точно сравнение се replay-ват същите еднократно генерирани `generateRequestDetails`; независимо генериране би променило salt/ephemeral key/ciphertext.

В Edge се проверяват: Node HTTPS с lookup; HTTPS Agent с lookup; стандартен sendNotification с Agent; HTTPS към числов IP с servername; fetch към hostname (положителен контрол); fetch с lookup опция; fetch към IP с Host; fetch с TCP transport в createHttpClient. Не се подменят runtime функции и не се пише собствен HTTP/TLS транспорт.

Fixture сравнява exact body bytes, стойностите на всички библиотечни HTTP headers, метода/path, Host, точно един Content-Length и липса на Transfer-Encoding; записва само булев резултат. Header casing/order и добавени стандартни транспортни headers не се приемат за byte identity на целия HTTP stream. Проверява се оригиналното SNI.

Следват независими fetch контроли: грешно TLS име (нула HTTP заявки), 307 към друг IP (нула връзки към target), HTTP 400, body над 1024 bytes, body stall (300 ms) и липсващи headers (1200 ms wall deadline). Няма retry. Ако callback достави chunk над лимита, той не се натрупва; лимитът не обещава контрол над вътрешните буфери на runtime.

Проба се счита за pinning кандидат само при 201 от избрания IP, нула заявки към DNS примамката и успешно wire/SNI сравнение. Неуспешен TLS handshake не е доказателство за работещ pinning. Успешен hostname fetch към примамката също не е такова доказателство.

## Тълкуване

`complete: true` означава, че средата и контролите са проверени, а не че е намерен безопасен транспорт. `no_safe_standard_transport` означава, че никой от проверените варианти не е преминал дори необходимата IP/TLS/wire проверка. Това прекратява тази посока за v1.76.2; не е доказателство за всички бъдещи библиотеки/runtime версии.

Ако се появи pinning кандидат, резултатът е `further_validation_required`: нужни са всички adversarial проверки върху конкретния кандидат, включително еднократните операторски gates, преди да се предложи интеграция. Стандартният sendNotification допълнително не ограничава натрупването на response body. Този PR не разрешава реален Push тест или deployment.

## Изпълнение

```
npm ci --ignore-scripts --no-audit --no-fund
# Подготви cache с Deno 2.1.4 и тестовия v4 lock, както е записано в workflow.
node scripts/test-push-transport-compat.mjs
```

Резултатът е `work/transport-compat-report.json` и Actions artifact `push-https-edge-v1.76.2-evidence`. Към момента на първоначалния commit резултатът още не е установен; докладът от реалното Actions изпълнение е източникът на доказателство.
