// PLAT (UI) — the Super Admin platform panel: nav visibility, the client route
// guard, the new-organization dialog, the one-time credentials copy, and the
// type-the-name delete confirmation.
//
// The API side (403s, cascade delete, backups, usage counters) is covered by
// platform_orgs.test.js. Everything here is browser-only.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')
const { Organization, User } = h

const TCS = ['PLAT-001', 'PLAT-002', 'PLAT-008', 'PLAT-014', 'PLAT-023', 'PLAT-024', 'PLAT-030', 'PLAT-031', 'PDASH-013', 'PDASH-014']

// The platform shell owns exactly these destinations — anything workspace-side
// (forms, workflows, requests, reports, user admin) belongs to a tenant.
const PLATFORM_HREFS = ['/dashboard', '/platform', '/usage', '/activity', '/health', '/plans', '/admins']
const WORKSPACE_HREFS = ['/forms', '/workflows', '/tasks', '/analytics', '/audit-log', '/admin']

const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'

const openDeleteDialog = async (page, orgName) => {
  // Both the desktop row and responsive card expose destructive actions in the portal menu.
  const record = page.locator('tr:visible, article:visible', { hasText: orgName }).first()
  await record.getByRole('button', { name: /more actions/i }).click()
  await page.getByRole('menuitem', { name: /delete permanently/i }).click()
  await page.waitForSelector(`text=Delete ${orgName}?`, { timeout: 10000 })
}

