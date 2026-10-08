import { test, expect } from '@playwright/test'
import { setup } from './admin-fixture'
const phase=process.env.ADMIN_SCREENSHOT_PHASE || 'after'
for(const width of [320,390,768,1440]) for(const lang of ['bg','en']) for(const theme of ['light','dark']) test(`stage5 ${width} ${lang} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);await page.goto('/admin')
 await expect(page.locator('.admin-stats strong').first()).toHaveText('3')
 if(lang==='en')await page.getByRole('button',{name:'EN',exact:true}).click()
 if(theme==='dark')await page.getByRole('button',{name:lang==='bg'?'Смени темата':'Toggle theme'}).click()
 const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`docs/admin-stage5-screenshots/${phase}/${name}-${width}-${lang}-${theme}.png`,fullPage:true,animations:'disabled'})}
 const navigate=async(name:string)=>{const menu=page.getByRole('button',{name:lang==='bg'?'Меню':'Menu',exact:true});if(await menu.isVisible() && await menu.getAttribute('aria-expanded')==='false')await menu.click();await page.locator('nav').getByRole('button',{name,exact:true}).click()}
 await expect(page.getByRole('heading',{name:lang==='bg'?'Състояние и последни действия':'Status and recent actions'})).toBeVisible();await shot('dashboard')
 await navigate(lang==='bg'?'Потребители':'Users');await page.getByRole('button',{name:'isolated-user@example.invalid'}).click();await expect(page.locator('.admin-detail')).toContainText('София');await expect(page.locator('.admin-management')).toContainText(lang==='bg'?'История за този акаунт':'Account history');await shot('users')
 await page.getByRole('button',{name:lang==='bg'?'Предостави ръчно Pro':'Grant manual Pro'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:lang==='bg'?'Потвърди':'Confirm',exact:true})).toBeFocused();await shot('confirm');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible()
 await navigate(lang==='bg'?'Журнал на действията':'Action log');await expect(page.locator('.admin-audit-table')).toBeVisible();await shot('audit')
 await navigate(lang==='bg'?'Статистики':'Statistics');await expect(page.locator('.admin-metric-chart')).toHaveCount(4);await shot('statistics')
 await navigate(lang==='bg'?'Състояние на системата':'System status');await expect(page.locator('.admin-health')).toHaveCount(3);await shot('system')
 await navigate(lang==='bg'?'Администраторски профил':'Administrator profile');await expect(page.getByText('Имейл: admin@example.invalid').or(page.getByText('Email: admin@example.invalid'))).toBeVisible();await shot('profile')
})

for (const timezoneId of ['Europe/Sofia','America/New_York']) test(`local timezone, compact history and UUID keyboard copy ${timezoneId}`,async({browser})=>{
 const context=await browser.newContext({timezoneId,permissions:['clipboard-read','clipboard-write'],viewport:{width:390,height:844}})
 const page=await context.newPage();const state=await setup(page,{historyCount:8});await page.goto('/admin');await expect(page.locator('.admin-stats strong').first()).toHaveText('3')
 const go=async(name:string)=>{await page.getByRole('button',{name:'Меню',exact:true}).click();await page.locator('nav').getByRole('button',{name,exact:true}).click()}
 await go('Потребители');await page.getByRole('button',{name:'isolated-user@example.invalid'}).click();await expect(page.locator('.admin-history .admin-audit-entry')).toHaveCount(3)
 const expand=page.locator('.admin-management > button[aria-controls]');await expand.focus();await page.keyboard.press('Enter');await expect(expand).toHaveAttribute('aria-expanded','true');await expect(page.locator('.admin-history .admin-audit-entry')).toHaveCount(8)
 const count=state.reads.length;await page.getByRole('button',{name:/Покажи по-малко/}).click();expect(state.reads.length).toBe(count)
 await go('Журнал на действията');const entry=page.locator('.admin-audit-entry').first();await expect(entry.locator('time')).toContainText(timezoneId);await expect(entry.locator('time')).toContainText(timezoneId==='Europe/Sofia'?'14:00':'7:00')
 await expect(entry.locator('code').first()).not.toBeVisible();await entry.locator('summary').focus();await page.keyboard.press('Enter');await expect(entry).toHaveAttribute('open','');await expect(entry).toContainText('2026-10-08T11:00:00.000Z')
 await entry.getByRole('button',{name:'Копирай UUID'}).last().click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('00000000-0000-0000-0000-000000000002')
 await expect(page.locator('.admin-outcome-not_found')).toHaveCount(1);expect(state.calls).toHaveLength(0)
 await page.getByRole('button',{name:'Меню',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Меню',exact:true})).toHaveAttribute('aria-expanded','true');await expect(page.locator('nav button').first()).toBeFocused();await context.close()
})
