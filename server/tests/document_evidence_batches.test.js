const assert = require('node:assert/strict')
const { generateDocumentFormDraft } = require('../services/documentFormMapper')
const { GENERATOR_SYSTEM, CRITIC_SYSTEM } = require('../services/documentSchemaLlm')
const { planEvidenceBatches } = require('../services/documentEvidenceBatches')
const FormGenerationJob = require('../models/FormGenerationJob')

const line = (index, text) => ({ id: 'p1-digital-' + index, page: 1, text, source: 'digital', confidence: 100,
  x: 0.1, y: index / 50, width: 0.3, height: 0.015 })
const lines = Array.from({ length: 43 }, (_, i) => line(i + 1, i === 39 ? 'PO TOTAL' : i === 40 ? '$102.62' : i < 12 ? 'Field ' + i : 'Printed context ' + i))
const fields = lines.slice(0, 12).map((item) => ({ label: item.text, sourceLabel: item.text,
  sourceLineIds: [item.id], type: 'text', role: 'input', necessity: 'core',
  generatorConfidence: 98, criticConfidence: 97,
  context: 'Purchase order header '.repeat(5), decisionReason: 'Visible editable business input. '.repeat(8),
  requiredReason: 'Core business input for the purchase order. '.repeat(5) }))
const pass = (items, extra = {}) => ({ confidenceScale: 'percent', document: { title: 'Purchase order' }, fields: items, ...extra })
const support = (ids) => ids.length ? [{ sourceLineIds: ids, classification: 'supporting', reason: 'Printed context, not an editable input.' }] : []

async function scenario(failSecond = false) {
  const requests = []
  let criticCount = 0
  const result = await generateDocumentFormDraft(lines, { llmAvailable: true, maxInputCharacters: 12000,
    generate: async (prompt, options) => {
      const data = JSON.parse(prompt)
      const phase = options.system === GENERATOR_SYSTEM ? 'generator' : options.system === CRITIC_SYSTEM ? 'critic' : 'recovery'
      requests.push({ phase, size: prompt.length + options.system.length, data })
      assert.ok(prompt.length + options.system.length <= 12000)
      if (phase === 'generator') return pass(fields)
      if (phase === 'critic') {
        criticCount++
        if (failSecond && criticCount === 2) throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
        return pass(data.generatorResult.fields.map((field) => ({ ...field, criticConfidence: 97 })))
      }
      if (failSecond) throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
      const totalIds = ['p1-digital-40', 'p1-digital-41']
      const total = data.targetLineIds.includes(totalIds[0]) ? [{ label: 'PO Total', sourceLabel: 'PO TOTAL',
        sourceLineIds: totalIds, type: 'number', role: 'input', necessity: 'core', generatorConfidence: 98, criticConfidence: 97 }] : []
      return pass(total, { sourceAudit: support(data.targetLineIds.filter((id) => !totalIds.includes(id))) })
    }
  })
  assert.equal(requests.filter((request) => request.phase === 'generator').length, 1, 'No paid generator rerun')
  assert.ok(criticCount > 1, 'The combined validator payload is split at the real 12k budget')
  assert.ok(result.candidates.some((candidate) => candidate.includedByDefault), 'Successful core fields remain included: ' + JSON.stringify(result.candidates.map((candidate) => ({ label: candidate.field.label, status: candidate.criticStatus, score: candidate.confidence, reasons: candidate.reviewWarnings }))))
  assert.equal(result.coverage.maxRequestCharacters, Math.max(...requests.map((request) => request.size)))
  if (failSecond) {
    assert.equal(result.coverage.validationFailures, 1)
    assert.ok(result.coverage.failureReasons.includes('provider_timeout'))
    assert.ok(result.candidates.some((candidate) => candidate.validationReason === 'provider_timeout' && !candidate.includedByDefault))
  } else {
    const total = result.candidates.find((candidate) => candidate.field.label === 'PO Total')
    assert.ok(total, 'Printed PO TOTAL must survive the targeted recovery')
    assert.equal(total.sourceRegions.length, 2, 'Both label and amount can be highlighted')
    assert.equal(total.validationReason, 'recovery_only')
    assert.equal(total.includedByDefault, false, 'Recovery discovery is not independent validation')
    const recovery = requests.filter((request) => request.phase === 'recovery')
    assert.ok(recovery.length > 0 && recovery.length <= lines.length, 'Bounded, nonrecursive recovery')
    assert.ok(recovery.every((request) => request.data.source.lines.length < lines.length), 'Recovery does not resend the whole source chunk')
    assert.ok(recovery.every((request) => request.data.targetLineIds.every((id) => !fields.some((field) => field.sourceLineIds.includes(id)))))
  }
  const job = new FormGenerationJob({ ...result, orgId: '507f1f77bcf86cd799439011', requesterId: '507f1f77bcf86cd799439012',
    sourceFile: { filename: 'fixture.pdf', mimetype: 'application/pdf', size: 100, storage: 'local' }, expiresAt: new Date() })
  await job.validate()
  assert.equal(job.processingVersion, 3)
  assert.equal(job.coverage.validationAttempts, criticCount)
  assert.deepEqual(job.candidates.map((candidate) => candidate.validationReason), result.candidates.map((candidate) => candidate.validationReason))
}

async function main() {
  await scenario()
  await scenario(true)
  const chunk = { lines: [line(1, 'before'), line(2, 'label'), line(3, 'value'), line(4, 'after')] }
  const options = { system: 'system', inputLimit: 500, evidenceFor: (item) => item.ids,
    promptFor: (items, source, targets) => JSON.stringify({ items, source, targets }) }
  const huge = { ids: ['p1-digital-2', 'p1-digital-3'], text: 'x'.repeat(600) }
  const planned = planEvidenceBatches([huge, { ids: ['p1-digital-4'] }], chunk, options)
  assert.equal(planned.oversized.length, 1)
  assert.deepEqual(planned.oversized[0].ids, huge.ids, 'Oversized candidates retain all required citations')
  assert.equal(planned.batches.length, 1, 'One oversized field does not block another field')
  assert.ok(planned.batches.every((batch) => batch.characters <= options.inputLimit))
  const contextual = planEvidenceBatches([{ ids: ['p1-digital-2'] }], chunk, { ...options, inputLimit: 2000 })
  assert.deepEqual(contextual.batches[0].source.lines.map((item) => item.id), chunk.lines.map((item) => item.id))
  console.log('Evidence batches passed: 12k whole-request limits, PO total recovery/highlights, partial failures, preserved inclusion, bounded recovery, atomic citations, nearby context and persisted diagnostics.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
