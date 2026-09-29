const crypto = require('node:crypto')
const PdfAutoFillLearningProfile = require('../models/PdfAutoFillLearningProfile')
const PdfAutoFillSemanticProfile = require('../models/PdfAutoFillSemanticProfile')
const DocumentExtractionJob = require('../models/DocumentExtractionJob')

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const quantize = (value) => Math.round((Number(value) || 0) * 50) / 50
const profileKey = (fieldId, evidenceKey, valuePattern) =>
  [String(fieldId), String(evidenceKey), String(valuePattern)].join(':')
const normalizeSemanticText = (value, fallback = '') => String(value ?? fallback)
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ')
  .slice(0, 160)
const normalizeDocumentType = (value) =>
  (normalizeSemanticText(value, 'document') || 'document').replace(/\s+/g, '').slice(0, 80)
const semanticProfileKey = (documentType, sourceAlias, fieldId, valuePattern) => [
  normalizeDocumentType(documentType),
  normalizeSemanticText(sourceAlias),
  String(fieldId),
  String(valuePattern)
].join(':')

function classifyValuePattern(value) {
  if (value === undefined || value === null || value === '') return 'empty'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(text)) return 'date'
  const list = text.split(',').map((part) => part.trim()).filter(Boolean)
  if (list.length > 1 && list.every((part) => /^[\p{L}\p{N}./_-]+$/u.test(part))) return 'identifier_list'
  if (/^\d+$/.test(text)) return 'numeric_identifier'
  if (/^[\p{L}\p{N}./_-]+$/u.test(text) && /\d/u.test(text)) return 'alphanumeric_identifier'
  return 'text'
}

function structuralRegion(region) {
  return {
    page: Number(region?.page) || 0,
    x: quantize(region?.x),
    y: quantize(region?.y),
    width: quantize(region?.width),
    height: quantize(region?.height)
  }
}

function buildEvidenceKey(fieldId, sourceRegions) {
  const regions = (sourceRegions || [])
    .map(structuralRegion)
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    .slice(0, 1)
  return hash({ fieldId: String(fieldId), regions })
}

function buildTemplateFingerprint(form, lines, mappingHints) {
  const lineById = new Map((lines || []).map((line) => [String(line.id), line]))
  const pageCount = Math.max(0, ...(lines || []).map((line) => Number(line.page) || 0))
  const anchors = (mappingHints || []).map((hint) => ({
    fieldId: String(hint.fieldId),
    strategy: String(hint.strategy || ''),
    alias: String(hint.matchedAlias || ''),
    regions: (hint.sourceLineIds || [])
      .map((id) => lineById.get(String(id)))
      .filter(Boolean)
      .map(structuralRegion)
      .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
      .slice(0, 1)
  })).sort((a, b) => a.fieldId.localeCompare(b.fieldId))
  return hash({
    formId: String(form?._id || form?.id || ''),
    fieldIds: (form?.fields || []).map((field) => String(field.id)).sort(),
    pageCount,
    anchors
  })
}

async function loadProfiles({ orgId, formId, templateFingerprint }) {
  if (!orgId || !formId || !templateFingerprint) return new Map()
  const profiles = await PdfAutoFillLearningProfile.find({ orgId, formId, templateFingerprint })
    .setOptions({ skipOrgScope: true })
    .lean()
  return new Map(profiles.map((profile) => [
    profileKey(profile.fieldId, profile.evidenceKey, profile.valuePattern),
    profile
  ]))
}

async function loadSemanticProfiles({ orgId, formId }) {
  if (!orgId || !formId) return new Map()
  const profiles = await PdfAutoFillSemanticProfile.find({ orgId, formId })
    .sort({ totalConfirmations: -1, lastFeedbackAt: -1 })
    .limit(500)
    .setOptions({ skipOrgScope: true })
    .lean()
  return new Map(profiles.map((profile) => [
    semanticProfileKey(profile.documentType, profile.sourceAlias, profile.fieldId, profile.valuePattern),
    profile
  ]))
}

function calibrateSuggestion(suggestion, profile, groundedConfidence, fullyGrounded = true) {
  const baseConfidence = Math.max(0, Math.min(100, Number(suggestion.confidence) || 0))
  let confidence = baseConfidence
  const mayPromote = suggestion.valid !== false && fullyGrounded && groundedConfidence > 0
  if (mayPromote && profile?.learnedTier === 'high' && Number(profile.positiveStreak) >= 5) {
    confidence = Math.max(confidence, 90)
  } else if (mayPromote && ['medium', 'high'].includes(profile?.learnedTier) && Number(profile.positiveStreak) >= 2) {
    confidence = Math.max(confidence, 70)
  }
  confidence = Math.min(confidence, Math.max(0, Math.min(100, Number(groundedConfidence) || 0)))
  if (!mayPromote) confidence = Math.min(confidence, 69)
  return {
    ...suggestion,
    baseConfidence: Math.round(baseConfidence),
    confidence: Math.round(confidence),
    tier: confidence >= 90 ? 'high' : confidence >= 70 ? 'medium' : 'low',
    learnedTier: profile?.learnedTier || 'none'
  }
}

