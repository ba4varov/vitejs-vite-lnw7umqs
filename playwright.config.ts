import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', outputDir: './work/browser-results',
  use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://auth.example.invalid', VITE_SUPABASE_ANON_KEY: 'test-anon', VITE_GOOGLE_AUTH_ENABLED: 'false', VITE_TURNSTILE_SITE_KEY: '' } },
})
