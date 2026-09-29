const { asStr } = require('../utils/formDraftSchema')

const MAX_DOCUMENT_FIELDS = 100
const PROCESSING_VERSION = 3
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()
const isInput = (field) => field.necessity !== 'exclude' && field.role !== 'metadata'
const validIds = (ids, available) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => available.has(id))

// Same label in two different sections is not a duplicate. Evidence must overlap.
const sameCandidate = (a, b) => normalize(a.label) === normalize(b.label) &&
  normalize(a.context) === normalize(b.context) && a.type === b.type &&
  a.sourceLineIds.some((id) => b.sourceLineIds.includes(id))

function auditChunk(generated, audited, chunk) {
  const available = new Set(chunk.lines.map((line) => String(line.id)))
  const fields = (audited.fields || []).filter((field) => validIds(field.sourceLineIds, available))
    .map((field) => ({ ...field, _criticStatus: 'validated', _validationReason: '' }))
  const supporting = (audited.sourceAudit || []).filter((entry) =>
    ['supporting', 'unresolved'].includes(entry.classification) && entry.reason && validIds(entry.sourceLineIds, available)
  )
  const decisions = audited.candidateDecisions || []
  const omitted = []
  for (const original of generated.fields.filter((field) => isInput(field) && validIds(field.sourceLineIds, available))) {
    const decision = decisions.find((entry) => entry.candidateId === original.candidateId && entry.reason)
    const match = fields.find((field) => (field.candidateId === original.candidateId &&
      field.sourceLineIds.some((id) => original.sourceLineIds.includes(id))) || sameCandidate(field, original))
    if (match && isInput(match)) {
      if (['unresolved', 'exclude'].includes(decision?.decision) || !['core', 'optional', 'conditional'].includes(match.necessity)) {
        match._criticStatus = 'unavailable'
        match._validationReason = 'unresolved'
        match.criticConfidence = null
        omitted.push(original.candidateId)
      }
      continue
    }
    if (match && match.decisionReason && !['retain', 'unresolved'].includes(decision?.decision)) continue
    if (decision?.decision === 'exclude') continue
    if (match) fields.splice(fields.indexOf(match), 1)
    omitted.push(original.candidateId)
    fields.push({ ...original, _criticStatus: 'unavailable', _validationReason: 'not_returned', criticConfidence: null,
      decisionReason: 'The AI validator did not resolve this candidate. Check it against the highlighted source.' })
  }
  return { fields, sourceAudit: supporting, candidateDecisions: decisions,
    ...coverageFor(generated, { fields, sourceAudit: supporting, candidateDecisions: decisions }, chunk), omitted }
}

function coverageFor(generated, result, chunk) {
  const available = new Set(chunk.lines.map((line) => String(line.id)))
  const fields = result.fields || []
  const supporting = result.sourceAudit || []
  const decisions = result.candidateDecisions || []
  const accounted = new Set(fields.filter((field) => field._criticStatus === 'validated' || field._coverageReviewed).flatMap((field) => field.sourceLineIds))
  for (const entry of supporting.filter((entry) => entry.classification === 'supporting')) {
    entry.sourceLineIds.forEach((id) => accounted.add(id))
  }
  for (const original of generated.fields) {
    if (decisions.some((entry) => entry.candidateId === original.candidateId && entry.decision === 'exclude' && entry.reason)) {
      original.sourceLineIds.filter((id) => available.has(id)).forEach((id) => accounted.add(id))
    }
  }
  // Explicit uncertainty overrides an overlapping supporting-text classification.
  supporting.filter((entry) => entry.classification === 'unresolved')
    .flatMap((entry) => entry.sourceLineIds).forEach((id) => accounted.delete(id))
  return { unresolvedIds: [...available].filter((id) => !accounted.has(id)) }
}

