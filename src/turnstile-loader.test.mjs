import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTurnstile, resetTurnstileLoaderForTests } from './turnstile-loader.js'

function environment() {
  const listeners = {}
  const script = { addEventListener(type, callback) { listeners[type] = callback }, remove() { this.removed = true } }
  const doc = {
    current: null,
    head: { appendChild(node) { doc.current = node } },
    createElement() { return script },
    getElementById() { return doc.current },
  }
  return { win: {}, doc, script, listeners }
}

test('loads the official Turnstile script once and shares the pending request', async () => {
  resetTurnstileLoaderForTests()
  const { win, doc, script, listeners } = environment()
  const first = loadTurnstile(win, doc)
  const second = loadTurnstile(win, doc)
  assert.strictEqual(first, second)
  assert.equal(script.src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
  win.turnstile = { render() {} }
  listeners.load()
  assert.strictEqual(await first, win.turnstile)
})

test('removes a failed script and permits a clean retry', async () => {
  resetTurnstileLoaderForTests()
  const first = environment()
  const failed = loadTurnstile(first.win, first.doc)
  first.listeners.error()
  await assert.rejects(failed, /TURNSTILE_LOAD_FAILED/)
  assert.equal(first.script.removed, true)

  const retry = environment()
  const pending = loadTurnstile(retry.win, retry.doc)
  retry.win.turnstile = { render() {} }
  retry.listeners.load()
  assert.strictEqual(await pending, retry.win.turnstile)
})
