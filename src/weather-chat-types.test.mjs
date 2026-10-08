import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { ALLOWED_INTENTS, ALLOWED_TIME_SCOPES, QUICK_ACTIONS } from '../server/weather-chat-core.js'
const root = fileURLToPath(new URL('../', import.meta.url))
function diagnostics(source) {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.api.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsed.options.types, ['node'])
  assert.equal(parsed.options.strict, true)
  const filename = path.join(root, 'api', '__weather_type_regression.ts')
  const host = ts.createCompilerHost(parsed.options)
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host)
  host.readFile = file => file === filename ? source : read(file)
  host.fileExists = file => file === filename || exists(file)
  const program = ts.createProgram([filename], parsed.options, host)
  return ts.getPreEmitDiagnostics(program)
}
const imports = `import { ALLOWED_INTENTS, ALLOWED_TIME_SCOPES, QUICK_ACTIONS, findDailyForecast, deterministicWeatherAnswer, relativeForecastDate, parseUnderstanding, type WeatherSummary } from '../server/weather-chat-core.js';\n`
test('serverless type contracts retain forecast fields, archive omissions and Gemini without isQuick', () => {
  const errors = diagnostics(imports + `
    const summary: WeatherSummary = { location: 'Sofia', targetDay: null, historical: true };
    summary.requestedDate = '2026-10-09'; summary.requestedDates = ['2026-10-10']; summary.targetDays = [];
    const day = findDailyForecast([{ date: '2026-10-10', minC: 10, maxC: 20 }], '2026-10-10');
    const temperature: number | undefined = day?.maxC;
    const understood = parseUnderstanding({}, 'en');
    if (understood) deterministicWeatherAnswer(summary, understood, 'en');
    relativeForecastDate('yesterday');
    const intents: typeof ALLOWED_INTENTS = ${JSON.stringify(ALLOWED_INTENTS)};
    const scopes: typeof ALLOWED_TIME_SCOPES = ${JSON.stringify(ALLOWED_TIME_SCOPES)};
    const quick: typeof QUICK_ACTIONS = ${JSON.stringify(QUICK_ACTIONS)};
    const key: string | undefined = process.env.GEMINI_API_KEY;
  `)
  assert.deepEqual(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')), [])
})
test('serverless type contracts reject unsupported relative periods and malformed weather', () => {
  const errors = diagnostics(imports + `relativeForecastDate('next_weekend'); const summary: WeatherSummary = { location: 'Sofia', targetDay: { date: '2026-10-10' } };`)
  assert.deepEqual(errors.map(error => error.code).sort(), [2345, 2740])
})
