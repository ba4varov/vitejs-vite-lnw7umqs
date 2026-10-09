import {defineConfig} from '@playwright/test'
// Read-only static Preview smoke test with synthetic local session + API fixtures.
// Never calls real account APIs or modifies hosted Supabase data.
const preview=process.env.PUSH_PREVIEW_URL
if(!preview)throw Error('Set PUSH_PREVIEW_URL to the PR #61 Preview origin or http://127.0.0.1:4174')
const local=preview==='http://127.0.0.1:4174'
if(!local&&new URL(preview).origin!=='https://weather-git-feat-web-push-stage6ga-ba4varov-projects.vercel.app')throw Error('Only the PR #61 Preview origin or local production bundle may be tested')
export default defineConfig({
 testDir:'./tests',testMatch:'push.spec.ts',grep:/push section visible without SQL migration/,
 outputDir:'./work/preview-browser-results',workers:1,
 use:{baseURL:preview,proxy:!local&&process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined,launchOptions:{executablePath:process.env.CHROMIUM_PATH||undefined}},
 webServer:local?{command:'npm run preview -- --host 127.0.0.1 --port 4174',url:preview,reuseExistingServer:false}:undefined,
})
