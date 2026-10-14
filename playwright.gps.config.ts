import { defineConfig } from '@playwright/test'
import base from './playwright.config'
const port = Number(process.env.GPS_TEST_PORT || 4173)
export default defineConfig({ ...base, use: { ...base.use, baseURL: `http://127.0.0.1:${port}` }, webServer: { ...base.webServer, command: `npm run dev -- --host 127.0.0.1 --port ${port}`, url: `http://127.0.0.1:${port}` }, testMatch: 'startup-gps.spec.ts', fullyParallel: true, workers: 3, timeout: 60000, expect: { timeout: 15000 }, outputDir: './work/gps-browser-results' })
