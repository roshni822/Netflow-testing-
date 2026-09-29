const { generateJSON, isConfigured } = require('../utils/llm')
const { validateField } = require('../utils/validation')
const { generateLlmMappings } = require('./pdfAutoFillLlm')
const {
  extractGridMappingHints,
  detectedTableHeaderIds
} = require('./documentFieldHeuristics')
const {
  profileKey,
  classifyValuePattern,
  buildEvidenceKey,
  buildTemplateFingerprint,
  loadProfiles,
  loadSemanticProfiles,
  calibrateSuggestion,
  learnedHintFor,
  semanticProfileKey,
  normalizeSemanticText
} = require('./pdfAutoFillLearning')

const EXCLUDED = new Set(['file', 'signature', 'camera', 'repeater', 'heading'])
const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0))
const tierFor = (score) => score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low'
const normalizeLabelText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')

function aliasesForField(field) {
  const label = normalizeLabelText(field?.label)
  const aliases = new Set([label])
  if (/\bnumber\b/.test(label)) {
    aliases.add(label.replace(/\bnumber\b/g, 'no').replace(/\s+/g, ' ').trim())
    aliases.add(label.replace(/\bnumber\b/g, '').replace(/\s+/g, ' ').trim())
  }

  if (/\bpurchase\b.*\border\b/.test(label)) {
    for (const alias of ['purchase order number', 'purchase order no', 'purchase order', 'po number', 'po no', 'po', 'order']) {
      aliases.add(alias)
    }
  }
  if (/\binvoice\b/.test(label) && (/\bnumber\b/.test(label) || /\bsupplier\b/.test(label))) {
    for (const alias of ['supplier invoice number', 'supplier invoice no', 'invoice number', 'invoice no', 'invoice']) {
      aliases.add(alias)
    }
  }
  if (/\bsupplier\b/.test(label) && /\bvendor\b/.test(label)) {
    for (const alias of ['supplier vendor name', 'supplier vendor', 'supplier', 'vendor']) aliases.add(alias)
  }
  if (/\breceived\b/.test(label) && /\bdescription\b/.test(label)) {
    for (const alias of ['received item description', 'item description', 'description']) aliases.add(alias)
  }
  if (/\breceived\b/.test(label) && /\bquantity\b/.test(label)) {
    for (const alias of ['received quantity', 'quantity received', 'quantity']) aliases.add(alias)
  }

  aliases.delete('')
  return [...aliases].sort((a, b) => b.length - a.length)
}

