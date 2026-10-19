// Synthetic, independently labelled comparison corpus. No production messages.
const destinations = {
  bg: { name: 'Гела', latitude: 41.65, longitude: 24.5667 },
  en: { name: 'Lake District', latitude: 54.5, longitude: -3.1667 }
}
const topics = {
  bg: [['rain', 'Ще вали ли'], ['clothing', 'Как да се облека'], ['walk', 'Подходящо ли е за разходка'], ['temperature', 'Колко градуса ще бъде'], ['wind', 'Какъв ще е вятърът'], ['thunderstorm', 'Ще има ли гръмотевици']],
  en: [['rain', 'Will it rain'], ['clothing', 'What should I wear'], ['walk', 'Can I go for a walk'], ['temperature', 'What will the temperature be'], ['wind', 'How windy will it be'], ['thunderstorm', 'Will there be thunderstorms']]
}
export function efficiencyCorpus() {
  const cases = []
  const add = (lang, category, message, intent, local, extra = {}) => cases.push({ lang, category, message, intent, local, place: destinations[lang], timeScope: 'tomorrow', targetDate: '2026-10-09', ...extra })
  for (const lang of ['bg', 'en']) {
    const bg = lang === 'bg', place = destinations[lang]
    for (const [intent, topic] of topics[lang]) {
      add(lang, 'simple', bg ? `${topic} утре в ${place.name}?` : `${topic} tomorrow in ${place.name}?`, intent, true)
      add(lang, 'word_order', bg ? `Утре в ${place.name} ${topic.toLowerCase()}?` : `Tomorrow in ${place.name} ${topic.toLowerCase()}?`, intent, true)
      add(lang, 'natural', bg ? `Моля обясни ми ${topic.toLowerCase()} утре в ${place.name}?` : `Could you tell me ${topic.toLowerCase()} tomorrow in ${place.name}?`, intent, false)
    }
    for (const [intent, phrase] of bg
      ? [['rain', 'Ще ваали ли'], ['clothing', 'Как да се облеак'], ['walk', 'Подходящо ли е за разхдока'], ['temperature', 'Колко грдауса ще е']]
      : [['rain', 'Will it rian'], ['clothing', 'What shuold I wear'], ['walk', 'Can I go for a wlak'], ['temperature', 'What will the tempreature be']]) add(lang, 'typo', bg ? `${phrase} утре в ${place.name}?` : `${phrase} tomorrow in ${place.name}?`, intent, false)
    const context = { city: place.name, latitude: place.latitude, longitude: place.longitude, intent: 'rain', timeScope: 'tomorrow', targetDate: '2026-10-09', previousQuestion: 'Synthetic previous question' }
    add(lang, 'context', bg ? 'А вятърът?' : 'And wind?', 'wind', true, { context, citySource: 'context', timeSource: 'context' })
    add(lang, 'context', bg ? 'А утре?' : 'And tomorrow?', 'rain', true, { context, citySource: 'context', timeSource: 'explicit' })
    add(lang, 'context_complex', bg ? 'А там ще ми трябва ли връхна дреха утре?' : 'Will I need an extra layer there tomorrow?', 'clothing', false, { context, citySource: 'context' })
    for (const travel of bg ? ['Отивам до', 'Пътувам към', 'Заминавам за', 'Ще отида до'] : ["I am going to", "I am travelling towards", "I am headed for", "I am on my way to"]) add(lang, 'travel', bg ? `${travel} ${place.name} утре как да се облека?` : `${travel} ${place.name} tomorrow what should I wear?`, 'clothing', false)
    add(lang, 'weekday', bg ? `Как да се облека в ${place.name} в неделя?` : `What should I wear in ${place.name} on Sunday?`, 'clothing', true, { timeScope: 'specific_date', targetDate: '2026-10-11' })
    add(lang, 'word_order_complex', bg ? `В неделя ще съм в ${place.name} как да се облека` : `On Sunday I will be in ${place.name} what should I wear`, 'clothing', false, { timeScope: 'specific_date', targetDate: '2026-10-11' })
  }
  return cases
}
