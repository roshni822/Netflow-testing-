const assert = require('node:assert/strict')
const PDFDocument = require('pdfkit')
const {
  inspectPdf,
  renderPdfPage,
  inspectDocument,
  renderDocumentPage
} = require('../services/mupdfClient')
const {
  validateSourceFile,
  safeSourceFilename
} = require('../utils/extractionSource')
const {
  normalizeValue,
  normalizeDocumentDate,
  validateSuggestion,
  tierFor,
  sanitizeMappings,
  buildMappingHints,
  withGroundedFallbacks,
  mapFields,
} = require('../services/extractionMapper')
const {
  hashAccessToken,
  accessTokenMatches
} = require('../services/extractionProcessor')
const {
  policyFor,
  validateSettings
} = require('../utils/pdfAutoFillPolicy')
const {
  configured: ocrConfigured,
  recognizePages
} = require('../services/paddleOcrClient')
const PdfAutoFillLearningProfile = require('../models/PdfAutoFillLearningProfile')
const PdfAutoFillSemanticProfile = require('../models/PdfAutoFillSemanticProfile')
const {
  layoutChunks: layoutMappingChunks,
  generateLlmMappings
} = require('../services/pdfAutoFillLlm')
const {
  profileKey,
  semanticProfileKey,
  normalizeSemanticText,
  classifyValuePattern,
  buildEvidenceKey,
  buildTemplateFingerprint,
  calibrateSuggestion,
  valuesMatch,
  feedbackTransition,
  safeFeedback,
  eligibleForPositiveLearning,
  recordSubmissionFeedback
} = require('../services/pdfAutoFillLearning')

function makePdf(text) {
  return new Promise((resolve) => {
    const document = new PDFDocument({ size: 'A4' })
    const chunks = []
    document.on('data', (chunk) => chunks.push(chunk))
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.text(text)
    document.end()
  })
}

const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFklEQVR4nGP8//8/A27AhEeOYeRKAwCl4wMRx3ocVQAAAABJRU5ErkJggg==',
  'base64'
)
const JPEG_FIXTURE = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
  'base64'
)

