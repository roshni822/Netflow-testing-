const assert = require('node:assert/strict')
const FormGenerationJob = require('../models/FormGenerationJob')
const {
  sanitizeAiFields,
  identifierLabel,
  documentFieldValidationError
} = require('../utils/formDraftSchema')
const {
  MAX_FIELDS,
  confidenceTier,
  sanitizeDocumentDraft,
  generateDocumentFormDraft
} = require('../services/documentFormMapper')
const {
  compactLineArray,
  extractDeterministicFields,
  selectRelevantLines,
  buildManualSuggestions
} = require('../services/documentFieldHeuristics')
const {
  GENERATOR_SYSTEM,
  CRITIC_SYSTEM,
  RECOVERY_SYSTEM,
  compactPassResult,
  layoutPreservingChunks,
  generateLlmDocumentSchema
} = require('../services/documentSchemaLlm')
const { boundedStoredLines, retryDelayFor } = require('../services/formGenerationProcessor')
const { llmScore, qualitySummary } = require('../services/documentConfidence')

const line = (id, text, page = 1, confidence = 96, y = 0.1, x = 0.1) => ({
  id,
  text,
  page,
  confidence,
  source: 'digital',
  x,
  y,
  width: 0.25,
  height: 0.03
})

const semanticField = ({
  sourceLabel,
  label,
  type = 'text',
  sourceLineIds,
  necessity = 'core',
  required = false,
  requiredReason = '',
  generatorConfidence = 96,
  criticConfidence = 95,
  decisionReason = 'Useful editable business input.',
  ...extra
}) => ({
  role: type === 'grid' ? 'table' : 'input',
  sourceLabel,
  label,
  type,
  sourceLineIds,
  necessity,
  required,
  requiredReason,
  generatorConfidence,
  criticConfidence,
  decisionReason,
  ...extra
})

const pass = (fields, {
  title = 'Purchase Order Intake',
  description = 'Capture purchase order details for review and processing.',
  type = 'purchase_order'
} = {}) => ({
  document: { type, title, description },
  fields
})

const providerFailure = (code) => {
  const error = new Error('all providers failed')
  error.code = 'LLM_ALL_PROVIDERS_FAILED'
  error.failures = [{ provider: 'gemini', code }]
  return error
}

function passAwareGenerator(generatorResult, criticResult, calls) {
  return async (prompt, options) => {
    const phase = options.system === GENERATOR_SYSTEM ? 'generator' :
      options.system === CRITIC_SYSTEM ? 'critic' : options.system === RECOVERY_SYSTEM ? 'recovery' : 'unknown'
    calls.push({ phase, prompt: JSON.parse(prompt), options })
    if (phase === 'generator') {
      if (generatorResult instanceof Error) throw generatorResult
      return generatorResult
    }
    if (criticResult instanceof Error) throw criticResult
    // These fixtures explicitly classify their non-input text; incomplete audit
    // and recovery behavior have dedicated tests in document_candidate_audit.
    const cited = new Set(criticResult.fields.flatMap((field) => field.sourceLineIds || []))
    const supporting = JSON.parse(prompt).source.lines.map((line) => line[0]).filter((id) => !cited.has(id))
    return { ...criticResult, sourceAudit: supporting.length ? [{ sourceLineIds: supporting,
      classification: 'supporting', reason: 'Fixture metadata and supporting values.' }] : [] }
  }
}

