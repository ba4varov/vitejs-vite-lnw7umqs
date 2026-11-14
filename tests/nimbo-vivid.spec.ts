import { test, expect } from '@playwright/test'
import { fixture } from './forecast-order-fixture'
import { openHeaderMenu } from './header-navigation'

test.describe('Nimbo visual refresh without API behavior changes', () => {
  for (const width of [360, 390, 768, 1440]) {
    for (const lang of ['bg', 'en'] as const) {
      for (const dark of [false, true]) {
        test(`Nimbo panel ${width}px ${lang} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
          await page.setViewportSize({ width, height: 900 })
          await page.addInitScript(() => {
            localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
              name: 'Varna', lat: 43.2141, lon: 27.9147, source: 'manual',
              geonameId: 726050, countryCode: 'BG',
            }))
          })
          await fixture(page, lang)
          const panel = page.locator('.weather-chat')
          await expect(panel).toBeVisible()
          if (dark) {
            await openHeaderMenu(page)
            await page.locator('.header-menu > .icon-btn').click()
            await expect(page.locator('.weather-app')).toHaveClass(/\bdark\b/)
          }
          await expect(panel.locator('.nimbo-orb')).toBeVisible()
          await expect(panel.locator('.nimbo-orb span')).toHaveText('N')
          await expect(panel.locator('.nimbo-eyebrow')).toHaveText(lang === 'bg' ? 'AI МЕТЕО ПОМОЩНИК' : 'AI WEATHER GUIDE')
          await expect(panel.locator('.chat-messages .chat-message.bot')).toHaveCount(1)
          await expect(panel.locator('.chat-suggestions button')).toHaveCount(3)
          await expect(panel.locator('.chat-form input')).toBeEnabled()
          await expect(panel.locator('.chat-form button')).toBeDisabled()
          const panelWidth = await panel.evaluate(node => node.getBoundingClientRect().width)
          expect(panelWidth).toBeGreaterThan(280)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await panel.screenshot({
            path: testInfo.outputPath(`nimbo-${width}-${lang}-${dark ? 'dark' : 'light'}.png`),
            animations: 'disabled'
          })
        })
      }
    }
  }

  test('one quick question makes exactly one chat API request', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
        name: 'Varna', lat: 43.2141, lon: 27.9147, source: 'manual',
        geonameId: 726050, countryCode: 'BG',
      }))
    })
    await fixture(page, 'bg')
    const requests: any[] = []
    await page.route('**/api/weather-chat', async route => {
      requests.push(route.request().postDataJSON())
      await route.fulfill({ json: { answer: 'За Варна вземи чадър.' } })
    })
    const chat = page.locator('.weather-chat')
    await chat.locator('.chat-suggestions button').first().click()
    await expect(chat.getByText('За Варна вземи чадър.')).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0].message).toBe('Да взема ли чадър?')
    expect(requests[0].quickAction).toBe('umbrella')
    await chat.locator('.chat-form input').fill('Какъв е вятърът?')
    await chat.locator('.chat-form button').click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1].message).toBe('Какъв е вятърът?')
    expect(requests[1].quickAction).toBeUndefined()
  })

  test('loading indicator is decorative, with reduced motion respected', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      localStorage.setItem('meteoPulseConfirmedLocationV1', JSON.stringify({
        name: 'Varna', lat: 43.2141, lon: 27.9147, source: 'manual',
        geonameId: 726050, countryCode: 'BG',
      }))
    })
    await fixture(page, 'en')
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/weather-chat', async route => {
      await hold
      await route.fulfill({ json: { answer: 'A forecast-based answer.' } })
    })
    const chat = page.locator('.weather-chat')
    await chat.locator('.chat-suggestions button').first().click()
    const thinking = chat.locator('.nimbo-thinking')
    await expect(thinking).toBeVisible()
    expect(await thinking.evaluate(node => getComputedStyle(node).animationName)).toBe('none')
    await expect(chat.locator('.chat-form button')).toBeDisabled()
    release()
    await expect(chat.getByText('A forecast-based answer.')).toBeVisible()
    await expect(thinking).toHaveCount(0)
  })
})
