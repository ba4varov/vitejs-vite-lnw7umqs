import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: 'mobile-forecast-cards.spec.ts',
  snapshotPathTemplate: '{testDir}/visual/forecast-cards/{arg}{ext}',
})
