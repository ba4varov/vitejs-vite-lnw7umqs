import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: ['forecast-loading.spec.ts', 'mobile-forecast-order.spec.ts', 'mobile-weather-card.spec.ts', 'mobile-weather-readability.spec.ts'],
  fullyParallel: true,
  workers: 3,
  timeout: 60000,
  // App-level suites share a development server and perform many resizes.
  // Allow asynchronous rendering on the constrained CI worker to settle.
  expect: { timeout: 15000 },
  outputDir: './work/regression-results',
})
