import { clarificationTurn, extractTimeScope, normalizeQuestion } from './weather-chat-core.js'
import { collectLocationCandidates, normalizePlaceName } from './weather-location-evidence.js'

// Deliberately small grammars, not a fuzzy keyword classifier. Every character
// outside a location slot must be consumed. Unknown/edited words go to Gemini.
const topics = {
  bg: [
    ['rain', /(?:ще вали ли|вали ли|да взема ли чадър|трябва ли ми чадър)/gu],
    ['clothing', /(?:как да се облека|какви дрехи да взема)/gu],
    ['walk', /(?:подходящо ли е за разходка|става ли за разходка|може ли да се разходя)/gu],
    ['temperature', /(?:колко градуса ще (?:е|бъде)|каква (?:ще е|е) температурата)/gu],
    ['wind', /(?:какъв ще е вятърът|колко силен (?:е|ще е) вятърът|вятърът)/gu],
    ['thunderstorm', /(?:ще има ли гръмотевици|ще има ли гръмотевична буря)/gu],
    ['general_weather', /(?:какво (?:ще е|е|беше) времето|какво ще бъде времето)/gu]
  ],
  en: [
    ['rain', /(?:will it rain|is it raining|should i (?:take|bring) an umbrella)/gu],
    ['clothing', /(?:what should i wear|how should i dress)/gu],
    ['walk', /(?:can i go for a walk|is it suitable for a walk)/gu],
    ['temperature', /(?:what will the temperature be|what is the temperature|how (?:cold|warm|hot) will it be)/gu],
    ['wind', /(?:how windy will it be|how strong is the wind|wind)/gu],
    ['thunderstorm', /(?:will there be thunderstorms|will there be lightning)/gu],
    ['general_weather', /(?:what (?:is|was|will be) the weather|what will the weather be)/gu]
  ]
}
const periods = /(?<!\p{L})(?:вдругиден|завчера|днес|утре|вчера|сега|the day after tomorrow|the day before yesterday|day after tomorrow|day before yesterday|tomorrow|yesterday|today|now|tonight|(?:във |в |на |on |for )?(?:неделя|понеделник|вторник|сряда|четвъртък|петък|събота|sunday|monday|tuesday|wednesday|thursday|friday|saturday))(?=$|[^\p{L}])/giu
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function localRoute(input) {
  if (input.quickAction) return { useLocal: true, reason: 'quick_action' }
  if (input.pendingClarification) return { useLocal: false, reason: 'pending_clarification' }
  const turn = clarificationTurn(input.message, input.lang, input)
  const u = turn.understanding
  if (!u || turn.answer || u.needsClarification || ['unclear', 'unrelated'].includes(u.intent)) return { useLocal: false, reason: 'uncertain_intent' }
  let text = normalizeQuestion(input.message)
  // Do not guess comparative, conditional, negated or multi-location requests.
  if (/(?:^|\s)(?:не|без|ако|но|или|между|вместо|от|not|without|if|but|or|between|instead|from)(?:\s|$)/u.test(text)) return { useLocal: false, reason: 'complex_language' }
  const evidence = collectLocationCandidates(input.message, input.lang).filter(candidate => candidate.strength !== 'name')
  if (evidence.length) {
    if (!u.requestedCity || evidence.some(c => c.strength !== 'syntax' || normalizePlaceName(c.text) !== normalizePlaceName(u.requestedCity))) return { useLocal: false, reason: 'uncertain_location' }
    const name = normalizeQuestion(u.requestedCity)
    // Only actual locatives are admitted here; travel language remains AI-first.
    const slot = new RegExp(`(?:^|\\s)(?:във|в|in|at|near)\\s+${escape(name)}(?=\\s|$)`, 'u')
    if (!slot.test(text)) return { useLocal: false, reason: 'uncertain_location' }
    text = text.replace(slot, ' ')
  }
  const matches = [...text.matchAll(periods)]
  if (input.context && !matches.length && !/^(?:а|and)\s/u.test(text)) return { useLocal: false, reason: 'uncertain_context' }
  if (matches.length > 1) return { useLocal: false, reason: 'uncertain_period' }
  if (matches.length && !extractTimeScope(input.message) && u.timeScope !== 'specific_date') return { useLocal: false, reason: 'uncertain_period' }
  text = text.replace(periods, ' ').replace(/\s+/gu, ' ').trim()
  if (input.context && /^(?:а|and)?\s*$/u.test(text) && matches.length) return { useLocal: true, reason: 'confident_followup' }
  for (const [intent, pattern] of topics[input.lang]) {
    const found = [...text.matchAll(pattern)]
    if (found.length !== 1 || u.intent !== intent) continue
    const remaining = text.replace(pattern, ' ').replace(/\s+/gu, ' ').trim()
    if (!remaining || input.context && /^(?:а|and)$/u.test(remaining)) return { useLocal: true, reason: input.context ? 'confident_followup' : 'confident_grammar' }
  }
  return { useLocal: false, reason: 'unconsumed_language' }
}