async function main() {
  assert.equal(llmScore(0.99), 99)
  assert.equal(llmScore(1, 'fraction'), 100)
  assert.equal(llmScore(1, 'percent'), 1)
  assert.equal(llmScore(0.95, 'percent'), 0.95)
  assert.equal(llmScore(95), 95)
  assert.equal(llmScore(0), 0)
  for (const value of [null, undefined, '', ' ', true, false, 'invalid', -1, Infinity, 101]) {
    assert.equal(llmScore(value), null)
  }
  const alreadyPercent = compactPassResult({
    confidenceScale: 'percent', fields: [{ generatorConfidence: 1, criticConfidence: 0 }]
  }, { critic: true })
  assert.equal(alreadyPercent.fields[0].generatorConfidence, 1)
  assert.equal(alreadyPercent.fields[0].criticConfidence, 0)
  assert.equal(compactPassResult(alreadyPercent, { critic: true }).fields[0].generatorConfidence, 1)

  // Regression for the observed GRNs job: 0.99 was rounded to a 1% review score.
  const fractionalField = semanticField({
    sourceLabel: 'GRN', label: 'GRN Number', sourceLineIds: ['grn'],
    generatorConfidence: 0.99, criticConfidence: 0.96
  })
  const fractionalCalls = []
  const fractional = await generateDocumentFormDraft([line('grn', 'GRN', 1, 100)], {
    llmAvailable: true, maxInputCharacters: 50000,
    generate: passAwareGenerator(pass([fractionalField]), pass([fractionalField]), fractionalCalls)
  })
  assert.equal(fractional.candidates[0].confidence, 96)
  assert.equal(fractional.candidates[0].generatorConfidence, 99)
  assert.equal(fractional.candidates[0].criticConfidence, 96)
  assert.equal(fractional.candidates[0].includedByDefault, true)
  assert.equal(fractional.candidates[0].labelGroundingConfidence, 100)
  assert.deepEqual(fractional.candidates[0].sourceMethods, ['digital'])
  assert.equal(fractional.candidates[0].ocrConfidence, null)
  assert.equal(fractional.candidates[0].scoreVersion, 2)
  assert.equal(fractional.qualitySummary.ocr.confidence, null)
  assert.equal(fractional.qualitySummary.grounding.confidence, 99)
  assert.equal(fractional.qualitySummary.validation.confidence, 96)
  assert.equal(fractionalCalls[0].prompt.outputContract.confidenceScale, 'percent')
  assert.equal(fractionalCalls[1].prompt.generatorResult.confidenceScale, 'percent')

  const missing = sanitizeDocumentDraft({ criticStatus: 'validated', fields: [{
    ...fractionalField, generatorConfidence: null, criticConfidence: null
  }] }, [line('grn', 'GRN')])
  assert.equal(missing.candidates[0].generatorConfidence, null)
  assert.equal(missing.candidates[0].criticConfidence, null)
  assert.equal(missing.candidates[0].includedByDefault, false)
  assert.equal(missing.qualitySummary.grounding.confidence, null)
  assert.equal(missing.qualitySummary.grounding.scoredFields, 0)

  const partialValidation = sanitizeDocumentDraft({
    criticStatus: 'unavailable',
    fields: [
      { ...fractionalField, generatorConfidence: 99, criticConfidence: 96, _criticStatus: 'validated' },
      { ...fractionalField, label: 'Receipt reference', generatorConfidence: 97, criticConfidence: null, _criticStatus: 'unavailable' }
    ]
  }, [line('grn', 'GRN', 1, 100)])
  assert.equal(partialValidation.candidates[0].criticStatus, 'validated')
  assert.equal(partialValidation.candidates[1].includedByDefault, false)
  assert.equal(partialValidation.qualitySummary.validation.scoredFields, 1)
  assert.equal(partialValidation.qualitySummary.validation.unavailableFields, 1)

  assert.equal(confidenceTier(85), 'high')
  assert.equal(confidenceTier(84), 'medium')
  assert.equal(confidenceTier(60), 'medium')
  assert.equal(confidenceTier(59), 'low')
  assert.equal(identifierLabel('Purchase Order Number'), true)
  assert.equal(identifierLabel('Tax ID'), true)
  assert.equal(identifierLabel('Total Amount'), false)

  const normalized = sanitizeAiFields(
    [{ label: 'Tax ID', type: 'number' }],
    { identifiersAsText: true }
  )
  assert.equal(normalized[0].type, 'text')
  assert.equal(documentFieldValidationError({
    label: 'Approval',
    type: 'dropdown',
    options: ['Yes']
  }), 'Dropdown and radio fields need at least two distinct options.')

  // Existing deterministic helpers remain operational for PDF-autofill consumers.
  const legacyLines = [
    line('legacy-title', 'Goods Received Note', 1, 99, 0.03),
    line('legacy-grn', 'GRN No:', 1, 99, 0.1),
    line('legacy-total', 'Total:', 1, 99, 0.8)
  ]
  const legacyFields = extractDeterministicFields(legacyLines, { documentType: 'goods_receipt' })
  assert.ok(legacyFields.some((field) => field.label === 'GRN No'))
  assert.ok(legacyFields.some((field) => field.label === 'Total'))
  assert.equal(buildManualSuggestions([line('legacy-ref', 'Reference Code:')]).length, 1)
  const budgetSelection = selectRelevantLines(
    Array.from({ length: 40 }, (_, index) => line('legacy-' + index, 'Reference ' + index + ':')),
    { maxCharacters: 700 }
  )
  assert.ok(JSON.stringify(budgetSelection.map(compactLineArray)).length <= 700)

  const poLines = [
    line('po-title', 'PURCHASE ORDER', 1, 99, 0.03, 0.05),
    line('po-number', 'PO-2010', 1, 99, 0.03, 0.75),
    line('issued', 'Issued 2026-01-25', 1, 99, 0.08),
    line('delivery', 'Expected Delivery 2026-02-24', 1, 98, 0.08, 0.25),
    line('plant', 'Plant PLT-004', 1, 98, 0.08, 0.5),
    line('instance', 'Instance ERP-INST-001', 1, 98, 0.08, 0.7),
    line('supplier', 'SUPPLIER', 1, 99, 0.15),
    line('supplier-name', 'Summit Hydraulics Ltd.', 1, 99, 0.18),
    line('supplier-code', 'Supplier Code SUP-00942', 1, 99, 0.21),
    line('tax-id', 'Tax ID EIN-04-2945678', 1, 99, 0.24),
    line('ship', 'SHIP TO / PLANT', 1, 99, 0.15, 0.55),
    line('currency', 'Currency USD', 1, 99, 0.24, 0.55),
    line('headers', 'Item Code Description Qty UoM Unit Price Line Total', 1, 99, 0.34),
    line('row', 'STL-CR-0.18x36 Cold-rolled steel sheet 10 MT 283.54 2835.41', 1, 98, 0.39),
    line('total', 'PO TOTAL $3,521.41', 1, 99, 0.58, 0.7),
    line('notes', 'Notes: Copper order - test fixture', 1, 96, 0.65)
  ]

  const generatorFields = [
    semanticField({
      sourceLabel: 'PURCHASE ORDER',
      label: 'PO Number',
      sourceLineIds: ['po-title', 'po-number'],
      required: true,
      requiredReason: 'A purchase order requires its business identifier.'
    }),
    semanticField({ sourceLabel: 'Issued', label: 'Issue Date', type: 'date', sourceLineIds: ['issued'] }),
    semanticField({ sourceLabel: 'Expected Delivery', label: 'Expected Delivery', type: 'date', sourceLineIds: ['delivery'] }),
    semanticField({ sourceLabel: 'SUPPLIER', label: 'Supplier Name', sourceLineIds: ['supplier', 'supplier-name'] }),
    semanticField({ sourceLabel: 'Supplier Code', label: 'Supplier Code', sourceLineIds: ['supplier-code'] }),
    semanticField({ sourceLabel: 'Tax ID', label: 'Tax ID', type: 'number', sourceLineIds: ['tax-id'] }),
    semanticField({ sourceLabel: 'Plant', label: 'Plant', sourceLineIds: ['plant'] }),
    semanticField({ sourceLabel: 'Currency', label: 'Currency', sourceLineIds: ['currency'] }),
    semanticField({
      sourceLabel: 'Item Code',
      label: 'Line Items',
      type: 'grid',
      sourceLineIds: ['headers', 'row'],
      columns: [
        { label: 'Item Code', type: 'text' },
        { label: 'Description', type: 'text' },
        { label: 'Qty', type: 'number' },
        { label: 'UoM', type: 'text' },
        { label: 'Unit Price', type: 'number' },
        { label: 'Line Total', type: 'number' }
      ]
    }),
    semanticField({
      sourceLabel: 'Notes',
      label: 'Notes',
      sourceLineIds: ['notes'],
      necessity: 'optional',
      multiline: true
    })
  ]
  const criticFields = [
    ...generatorFields.map((field) => ({ ...field, criticConfidence: 94 })),
    semanticField({ sourceLabel: 'PO TOTAL', label: 'Total', type: 'number', sourceLineIds: ['total'] }),
    semanticField({
      sourceLabel: 'Instance',
      label: 'ERP Instance',
      sourceLineIds: ['instance'],
      necessity: 'exclude',
      decisionReason: 'System metadata is not a user input.'
    }),
    semanticField({
      sourceLabel: 'SUPPLIER',
      label: 'SUPPLIER',
      type: 'heading',
      sourceLineIds: ['supplier'],
      necessity: 'exclude',
      decisionReason: 'Section heading only.'
    })
  ]

  const calls = []
  const draft = await generateDocumentFormDraft(poLines, {
    filename: 'PO-2010_correct.pdf',
    llmAvailable: true,
    maxInputCharacters: 50000,
    generatorMaxTokens: 1234,
    criticMaxTokens: 789,
    generate: passAwareGenerator(
      pass(generatorFields, {
        title: 'Extracted Purchase Order Fields',
        description: 'Additional fields identified from the document.'
      }),
      pass(criticFields),
      calls
    )
  })

  assert.deepEqual(calls.map((call) => call.phase), ['generator', 'critic'])
  assert.ok(calls.every((call) => call.options.temperature === 0))
  assert.equal(calls[0].options.maxTokens, 1234)
  assert.equal(calls[1].options.maxTokens, 789)
  assert.equal(draft.title, 'Purchase Order Intake')
  assert.match(draft.description, /purchase order details/)
  assert.equal(draft.documentType, 'purchase_order')
  assert.equal(draft.criticStatus, 'validated')
  assert.equal(draft.candidates.some((candidate) => candidate.field.label === 'ERP Instance'), false)
  assert.equal(draft.candidates.some((candidate) => candidate.field.label === 'SUPPLIER'), false)

  const poNumber = draft.candidates.find((candidate) => candidate.field.label === 'PO Number')
  assert.equal(poNumber.field.type, 'text')
  assert.equal(poNumber.necessity, 'core')
  assert.equal(poNumber.includedByDefault, true)
  assert.equal(poNumber.confidence, 94)
  assert.equal(poNumber.generatorConfidence, 96)
  assert.equal(poNumber.criticConfidence, 94)
  assert.match(poNumber.reviewWarnings.join(' '), /inferred by the LLM/)
  assert.match(poNumber.requiredReason, /business identifier/)
  assert.deepEqual(poNumber.sourceLineIds, ['po-title', 'po-number'])
  assert.equal(Object.hasOwn(poNumber.sourceRegions[0], 'text'), false)

  const supplier = draft.candidates.find((candidate) => candidate.field.label === 'Supplier Name')
  assert.equal(supplier.sourceLabel, 'SUPPLIER')
  assert.equal(supplier.includedByDefault, true)
  assert.equal(draft.candidates.find((candidate) => candidate.field.label === 'Tax ID').field.type, 'text')
  const table = draft.candidates.find((candidate) => candidate.field.type === 'grid')
  assert.deepEqual(
    table.field.columns.map((column) => column.label),
    ['Item Code', 'Description', 'Qty', 'UoM', 'Unit Price', 'Line Total']
  )
  assert.ok(draft.candidates.some((candidate) => candidate.field.label === 'Total'))
  const notes = draft.candidates.find((candidate) => candidate.field.label === 'Notes')
  assert.equal(notes.necessity, 'optional')
  assert.equal(notes.includedByDefault, false)

  // Unknown citations are rejected while normalized labels remain valid.
  const grounded = sanitizeDocumentDraft({
    document: { title: 'Supplier Registration', description: 'Register a supplier.' },
    criticStatus: 'validated',
    fields: [
      semanticField({
        sourceLabel: 'SUPPLIER',
        label: 'Supplier Name',
        sourceLineIds: ['supplier'],
        generatorConfidence: 98,
        criticConfidence: 92
      }),
      semanticField({
        sourceLabel: 'Invented',
        label: 'Invented Field',
        sourceLineIds: ['does-not-exist'],
        generatorConfidence: 100,
        criticConfidence: 100
      }),
      semanticField({
        sourceLabel: 'Notes',
        label: 'Notes',
        sourceLineIds: ['notes'],
        necessity: 'optional',
        generatorConfidence: 99,
        criticConfidence: 99
      })
    ]
  }, poLines, { filename: 'supplier.pdf' })
  assert.deepEqual(grounded.candidates.map((candidate) => candidate.field.label), ['Supplier Name', 'Notes'])
  assert.equal(grounded.candidates[1].includedByDefault, false)

  const lowExtraction = sanitizeDocumentDraft({
    criticStatus: 'validated',
    fields: [semanticField({
      sourceLabel: 'Reference',
      label: 'Reference Number',
      sourceLineIds: ['low-reference'],
      generatorConfidence: 96,
      criticConfidence: 94
    })]
  }, [line('low-reference', 'Reference', 1, 67)], { filename: 'reference.pdf' })
  assert.equal(lowExtraction.candidates[0].confidence, 67)
  assert.equal(lowExtraction.candidates[0].confidenceTier, 'medium')
  assert.equal(lowExtraction.candidates[0].includedByDefault, false)

  const invalidStructures = sanitizeDocumentDraft({
    criticStatus: 'validated',
    fields: [
      semanticField({
        sourceLabel: 'Approval',
        label: 'Approval',
        type: 'dropdown',
        sourceLineIds: ['approval'],
        options: ['Yes', 'Invented']
      }),
      semanticField({
        sourceLabel: 'Item Code',
        label: 'Line Items',
        type: 'grid',
        sourceLineIds: ['headers'],
        columns: [
          { label: 'Item Code', type: 'text' },
          { label: 'Hallucinated', type: 'text' }
        ]
      })
    ]
  }, [
    line('approval', 'Approval Yes'),
    poLines.find((item) => item.id === 'headers')
  ], { filename: 'invalid-structures.pdf' })
  assert.equal(invalidStructures.candidates[0].field.type, 'text')
  assert.equal(invalidStructures.candidates[0].confidenceTier, 'low')
  assert.deepEqual(invalidStructures.candidates[1].field.columns.map((column) => column.label), ['Item Code'])

  const duplicate = sanitizeDocumentDraft({
    criticStatus: 'validated',
    fields: [
      semanticField({
        sourceLabel: 'SUPPLIER',
        label: 'Supplier Name',
        sourceLineIds: ['supplier'],
        necessity: 'optional',
        generatorConfidence: 90,
        criticConfidence: 90
      }),
      semanticField({
        sourceLabel: 'SUPPLIER',
        label: 'Supplier Name',
        sourceLineIds: ['supplier', 'supplier-name'],
        necessity: 'core',
        generatorConfidence: 96,
        criticConfidence: 95
      })
    ]
  }, poLines, { filename: 'duplicate.pdf' })
  assert.equal(duplicate.candidates.length, 1)
  assert.equal(duplicate.candidates[0].necessity, 'core')
  assert.equal(duplicate.candidates[0].sourceRegions.length, 2)
  assert.deepEqual(duplicate.candidates[0].sourceLineIds, ['supplier', 'supplier-name'])
  assert.equal(duplicate.candidates[0].includedByDefault, true)

  // Critic-only failure is graceful and never auto-includes generator output.
  const criticCalls = []
  const unvalidated = await generateDocumentFormDraft(
    [line('employee-code', 'Employee Code')],
    {
      filename: 'employee.pdf',
      llmAvailable: true,
      maxInputCharacters: 50000,
      generate: passAwareGenerator(
        pass([semanticField({
          sourceLabel: 'Employee Code',
          label: 'Employee Code',
          sourceLineIds: ['employee-code']
        })], { title: 'Employee Form', description: 'Capture employee data.', type: 'employee' }),
        new Error('critic rate limited'),
        criticCalls
      )
    }
  )
  assert.deepEqual(criticCalls.map((call) => call.phase), ['generator', 'critic', 'recovery'])
  assert.equal(unvalidated.criticStatus, 'unavailable')
  assert.equal(unvalidated.candidates[0].includedByDefault, false)
  assert.equal(unvalidated.candidates[0].confidence, 0)
  assert.equal(unvalidated.candidates[0].criticConfidence, null)
  assert.equal(unvalidated.qualitySummary.validation.confidence, null)
  assert.equal(unvalidated.qualitySummary.validation.unavailableFields, 1)
  assert.match(unvalidated.candidates[0].reviewWarnings.join(' '), /critic validation was unavailable/i)

  // An oversized critic payload must not cause paid generator calls to repeat.
  const oversizedCalls = []
  const oversizedFields = Array.from({ length: 25 }, (_, index) => semanticField({
    sourceLabel: 'Field Alpha',
    label: 'Generated Field ' + index,
    sourceLineIds: ['large-a'],
    decisionReason: 'Useful business input '.repeat(20)
  }))
  const oversized = await generateLlmDocumentSchema([
    line('large-a', 'Field Alpha'),
    line('large-b', 'Field Beta', 1, 96, 0.2)
  ], {
    filename: 'oversized.pdf',
    llmAvailable: true,
    maxInputCharacters: 5000,
    generate: passAwareGenerator(
      pass(oversizedFields),
      pass([]),
      oversizedCalls
    )
  })
  assert.equal(oversizedCalls.filter((call) => call.phase === 'generator').length, 1)
  assert.ok(oversizedCalls.filter((call) => call.phase === 'critic').length > 1)
  assert.ok(oversizedCalls.every((call) => JSON.stringify(call.prompt).length + call.options.system.length <= 5000))
  assert.equal(oversized.criticStatus, 'unavailable')
  assert.ok(oversized.fields.every((field) => field.criticConfidence == null))

  await assert.rejects(
    generateDocumentFormDraft([line('failure', 'Employee Code')], {
      filename: 'failure.pdf',
      llmAvailable: true,
      generate: async () => { throw new Error('all providers failed') }
    }),
    (error) => error.code === 'LLM_UNAVAILABLE'
  )
  await assert.rejects(
    generateLlmDocumentSchema([line('rate-limit', 'Employee Code')], {
      filename: 'rate-limit.pdf',
      llmAvailable: true,
      generate: async () => {
        const error = new Error('all providers failed')
        error.code = 'LLM_ALL_PROVIDERS_FAILED'
        error.failures = [{ provider: 'groq', code: 'RATE_LIMITED' }]
        throw error
      }
    }),
    (error) => error.code === 'LLM_RATE_LIMITED' && error.retryable === true
  )

  let quotaCalls = 0
  await assert.rejects(
    generateLlmDocumentSchema([line('daily-quota', 'Employee Code')], {
      filename: 'daily-quota.pdf',
      llmAvailable: true,
      generate: async () => {
        quotaCalls += 1
        throw providerFailure('QUOTA_EXHAUSTED')
      }
    }),
    (error) => error.code === 'LLM_QUOTA_EXHAUSTED' && error.retryable === false
  )
  assert.equal(quotaCalls, 1)

  const adaptiveGeneratorCalls = []
  let generatorTruncated = false
  const adaptiveGenerator = await generateLlmDocumentSchema([
    line('adaptive-generator', 'Employee Code')
  ], {
    filename: 'adaptive-generator.pdf',
    llmAvailable: true,
    generatorMaxTokens: 3500,
    criticMaxTokens: 2500,
    retryMaxTokens: 7000,
    generate: async (prompt, options) => {
      const phase = options.system === GENERATOR_SYSTEM ? 'generator' : 'critic'
      adaptiveGeneratorCalls.push({ phase, maxTokens: options.maxTokens })
      if (phase === 'generator' && !generatorTruncated) {
        generatorTruncated = true
        throw providerFailure('OUTPUT_TRUNCATED')
      }
      return pass([semanticField({
        sourceLabel: 'Employee Code',
        label: 'Employee Code',
        sourceLineIds: ['adaptive-generator']
      })])
    }
  })
  assert.equal(adaptiveGenerator.criticStatus, 'validated')
  assert.deepEqual(adaptiveGeneratorCalls, [
    { phase: 'generator', maxTokens: 3500 },
    { phase: 'generator', maxTokens: 7000 },
    { phase: 'critic', maxTokens: 2500 }
  ])

  const adaptiveCriticCalls = []
  let criticTruncated = false
  const adaptiveCritic = await generateLlmDocumentSchema([
    line('adaptive-critic', 'Employee Code')
  ], {
    filename: 'adaptive-critic.pdf',
    llmAvailable: true,
    generatorMaxTokens: 3500,
    criticMaxTokens: 2500,
    retryMaxTokens: 7000,
    generate: async (prompt, options) => {
      const phase = options.system === GENERATOR_SYSTEM ? 'generator' : 'critic'
      adaptiveCriticCalls.push({ phase, maxTokens: options.maxTokens })
      if (phase === 'critic' && !criticTruncated) {
        criticTruncated = true
        throw providerFailure('OUTPUT_TRUNCATED')
      }
      return pass([semanticField({
        sourceLabel: 'Employee Code',
        label: 'Employee Code',
        sourceLineIds: ['adaptive-critic']
      })])
    }
  })
  assert.equal(adaptiveCritic.criticStatus, 'validated')
  assert.deepEqual(adaptiveCriticCalls, [
    { phase: 'generator', maxTokens: 3500 },
    { phase: 'critic', maxTokens: 2500 },
    { phase: 'critic', maxTokens: 5000 }
  ])

  const exhaustedCalls = []
  await assert.rejects(
    generateLlmDocumentSchema([line('output-cap', 'Employee Code')], {
      filename: 'output-cap.pdf',
      llmAvailable: true,
      generatorMaxTokens: 3500,
      retryMaxTokens: 7000,
      generate: async (_prompt, options) => {
        exhaustedCalls.push(options.maxTokens)
        throw providerFailure('OUTPUT_TRUNCATED')
      }
    }),
    (error) => error.code === 'LLM_OUTPUT_TRUNCATED' && error.retryable === false
  )
  assert.deepEqual(exhaustedCalls, [3500, 7000])

  await assert.rejects(
    generateLlmDocumentSchema([line('auth', 'Employee Code')], {
      filename: 'auth.pdf',
      llmAvailable: true,
      generate: async () => {
        const error = new Error('all providers failed')
        error.code = 'LLM_ALL_PROVIDERS_FAILED'
        error.failures = [{ provider: 'groq', code: 'AUTHENTICATION_FAILED' }]
        throw error
      }
    }),
    (error) => error.code === 'LLM_AUTHENTICATION_FAILED' && error.retryable === false
  )
  await assert.rejects(
    generateDocumentFormDraft([line('not-configured', 'Employee Code')], {
      filename: 'failure.pdf',
      llmAvailable: false
    }),
    (error) => error.code === 'LLM_UNAVAILABLE'
  )
  await assert.rejects(
    generateDocumentFormDraft([line('invalid-schema', 'Employee Code')], {
      filename: 'failure.pdf',
      llmAvailable: true,
      generate: async () => ({ invalid: true })
    }),
    (error) => error.code === 'SCHEMA_INVALID'
  )

  // Dense multi-page source is chunked without loss and calls remain sequential.
  const denseLines = Array.from({ length: 90 }, (_, index) =>
    line('dense-' + index, 'Field label ' + index, 1 + Math.floor(index / 30), 95, (index % 30) / 31)
  )
  const chunks = layoutPreservingChunks(denseLines, { maxInputCharacters: 5000 })
  assert.ok(chunks.length > 3)
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.lines.map((item) => item.id)),
    denseLines.map((item) => item.id)
  )
  assert.deepEqual([...new Set(chunks.flatMap((chunk) => chunk.lines.map((item) => item.page)))], [1, 2, 3])

  const sequentialCalls = []
  let activeCalls = 0
  let maximumActiveCalls = 0
  await generateLlmDocumentSchema(denseLines, {
    filename: 'dense.pdf',
    llmAvailable: true,
    maxInputCharacters: 5000,
    generate: async (prompt, options) => {
      activeCalls += 1
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls)
      sequentialCalls.push(options.system === GENERATOR_SYSTEM ? 'generator' : options.system === CRITIC_SYSTEM ? 'critic' : 'recovery')
      assert.ok(prompt.length + options.system.length <= 5000)
      await Promise.resolve()
      activeCalls -= 1
      return { ...pass([], { title: 'Dense Form', description: 'Dense source.', type: 'generic_form' }),
        sourceAudit: [{ sourceLineIds: JSON.parse(prompt).source.lines.map((line) => line[0]),
          classification: 'supporting', reason: 'This fixture tests sequential chunk processing only.' }] }
    }
  })
  assert.equal(maximumActiveCalls, 1)
  assert.equal(sequentialCalls.filter((phase) => phase === 'generator').length, chunks.length)
  assert.equal(sequentialCalls.includes('critic'), false, 'No candidates means only coverage recovery is needed')
  assert.ok(sequentialCalls.filter((phase) => phase === 'recovery').length >= chunks.length)

  const ocrDraft = sanitizeDocumentDraft({
    criticStatus: 'validated',
    fields: [semanticField({
      sourceLabel: 'Invoice Number',
      label: 'Invoice Number',
      sourceLineIds: ['ocr-invoice']
    })]
  }, [{ ...line('ocr-invoice', 'Invoice Number', 1, 88), source: 'ocr' }], { filename: 'scan.jpg' })
  assert.equal(ocrDraft.candidates[0].confidence, 88)
  assert.equal(ocrDraft.candidates[0].sourceRegions[0].confidence, 88)
  assert.equal(ocrDraft.candidates[0].sourceRegions[0].source, 'ocr')
  assert.equal(ocrDraft.candidates[0].ocrConfidence, 88)
  assert.equal(ocrDraft.qualitySummary.ocr.confidence, 88)
  assert.equal(ocrDraft.qualitySummary.digital.pageCount, 0)

  const mixedSummary = qualitySummary([
    line('digital', 'Digital', 1, 100),
    { ...line('ocr-a', 'Scanned', 2, 80), source: 'ocr' },
    { ...line('ocr-b', 'Scanned', 2, 90), source: 'ocr' }
  ], [...fractional.candidates, ...unvalidated.candidates])
  assert.equal(mixedSummary.digital.pageCount, 1)
  assert.equal(mixedSummary.ocr.pageCount, 1)
  assert.equal(mixedSummary.ocr.confidence, 85)
  assert.equal(mixedSummary.validation.confidence, 96)
  assert.equal(mixedSummary.validation.scoredFields, 1)
  assert.equal(mixedSummary.validation.totalFields, 2)
  assert.equal(mixedSummary.validation.unavailableFields, 1)

  // New diagnostics survive Mongoose casting; older records remain identifiable.
  const serialized = new FormGenerationJob({ candidates: fractional.candidates, qualitySummary: fractional.qualitySummary }).toObject()
  assert.equal(serialized.candidates[0].scoreVersion, 2)
  assert.equal(serialized.candidates[0].sourceRegions[0].source, 'digital')
  assert.equal(serialized.candidates[0].labelGroundingConfidence, 100)
  assert.equal(serialized.qualitySummary.grounding.confidence, 99)
  const legacyJob = new FormGenerationJob({ candidates: [{ candidateId: 'old', field: {}, confidence: 1, confidenceTier: 'low' }] })
  assert.equal(legacyJob.candidates[0].scoreVersion, 1)
  assert.equal(legacyJob.qualitySummary, null)

  const manyLines = []
  const manyFields = []
  for (let index = 0; index < MAX_FIELDS + 1; index += 1) {
    manyLines.push(line('field-' + index, 'Field ' + index, 1 + Math.floor(index / 25), 99, (index % 25) / 30))
    manyFields.push(semanticField({
      sourceLabel: 'Field ' + index,
      label: 'Field ' + index,
      sourceLineIds: ['field-' + index],
      generatorConfidence: 99,
      criticConfidence: 99
    }))
  }
  const truncated = sanitizeDocumentDraft(
    { criticStatus: 'validated', fields: manyFields },
    manyLines,
    { filename: 'reference-form.pdf' }
  )
  assert.equal(truncated.candidates.length, MAX_FIELDS)
  assert.equal(truncated.detectedFieldCount, MAX_FIELDS + 1)
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.title, 'reference-form')

  assert.equal(FormGenerationJob.definition.fields['lines'].hidden, true)
  assert.equal(FormGenerationJob.definition.fields['errorDetail'].hidden, true)
  assert.ok(FormGenerationJob.definition.fields['criticStatus'])
  assert.ok(FormGenerationJob.definition.fields.candidates.items.fields.necessity)
  assert.equal(boundedStoredLines(
    Array.from({ length: 4002 }, (_, index) => ({ text: String(index) }))
  ).length, 4000)
  assert.equal(boundedStoredLines([
    { text: 'x'.repeat(60001) },
    { text: 'y'.repeat(60001) }
  ]).length, 1)
  assert.equal(retryDelayFor('LLM_RATE_LIMITED', 1), 20000)
  assert.equal(retryDelayFor('LLM_UNAVAILABLE', 2), 40000)
  assert.equal(retryDelayFor('OCR_TIMEOUT', 1), 1500)


  console.log('LLM-first document form generation unit tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
