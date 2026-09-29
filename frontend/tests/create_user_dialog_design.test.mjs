// Real CreateUserDialog with isolated API responses. Never creates a live user.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../../output/create-user-dialog-qa/', import.meta.url))
const server = await createServer({ root, plugins: [{
  name: 'test-create-user-export', enforce: 'pre', transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/pages/AdminPanel.jsx')) return code + '\nexport { CreateUserDialog, EditUserDialog };'
  },
}], server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
  const errors = [], unexpected = [], saves = []
  let full = false
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('flowsphere_token', 'isolated-fixture-token'))
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/departments') return route.fulfill({ headers, json: { departments: [{ name: 'HR' }, { name: 'Operations' }] } })
    if (path === '/api/usage/licence') return route.fulfill({ headers, json: { licence: { readOnly: false } } })
    if (path === '/api/usage') return route.fulfill({ headers, json: { usage: { resources: { builders: { used: full ? 3 : 1, limit: 3, unlimited: false } } } } })
    if (path === '/api/users' && request.method() === 'POST') {
      saves.push({ route, body: request.postDataJSON() })
      return
    }
    unexpected.push(path)
    return route.abort()
  })
  const html = await server.transformIndexHtml('/__create-user-test', `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';
    import {CreateUserDialog,EditUserDialog} from '/src/pages/AdminPanel.jsx';
    import {useToasts} from '/src/lib/toastStore.js';
    const e=React.createElement;
    const roles=[{_id:'employee',name:'Employee'},{_id:'manager',name:'Manager'}];
    const managers=[{_id:'manager-user',name:'Fixture manager',department:'Operations'}];
    const hrPeople=new URLSearchParams(location.search).has('empty')?[]:[{_id:'hr-user',name:'Fixture HR',department:'HR'}];
    function App(){const [open,setOpen]=React.useState(true);const messages=useToasts();return e(React.Fragment,null,
      e('button',{onClick:()=>setOpen(true)},'Open user'),
      messages.map(t=>e('div',{role:'status',key:t.id},t.message)),
      open?e(new URLSearchParams(location.search).has('edit')?EditUserDialog:CreateUserDialog,{
        roles,managers,hrPeople,user:{_id:'fixture',name:'Existing user',email:'existing@example.test',role:roles[0],department:'HR',canBuild:false},
        onClose:()=>setOpen(false),onCreated:(user,warning)=>{window.created={user,warning};setOpen(false)}
      }):e('h1',null,'Closed fixture'))}
    createRoot(document.getElementById('root')).render(e(App));
  </script></body></html>`)
  await page.route('**/__create-user-test*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: html }) : route.continue())
  const open = async (query = '') => {
    await page.goto(new URL('__create-user-test' + query, server.resolvedUrls.local[0]).href)
    await page.getByRole('dialog').waitFor()
    await page.waitForFunction(() => document.querySelector('select[name=department]')?.value === 'HR')
    await page.getByText(/builder seats used|No free builder seats/).waitFor()
  }
  const dialog = page.getByRole('dialog')
  const submit = () => dialog.getByRole('button', { name: 'Create user', exact: true })
  const seat = () => dialog.getByRole('switch', { name: 'Builder seat', exact: true })
  const field = name => dialog.getByLabel(name, { exact: true })
  const values = () => dialog.evaluate(node => [...node.querySelectorAll('input,select,[role=switch]')].map(el => el.getAttribute('role') === 'switch' ? el.getAttribute('aria-checked') : el.value))
  const resize = async name => {
    const before = await values(), normal = await dialog.boundingBox()
    const original = await field('Full name').elementHandle()
    await dialog.getByRole('button', { name: 'Maximize dialog', exact: true }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await dialog.getAttribute('data-maximized'), 'true')
    await page.waitForFunction(() => {
      const bounds = document.querySelector('[role=dialog]').getBoundingClientRect()
      return Math.abs(bounds.height - innerHeight + 32) < 2 && Math.abs(bounds.width - innerWidth + 32) < 2
    })
    const expanded = await dialog.boundingBox(), viewport = page.viewportSize()
    assert.ok(Math.abs(expanded.width - viewport.width + 32) < 2)
    assert.ok(Math.abs(expanded.height - viewport.height + 32) < 2, JSON.stringify({name,expanded,viewport}))
    await dialog.locator('form').evaluate(form => { form.parentElement.scrollTop = 0 })
    await page.screenshot({ path: output + 'maximized-' + name + '.png' })
    await dialog.getByRole('button', { name: 'Restore dialog size', exact: true }).click()
    assert.equal(await dialog.getAttribute('data-maximized'), 'false')
    assert.deepEqual(await values(), before)
    assert.ok(await original.evaluate(el => el.isConnected))
    assert.ok(Math.abs((await dialog.boundingBox()).width - normal.width) < 2)
  }
  await mkdir(output, { recursive: true })
  await open()
  assert.ok(await field('Full name').evaluate(el => el === document.activeElement))
  assert.equal(await field('Role').inputValue(), 'employee')
  assert.equal(await seat().getAttribute('aria-checked'), 'false')
  assert.equal(await dialog.locator('input[type=checkbox]').count(), 0)
  for (const [name,width,height,dark] of [['desktop',1366,768,false],['mobile',375,812,false],['mobile-dark',375,812,true],['landscape',812,375,false]]) {
    await page.setViewportSize({ width,height })
    await page.evaluate(dark => document.documentElement.classList.toggle('dark',dark),dark)
    await dialog.locator('form').evaluate(form => { form.parentElement.scrollTop = 0 })
    const before = await submit().boundingBox()
    assert.ok(before.y >= 0 && before.y + before.height <= height)
    assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth),false)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
    await page.screenshot({ path: output + name + '.png' })
    await field('Initial password *').scrollIntoViewIfNeeded()
    assert.ok(Math.abs((await submit().boundingBox()).y - before.y) < 1)
    await page.screenshot({ path: output + 'security-' + name + '.png' })
    await resize(name)
  }
  await page.setViewportSize({ width:1366,height:768 })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await submit().click()
  await page.getByRole('status').filter({ hasText:'Name and email are required' }).waitFor()
  assert.equal(saves.length,0)
  await field('Full name').fill('  Fixture person  ')
  await field('Work email').fill('invalid')
  await submit().click()
  await page.getByRole('status').filter({ hasText:'Enter a valid email address' }).waitFor()
  await field('Work email').fill('Person@Example.test')
  await field('Initial password *').fill('short')
  await submit().click()
  await page.getByRole('status').filter({ hasText:'Password must be at least 6 characters' }).waitFor()
  assert.equal(saves.length,0)
  await dialog.getByRole('button',{name:'Generate',exact:true}).click()
  assert.equal((await field('Initial password *').inputValue()).length,10)
  assert.equal(await field('Initial password *').getAttribute('type'),'text')
  await dialog.getByRole('button',{name:'Hide password'}).click()
  assert.equal(await field('Initial password *').getAttribute('type'),'password')
  await field('Initial password *').fill('Fixture-passphrase-2026')
  await field('Role').selectOption('manager')
  await field('Department').selectOption('Operations')
  await field('Reporting manager').selectOption('manager-user')
  await field('HR partner').selectOption('hr-user')
  await seat().focus()
  await page.keyboard.press('Space')
  assert.equal(await seat().getAttribute('aria-checked'),'true')
  assert.equal(saves.length,0,'Switch does not submit')
  await resize('filled')
  await submit().click()
  await dialog.getByRole('button',{name:'Creating…'}).waitFor()
  assert.ok(await dialog.getByRole('button',{name:'Creating…'}).isDisabled())
  assert.deepEqual(saves[0].body,{name:'Fixture person',email:'person@example.test',roleId:'manager',department:'Operations',managerId:'manager-user',hrId:'hr-user',password:'Fixture-passphrase-2026',canBuild:true})
  await saves[0].route.fulfill({status:400,headers,json:{error:'Fixture save failed'}})
  await page.getByRole('status').filter({hasText:'Fixture save failed'}).waitFor()
  assert.equal(await field('Full name').inputValue(),'  Fixture person  ')
  assert.equal(await seat().getAttribute('aria-checked'),'true')
  await submit().click()
  await dialog.getByRole('button',{name:'Creating…'}).waitFor()
  await saves[1].route.fulfill({headers,json:{user:{_id:'created-fixture'},domainWarning:'Fixture domain warning'}})
  await dialog.waitFor({state:'hidden'})
  assert.deepEqual(await page.evaluate(()=>window.created),{user:{_id:'created-fixture'},warning:'Fixture domain warning'})
  full=true
  await open('?empty')
  assert.ok(await seat().isDisabled())
  await seat().evaluate(button => button.click())
  assert.equal(await seat().getAttribute('aria-checked'),'false')
  await page.getByText('No HR-role users yet — create one to assign HR partners.').waitFor()
  await dialog.getByRole('button',{name:'Maximize dialog',exact:true}).focus()
  await page.keyboard.press('Shift+Tab')
  assert.ok(await submit().evaluate(el=>el===document.activeElement))
  await page.keyboard.press('Escape')
  await dialog.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'Open user',exact:true}).click()
  assert.equal(await dialog.getAttribute('data-maximized'),'false')
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
  await dialog.waitFor({state:'hidden'})
  await open('?edit')
  assert.equal(await dialog.getByRole('switch').count(),0,'Edit dialog remains unchanged')
  assert.ok(await dialog.getByRole('checkbox',{name:/Builder seat/}).isDisabled())
  assert.equal(await dialog.getByRole('button',{name:'Maximize dialog'}).count(),0)
  assert.deepEqual(unexpected,[])
  assert.deepEqual(errors,[])
  console.log('PASS create-user dialog: layout, resize, keyboard, quotas, validation, API payload, error recovery and edit isolation')
} finally {
  await browser?.close()
  await server.close()
}
