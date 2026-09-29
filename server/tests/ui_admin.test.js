// ADM (UI) — admin panel access gate + user dialogs.
//
// The API-side user CRUD lives in admin_users.test.js; these are the cases that
// only exist in the browser: the client-side role gate, dialog open/close, and
// the create form's own validation.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['ADM-001', 'ADM-007', 'ADM-011', 'ADM-014', 'ADM-015', 'ADM-023']

// Dialogs all render through components/Modal, which sets role="dialog".
const DIALOG = '[role="dialog"]'
const skipProductTour = ({ page, user }) => page.addInitScript((userId) => {
  localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
}, String(user?._id || user?.id || ''))

h.runSuite('ui_admin', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uiadm')
  const admin = await h.createUser(org, {
    name: 'UI Adm Admin', email: h.emailIn(org, 'uiadm-admin'), roleName: 'Admin'
  })
  const employee = await h.createUser(org, {
    name: 'UI Adm Employee', email: h.emailIn(org, 'uiadm-emp'), roleName: 'Employee'
  })
  // A distinctive fixture so the search box can isolate exactly one row.
  const target = await h.createUser(org, {
    name: 'Zoya Prefill', email: h.emailIn(org, 'uiadm-prefill'), roleName: 'Manager', department: 'Finance'
  })

  const adminTok = await h.getToken({ email: admin.email })
  const empTok = await h.getToken({ email: employee.email })

  const countUsers = async () => {
    const r = await h.api('GET', '/users', adminTok)
    return Array.isArray(r.body?.users) ? r.body.users.length : -1
  }

  const browser = await u.launch()
  try {
    // ── ADM-001 — the panel is Admin-only ───────────────────────────────────
    {
      const emp = await u.session(browser, { token: empTok, workspace: org.subdomain })
      await skipProductTour(emp)
      await u.goto(emp.page, '/admin')
      const blocked = await emp.page.getByText(/Admins only|You do not have access to that page/i).first().isVisible().catch(() => false)
      h.check('ADM-001', 'Non-admin opening /admin gets an access gate',
        blocked, `saw: ${(await emp.page.locator('body').innerText()).slice(0, 120).replace(/\s+/g, ' ')}`)
      await emp.context.close()

      const adm = await u.session(browser, { token: adminTok, workspace: org.subdomain })
      await skipProductTour(adm)
      await u.goto(adm.page, '/admin')
      const hasTable = await adm.page.locator('table').first().isVisible().catch(() => false)
      const gated = await adm.page.locator('text=Admins only').first().isVisible().catch(() => false)
      h.check('ADM-001', 'Admin opening /admin gets the user table, not the gate',
        hasTable && !gated, `table=${hasTable} gate=${gated}`)
      await adm.context.close()
    }

    // ── the create / import / edit dialogs ──────────────────────────────────
    {
      const session = await u.session(browser, { token: adminTok, workspace: org.subdomain })
      await skipProductTour(session)
      const { context, page } = session
      await u.goto(page, '/admin')
      await page.waitForSelector('table', { timeout: 20000 })

      // ADM-007 — create dialog opens with every field.
      await page.getByRole('button', { name: /^invite user$/i }).click()
      await page.waitForSelector(DIALOG, { timeout: 10000 })
      const fields = ['#cu-name', '#cu-email', '#cu-role', '#cu-department', '#cu-manager', '#cu-password']
      const absent = []
      for (const sel of fields) if (!(await u.isVisible(page, sel))) absent.push(sel)
      const titled = await page.locator(`${DIALOG} h2`).first().innerText().catch(() => '')
      h.check('ADM-007', 'Create-user dialog opens with name, email, role, department, manager and password',
        absent.length === 0 && /create a user/i.test(titled),
        `title "${titled}", missing ${absent.join(', ') || 'none'}`)

      // ADM-011 — a malformed address is rejected before anything is created.
      const before011 = await countUsers()
      await page.fill('#cu-name', 'Bad Email User')
      await page.fill('#cu-email', 'abc')
      await page.fill('#cu-password', 'QaTest@12345')
      await page.getByRole('button', { name: /^create user$/i }).click()
      await page.waitForTimeout(800)
      const stillOpen = await u.isVisible(page, DIALOG)
      const emailError = await page.getByText(/valid email/i).first().isVisible().catch(() => false)
      const after011 = await countUsers()
      h.check('ADM-011', 'Create-user rejects a malformed email with a validation error',
        emailError && stillOpen, `error=${emailError} dialogOpen=${stillOpen}`)
      h.check('ADM-011', 'No user is created from the malformed-email attempt',
        after011 === before011, `user count ${before011} → ${after011}`)

      // ADM-014 — Cancel closes the dialog and creates nothing.
      const before014 = await countUsers()
      await page.fill('#cu-email', 'cancelled@qa.test')
      await page.getByRole('button', { name: /^cancel$/i }).click()
      await page.waitForTimeout(600)
      const closed = !(await u.isVisible(page, DIALOG))
      const after014 = await countUsers()
      h.check('ADM-014', 'Cancel closes the create dialog',
        closed, 'dialog was still on screen after Cancel')
      h.check('ADM-014', 'Cancelling the dialog creates no user',
        after014 === before014, `user count ${before014} → ${after014}`)

      // ADM-023 — import dialog opens with a file picker.
      await page.getByRole('button', { name: /^import csv$/i }).click()
      await page.waitForSelector(DIALOG, { timeout: 10000 })
      const importTitle = await page.locator(`${DIALOG} h2`).first().innerText().catch(() => '')
      const filePicker = (await page.locator(`${DIALOG} input[type="file"]`).count()) > 0
      h.check('ADM-023', 'Import dialog opens with a CSV file picker',
        /import users from csv/i.test(importTitle) && filePicker,
        `title "${importTitle}", file input ${filePicker}`)
      await page.getByRole('button', { name: 'Close dialog' }).click()
      await page.waitForTimeout(400)

      // ADM-015 — the edit dialog arrives pre-filled.
      await page.getByRole('searchbox', { name: 'Search users', exact: true }).fill('Zoya Prefill')
      await page.waitForTimeout(600)
      await page.getByRole('button', { name: 'More actions for Zoya Prefill', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Edit user', exact: true }).click()
      await page.waitForSelector(DIALOG, { timeout: 10000 })
      const prefill = {
        name: await page.inputValue('#eu-name'),
        email: await page.inputValue('#eu-email'),
        department: await page.inputValue('#eu-department')
      }
      h.check('ADM-015', 'Edit dialog pre-fills the selected user\'s name, email and department',
        prefill.name === target.name &&
        prefill.email === target.email &&
        prefill.department === 'Finance',
        `got ${JSON.stringify(prefill)}`)

      const roleSelected = await page.locator('#eu-role option:checked').first().innerText().catch(() => '')
      h.check('ADM-015', 'Edit dialog pre-selects the user\'s current role',
        /manager/i.test(roleSelected), `role select showed "${roleSelected}"`)

      await context.close()
    }
  } finally {
    await browser.close()
  }
})
