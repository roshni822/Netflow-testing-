const assert = require('node:assert/strict')
const { generateLlmDocumentSchema, GENERATOR_SYSTEM, CRITIC_SYSTEM, RECOVERY_SYSTEM, compactPassResult } = require('../services/documentSchemaLlm')
const { generateDocumentFormDraft, sanitizeDocumentDraft } = require('../services/documentFormMapper')
const { reviewedDocumentFields } = require('../services/documentReviewCompletion')
const Form = require('../models/Form')
const FormGenerationJob = require('../models/FormGenerationJob')
const { extractionGaps } = require('../services/documentCandidateAudit')

const line = (id, text = id, page = 1) => ({ id, text, page, source: 'digital', confidence: 100, x: 0.1, y: 0.1, width: 0.2, height: 0.02 })
const field = (id, label = id, extra = {}) => ({ sourceLabel: label, label, sourceLineIds: [id], role: 'input',
  type: 'text', necessity: 'core', generatorConfidence: 98, criticConfidence: 97, ...extra })
const pass = (fields, extra = {}) => ({ confidenceScale: 'percent', document: { title: 'Document intake' }, fields, ...extra })
const support = (ids) => ({ sourceLineIds: ids, classification: 'supporting', reason: 'Printed document context, not an input.' })

async function run(lines, generator, critic, recovery, draft = true) {
  const calls = []
  const execute = draft ? generateDocumentFormDraft : generateLlmDocumentSchema
  const result = await execute(lines, { llmAvailable: true, maxInputCharacters: 12000,
    generate: async (prompt, options) => {
      assert.ok(prompt.length + options.system.length <= 12000, 'Every request respects the production budget')
      const data = JSON.parse(prompt)
      const phase = options.system === GENERATOR_SYSTEM ? 'generator' : options.system === CRITIC_SYSTEM ? 'critic' : options.system === RECOVERY_SYSTEM ? 'recovery' : 'invalid'
      calls.push(phase)
      const response = { generator, critic, recovery }[phase]
      if (response instanceof Error) throw response
      assert.ok(response, 'Unexpected ' + phase + ' call')
      return typeof response === 'function' ? response(data) : response
    }
  })
  return { result, calls }
}

