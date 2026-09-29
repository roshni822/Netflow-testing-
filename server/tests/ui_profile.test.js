// PRF (UI) — the two profile cases that never reach the API.
//
// PRF-008's new/confirm match is enforced entirely in ChangePassword.jsx (the
// API only ever receives newPassword), so it can only be proven in a browser.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['PRF-004', 'PRF-008']

h.runSuite('ui_profile', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  // PRF-004 — "Change avatar/photo (if available)". It isn't: User.avatar
  // exists server-side (and file GC handles replacing it), but nothing in the
  // UI lets anyone pick an image — the circles in the sidebar, admin table and
  // task inbox are colour-coded initials, not uploads.
  h.note('PRF-004', 'N/A', 'No avatar upload exists in the UI — the "avatars" are generated initials. User.avatar is stored but never set by any screen.')

  const org = await h.createOrg('uiprf')
  const user = await h.createUser(org, {
    name: 'UI Prf User', email: h.emailIn(org, 'uiprf-user'), roleName: 'Employee'
  })
  const token = await h.getToken({ email: user.email })

  const browser = await u.launch()
  try {
    const { context, page } = await u.session(browser, { token, workspace: org.subdomain })
    await u.goto(page, '/change-password')
    await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 20000 })

    const current = page.locator('input[autocomplete="current-password"]').first()
    const next = page.locator('input[autocomplete="new-password"]').nth(0)
    const confirm = page.locator('input[autocomplete="new-password"]').nth(1)
    // The label swaps to "Set password & continue" on a forced change, so target
    // the submit role rather than its text.
    const submit = page.locator('form button[type="submit"]').first()

    await current.fill(h.DEFAULT_PASSWORD)
    await next.fill('BrandNew@12345')
    await confirm.fill('Different@12345')
    await submit.click()
    await page.waitForTimeout(800)

    const mismatch = await page.locator('text=/passwords do not match/i').first().isVisible().catch(() => false)
    h.check('PRF-008', 'Mismatched new/confirm passwords show a mismatch error',
      mismatch, `page said: ${(await page.locator('form').innerText()).slice(0, 140).replace(/\s+/g, ' ')}`)

    // The mismatch must be caught before anything is sent — the old password
    // has to still work.
    const stillOld = await h.getToken({ email: user.email })
    h.check('PRF-008', 'A mismatched attempt does not change the password',
      Boolean(stillOld), 'the original password no longer logs in')

    // And the happy path still goes through once the two agree.
    await confirm.fill('BrandNew@12345')
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/change-password'), { timeout: 20000 })
        .catch(() => null),
      submit.click()
    ])
    const status = res ? res.status() : 'no request sent'
    const body = res ? await res.text().catch(() => '') : ''
    await page.waitForTimeout(800)

    const changed = await h.getToken({ email: user.email, password: 'BrandNew@12345' })
    h.check('PRF-008', 'Matching new/confirm passwords are accepted and the change sticks',
      Boolean(changed), `change-password responded ${status} ${body.slice(0, 160)}`)

    await context.close()
  } finally {
    await browser.close()
  }
})