h.runSuite('ui_platform', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
  if (!saTok) {
    h.check('PLAT-001', 'SuperAdmin token obtained (seed the superadmin first)', false, 'no token')
    return
  }

  const org = await h.createOrg('uiplat')
  const manager = await h.createUser(org, {
    name: 'UI Plat Manager', email: h.emailIn(org, 'uiplat-mgr'), roleName: 'Manager'
  })
  const mgrTok = await h.getToken({ email: manager.email })

  // Created through the UI below, then deleted through the UI again.
  const newOrgName = `QA UI Plat ${Date.now().toString(36)}`
  const newOrgAdmin = `uiplat-admin-${Date.now().toString(36)}@${h.QA_EMAIL_DOMAIN}`
  let createdOrgId = null
  const findCreated = () => Organization.findOne({ name: newOrgName })
    .setOptions({ skipOrgScope: true }).lean()

  const browser = await u.launch()
  try {
    // ── PLAT-001 / PLAT-002 — who can see and reach the panel ───────────────
    {
      const sa = await u.session(browser, { token: saTok })
      await u.goto(sa.page, '/dashboard')
      const saLinks = await u.sidebarLinks(sa.page)
      h.check('PLAT-001', 'A Super Admin sees the Platform item in the sidebar',
        u.hasLink(saLinks, '/platform'), `sidebar: ${u.linkHrefs(saLinks)}`)
      await sa.page.getByRole('heading', { name: /platform overview/i }).waitFor({ timeout: 10000 })
      h.check('PDASH-013', 'Real-data dashboard renders enterprise analytics and history controls',
        (await sa.page.getByRole('heading', { name: 'Organization growth', exact: true }).count()) === 1 &&
        (await sa.page.getByRole('heading', { name: 'Total Resource utilization', exact: true }).count()) === 1 &&
        (await sa.page.getByRole('heading', { name: 'Organization analytics', exact: true }).count()) === 1 &&
        (await sa.page.getByRole('heading', { name: 'Action required', exact: true }).count()) === 1 &&
        (await sa.page.getByRole('group', { name: 'Organization history range' }).count()) === 1)

      h.check('PDASH-014', 'Dashboard exposes the system-health action',
        (await sa.page.getByRole('link', { name: /open system health/i }).getAttribute('href')) === '/health')
      await u.goto(sa.page, '/platform?new=1')
      const createName = sa.page.getByPlaceholder('Acme Corp')
      await createName.waitFor({ timeout: 10000 })
      h.check('PDASH-014', 'Organization creation deep link remains available',
        (await createName.count()) === 1)
      await sa.page.keyboard.press('Escape')

      const landedSa = await u.goto(sa.page, '/platform')
      h.check('PLAT-002', 'A Super Admin can open /platform',
        landedSa === '/platform', `landed on ${landedSa}`)

      await sa.page.getByRole('heading', { name: 'Organizations', exact: true }).waitFor({ timeout: 10000 })
      const firstOrganizationRow = sa.page.locator('tbody tr').first()
      const usageHealthText = await firstOrganizationRow.locator('td').nth(3).innerText()
      h.check('PLAT-004', 'Usage health uses its own vocabulary instead of workspace status',
        ['Within limit', 'High usage', 'Critical', 'Over limit'].some((label) => usageHealthText.includes(label)) &&
          !usageHealthText.includes('Suspended'),
        `usage cell: ${usageHealthText}`)
      h.check('PLAT-004', 'Organizations page exposes risk-focused real-data controls',
        (await sa.page.getByText('Healthy', { exact: true }).count()) === 1 &&
          (await sa.page.getByRole('combobox', { name: /filter by health/i }).count()) === 1 &&
          (await sa.page.getByRole('combobox', { name: /sort organizations/i }).count()) === 1)

      // ── PLAT-030 — the platform shell never shows or opens workspace pages ──
      await u.goto(sa.page, '/dashboard')
      const shellLinks = await u.sidebarLinks(sa.page)
      const missingPlatform = PLATFORM_HREFS.filter((href) => !u.hasLink(shellLinks, href))
      const leakedWorkspace = WORKSPACE_HREFS.filter((href) => u.hasLink(shellLinks, href))
      h.check('PLAT-030', 'The platform sidebar carries every console destination',
        missingPlatform.length === 0, `missing ${missingPlatform.join(', ')} — saw ${u.linkHrefs(shellLinks)}`)
      h.check('PLAT-030', 'The platform sidebar hides every workspace destination',
        leakedWorkspace.length === 0, `leaked ${leakedWorkspace.join(', ')}`)

      for (const href of ['/forms', '/tasks', '/admin', '/analytics']) {
        await u.goto(sa.page, href)
        h.check('PLAT-030', `A Super Admin typing ${href} is sent back to the console`,
          await u.landsOn(sa.page, '/dashboard'), `landed on ${await u.pathOf(sa.page)}`)
      }

      // Global search has no requests or forms to offer here, so it looks up
      // tenants and lands on the organizations list filtered to the match.
      await u.goto(sa.page, '/dashboard')
      const searchBox = sa.page.getByRole('combobox', { name: /search organizations/i })
      await searchBox.fill(org.subdomain)
      const orgResult = sa.page.getByRole('option').filter({ hasText: org.name }).first()
      await orgResult.waitFor({ timeout: 10000 }).catch(() => { /* asserted below */ })
      h.check('PLAT-030', 'Global search offers the matching tenant',
        (await orgResult.count()) > 0, `no result for ${org.subdomain}`)

      if (await orgResult.count()) {
        await searchBox.press('Enter')
        await sa.page.waitForFunction(() => location.pathname === '/platform' && location.search.startsWith('?q='), null, { timeout: 10000 })
        const landedSearch = await sa.page.evaluate(() => location.pathname + location.search)
        h.check('PLAT-030', 'Choosing a tenant opens the organizations list filtered to it',
          landedSearch.startsWith('/platform?q='), `landed on ${landedSearch}`)
      }

      await sa.context.close()

      const mgr = await u.session(browser, { token: mgrTok, workspace: org.subdomain })
      await u.goto(mgr.page, '/dashboard')
      const mgrLinks = await u.sidebarLinks(mgr.page)
      h.check('PLAT-001', 'A non-Super-Admin does not see the Platform item',
        !u.hasLink(mgrLinks, '/platform'), `sidebar: ${u.linkHrefs(mgrLinks)}`)

      await u.goto(mgr.page, '/platform')
      const landedMgr = await u.landsOn(mgr.page, '/dashboard')
      h.check('PLAT-002', 'A non-Super-Admin typing /platform is sent back to the dashboard',
        landedMgr, `landed on ${await u.pathOf(mgr.page)}`)
      await mgr.context.close()
    }

    // ── PLAT-008 / PLAT-014 — create an org, then copy its one-time password ─
    {
      // Clipboard reads need explicit permission in Chromium.
      const { context, page } = await u.session(browser, {
        token: saTok,
        permissions: ['clipboard-read', 'clipboard-write']
      })
      await page.route('**/api/platform/integrations/test', async (route) => {
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
            verificationReceipt: 'ui-test-receipt'
          })
        })
      })
      await u.goto(page, '/platform')
      await page.getByRole('button', { name: /create organization/i }).click()
      await page.waitForSelector('[role="dialog"]', { timeout: 10000 })

      const dialog = page.getByRole('dialog', { name: /new organization/i })
      const body = await dialog.innerText()
      const fields = ['Name', 'Allowed email domains', 'First org admin', 'Admin email']
      const missing = fields.filter((f) => !body.includes(f))
      h.check('PLAT-008', 'The new-organization dialog opens with every field it needs',
        (await dialog.count()) > 0 && missing.length === 0, `missing: ${missing.join(', ')}`)
      h.check('PLAT-008', 'The dialog offers to create rather than save an existing org',
        /Create organization/.test(body), 'no "Create organization" action in the dialog')

      const dmsCard = dialog.getByText('Document Management Systems', { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
      const createButton = dialog.getByRole('button', { name: /create organization/i })
      await dialog.getByRole('switch', { name: /enable dms integration/i })
        .evaluate((element) => element.click())
      const dmsTestButton = dmsCard.getByRole('button', { name: /test dms connection/i })
      const blockedBeforeTest = await createButton.isDisabled()
      await dmsTestButton.evaluate((element) => element.click())
      await dmsCard.getByText('Connected', { exact: true }).waitFor({ timeout: 5000 })
      const enabledAfterTest = !(await createButton.isDisabled())
      await dmsCard.locator('input').nth(1).fill('changed-slug')
      await dmsCard.getByText('Needs retest', { exact: true }).waitFor({ timeout: 5000 })
      const blockedAfterChange = await createButton.isDisabled()
      h.check('PLAT-031', 'Connection test gates creation and changes require a retest',
        blockedBeforeTest && enabledAfterTest && blockedAfterChange)
      await dialog.getByRole('button', { name: /^cancel$/i })
        .evaluate((element) => element.click())
      await dialog.waitFor({ state: 'detached', timeout: 10000 })
      await u.goto(page, '/platform?new=1')
      const creationDialog = page.getByRole('dialog', { name: /new organization/i })

      await creationDialog.locator('input[placeholder="Acme Corp"]').fill(newOrgName)
      await creationDialog.locator('input[placeholder="admin@acme.com"]').fill(newOrgAdmin)
      await page.waitForTimeout(250)
      await creationDialog.getByRole('button', { name: /create organization/i })
        .evaluate((element) => element.click())
      const createdDialog = page.getByRole('dialog', { name: /organization created/i })
      const createdVisible = await createdDialog.waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
      if (!createdVisible) {
        const snapshot = await creationDialog.evaluate((element) => ({
          name: element.querySelector('input[placeholder="Acme Corp"]')?.value,
          email: element.querySelector('input[placeholder="admin@acme.com"]')?.value,
          formValid: element.querySelector('form')?.checkValidity(),
          emailValidation: element.querySelector('input[placeholder="admin@acme.com"]')?.validationMessage,
          submitDisabled: [...element.querySelectorAll('button')]
            .find((button) => button.textContent?.trim() === 'Create organization')?.disabled,
          text: element.innerText.replace(/\s+/g, ' ').slice(-900)
        }))
        const notices = await page.locator('[role="alert"], [role="status"]').allInnerTexts()
        throw new Error(`Organization creation did not complete: ${JSON.stringify({ ...snapshot, notices })}`)
      }
      const created = await Organization.findOne({ name: newOrgName })
        .setOptions({ skipOrgScope: true }).lean()
      createdOrgId = created?._id || null
      const expectedSubdomainPrefix = newOrgName.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48)
      h.check('PLAT-008', 'Submitting the dialog actually creates the tenant',
        !!created && created.subdomain.startsWith(`${expectedSubdomainPrefix}-`),
        `db org: ${created ? `${created.name} @ ${created.subdomain}` : 'not found'}`)

      const shown = await page.locator('p.font-mono').first().innerText()
      await page.getByRole('button', { name: /^copy$/i }).nth(1).click()
      await page.waitForTimeout(500)
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      h.check('PLAT-014', 'Copy puts the one-time temporary password on the clipboard',
        clip.length > 0 && clip === shown.trim(), `clipboard "${clip}" vs shown "${shown.trim()}"`)

      await page.getByRole('button', { name: /^done$/i }).click()
      await page.waitForTimeout(500)
      await context.close()
    }

    // ── PLAT-023 / PLAT-024 — deleting a tenant is deliberately hard ─────────
    {
      const { context, page } = await u.session(browser, { token: saTok })
      await u.goto(page, '/platform')
      await page.getByRole('searchbox', { name: /search organizations/i }).fill(newOrgName)
      await page.locator('tr:visible, article:visible', { hasText: newOrgName }).first().waitFor({ timeout: 20000 })

      // PLAT-024 — cancel leaves everything alone.
      await openDeleteDialog(page, newOrgName)
      await page.getByRole('button', { name: /^cancel$/i }).click()
      await page.waitForTimeout(600)
      const afterCancel = await findCreated()
      h.check('PLAT-024', 'Cancelling the delete dialog closes it and deletes nothing',
        (await page.locator(`text=Delete ${newOrgName}?`).count()) === 0 && !!afterCancel,
        `dialog still open or org gone (${!!afterCancel})`)

      // PLAT-023 — the button only arms on an exact name match.
      await openDeleteDialog(page, newOrgName)
      const confirmBtn = page.getByRole('button', { name: /delete organization/i })
      h.check('PLAT-023', 'Delete is disabled until the org name is typed',
        await confirmBtn.isDisabled(), 'the delete button was armed with an empty confirmation')

      // The delete modal is a `danger` one, so its role is alertdialog.
      const nameInput = page.locator('[role="alertdialog"] input').last()
      await nameInput.fill(`${newOrgName} wrong`)
      await page.waitForTimeout(300)
      h.check('PLAT-023', 'A near-miss name does not arm the delete button',
        await confirmBtn.isDisabled(), 'the delete button armed on a name that does not match')

      await nameInput.fill(newOrgName)
      await page.waitForTimeout(300)
      h.check('PLAT-023', 'The exact org name arms the delete button',
        !(await confirmBtn.isDisabled()), 'the delete button stayed disabled on an exact match')

      await confirmBtn.click()
      await page.waitForTimeout(2500)
      const gone = await findCreated()
      const strays = await User.find({ orgId: createdOrgId }).setOptions({ skipOrgScope: true }).lean()
      h.check('PLAT-023', 'Confirming deletes the tenant and cascades to its users',
        !gone && strays.length === 0,
        `org ${gone ? 'still present' : 'deleted'}, ${strays.length} users left behind`)

      await context.close()
    }
  } finally {
    await browser.close()
  }
})
