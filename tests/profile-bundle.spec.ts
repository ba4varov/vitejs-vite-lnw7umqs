import {test,expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {fixture} from './profile-fixture'

test('built entry JS and CSS bytes contain the redesign and render the wide four-tab profile',async({page})=>{
 const root=process.env.PROFILE_BUILT_DIST
 test.skip(!root,'Run with the built-profile config to verify compiled assets rather than the dev server')
 await fixture(page,'bg')
 const paths=await page.locator('script[src],link[rel=stylesheet]').evaluateAll(elements=>elements.map(e=>e.getAttribute('src')||e.getAttribute('href')).filter((value):value is string=>Boolean(value)))
 expect(paths.some(path=>path.startsWith('/assets/')&&path.endsWith('.js'))).toBe(true)
 for(const path of paths.filter(path=>path.startsWith('/assets/'))){
  const response=await page.request.get(path);expect(response.ok()).toBe(true)
  const served=await response.body(),local=await readFile(`${root}${path}`)
  expect(createHash('sha256').update(served).digest('hex')).toBe(createHash('sha256').update(local).digest('hex'))
  expect(served.toString()).toContain('profile-dialog');expect(served.toString()).toContain('profile-tabs')
 }
 await page.setViewportSize({width:1440,height:900})
 await page.locator('.auth-nav').getByRole('button',{name:'Моят профил',exact:true}).click()
 await expect(page.locator('.profile-dialog .profile-tabs [role=tab]')).toHaveCount(4)
 expect((await page.locator('.profile-dialog').boundingBox())!.width).toBe(960)
 await expect(page.getByRole('tabpanel')).toHaveCount(1)
})
