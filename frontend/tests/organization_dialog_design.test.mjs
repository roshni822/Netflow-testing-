// Actual OrgDialog and styles; isolated API fixtures only. No tenant is created.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../../output/organization-dialog-qa/', import.meta.url))
const server = await createServer({ root, optimizeDeps: { entries: ['src/pages/PlatformPanel.jsx'], include: ['react-dom/client'] }, plugins: [{ name: 'test-org-dialog-export', enforce: 'pre', transform(code, id) {
  if (id.replaceAll('\\', '/').endsWith('/src/pages/PlatformPanel.jsx')) return code + '\nexport { OrgDialog };'
} }], server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined })
  const page = await browser.newPage({ viewport: { width: 1366, height: 640 }, reducedMotion: 'reduce' })
  const errors = [], unexpected = [], saves = [], tests = []
  let failTest = false
  page.on('pageerror', (error) => errors.push(error.message))
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' }
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/platform/integrations/test') {
      const body = request.postDataJSON()
      tests.push(body)
      if (failTest) return route.fulfill({ status: 400, headers, json: { error: 'Fixture connection failed' } })
      return route.fulfill({ headers, json: { testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), verificationReceipt: body.integration + '-fixture-receipt' } })
    }
    if (path === '/api/platform/orgs' || path === '/api/platform/orgs/fixture-org') {
      saves.push({ route, method: request.method(), body: request.postDataJSON() })
      return
    }
    unexpected.push(path)
    return route.abort()
  })
  const html = await server.transformIndexHtml('/__org-dialog-test', `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';
    import {OrgDialog} from '/src/pages/PlatformPanel.jsx';import Modal from '/src/components/Modal.jsx';
    const e=React.createElement;
    const org=new URLSearchParams(location.search).has('edit')?{_id:'fixture-org',name:'Fixture workspace',subdomain:'permanent-slug',plan:'custom',allowedDomains:['example.test'],features:{externalUsers:true},pdfAutoFill:{entitlementOverride:true},limits:{maxUsers:17},integrations:{dmsEnabled:true,dmsApiKey:'saved-fixture-key',dmsOrgSlug:'fixture',s3:{enabled:false,secretAccessKey:'saved-fixture-secret'}}}:null;
    function App(){const [open,setOpen]=React.useState(true);return e(React.Fragment,null,e('button',{onClick:()=>setOpen(true)},'Open organization'),open?(new URLSearchParams(location.search).has('plain')?e(Modal,{title:'Standard dialog',onClose:()=>setOpen(false)},e('p',null,'No maximize opt-in')):e(OrgDialog,{org,onClose:()=>setOpen(false),onSaved:()=>{setOpen(false);window.saved=true}})):e('h1',null,window.saved?'Saved fixture':'Closed fixture'))}
    createRoot(document.getElementById('root')).render(e(App));
  </script></body></html>`)
  await page.route('**/__org-dialog-test*', (route) => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: html }) : route.continue())
  const open = (query = '') => page.goto(new URL('__org-dialog-test' + query, server.resolvedUrls.local[0]).href)
  const dialog = page.getByRole('dialog')
  const toggle = (name) => dialog.getByRole('switch', { name, exact: true })
  const submit = () => dialog.getByRole('button', { name: /^(Create organization|Save changes)$/ })
  const values = () => dialog.evaluate((node) => ({
    fields: [...node.querySelectorAll('input')].map((field) => field.value),
    switches: [...node.querySelectorAll('[role=switch]')].map((field) => field.getAttribute('aria-checked'))
  }))
  const resize = async (name) => {
    await dialog.evaluate(async () => {
      await document.fonts.ready
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const before = await values()
    const normal = await dialog.boundingBox()
    const originalInput = await dialog.locator('input').first().elementHandle()
    await dialog.getByRole('button', { name: 'Maximize dialog', exact: true }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await dialog.getAttribute('data-maximized'), 'true')
    await page.waitForFunction(() => {
      const bounds = document.querySelector('[role=dialog]').getBoundingClientRect()
      return Math.abs(bounds.height - innerHeight + 32) < 2 && Math.abs(bounds.width - innerWidth + 32) < 2
    })
    const restore = dialog.getByRole('button', { name: 'Restore dialog size', exact: true })
    assert.equal(await restore.getAttribute('aria-pressed'), 'true')
    assert.ok(await restore.evaluate((element) => element === document.activeElement))
    const expanded = await dialog.boundingBox(), viewport = page.viewportSize()
    assert.ok(Math.abs(expanded.width - (viewport.width - 32)) < 2, 'Maximized width uses available viewport')
    assert.ok(Math.abs(expanded.height - (viewport.height - 32)) < 2, 'Maximized height uses available viewport')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const footerBefore = await submit().boundingBox()
    assert.ok(footerBefore.y + footerBefore.height <= viewport.height)
    await dialog.locator('form').evaluate((form) => { form.parentElement.scrollTop = 0 })
    await page.screenshot({ path: output + 'maximized-' + name + '.png', fullPage: true })
    await dialog.getByRole('heading', { name: 'Integrations', exact: true }).scrollIntoViewIfNeeded()
    const footerAfter = await submit().boundingBox()
    assert.ok(Math.abs(footerBefore.y - footerAfter.y) < 1)
    await restore.click()
    assert.equal(await dialog.getAttribute('data-maximized'), 'false')
    await page.waitForFunction((normal) => {
      const bounds = document.querySelector('[role=dialog]').getBoundingClientRect()
      return Math.abs(bounds.width - normal.width) < 2 && Math.abs(bounds.height - normal.height) < 2
    }, normal)
    const restored = await dialog.boundingBox()
    assert.ok(Math.abs(restored.width - normal.width) < 2 && Math.abs(restored.height - normal.height) < 2)
    assert.deepEqual(await values(), before, 'Resize must preserve every input and switch')
    assert.ok(await originalInput.evaluate((element) => element.isConnected), 'Resize does not remount form controls')
  }
  await mkdir(output, { recursive: true })
  await open()
  await dialog.waitFor()
  assert.equal(await dialog.locator('input[type=checkbox]').count(), 0)
  assert.equal(await toggle('Grant builder access').getAttribute('aria-checked'), 'true')
  assert.equal(await toggle('Count toward user & builder seats').getAttribute('aria-checked'), 'true')
  assert.equal(await toggle('Allow external domains').getAttribute('aria-checked'), 'false')
  assert.ok(await dialog.getByLabel('Name', { exact: true }).evaluate((element) => element === document.activeElement))
  for (const [name, width, height, dark] of [['desktop',1366,640,false],['mobile',375,812,false],['mobile-dark',375,812,true],['landscape',812,375,false]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark)
    await dialog.locator('form').evaluate((form) => { form.parentElement.scrollTop = 0 })
    const footerBefore = await submit().boundingBox()
    assert.ok(footerBefore.y >= 0 && footerBefore.y + footerBefore.height <= height)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth), false)
    await page.screenshot({ path: output + name + '.png', fullPage: true })
    await dialog.getByRole('heading', { name: 'Integrations', exact: true }).scrollIntoViewIfNeeded()
    const footerAfter = await submit().boundingBox()
    assert.ok(Math.abs(footerBefore.y - footerAfter.y) < 1, 'Footer does not scroll away')
    await resize(name)
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await dialog.getByRole('heading', { name: 'First organization admin', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: output + 'admin-toggles.png', fullPage: true })
  await toggle('Grant builder access').focus()
  await page.keyboard.press('Space')
  assert.equal(await toggle('Grant builder access').getAttribute('aria-checked'), 'false')
  await toggle('Count toward user & builder seats').click()
  await toggle('Allow external domains').click()
  assert.equal(saves.length, 0, 'Switches do not save immediately')
  await dialog.getByLabel('Name', { exact: true }).fill('  Fixture tenant  ')
  await dialog.getByLabel('Allowed email domains', { exact: false }).fill('example.test')
  await dialog.getByLabel('Admin email', { exact: true }).fill('admin@example.test')
  await dialog.getByLabel('Admin name (optional)', { exact: true }).fill('Fixture admin')
  await resize('filled-form')
  await dialog.getByRole('button', { name: /^Professional/ }).click()
  assert.equal(await dialog.getByLabel('Users', { exact: false }).first().inputValue(), '50')
  await dialog.getByLabel('Users', { exact: false }).first().fill('77')
  await toggle('Enable DMS integration').click()
  assert.ok(await submit().isDisabled())
  await dialog.getByLabel('DMS API Key', { exact: false }).fill('fixture-dms-key')
  await dialog.getByLabel('DMS connection name (optional)', { exact: true }).fill('Tenant document service')
  await dialog.getByLabel('DMS API base URL', { exact: false }).fill('https://documents.example.test/api')
  await dialog.getByRole('button', { name: 'Test DMS connection' }).click()
  await dialog.locator('[data-status=connected]').waitFor()
  assert.ok(await submit().isEnabled())
  assert.equal(tests.at(-1).config.baseUrl, 'https://documents.example.test/api')
  await dialog.getByLabel('DMS API base URL', { exact: false }).fill('https://documents2.example.test/api')
  assert.ok(await submit().isDisabled(), 'Changing the DMS endpoint invalidates the verification')
  await dialog.getByRole('button', { name: 'Retry DMS connection' }).click()
  await dialog.locator('[data-status=connected]').waitFor()
  for (const [name, width, height, dark] of [['desktop',1366,768,false],['mobile',375,812,false],['mobile-dark',375,812,true]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark)
    await dialog.getByLabel('DMS API base URL', { exact: false }).scrollIntoViewIfNeeded()
    assert.equal(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth), false)
    await page.screenshot({ path: output + 'dynamic-dms-' + name + '.png', fullPage: true })
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await dialog.getByLabel('DMS org slug (optional)', { exact: false }).fill('fixture-slug')
  assert.ok(await submit().isDisabled(), 'Editing a verified integration requires retesting')
  await dialog.getByRole('button', { name: 'Retry DMS connection' }).click()
  await dialog.locator('[data-status=connected]').waitFor()
  await toggle('Enable S3 integration').click()
  assert.ok(await dialog.getByRole('button', { name: 'Test S3 connection' }).isDisabled())
  await dialog.getByLabel('Bucket Name', { exact: true }).fill('fixture-bucket')
  await dialog.getByLabel('Access Key ID', { exact: true }).fill('fixture-access')
  await dialog.getByLabel('Secret Access Key', { exact: true }).fill('fixture-secret')
  failTest = true
  await dialog.getByRole('button', { name: 'Test S3 connection' }).click()
  await dialog.locator('[data-status=failed]').waitFor()
  assert.ok(await submit().isDisabled())
  failTest = false
  await dialog.getByRole('button', { name: 'Retry S3 connection' }).click()
  await dialog.locator('[data-status=connected]').nth(1).waitFor()
  const testCount = tests.length
  await resize('verified-integrations')
  assert.equal(await dialog.locator('[data-status=connected]').count(), 2)
  assert.equal(tests.length, testCount, 'Resize does not restart connection tests')
  assert.ok(await submit().isEnabled())
  await page.screenshot({ path: output + 'integrations.png', fullPage: true })
  await submit().click()
  await dialog.getByRole('button', { name: 'Saving…' }).waitFor()
  const created = saves[0].body
  assert.equal(created.integrations.dmsName, 'Tenant document service')
  assert.equal(created.integrations.dmsBaseUrl, 'https://documents2.example.test/api')
  assert.equal(saves[0].method, 'POST')
  assert.equal(created.name, 'Fixture tenant')
  assert.equal(created.adminEmail, 'admin@example.test')
  assert.equal(created.adminCanBuild, false)
  assert.equal(created.countAdminTowardSeats, false)
  assert.equal(created.features.externalUsers, true)
  assert.equal(created.plan, 'professional')
  assert.equal(created.limits.maxUsers, 77)
  assert.deepEqual(created.integrationVerifications, { dms: 'dms-fixture-receipt', s3: 's3-fixture-receipt' })
  await saves[0].route.fulfill({ status: 400, headers, json: { error: 'Fixture save error' } })
  await submit().waitFor()
  assert.equal(await dialog.getByLabel('Name', { exact: true }).inputValue(), '  Fixture tenant  ')
  await submit().click()
  await dialog.getByRole('button', { name: 'Saving…' }).waitFor()
  await saves[1].route.fulfill({ headers, json: { success: true } })
  await page.getByRole('heading', { name: 'Saved fixture' }).waitFor()

  await open('?edit')
  await dialog.waitFor()
  assert.equal(await dialog.getByLabel('Admin email', { exact: true }).count(), 0)
  await toggle('Enable PDF Auto-Fill entitlement').click()
  await toggle('Allow external domains').click()
  await dialog.getByRole('button', { name: 'Test DMS connection' }).click()
  await dialog.locator('[data-status=connected]').waitFor()
  assert.equal(tests.at(-1).orgId, 'fixture-org')
  assert.equal(Object.hasOwn(tests.at(-1).config, 'apiKey'), false)
  await resize('edit')
  assert.equal(await dialog.locator('[data-status=connected]').count(), 1)
  await submit().click()
  await dialog.getByRole('button', { name: 'Saving…' }).waitFor()
  const edited = saves[2].body
  assert.equal(saves[2].method, 'PUT')
  assert.equal(Object.hasOwn(edited, 'subdomain'), false)
  assert.equal(Object.hasOwn(edited, 'adminEmail'), false)
  assert.equal(Object.hasOwn(edited.integrations, 'dmsApiKey'), false)
  assert.equal(Object.hasOwn(edited.integrations.s3, 'secretAccessKey'), false)
  assert.equal(edited.pdfAutoFillEntitlementOverride, false)
  assert.equal(edited.features.externalUsers, false)
  assert.equal(edited.limits.maxUsers, 17)
  await saves[2].route.fulfill({ headers, json: { success: true } })
  await page.getByRole('heading', { name: 'Saved fixture' }).waitFor()
  await open()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Maximize dialog', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  assert.ok(await submit().evaluate((element) => element === document.activeElement), 'Focus stays within dialog')
  await dialog.getByRole('button', { name: 'Maximize dialog', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('heading', { name: 'Closed fixture' }).waitFor()
  await page.getByRole('button', { name: 'Open organization' }).click()
  assert.equal(await dialog.getAttribute('data-maximized'), 'false', 'Reopening starts at normal size')
  await open('?plain')
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Maximize dialog' }).count(), 0, 'Other dialogs are not opted in')
  assert.equal(await dialog.getAttribute('data-maximized'), null)
  assert.equal(Math.round((await dialog.boundingBox()).width), 448, 'Default modal size unchanged')
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  console.log('Organization dialog passed: no checkboxes, switch defaults/keyboard/payloads, plans/limits, create/edit, masked secrets, integration gating/retesting/failure, save error retention, fixed footer, focus trap/Escape, desktop/mobile/dark/landscape. No real API writes.')
} finally { await browser?.close(); await server.close() }
