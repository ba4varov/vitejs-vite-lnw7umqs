import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: 'mobile-charts.spec.ts',
  snapshotPathTemplate: '{testDir}/visual/charts/{arg}{ext}',
  webServer: {
    ...base.webServer,
    command: 'node scripts/prepare-chart-baseline.mjs ac42d97520f553b8fcf7a080f373ddf0f4d31e7c && npm run dev -- --host 127.0.0.1 --port 4173',
  },
})
