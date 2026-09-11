import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PROJECTS } from './project-data.js'

test('project cards expose the approved external destinations', () => {
  assert.deepEqual(PROJECTS.map(({ name, url }) => ({ name, url })), [
    { name: 'Искра', url: 'https://iskra.ba4varov1.workers.dev/' },
    { name: 'NameriGo', url: 'https://nameri-go.vercel.app/' },
  ])
})

test('project links open safely in a new tab and use code-native artwork', async () => {
  const source = await readFile(new URL('./ProjectShowcase.tsx', import.meta.url), 'utf8')
  assert.match(source, /target="_blank" rel="noopener noreferrer"/)
  assert.match(source, /<svg[^>]+role="img"/)
  assert.doesNotMatch(source, /<img|https?:\/\/.*\.(?:png|jpe?g|webp)/i)
})

test('AdSlot reserves responsive space and hides its placeholder in production', async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL('./AdSlot.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./App.css', import.meta.url), 'utf8'),
  ])
  assert.match(component, /!import\.meta\.env\.PROD/)
  assert.match(component, /data-ad-slot=/)
  assert.match(styles, /\.ad-slot\s*\{[^}]*min-height:\s*90px/s)
  assert.match(styles, /\.ad-slot-rectangle\s*\{[^}]*min-height:\s*250px/s)
})
