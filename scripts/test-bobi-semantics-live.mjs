// Opt-in evaluation against the existing configured Gemini service. Never part
// of npm test; at most 12 calls, no new service, no prompts/locations in output.
import { geminiClient } from '../server/gemini-client.js'
import { localIsoDate } from '../server/weather-chat-core.js'
import { semanticSchema, semanticSystem, parseSemanticUnderstanding } from '../server/weather-chat-semantics.js'
import { languageCorpus } from '../tests/helpers/bobi-language-corpus.mjs'

if (!process.env.GEMINI_API_KEY) {
  console.info('SKIP: live semantic evaluation requires the existing server GEMINI_API_KEY.')
  process.exit(0)
}
const corpus = languageCorpus()
const groups = [...new Set(corpus.map(item => `${item.lang}/${item.intent}`))]
const cases = groups.slice(0, 12).map((group, i) => corpus.filter(item => `${item.lang}/${item.intent}` === group)[1 + i % 7])
const result = { cases: cases.length, passed: 0, invalid: 0, semanticMismatch: 0, upstreamFailure: 0 }
for (const fixture of cases) {
  try {
    const { payload } = await geminiClient.generate({ endpoint: 'weather-chat', stage: 'semantic-evaluation', body: {
      systemInstruction: { parts: [{ text: semanticSystem }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ currentDate: localIsoDate(new Date(), 'Europe/Sofia'), selectedCity: 'Sofia', language: fixture.lang, message: fixture.message, context: null, pendingClarification: null }) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 320, responseMimeType: 'application/json', responseSchema: semanticSchema }
    } })
    let parsed
    try { parsed = parseSemanticUnderstanding(JSON.parse(payload?.candidates?.[0]?.content?.parts?.[0]?.text), fixture.lang) } catch { /* Count only, never print model content. */ }
    if (!parsed) result.invalid++
    else if (parsed.intent === fixture.intent && !parsed.needsClarification && parsed.citySource === 'explicit' && ['пловдив', 'plovdiv'].includes(parsed.requestedCity?.split(',')[0].trim().toLocaleLowerCase()) && parsed.timeSource === 'explicit' && parsed.timeScope === 'tomorrow') result.passed++
    else result.semanticMismatch++
  } catch { result.upstreamFailure++ }
}
console.info('Live semantic evaluation:', result)
process.exitCode = result.passed === result.cases ? 0 : 1
