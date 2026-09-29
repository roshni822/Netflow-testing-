const { sanitizeAiFields, documentFieldValidationError } = require('../utils/formDraftSchema')
const { MAX_DOCUMENT_FIELDS } = require('./documentCandidateAudit')

function reviewedDocumentFields(job, reviewed) {
  const fail = (message) => { const error = new Error(message); error.code = 'INVALID_REVIEWED_FIELD'; throw error }
  const selected = (Array.isArray(reviewed) ? reviewed : []).filter((item) => item?.included === true)
  const maxFields = job.processingVersion >= 2 ? MAX_DOCUMENT_FIELDS : 25
  if (selected.length > maxFields) fail('Include at most ' + maxFields + ' fields per form.')
  const originals = new Map((job.candidates || []).map((candidate) => [candidate.candidateId, candidate]))
  const seen = new Set()
  return selected.map((item) => {
    const original = originals.get(item.candidateId)
    if (!original || seen.has(item.candidateId)) fail('Select each generated candidate at most once.')
    seen.add(item.candidateId)
    const merged = { ...original.field, ...item.field }
    const error = documentFieldValidationError(merged)
    if (error) fail(error)
    const field = sanitizeAiFields([merged], { maxFields: 1, identifiersAsText: true })[0]
    if (!field) fail('The selected field could not be validated.')
    return field
  })
}

module.exports = { reviewedDocumentFields }
