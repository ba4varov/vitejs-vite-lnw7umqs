import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({ ...base, testMatch: 'windy-mobile.spec.ts', snapshotPathTemplate: '{testDir}/visual/windy/{arg}{ext}' })
