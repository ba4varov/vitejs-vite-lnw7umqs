import { test, expect } from '@playwright/test'
import { fixture } from './forecast-order-fixture'
import { clickHeaderControl } from './header-navigation'
import { clarificationTurn } from '../server/weather-chat-core.js'

for (const lang of ['bg', 'en'] as const) for (const reset of ['city', 'language'] as const) {
  test(`pending chat state ${lang}: survives replies and clears on ${reset}`, async ({ page }) => {
    await fixture(page, lang)
    const pending = clarificationTurn(lang === 'bg' ? 'А в Пловдив?' : 'And in Plovdiv?', lang, {}).pendingClarification
    const requests: Record<string, unknown>[] = []
    let clarify = true
    await page.route('**/api/weather-chat', route => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({ json: { answer: clarify ? 'Clarification question' : 'Forecast answer', needsClarification: clarify, pendingClarification: clarify ? pending : null } })
    })
    async function send(message: string) {
      await page.locator('.chat-form input').fill(message)
      await page.locator('.chat-form button').click()
      await expect(page.locator('.chat-form input')).toBeEnabled()
    }
    await send('And in Plovdiv?')
    expect(requests[0].pendingClarification).toBeUndefined()
    clarify = false
    await send('For wind')
    expect(requests[1].pendingClarification).toEqual(pending)
    await send('Wind tomorrow?')
    expect(requests[2].pendingClarification).toBeUndefined()
    clarify = true
    await send('And in Plovdiv?')
    if (reset === 'city') await page.locator('.city-btn:not(.active)').first().click()
    else await clickHeaderControl(page, page.locator('.lang-btn'))
    await expect(page.locator('.chat-messages .chat-message')).toHaveCount(1)
    clarify = false
    await send('Wind tomorrow?')
    expect(requests.at(-1)?.pendingClarification).toBeUndefined()
    expect(requests.at(-1)?.context).toBeUndefined()
  })
}
