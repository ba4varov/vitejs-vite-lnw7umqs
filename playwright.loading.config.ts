import { defineConfig } from '@playwright/test'
import base from './playwright.config'
const port = Number(process.env.FORECAST_TEST_PORT || 4173)
export default defineConfig({
 ...base, use: { ...base.use, baseURL: `http://127.0.0.1:${port}` }, testMatch: 'progressive-forecast.spec.ts', workers: 3, fullyParallel: true,
 webServer: [{ ...base.webServer, command: `npm run dev -- --host 127.0.0.1 --port ${port}`, url: `http://127.0.0.1:${port}` }, { command: 'node scripts/prepare-forecast-baseline.mjs && node node_modules/vite/bin/vite.js work/baseline --host 127.0.0.1 --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: false, env: { VITE_SUPABASE_URL: 'https://auth.example.invalid', VITE_SUPABASE_ANON_KEY: 'test-anon' } }],
})
