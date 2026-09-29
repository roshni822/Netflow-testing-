// All APIs are intercepted. No real reset token/account is used or changed.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../../output/reset-password-qa/', import.meta.url))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined })
  const page = await browser.newPage({ viewport: { width: 1366, height: 640 }, reducedMotion: 'reduce' })
  const errors = [], unexpected = [], posts = [], validations = []
  let mode = 'hold', heldValidation, releaseReady
  const ready = new Promise((resolve) => { releaseReady = resolve })
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/api/auth/reset-password/validate') {
      validations.push(Object.fromEntries(url.searchParams))
      if (mode === 'hold') { heldValidation = route; releaseReady(); return }
      if (mode === 'network') return route.abort()
      return route.fulfill({ headers, json: { valid: mode === 'valid' } })
    }
    if (url.pathname === '/api/auth/reset-password') { posts.push({ route, body: request.postDataJSON() }); return }
    unexpected.push(url.pathname)
    return route.abort()
  })
  const markup = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MemoryRouter, Routes, Route} from 'react-router-dom';
    import '/src/index.css'; import ResetPassword from '/src/pages/ResetPassword.jsx';
    const e=React.createElement;
    const query=new URLSearchParams(location.search).has('missing')?'':'?token=fixture-token%2B%26&email=fixture%2Breset%40example.test';
    createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:['/reset-password'+query]},e(Routes,null,
      e(Route,{path:'/reset-password',element:e(ResetPassword)}),
      e(Route,{path:'/login',element:e('h1',null,'Login fixture')}),
      e(Route,{path:'/forgot-password',element:e('h1',null,'Forgot password fixture')})
    )));
  </script></body></html>`
  const html = await server.transformIndexHtml('/__reset-password-test', markup)
  await page.route('**/__reset-password-test*', (route) => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.continue())
  const open = (query = '') => page.goto(new URL('__reset-password-test' + query, origin).href)
  const screenshot = (name) => page.screenshot({ path: output + name + '.png', fullPage: true, animations: 'disabled' })
  await mkdir(output, { recursive: true })
  await open()
  await ready
  await page.getByRole('heading', { name: 'Checking your reset link' }).waitFor()
  assert.equal(await page.locator('.nf-auth-page').count(), 0)
  assert.ok(await page.getByRole('status').isVisible())
  await screenshot('checking')
  assert.deepEqual(validations[0], { token: 'fixture-token+&', email: 'fixture+reset@example.test' })
  await heldValidation.fulfill({ headers, json: { valid: true } })
  await page.getByRole('heading', { name: 'Create a new password' }).waitFor()
  const hintColor = await page.locator('#password-hint').evaluate((element) => getComputedStyle(element).color)
  for (const [name, width, height, dark] of [['desktop',1366,640,false], ['mobile',375,812,false], ['mobile-dark',375,812,true], ['landscape',812,375,false]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark)
    assert.equal(await page.locator('#password-hint').evaluate((element) => getComputedStyle(element).color), hintColor, 'White auth card keeps readable hint colors in both theme settings')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await screenshot(name)
  }
  const password = page.getByLabel('New password', { exact: true })
  const confirm = page.getByLabel('Confirm password', { exact: true })
  const submit = page.getByRole('button', { name: 'Update password', exact: true })
  await submit.click()
  await page.getByRole('alert').filter({ hasText: 'Enter a new password' }).waitFor()
  await password.fill('123')
  await submit.click()
  await page.getByRole('alert').filter({ hasText: 'Use at least 12 characters' }).waitFor()
  assert.ok(await password.evaluate((element) => element === document.activeElement))
  for (const value of ['password1234', 'abcabcabcabc', 'cedar-river-' + 'x'.repeat(61)]) {
    await password.fill(value)
    await confirm.fill(value)
    await submit.click()
    assert.equal(posts.length, 0, 'Invalid new password is not submitted')
    assert.equal(await password.getAttribute('aria-invalid'), 'true')
  }
  await password.fill('fixture-password')
  await confirm.fill('different')
  await submit.click()
  await page.getByRole('alert').filter({ hasText: 'Passwords do not match' }).waitFor()
  assert.equal(posts.length, 0)
  await confirm.fill('fixture-password')
  await page.getByRole('status').filter({ hasText: 'Passwords match' }).waitFor()
  await password.fill('another cedar valley')
  assert.equal(await confirm.getAttribute('aria-invalid'), 'true')
  await password.fill('fixture-password')
  await page.getByRole('button', { name: 'Show passwords' }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await password.getAttribute('type'), 'text')
  assert.equal(await confirm.getAttribute('type'), 'text')
  await page.getByRole('button', { name: 'Hide passwords' }).click()
  assert.equal(await password.getAttribute('type'), 'password')
  assert.equal(await password.getAttribute('autocomplete'), 'new-password')
  await submit.click()
  await page.getByRole('button', { name: 'Updating…' }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Updating…' }).isDisabled())
  assert.deepEqual(posts[0].body, { token: 'fixture-token+&', email: 'fixture+reset@example.test', password: 'fixture-password' })
  await posts[0].route.fulfill({ status: 400, headers, json: { error: 'Reset request could not be completed' } })
  await page.getByRole('alert').filter({ hasText: 'Reset request could not be completed' }).waitFor()
  assert.equal(await password.inputValue(), 'fixture-password')
  await page.setViewportSize({ width: 1366, height: 640 })
  await screenshot('server-error')
  await submit.click()
  await page.getByRole('button', { name: 'Updating…' }).waitFor()
  await posts[1].route.fulfill({ headers, json: { success: true } })
  await page.getByRole('heading', { name: 'Your password is ready' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Go to sign in' }).getAttribute('href'), '/login')
  await screenshot('success')
  await page.getByRole('heading', { name: 'Login fixture' }).waitFor()
  for (const state of ['invalid', 'network', 'missing']) {
    mode = state
    const count = validations.length
    await open(state === 'missing' ? '?missing' : '')
    await page.getByRole('heading', { name: 'Link expired or invalid' }).waitFor()
    assert.equal(await page.locator('input[type=password]').count(), 0)
    assert.equal(await page.locator('.nf-saas-login-card').count(), 1)
    if (state === 'missing') assert.equal(validations.length, count)
    await screenshot(state)
    await page.getByRole('link', { name: 'Request a new link' }).click()
    await page.getByRole('heading', { name: 'Forgot password fixture' }).waitFor()
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  console.log('Reset UI passed: shared layout in all states, token/email encoding, validation, visibility, busy/errors/success, automatic login redirect, missing/invalid/network links, desktop/mobile/dark/landscape. APIs were isolated fixtures.')
} finally {
  await browser?.close()
  await server.close()
}