async function main() {
  const oldFlag = process.env.PDF_AUTOFILL_ENABLED
  process.env.PDF_AUTOFILL_ENABLED = 'true'
  const tenant = {
    plan: 'professional',
    isDefault: false,
    pdfAutoFill: {
      enabled: true,
      languageMode: 'english_hindi',
      audiences: { authenticated: true, public: false }
    }
  }
  assert.equal(policyFor(tenant, 'authenticated').enabled, true)
  assert.equal(policyFor(tenant, 'authenticated').languageMode, 'english')
  assert.equal(policyFor(tenant, 'public').enabled, false)
  assert.equal(policyFor({ ...tenant, plan: 'custom' }, 'authenticated').entitled, false)
  assert.equal(policyFor({
    ...tenant,
    plan: 'custom',
    pdfAutoFill: { ...tenant.pdfAutoFill, entitlementOverride: true }
  }, 'authenticated').entitled, true)
  assert.match(
    validateSettings({
      enabled: true,
      languageMode: 'english',
      audiences: { authenticated: false, public: false }
    }).error,
    /Choose authenticated users/
  )
  assert.match(validateSettings({
    enabled: true,
    languageMode: 'hindi',
    audiences: { authenticated: true, public: false }
  }).error, /languageMode must be one of: english/)
  if (oldFlag === undefined) delete process.env.PDF_AUTOFILL_ENABLED
  else process.env.PDF_AUTOFILL_ENABLED = oldFlag

  const oldOcrUrl = process.env.PADDLEOCR_SERVICE_URL
  const oldFetch = global.fetch
  try {
    process.env.PADDLEOCR_SERVICE_URL = 'http://127.0.0.1:8080'
    let capturedRequest = null
    global.fetch = async (url, options) => {
      capturedRequest = { url, options }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          errorCode: 0,
          result: {
            ocrResults: [{
              prunedResult: {
                rec_texts: ['Invoice', 'PO6811', 'Missing box'],
                rec_scores: [0.98, 0.87, 0.75],
                rec_boxes: [[10, 20, 100, 40], null, null],
                rec_polys: [
                  null,
                  [[110, 20], [190, 20], [190, 40], [110, 40]],
                  null
                ]
              }
            }]
          }
        })
      }
    }

    assert.equal(ocrConfigured(), true)
    const ocrPages = await recognizePages([{
      page: 2,
      width: 200,
      height: 100,
      png: PNG_FIXTURE
    }], 'hindi')
    assert.equal(capturedRequest.url, 'http://127.0.0.1:8080/ocr')
    assert.equal(capturedRequest.options.method, 'POST')
    assert.equal(capturedRequest.options.headers.Authorization, undefined)
    const requestBody = JSON.parse(capturedRequest.options.body)
    assert.equal(requestBody.fileType, 1)
    assert.equal(requestBody.visualize, false)
    assert.equal(requestBody.useDocOrientationClassify, false)
    assert.equal(requestBody.useDocUnwarping, false)
    assert.equal(requestBody.useTextlineOrientation, false)
    assert.deepEqual(Buffer.from(requestBody.file, 'base64'), PNG_FIXTURE)
    assert.deepEqual(ocrPages, [{
      page: 2,
      width: 200,
      height: 100,
      lines: [
        { text: 'Invoice', confidence: 0.98, bbox: [10, 20, 100, 40] },
        { text: 'PO6811', confidence: 0.87, bbox: [110, 20, 190, 40] }
      ]
    }])
  } finally {
    if (oldOcrUrl === undefined) delete process.env.PADDLEOCR_SERVICE_URL
    else process.env.PADDLEOCR_SERVICE_URL = oldOcrUrl
    if (oldFetch === undefined) delete global.fetch
    else global.fetch = oldFetch
  }

  assert.equal(tierFor(90), 'high')
  assert.equal(tierFor(89), 'medium')
  assert.equal(tierFor(69), 'low')

  assert.equal(classifyValuePattern('2026-08-28'), 'date')
  assert.equal(classifyValuePattern('9961135386'), 'numeric_identifier')
  assert.equal(classifyValuePattern('PO6811'), 'alphanumeric_identifier')
  assert.equal(classifyValuePattern('9961135386, 9961135390'), 'identifier_list')
  assert.equal(valuesMatch('  PO6811  ', 'PO6811'), true)
  assert.equal(PdfAutoFillLearningProfile.definition.fields['value'], undefined)
  assert.equal(PdfAutoFillLearningProfile.definition.fields['rawText'], undefined)
  assert.equal(PdfAutoFillSemanticProfile.definition.fields['value'], undefined)
  assert.equal(PdfAutoFillSemanticProfile.definition.fields['rawText'], undefined)
  assert.equal(normalizeSemanticText('  SUPPLIER / Vendor:  '), 'supplier vendor')
  assert.equal(
    semanticProfileKey('Purchase Order', 'PO No.', 'purchase-order', 'alphanumeric_identifier'),
    'purchaseorder:po no:purchase-order:alphanumeric_identifier'
  )

  let learnedState = feedbackTransition({}, 'confirmed')
  assert.equal(learnedState.positiveStreak, 1)
  assert.equal(learnedState.learnedTier, 'none')
  learnedState = feedbackTransition(learnedState, 'confirmed')
  assert.equal(learnedState.learnedTier, 'medium')
  learnedState = feedbackTransition(feedbackTransition(feedbackTransition(learnedState, 'confirmed'), 'confirmed'), 'confirmed')
  assert.equal(learnedState.positiveStreak, 5)
  assert.equal(learnedState.learnedTier, 'high')
  learnedState = feedbackTransition(learnedState, 'corrected')
  assert.equal(learnedState.positiveStreak, 0)
  assert.equal(learnedState.learnedTier, 'none')
  assert.equal(learnedState.correctionCount, 1)
  learnedState = feedbackTransition(learnedState, 'dismissed')
  assert.equal(learnedState.dismissalCount, 1)

  const cleanedFeedback = safeFeedback({
    appliedFieldIds: ['po', 'unknown', 'po', 'invoice'],
    dismissedFieldIds: ['invoice']
  }, new Set(['po', 'invoice']))
  assert.deepEqual(cleanedFeedback, {
    appliedFieldIds: ['po'],
    dismissedFieldIds: ['invoice']
  })
  assert.equal(eligibleForPositiveLearning({ valid: true, criticApproved: true }), true)
  assert.equal(eligibleForPositiveLearning({ valid: false, criticApproved: true }), false)
  assert.equal(eligibleForPositiveLearning({ valid: true, criticApproved: false }), false)
  assert.deepEqual(await recordSubmissionFeedback({
    job: { audience: 'public' },
    audience: 'public'
  }), { processed: false })

  const mappingHints = buildMappingHints([
    { id: 'purchaseOrder', type: 'text', label: 'Purchase Order Number' },
    { id: 'supplierInvoice', type: 'text', label: 'Supplier Invoice Number' }
  ], [
    { id: 'order-label', page: 1, text: 'Order', confidence: 100, x: 0.4, y: 0.1, width: 0.05, height: 0.02 },
    { id: 'order-value', page: 1, text: 'PO6811', confidence: 100, x: 0.4, y: 0.125, width: 0.06, height: 0.02 },
    { id: 'invoice-header', page: 1, text: 'Invoice', confidence: 100, x: 0.08, y: 0.3, width: 0.05, height: 0.02 },
    { id: 'invoice-1', page: 1, text: '9961135386', confidence: 100, x: 0.08, y: 0.33, width: 0.07, height: 0.012 },
    { id: 'invoice-1-repeat', page: 1, text: '9961135386', confidence: 100, x: 0.08, y: 0.35, width: 0.07, height: 0.012 },
    { id: 'invoice-2', page: 1, text: '9961135390', confidence: 100, x: 0.08, y: 0.37, width: 0.07, height: 0.012 },
    { id: 'footer-name', page: 1, text: 'JSINGH', confidence: 100, x: 0.08, y: 0.8, width: 0.06, height: 0.02 }
  ])
  const purchaseOrderHint = mappingHints.find((hint) => hint.fieldId === 'purchaseOrder')
  assert.equal(purchaseOrderHint.matchedAlias, 'order')
  assert.equal(purchaseOrderHint.proposedValue, 'PO6811')
  assert.deepEqual(purchaseOrderHint.sourceLineIds, ['order-label', 'order-value'])
  const invoiceHint = mappingHints.find((hint) => hint.fieldId === 'supplierInvoice')
  assert.equal(invoiceHint.strategy, 'table_column')
  assert.equal(invoiceHint.aggregationPolicy, 'all_unique_comma_separated')
  assert.equal(invoiceHint.proposedValue, '9961135386, 9961135390')
  assert.deepEqual(invoiceHint.sourceLineIds, ['invoice-header', 'invoice-1', 'invoice-2'])
  const fallbackMappings = withGroundedFallbacks({
    mappings: [{
      fieldId: 'supplierInvoice', value: '9961135386', mappingConfidence: 78,
      sourceLineIds: ['invoice-1']
    }]
  }, [invoiceHint])
  assert.equal(fallbackMappings.mappings.length, 1)
  assert.equal(fallbackMappings.mappings[0].value, '9961135386, 9961135390')
  assert.equal(fallbackMappings.mappings[0].mappingConfidence, 65)
  assert.deepEqual(fallbackMappings.mappings[0].sourceLineIds, ['invoice-header', 'invoice-1', 'invoice-2'])

  const vendorHint = buildMappingHints([
    { id: 'vendor', type: 'text', label: 'Vendor' }
  ], [
    { id: 'vendor-label', page: 1, text: 'Vendor:', confidence: 100, x: 0.083, y: 0.098, width: 0.036, height: 0.018 },
    { id: 'vendor-code', page: 1, text: 'N01898', confidence: 100, x: 0.174, y: 0.098, width: 0.036, height: 0.018 },
    { id: 'next-row-header', page: 1, text: 'Purchase', confidence: 100, x: 0.114, y: 0.132, width: 0.048, height: 0.018 }
  ])[0]
  assert.equal(vendorHint.proposedValue, 'N01898')
  assert.deepEqual(vendorHint.sourceLineIds, ['vendor-label', 'vendor-code'])

  const providerFailureResult = await mapFields({
    _id: 'fallback-form',
    orgId: 'fallback-org',
    fields: [{ id: 'container', type: 'text', label: 'Container' }]
  }, [
    { id: 'container-label', page: 1, text: 'Container:', confidence: 99, x: 0.08, y: 0.06, width: 0.06, height: 0.02 },
    { id: 'container-value', page: 1, text: 'ECMU5444880', confidence: 98, x: 0.17, y: 0.06, width: 0.08, height: 0.02 }
  ], {
    llmAvailable: true,
    generate: async () => { throw new Error('temporary provider failure') },
    loadProfileMap: async () => new Map(),
    loadSemanticProfileMap: async () => new Map()
  })
  assert.equal(providerFailureResult.suggestions.length, 1)
  assert.equal(providerFailureResult.suggestions[0].fieldId, 'container')
  assert.equal(providerFailureResult.suggestions[0].value, 'ECMU5444880')
  assert.equal(providerFailureResult.suggestions[0].confidence, 69)
  assert.equal(providerFailureResult.suggestions[0].tier, 'low')
  assert.equal(providerFailureResult.suggestions[0].criticApproved, false)
  assert.deepEqual(
    providerFailureResult.suggestions[0].sourceRegions.map((region) => region.lineId),
    ['container-label', 'container-value']
  )

  const receivedItemsField = {
    id: 'received-items',
    type: 'grid',
    label: 'Received Items',
    columns: [
      { id: 'invoice', label: 'Invoice', type: 'text' },
      { id: 'po', label: 'Purchase Order', type: 'text' },
      { id: 'product', label: 'Product', type: 'text' },
      { id: 'description', label: 'Description', type: 'text' },
      { id: 'lot', label: 'Lot', type: 'text' },
      { id: 'expiry', label: 'Expiry', type: 'date' },
      { id: 'bin', label: 'Bin', type: 'text' },
      { id: 'quantity', label: 'Quantity Received', type: 'number' },
      { id: 'uom', label: 'UOM', type: 'text' }
    ]
  }
  const tableHeaders = [
    { id: 'header-invoice', page: 1, text: 'Invoice', confidence: 99, x: 0.02, y: 0.3, width: 0.05, height: 0.018 },
    { id: 'header-purchase', page: 1, text: 'Purchase', confidence: 99, x: 0.12, y: 0.3, width: 0.05, height: 0.018 },
    { id: 'header-order', page: 1, text: 'Order', confidence: 99, x: 0.12, y: 0.317, width: 0.035, height: 0.018 },
    { id: 'header-product', page: 1, text: 'Product', confidence: 99, x: 0.22, y: 0.3, width: 0.055, height: 0.018 },
    { id: 'header-description', page: 1, text: 'Description', confidence: 99, x: 0.34, y: 0.3, width: 0.09, height: 0.018 },
    { id: 'header-lot', page: 1, text: 'Lot', confidence: 99, x: 0.55, y: 0.3, width: 0.03, height: 0.018 },
    { id: 'header-expiry', page: 1, text: 'Expiry', confidence: 99, x: 0.65, y: 0.3, width: 0.05, height: 0.018 },
    { id: 'header-bin', page: 1, text: 'Bin', confidence: 99, x: 0.74, y: 0.3, width: 0.03, height: 0.018 },
    { id: 'header-quantity', page: 1, text: 'Quantity', confidence: 99, x: 0.84, y: 0.3, width: 0.07, height: 0.018 },
    { id: 'header-received', page: 1, text: 'Received', confidence: 99, x: 0.84, y: 0.317, width: 0.07, height: 0.018 },
    { id: 'header-uom', page: 1, text: 'UOM', confidence: 99, x: 0.94, y: 0.3, width: 0.04, height: 0.018 }
  ]
  const tableRows = [
    ['9961153386', '25247', 'AC002', 'MAGGI Cube Chicken', '311226', '31-DEC-26', 'N-6R-2-5B', '114', 'ctn'],
    ['9961153387', '25248', 'AC003', 'MAGGI Cube Beef', '311227', '30-NOV-26', 'N-6R-4-5A', '90', 'ctn'],
    ['9961153386', '25247', 'AC002', 'MAGGI Cube Chicken', '311226', '31-DEC-26', 'N-6R-2-5B', '114', 'ctn']
  ].flatMap((values, rowIndex) => {
    const x = [0.02, 0.12, 0.22, 0.34, 0.55, 0.65, 0.74, 0.84, 0.94]
    const width = [0.06, 0.04, 0.04, 0.1, 0.04, 0.06, 0.05, 0.04, 0.03]
    return values.map((text, columnIndex) => ({
      id: 'row-' + rowIndex + '-' + columnIndex,
      page: 1,
      text,
      confidence: 99,
      x: x[columnIndex],
      y: 0.36 + rowIndex * 0.022,
      width: width[columnIndex],
      height: 0.014
    }))
  })
  const tableLines = [...tableHeaders, ...tableRows]
  const gridMappingResult = await mapFields({
    _id: 'grid-form',
    orgId: 'fallback-org',
    fields: [receivedItemsField]
  }, tableLines, {
    llmAvailable: false,
    loadProfileMap: async () => new Map(),
    loadSemanticProfileMap: async () => new Map()
  })
  assert.equal(gridMappingResult.suggestions.length, 1)
  const gridSuggestion = gridMappingResult.suggestions[0]
  assert.equal(gridSuggestion.fieldId, 'received-items')
  assert.equal(gridSuggestion.tier, 'low')
  assert.equal(gridSuggestion.criticApproved, false)
  assert.equal(gridSuggestion.valid, true)
  assert.equal(gridSuggestion.value.length, 2)
  assert.deepEqual(gridSuggestion.value[0], {
    invoice: '9961153386',
    po: '25247',
    product: 'AC002',
    description: 'MAGGI Cube Chicken',
    lot: '311226',
    expiry: '2026-12-31',
    bin: 'N-6R-2-5B',
    quantity: 114,
    uom: 'ctn'
  })
  assert.equal(
    buildMappingHints([{ id: 'product-text', type: 'text', label: 'Product' }], tableLines).length,
    0
  )

  await assert.rejects(
    () => mapFields({
      _id: 'no-evidence-form',
      orgId: 'fallback-org',
      fields: [{ id: 'employee-id', type: 'text', label: 'Employee ID' }]
    }, [
      { id: 'unrelated', page: 1, text: 'Unrelated document text', confidence: 99, x: 0.1, y: 0.1, width: 0.2, height: 0.02 }
    ], {
      llmAvailable: false,
      loadProfileMap: async () => new Map(),
      loadSemanticProfileMap: async () => new Map()
    }),
    (error) => error?.code === 'LLM_UNAVAILABLE'
  )

  const semanticLines = [
    { id: 'vendor-label', page: 1, text: 'Vendor:', confidence: 99, source: 'pdf', x: 0.1, y: 0.1, width: 0.06, height: 0.02 },
    { id: 'vendor-value', page: 1, text: 'N01898', confidence: 98, source: 'pdf', x: 0.2, y: 0.1, width: 0.06, height: 0.02 }
  ]
  assert.equal(layoutMappingChunks(semanticLines, 8000).flatMap((chunk) => chunk.lines).length, 2)
  let llmPass = 0
  const llmMappings = await generateLlmMappings(
    [{ id: 'vendor', label: 'Vendor', type: 'text' }],
    semanticLines,
    [],
    [],
    {
      llmAvailable: true,
      maxInputCharacters: 8000,
      generate: async () => {
        llmPass += 1
        if (llmPass === 1) {
          return {
            documentType: 'Goods Received Note',
            mappings: [{
              fieldId: 'vendor', sourceLabel: 'Vendor', value: 'N01898',
              sourceLineIds: ['vendor-label', 'vendor-value'], mappingConfidence: 94,
              decisionReason: 'Visible vendor identifier'
            }]
          }
        }
        return {
          documentType: 'Goods Received Note',
          mappings: [{
            fieldId: 'vendor', sourceLabel: 'Vendor', value: 'N01898',
            sourceLineIds: ['vendor-label', 'vendor-value'], generatorConfidence: 94,
            criticConfidence: 82, criticApproved: true,
            decisionReason: 'Label and adjacent identifier agree'
          }]
        }
      }
    }
  )
  assert.equal(llmPass, 2)
  assert.equal(llmMappings.criticStatus, 'validated')
  assert.equal(llmMappings.mappings[0].criticApproved, true)
  const llmFirstResult = await mapFields({
    _id: 'semantic-form',
    orgId: 'semantic-org',
    fields: [{ id: 'vendor', label: 'Vendor', type: 'text' }]
  }, semanticLines, {
    llmAvailable: true,
    loadProfileMap: async () => new Map(),
    loadSemanticProfileMap: async () => new Map(),
    orchestrate: async () => llmMappings
  })
  assert.equal(llmFirstResult.documentType, 'goods received note')
  assert.equal(llmFirstResult.criticStatus, 'validated')
  assert.equal(llmFirstResult.suggestions[0].confidence, 82)
  assert.equal(llmFirstResult.suggestions[0].tier, 'medium')
  assert.equal(llmFirstResult.suggestions[0].valid, true)
  assert.equal(llmFirstResult.suggestions[0].criticApproved, true)

  const hallucinatedValue = sanitizeMappings({
    fields: [{ id: 'vendor', label: 'Vendor', type: 'text' }]
  }, semanticLines, {
    documentType: 'Goods Received Note',
    criticStatus: 'validated',
    mappings: [{
      fieldId: 'vendor', sourceLabel: 'Vendor', value: 'INVENTED',
      sourceLineIds: ['vendor-label', 'vendor-value'], generatorConfidence: 99,
      criticConfidence: 99, criticApproved: true, criticStatus: 'validated'
    }]
  })[0]
  assert.equal(hallucinatedValue.valid, false)
  assert.equal(hallucinatedValue.tier, 'low')

  const valueUsedAsLabel = sanitizeMappings({
    fields: [{ id: 'po', label: 'Purchase Order Number', type: 'text' }]
  }, [{ id: 'po-value', page: 1, text: 'PO6811', confidence: 99, x: 0.1, y: 0.1, width: 0.1, height: 0.02 }], {
    documentType: 'Purchase Order',
    criticStatus: 'validated',
    mappings: [{
      fieldId: 'po', sourceLabel: 'PO6811', value: 'PO6811', sourceLineIds: ['po-value'],
      generatorConfidence: 99, criticConfidence: 99, criticApproved: true, criticStatus: 'validated'
    }]
  })[0]
  assert.equal(valueUsedAsLabel.valid, false)
  assert.equal(valueUsedAsLabel.validationMessage, 'The source label is not present in the cited evidence')

  const structuralLinesA = [{
    id: 'value-1', page: 1, text: 'PO6811', confidence: 96,
    x: 0.4, y: 0.2, width: 0.08, height: 0.02
  }]
  const structuralLinesB = [{
    ...structuralLinesA[0], text: 'PO9999'
  }]
  const structuralHint = [{
    fieldId: 'po', strategy: 'near_exact_label', matchedAlias: 'order',
    proposedValue: 'PO6811', sourceLineIds: ['value-1']
  }]
  const templateForm = { _id: 'form-1', fields: [{ id: 'po' }] }
  assert.equal(
    buildTemplateFingerprint(templateForm, structuralLinesA, structuralHint),
    buildTemplateFingerprint(templateForm, structuralLinesB, [{ ...structuralHint[0], proposedValue: 'PO9999' }])
  )
  assert.equal(
    buildEvidenceKey('po', structuralLinesA),
    buildEvidenceKey('po', structuralLinesB)
  )
  assert.equal(
    buildEvidenceKey('po', structuralLinesA),
    buildEvidenceKey('po', [...structuralLinesA, {
      id: 'extra-row', page: 1, text: 'PO7000', confidence: 96,
      x: 0.4, y: 0.25, width: 0.08, height: 0.02
    }])
  )

  const promotedMedium = calibrateSuggestion({ confidence: 60, valid: true }, {
    learnedTier: 'medium', positiveStreak: 2
  }, 95, true)
  assert.equal(promotedMedium.confidence, 70)
  assert.equal(promotedMedium.tier, 'medium')
  const promotedHigh = calibrateSuggestion({ confidence: 60, valid: true }, {
    learnedTier: 'high', positiveStreak: 5
  }, 95, true)
  assert.equal(promotedHigh.confidence, 90)
  assert.equal(promotedHigh.tier, 'high')
  const cappedBySource = calibrateSuggestion({ confidence: 60, valid: true }, {
    learnedTier: 'high', positiveStreak: 5
  }, 84, true)
  assert.equal(cappedBySource.confidence, 84)
  assert.equal(cappedBySource.tier, 'medium')
  const invalidPromotion = calibrateSuggestion({ confidence: 60, valid: false }, {
    learnedTier: 'high', positiveStreak: 5
  }, 99, true)
  assert.equal(invalidPromotion.confidence, 60)
  assert.equal(invalidPromotion.tier, 'low')

  assert.equal(normalizeValue({ type: 'number' }, '12,500'), 12500)
  assert.equal(
    normalizeValue({ type: 'dropdown', options: ['Approved', 'Rejected'] }, 'approved'),
    'Approved'
  )
  assert.equal(normalizeDocumentDate('21-FEB-26'), '2026-02-21')
  assert.equal(normalizeDocumentDate('31/12/2026'), '2026-12-31')
  assert.equal(normalizeDocumentDate('02/03/2026'), '02/03/2026')
  const lines = [{
    id: 'p1-digital-1',
    page: 1,
    text: 'Status: Approved',
    confidence: 94,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.04
  }]
  const sanitized = sanitizeMappings({
    fields: [
      { id: 'status', type: 'dropdown', label: 'Status', options: ['Approved', 'Rejected'] },
      { id: 'date', type: 'date', label: 'Date' }
    ]
  }, lines, {
    mappings: [
      { fieldId: 'unknown', value: 'invented', mappingConfidence: 100, sourceLineIds: ['missing'] },
      { fieldId: 'status', value: 'approved', mappingConfidence: 98, sourceLineIds: ['p1-digital-1'] },
      { fieldId: 'date', value: '31/12/2026', mappingConfidence: 99, sourceLineIds: ['p1-digital-1'] }
    ]
  })
  assert.equal(sanitized.length, 2)
  assert.equal(sanitized[0].value, 'Approved')
  assert.equal(sanitized[0].confidence, 94)
  assert.equal(sanitized[0].tier, 'high')
  assert.equal(sanitized[1].value, '2026-12-31')
  assert.equal(sanitized[1].valid, false)
  assert.equal(sanitized[1].confidence, 69)
  assert.equal(sanitized[1].tier, 'low')
  assert.equal(validateSuggestion({ type: 'date', label: 'Date' }, '31/12/2026'), 'Date must use a valid YYYY-MM-DD value')
  assert.equal(validateSuggestion({ type: 'date', label: 'Date' }, '2026-02-30'), 'Date must use a valid YYYY-MM-DD value')
  assert.equal(validateSuggestion({ type: 'date', label: 'Date' }, '2026-12-31'), null)

  const partiallyGrounded = sanitizeMappings({
    fields: [{ id: 'name', type: 'text', label: 'Name' }]
  }, lines, {
    mappings: [{
      fieldId: 'name',
      value: 'Asha Sharma',
      mappingConfidence: 99,
      sourceLineIds: ['p1-digital-1', 'hallucinated-line']
    }]
  })
  assert.equal(partiallyGrounded[0].confidence, 69)
  assert.equal(partiallyGrounded[0].tier, 'low')

  const lowLines = [{
    id: 'po-source', page: 1, text: 'PO6811', confidence: 96,
    x: 0.4, y: 0.2, width: 0.08, height: 0.02
  }]
  const lowEvidence = buildEvidenceKey('po', lowLines)
  const learnedMappings = sanitizeMappings({
    fields: [{ id: 'po', type: 'text', label: 'Purchase Order Number' }]
  }, lowLines, {
    mappings: [{
      fieldId: 'po', value: 'PO6811', mappingConfidence: 60, sourceLineIds: ['po-source']
    }]
  }, {
    profiles: new Map([[
      profileKey('po', lowEvidence, 'alphanumeric_identifier'),
      { learnedTier: 'high', positiveStreak: 5 }
    ]])
  })
  assert.equal(learnedMappings[0].baseConfidence, 60)
  assert.equal(learnedMappings[0].confidence, 90)
  assert.equal(learnedMappings[0].tier, 'high')

  const token = 'opaque-public-job-token'
  const hash = hashAccessToken(token)
  assert.equal(accessTokenMatches(hash, token), true)
  assert.equal(accessTokenMatches(hash, 'wrong-token'), false)

  const pdf = await makePdf('Employee Name: Asha Sharma\nInvoice Amount: 12,500')
  const inspected = await inspectPdf(pdf)
  assert.equal(inspected.pageCount, 1)
  assert.match(inspected.pages[0].lines.map((line) => line.text).join(' '), /Asha Sharma/)
  const rendered = await renderPdfPage(pdf, 1, 1)
  assert.ok(rendered.png.length > 100)
  assert.deepEqual(Array.from(rendered.png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])

  const pngValidation = validateSourceFile({
    originalname: 'scan.png',
    mimetype: 'image/png',
    size: PNG_FIXTURE.length,
    buffer: PNG_FIXTURE
  })
  assert.equal(pngValidation.error, undefined)
  assert.equal(pngValidation.source.mimetype, 'image/png')
  assert.equal(safeSourceFilename('scan.png', 'image/png'), 'scan.png')

  const jpegValidation = validateSourceFile({
    originalname: 'camera.jpeg',
    mimetype: 'image/jpeg',
    size: JPEG_FIXTURE.length,
    buffer: JPEG_FIXTURE
  })
  assert.equal(jpegValidation.error, undefined)
  assert.equal(jpegValidation.source.mimetype, 'image/jpeg')
  assert.equal(safeSourceFilename('camera.jpeg', 'image/jpeg'), 'camera.jpeg')
  assert.equal(validateSourceFile({
    originalname: 'camera.jpg',
    mimetype: 'image/jpg',
    size: JPEG_FIXTURE.length,
    buffer: JPEG_FIXTURE
  }).source.mimetype, 'image/jpeg')

  const spoofed = validateSourceFile({
    originalname: 'fake.pdf',
    mimetype: 'application/pdf',
    size: PNG_FIXTURE.length,
    buffer: PNG_FIXTURE
  })
  assert.equal(spoofed.error.code, 'FILE_TYPE_MISMATCH')

  const oversizedDimensions = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedDimensions)
  oversizedDimensions.write('IHDR', 12, 'ascii')
  oversizedDimensions.writeUInt32BE(8000, 16)
  oversizedDimensions.writeUInt32BE(5001, 20)
  assert.equal(validateSourceFile({
    originalname: 'huge.png',
    mimetype: 'image/png',
    size: oversizedDimensions.length,
    buffer: oversizedDimensions
  }).error.code, 'IMAGE_DIMENSIONS_EXCEEDED')

  const inspectedPng = await inspectDocument(PNG_FIXTURE, 'image/png')
  assert.equal(inspectedPng.pageCount, 1)
  assert.equal(inspectedPng.pages[0].needsOcr, true)
  assert.equal(inspectedPng.renderedPages.length, 1)
  const renderedPng = await renderDocumentPage(PNG_FIXTURE, 'image/png', 1, 1)
  assert.equal(inspectedPng.renderedPages[0].width, renderedPng.width)
  assert.equal(inspectedPng.renderedPages[0].height, renderedPng.height)
  assert.deepEqual(Array.from(renderedPng.png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])

  const inspectedJpeg = await inspectDocument(JPEG_FIXTURE, 'image/jpeg')
  assert.equal(inspectedJpeg.pageCount, 1)
  assert.equal(inspectedJpeg.pages[0].needsOcr, true)
  assert.equal(inspectedJpeg.renderedPages.length, 1)
  const renderedJpeg = await renderDocumentPage(JPEG_FIXTURE, 'image/jpeg', 1, 1)
  assert.equal(inspectedJpeg.renderedPages[0].width, renderedJpeg.width)
  assert.equal(inspectedJpeg.renderedPages[0].height, renderedJpeg.height)
  assert.deepEqual(Array.from(renderedJpeg.png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])

  console.log('Document auto-fill unit tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
