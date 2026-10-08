import { test, expect } from '@playwright/test'
for (const width of [320,390,768,1440]) {
  test(`readable thirty day chart at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:1000})
    await page.addInitScript(() => localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'chart-test',email:'chart@example.invalid'}})))
    await page.route('**/api/admin?**', route => route.fulfill({json: new URL(route.request().url()).searchParams.get('action') === 'stats'
      ? {total:30,last7:7,last30:30,favorites:3,free:29,pro:1,registrations:Array.from({length:30},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,count:i%5}))}
      : {authorized:true,id:'chart-test',email:'chart@example.invalid'}}))
    await page.goto('/admin')
    const days=page.locator('.admin-chart-day')
    await expect(days).toHaveCount(30)
    const geometry=await page.locator('.admin-chart-scroll').evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth}))
    expect(geometry.scroll).toBeGreaterThan(geometry.client)
    const label=await page.locator('.admin-chart-date').first().evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,font:parseFloat(getComputedStyle(element).fontSize)}))
    expect(label.font).toBeGreaterThanOrEqual(12); expect(label.scroll).toBeLessThanOrEqual(label.width)
    const heights=await page.locator('.admin-chart-bar').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height))
    expect(heights[0]).toBe(0); expect(heights[2]).toBeCloseTo(heights[1]*2,1); expect(heights[4]).toBe(160)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:`docs/admin-screenshots/admin-${width}-bg-light.png`,fullPage:true})
    await days.last().click(); await expect(page.locator('.admin-chart-value')).toHaveText('2026-09-30: 4')
    await page.getByRole('button',{name:'EN',exact:true}).click()
    await page.getByRole('button',{name:'Toggle theme'}).click()
    await expect(page.locator('.admin-app')).toHaveClass(/admin-dark/)
    await page.locator('.admin-chart-scroll').evaluate(element=>{element.scrollLeft=0})
    await page.screenshot({path:`docs/admin-screenshots/admin-${width}-en-dark.png`,fullPage:true})
    await page.getByText('Basic information',{exact:true}).click()
    await expect(page.locator('.admin-card details li')).toHaveCount(30)
    await expect(page.locator('.admin-card details li').last()).toHaveText('2026-09-30: 4')
    await page.locator('.admin-chart-day').first().focus()
    await page.keyboard.press('Enter'); await expect(page.locator('.admin-chart-value')).toHaveText('2026-09-01: 0')
  })
}
