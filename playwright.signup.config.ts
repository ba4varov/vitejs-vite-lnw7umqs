import {defineConfig} from '@playwright/test'
import base from './playwright.config'
export default defineConfig({...base,timeout:60000,expect:{timeout:15000},testIgnore:[],testMatch:'signup-activity.spec.ts',webServer:{...(base.webServer as any),env:{...(base.webServer as any).env,VITE_GOOGLE_AUTH_ENABLED:'true'}}})
