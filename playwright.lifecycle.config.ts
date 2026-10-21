import {defineConfig,devices} from '@playwright/test'
import base from './playwright.config'
const production=process.env.LIFECYCLE_PRODUCTION!=='0'
const port=production?4191:4192
export default defineConfig({
 ...base,testMatch:'startup-lifecycle.spec.ts',workers:2,fullyParallel:true,timeout:60000,
 outputDir:'./work/lifecycle-browser-results',
 use:{...base.use,...devices['Pixel 7'],baseURL:`http://127.0.0.1:${port}`},
 webServer:{...base.webServer,command:production?`npm run build && npm run preview -- --host 127.0.0.1 --port ${port}`:`npm run dev -- --host 127.0.0.1 --port ${port}`,url:`http://127.0.0.1:${port}`,timeout:120000},
})
