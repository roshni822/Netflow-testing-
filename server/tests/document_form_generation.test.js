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
  detectDocumentType,
  groundedDocumentMetadata,
  sanitizeDocumentDraft,
  generateDocumentFormDraft
} = require('../services/documentFormMapper')
const {
  compactLineArray,
  extractDeterministicFields,
  selectRelevantLines,
  buildManualSuggestions
} = require('../services/documentFieldHeuristics')
const { boundedStoredLines } = require('../services/formGenerationProcessor')

const line = (id, text, page = 1, confidence = 96, y = 0.1) => ({
  id,
  text,
  page,
  confidence,
  source: 'digital',
  x: 0.1,
  y,
  width: 0.25,
  height: 0.03
})

async function main() {
  assert.equal(confidenceTier(85), 'high')
  assert.equal(confidenceTier(84), 'medium')
  assert.equal(confidenceTier(60), 'medium')
  assert.equal(confidenceTier(59), 'low')
  assert.equal(detectDocumentType([line('type', 'Goods Received Note')]), 'goods_receipt')
  assert.equal(detectDocumentType([line('type', 'Goods Received Notice')]), 'goods_receipt')
  assert.equal(detectDocumentType([line('type', 'Unclassified worksheet')]), 'generic_form')
  const noticeMetadata = groundedDocumentMetadata('goods_receipt', [
    line('notice-title', 'Goods Received Notice', 1, 99, 0.03)
  ])
  assert.equal(noticeMetadata.title, 'Goods Received Notice')
  assert.match(noticeMetadata.description, /received-item rows/)
  assert.equal(identifierLabel('Purchase Order Number'), true)
  assert.equal(identifierLabel('Total Amount'), false)

  const normalized = sanitizeAiFields([
    { label: 'PO Number', type: 'number', required: true },
    { label: 'Remarks', type: 'textarea', required: false },
    { label: 'Approval', type: 'select', options: ['Yes', 'No'] }
  ])
  // Existing prompt-based AI keeps its historical response contract.
  assert.equal(normalized[0].type, 'number')
  assert.equal(normalized[1].type, 'text')
  assert.equal(normalized[1].multiline, true)
  assert.equal(normalized[2].type, 'dropdown')
  assert.deepEqual(normalized[2].options, ['Yes', 'No'])
  assert.equal(sanitizeAiFields(
    [{ label: 'PO Number', type: 'number' }],
    { identifiersAsText: true }
  )[0].type, 'text')
  assert.equal(documentFieldValidationError({
    label: 'Approval',
    type: 'dropdown',
    options: ['Yes']
  }), 'Dropdown and radio fields need at least two distinct options.')
  assert.equal(documentFieldValidationError({
    label: 'Line items',
    type: 'grid',
    columns: []
  }), 'Table fields need at least one named column.')
  assert.equal(documentFieldValidationError({
    label: 'Approval',
    type: 'radio',
    options: ['Yes', 'No']
  }), null)

  const grnLines = [
    line('grn-title', 'Goods Received Note', 1, 99, 0.04),
    line('grn-number', 'GRN No:', 1, 98, 0.12),
    line('grn-po', 'Purchase Order Number:', 1, 97, 0.17),
    line('grn-date', 'Receiving Date *', 1, 96, 0.22),
    line('grn-items', 'Received Items', 1, 98, 0.3),
    { ...line('grn-invoice-column', 'Invoice', 1, 98, 0.34), x: 0.1 },
    { ...line('grn-product-column', 'Product', 1, 98, 0.34), x: 0.3 },
    { ...line('grn-quantity-column', 'Quantity', 1, 98, 0.34), x: 0.6 },
    { ...line('grn-total', 'Total:', 1, 99, 0.75), x: 0.8, width: 0.05 }
  ]
  const deterministicGrn = extractDeterministicFields(grnLines, { documentType: 'goods_receipt' })
  assert.equal(deterministicGrn.some((field) => field.label === 'Goods Received Note'), false)
  assert.equal(deterministicGrn.find((field) => field.label === 'GRN No').type, 'text')
  assert.equal(deterministicGrn.find((field) => field.label === 'Receiving Date').required, true)
  assert.equal(deterministicGrn.find((field) => field.label === 'Total').type, 'number')
  assert.equal(deterministicGrn.find((field) => field.label === 'Total').includedByDefault, true)
  const grnGrid = deterministicGrn.find((field) => field.type === 'grid')
  assert.equal(grnGrid.label, 'Received Items')
  assert.deepEqual(grnGrid.columns.map((column) => column.label), ['Invoice', 'Product', 'Quantity'])
  assert.equal(grnGrid.columns[2].type, 'number')

  const titlelessHeaders = [
    { ...line('titleless-invoice', 'Invoice', 1, 99, 0.13), x: 0.02, width: 0.05, height: 0.018 },
    { ...line('titleless-purchase', 'Purchase', 1, 99, 0.13), x: 0.12, width: 0.05, height: 0.018 },
    { ...line('titleless-order', 'Order', 1, 99, 0.147), x: 0.12, width: 0.035, height: 0.018 },
    { ...line('titleless-product', 'Product', 1, 99, 0.13), x: 0.22, width: 0.055, height: 0.018 },
    { ...line('titleless-description', 'Description', 1, 99, 0.13), x: 0.34, width: 0.09, height: 0.018 },
    { ...line('titleless-lot', 'Lot', 1, 99, 0.13), x: 0.55, width: 0.03, height: 0.018 },
    { ...line('titleless-expiry', 'Expiry', 1, 99, 0.13), x: 0.65, width: 0.05, height: 0.018 },
    { ...line('titleless-bin', 'Bin', 1, 99, 0.13), x: 0.74, width: 0.03, height: 0.018 },
    { ...line('titleless-quantity', 'Quantity', 1, 99, 0.13), x: 0.84, width: 0.07, height: 0.018 },
    { ...line('titleless-received', 'Received', 1, 99, 0.147), x: 0.84, width: 0.07, height: 0.018 },
    { ...line('titleless-uom', 'UOM', 1, 99, 0.13), x: 0.94, width: 0.04, height: 0.018 }
  ]
  const titlelessRows = [0.18, 0.21].flatMap((y, rowIndex) => [
    { ...line('titleless-row-' + rowIndex + '-invoice', '9961135386', 1, 99, y), x: 0.02, width: 0.06, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-po', '25247', 1, 99, y), x: 0.12, width: 0.04, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-product', 'AC002', 1, 99, y), x: 0.22, width: 0.04, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-description', 'Product description', 1, 99, y), x: 0.34, width: 0.1, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-lot', '311226', 1, 99, y), x: 0.55, width: 0.04, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-expiry', '31-DEC-26', 1, 99, y), x: 0.65, width: 0.06, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-bin', 'N-6R-2-5B', 1, 99, y), x: 0.74, width: 0.05, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-quantity', '90', 1, 99, y), x: 0.84, width: 0.04, height: 0.018 },
    { ...line('titleless-row-' + rowIndex + '-uom', 'ctn', 1, 99, y), x: 0.94, width: 0.03, height: 0.018 }
  ])
  const titlelessLines = [
    { ...line('titleless-title', 'Goods Received Note', 1, 99, 0.04), x: 0.4, width: 0.15, height: 0.018 },
    ...titlelessHeaders,
    ...titlelessRows
  ]
  const titlelessFields = extractDeterministicFields(titlelessLines, { documentType: 'goods_receipt' })
  assert.equal(titlelessFields.filter((field) => field.type === 'grid').length, 1)
  const titlelessGrid = titlelessFields.find((field) => field.type === 'grid')
  assert.equal(titlelessGrid.label, 'Received Items')
  assert.deepEqual(
    titlelessGrid.columns.map((column) => column.label),
    ['Invoice', 'Purchase Order', 'Product', 'Description', 'Lot', 'Expiry', 'Bin', 'Quantity Received', 'UOM']
  )
  assert.deepEqual(
    titlelessGrid.columns.map((column) => column.type),
    ['text', 'text', 'text', 'text', 'text', 'date', 'text', 'number', 'text']
  )

  const titlelessDraft = await generateDocumentFormDraft(titlelessLines, {
    filename: 'grn.pdf',
    llmAvailable: false
  })
  const titlelessGridCandidate = titlelessDraft.candidates.find((candidate) =>
    candidate.field.type === 'grid'
  )
  assert.equal(titlelessGridCandidate.field.label, 'Received Items')
  assert.equal(titlelessGridCandidate.confidenceTier, 'high')
  assert.equal(titlelessGridCandidate.includedByDefault, true)
  assert.equal(titlelessGridCandidate.sourceRegions.length, titlelessHeaders.length)

  let malformedGenerateCalled = false
  const protectedGridDraft = await generateDocumentFormDraft(titlelessLines, {
    filename: 'grn-malformed-llm.pdf',
    llmAvailable: true,
    generate: async () => {
      malformedGenerateCalled = true
      return {
        title: 'Goods Received Note',
        fields: [
          {
            role: 'table',
            type: 'grid',
            label: 'Received Items',
            columns: [
              { label: 'Invoice', type: 'text' },
              { label: 'Purchase Product', type: 'text' },
              { label: 'Description', type: 'text' }
            ],
            mappingConfidence: 99,
            sourceLineIds: titlelessHeaders.map((item) => item.id)
          },
          {
            role: 'input',
            type: 'text',
            label: 'Purchase Product',
            mappingConfidence: 99,
            sourceLineIds: ['titleless-purchase', 'titleless-product']
          },
          {
            role: 'input',
            type: 'text',
            label: 'Order',
            mappingConfidence: 99,
            sourceLineIds: ['titleless-order']
          }
        ]
      }
    }
  })
  assert.equal(malformedGenerateCalled, true)
  assert.equal(protectedGridDraft.candidates.filter((candidate) => candidate.field.type === 'grid').length, 1)
  assert.deepEqual(
    protectedGridDraft.candidates.find((candidate) => candidate.field.type === 'grid')
      .field.columns.map((column) => column.label),
    ['Invoice', 'Purchase Order', 'Product', 'Description', 'Lot', 'Expiry', 'Bin', 'Quantity Received', 'UOM']
  )
  assert.equal(
    protectedGridDraft.candidates.some((candidate) =>
      ['purchase product', 'order'].includes(String(candidate.field.label).toLowerCase())
    ),
    false
  )

  const malformedColumnDraft = sanitizeDocumentDraft({
    title: 'Goods Received Note',
    fields: [{
      role: 'table',
      type: 'grid',
      label: 'Received Items',
      columns: [
        { label: 'Invoice', type: 'text' },
        { label: 'Purchase Product', type: 'text' },
        { label: 'Description', type: 'text' }
      ],
      mappingConfidence: 99,
      sourceLineIds: ['malformed-items-label', ...titlelessHeaders.map((item) => item.id)]
    }]
  }, [
    { ...line('malformed-items-label', 'Received Items', 1, 99, 0.11), x: 0.02, width: 0.09, height: 0.018 },
    ...titlelessHeaders
  ], { filename: 'grn-malformed-columns.pdf' })
  assert.equal(malformedColumnDraft.candidates.length, 1)
  assert.deepEqual(
    malformedColumnDraft.candidates[0].field.columns.map((column) => column.label),
    ['Invoice', 'Description']
  )
  assert.match(
    malformedColumnDraft.candidates[0].reviewWarnings.join(' '),
    /Table columns not visible/
  )

  const singleRowReport = [
    { ...line('single-row-title', 'Goods Received Note', 1, 99, 0.04), x: 0.4, width: 0.15, height: 0.018 },
    ...titlelessHeaders.map((item) => ({ ...item, id: 'single-' + item.id })),
    ...titlelessRows.slice(0, 9).map((item) => ({ ...item, id: 'single-' + item.id }))
  ]
  assert.equal(
    extractDeterministicFields(singleRowReport, { documentType: 'goods_receipt' })
      .some((field) => field.type === 'grid'),
    false
  )

  const invoiceLines = [
    line('invoice-title', 'Tax Invoice', 1, 99, 0.04),
    line('invoice-number', 'Invoice Number:', 1, 98, 0.12),
    line('invoice-date', 'Invoice Date:', 1, 98, 0.17),
    line('invoice-customer', 'Customer Name:', 1, 97, 0.22),
    line('invoice-total', 'Total Amount:', 1, 97, 0.27)
  ]
  const deterministicInvoice = extractDeterministicFields(invoiceLines, { documentType: 'invoice' })
  assert.deepEqual(
    deterministicInvoice.map((field) => field.type),
    ['text', 'date', 'text', 'number']
  )

  const purchaseOrderLines = [
    line('po-title', 'Purchase Order', 1, 99, 0.04),
    line('po-number', 'PO Number:', 1, 98, 0.12),
    line('po-date', 'PO Date:', 1, 98, 0.17),
    line('po-vendor', 'Vendor Name:', 1, 97, 0.22),
    line('po-delivery', 'Delivery Date:', 1, 97, 0.27)
  ]
  const deterministicPo = extractDeterministicFields(purchaseOrderLines, { documentType: 'purchase_order' })
  assert.deepEqual(
    deterministicPo.map((field) => field.type),
    ['text', 'date', 'text', 'date']
  )
  assert.deepEqual(
    extractDeterministicFields([line('hindi', 'माल प्राप्ति संख्या')], { documentType: 'generic_form' }),
    []
  )

  const budgetLines = Array.from({ length: 80 }, (_, index) =>
    line('budget-' + index, 'Reference Number ' + index + ':', 1, 96, index / 100)
  )
  const selectedForBudget = selectRelevantLines(budgetLines, { maxCharacters: 700 })
  const encodedBudget = JSON.stringify(selectedForBudget.map(compactLineArray)).length
  assert.ok(selectedForBudget.length > 0)
  assert.ok(encodedBudget <= 700)

  const manual = buildManualSuggestions(
    [line('manual-reference', 'Reference Code:', 1, 96, 0.2)]
  )
  assert.equal(manual.length, 1)
  assert.equal(manual[0].label, 'Reference Code')
  assert.equal(manual[0].includedByDefault, false)
  assert.match(manual[0].reviewWarnings.join(' '), /AI review was unavailable/)

  const localOnlyDraft = await generateDocumentFormDraft(grnLines, {
    filename: 'grn.pdf',
    llmAvailable: false
  })
  assert.ok(localOnlyDraft.candidates.some((candidate) => candidate.field.label === 'GRN No'))
  assert.equal(localOnlyDraft.title, 'Goods Received Note')
  assert.match(localOnlyDraft.description, /received-item rows/)
  assert.equal(localOnlyDraft.candidates.some((candidate) => candidate.field.label === 'Goods Received Note'), false)
  const totalCandidate = localOnlyDraft.candidates.find((candidate) => candidate.field.label === 'Total')
  assert.equal(totalCandidate.confidenceTier, 'high')
  assert.equal(totalCandidate.includedByDefault, true)
  assert.ok(localOnlyDraft.candidates.some((candidate) => candidate.field.type === 'grid'))
  assert.ok(localOnlyDraft.candidates
    .filter((candidate) => ['GRN No', 'Receiving Date', 'Received Items'].includes(candidate.field.label))
    .every((candidate) => candidate.includedByDefault))

  let metadataGenerateCalled = false
  const metadataOverrideDraft = await generateDocumentFormDraft([
    ...grnLines,
    line('grn-reference', 'Reference Code:', 1, 96, 0.8)
  ], {
    filename: 'GRNs.pdf',
    llmAvailable: true,
    generate: async () => {
      metadataGenerateCalled = true
      return {
        title: 'Additional Goods Received Notice Fields',
        description: 'Extracted editable fields not previously detected.',
        fields: []
      }
    }
  })
  assert.equal(metadataGenerateCalled, true)
  assert.equal(metadataOverrideDraft.title, 'Goods Received Note')
  assert.match(metadataOverrideDraft.description, /receipt references/)

  const fallbackDraft = await generateDocumentFormDraft([
    line('fallback-code', 'Employee Code:', 1, 96, 0.2)
  ], {
    filename: 'unknown.pdf',
    llmAvailable: true,
    generate: async () => { throw new Error('provider unavailable') }
  })
  assert.equal(fallbackDraft.candidates.length, 1)
  assert.equal(fallbackDraft.candidates[0].field.label, 'Employee Code')
  assert.equal(fallbackDraft.candidates[0].includedByDefault, false)
  assert.equal(fallbackDraft.candidates[0].confidenceTier, 'low')
  assert.match(fallbackDraft.candidates[0].reviewWarnings.join(' '), /AI review was unavailable/)

  const lines = [
    line('po', 'PO Number', 1, 98, 0.1),
    line('date', 'GRN Date *', 1, 94, 0.2),
    line('amount', 'Total Amount', 2, 91, 0.1),
    line('approval', 'Approval', 2, 88, 0.2),
    line('notes', 'Notes', 2, 80, 0.3)
  ]
  const draft = sanitizeDocumentDraft({
    title: 'Goods Receipt Note',
    description: 'Generated from the reference layout',
    fields: [
      {
        label: 'PO Number',
        type: 'number',
        required: true,
        mappingConfidence: 96,
        sourceLineIds: ['po']
      },
      {
        label: 'GRN Date',
        type: 'date',
        required: true,
        mappingConfidence: 91,
        sourceLineIds: ['date']
      },
      {
        label: 'Total Amount',
        type: 'number',
        required: false,
        mappingConfidence: 86,
        sourceLineIds: ['amount']
      },
      {
        label: 'Approval',
        type: 'dropdown',
        options: [],
        required: false,
        mappingConfidence: 76,
        sourceLineIds: ['approval']
      },
      {
        label: 'Notes',
        type: 'textarea',
        required: false,
        mappingConfidence: 55,
        sourceLineIds: ['notes']
      },
      {
        label: 'Invented field',
        type: 'text',
        mappingConfidence: 99,
        sourceLineIds: ['missing']
      }
    ]
  }, lines, { filename: 'grn.pdf' })

  assert.equal(draft.title, 'Goods Receipt Note')
  assert.equal(draft.candidates.length, 5)
  assert.equal(draft.candidates[0].field.label, 'PO Number')
  assert.equal(draft.candidates[0].field.type, 'text')
  assert.equal(draft.candidates[0].field.required, false)
  assert.match(draft.candidates[0].reviewWarnings.join(' '), /Identifier field/)
  assert.equal(draft.candidates[1].field.required, true)
  assert.equal(draft.candidates[2].field.page, 2)
  assert.equal(draft.candidates[3].field.type, 'text')
  assert.match(draft.candidates[3].reviewWarnings.join(' '), /Choice options were incomplete/)
  assert.equal(draft.candidates[3].confidenceTier, 'low')
  assert.equal(draft.candidates[3].includedByDefault, true)
  assert.equal(draft.candidates[4].confidenceTier, 'medium')
  assert.equal(draft.candidates[4].includedByDefault, true)
  assert.equal(draft.candidates.some((candidate) => candidate.field.label === 'Invented field'), false)
  assert.deepEqual(draft.confidenceSummary, { high: 3, medium: 1, low: 1 })
  assert.equal(draft.detectedFieldCount, 6)
  assert.equal(draft.truncated, false)
  assert.equal(Object.hasOwn(draft.candidates[0].sourceRegions[0], 'text'), false)

  const tableLines = [
    line('document-title', 'Goods Received Note', 1, 99, 0.04),
    line('items-label', 'Received Items', 1, 98, 0.3),
    line('headers', 'Invoice Product Quantity Container Seal', 1, 98, 0.34),
    line('company-value', 'Massey Distribution Guyana Inc', 1, 99, 0.08)
  ]
  const structured = sanitizeDocumentDraft({
    title: 'Goods Received Note',
    fields: [
      {
        label: 'Received Items',
        type: 'grid',
        columns: [
          { label: 'Invoice', type: 'text' },
          { label: 'Product', type: 'text' },
          { label: 'Quantity', type: 'number' },
          { label: 'Hallucinated column', type: 'text' }
        ],
        mappingConfidence: 92,
        sourceLineIds: ['items-label', 'headers']
      },
      {
        label: 'Container',
        type: 'text',
        mappingConfidence: 80,
        sourceLineIds: ['headers']
      },
      {
        label: 'Seal',
        type: 'text',
        mappingConfidence: 80,
        sourceLineIds: ['headers']
      },
      {
        label: 'Company Name',
        type: 'text',
        mappingConfidence: 99,
        sourceLineIds: ['company-value']
      },
      {
        label: 'Goods Received Note',
        type: 'heading',
        mappingConfidence: 99,
        sourceLineIds: ['document-title']
      }
    ]
  }, tableLines, { filename: 'grn.pdf' })

  assert.equal(structured.candidates.length, 1)
  assert.equal(structured.candidates[0].field.type, 'grid')
  assert.deepEqual(
    structured.candidates[0].field.columns.map((column) => column.label),
    ['Invoice', 'Product', 'Quantity', 'Container', 'Seal']
  )
  assert.equal(structured.candidates[0].field.columns[2].type, 'number')
  assert.match(
    structured.candidates[0].reviewWarnings.join(' '),
    /grouped into this table/
  )

  const manyLines = []
  const manyFields = []
  for (let index = 0; index < MAX_FIELDS + 1; index += 1) {
    manyLines.push(line('field-' + index, 'Field ' + index, 1, 99, index / 100))
    manyFields.push({
      label: 'Field ' + index,
      type: 'text',
      required: false,
      mappingConfidence: 99,
      sourceLineIds: ['field-' + index]
    })
  }
  const truncated = sanitizeDocumentDraft(
    { fields: manyFields },
    manyLines,
    { filename: 'reference-form.pdf' }
  )
  assert.equal(truncated.candidates.length, MAX_FIELDS)
  assert.equal(truncated.detectedFieldCount, MAX_FIELDS + 1)
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.title, 'reference-form')

  assert.equal(FormGenerationJob.definition.fields['lines'].hidden, true)
  assert.equal(FormGenerationJob.definition.fields['errorDetail'].hidden, true)
  assert.equal(FormGenerationJob.definition.fields['sourceFile.mimetype'].required, true)
  assert.equal(boundedStoredLines(
    Array.from({ length: 4002 }, (_, index) => ({ text: String(index) }))
  ).length, 4000)
  assert.equal(boundedStoredLines([
    { text: 'x'.repeat(60001) },
    { text: 'y'.repeat(60001) }
  ]).length, 1)

  console.log('Document form generation unit tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
