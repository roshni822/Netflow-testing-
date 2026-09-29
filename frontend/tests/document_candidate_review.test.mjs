// Isolated API fixtures: no company documents, API keys, or database writes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../../output/candidate-review-qa/', import.meta.url))
const candidates = Array.from({ length: 100 }, (_, index) => ({
  candidateId: 'candidate-' + index, scoreVersion: 2,
  field: { label: 'Field ' + (index + 1), type: 'text', required: false, page: 1 },
  sourceLabel: 'Field ' + (index + 1), sourceLineIds: ['line-' + index],
  sourceRegions: [{ lineId: 'line-' + index, page: 1, source: 'digital', confidence: 100,
    x: 0.1 + (index % 4) * 0.2, y: 0.05 + Math.floor(index / 4) * 0.035, width: 0.12, height: 0.015 }],
  sourceMethods: ['digital'], sourceConfidence: 100, generatorConfidence: 98,
  criticConfidence: index < 80 ? 96 : null, criticStatus: index < 80 ? 'validated' : 'unavailable',
  confidence: index < 80 ? 96 : 0, confidenceTier: index < 80 ? 'high' : 'low',
  necessity: 'core', includedByDefault: index < 80, reviewWarnings: []
}))
const job = { jobId: 'fixture-job', status: 'ready', title: 'Fixture intake', description: 'Controlled review test',
  filename: 'fixture.png', pageCount: 1, processingVersion: 2, maxFields: 100,
  criticStatus: 'unavailable', coverage: { status: 'partial', unresolvedCount: 2 },
  pageMeta: [{ page: 1, usedOcr: false }], candidates }
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) })
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    requests.push(request.url())
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.url().includes('/pages/')) return route.fulfill({ headers, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="white"/><text x="20" y="25">Controlled source preview fixture</text></svg>' })
    if (request.url().endsWith('/complete')) {
      const body = request.postDataJSON()
      return route.fulfill({ headers, json: { draft: { title: body.title, fields: body.candidates.filter((candidate) => candidate.included).map((candidate) => candidate.field), entryMode: 'document' } } })
    }
    return route.fulfill({ headers, json: { job } })
  })
  const markup = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="bg-surface text-fg"><main id="root"></main><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import '/src/index.css'; import DocumentFormGenerator from '/src/components/DocumentFormGenerator.jsx';
    createRoot(document.getElementById('root')).render(React.createElement(DocumentFormGenerator,{onComplete:draft=>{window.completedDraft=draft},onCancel:()=>{}}));
  </script></body></html>`
  const html = await server.transformIndexHtml('/__candidate-review-test', markup)
  await page.route('**/__candidate-review-test', (route) => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(new URL('__candidate-review-test', origin).href)
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from('isolated-upload-fixture') })
  await page.getByRole('heading', { name: 'Included fields', exact: true }).waitFor()
  assert.equal(await page.getByRole('group', { name: /^(Included field:|Suggestion:)/ }).count(), 40, 'Only 20 cards per group render')
  assert.match(await page.locator('body').innerText(), /Field checking is incomplete/)
  assert.equal(await page.getByText('Show all extracted text', { exact: true }).count(), 0)
  await page.getByRole('img', { name: 'Reference document page 1' }).waitFor()
  assert.equal(await page.locator('span.pointer-events-none.absolute').count(), 100, 'All candidates, not all source text, have highlights')
  const checkHighlightBounds = async () => {
    const boxes = await page.locator('span.pointer-events-none.absolute').evaluateAll((elements) => elements.map((el) => {
      const css = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      const parent = el.offsetParent
      return { width: parseFloat(el.style.width), height: parseFloat(el.style.height),
        renderedWidth: rect.width, expectedWidth: parent.clientWidth * 0.12,
        renderedHeight: rect.height, expectedHeight: parent.clientHeight * 0.015,
        shadow: css.boxShadow, padding: css.padding, margin: css.margin, border: css.borderTopWidth }
    }))
    assert.equal(boxes.length, 100)
    for (const box of boxes) {
      assert.equal(box.width, 12, 'No horizontal highlight expansion')
      assert.equal(box.height, 1.5, 'No forced minimum height or vertical padding')
      assert.ok(Math.abs(box.renderedWidth - box.expectedWidth) < 1)
      assert.ok(Math.abs(box.renderedHeight - box.expectedHeight) < 1)
      assert.equal(box.shadow, 'none', 'No outer ring or glow')
      assert.equal(box.padding, '0px')
      assert.equal(box.margin, '0px')
      assert.equal(box.border, '1px')
    }
  }
  await checkHighlightBounds()
  await page.getByRole('button', {name:'Zoom in', exact:true}).click()
  await checkHighlightBounds()
  await page.getByRole('button', {name:'Open fullscreen', exact:true}).click()
  await checkHighlightBounds()
  await page.keyboard.press('Escape')
  await page.getByRole('region', {name:'Reference document', exact:true}).waitFor()
  const pager = page.getByRole('navigation', { name: 'Included fields pagination' })
  await pager.getByRole('button', { name: 'Next', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('group', { name: 'Included field: Field 21', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Included fields list' }).evaluate((el) => el === document.activeElement), true)
  const moved = page.getByRole('group', { name: 'Included field: Field 40', exact: true })
  await moved.getByRole('button', { name: 'Move field down' }).click()
  await moved.waitFor()
  assert.match(await pager.innerText(), /41–60 of 80/)
  // Include one suggestion; it remains selected when its card is on another page.
  await page.getByRole('group', { name: 'Suggestion: Field 81', exact: true }).getByRole('button', { name: 'Include field' }).click()
  assert.match(await page.locator('body').innerText(), /81 fields will open/)
  for (let index = 82; index <= 100; index += 1) {
    await page.getByRole('group', { name: 'Suggestion: Field ' + index, exact: true }).getByRole('button', { name: 'Include field' }).click()
  }
  assert.match(await page.locator('body').innerText(), /100 fields will open/)
  await mkdir(output, { recursive: true })
  for (const [name, width, height, dark] of [['desktop',1366,1000,false], ['mobile',375,812,false], ['mobile-dark',375,812,true], ['landscape',812,375,false]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark)
    await page.evaluate(() => window.scrollTo(0, 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, name + ' fits viewport')
    await page.screenshot({ path: output + name + '.png', fullPage: false, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('tab', { name: 'Document', exact: true }).click()
  await checkHighlightBounds()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Mobile document preview fits')
  await page.getByRole('tab', { name: 'Fields', exact: true }).click()
  await page.getByRole('button', { name: 'Use in Form Builder' }).click()
  await page.waitForFunction(() => window.completedDraft)
  const draft = await page.evaluate(() => window.completedDraft)
  assert.equal(draft.fields.length, 100)
  assert.equal(new Set(draft.fields.map((field) => field.label)).size, 100)
  assert.equal(requests.some((url) => url.includes('source-lines')), false)
  assert.deepEqual(errors, [])
  console.log('Candidate review UI passed: upload/poll/review/handoff, 100 fields, 20-card pagination, ordering, keyboard focus, highlights, mobile/dark/landscape. APIs were isolated fixtures.')
} finally {
  await browser?.close()
  await server.close()
}
