import assert from 'node:assert/strict'
import test from 'node:test'
import { semanticGenerationBody } from '../../server/gemini-client.js'

for (const [model, expected] of [
  ['gemini-2.5-flash', { thinkingBudget: 0 }],
  ['gemini-2.5-flash-lite-001', { thinkingBudget: 0 }],
  ['gemini-2.5-pro', { thinkingBudget: 128 }],
  ['gemini-3-flash', { thinkingLevel: 'minimal' }],
  ['gemini-3.8-flash', { thinkingLevel: 'low' }],
  ['gemini-3.8-pro', undefined],
  ['gemini-3.9-flash', undefined],
  ['gemini-3-pro', { thinkingLevel: 'low' }],
  ['gemini-2.0-flash', undefined],
  ['gemini-9-flash', undefined],
]) test(`semantic generation controls for ${model}`, () => {
  const body = { contents: [], generationConfig: { maxOutputTokens: 320, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } } }
  const result = semanticGenerationBody(body, model)
  assert.equal(result.generationConfig.maxOutputTokens, 1024)
  assert.deepEqual(result.generationConfig.thinkingConfig, expected)
  assert.equal(result.generationConfig.responseSchema, body.generationConfig.responseSchema)
  assert.equal(body.generationConfig.maxOutputTokens, 320)
})

for (const model of ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3-flash', 'gemini-3-pro', 'gemini-9-flash']) test(`sampling controls are adapted only for the known 3.8 Flash model: ${model}`, () => {
  const schema = { type: 'OBJECT' }
  const body = { contents: [{ role: 'user', parts: [{ text: 'Synthetic question' }] }], generationConfig: {
    temperature: 0.2, topP: 0.9, topK: 20, candidateCount: 1, maxOutputTokens: 320,
    responseMimeType: 'application/json', responseSchema: schema
  } }
  const original = structuredClone(body)
  const result = semanticGenerationBody(body, model)
  assert.equal(result.contents, body.contents)
  assert.equal(result.generationConfig.maxOutputTokens, 1024)
  assert.equal(result.generationConfig.responseMimeType, 'application/json')
  assert.equal(result.generationConfig.responseSchema, schema)
  for (const key of ['temperature', 'topP', 'topK', 'candidateCount']) {
    assert.equal(Object.hasOwn(result.generationConfig, key), model !== 'gemini-3.8-flash')
    if (model !== 'gemini-3.8-flash') assert.equal(result.generationConfig[key], body.generationConfig[key])
  }
  if (model === 'gemini-3.8-flash') {
    assert.deepEqual(result.generationConfig.thinkingConfig, { thinkingLevel: 'low' })
    assert.doesNotMatch(JSON.stringify(result), /minimal|thinkingBudget/)
  }
  assert.deepEqual(body, original)
})
