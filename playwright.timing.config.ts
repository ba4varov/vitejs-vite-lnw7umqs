import { defineConfig } from '@playwright/test'
export default defineConfig({
 testDir:'./tests',testMatch:'startup-timing.spec.ts',outputDir:'./work/timing-browser-results',workers:1,timeout:30000,expect:{timeout:15000},
 use:{launchOptions:{executablePath:process.env.CHROMIUM_PATH||undefined}},
 webServer:[
  {command:'node node_modules/vite/bin/vite.js preview work/timing-baseline --host 127.0.0.1 --port 4185',url:'http://127.0.0.1:4185',reuseExistingServer:false},
  {command:'npm run preview -- --host 127.0.0.1 --port 4186',url:'http://127.0.0.1:4186',reuseExistingServer:false},
 ],
})
