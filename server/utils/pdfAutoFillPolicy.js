const { presetFor } = require('../config/plans')
const { configured: ocrConfigured } = require('../services/paddleOcrClient')
const { isConfigured: llmConfigured } = require('./llm')

const LANGUAGE_MODES = ['english']
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  languageMode: 'english',
  audiences: Object.freeze({ authenticated: true, public: false })
})

function runtimeReady() {
  if (String(process.env.PDF_AUTOFILL_ENABLED || '').toLowerCase() !== 'true') return false
  if (process.env.NODE_ENV !== 'production') return true
  return /^https?:\/\//i.test(String(process.env.SOURCE_CODE_URL || '')) &&
    Boolean(String(process.env.CLAMAV_HOST || '').trim()) &&
    ocrConfigured() &&
    llmConfigured()
}

function settingsFor(org) {
  const configured = org?.pdfAutoFill || {}
  return {
    enabled: configured.enabled !== false,
    languageMode: LANGUAGE_MODES.includes(configured.languageMode)
      ? configured.languageMode
      : DEFAULT_SETTINGS.languageMode,
    audiences: {
      authenticated: configured.audiences?.authenticated !== false,
      public: configured.audiences?.public === true
    }
  }
}

function planEntitled(org) {
  if (!org || org.isDefault === true) return false
  if (org.plan === 'custom') return org.pdfAutoFill?.entitlementOverride === true
  const preset = presetFor(org.plan)
  return Boolean(preset && preset.features?.pdfAutoFill === true)
}

function policyFor(org, audience) {
  const settings = settingsFor(org)
  const entitled = planEntitled(org)
  const operational = runtimeReady()
  const audienceAllowed = audience
    ? settings.audiences[audience] === true
    : settings.audiences.authenticated || settings.audiences.public
  return {
    entitled,
    operational,
    configured: settings.enabled,
    audienceAllowed,
    enabled: operational && entitled && settings.enabled && audienceAllowed,
    languageMode: settings.languageMode,
    audiences: settings.audiences
  }
}

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'PDF auto-fill settings must be an object.' }
  }
  const current = {
    enabled: input.enabled !== false,
    languageMode: String(input.languageMode || DEFAULT_SETTINGS.languageMode),
    audiences: {
      authenticated: input.audiences?.authenticated === true,
      public: input.audiences?.public === true
    }
  }
  if (!LANGUAGE_MODES.includes(current.languageMode)) {
    return { error: 'languageMode must be one of: ' + LANGUAGE_MODES.join(', ') + '.' }
  }
  if (current.enabled && !current.audiences.authenticated && !current.audiences.public) {
    return { error: 'Choose authenticated users, public forms, or both before enabling PDF auto-fill.' }
  }
  return { value: current }
}

module.exports = {
  LANGUAGE_MODES,
  DEFAULT_SETTINGS,
  runtimeReady,
  settingsFor,
  planEntitled,
  policyFor,
  validateSettings
}
