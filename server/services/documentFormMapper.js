const path = require('node:path')
const { asStr, sanitizeAiFields, identifierLabel } = require('../utils/formDraftSchema')
const { generateLlmDocumentSchema } = require('./documentSchemaLlm')
const { percentScore, sourceMethod, sourceDetails, qualitySummary } = require('./documentConfidence')
const { MAX_DOCUMENT_FIELDS, PROCESSING_VERSION } = require('./documentCandidateAudit')

const MAX_FIELDS = MAX_DOCUMENT_FIELDS
const SUPPORTED_TYPES = new Set([
  'text', 'textarea', 'paragraph', 'longtext', 'long_text', 'text_multiline',
  'dropdown', 'select', 'choice', 'options', 'date', 'datetime', 'time',
  'file', 'upload', 'attachment', 'checkbox', 'boolean', 'toggle', 'switch',
  'signature', 'number', 'integer', 'float', 'decimal', 'currency',
  'radio', 'grid', 'heading'
])

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0))
const confidenceTier = (value) => value >= 85 ? 'high' : value >= 60 ? 'medium' : 'low'

const inferredType = (label) => {
  const value = String(label || '')
  if (identifierLabel(value)) return 'text'
  if (/\b(?:date|dob|deadline|valid\s+until|effective\s+from)\b/i.test(value)) return 'date'
  if (/\b(?:amount|cost|price|quantity|qty|percentage|percent|rate|total|tax)\b/i.test(value)) return 'number'
  if (/\b(?:signature|signed\s+by)\b/i.test(value)) return 'signature'
  if (/\b(?:remarks|comments|description|reason|notes|details)\b/i.test(value)) return 'text_multiline'
  return null
}

const normalizeText = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const DOCUMENT_TYPE_RULES = [
  ['goods_receipt', /\b(?:goods received (?:note|notice)|goods receipt (?:note|notice)|grn)\b/i],
  ['invoice', /\b(?:tax invoice|commercial invoice|invoice)\b/i],
  ['purchase_order', /\b(?:purchase order|purchase requisition|po number|po no)\b/i],
  ['expense_claim', /\b(?:expense claim|expense reimbursement|travel expense)\b/i],
  ['leave_request', /\b(?:leave request|leave application|absence request)\b/i],
  ['onboarding', /\b(?:employee onboarding|new hire|joining form)\b/i],
  ['application', /\b(?:application form|registration form|enrolment form)\b/i]
]

const GROUNDED_METADATA = {
  goods_receipt: {
    titlePattern: /^goods (?:received|receipt) (?:note|notice)$/i,
    fallbackTitle: 'Goods Receipt',
    description: (title) =>
      'Capture receipt references, supplier details, received-item rows, quantities, and approval details from the source ' + title + '.'
  }
}

function detectDocumentType(lines) {
  const source = (lines || []).map((line) => String(line?.text || '')).join(' ')
  return DOCUMENT_TYPE_RULES.find(([, pattern]) => pattern.test(source))?.[0] || 'generic_form'
}

function groundedDocumentMetadata(documentType, lines) {
  const profile = GROUNDED_METADATA[documentType]
  if (!profile) return { title: '', description: '' }
  const titleLine = [...(lines || [])]
    .filter((line) =>
      Number(line?.page || 1) === 1 &&
      Number(line?.y || 0) <= 0.15 &&
      profile.titlePattern.test(String(line?.text || '').trim())
    )
    .sort((left, right) => Number(left.y) - Number(right.y) || Number(left.x) - Number(right.x))[0]
  const title = asStr(titleLine?.text, 120) || profile.fallbackTitle
  return {
    title,
    description: asStr(profile.description(title), 500)
  }
}

const uniqueWarnings = (warnings) => [...new Set(warnings.filter(Boolean))]

function labelGrounding(label, sourceLines) {
  if (!sourceLines.length) return 0
  const normalizedLabel = normalizeText(label)
  const normalizedSource = normalizeText(sourceLines.map((line) => line.text).join(' '))
  if (!normalizedLabel || !normalizedSource) return 0
  if (normalizedSource.includes(normalizedLabel)) return 100
  const tokens = [...new Set(normalizedLabel.split(' ').filter((token) => token.length > 1))]
  if (!tokens.length) return 0
  const sourceTokens = new Set(normalizedSource.split(' '))
  const matched = tokens.filter((token) => sourceTokens.has(token)).length
  return Math.round((matched / tokens.length) * 100)
}