function learnedHintFor(hint, lines, profiles) {
  const lineById = new Map((lines || []).map((line) => [String(line.id), line]))
  const regions = (hint.sourceLineIds || []).map((id) => lineById.get(String(id))).filter(Boolean)
  const evidenceKey = buildEvidenceKey(hint.fieldId, regions)
  const valuePattern = classifyValuePattern(hint.proposedValue)
  const profile = profiles.get(profileKey(hint.fieldId, evidenceKey, valuePattern))
  if (!profile || profile.learnedTier === 'none') return hint
  return {
    ...hint,
    learnedEvidence: {
      tier: profile.learnedTier,
      consecutiveConfirmations: Number(profile.positiveStreak) || 0
    }
  }
}

function normalizedComparable(value) {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  if (Array.isArray(value)) return value.map(normalizedComparable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedComparable(value[key])]))
  }
  return value
}

function valuesMatch(actual, suggested) {
  return JSON.stringify(normalizedComparable(actual)) === JSON.stringify(normalizedComparable(suggested))
}

function feedbackTransition(profile = {}, outcome) {
  if (outcome === 'confirmed') {
    const positiveStreak = (Number(profile.positiveStreak) || 0) + 1
    return {
      positiveStreak,
      totalConfirmations: (Number(profile.totalConfirmations) || 0) + 1,
      correctionCount: Number(profile.correctionCount) || 0,
      dismissalCount: Number(profile.dismissalCount) || 0,
      learnedTier: positiveStreak >= 5 ? 'high' : positiveStreak >= 2 ? 'medium' : 'none'
    }
  }
  return {
    positiveStreak: 0,
    totalConfirmations: Number(profile.totalConfirmations) || 0,
    correctionCount: (Number(profile.correctionCount) || 0) + (outcome === 'corrected' ? 1 : 0),
    dismissalCount: (Number(profile.dismissalCount) || 0) + (outcome === 'dismissed' ? 1 : 0),
    learnedTier: 'none'
  }
}

async function updateProfile(job, suggestion, outcome) {
  if (!suggestion.learningKey || !suggestion.valuePattern || !job.templateFingerprint) return
  const identity = {
    orgId: job.orgId,
    formId: job.formId,
    templateFingerprint: job.templateFingerprint,
    fieldId: suggestion.fieldId,
    evidenceKey: suggestion.learningKey,
    valuePattern: suggestion.valuePattern
  }
  const increment = (path) => ({ $add: [{ $ifNull: [path, 0] }, 1] })
  const pipeline = outcome === 'confirmed'
    ? [
        {
          $set: {
            ...identity,
            positiveStreak: increment('$positiveStreak'),
            totalConfirmations: increment('$totalConfirmations'),
            correctionCount: { $ifNull: ['$correctionCount', 0] },
            dismissalCount: { $ifNull: ['$dismissalCount', 0] },
            lastFeedbackAt: '$$NOW'
          }
        },
        {
          $set: {
            learnedTier: {
              $switch: {
                branches: [
                  { case: { $gte: ['$positiveStreak', 5] }, then: 'high' },
                  { case: { $gte: ['$positiveStreak', 2] }, then: 'medium' }
                ],
                default: 'none'
              }
            }
          }
        }
      ]
    : [{
        $set: {
          ...identity,
          positiveStreak: 0,
          totalConfirmations: { $ifNull: ['$totalConfirmations', 0] },
          correctionCount: outcome === 'corrected' ? increment('$correctionCount') : { $ifNull: ['$correctionCount', 0] },
          dismissalCount: outcome === 'dismissed' ? increment('$dismissalCount') : { $ifNull: ['$dismissalCount', 0] },
          learnedTier: 'none',
          lastFeedbackAt: '$$NOW'
        }
      }]
  try {
    await PdfAutoFillLearningProfile.updateOne(identity, pipeline, { upsert: true, skipOrgScope: true })
  } catch (error) {
    if (error?.code !== 11000) throw error
    await PdfAutoFillLearningProfile.updateOne(identity, pipeline, { skipOrgScope: true })
  }
}

