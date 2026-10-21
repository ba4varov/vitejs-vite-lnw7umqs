# Боби — възпроизводима тестова основа, етап 1

Проверена база: `main` след #108, `addff27618515852eb259f6a6d955022eada44bd`.
Историческа база за request economy: `7d89cbd437392415f71cd42ed834453ad1704666`.
Няма промени в production код, SQL, настройки, ключове, billing или дизайн.
Всички API отговори са симулирани; няма реални AI заявки.

## Поправка на измерването

Оригиналният скрипт възпроизвежда **54 pass / 8 fail**. Gemini envelope-ът му
няма `finishReason: STOP`, затова актуалният строг parser го отхвърля и се
изпълнява fallback. Това е дефект на фикстурата, не доказателство за parser
регресия. Отделни contract тестове доказват приемането на STOP и отхвърлянето
на липсващ STOP, MAX_TOKENS и невалидна семантична схема. Успешен fallback
не се приема за успешно разчетена Gemini фикстура.

С поправен envelope: **62 pass / 0 fail, 62 → 32 generate извиквания, 48,4%**.
По категории стойностите от [първоначалния отчет](bobi-gemini-request-economy.md)
се възпроизвеждат без промяна на неговите labels. Това е брой извиквания на
симулирания `geminiClient.generate`, не реални HTTP POST или production accuracy.

Сравнението изпълнява двата истински handler-а с еднакви текст, език, контекст,
часовник и копия на upstream отговорите. Labels идват от ръчно означения corpus,
а не от изхода на някоя версия. И двете версии се проверяват независимо.
Броячите включват всеки изпълнен сценарий и извикване дори при semantic failure;
първата грешка не пропуска втората версия. JSON summary включва категория,
страна, текст и грешка за всеки неуспех; Node връща ненулев exit status.
Текстовете са само синтетични, не production съобщения.

## Постоянен набор и граници

`tests/unit/bobi-regression.test.mjs`: **70 BG/EN входа × 2 режима**, плюс 4
Gemini contract теста. Съдържа оригиналните 62 случая (обикновени въпроси,
свободен словоред, typos, контекст и пътувания), плюс по 4 на език: еднакви
имена на градове, две дестинации, противоречиви дни и утре сутрин.

- `oracle`: конфигуриран тестов Gemini с валидна ръчно зададена интерпретация;
  проверява local/AI маршрута и приемането на отговора, без жив модел.
- `fallback`: липсващ AI ключ и generate trap; проверява действителното локално
  разбиране на същия вход спрямо същите желани labels.
- Всеки случай проверява intent, дата, `timeScope` (включително
  `tomorrow_morning`), clarification/missing, координати в потвърдения контекст
  и всички weather заявки, както и броя Gemini извиквания.
- При clarification се проверява semantic snapshot в pending state;
  envelope-ът може да носи `intent=unclear`. Не се допуска weather заявка или
  потвърден контекст с координати преди уточняване.
- Всички field assertions се събират, вместо първата да скрие останалите.
  Harness-ът отхвърля непознат upstream host и никога не делегира към реален fetch.

При oracle всичките **70** случая минават. При fallback **60** минават,
**10** остават известни локални дефекти. Contract тестовете са **4/4**.
Това не измерва способността на Gemini да предвиди labels. Наборът е малък,
синтетичен и не покрива всички идиоми, часови интервали или географски двусмислия.
Supabase/transport/quota симулациите остават в съществуващите gemini unit suites.

## Оставащ тестов дълг

Независимите очаквания са запазени. Известните грешки са видими като Node TODO,
а `BOBI_STRICT_LOCAL=1` ги прави обикновени неуспешни тестове. Те не са skip:
всеки път изпълняват handler-а и всички проверки. При поправен дефект тестът
изисква премахване на debt entry; нов непознат дефект е блокиращ по подразбиране.

| Corpus index | Вход / проблем без Gemini | Желано поведение |
| --- | --- | --- |
| 18–21 | BG: ваали, облеак, разхдока, грдауса | rain/clothing/walk/temperature, правилното място и утре |
| 49, 51, 52 | EN: rian, wlak, tempreature | rain/walk/temperature, правилното място и утре |
| 55 | EN: extra layer there tomorrow с контекст → unrelated | clothing с контекстните координати |
| 64, 68 | BG/EN: утре + вчера → прогноза за вчера | date clarification, без weather заявка |

Две дестинации и еднакви имена на градове искат location clarification и в
двата режима. Това са постоянни успешни защити. По-ранният диагностичен пробег
показа две допълнителни отклонения само за envelope intent; те бяха дефект в
тестовата проверка на clarification, а не в локалния parser.

## Възпроизвеждане и блокиращи проверки

От root на repo, с инсталирани locked npm dependencies:

```sh
mkdir -p work/before-efficiency
git archive 7d89cbd437392415f71cd42ed834453ad1704666 server api tests/helpers | tar -x -C work/before-efficiency
ln -sfn ../../node_modules work/before-efficiency/node_modules
node scripts/compare-bobi-gemini-usage.mjs work/before-efficiency
node --test tests/unit/bobi-regression.test.mjs
BOBI_STRICT_LOCAL=1 node --test tests/unit/bobi-regression.test.mjs
npm run build
npm run lint
npm test
```

Строгата команда засега очаквано връща exit 1: **134 pass / 10 fail**.
Обичайната връща exit 0: **134 pass / 10 TODO / 0 fail**. Не представяйте TODO
като успешни локални интерпретации. При бъдещо разширяване на локалното разбиране
строгият режим трябва да е release gate: отстранявайте debt entries след
реална production поправка, без отслабване на labels или валидаторите.

Всяка бъдеща промяна трябва да бъде блокирана от ново отклонение в 70-те oracle
случая, вече успешните 60 fallback случая, contract тестовете, сравнение 62/32,
както и от съществуващите weather-location/evidence/clarification,
gemini-production-handler/client/quota/latency тестове. При умишлена промяна в
маршрута преглеждайте очакваните Gemini counts отделно от correctness labels;
намаление на броя не оправдава грешни координати, дата или пропуснато уточняване.
Няма промяна на GitHub branch protection или автоматично сливане.

## Проверки на този PR

- Build: успешен.
- Lint: успешен; двете съществуващи no-unsafe-finally предупреждения в push-node-operator.
- Пълният `npm test`: **2016 pass / 0 fail / 10 TODO / 1 skip**, 2027 общо.
  Skip е optional native Deno TLS без Deno runtime.
- Сравнение: 62/62, 62 → 32, 0 failures.
- Strict local: 10 известни дефекта; production поправки са извън този PR.