const horizontalOverlapRatio = (left, right) => {
  const leftStart = Number(left?.x) || 0
  const leftWidth = Math.max(0, Number(left?.width) || 0)
  const rightStart = Number(right?.x) || 0
  const rightWidth = Math.max(0, Number(right?.width) || 0)
  const overlap = Math.max(
    0,
    Math.min(leftStart + leftWidth, rightStart + rightWidth) - Math.max(leftStart, rightStart)
  )
  const smallerWidth = Math.min(leftWidth, rightWidth)
  return smallerWidth > 0 ? overlap / smallerWidth : 0
}

function tableHeaderGroups(sourceLines) {
  const groups = []
  const ordered = [...(sourceLines || [])].sort((left, right) =>
    Number(left?.page) - Number(right?.page) ||
    Number(left?.x) - Number(right?.x) ||
    Number(left?.y) - Number(right?.y)
  )

  for (const line of ordered) {
    const group = groups.find((candidate) => candidate.some((existing) =>
      Number(existing?.page) === Number(line?.page) &&
      horizontalOverlapRatio(existing, line) >= 0.55
    ))
    if (group) group.push(line)
    else groups.push([line])
  }
  return groups
}

function gridColumnGrounding(label, sourceLines) {
  return tableHeaderGroups(sourceLines).reduce(
    (best, group) => Math.max(best, labelGrounding(label, group)),
    0
  )
}

function visibleChoiceScore(values, sourceLines) {
  const options = Array.isArray(values) ? values.map((value) => normalizeText(value)).filter(Boolean) : []
  if (!options.length) return 0
  const source = normalizeText(sourceLines.map((line) => line.text).join(' '))
  if (!source) return 0
  const grounded = options.filter((option) => source.includes(option)).length
  return Math.round((grounded / options.length) * 100)
}

function layoutScore(regions) {
  if (!regions.length) return 0
  const usable = regions.filter((region) =>
    Number.isFinite(region.x) &&
    Number.isFinite(region.y) &&
    region.width > 0 &&
    region.height > 0
  ).length
  return Math.round((usable / regions.length) * 100)
}

function sourceRegionsFor(sourceLineIds, lineById) {
  const regions = []
  for (const lineId of sourceLineIds) {
    const line = lineById.get(lineId)
    if (!line) continue
    regions.push({
      lineId,
      page: Number(line.page),
      x: Math.max(0, Math.min(1, Number(line.x) || 0)),
      y: Math.max(0, Math.min(1, Number(line.y) || 0)),
      width: Math.max(0, Math.min(1, Number(line.width) || 0)),
      height: Math.max(0, Math.min(1, Number(line.height) || 0)),
      confidence: percentScore(line.confidence),
      source: sourceMethod(line)
    })
  }
  return regions
}

const gridColumnType = (label) => {
  const type = inferredType(label)
  return type === 'number' || type === 'date' ? type : 'text'
}

function mergeGridColumnCandidates(candidates) {
  const removed = new Set()
  for (const grid of candidates.filter((candidate) => candidate.field?.type === 'grid')) {
    if (grid._structureLocked) continue
    const gridLineIds = new Set(grid._sourceLineIds || [])
    if (!gridLineIds.size) continue
    const columns = [...(grid.field.columns || [])]
    const columnLabels = new Set(columns.map((column) => normalizeText(column?.label)))

    for (const candidate of candidates) {
      if (candidate === grid || candidate.field?.type === 'grid') continue
      const sharedEvidence = (candidate._sourceLineIds || []).some((lineId) => gridLineIds.has(lineId))
      if (!sharedEvidence) continue
      const label = asStr(candidate.field?.label, 60)
      const labelKey = normalizeText(label)
      if (!labelKey || labelKey === normalizeText(grid.field.label)) continue
      if (!columnLabels.has(labelKey) && columns.length < 12) {
        columns.push({
          id: 'c' + (columns.length + 1),
          label,
          type: gridColumnType(label)
        })
        columnLabels.add(labelKey)
      }
      removed.add(candidate.candidateId)
    }

    if (columns.length !== (grid.field.columns || []).length) {
      grid.field = { ...grid.field, columns }
      grid.reviewWarnings = uniqueWarnings([
        ...(grid.reviewWarnings || []),
        'Related table headers were grouped into this table.'
      ])
    }
  }
  return candidates.filter((candidate) => !removed.has(candidate.candidateId))
}

