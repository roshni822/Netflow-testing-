// Isolated component/API fixtures; never sends passwords to a real server.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../../output/change-password-qa/', import.meta.url))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined })
  const page = await browser.newPage({ viewport: { width: 1366, height: 640 }, reducedMotion: 'reduce' })
  const errors = []
  const changeRequests = []
  const unexpected = []
  let logoutCount = 0
  page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser error:', error.message) })
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  const session = { token: 'isolated-fixture-token', user: { _id: 'fixture', name: 'Test user', mustChangePassword: false } }
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/auth/change-password') { changeRequests.push({ route, body: req.postDataJSON() }); return }
    if (path === '/api/auth/logout') { logoutCount++; return route.fulfill({ headers, json: { success: true } }) }
    if (path === '/api/auth/sso/config') return route.fulfill({ headers, json: { microsoft: false } })
    if (path === '/api/auth/login') return route.fulfill({ headers, json: { mfaRequired: true, challenge: 'fixture-challenge' } })
    if (path === '/api/auth/mfa/verify') return route.fulfill({ headers, json: session })
    unexpected.push(path)
    return route.abort()
  })
  const markup = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MemoryRouter, Routes, Route, useLocation} from 'react-router-dom';
    import '/src/index.css'; import ChangePassword from '/src/pages/ChangePassword.jsx';
    import Login from '/src/pages/Login.jsx'; import {authStore} from '/src/utils/auth';
    const params = new URLSearchParams(window.location.search);
    authStore._setSession({token:'isolated-fixture-token',user:{_id:'fixture',mustChangePassword:params.has('forced')}});
    const e = React.createElement;
    function Location(){const location=useLocation(); React.useEffect(()=>{window.testRoute=location.pathname},[location]);return null}
    createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:[params.has('login')?'/login':'/change-password']},
      e(Location),e(Routes,null,
        e(Route,{path:'/change-password',element:e(ChangePassword)}),e(Route,{path:'/login',element:e(Login)}),
        e(Route,{path:'/dashboard',element:e('h1',null,'Dashboard fixture')}),e(Route,{path:'/profile',element:e('h1',null,'Profile fixture')})
      )));
  </script></body></html>`
  const html = await server.transformIndexHtml('/__change-password-test', markup)
  await page.route('**/__change-password-test*', (route) => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.continue())
  const open = (query = '') => page.goto(new URL('__change-password-test' + query, origin).href)
  await mkdir(output, { recursive: true })
  for (const forced of [false, true]) {
    await open(forced ? '?forced' : '')
    await page.getByRole('heading', { name: forced ? 'Set a new password' : 'Change your password', exact: true }).waitFor()
    assert.equal(await page.locator('.nf-auth-page').count(), 0, 'Old layout is not used')
    assert.equal(await page.getByLabel('Current password', { exact: true }).count(), forced ? 0 : 1)
    const hintColor = await page.locator('#new-password-hint').evaluate((element) => getComputedStyle(element).color)
    for (const [name, width, height, dark] of [['desktop',1366,640,false], ['mobile',375,812,false], ['mobile-dark',375,812,true], ['landscape',812,375,false]]) {
      await page.setViewportSize({ width, height })
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark)
      assert.equal(await page.locator('#new-password-hint').evaluate((element) => getComputedStyle(element).color), hintColor, 'White auth card keeps readable hint colors in both theme settings')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      const submit = page.getByRole('button', { name: forced ? 'Set password and continue' : 'Update password', exact: true })
      await submit.scrollIntoViewIfNeeded()
      assert.ok(await submit.isVisible())
      await page.screenshot({ path: output + (forced ? 'forced-' : '') + name + '.png', fullPage: true, animations: 'disabled' })
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await open()
  const current = page.getByLabel('Current password', { exact: true })
  const next = page.getByLabel('New password', { exact: true })
  const confirm = page.getByLabel('Confirm new password', { exact: true })
  const submit = page.getByRole('button', { name: 'Update password', exact: true })
  await submit.click()
  await page.getByRole('alert').filter({ hasText: 'Enter your current password' }).waitFor()
  assert.equal(changeRequests.length, 0)
  await current.fill('old-fixture')
  await next.fill('123')
  await submit.click()
  await page.getByRole('alert').filter({ hasText: 'at least 12 characters' }).waitFor()
  assert.ok(await next.evaluate((element) => element === document.activeElement))
  for (const value of ['password1234', 'abcabcabcabc', 'cedar-river-' + 'x'.repeat(61)]) {
    await next.fill(value)
    await confirm.fill(value)
    await submit.click()
    assert.equal(changeRequests.length, 0, 'Invalid new password is not submitted')
    assert.equal(await next.getAttribute('aria-invalid'), 'true')
  }
  await current.fill('existing cedar valley')
  await next.fill('existing cedar valley')
  await confirm.fill('existing cedar valley')
  await submit.click()
  await page.getByRole('alert').filter({ hasText: 'different from the current one' }).waitFor()
  assert.equal(changeRequests.length, 0)
  await current.fill('old-fixture')
  await next.fill('cedar river!')
  await confirm.fill('different')
  assert.equal(await confirm.getAttribute('aria-invalid'), 'true')
  assert.equal(changeRequests.length, 0)
  await confirm.fill('cedar river!')
  await page.getByRole('status').filter({ hasText: 'Passwords match' }).waitFor()
  assert.equal(await page.getByRole('list', { name: 'Password requirements' }).getByText('Met:', { exact: false }).count(), 2)
  // Editing the new password must immediately invalidate a previously matching confirmation.
  await next.fill('cedar river moon')
  assert.equal(await confirm.getAttribute('aria-invalid'), 'true')
  await next.fill('cedar river!')
  await page.getByRole('checkbox', { name: 'Show passwords' }).focus()
  await page.keyboard.press('Space')
  assert.equal(await next.getAttribute('type'), 'text')
  await page.keyboard.press('Space')
  assert.equal(await next.getAttribute('type'), 'password')
  assert.equal(await current.getAttribute('autocomplete'), 'current-password')
  assert.equal(await next.getAttribute('autocomplete'), 'new-password')
  await submit.click()
  await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Saving…' }).isDisabled())
  assert.deepEqual(changeRequests[0].body, { currentPassword: 'old-fixture', newPassword: 'cedar river!' })
  await changeRequests[0].route.fulfill({ status: 400, headers, json: { error: 'Current password is incorrect' } })
  await page.getByRole('alert').filter({ hasText: 'Current password is incorrect' }).waitFor()
  assert.equal(await next.inputValue(), 'cedar river!', 'Server errors preserve input')
  await submit.click()
  await page.getByRole('button', { name: 'Saving…' }).waitFor()
  await changeRequests[1].route.fulfill({ headers, json: session })
  await page.getByRole('heading', { name: 'Dashboard fixture' }).waitFor()
  await open('?forced')
  await next.fill('forced-fixture')
  await confirm.fill('forced-fixture')
  await page.getByRole('button', { name: 'Set password and continue' }).click()
  await page.getByRole('button', { name: 'Saving…' }).waitFor()
  assert.deepEqual(changeRequests[2].body, { newPassword: 'forced-fixture' })
  await changeRequests[2].route.fulfill({ headers, json: session })
  await page.getByRole('heading', { name: 'Dashboard fixture' }).waitFor()
  await open()
  await page.getByRole('link', { name: 'Back to profile' }).click()
  await page.getByRole('heading', { name: 'Profile fixture' }).waitFor()
  await open('?forced')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
  assert.equal(logoutCount, 1)
  await page.screenshot({ path: output + 'login.png', fullPage: true, animations: 'disabled' })
  await page.getByLabel('Email address', { exact: true }).fill('fixture@example.test')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.getByRole('heading', { name: 'Two-factor authentication' }).waitFor()
  await page.getByPlaceholder('Enter the 6-digit code').fill('123456')
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await page.getByRole('heading', { name: 'Dashboard fixture' }).waitFor()
  assert.deepEqual(unexpected, [])
  assert.deepEqual(errors, [])
  console.log('Auth UI passed: shared login design, regular/forced change, validation, visibility, busy/error/success, API payloads, back/logout, login/MFA, desktop/mobile/dark/landscape. APIs were isolated fixtures.')
} finally {
  await browser?.close()
  await server.close()
}
