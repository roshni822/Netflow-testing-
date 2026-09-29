// Focused browser coverage for pre-save integration checks in an existing
// tenant's Edit dialog. The API response is intercepted only to verify UI
// state; real DMS/S3 probes are covered by the server service tests.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['PLAT-032']

h.runSuite('ui_platform_integrations', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('integration-edit', {
    integrations: {
      dmsEnabled: true,
      dmsApiKey: 'saved-test-key',
      dmsOrgSlug: 'qa-integration-edit'
    }
  })
  const superAdmin = await h.createUser(org, {
    name: 'Integration Test SuperAdmin',
    email: h.emailIn(org, 'integration-superadmin'),
    roleName: 'SuperAdmin'
  })
  superAdmin.needsProductTour = false
  await superAdmin.save()
  const token = await h.getToken({ email: superAdmin.email })
  if (!token) {
    h.check('PLAT-032', 'Temporary SuperAdmin token obtained', false, 'no token')
    return
  }

  const browser = await u.launch()
  try {
    const { context, page } = await u.session(browser, { token })
    let requestBody = null
    await page.route('**/api/platform/integrations/test', async (route) => {
      requestBody = route.request().postDataJSON()
      const testedAt = new Date()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          integration: 'dms',
          status: 'connected',
          testedAt: testedAt.toISOString(),
          expiresAt: new Date(testedAt.getTime() + 600000).toISOString(),
          verificationReceipt: 'ui-edit-test-receipt'
        })
      })
    })

    await u.goto(page, '/platform')
    const card = page.locator('article').filter({ hasText: org.name }).first()
    await card.getByRole('button', { name: /^edit$/i }).click()
    const dialog = page.locator('[role="dialog"]').first()
    const testButton = dialog.getByRole('button', { name: /test dms connection/i })
    await testButton.waitFor({ timeout: 10000 })
    const testButtonVisible = await testButton.isVisible()

    await testButton.evaluate((element) => element.click())
    await dialog.getByText('Connected', { exact: true }).waitFor({ timeout: 10000 }).catch(async () => {
      const text = await dialog.innerText().catch(() => '(dialog closed)')
      throw new Error(`Edit connection state did not settle; url=${page.url()} request=${JSON.stringify(requestBody)} dialog=${text.slice(-800)}`)
    })

    const secretSubmitted = Object.prototype.hasOwnProperty.call(requestBody?.config || {}, 'apiKey')
    h.check('PLAT-032', 'Existing tenant Edit can test its saved DMS connection',
      testButtonVisible &&
      requestBody?.integration === 'dms' &&
      String(requestBody?.orgId) === String(org._id) &&
      !secretSubmitted,
      `integration=${requestBody?.integration} org=${requestBody?.orgId} secretSubmitted=${secretSubmitted}`)

    await context.close()
  } finally {
    await browser.close()
  }
})
