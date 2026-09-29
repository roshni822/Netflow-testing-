// WFB (UI) — the workflow builder canvas: pan/zoom, the self-connection guard,
// and the unsaved-changes warning.
//
// Graph persistence and the engine are covered by workflow_engine.test.js (which
// also owns the other half of WFB-013, the engine's loop guard). What is left
// here is pure canvas behaviour that never reaches the API.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['WFB-001', 'WFB-013', 'WFB-027']

// The world layer carries the pan/zoom transform inline; find it by that rather
// than by a utility class that could be renamed.
const worldTransform = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll('div')]
    .find((d) => /translate\(.+\)\s*scale\(/.test(d.style.transform || ''))
  return el ? el.style.transform : null
})

const parseTransform = (t) => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(t || '')
  return m ? { x: +m[1], y: +m[2], scale: +m[3] } : null
}

// Each rendered connection has an invisible fat hit-path carrying this title.
const connectionCount = (page) => page.$$eval('svg title', (els) =>
  els.filter((e) => e.textContent === 'Click to delete connection').length)

// Node cards are keyboard-operable buttons; the hint in their label is the only
// stable thing about them.
const NODE_CARD = '[role="button"][aria-label*="Arrow keys to move"]'

const canvasBox = async (page) => {
  const el = await page.locator('div.relative.flex-1.min-h-0.overflow-hidden').first()
  return el.boundingBox()
}

// Step 1 is the template picker; "Continue" lands on the canvas.
const openCanvas = async (page) => {
  await u.goto(page, '/workflows/new')
  await page.getByRole('button', { name: /continue/i }).click()
  await page.waitForSelector('[aria-label="Add Approval node"]', { timeout: 20000 })
  await page.waitForTimeout(400)
}

// Chromium only prompts on unload after a real user gesture, and Playwright
// needs the listener attached before close() or the dialog auto-dismisses.
const promptsOnLeave = async (page) => {
  let prompted = false
  const onDialog = async (d) => {
    if (d.type() === 'beforeunload') prompted = true
    await d.dismiss().catch(() => {})
  }
  page.on('dialog', onDialog)
  await page.close({ runBeforeUnload: true }).catch(() => {})

  // A page with nothing to lose simply closes; one that warns stays open until
  // the dialog is answered, so poll for whichever happens.
  const deadline = Date.now() + 2500
  while (Date.now() < deadline && !prompted && !page.isClosed()) {
    await new Promise((r) => setTimeout(r, 100))
  }

  page.off('dialog', onDialog)
  // A page still open here is one whose prompt we dismissed. Closing it a second
  // time tears the renderer down mid-dialog, which Chromium on Windows sometimes
  // takes badly; the caller closes the whole context next, so leave it be.
  return prompted
}