async function updateSemanticProfile(job, suggestion, outcome) {
  const documentType = normalizeDocumentType(job.documentType)
  const sourceAlias = normalizeSemanticText(suggestion.sourceLabel)
  if (!job.orgId || !job.formId || !sourceAlias || !suggestion.fieldId || !suggestion.valuePattern) return
  const identity = {
    orgId: job.orgId,
    formId: job.formId,
    documentType,
    sourceAlias,
    fieldId: suggestion.fieldId,
    valuePattern: suggestion.valuePattern
  }
  const increment = (path) => ({ $add: [{ $ifNull: [path, 0] }, 1] })
  const pipeline = outcome === 'confirmed'
    ? [
        {
          $set: {
            ...identity,
            positiveStreak: increment('$positiveStreak'),
            totalConfirmations: increment('$totalConfirmations'),
            correctionCount: { $ifNull: ['$correctionCount', 0] },
            dismissalCount: { $ifNull: ['$dismissalCount', 0] },
            lastFeedbackAt: '$$NOW'
          }
        },
        {
          $set: {
            learnedTier: {
              $switch: {
                branches: [
                  { case: { $gte: ['$positiveStreak', 5] }, then: 'high' },
                  { case: { $gte: ['$positiveStreak', 2] }, then: 'medium' }
                ],
                default: 'none'
              }
            }
          }
        }
      ]
    : [{
        $set: {
          ...identity,
          positiveStreak: 0,
          totalConfirmations: { $ifNull: ['$totalConfirmations', 0] },
          correctionCount: outcome === 'corrected' ? increment('$correctionCount') : { $ifNull: ['$correctionCount', 0] },
          dismissalCount: outcome === 'dismissed' ? increment('$dismissalCount') : { $ifNull: ['$dismissalCount', 0] },
          learnedTier: 'none',
          lastFeedbackAt: '$$NOW'
        }
      }]
  try {
    await PdfAutoFillSemanticProfile.updateOne(identity, pipeline, { upsert: true, skipOrgScope: true })
  } catch (error) {
    if (error?.code !== 11000) throw error
    await PdfAutoFillSemanticProfile.updateOne(identity, pipeline, { skipOrgScope: true })
  }
}

function safeFeedback(feedback, knownFieldIds) {
  const clean = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map(String)
    .filter((value) => knownFieldIds.has(value))
    .slice(0, 200))]
  const dismissedFieldIds = clean(feedback?.dismissedFieldIds)
  const dismissed = new Set(dismissedFieldIds)
  return {
    dismissedFieldIds,
    appliedFieldIds: clean(feedback?.appliedFieldIds).filter((fieldId) => !dismissed.has(fieldId))
  }
}

const eligibleForPositiveLearning = (suggestion) =>
  suggestion?.valid !== false && suggestion?.criticApproved === true

async function recordSubmissionFeedback({ job, formData, feedback, responseId, audience }) {
  if (!job || audience !== 'authenticated' || job.audience !== 'authenticated') return { processed: false }
  if (job.feedbackProcessedAt || (!job.templateFingerprint && !job.documentType)) return { processed: false }
  const suggestions = job.suggestions || []
  const suggestionByField = new Map(suggestions.map((item) => [String(item.fieldId), item]))
  const cleaned = safeFeedback(feedback, new Set(suggestionByField.keys()))
  for (const fieldId of cleaned.dismissedFieldIds) {
    const suggestion = suggestionByField.get(fieldId)
    await updateProfile(job, suggestion, 'dismissed')
    await updateSemanticProfile(job, suggestion, 'dismissed')
  }
  for (const fieldId of cleaned.appliedFieldIds) {
    const suggestion = suggestionByField.get(fieldId)
    const confirmed = valuesMatch(formData?.[fieldId], suggestion.value)
    if (confirmed && !eligibleForPositiveLearning(suggestion)) continue
    const outcome = confirmed ? 'confirmed' : 'corrected'
    await updateProfile(job, suggestion, outcome)
    await updateSemanticProfile(job, suggestion, outcome)
  }
  await DocumentExtractionJob.updateOne(
    { _id: job._id, feedbackProcessedAt: null },
    { $set: { feedbackProcessedAt: new Date(), feedbackResponseId: responseId } },
    { skipOrgScope: true }
  )
  return { processed: true }
}

module.exports = {
  profileKey,
  semanticProfileKey,
  normalizeSemanticText,
  normalizeDocumentType,
  classifyValuePattern,
  buildEvidenceKey,
  buildTemplateFingerprint,
  loadProfiles,
  loadSemanticProfiles,
  calibrateSuggestion,
  learnedHintFor,
  valuesMatch,
  feedbackTransition,
  safeFeedback,
  eligibleForPositiveLearning,
  recordSubmissionFeedback
}
