import assert from 'node:assert/strict'
import test from 'node:test'
import { semanticGenerationBody } from '../../server/gemini-client.js'

for (const [model, expected] of [
  ['gemini-2.5-flash', { thinkingBudget: 0 }],
  ['gemini-2.5-flash-lite-001', { thinkingBudget: 0 }],
  ['gemini-2.5-pro', { thinkingBudget: 128 }],
  ['gemini-3-flash', { thinkingLevel: 'minimal' }],
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
