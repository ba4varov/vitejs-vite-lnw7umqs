import { type Locator, type Page } from '@playwright/test'

export async function openHeaderMenu(page: Page) {
  await page.locator('.header-row').waitFor()
  const toggle = page.locator('.mobile-menu-toggle')
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
}

export async function clickHeaderControl(page: Page, control: Locator) {
  await openHeaderMenu(page)
  await control.click()
}