function sameLineValue(line, aliases) {
  const raw = String(line?.text || '').trim()
  const separator = raw.search(/[:#]/)
  if (separator < 1) return null
  const left = normalizeLabelText(raw.slice(0, separator))
  if (!aliases.includes(left)) return null
  const value = raw.slice(separator + 1).trim()
  return value ? { value, sourceLineIds: [line.id], matchedAlias: left } : null
}

const centerX = (line) => Number(line.x || 0) + (Number(line.width || 0) / 2)
const centerY = (line) => Number(line.y || 0) + (Number(line.height || 0) / 2)

function nearestValueLine(labelLine, lines, knownLabels) {
  const labelRight = Number(labelLine.x || 0) + Number(labelLine.width || 0)
  const labelBottom = Number(labelLine.y || 0) + Number(labelLine.height || 0)
  return lines
    .filter((line) =>
      line.id !== labelLine.id &&
      line.page === labelLine.page &&
      String(line.text || '').trim() &&
      !knownLabels.has(normalizeLabelText(line.text))
    )
    .map((line) => {
      const verticalDistance = Number(line.y || 0) - labelBottom
      const horizontalDistance = Number(line.x || 0) - labelRight
      const sameRow = Math.abs(centerY(line) - centerY(labelLine)) <= Math.max(
        0.018,
        Number(line.height || 0) * 1.5,
        Number(labelLine.height || 0) * 1.5
      ) && horizontalDistance >= -0.006 && horizontalDistance <= 0.25
      const below = verticalDistance >= -0.006 && verticalDistance <= 0.09 &&
        Math.abs(Number(line.x || 0) - Number(labelLine.x || 0)) <= Math.max(
          0.045,
          Number(labelLine.width || 0) * 1.5
        )
      if (!sameRow && !below) return null
      const score = sameRow
        ? Math.abs(horizontalDistance) + (Math.abs(centerY(line) - centerY(labelLine)) * 2)
        : Math.abs(verticalDistance) + Math.abs(centerX(line) - centerX(labelLine))
      return { line, score, priority: sameRow ? 0 : 1 }
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || a.score - b.score)[0] || null
}

function columnValues(headerLine, lines, knownLabels) {
  const candidates = lines
    .filter((line) => {
      if (line.id === headerLine.id || line.page !== headerLine.page) return false
      if (Number(line.y || 0) <= Number(headerLine.y || 0) + Number(headerLine.height || 0) * 0.5) return false
      if (Math.abs(Number(line.x || 0) - Number(headerLine.x || 0)) > 0.035) return false
      const text = String(line.text || '').trim()
      if (!text || knownLabels.has(normalizeLabelText(text))) return false
      return /^[\p{L}\p{N}][\p{L}\p{N}./_-]{3,}$/u.test(text)
    })
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0))

  if (!candidates.length) return []
  const contiguous = [candidates[0]]
  for (const line of candidates.slice(1)) {
    const previous = contiguous[contiguous.length - 1]
    const gap = Number(line.y || 0) - Number(previous.y || 0)
    const allowedGap = Math.max(0.04, Number(previous.height || 0) * 5, Number(line.height || 0) * 5)
    if (gap > allowedGap) break
    contiguous.push(line)
  }
  return contiguous
}

function buildMappingHints(fields, lines) {
  const scalarFields = fields.filter((field) => field.type !== 'grid')
  const knownLabels = new Set([
    ...scalarFields.flatMap(aliasesForField),
    ...fields.filter((field) => field.type === 'grid')
      .flatMap((field) => field.columns || [])
      .flatMap(aliasesForField)
  ])
  const tableHeaderIds = detectedTableHeaderIds(lines)
  const hints = []

  for (const field of scalarFields) {
    const aliases = aliasesForField(field)
    const sameLine = lines
      .map((line) => ({ line, match: sameLineValue(line, aliases) }))
      .find(({ match }) => match)
    if (sameLine) {
      hints.push({
        fieldId: field.id,
        fieldLabel: field.label,
        strategy: 'same_line_label_value',
        matchedAlias: sameLine.match.matchedAlias,
        proposedValue: sameLine.match.value,
        sourceLineIds: sameLine.match.sourceLineIds,
        mappingConfidence: 96,
        autoApplyEligible: true
      })
      continue
    }

    const labelLines = lines.filter((line) =>
      !tableHeaderIds.has(String(line.id)) && aliases.includes(normalizeLabelText(line.text))
    )
    const isInvoiceNumber = /\binvoice\b/.test(normalizeLabelText(field.label)) &&
      (/\bnumber\b/.test(normalizeLabelText(field.label)) || /\bsupplier\b/.test(normalizeLabelText(field.label)))
    if (isInvoiceNumber) {
      const invoiceHeader = labelLines.find((line) => normalizeLabelText(line.text) === 'invoice')
      const values = invoiceHeader ? columnValues(invoiceHeader, lines, knownLabels) : []
      if (values.length) {
        const unique = new Map()
        for (const line of values) {
          const key = normalizeLabelText(line.text)
          if (!unique.has(key)) unique.set(key, line)
        }
        const uniqueLines = [...unique.values()]
        hints.push({
          fieldId: field.id,
          fieldLabel: field.label,
          strategy: 'table_column',
          matchedAlias: 'invoice',
          aggregationPolicy: 'all_unique_comma_separated',
          proposedValue: uniqueLines.map((line) => String(line.text).trim()).join(', '),
          sourceLineIds: [invoiceHeader.id, ...uniqueLines.map((line) => line.id)]
        })
        continue
      }
    }

    for (const labelLine of labelLines) {
      const match = nearestValueLine(labelLine, lines, knownLabels)
      if (!match) continue
      hints.push({
        fieldId: field.id,
        fieldLabel: field.label,
        strategy: 'near_exact_label',
        matchedAlias: normalizeLabelText(labelLine.text),
        proposedValue: String(match.line.text).trim(),
        sourceLineIds: [String(labelLine.id), String(match.line.id)],
        mappingConfidence: match.priority === 0 ? 95 : 91,
        autoApplyEligible: true
      })
      break
    }
  }

  return [...hints, ...extractGridMappingHints(fields, lines)]
}

function withGroundedFallbacks(raw, mappingHints) {
  let mappings = Array.isArray(raw?.mappings) ? [...raw.mappings] : []
  for (const hint of mappingHints || []) {
    if (!hint?.fieldId || hint.proposedValue === undefined || !(hint.sourceLineIds || []).length) continue
    const fieldId = String(hint.fieldId)
    const forField = mappings.filter((mapping) => String(mapping?.fieldId || '') === fieldId)
    if (hint.autoApplyEligible === true) {
      mappings = mappings.filter((mapping) => String(mapping?.fieldId || '') !== fieldId)
      mappings.push({
        fieldId,
        value: hint.proposedValue,
        mappingConfidence: clampScore(hint.mappingConfidence),
        sourceLineIds: hint.sourceLineIds
      })
      continue
    }
    if (hint.aggregationPolicy === 'all_unique_comma_separated') {
      const exact = forField.some((mapping) => {
        const mappedIds = new Set((mapping.sourceLineIds || []).map(String))
        return String(mapping.value ?? '').trim() === String(hint.proposedValue).trim() &&
          hint.sourceLineIds.every((id) => mappedIds.has(String(id)))
      })
      if (exact) continue
      mappings = mappings.filter((mapping) => String(mapping?.fieldId || '') !== fieldId)
      mappings.push({
        fieldId,
        value: hint.proposedValue,
        mappingConfidence: 65,
        sourceLineIds: hint.sourceLineIds
      })
      continue
    }
    if (!forField.length) {
      mappings.push({
        fieldId,
        value: hint.proposedValue,
        mappingConfidence: 60,
        sourceLineIds: hint.sourceLineIds
      })
    }
  }
  return { ...(raw && typeof raw === 'object' ? raw : {}), mappings }
}

const eligibleFields = (form) => (form.fields || []).filter((field) =>
  !EXCLUDED.has(field.type) && field.referenceUser !== true
)

function normalizeChoice(value, options) {
  const wanted = String(value ?? '').trim().toLocaleLowerCase()
  return (options || []).find((option) => String(option).trim().toLocaleLowerCase() === wanted)
}

const MONTHS = new Map([
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6],
  ['jul', 7], ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12]
])

