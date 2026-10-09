import {test,expect} from '@playwright/test'
import {fixture} from './profile-fixture'
for(const width of [390,768,1440])for(const lang of ['bg','en'] as const)for(const failed of [false,true])test(`profile height and API states ${width} ${lang} ${failed?'failed':'loaded'}`,async({page})=>{
 await page.setViewportSize({width,height:900});await fixture(page,lang,'pro')
 if(failed){
  for(const endpoint of ['profile','alerts','push','activity'])await page.route(`**/api/${endpoint}**`,r=>r.fulfill({status:503,json:{error:'ISOLATED_UNAVAILABLE'}}))
 }
 await page.locator('.auth-nav').getByRole('button',{name:lang==='bg'?'Моят профил':'My profile',exact:true}).click()
 const dialog=page.getByRole('dialog'),tabs=dialog.getByRole('tab'),header=dialog.locator('.auth-dialog-header')
 await expect(dialog.locator('.profile-plan')).toContainText(failed?(lang==='bg'?'Планът не е наличен':'Plan unavailable'):(lang==='bg'?'Pro план':'Pro plan'))
 await expect(dialog.locator('.profile-plan')).not.toContainText(lang==='bg'?'Безплатен':'Free')
 if(failed)await expect(dialog.locator('.auth-error')).toContainText(lang==='bg'?'временно не могат да бъдат заредени':'temporarily cannot be loaded')
 const initial=(await header.boundingBox())!,initialTab=(await tabs.first().boundingBox())!,short=(await dialog.boundingBox())!
 if(width>640){expect(short.height).toBeLessThan(700);expect(short.height).toBeGreaterThanOrEqual(440)}
 for(let index=1;index<4;index++){
  await tabs.nth(index).click();await expect(dialog.getByRole('tabpanel')).toHaveCount(1)
  if(failed)await expect(dialog.getByRole('tabpanel')).toContainText(lang==='bg'?(index===3?'временно не може да бъде заредена':'временно не могат да бъдат заредени'):'temporarily cannot be loaded')
  const box=(await dialog.boundingBox())!
  expect(box.y+box.height).toBeLessThanOrEqual(900-8)
  expect(Math.abs((await header.boundingBox())!.y-initial.y)).toBeLessThan(1)
  expect(Math.abs((await tabs.first().boundingBox())!.y-initialTab.y)).toBeLessThan(1)
  expect(await dialog.evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true)
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
  if(!failed&&index===2){
   const content=dialog.locator('.auth-dialog-content')
   expect(await content.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true)
   await content.evaluate(e=>{e.scrollTop=e.scrollHeight})
   expect(Math.abs((await header.boundingBox())!.y-initial.y)).toBeLessThan(1)
   await expect(tabs.first()).toBeVisible()
  }
 }
 await tabs.first().click();expect(Math.abs((await dialog.boundingBox())!.height-short.height)).toBeLessThan(1)
 await expect(page.getByRole('button',{name:lang==='bg'?'Затвори':'Close',exact:true})).toBeEnabled()
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0)
})

test('desktop height stays inside a short viewport',async({page})=>{
 await page.setViewportSize({width:1440,height:480});await fixture(page,'bg')
 await page.locator('.auth-nav').getByRole('button',{name:'Моят профил',exact:true}).click()
 await page.getByRole('tab',{name:'Push известия',exact:true}).click()
 const box=(await page.getByRole('dialog').boundingBox())!
 expect(box.y).toBeGreaterThanOrEqual(16);expect(box.y+box.height).toBeLessThanOrEqual(464)
 await expect(page.getByRole('button',{name:'Затвори',exact:true})).toBeVisible()
})
