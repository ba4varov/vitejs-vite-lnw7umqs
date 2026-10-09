import config from './playwright.config'
process.env.PROFILE_BUILT_DIST = 'work/profile-built-preview'
export default {
  ...config,
  fullyParallel: true,
  testMatch: ['profile-redesign.spec.ts', 'profile-height.spec.ts', 'profile-plan.spec.ts', 'profile-bundle.spec.ts', 'push.spec.ts'],
  outputDir: './work/built-profile-results',
  webServer: {
    ...config.webServer,
    cwd: process.cwd(),
    command: 'npx vite build --outDir work/profile-built-preview && npx vite preview --outDir work/profile-built-preview --host 127.0.0.1 --port 4173',
    reuseExistingServer: false,
  },
}