function validIsoDate(year, month, day) {
  const iso = [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-')
  const parsed = new Date(iso + 'T00:00:00.000Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
    ? iso
    : null
}

function normalizeDocumentDate(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return raw

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) || raw

  const named = /^(\d{1,2})[\s./-]+([a-z]{3,9})[\s,./-]+(\d{2}|\d{4})$/i.exec(raw)
  if (named) {
    const month = MONTHS.get(named[2].slice(0, 3).toLowerCase())
    let year = Number(named[3])
    if (named[3].length === 2) year += year <= 49 ? 2000 : 1900
    return month ? (validIsoDate(year, month, Number(named[1])) || raw) : raw
  }

  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    // Do not guess when both day and month positions are locale-ambiguous.
    if (day > 12 && month <= 12) return validIsoDate(Number(numeric[3]), month, day) || raw
  }
  return raw
}

function normalizeGridCell(column, raw) {
  return normalizeValue({
    type: column.type || 'text',
    options: column.options || [],
    label: column.label || 'Grid value'
  }, raw)
}

function normalizeValue(field, raw) {
  if (raw === undefined || raw === null) return raw
  if (field.type === 'grid') {
    if (!Array.isArray(raw)) return raw
    const columns = Array.isArray(field.columns) ? field.columns : []
    return raw.slice(0, 500).map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row
      const normalized = {}
      for (const column of columns) {
        if (!column?.id || row[column.id] === undefined) continue
        normalized[column.id] = normalizeGridCell(column, row[column.id])
      }
      return normalized
    })
  }
  if (field.type === 'date') return normalizeDocumentDate(raw)
  if (field.type === 'number') {
    const cleaned = String(raw).replace(/,/g, '').trim()
    const number = Number(cleaned)
    return Number.isFinite(number) ? number : raw
  }
  if (field.type === 'checkbox') {
    if (typeof raw === 'boolean') return raw
    const normalized = String(raw).trim().toLowerCase()
    if (['true', 'yes', '1', 'checked'].includes(normalized)) return true
    if (['false', 'no', '0', 'unchecked'].includes(normalized)) return false
    return raw
  }
  if (field.type === 'dropdown' || field.type === 'radio') {
    return normalizeChoice(raw, field.options) ?? raw
  }
  return typeof raw === 'string' ? raw.trim() : raw
}

