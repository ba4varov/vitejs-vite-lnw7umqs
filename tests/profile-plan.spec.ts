import { test, expect } from '@playwright/test'
import { fixture } from './profile-fixture'

for (const lang of ['bg', 'en'] as const) {
  const open = (page: Page) => page.getByRole('button', { name: lang === 'bg' ? 'Моят профил' : 'My profile', exact: true }).click()
  const close = (page: Page) => page.getByRole('button', { name: lang === 'bg' ? 'Затвори' : 'Close', exact: true }).click()
  const labels = lang === 'bg' ? { free: 'Безплатен', pro: 'Pro план', loading: 'Зареждане…', unavailable: 'Планът не е наличен' }
    : { free: 'Free', pro: 'Pro plan', loading: 'Loading…', unavailable: 'Plan unavailable' }

  for (const plan of ['free', 'pro'] as const) test(`${lang}: confirmed ${plan} profile`, async ({ page }) => {
    await fixture(page, lang, plan); await open(page)
    await expect(page.locator('.profile-plan')).toContainText(labels[plan])
    await expect(page.locator('.profile-email')).toContainText('profile@example.invalid')
    await expect(page.locator('.notification-settings')).toBeHidden()
    await expect(page.locator('.activity-consent')).toBeHidden()
    await page.getByLabel(lang === 'bg' ? 'Име (незадължително)' : 'Name (optional)').fill('Updated name')
    await page.getByRole('button', { name: lang === 'bg' ? 'Запази' : 'Save', exact: true }).click()
    await expect(page.locator('.profile-plan')).toContainText(labels[plan])
    await expect(page.locator('.auth-success')).toContainText(lang === 'bg' ? 'Промяната е запазена.' : 'Your changes were saved.')
  })

  test(`${lang}: administrative upgrade and downgrade refresh without a new login`, async ({ page }) => {
    const state = await fixture(page, lang); await open(page)
    await expect(page.locator('.profile-plan')).toContainText(labels.free)
    for (const plan of ['pro', 'free'] as const) {
      await close(page); state.setPlan(plan)
      const before = state.requests.length
      await open(page); await expect(page.locator('.profile-plan')).toContainText(labels[plan])
      expect(state.requests.length).toBeGreaterThan(before)
    }
    expect(state.requests.every(token => token === 'Bearer profile-test-token')).toBe(true)
  })

  test(`${lang}: pending and failed refresh hides the previous Free plan`, async ({ page }) => {
    const state = await fixture(page, lang); await open(page)
    await expect(page.locator('.profile-plan')).toContainText(labels.free)
    await close(page); state.hold(); state.fail(); await open(page)
    await expect(page.locator('.profile-plan')).toContainText(labels.loading)
    await expect(page.locator('.profile-plan')).not.toContainText(labels.free)
    state.release()
    await expect(page.locator('.profile-plan')).toContainText(labels.unavailable)
    await expect(page.locator('.profile-plan')).not.toContainText(labels.free)
    await expect(page.locator('.auth-error')).toBeVisible()
  })

  test(`${lang}: missing plan does not imply Free`, async ({ page }) => {
    await fixture(page, lang, 'unknown'); await open(page)
    await expect(page.locator('.profile-plan')).toContainText(labels.unavailable)
    await expect(page.locator('.profile-plan')).not.toContainText(labels.free)
  })
}
