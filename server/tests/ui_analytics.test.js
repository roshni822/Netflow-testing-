// ANA (UI) — the analytics CSV, Excel and PDF exports.
//
// The files are built in the browser and never
// touch the server, so analytics_audit.test.js cannot see them. Here the export
// is actually triggered, the download captured and the file opened.

const fs = require('fs')
const path = require('path')
const XLSX = require('../../frontend/node_modules/xlsx')
const h = require('./lib/harness')
const u = require('./lib/uiHarness')
const { runWithOrgId, Task } = h
const { inspectDocument, renderDocumentPage } = require('../services/mupdfClient')

const TCS = ['ANA-008', 'ANA-009', 'ANA-019', 'ANA-020']

const openExportMenu = async (page) => {
  await page.locator('.nf-analytics-export-trigger').click()
  await page.waitForSelector('[role="menu"][aria-label="Export format"]', { timeout: 10000 })
}

h.runSuite('ui_analytics', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uiana')
  const manager = await h.createUser(org, {
    name: 'UI Ana Manager', email: h.emailIn(org, 'uiana-mgr'), roleName: 'Manager'
  })
  const employee = await h.createUser(org, {
    name: 'UI Ana Employee', email: h.emailIn(org, 'uiana-emp'), roleName: 'Employee',
    managerId: manager._id
  })
  const token = await h.getToken({ email: manager.email })

  // A little resolved history so the export has rows rather than only headers.
  const mk = (extra) => runWithOrgId(org._id, () => Task.create({
    title: 'Ana task', type: 'IT', assignedTo: manager._id, submittedBy: employee._id, ...extra
  }))
  await mk({ status: 'approved', completedAt: new Date() })
  await mk({ status: 'approved', completedAt: new Date() })
  await mk({ status: 'rejected', completedAt: new Date() })
  await mk({ status: 'pending' })

  const browser = await u.launch()
  try {
    const { context, page } = await u.session(browser, { token, workspace: org.subdomain })
    await context.addInitScript((userId) => {
      localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
    }, String(manager._id))
    await u.goto(page, '/analytics')
    await page.waitForSelector('button:has-text("Export")', { timeout: 20000 })
    // The menu is disabled until the summary endpoints resolve.
    await page.waitForFunction(
      () => ![...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === 'Export')?.disabled,
      null,
      { timeout: 20000 }
    )

    // ANA-019 - executive command-center hierarchy stays connected to real data.
    {
      const metrics = page.locator('[aria-label="Analytics overview"] article')
      const metricText = await metrics.allInnerTexts()
      const expectedMetrics = ['Workflow runs', 'Avg completion', 'Approval rate', 'SLA breaches']
      const missingMetrics = expectedMetrics.filter((label) =>
        !metricText.some((text) => text.toLowerCase().includes(label.toLowerCase())))
      h.check('ANA-019', 'Analytics renders the four executive status cards',
        await metrics.count() === 4 && missingMetrics.length === 0,
        `missing ${missingMetrics.join(', ')} from ${metricText.join(' | ')}`)

      const panelNames = ['Completion time', 'Approval outcomes', 'SLA breach trend', 'Department performance']
      const missingPanels = []
      for (const name of panelNames) {
        if (!(await page.getByRole('heading', { name, exact: true }).isVisible())) missingPanels.push(name)
      }
      h.check('ANA-019', 'Analytics renders all command-center report panels',
        missingPanels.length === 0, `missing ${missingPanels.join(', ')}`)

      const departmentHeaders = await page.locator('.nf-analytics-table thead').innerText()
      h.check('ANA-019', 'Department report exposes volume, turnaround, breach, and compliance columns',
        ['volume', 'avg completion', 'breaches', 'compliance'].every((label) => departmentHeaders.toLowerCase().includes(label)),
        `headers were "${departmentHeaders.replace(/\s+/g, ' ')}"`)
    }

    // ── ANA-008 — CSV export ────────────────────────────────────────────────
    {
      await openExportMenu(page)
      const dl = await u.captureDownload(page, () =>
        page.getByRole('menuitem', { name: /CSV/i }).click())

      h.check('ANA-008', 'The CSV export downloads a .csv named after the selected range',
        /^analytics-.*\.csv$/.test(dl.name), `filename "${dl.name}"`)

      const text = fs.readFileSync(dl.path, 'utf8').replace(/^\ufeff/, '')
      const lines = text.trim().split(/\r?\n/)
      const csvBook = XLSX.read(text, { type: 'string' })
      const records = XLSX.utils.sheet_to_json(csvBook.Sheets[csvBook.SheetNames[0]], { defval: '' })
      const sections = new Set(records.map((row) => row.Section))
      const expectedSections = ['Overview', 'Completion', 'Outcomes', 'Departments', 'SLA trend']
      const missing = expectedSections.filter((section) => !sections.has(section))
      h.check('ANA-008', 'The CSV is one clean rectangular report without blank separator rows',
        lines[0] === 'Section,Dimension,Metric,Value,Unit,Status,Scope,Date range,Generated at,Note'
          && lines.slice(1).every((line) => line.trim().length > 0),
        `first rows: ${lines.slice(0, 4).join(' / ')}`)
      h.check('ANA-008', 'The CSV contains every analytics section',
        missing.length === 0, `missing sections: ${missing.join(' | ')}`)
      h.check('ANA-008', 'Every CSV row carries report scope, date range, status, and generated time',
        records.length > 0 && records.every((row) => row.Scope && row['Date range'] && row.Status && row['Generated at']),
        `sample ${JSON.stringify(records.slice(0, 2))}`)
      h.check('ANA-008', 'The CSV carries numeric KPI values, not presentation-only strings',
        records.some((row) => row.Section === 'Overview' && row.Metric === 'Workflow runs' && typeof row.Value === 'number')
          && records.some((row) => row.Section === 'Overview' && row.Metric === 'Approval rate'),
        `overview ${JSON.stringify(records.filter((row) => row.Section === 'Overview'))}`)
      const pathAfterCsv = await u.pathOf(page)
      const userAfterCsv = await page.evaluate(() => {
        try {
          const user = JSON.parse(localStorage.getItem('flowsphere_user') || 'null')
          return { role: user?.role?.name, permissions: user?.role?.permissions }
        } catch { return null }
      })
      h.check('ANA-008', 'CSV export keeps the Analytics page active',
        pathAfterCsv === '/analytics', `landed on ${pathAfterCsv}; user ${JSON.stringify(userAfterCsv)}`)

      fs.unlinkSync(dl.path)
    }

    // ── ANA-008 — Excel export ──────────────────────────────────────────────
    {
      await openExportMenu(page)
      const dl = await u.captureDownload(page, () =>
        page.getByRole('menuitem', { name: /Excel/i }).click())

      h.check('ANA-008', 'The Excel export downloads a real .xlsx workbook',
        /^analytics-.*\.xlsx$/.test(dl.name) && fs.statSync(dl.path).size > 5000,
        `filename "${dl.name}", ${fs.statSync(dl.path).size} bytes`)

      const workbook = XLSX.readFile(dl.path, { cellStyles: true, cellDates: true })
      const expectedSheets = ['Overview', 'Completion', 'Outcomes', 'Departments', 'SLA Breaches']
      h.check('ANA-008', 'The Excel workbook separates each report into a named worksheet',
        JSON.stringify(workbook.SheetNames) === JSON.stringify(expectedSheets),
        `sheets ${JSON.stringify(workbook.SheetNames)}`)

      const overview = workbook.Sheets.Overview
      const overviewRows = XLSX.utils.sheet_to_json(overview, { header: 1, defval: '' })
      h.check('ANA-008', 'Excel includes title, scope, range, generated time, and filterable headers',
        overviewRows[0]?.[0] === 'Analytics overview'
          && overviewRows[1]?.[0] === 'Scope' && overviewRows[1]?.[1]
          && overviewRows[2]?.[0] === 'Date range' && overviewRows[2]?.[1]
          && overviewRows[3]?.[0] === 'Generated' && overviewRows[3]?.[1]
          && overviewRows[5]?.join('|') === 'Metric|Value|Unit|Status|Details'
          && Boolean(overview['!autofilter']),
        `overview rows ${JSON.stringify(overviewRows.slice(0, 7))}`)

      const outcomes = workbook.Sheets.Outcomes
      const outcomeRows = XLSX.utils.sheet_to_json(outcomes, { header: 1, defval: '' })
      const percentageCell = outcomes.C7
      h.check('ANA-008', 'Excel preserves report values as sortable numbers and percentages',
        typeof overview.B7?.v === 'number'
          && (!percentageCell || percentageCell.v === '' || typeof percentageCell.v === 'number')
          && (!percentageCell || typeof percentageCell.v !== 'number' || percentageCell.z === '0.0%'),
        `overview value ${JSON.stringify(overview.B7)}, outcome row ${JSON.stringify(outcomeRows[6])}`)

      for (const sheetName of expectedSheets) {
        const sheet = workbook.Sheets[sheetName]
        h.check('ANA-008', `Excel ${sheetName} sheet has readable column widths`,
          Array.isArray(sheet['!cols']) && sheet['!cols'].every((column) => Number(column.wch) >= 12),
          `columns ${JSON.stringify(sheet['!cols'])}`)
      }

      fs.unlinkSync(dl.path)
    }

    // ── ANA-009 — PDF export ────────────────────────────────────────────────
    {
      if (!(await page.locator('.nf-analytics-export-trigger').count())) {
        await u.goto(page, '/analytics')
        await page.waitForSelector('.nf-analytics-export-trigger:not(:disabled)', { timeout: 20000 })
      }
      await openExportMenu(page)
      const dl = await u.captureDownload(page, () =>
        page.getByRole('menuitem', { name: /PDF/i }).click())

      h.check('ANA-009', 'The PDF export downloads a .pdf named after the selected range',
        /^analytics-.*\.pdf$/.test(dl.name), `filename "${dl.name}"`)

      const buf = fs.readFileSync(dl.path)
      h.check('ANA-009', 'The downloaded file is a real PDF, not an empty or broken blob',
        buf.subarray(0, 5).toString() === '%PDF-' && buf.length > 1000,
        `${buf.length} bytes, header "${buf.subarray(0, 5).toString()}"`)

      const inspected = await inspectDocument(buf, 'application/pdf')
      const extractedText = inspected.pages
        .flatMap((pdfPage) => pdfPage.lines.map((line) => line.text))
        .join(' ')
      const reportSections = ['Analytics report', 'Completion time', 'Approval outcomes', 'Department performance', 'SLA breach trend']
      const missingSections = reportSections.filter((section) => !extractedText.includes(section))
      h.check('ANA-009', 'The PDF contains the branded report heading and every analytics section',
        missingSections.length === 0, `missing ${missingSections.join(', ')} from "${extractedText.slice(0, 500)}"`)
      h.check('ANA-009', 'Every PDF page has report context and a page number',
        inspected.pageCount >= 1
          && inspected.pages.every((pdfPage) => {
            const text = pdfPage.lines.map((line) => line.text).join(' ')
            return /Page \d+ of \d+/.test(text) && /Last 30 days/.test(text)
          }),
        `${inspected.pageCount} pages`)

      const rendered = await renderDocumentPage(buf, 'application/pdf', 1, 1.25)
      h.check('ANA-009', 'The first PDF page renders successfully at a readable landscape size',
        rendered.width > rendered.height && rendered.width >= 1000
          && Buffer.from(rendered.png).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        `${rendered.width}x${rendered.height}`)

      if (process.env.KEEP_ANALYTICS_PREVIEW === '1') {
        const previewDir = path.join(__dirname, '..', 'tmp', 'analytics-export-preview')
        fs.mkdirSync(previewDir, { recursive: true })
        fs.copyFileSync(dl.path, path.join(previewDir, dl.name))
        fs.writeFileSync(path.join(previewDir, 'analytics-report-page-1.png'), Buffer.from(rendered.png))
      }

      fs.unlinkSync(dl.path)
    }

    // ANA-020 - the approved responsive hierarchy and dark surface remain usable.
    {
      await page.setViewportSize({ width: 1360, height: 900 })
      await u.goto(page, '/analytics')
      await page.waitForSelector('.nf-analytics-export-trigger:not(:disabled)', { timeout: 20000 })
      const desktopCards = await page.locator('[aria-label="Analytics overview"] article').evaluateAll((cards) =>
        cards.map((card) => {
          const box = card.getBoundingClientRect()
          return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) }
        }))
      h.check('ANA-020', 'At 1360px all four status cards share one balanced row',
        desktopCards.length === 4
          && new Set(desktopCards.map((card) => card.y)).size === 1
          && Math.max(...desktopCards.map((card) => card.width)) - Math.min(...desktopCards.map((card) => card.width)) <= 2,
        `geometry ${JSON.stringify(desktopCards)}`)

      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(250)
      const mobileLayout = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[aria-label="Analytics overview"] article')]
          .map((card) => {
            const box = card.getBoundingClientRect()
            return { x: Math.round(box.x), y: Math.round(box.y) }
          })
        const table = document.querySelector('.nf-analytics-table-wrap')
        return {
          cards,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          tableScrollable: Boolean(table && table.scrollWidth > table.clientWidth)
        }
      })
      h.check('ANA-020', 'At 390px cards stack and wide department data scrolls inside its panel',
        mobileLayout.cards.length === 4
          && new Set(mobileLayout.cards.map((card) => card.x)).size === 1
          && !mobileLayout.pageOverflow
          && mobileLayout.tableScrollable,
        `layout ${JSON.stringify(mobileLayout)}`)

      const darkSurface = await page.evaluate(() => {
        document.documentElement.classList.add('dark')
        const panel = document.querySelector('.nf-analytics-panel')
        const heading = panel?.querySelector('h2')
        return {
          background: panel ? getComputedStyle(panel).backgroundColor : '',
          foreground: heading ? getComputedStyle(heading).color : ''
        }
      })
      h.check('ANA-020', 'Analytics panels resolve readable semantic colors in dark mode',
        darkSurface.background && darkSurface.foreground && darkSurface.background !== darkSurface.foreground,
        `colors ${JSON.stringify(darkSurface)}`)
    }

    await context.close()
  } finally {
    await browser.close()
  }
})