function validateSuggestion(field, value) {
  if (field.type === 'grid') {
    if (!Array.isArray(value) || value.length === 0) return 'Table must contain at least one grounded row'
    const columns = Array.isArray(field.columns) ? field.columns.filter((column) => column?.id) : []
    if (!columns.length) return 'Table does not have configured columns'
    for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
      const row = value[rowIndex]
      if (!row || typeof row !== 'object' || Array.isArray(row)) return `Table row ${rowIndex + 1} is invalid`
      const filled = columns.filter((column) => {
        const cell = row[column.id]
        return cell !== undefined && cell !== null && String(cell).trim() !== ''
      })
      if (!filled.length) return `Table row ${rowIndex + 1} is empty`
      if (field.required && filled.length !== columns.length) return `Table row ${rowIndex + 1} is incomplete`
      for (const column of filled) {
        const message = validateSuggestion({
          type: column.type || 'text',
          options: column.options || [],
          label: column.label || 'Table value'
        }, row[column.id])
        if (message) return `Row ${rowIndex + 1}, ${column.label}: ${message}`
      }
    }
    return null
  }
  if (field.type === 'dropdown' || field.type === 'radio') {
    if (!normalizeChoice(value, field.options)) return 'Value does not match a configured option'
  }
  if (field.type === 'date') {
    const raw = String(value || '')
    const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2})?$/.exec(raw)
    const parsed = match ? new Date(match[1] + 'T00:00:00.000Z') : null
    if (!match || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[1]) {
      return 'Date must use a valid YYYY-MM-DD value'
    }
  }
  if (field.type === 'checkbox' && typeof value !== 'boolean') return 'Checkbox value must be true or false'
  return validateField(field, value)
}

const normalizedValueText = (value) => normalizeLabelText(
  typeof value === 'boolean' ? (value ? 'yes true checked 1' : 'no false unchecked 0') : value
)

function dateEvidenceMatches(value, sourceLines) {
  const wanted = String(value ?? '')
  const patterns = [
    /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g,
    /\b\d{1,2}[\s./-]+[a-z]{3,9}[\s,./-]+\d{2,4}\b/gi,
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/g
  ]
  return sourceLines.some((line) => patterns.some((pattern) =>
    (String(line.text || '').match(pattern) || []).some((candidate) => normalizeDocumentDate(candidate) === wanted)
  ))
}

function numberEvidenceMatches(value, sourceLines) {
  const wanted = Number(value)
  if (!Number.isFinite(wanted)) return false
  return sourceLines.some((line) => {
    const candidates = String(line.text || '').match(/-?\d[\d,]*(?:\.\d+)?/g) || []
    return candidates.some((candidate) => Number(candidate.replace(/,/g, '')) === wanted)
  })
}

function scalarEvidenceMatches(field, value, sourceLines) {
  if (field.type === 'date') return dateEvidenceMatches(value, sourceLines)
  if (field.type === 'number') return numberEvidenceMatches(value, sourceLines)
  const evidence = normalizeLabelText(sourceLines.map((line) => line.text).join(' '))
  const wanted = normalizedValueText(value)
  if (!wanted) return false
  if (field.type === 'checkbox') {
    const terms = value === true ? ['yes', 'true', 'checked', '1'] : ['no', 'false', 'unchecked', '0']
    return terms.some((term) => new RegExp('(?:^| )' + term + '(?: |$)').test(evidence))
  }
  const parts = String(value ?? '').split(',').map((part) => normalizeLabelText(part)).filter(Boolean)
  return parts.length > 1 ? parts.every((part) => evidence.includes(part)) : evidence.includes(wanted)
}

function valueGroundedInSource(field, value, sourceLines) {
  if (!sourceLines.length) return false
  if (field.type !== 'grid') return scalarEvidenceMatches(field, value, sourceLines)
  if (!Array.isArray(value) || !value.length) return false
  const columns = new Map((field.columns || []).map((column) => [String(column.id), column]))
  return value.every((row) => row && typeof row === 'object' && Object.entries(row).every(([columnId, cell]) => {
    if (cell === undefined || cell === null || String(cell).trim() === '') return true
    return scalarEvidenceMatches(columns.get(String(columnId)) || { type: 'text' }, cell, sourceLines)
  }))
}

