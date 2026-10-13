import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const ref = process.argv[2] || 'origin/main'
const read = path => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' })
const root = 'work/chart-baseline'
mkdirSync(root, { recursive: true })
const app = read('src/App.tsx')
const start = app.indexOf('type ChartType =')
const end = app.indexOf('const WeatherApp =', start)
if (start < 0 || end < 0) throw new Error('Baseline chart source boundaries missing')
const charts = app.slice(start, end).replace('const Chart =', 'export const Chart =')
writeFileSync(`${root}/WeatherCharts.tsx`, `import { useState, useEffect, useRef } from 'react'\nimport { CHART_METRICS, chartSummary, chartTheme, chartValues, valueRange, visibleTimeIndexes } from './chart-utils.js'\n${charts}`)
for (const path of ['App.css', 'index.css', 'chart-utils.js']) writeFileSync(`${root}/${path}`, read(`src/${path}`))
writeFileSync(`${root}/fixture.tsx`, readFileSync('tests/chart-fixture.tsx', 'utf8').replace('../src/WeatherCharts', './WeatherCharts').replace('../src/index.css', './index.css').replace('../src/App.css', './App.css'))
writeFileSync(`${root}/fixture.html`, readFileSync('tests/chart-fixture.html', 'utf8').replace('/tests/chart-fixture.tsx', '/work/chart-baseline/fixture.tsx'))
console.log(`Prepared independent charts from ${ref}`)
