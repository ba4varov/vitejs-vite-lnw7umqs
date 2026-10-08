import { test, expect } from '@playwright/test'
import { setup } from './admin-fixture'
import { navigate } from './admin-navigation'

const sections = {
  bg: ['Начално табло', 'Потребители', 'Статистики', 'Журнал на действията', 'Състояние на системата', 'Администраторски профил'],
  en: ['Dashboard', 'Users', 'Statistics', 'Action log', 'System status', 'Administrator profile'],
}
for (const width of [320, 390, 768, 1440, 2560]) for (const lang of ['bg', 'en'] as const) for (const dark of [false, true]) {
  test(`short sections start at top ${width} ${lang} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width >= 768 ? 1800 : 844 })
    await setup(page, { empty: true })
    // Empty lists and series keep these fixtures short without touching real data.
    await page.route('**/api/admin?**', route => {
      const action = new URL(route.request().url()).searchParams.get('action')
      const shortData: Record<string, unknown> = {
        users: { users: [], total: 0, pageSize: 20 },
        'management-users': { users: [], total: 0, pageSize: 20 },
        audit: { entries: [], total: 0, pageSize: 20 },
        'management-summary': { blocked: 0, asOf: '2026-10-08T12:00:00Z', entries: [] },
        analytics: { period: '30', total: 0, last7: 0, last30: 0, login7: 0, login30: 0, noLogin30: 0, free: 0, pro: 0, unknownPlan: 0, favorites: 0, uniqueCities: 0, buckets: [], cities: [] },
      }
      return action && action in shortData ? route.fulfill({ json: shortData[action] }) : route.fallback()
    })
    await page.goto('/admin')
    await expect(page.locator('.admin-stats strong').first()).toHaveText('3')
    if (lang === 'en') await page.getByRole('button', { name: 'EN', exact: true }).click()
    if (dark) await page.getByRole('button', { name: lang === 'bg' ? 'Смени темата' : 'Toggle theme' }).click()
    const readySelectors = ['.admin-stats', '.admin-table', '.admin-analytics-grid', '.admin-pagination', '.admin-health-grid', 'main .admin-card']
    for (const [index, name] of sections[lang].entries()) {
      await navigate(page, name)
      await expect(page.locator(readySelectors[index]).first()).toBeVisible()
      await expect(page.locator('main').getByRole('status').filter({ hasText: /^(Зареждане…|Loading…)$/ })).toHaveCount(0)
      await page.evaluate(() => window.scrollTo(0, 0))
      const geometry = await page.locator('.admin-app main').evaluate(main => {
        const app = main.parentElement!
        const header = main.querySelector('header')!
        const rect = main.getBoundingClientRect()
        const appRect = app.getBoundingClientRect()
        const style = getComputedStyle(main)
        const columns = getComputedStyle(app).gridTemplateColumns.split(' ')
        const sidebarWidth = getComputedStyle(app).display === 'grid' ? parseFloat(columns[0]) : 0
        const availableWidth = appRect.width - sidebarWidth
        return {
          mainTop: rect.top - appRect.top,
          headerTop: header.getBoundingClientRect().top - appRect.top,
          paddingTop: parseFloat(style.paddingTop),
          width: rect.width,
          maxWidth: parseFloat(style.maxWidth),
          leftGap: rect.left - appRect.left - sidebarWidth,
          rightGap: appRect.right - rect.right,
          expectedWidth: Math.min(availableWidth, 1700),
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      expect(geometry.mainTop, name).toBeCloseTo(0, 1)
      expect(geometry.headerTop, name).toBeCloseTo(geometry.paddingTop, 1)
      expect(geometry.maxWidth, name).toBe(1700)
      expect(geometry.width, name).toBeCloseTo(geometry.expectedWidth, 1)
      expect(geometry.leftGap, name).toBeCloseTo(geometry.rightGap, 1)
      expect(geometry.overflow, name).toBe(false)
      if (index === 3 || index === 5) await page.screenshot({ path: `docs/admin-stage5-screenshots/alignment/${index === 3 ? 'audit' : 'profile'}-${width}-${lang}-${dark ? 'dark' : 'light'}.png`, fullPage: true, animations: 'disabled' })
    }
  })
}