function recoveryMerge(current, recovered, generated, chunk, targetIds) {
  const targets = new Set(targetIds)
  const originalById = new Map(generated.fields.map((field) => [field.candidateId, field]))
  const relevant = recovered.fields.filter((field) => field.sourceLineIds.some((id) => targets.has(id)))
  const fields = [...current.fields]
  for (const field of relevant) {
    const proposedOriginal = originalById.get(field.candidateId) || generated.fields.find((original) => sameCandidate(original, field))
    const original = proposedOriginal?.sourceLineIds.some((id) => field.sourceLineIds.includes(id)) ? proposedOriginal : null
    const index = fields.findIndex((existing) =>
      (original && existing.candidateId === original.candidateId) || sameCandidate(existing, field))
    if (index >= 0 && fields[index]._criticStatus === 'validated') continue
    const next = { ...field, candidateId: original ? original.candidateId : '', _criticStatus: original ? 'validated' : 'unavailable',
      _validationReason: original ? '' : 'recovery_only', _coverageReviewed: true,
      criticConfidence: original ? field.criticConfidence : null }
    if (!original) next.decisionReason = 'Additional field found by the recovery check; human validation is required.'
    if (index >= 0) fields[index] = next
    else fields.push(next)
  }
  const decisions = [...current.candidateDecisions]
  for (const decision of recovered.candidateDecisions || []) {
    const original = originalById.get(decision.candidateId)
    if (!original || !original.sourceLineIds.some((id) => targets.has(id))) continue
    if (current.fields.some((field) => field.candidateId === decision.candidateId && field._criticStatus === 'validated')) continue
    const index = decisions.findIndex((entry) => entry.candidateId === decision.candidateId)
    if (index >= 0) decisions[index] = decision
    else decisions.push(decision)
    if (decision.decision === 'exclude') {
      const index = fields.findIndex((field) => field.candidateId === decision.candidateId && field._criticStatus !== 'validated')
      if (index >= 0) fields.splice(index, 1)
    }
  }
  const recoveryAudit = (recovered.sourceAudit || []).filter((entry) => entry.sourceLineIds.some((id) => targets.has(id)))
  const replaced = new Set(recoveryAudit.flatMap((entry) => entry.sourceLineIds))
  const sourceAudit = current.sourceAudit.map((entry) => ({ ...entry,
    sourceLineIds: entry.sourceLineIds.filter((id) => !replaced.has(id)) })).filter((entry) => entry.sourceLineIds.length)
    .concat(recoveryAudit)
  const merged = auditChunk(generated, { fields, sourceAudit, candidateDecisions: decisions }, chunk)
  // A recovery-only discovery has had one semantic pass, not two.
  merged.fields = merged.fields.map((field) => {
    const prior = fields.find((existing) => existing === field || sameCandidate(existing, field))
    return prior?._criticStatus === 'unavailable' ? { ...field, _criticStatus: 'unavailable',
      _validationReason: prior._validationReason, _coverageReviewed: prior._coverageReviewed, criticConfidence: null } : field
  })
  Object.assign(merged, coverageFor(generated, merged, chunk))
  return merged
}

function compactAudit(raw) {
  return {
    sourceAudit: (Array.isArray(raw.sourceAudit) ? raw.sourceAudit : []).map((entry) => ({
      sourceLineIds: Array.isArray(entry?.sourceLineIds) ? [...new Set(entry.sourceLineIds.map(String))] : [],
      classification: asStr(entry?.classification, 20), reason: asStr(entry?.reason, 240)
    })),
    candidateDecisions: (Array.isArray(raw.candidateDecisions) ? raw.candidateDecisions : []).filter((entry) =>
      ['retain', 'exclude', 'unresolved'].includes(entry?.decision)
    ).map((entry) => ({ candidateId: asStr(entry.candidateId, 80), decision: entry.decision, reason: asStr(entry.reason, 240) }))
  }
}

function extractionGaps(pages, lines) {
  let unreadablePageCount = 0
  let lowConfidenceOcrPageCount = 0
  for (const page of pages) {
    const pageLines = lines.filter((line) => Number(line.page) === Number(page.page))
    if (!pageLines.length) { unreadablePageCount += 1; continue }
    const ocr = pageLines.filter((line) => line.source === 'ocr')
    if (ocr.length && ocr.reduce((sum, line) => sum + (Number(line.confidence) || 0), 0) / ocr.length < 60) {
      lowConfidenceOcrPageCount += 1
    }
  }
  return { unreadablePageCount, lowConfidenceOcrPageCount }
}

module.exports = { MAX_DOCUMENT_FIELDS, PROCESSING_VERSION, auditChunk, coverageFor, recoveryMerge, compactAudit, sameCandidate, extractionGaps }