function sanitizeDocumentDraft(
  raw,
  lines,
  {
    filename = 'document.pdf',
    trustedDerivedFields = new WeakSet(),
    trustedStructureFields = new WeakSet()
  } = {}
) {
  const rawFields = Array.isArray(raw?.fields) ? raw.fields : []
  const lineById = new Map((lines || []).map((line) => [String(line.id), line]))
  const protectedTableLineIds = new Set(
    rawFields
      .filter((field) => trustedStructureFields.has(field) && field?.type === 'grid')
      .flatMap((field) => Array.isArray(field.sourceLineIds) ? field.sourceLineIds.map(String) : [])
  )
  const candidates = []
  const diagnostics = { invalidEvidence: 0, weakLabel: 0, excluded: 0, merged: 0, invalidStructure: 0 }
  const documentMetadata = raw?.document && typeof raw.document === 'object' ? raw.document : raw
  const titleKey = normalizeText(documentMetadata?.title || raw?.title)
  const allowedNecessity = new Set(['core', 'optional', 'conditional', 'exclude'])

  for (const sourceField of rawFields) {
    if (!sourceField || typeof sourceField !== 'object') continue
    const role = asStr(sourceField.role, 20).toLowerCase()
    const necessity = allowedNecessity.has(asStr(sourceField.necessity, 20).toLowerCase())
      ? asStr(sourceField.necessity, 20).toLowerCase()
      : 'optional'
    if (necessity === 'exclude' || role === 'metadata') { diagnostics.excluded += 1; continue }

    const sourceOrder = candidates.length
    const requestedIds = Array.isArray(sourceField.sourceLineIds)
      ? [...new Set(sourceField.sourceLineIds.map(String))]
      : []
    const trustedStructure = trustedStructureFields.has(sourceField)
    if (!trustedStructure && requestedIds.some((id) => protectedTableLineIds.has(id))) continue
    const validIds = requestedIds.filter((id) => lineById.has(id))
    // Any unknown citation makes the candidate untrustworthy. Partial evidence
    // must never legitimize hallucinated source IDs.
    if (!validIds.length || requestedIds.length !== validIds.length) { diagnostics.invalidEvidence += 1; continue }
    const sourceLines = validIds.map((id) => lineById.get(id))
    if (!sourceLines.every((line) => String(line.text || '').trim() &&
      Number.isFinite(Number(line.page)) && Number(line.page) >= 1 &&
      Number.isFinite(Number(line.x)) && Number.isFinite(Number(line.y)) &&
      Number(line.x) >= 0 && Number(line.x) < 1 && Number(line.y) >= 0 && Number(line.y) < 1 &&
      Number(line.width) > 0 && Number(line.width) <= 1 && Number(line.height) > 0 && Number(line.height) <= 1)) { diagnostics.invalidEvidence += 1; continue }
    const sourceText = sourceLines.map((line) => line.text).join(' ')
    const warnings = Array.isArray(sourceField.reviewWarnings)
      ? sourceField.reviewWarnings.map((warning) => asStr(warning, 200)).filter(Boolean)
      : []
    const rawType = asStr(sourceField.type, 20).toLowerCase()
    const normalizedInput = { ...sourceField }
    const unsupportedType = !SUPPORTED_TYPES.has(rawType)

    if (unsupportedType) {
      normalizedInput.type = 'text'
      warnings.push('Unsupported field type was converted to text and needs review.')
    }

    if (identifierLabel(sourceField.label)) {
      normalizedInput.type = 'text'
      normalizedInput.multiline = false
      if (rawType !== 'text') warnings.push('Identifier field was kept as text to preserve formatting.')
    } else if (['textarea', 'paragraph', 'longtext', 'long_text', 'text_multiline'].includes(rawType)) {
      normalizedInput.type = 'text'
      normalizedInput.multiline = true
    }
    if (role === 'heading') {
      normalizedInput.type = 'heading'
      normalizedInput.required = false
    }

    const rawChoice = ['dropdown', 'radio', 'select', 'choice', 'options'].includes(rawType)
    const rawOptions = Array.isArray(sourceField.options)
      ? sourceField.options.map((value) => asStr(value, 80)).filter(Boolean)
      : []
    const groundedOptions = rawOptions.filter((option) => visibleChoiceScore([option], sourceLines) === 100)
    const yesNo = groundedOptions.length === 2 &&
      groundedOptions.map(normalizeText).sort().join('|') === 'no|yes'
    if (rawChoice) normalizedInput.options = groundedOptions
    if (yesNo && !['radio', 'checkbox'].includes(normalizedInput.type)) {
      normalizedInput.type = 'radio'
      warnings.push('Visible Yes/No choices were normalized to a radio field.')
    }
    if (rawChoice && groundedOptions.length < 2) {
      normalizedInput.type = 'text'
      delete normalizedInput.options
      warnings.push('Choice options were incomplete or ungrounded, so this field was converted to text.')
    } else if (rawChoice && groundedOptions.length !== rawOptions.length) {
      warnings.push('Choices not visible in the cited source were removed.')
    }
    if (rawType === 'grid') {
      const columns = Array.isArray(sourceField.columns)
        ? sourceField.columns.filter((column) => asStr(column?.label, 60))
        : []
      const groundedColumns = columns.filter((column) =>
        gridColumnGrounding(column?.label, sourceLines) >= 75
      )
      normalizedInput.columns = groundedColumns
      if (!groundedColumns.length) {
        normalizedInput.type = 'text'
        delete normalizedInput.columns
        warnings.push('Table columns were incomplete or ungrounded, so this field was converted to text.')
      } else if (groundedColumns.length !== columns.length) {
        warnings.push('Table columns not visible in the cited source were removed.')
      }
    }

    const sanitized = sanitizeAiFields(
      [normalizedInput],
      { maxFields: 1, identifiersAsText: true }
    )[0]
    if (!sanitized) { diagnostics.invalidStructure += 1; continue }

    const requiredWasRequested = Boolean(sanitized.required)
    const requiredGrounded = /(?:\*|\brequired\b|\bmandatory\b)/i.test(sourceText)
    let requiredReason = asStr(sourceField.requiredReason, 240)
    if (sanitized.required && necessity !== 'core') {
      sanitized.required = false
      requiredReason = ''
      warnings.push('Only a core field can be inferred as required, so required status was removed.')
    } else if (sanitized.required && !requiredReason && !requiredGrounded) {
      sanitized.required = false
      warnings.push('Required status had no supporting reason and was removed.')
    } else if (sanitized.required && requiredGrounded && !requiredReason) {
      requiredReason = 'A required marker is printed in the cited source.'
    } else if (sanitized.required && !requiredGrounded) {
      warnings.push('Required status was inferred by the LLM and must be reviewed.')
    }

    const sourceRegions = sourceRegionsFor(validIds, lineById)
    const firstRegion = [...sourceRegions].sort((a, b) =>
      a.page - b.page || a.y - b.y || a.x - b.x
    )[0]
    sanitized.page = firstRegion?.page || Math.max(1, Number(sourceField.page) || 1)

    const trustedDerivedLabel = sourceField._labelDerivedFromDocumentType === true &&
      trustedDerivedFields.has(sourceField)
    const sourceLabel = asStr(sourceField.sourceLabel || sourceField.label, 160)
    const labelScore = trustedDerivedLabel ? 100 : labelGrounding(sourceLabel, sourceLines)
    const labelKey = normalizeText(sanitized.label)
    if (titleKey && labelKey === titleKey) { diagnostics.excluded += 1; continue }
    const sourceScore = sourceLines.length
      ? sourceLines.reduce((sum, line) => sum + clamp(line.confidence), 0) / sourceLines.length
      : 0
    let optionScore = rawChoice && !rawOptions.length ? 0 : 100
    if (rawChoice && rawOptions.length) optionScore = visibleChoiceScore(rawOptions, sourceLines)
    if (rawType === 'grid' && !Array.isArray(sourceField.columns)) {
      optionScore = 0
    } else if (rawType === 'grid' && Array.isArray(sourceField.columns)) {
      const tableColumns = sourceField.columns.filter((column) => asStr(column?.label, 60))
      const groundedColumnCount = tableColumns.filter((column) =>
        gridColumnGrounding(column?.label, sourceLines) >= 75
      ).length
      optionScore = tableColumns.length
        ? Math.round((groundedColumnCount / tableColumns.length) * 100)
        : 0
    }
    const generatorConfidence = percentScore(
      sourceField.generatorConfidence ?? sourceField.mappingConfidence
    )
    const criticStatus = (sourceField._criticStatus || raw?.criticStatus) === 'unavailable'
      ? 'unavailable'
      : 'validated'
    const criticConfidence = criticStatus === 'validated'
      ? percentScore(sourceField.criticConfidence)
      : null
    let score = Math.min(generatorConfidence, criticConfidence, sourceScore)
    if (labelScore < 75) {
      diagnostics.weakLabel += 1
      score = Math.min(score, 59)
      warnings.push('Source-label wording differs from the extracted text; verify the label and highlighted evidence before including.')
    }

    if ((rawChoice || rawType === 'grid') && optionScore < 100) {
      score = Math.min(score, 59)
      warnings.push('Some choices or table columns were not visible in the cited source text.')
    }
    if (unsupportedType) score = Math.min(score, 59)
    if (generatorConfidence === null || (criticStatus === 'validated' && criticConfidence === null)) {
      warnings.push('An LLM confidence score was not provided; review this field before including it.')
    }
    if (criticStatus === 'unavailable') {
      score = 0
      warnings.push('LLM critic validation was unavailable; this field is excluded by default and requires manual review.')
    }

    const confidence = Math.round(clamp(score))
    const tier = confidenceTier(confidence)
    candidates.push({
      candidateId: 'candidate-' + (candidates.length + 1),
      scoreVersion: 2,
      field: sanitized,
      sourceLabel,
      context: asStr(sourceField.context, 120),
      sourceLineIds: validIds,
      necessity,
      decisionReason: asStr(sourceField.decisionReason, 240),
      requiredReason,
      generatorConfidence,
      criticConfidence,
      criticStatus,
      validationReason: criticStatus === 'unavailable' ? asStr(sourceField._validationReason, 40) : '',
      ...sourceDetails(sourceLines),
      labelGroundingConfidence: trustedDerivedLabel ? null : labelScore,
      labelGroundingMethod: trustedDerivedLabel ? 'document_context' : 'text_match',
      optionGroundingConfidence: rawChoice || rawType === 'grid' ? optionScore : null,
      confidence,
      confidenceTier: tier,
      includedByDefault: criticStatus === 'validated' && necessity === 'core' && tier === 'high',
      reviewWarnings: uniqueWarnings(warnings),
      sourceRegions,
      _sourceOrder: sourceOrder,
      _sourceLineIds: validIds,
      _structureLocked: trustedStructure
    })
  }

  const necessityRank = { core: 3, conditional: 2, optional: 1 }
  const mergedByLabel = new Map()
  for (const candidate of candidates) {
    const labelKey = normalizeText(candidate.field?.label)
    const match = [...mergedByLabel.entries()].find(([, other]) =>
      normalizeText(other.field?.label) === labelKey && other.field.type === candidate.field.type &&
      normalizeText(other.context) === normalizeText(candidate.context) &&
      other.sourceLineIds.some((id) => candidate.sourceLineIds.includes(id)))
    const key = match?.[0] || candidate.candidateId
    const existing = match?.[1]
    if (!existing) {
      mergedByLabel.set(key, candidate)
      continue
    }
    const candidateRank = (candidate.criticStatus === 'validated' ? 1000 : 0) +
      (necessityRank[candidate.necessity] || 0) * 100 + candidate.confidence
    const existingRank = (existing.criticStatus === 'validated' ? 1000 : 0) +
      (necessityRank[existing.necessity] || 0) * 100 + existing.confidence
    const winner = candidateRank > existingRank ? candidate : existing
    diagnostics.merged += 1
    const loser = winner === candidate ? existing : candidate
    winner._sourceOrder = Math.min(winner._sourceOrder, loser._sourceOrder)
    winner._sourceLineIds = [...new Set([...(winner._sourceLineIds || []), ...(loser._sourceLineIds || [])])]
    winner.sourceLineIds = [...winner._sourceLineIds]
    winner.sourceRegions = [...winner.sourceRegions, ...loser.sourceRegions].filter((region, index, regions) =>
      regions.findIndex((other) => other.lineId === region.lineId) === index
    )
    winner.sourceRegions.sort((left, right) =>
      left.page - right.page || left.y - right.y || left.x - right.x
    )
    Object.assign(winner, sourceDetails(winner.sourceRegions))
    const mergedSourceConfidence = winner.sourceRegions.reduce(
      (sum, region) => sum + clamp(region.confidence),
      0
    ) / winner.sourceRegions.length
    winner.confidence = Math.round(Math.min(winner.confidence, mergedSourceConfidence))
    winner.confidenceTier = confidenceTier(winner.confidence)
    winner.includedByDefault = winner.criticStatus === 'validated' &&
      winner.necessity === 'core' && winner.confidenceTier === 'high'
    winner.reviewWarnings = uniqueWarnings([...winner.reviewWarnings, ...loser.reviewWarnings])
    mergedByLabel.set(key, winner)
  }

  const structuredCandidates = [...mergedByLabel.values()]
  structuredCandidates.forEach((candidate) => {
    candidate.sourceRegions.sort((left, right) =>
      left.page - right.page || left.y - right.y || left.x - right.x
    )
  })

  structuredCandidates.sort((left, right) => {
    const a = left.sourceRegions[0]
    const b = right.sourceRegions[0]
    if (a && b) return a.page - b.page || a.y - b.y || a.x - b.x
    if (a) return -1
    if (b) return 1
    return left._sourceOrder - right._sourceOrder
  })
  const limitedCandidates = structuredCandidates.slice(0, MAX_FIELDS)
  limitedCandidates.forEach((candidate, index) => {
    candidate.candidateId = 'candidate-' + (index + 1)
    delete candidate._sourceOrder
    delete candidate._sourceLineIds
    delete candidate._structureLocked
  })

  const confidenceSummary = limitedCandidates.reduce((summary, candidate) => {
    summary[candidate.confidenceTier] += 1
    return summary
  }, { high: 0, medium: 0, low: 0 })

  const limitReached = raw?.limitReached === true || structuredCandidates.length > MAX_FIELDS
  const coverage = raw?.coverage ? { ...raw.coverage,
    status: limitReached || diagnostics.invalidEvidence || diagnostics.invalidStructure || limitedCandidates.some((candidate) => candidate.criticStatus === 'unavailable')
      ? 'partial' : raw.coverage.status } : null

  return {
    processingVersion: PROCESSING_VERSION,
    maxFields: MAX_FIELDS,
    limitReached,
    coverage,
    diagnostics,
    title: asStr(documentMetadata?.title || raw?.title, 120) || asStr(path.basename(filename, path.extname(filename)), 120),
    description: asStr(documentMetadata?.description || raw?.description, 500),
    documentType: asStr(documentMetadata?.type || raw?.documentType, 80),
    criticStatus: raw?.criticStatus === 'unavailable' ? 'unavailable' : 'validated',
    candidates: limitedCandidates,
    confidenceSummary,
    qualitySummary: qualitySummary(lines || [], limitedCandidates),
    detectedFieldCount: structuredCandidates.length,
    truncated: limitReached
  }
}

async function generateDocumentFormDraft(
  lines,
  options = {}
) {
  if (!Array.isArray(lines) || !lines.length) {
    const error = new Error('No readable form fields were found in the document')
    error.code = 'NO_FIELDS_DETECTED'
    throw error
  }
  const raw = await generateLlmDocumentSchema(lines, options)
  const result = sanitizeDocumentDraft(raw, lines, { filename: options.filename })
  if (!result.candidates.length) {
    const error = new Error('No source-grounded form fields were detected')
    error.code = 'NO_FIELDS_DETECTED'
    throw error
  }
  return result
}

module.exports = {
  MAX_FIELDS,
  confidenceTier,
  detectDocumentType,
  groundedDocumentMetadata,
  sanitizeDocumentDraft,
  generateDocumentFormDraft
}
