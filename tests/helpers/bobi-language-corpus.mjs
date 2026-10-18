// Deterministic metamorphic inputs, not an implementation dictionary. The oracle
// belongs to each semantic fixture and is never derived from the mutated text.
const TOPICS = {
  bg: { rain: 'Ще вали ли', thunderstorm: 'Ще има ли гръмотевици', temperature: 'Колко градуса ще бъде', wind: 'Какъв ще е вятърът', general_weather: 'Какво ще е времето', clothing: 'Как да се облека' },
  en: { rain: 'Will it rain', thunderstorm: 'Will there be thunderstorms', temperature: 'What will the temperature be', wind: 'How windy will it be', general_weather: 'What will the weather be', clothing: 'What should I wear' }
}
function random(seed) {
  let value = seed >>> 0
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 2 ** 32 }
}
export function variants(parts, lang, seed) {
  const next = random(seed)
  const original = parts.filter(Boolean).join(' ')
  const words = original.split(' ')
  const eligible = words.map((word, i) => /^\p{L}{4,}$/u.test(word) ? i : -1).filter(i => i >= 0)
  const mutate = operation => {
    const copy = [...words], index = eligible[Math.floor(next() * eligible.length)]
    const chars = [...copy[index]], at = 1 + Math.floor(next() * (chars.length - 2))
    if (operation === 'delete') chars.splice(at, 1)
    if (operation === 'repeat') chars.splice(at, 0, chars[at])
    if (operation === 'transpose') [chars[at], chars[at + 1]] = [chars[at + 1], chars[at]]
    if (operation === 'insert') chars.splice(at, 0, chars[(at + 2) % chars.length])
    copy[index] = chars.join('')
    return copy.join(' ')
  }
  const shuffled = parts.filter(Boolean)
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
  return [original, ...['delete', 'repeat', 'transpose', 'insert'].map(mutate), shuffled.join(' '), lang === 'bg' ? `Я кажи, ${original.toLocaleLowerCase('bg')} а?` : `Hey, reckon ${original.toLowerCase()}, please?`, `  ${original.toUpperCase().replaceAll(' ', '  ')}?!  `]
}
export function languageCorpus() {
  return Object.entries(TOPICS).flatMap(([lang, topics], l) => Object.entries(topics).flatMap(([intent, topic], i) => variants([topic, lang === 'bg' ? 'утре' : 'tomorrow', lang === 'bg' ? 'в Пловдив' : 'in Plovdiv'], lang, 1000 + l * 100 + i).map((message, mutation) => ({ lang, intent, message, mutation, requestedCity: lang === 'bg' ? 'Пловдив' : 'Plovdiv', timeScope: 'tomorrow' }))))
}
export const semanticFixture = (overrides = {}) => ({ intent: 'general_weather', requestedCity: null, timeScope: 'general', targetDate: null, needsClarification: false, clarificationQuestion: null, turnType: 'new_question', citySource: 'selected', timeSource: 'default', missing: 'none', ...overrides })
