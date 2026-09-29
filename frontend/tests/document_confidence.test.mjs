// Isolated component QA. Fixtures never reach application APIs or the database.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../../output/confidence-qa/', import.meta.url))
const candidate = {
  candidateId: 'fixture-1', scoreVersion: 2,
  field: { label: 'GRN Number', type: 'text', required: true },
  sourceLabel: 'GRN:', sourceLineIds: ['digital-1'],
  sourceRegions: [{ lineId: 'digital-1', page: 1, source: 'digital', confidence: 100 }],
  sourceMethods: ['digital'], sourceConfidence: 100, ocrConfidence: null,
  labelGroundingConfidence: 100, labelGroundingMethod: 'text_match',
  generatorConfidence: 99, criticConfidence: 96, criticStatus: 'validated',
  confidence: 96, confidenceTier: 'high', necessity: 'core',
  included: true, includedByDefault: true,
  decisionReason: 'Receipt identifier grounded in the source document.', reviewWarnings: []
}
const waiting = {
  ...candidate, candidateId: 'fixture-2', field: { label: 'Delivery notes', type: 'text' },
  sourceLabel: 'Delivery notes', sourceMethods: ['ocr'], sourceConfidence: 87,
  ocrConfidence: 87, sourceRegions: [{ lineId: 'ocr-1', page: 2, source: 'ocr', confidence: 87 }],
  generatorConfidence: 92, criticConfidence: null, criticStatus: 'unavailable',
  validationReason: 'provider_timeout',
  confidence: 0, confidenceTier: 'low', necessity: 'optional', included: false
}
const job = {
  pageMeta: [{ page: 1, usedOcr: false }, { page: 2, usedOcr: true }],
  qualitySummary: {
    version: 1, digital: { pageCount: 1, lineCount: 20 },
    ocr: { pageCount: 1, lineCount: 10, confidence: 87 },
    grounding: { confidence: 95.5, scoredFields: 2, totalFields: 2 },
    validation: { confidence: 96, scoredFields: 1, totalFields: 2, unavailableFields: 1 }
  }
}

const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) })
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const markup = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confidence component test</title></head><body class="bg-surface-2 text-fg"><main id="root"></main><script type="module">
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import '/src/index.css';
    import {DocumentQualitySummary} from '/src/components/DocumentConfidence.jsx';
    import DocumentFormReview from '/src/components/DocumentFormReview.jsx';
    const e = React.createElement;
    const initial = ${JSON.stringify([candidate, waiting])};
    function App() {
      const [items, setItems] = useState(initial);
      const [legacy, setLegacy] = useState(false);
      const [digitalOnly, setDigitalOnly] = useState(false);
      const currentJob = ${JSON.stringify(job)};
      if (digitalOnly) { currentJob.qualitySummary.ocr = {pageCount:0,lineCount:0,confidence:null}; }
      return e('div', {className:'mx-auto max-w-7xl p-4 sm:p-6'},
        e('h1', {className:'mb-4 text-xl font-semibold'}, 'Generate form from document — test fixture'),
        e(DocumentQualitySummary, {job:legacy ? {pageMeta:currentJob.pageMeta} : currentJob}),
        e('div', {className:'mx-auto max-w-2xl'}, e(DocumentFormReview, {
          candidates: legacy ? items.map(i=>({...i,scoreVersion:1,confidence:1})) : items,
          activeCandidate: null, filterMode:'all', onSelect:()=>{}, onMove:()=>{},
          onChange:(id,change)=>setItems(items.map(i=>i.candidateId===id?{...i,...change}:i)),
          onToggle:(id)=>setItems(items.map(i=>i.candidateId===id?{...i,included:!i.included}:i))
        })),
        e('button', {onClick:()=>setLegacy(!legacy)}, 'Toggle legacy fixture'),
        e('button', {onClick:()=>setDigitalOnly(!digitalOnly)}, 'Toggle digital only fixture'),
        e('button', {onClick:()=>setItems(items.map(i=>i.criticStatus==='unavailable'?{...i,validationReason:'unresolved'}:i))}, 'Simulate uncertain validation')
      );
    }
    createRoot(document.getElementById('root')).render(e(App));
  </script></body></html>`
  // Let Vite transform the imports and inject the React development preamble.
  const html = await server.transformIndexHtml('/__confidence-review-test', markup)
  await page.route('**/__confidence-review-test', (route) => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(new URL('__confidence-review-test', origin).href)
  await page.getByRole('heading', { name: 'Extraction quality & AI confidence' }).waitFor()
  assert.equal(await page.getByText('1% low', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Not validated', { exact: true }).filter({ visible: true }).count(), 1)
  const first = page.getByRole('group', { name: 'Included field: GRN Number' })
  await first.locator('summary').focus()
  await page.keyboard.press('Enter')
  assert.equal(await first.locator('details').getAttribute('open'), '')
  assert.match(await first.innerText(), /99%/)
  const second = page.getByRole('group', { name: 'Suggestion: Delivery notes' })
  await second.locator('summary').click()
  assert.match(await second.innerText(), /Not available/)
  assert.match(await second.innerText(), /validation request timed out/)
  assert.doesNotMatch(await second.innerText(), /\b0%/)
  await second.getByRole('button', { name: 'Include field' }).click()
  await page.getByRole('group', { name: 'Included field: Delivery notes' }).waitFor()

  await mkdir(output, { recursive: true })
  for (const [name, width, dark] of [['desktop',1366,false], ['mobile',390,false], ['mobile-dark',390,true]]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate((enabled)=>document.documentElement.classList.toggle('dark',enabled),dark)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth),false, name+' must fit viewport')
    await page.screenshot({ path: output+name+'.png', fullPage: true, animations: 'disabled' })
  }
  await page.getByRole('button', {name:'Simulate uncertain validation'}).click()
  const uncertain = page.getByRole('group', {name:'Included field: Delivery notes'})
  assert.ok(await uncertain.getByText('Needs review', {exact:true}).first().isVisible())
  assert.equal(await uncertain.getByText('Not validated', {exact:true}).count(), 0)
  await page.getByRole('button', {name:'Toggle digital only fixture'}).click()
  const summary = page.getByRole('region', {name:'Extraction quality and AI confidence'})
  assert.match(await summary.innerText(), /Skipped/)
  await page.getByRole('button', {name:'Toggle legacy fixture'}).click()
  assert.match(await summary.innerText(), /older score format/)
  assert.equal(await page.getByText('1% low', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('Confidence UI passed: desktop/mobile/dark, keyboard details, missing/legacy scores, include interaction.')
} finally {
  await browser?.close()
  await server.close()
}