h.runSuite('ui_workflows', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uiwfb')
  const builder = await h.createUser(org, {
    name: 'UI Wfb Builder', email: h.emailIn(org, 'uiwfb-builder'), roleName: 'Admin', canBuild: true
  })
  const builderTok = await h.getToken({ email: builder.email })

  const browser = await u.launch()
  try {
    // ── WFB-001 — pan and zoom ──────────────────────────────────────────────
    {
      const { context, page } = await u.session(browser, { token: builderTok, workspace: org.subdomain })
      await openCanvas(page)
      await page.click('[aria-label="Add Approval node"]')
      await page.click('[aria-label="Add Notify node"]')
      await page.waitForTimeout(300)

      const start = parseTransform(await worldTransform(page))
      h.check('WFB-001', 'The canvas starts at 100% zoom with no pan applied',
        start?.scale === 1 && start.x === 24 && start.y === 24,
        `transform ${JSON.stringify(start)}`)

      // Zoom in / out via the toolbar.
      await page.click('[title="Zoom in"]')
      await page.waitForTimeout(250)
      const zoomedIn = parseTransform(await worldTransform(page))
      const label = (await page.locator('[title="Reset zoom to 100%"]').innerText()).trim()
      h.check('WFB-001', 'Zoom in scales the canvas up and updates the zoom readout',
        zoomedIn.scale > start.scale && label === '120%',
        `scale ${zoomedIn.scale}, readout "${label}"`)

      await page.click('[title="Zoom out"]')
      await page.waitForTimeout(250)
      const zoomedOut = parseTransform(await worldTransform(page))
      h.check('WFB-001', 'Zoom out returns the canvas to its previous scale',
        Math.abs(zoomedOut.scale - start.scale) < 0.001,
        `scale ${zoomedOut.scale}`)

      // Scroll wheel over the canvas zooms too.
      const box = await canvasBox(page)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -240)
      await page.waitForTimeout(250)
      const wheeled = parseTransform(await worldTransform(page))
      h.check('WFB-001', 'Scrolling over the canvas zooms it',
        wheeled.scale > zoomedOut.scale, `scale ${wheeled.scale} vs ${zoomedOut.scale}`)

      // Reset, then drag empty space to pan.
      await page.click('[title="Reset zoom to 100%"]')
      await page.waitForTimeout(250)
      const reset = parseTransform(await worldTransform(page))
      h.check('WFB-001', 'The zoom readout doubles as a reset back to 100%',
        reset.scale === 1 && reset.x === 24 && reset.y === 24,
        `transform ${JSON.stringify(reset)}`)

      // Bottom-right of the canvas is empty space — the seeded nodes sit top-left.
      const from = { x: box.x + box.width - 60, y: box.y + box.height - 60 }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x - 150, from.y - 90, { steps: 10 })
      await page.mouse.up()
      await page.waitForTimeout(250)
      const panned = parseTransform(await worldTransform(page))
      h.check('WFB-001', 'Dragging empty canvas pans the view by the drag distance',
        Math.abs((panned.x - reset.x) + 150) < 12 && Math.abs((panned.y - reset.y) + 90) < 12,
        `moved by ${panned.x - reset.x}, ${panned.y - reset.y} (expected about -150, -90)`)

      // Fit brings every node back into view.
      await page.click('[title="Fit all nodes in view"]')
      await page.waitForTimeout(300)
      const fitted = parseTransform(await worldTransform(page))
      h.check('WFB-001', 'Fit re-frames the canvas around the nodes',
        fitted !== null && (fitted.x !== panned.x || fitted.y !== panned.y || fitted.scale !== panned.scale),
        `transform unchanged at ${JSON.stringify(fitted)}`)

      await context.close()
    }

    // ── WFB-013 — a node cannot be connected to itself ──────────────────────
    {
      const { context, page } = await u.session(browser, { token: builderTok, workspace: org.subdomain })
      await openCanvas(page)
      await page.click('[aria-label="Add Approval node"]')
      await page.click('[aria-label="Add Notify node"]')
      await page.waitForTimeout(400)

      const baseline = await connectionCount(page)

      // Drag the first node's outgoing dot back onto the node it came from.
      const dots = page.locator('[title="Drag to connect"]')
      const dotBox = await dots.first().boundingBox()
      const selfTarget = { x: dotBox.x + dotBox.width / 2, y: dotBox.y - 20 }
      await page.mouse.move(dotBox.x + dotBox.width / 2, dotBox.y + dotBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(selfTarget.x, selfTarget.y, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(400)

      const afterSelf = await connectionCount(page)
      h.check('WFB-013', 'Dropping a connection back on its own node creates nothing',
        afterSelf === baseline, `${baseline} connections before, ${afterSelf} after`)

      // Control case: the identical gesture onto a *different* node must
      // connect, otherwise the check above would pass just because dragging on
      // this canvas does nothing at all. Wire the last node back to the first —
      // adding nodes auto-chains them forward, so that edge doesn't exist yet,
      // and a back-edge between two nodes is legal (only self-loops are not).
      const cards = await page.$$eval(NODE_CARD, (els) => els.map((e) => {
        const r = e.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }))
      const dotCount = await dots.count()

      if (cards.length >= 2 && dotCount >= 2) {
        const lastDot = await dots.nth(dotCount - 1).boundingBox()
        await page.mouse.move(lastDot.x + lastDot.width / 2, lastDot.y + lastDot.height / 2)
        await page.mouse.down()
        await page.mouse.move(cards[0].x, cards[0].y, { steps: 10 })
        await page.mouse.up()
        await page.waitForTimeout(400)
        const afterReal = await connectionCount(page)
        h.check('WFB-013', 'The same drag onto a different node does connect',
          afterReal > afterSelf, `${afterSelf} connections before, ${afterReal} after`)
      } else {
        h.check('WFB-013', 'The same drag onto a different node does connect',
          false, `${cards.length} node cards / ${dotCount} connect dots — control case not exercised`)
      }

      await context.close()
    }

    // ── WFB-027 — leaving with unsaved work warns, leaving clean does not ────
    {
      const clean = await u.session(browser, { token: builderTok, workspace: org.subdomain })
      await u.goto(clean.page, '/workflows/new')
      await clean.page.waitForSelector('button:has-text("Continue")', { timeout: 20000 })
      // A gesture Chromium counts as interaction, without editing anything.
      await clean.page.mouse.click(5, 5)
      await clean.page.waitForTimeout(300)
      const cleanPrompted = await promptsOnLeave(clean.page)
      h.check('WFB-027', 'Leaving an untouched builder does not warn',
        cleanPrompted === false, 'a beforeunload prompt appeared with nothing to lose')
      await clean.context.close()

      const dirty = await u.session(browser, { token: builderTok, workspace: org.subdomain })
      await openCanvas(dirty.page)
      await dirty.page.click('[aria-label="Add Approval node"]')
      await dirty.page.waitForTimeout(600)
      const dirtyPrompted = await promptsOnLeave(dirty.page)
      h.check('WFB-027', 'Leaving with unsaved canvas changes warns first',
        dirtyPrompted === true, 'no beforeunload prompt despite unsaved changes')
      await dirty.context.close()
    }
  } finally {
    await browser.close()
  }
})
