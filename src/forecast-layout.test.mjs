import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('./App.css', import.meta.url), 'utf8')

test('desktop forecast cards share a row before the full-width dashboard sections', () => {
  const hourly = appSource.indexOf('className="card hourly-section"')
  const forecast = appSource.indexOf('className="card forecast-section"')
  const charts = appSource.indexOf('<Chart hourly={hourly}')
  const map = appSource.indexOf('className="card map-section"')
  const aqi = appSource.indexOf('className="card aqi-section"')

  assert.ok(hourly < forecast && forecast < charts && charts < map && map < aqi)
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.forecast-dashboard > \.hourly-section \{ grid-column: 1; \}/)
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.forecast-dashboard > \.forecast-section \{ grid-column: 2; \}/)
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*\.forecast-dashboard > \.charts-section[\s\S]*grid-column: 1 \/ -1;/)
})