function sourceLabelGrounded(sourceLabel, sourceLines, value) {
  const rawLabel = String(sourceLabel ?? '').trim()
  const label = normalizeSemanticText(rawLabel)
  if (!label) return false
  const normalizedValue = normalizedValueText(value)
  if (normalizedValue && (label === normalizedValue || normalizedValue.startsWith(label + ' '))) return false
  if (/\b\d{1,2}[\s./-]+(?:[a-z]{3,9}|\d{1,2})[\s,./-]+\d{2,4}\b/i.test(rawLabel)) return false
  if (/^\(?[a-z]{0,6}\d[\p{L}\p{N}./_-]*\)?$/iu.test(rawLabel)) return false
  if (/^\d[\d,./:#$%+\s-]*$/u.test(rawLabel)) return false
  return normalizeLabelText(sourceLines.map((line) => line.text).join(' ')).includes(label)
}

function sanitizeMappings(form, lines, raw, learning = {}) {
  const fields = eligibleFields(form)
  const lineById = new Map(lines.map((line) => [line.id, line]))
  const fieldById = new Map(fields.map((field) => [field.id, field]))
  const suggestionByField = new Map()
  const profiles = learning.profiles instanceof Map ? learning.profiles : new Map()
  const semanticProfiles = learning.semanticProfiles instanceof Map ? learning.semanticProfiles : new Map()
  const documentType = normalizeSemanticText(learning.documentType || raw?.documentType, 'document') || 'document'

  for (const mapping of Array.isArray(raw?.mappings) ? raw.mappings : []) {
    const field = fieldById.get(String(mapping?.fieldId || ''))
    if (!field) continue

    const sourceLineIds = [...new Set(Array.isArray(mapping.sourceLineIds) ? mapping.sourceLineIds.map(String) : [])]
    const sourceLines = sourceLineIds.map((id) => lineById.get(id)).filter(Boolean)
    const hasInvalidSource = sourceLineIds.length !== sourceLines.length
    const value = normalizeValue(field, mapping.value)
    const validationMessage = validateSuggestion(field, value)
    const semanticResult = mapping.criticApproved !== undefined || mapping.criticStatus || mapping.sourceLabel
    const valueIsGrounded = valueGroundedInSource(field, value, sourceLines)
    const labelIsGrounded = !semanticResult || sourceLabelGrounded(mapping.sourceLabel, sourceLines, value)
    const criticApproved = mapping.criticApproved === true && mapping.criticStatus !== 'unavailable'
    const groundedConfidence = sourceLines.length
      ? Math.min(...sourceLines.map((line) => clampScore(line.confidence)))
      : 0
    const generatorConfidence = clampScore(mapping.generatorConfidence ?? mapping.mappingConfidence)
    const criticConfidence = criticApproved ? clampScore(mapping.criticConfidence) : generatorConfidence
    let confidence = Math.min(groundedConfidence, generatorConfidence, criticConfidence)
    if (!sourceLines.length || hasInvalidSource || validationMessage || !valueIsGrounded || !labelIsGrounded) {
      confidence = Math.min(confidence, 69)
    }
    if (semanticResult && !criticApproved) confidence = Math.min(confidence, 69)

    const learningKey = buildEvidenceKey(field.id, sourceLines)
    const valuePattern = classifyValuePattern(value)
    const profile = profiles.get(profileKey(field.id, learningKey, valuePattern))
    const sourceLabel = String(mapping.sourceLabel || '').trim().slice(0, 160)
    const semanticProfile = semanticProfiles.get(semanticProfileKey(documentType, sourceLabel, field.id, valuePattern))
    let suggestion = calibrateSuggestion({
      fieldId: field.id,
      value,
      confidence: Math.round(confidence),
      tier: tierFor(confidence),
      generatorConfidence: Math.round(generatorConfidence),
      criticConfidence: Math.round(criticConfidence),
      criticApproved,
      criticStatus: String(mapping.criticStatus || raw?.criticStatus || (criticApproved ? 'validated' : 'fallback')),
      sourceLabel,
      decisionReason: String(mapping.decisionReason || '').trim().slice(0, 300),
      learningKey,
      valuePattern,
      valid: !validationMessage && valueIsGrounded && labelIsGrounded,
      validationMessage: validationMessage || (!valueIsGrounded
        ? 'The suggested value is not present in the cited source evidence'
        : (!labelIsGrounded ? 'The source label is not present in the cited evidence' : null)),
      sourceRegions: sourceLines.map((line) => ({
        lineId: line.id,
        page: line.page,
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        text: line.text,
        confidence: clampScore(line.confidence)
      }))
    }, profile, groundedConfidence, sourceLines.length > 0 && !hasInvalidSource && (!semanticResult || criticApproved))
    if (semanticProfile) {
      suggestion = calibrateSuggestion(
        suggestion,
        semanticProfile,
        groundedConfidence,
        suggestion.valid && criticApproved
      )
      suggestion.learnedTier = semanticProfile.learnedTier || suggestion.learnedTier
    }
    // Semantic memory informs the LLM passes, but it must never raise a current
    // mapping above the generator/critic/source confidence minimum.
    if (semanticResult && suggestion.confidence > Math.round(confidence)) {
      suggestion.confidence = Math.round(confidence)
      suggestion.tier = tierFor(confidence)
    }
    const existing = suggestionByField.get(field.id)
    if (!existing || suggestion.confidence > existing.confidence) suggestionByField.set(field.id, suggestion)
  }

  return fields.map((field) => suggestionByField.get(field.id)).filter(Boolean)
}
async function mapFields(
  form,
  lines,
  {
    generate = generateJSON,
    llmAvailable = isConfigured(),
    loadProfileMap = loadProfiles,
    loadSemanticProfileMap = loadSemanticProfiles,
    orchestrate = generateLlmMappings
  } = {}
) {
  const fields = eligibleFields(form)
  if (!fields.length || !lines.length) return { suggestions: [], templateFingerprint: null }
  const mappingHints = buildMappingHints(fields, lines)
  const templateFingerprint = buildTemplateFingerprint(form, lines, mappingHints)
  let profiles = new Map()
  let semanticProfiles = new Map()
  try {
    ;[profiles, semanticProfiles] = await Promise.all([
      loadProfileMap({ orgId: form.orgId, formId: form._id, templateFingerprint }),
      loadSemanticProfileMap({ orgId: form.orgId, formId: form._id })
    ])
  } catch (error) {
    console.warn('[pdf-auto-fill] learning profiles unavailable:', error.message)
  }
  const groundedCandidateHints = mappingHints.map((hint) => learnedHintFor(hint, lines, profiles))
  let raw
  try {
    raw = await orchestrate(fields, lines, groundedCandidateHints, [...semanticProfiles.values()], {
      generate,
      llmAvailable
    })
  } catch (cause) {
    if (!groundedCandidateHints.length) {
      const error = new Error('LLM mapping service is unavailable')
      error.code = cause?.code === 'MAPPING_FAILED' ? 'MAPPING_FAILED' : 'LLM_UNAVAILABLE'
      throw error
    }
    console.warn('[pdf-auto-fill] LLM mapping unavailable; using grounded review suggestions')
    raw = {
      documentType: 'document',
      criticStatus: 'fallback',
      mappings: groundedCandidateHints.map((hint) => {
        const firstEvidence = lines.find((line) => String(line.id) === String(hint.sourceLineIds?.[0]))
        return {
          fieldId: hint.fieldId,
          value: hint.proposedValue,
          sourceLabel: hint.strategy === 'table_grid'
            ? String(firstEvidence?.text || hint.matchedAlias || '')
            : (hint.matchedAlias || hint.fieldLabel || ''),
          sourceLineIds: hint.sourceLineIds || [],
          mappingConfidence: clampScore(hint.mappingConfidence || (hint.strategy === 'table_grid' ? 95 : 60)),
          generatorConfidence: clampScore(hint.mappingConfidence || (hint.strategy === 'table_grid' ? 95 : 60)),
          criticConfidence: 0,
          criticApproved: false,
          criticStatus: 'fallback',
          decisionReason: 'Grounded fallback awaiting manual review'
        }
      })
    }
  }

  return {
    suggestions: sanitizeMappings(form, lines, raw, {
      profiles,
      semanticProfiles,
      templateFingerprint,
      documentType: raw.documentType
    }),
    templateFingerprint,
    documentType: normalizeSemanticText(raw.documentType, 'document') || 'document',
    criticStatus: raw.criticStatus || 'fallback'
  }
}

module.exports = {
  eligibleFields,
  mapFields,
  sanitizeMappings,
  normalizeValue,
  normalizeDocumentDate,
  validateSuggestion,
  valueGroundedInSource,
  tierFor,
  buildMappingHints,
  withGroundedFallbacks
}