async function main() {
  const lines = [line('invoice', 'Invoice Number'), line('date', 'Invoice Date'), line('footer', 'Thank you')]
  const invoice = field('invoice', 'Invoice Number')
  const date = field('date', 'Invoice Date')
  const complete = await run(lines, pass([invoice, date]), pass([invoice, date], { sourceAudit: [support(['footer'])] }))
  assert.deepEqual(complete.calls, ['generator', 'critic'])
  assert.equal(complete.result.coverage.status, 'complete')
  assert.equal(complete.result.candidates.length, 2)
  assert.ok(complete.result.candidates.every((candidate) => candidate.includedByDefault))

  const missed = await run(lines, pass([invoice]), pass([invoice], { sourceAudit: [support(['footer'])] }),
    (data) => { assert.deepEqual(data.targetLineIds, ['date']); return pass([date]) })
  assert.deepEqual(missed.calls, ['generator', 'critic', 'recovery'])
  assert.equal(missed.result.candidates.length, 2)
  const recovered = missed.result.candidates.find((candidate) => candidate.field.label === 'Invoice Date')
  assert.equal(recovered.includedByDefault, false)
  assert.equal(recovered.criticStatus, 'unavailable')
  assert.equal(missed.result.coverage.status, 'partial', 'Recovery is not independent validation')

  const omitted = await run(lines, pass([invoice, date]), pass([invoice], { sourceAudit: [support(['footer', 'date'])] }), new Error('timeout'))
  assert.equal(omitted.result.candidates.length, 2, 'Silent critic omission cannot delete a source-backed input')
  assert.equal(omitted.result.candidates[1].includedByDefault, false)
  assert.equal(omitted.result.coverage.recoveryFailures, 1)

  const explicit = await run(lines, pass([invoice, date]), (data) => pass([invoice], {
    candidateDecisions: [{ candidateId: data.generatorResult.fields[1].candidateId, decision: 'exclude', reason: 'Report timestamp, not a future input.' }],
    sourceAudit: [support(['footer'])]
  }))
  assert.equal(explicit.result.candidates.length, 1)
  assert.equal(explicit.result.coverage.status, 'complete')

  const regained = await run([lines[0], lines[1]], pass([invoice, date]), pass([invoice]), (data) => pass([
    { ...date, candidateId: data.generatorResult.fields[0].candidateId }
  ]))
  assert.equal(regained.result.candidates[1].criticStatus, 'validated')
  assert.equal(regained.result.candidates[1].includedByDefault, true)

  const uncertain = await run([lines[0]], pass([invoice]), (data) => pass([
    { ...invoice, candidateId: data.generatorResult.fields[0].candidateId }
  ], { candidateDecisions: [{ candidateId: data.generatorResult.fields[0].candidateId,
    decision: 'unresolved', reason: 'The source is ambiguous.' }] }), new Error('recovery unavailable'))
  assert.equal(uncertain.result.candidates[0].includedByDefault, false, 'Explicit uncertainty overrides a high confidence score')
  assert.equal(uncertain.result.coverage.status, 'partial')

  const failed = await run([lines[0]], pass([invoice]), new Error('critic unavailable'), new Error('recovery unavailable'))
  assert.equal(failed.calls.length, 3)
  assert.equal(failed.result.coverage.unresolvedCount, 1)
  assert.equal(failed.result.candidates[0].includedByDefault, false)

  const malicious = await run([lines[0], lines[1]], pass([invoice]), pass([invoice], {
    sourceAudit: [support(['date', 'invented'])]
  }), pass([field('invented', 'Bank account')], { sourceAudit: [support(['invented'])] }))
  assert.equal(malicious.result.candidates.length, 1)
  assert.equal(malicious.result.coverage.status, 'partial')
  assert.equal(malicious.result.coverage.unresolvedCount, 1)

  const weak = sanitizeDocumentDraft(pass([field('source', 'Recipient contact')]), [line('source', 'Receiver details')])
  assert.equal(weak.candidates.length, 1)
  assert.equal(weak.candidates[0].includedByDefault, false)
  assert.ok(weak.candidates[0].reviewWarnings.some((warning) => /wording differs/.test(warning)))
  assert.equal(sanitizeDocumentDraft(pass([field('fake')]), [line('real')]).candidates.length, 0)
  assert.equal(sanitizeDocumentDraft(pass([field('empty')]), [line('empty', '')]).candidates.length, 0)

  const contexts = sanitizeDocumentDraft(pass([
    field('bill', 'Address', { context: 'Bill to' }), field('ship', 'Address', { context: 'Ship to' }),
    field('bill', 'Address', { context: 'Bill to' })
  ]), [line('bill', 'Address'), line('ship', 'Address')])
  assert.equal(contexts.candidates.length, 2)
  assert.equal(contexts.diagnostics.merged, 1)

  const hindi = await run([line('hi', 'प्राप्तकर्ता का नाम'), line('en', 'Invoice Number')],
    pass([field('hi', 'प्राप्तकर्ता का नाम'), field('en', 'Invoice Number')]), pass([field('hi', 'प्राप्तकर्ता का नाम'), field('en', 'Invoice Number')]))
  assert.equal(hindi.result.candidates[0].labelGroundingConfidence, 100)
  const scanned = sanitizeDocumentDraft(pass([invoice]), [{ ...lines[0], source: 'ocr', confidence: 62 }])
  assert.equal(scanned.candidates[0].includedByDefault, false)
  assert.equal(scanned.candidates[0].ocrConfidence, 62)
  assert.deepEqual(extractionGaps([{ page: 1 }, { page: 2 }, { page: 3 }], [
    { ...lines[0], source: 'ocr', confidence: 45 }, line('page3', 'Readable', 3)
  ]), { unreadablePageCount: 1, lowConfidenceOcrPageCount: 1 })

  const table = await run([line('headers', 'Item Qty'), line('row', 'Pencil 12')],
    pass([field('headers', 'Items', { sourceLabel: 'Item', type: 'grid', role: 'table', columns: [{ label: 'Item', type: 'text' }, { label: 'Qty', type: 'number' }] })]),
    pass([field('headers', 'Items', { sourceLabel: 'Item', type: 'grid', role: 'table', columns: [{ label: 'Item', type: 'text' }, { label: 'Qty', type: 'number' }] })], { sourceAudit: [support(['row'])] }))
  assert.equal(table.result.candidates.length, 1)
  assert.equal(table.result.candidates[0].field.type, 'grid')

  for (const count of [25, 26, 100, 101]) {
    const source = Array.from({ length: count }, (_, index) => line('f' + index, 'Field ' + index, 1 + Math.floor(index / 20)))
    const fields = source.map((item) => field(item.id, item.text))
    const draft = sanitizeDocumentDraft(pass(fields, { coverage: { status: 'complete', unresolvedCount: 0 } }), source)
    assert.equal(draft.candidates.length, Math.min(count, 100))
    assert.equal(draft.limitReached, count > 100)
    if (count > 100) assert.equal(draft.coverage.status, 'partial')
    const selected = draft.candidates.map((candidate) => ({ candidateId: candidate.candidateId, included: true, field: candidate.field }))
    const completed = reviewedDocumentFields(draft, selected)
    assert.equal(completed.length, Math.min(count, 100))
    // Same field array that the builder saves: schema validation must not truncate.
    const form = new Form({ title: draft.title, createdBy: '507f1f77bcf86cd799439011', fields: completed.map((item, index) => ({ ...item, id: 'builder-' + index })) })
    await form.validate()
    assert.equal(form.toObject().fields.length, Math.min(count, 100))
    const job = new FormGenerationJob({ ...draft, orgId: '507f1f77bcf86cd799439011', requesterId: '507f1f77bcf86cd799439012',
      sourceFile: { filename: 'fixture.pdf', mimetype: 'application/pdf', size: 100, storage: 'local' }, expiresAt: new Date() })
    await job.validate()
    assert.equal(job.candidates.length, Math.min(count, 100))
    assert.throws(() => reviewedDocumentFields(draft, [...selected, ...selected]), /at most|at most once/)
  }
  assert.equal(compactPassResult(pass(Array.from({ length: 101 }, (_, index) => field('f' + index)))).limitReached, true)
  const capped = await run([lines[0]], pass([invoice], { hasMoreFields: true }), pass([invoice]))
  assert.equal(capped.result.limitReached, true)
  assert.equal(capped.result.coverage.status, 'partial')
  assert.throws(() => reviewedDocumentFields({ processingVersion: 1, candidates: [] }, Array.from({ length: 26 }, () => ({ included: true }))), /at most 25/)
  assert.throws(() => reviewedDocumentFields({ processingVersion: 2, candidates: [] }, [{ candidateId: 'forged', included: true }]), /generated candidate/)
  console.log('Candidate audit passed: coverage/recovery, omissions, invalid citations, weak labels, contextual duplicates, Hindi, OCR, tables, 25/100/101 fields, completion and save-schema compatibility.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
