// PERM (UI) — sidebar visibility + client-side route guards.
//
// The API-side role matrix lives in permissions.test.js; these are the cases
// that only exist in the browser. Nav filtering happens in AppShell's
// visibleSections(), and the route guards are <RequireRole> wrappers in
// App.jsx that redirect with <Navigate replace>.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['PERM-001', 'PERM-002', 'PERM-004', 'PERM-005', 'PERM-006', 'PERM-008', 'RBAC-UI-001']

h.runSuite('ui_permissions', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uiperm')
  const admin = await h.createUser(org, {
    name: 'UI Perm Admin', email: h.emailIn(org, 'uiperm-admin'), roleName: 'Admin'
  })
  const adminWithoutBuilder = await h.createUser(org, {
    name: 'UI Perm Admin No Builder', email: h.emailIn(org, 'uiperm-admin-no-builder'), roleName: 'Admin', canBuild: false
  })
  const employee = await h.createUser(org, {
    name: 'UI Perm Employee', email: h.emailIn(org, 'uiperm-emp'), roleName: 'Employee'
  })

  const adminTok = await h.getToken({ email: admin.email, subdomain: org.subdomain })
  const adminWithoutBuilderTok = await h.getToken({ email: adminWithoutBuilder.email, subdomain: org.subdomain })
  const empTok = await h.getToken({ email: employee.email, subdomain: org.subdomain })

  const browser = await u.launch()
  try {
    // ── PERM-001 — Admin sees every nav item ────────────────────────────────
    {
      const { context, page } = await u.session(browser, { token: adminTok, workspace: org.subdomain })
      await u.goto(page, '/dashboard')
      const links = await u.sidebarLinks(page)
      const expected = ['/dashboard', '/forms', '/workflows', '/analytics', '/audit-log', '/admin']
      const missing = expected.filter((href) => !u.hasLink(links, href))
      h.check('PERM-001', 'Admin sidebar shows Dashboard, Forms, Workflows, Analytics, Audit, Users',
        missing.length === 0, `missing ${missing.join(', ')} — saw ${u.linkHrefs(links)}`)

      h.check('PERM-001', 'Admin sidebar hides Tasks (ops shell only) and Platform',
        !u.hasLink(links, '/tasks') && !u.hasLink(links, '/platform'),
        `saw ${u.linkHrefs(links)}`)
      await context.close()
    }

    // Admin permissions and Builder access are independent. An Admin without a
    // Builder seat can still manage people, but cannot open builder tools.
    {
      const { context, page } = await u.session(browser, { token: adminWithoutBuilderTok, workspace: org.subdomain })
      await u.goto(page, '/dashboard')
      const links = await u.sidebarLinks(page)
      await u.goto(page, '/forms')
      const createHidden = !(await page.getByRole('button', { name: /create form/i }).first().isVisible().catch(() => false))
      await u.goto(page, '/workflows')
      const workflowsBlocked = await u.landsOn(page, '/dashboard')
      await u.goto(page, '/forms/new')
      const formBuilderBlocked = await u.landsOn(page, '/dashboard')

      h.check('PERM-001', 'Admin without Builder keeps administration but not Forms/Workflows building',
        u.hasLink(links, '/admin') && u.hasLink(links, '/forms') && !u.hasLink(links, '/workflows') &&
          createHidden && workflowsBlocked && formBuilderBlocked,
        `links ${u.linkHrefs(links)}, createHidden ${createHidden}, workflowsBlocked ${workflowsBlocked}, formBuilderBlocked ${formBuilderBlocked}`)
      await context.close()
    }

    // RBAC-UI-001 - protected roles stay visible but locked; regular roles edit.
    {
      const { context, page } = await u.session(browser, { token: adminTok, workspace: org.subdomain })
      await u.goto(page, '/roles')

      const adminView = page.getByRole('button', { name: 'View Admin permissions', exact: true })
      const ceoView = page.getByRole('button', { name: 'View CEO permissions', exact: true })
      const managerActions = page.getByRole('button', { name: 'More actions for Manager', exact: true })
      await adminView.waitFor({ state: 'visible', timeout: 20000 })
      const matrixText = await page.locator('table').first().innerText().catch(() => '')

      const adminRow = adminView.locator('xpath=ancestor::tr')
      const ceoRow = ceoView.locator('xpath=ancestor::tr')
      const protectedLocked = await adminRow.getByText('Protected', { exact: true }).isVisible() &&
        await ceoRow.getByText('Protected', { exact: true }).isVisible() &&
        await adminRow.getByRole('button', { name: /more actions/i }).count() === 0 &&
        await ceoRow.getByRole('button', { name: /more actions/i }).count() === 0
      const regularEditable = !(await managerActions.isDisabled())
      h.check('RBAC-UI-001', 'Admin and CEO are visibly protected without edit/delete menus',
        protectedLocked, 'a protected role exposed an action menu or lacked its Protected indicator')
      h.check('RBAC-UI-001', 'A regular role exposes the connected edit dialog',
        regularEditable, 'Manager actions were disabled')
      h.check('RBAC-UI-001', 'Role matrix shows only four independent permissions',
        /decide tasks/i.test(matrixText) && /manage users/i.test(matrixText) &&
          /view audit/i.test(matrixText) && /view analytics/i.test(matrixText) &&
          !/manage forms/i.test(matrixText) && !/build flows/i.test(matrixText),
        `matrix ${matrixText.slice(0, 220).replace(/\s+/g, ' ')}`)

      const compactListOnly = await page.getByRole('group', { name: 'Roles layout' }).count() === 0 &&
        await page.getByLabel('Sort roles').count() === 0 &&
        await page.getByRole('navigation', { name: 'Roles pagination' }).count() === 0 &&
        /allowed/i.test(matrixText)
      h.check('RBAC-UI-001', 'Role matrix uses the compact list-only layout and keeps text Allowed badges',
        compactListOnly, 'grid/sort/pagination clutter remained or Allowed text was missing')

      if (regularEditable) {
        await managerActions.click()
        const managerEdit = page.getByRole('menuitem', { name: 'Edit role', exact: true })
        await managerEdit.click()
        const editor = page.getByRole('dialog', { name: 'Edit Manager' })
        const editorVisible = await editor.isVisible()
        const editorText = await editor.innerText().catch(() => '')
        h.check('RBAC-UI-001', 'Editing a regular role opens the real capability editor',
          editorVisible && /decide tasks/i.test(editorText) && /manage users/i.test(editorText) &&
            /view audit/i.test(editorText) && /view analytics/i.test(editorText) &&
            !/manage forms/i.test(editorText) && !/build flows/i.test(editorText),
          `editor ${editorText.slice(0, 220).replace(/\s+/g, ' ')}`)
      }
      await context.close()
    }

    // ── PERM-002 — Employee nav is limited ──────────────────────────────────
    {
      const { context, page } = await u.session(browser, { token: empTok, workspace: org.subdomain })
      await u.goto(page, '/dashboard')
      const links = await u.sidebarLinks(page)

      const hidden = ['/workflows', '/analytics', '/audit-log', '/admin']
      const leaked = hidden.filter((href) => u.hasLink(links, href))
      h.check('PERM-002', 'Employee sidebar hides Workflows, Analytics, Audit log, Admin Panel',
        leaked.length === 0, `leaked ${leaked.join(', ')} — saw ${u.linkHrefs(links)}`)

      const shown = ['/dashboard', '/forms', '/tasks', '/profile']
      const absent = shown.filter((href) => !u.hasLink(links, href))
      h.check('PERM-002', 'Employee still sees Dashboard, Forms, request queue and Profile',
        absent.length === 0, `missing ${absent.join(', ')} — saw ${u.linkHrefs(links)}`)

      // Workspace shell labels the queue "My Requests".
      const tasks = links.find((l) => l.href === '/tasks')
      h.check('PERM-002', 'Task queue is labelled "My Requests" for an Employee',
        /my requests/i.test(tasks?.label || ''), `label was "${tasks?.label}"`)
      await context.close()
    }

    // ── PERM-004 / 005 / 008 — guarded routes bounce to the dashboard ───────
    {
      const { context, page } = await u.session(browser, { token: empTok, workspace: org.subdomain })

      const guarded = [
        ['PERM-004', '/workflows', 'canCreateWorkflow'],
        ['PERM-005', '/workflows/new', 'canCreateWorkflow'],
        ['PERM-008', '/admin', 'canManageUsers']
      ]
      for (const [tc, route, guard] of guarded) {
        await u.goto(page, route)
        const landed = await u.landsOn(page, '/dashboard')
        h.check(tc, `Employee opening ${route} directly is redirected to the dashboard (${guard})`,
          landed, `landed on ${await u.pathOf(page)}`)
      }
      await context.close()
    }

    // ── PERM-006 — /admin is blocked for a non-admin ────────────────────────
    // /admin is only wrapped in <RequireAuth>; AdminPanel does the role check
    // itself and renders an "Admins only" card, so the check is "blocked",
    // not "redirected".
    {
      const { context, page } = await u.session(browser, { token: empTok, workspace: org.subdomain })
      await u.goto(page, '/admin')

      const denied = await u.landsOn(page, '/dashboard')
      const noUserTable = !(await u.isVisible(page, 'table'))
      h.check('PERM-006', 'Employee opening /admin directly is redirected by canManageUsers',
        denied, `page showed: ${(await page.locator('body').innerText()).slice(0, 120).replace(/\s+/g, ' ')}`)
      h.check('PERM-006', 'Blocked admin page does not render the user table',
        noUserTable, 'a table was rendered for a non-admin')
      await context.close()
    }

    // Builder is a live per-user override. The same open Employee session gains
    // Forms/Workflows tools on focus, keeps the Employee shell, then loses those
    // tools immediately when the assignment is revoked.
    {
      const { context, page } = await u.session(browser, { token: empTok, workspace: org.subdomain })
      await u.goto(page, '/dashboard')
      const linksBefore = await u.sidebarLinks(page)

      const grant = await h.api('PUT', `/users/${employee._id}`, adminTok, { canBuild: true })
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.waitForFunction(() => {
        try { return JSON.parse(localStorage.getItem('flowsphere_user') || '{}').canBuild === true } catch { return false }
      }, null, { timeout: 10000 })

      const linksAfter = await u.sidebarLinks(page)
      const headerAfter = await page.locator('.nf-topbar').innerText().catch(() => '')
      await u.goto(page, '/forms')
      const createVisible = await page.getByRole('button', { name: /create form/i }).first().isVisible().catch(() => false)
      await u.goto(page, '/workflows')
      const workflowsOpen = await u.landsOn(page, '/workflows')
      await u.goto(page, '/profile')
      const profileBuilderBadge = await page.locator('.nf-profile-badge', { hasText: 'Builder' }).isVisible().catch(() => false)
      await u.goto(page, '/admin')
      const adminStillBlocked = await u.landsOn(page, '/dashboard')

      h.check('PERM-002', 'An open Employee session gains Builder navigation and controls after focus refresh',
        grant.status === 200 && !u.hasLink(linksBefore, '/workflows') && u.hasLink(linksAfter, '/workflows') &&
          /Employee\s*·\s*Builder/i.test(headerAfter) && createVisible && workflowsOpen && profileBuilderBadge,
        `grant ${grant.status}, links ${u.linkHrefs(linksAfter)}, header ${headerAfter.replace(/\s+/g, ' ')}`)
      h.check('PERM-008', 'Employee + Builder still cannot open Admin',
        adminStillBlocked, `landed on ${await u.pathOf(page)}`)

      const revoke = await h.api('PUT', `/users/${employee._id}`, adminTok, { canBuild: false })
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await page.waitForFunction(() => {
        try { return JSON.parse(localStorage.getItem('flowsphere_user') || '{}').canBuild === false } catch { return false }
      }, null, { timeout: 10000 })
      const linksRevoked = await u.sidebarLinks(page)
      await u.goto(page, '/workflows')
      const revokedRedirect = await u.landsOn(page, '/dashboard')
      h.check('PERM-005', 'Revoking Builder hides navigation and restores route guards without logout',
        revoke.status === 200 && !u.hasLink(linksRevoked, '/workflows') && revokedRedirect,
        `revoke ${revoke.status}, links ${u.linkHrefs(linksRevoked)}, landed ${await u.pathOf(page)}`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
})
