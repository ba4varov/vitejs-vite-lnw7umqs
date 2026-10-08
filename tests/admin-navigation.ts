export async function navigate(page: any, name: string) {
  const menu = page.getByRole('button', { name: /^(Меню|Menu)$/ })
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') === 'false') await menu.click()
  await page.locator('nav').getByRole('button', { name, exact: true }).click()
}
