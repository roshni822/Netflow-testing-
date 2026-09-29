// Helpers for n8n-style inbound webhook tokens + HMAC verification.

const crypto = require('crypto')

const newToken = () => crypto.randomBytes(24).toString('hex')
const newSecret = () => crypto.randomBytes(32).toString('hex')

/** Ensure a workflow has a webhook token + signing secret when enabled. */
const ensureWebhookToken = (workflow) => {
  if (!workflow.inboundWebhook) workflow.inboundWebhook = { enabled: false }
  if (workflow.inboundWebhook.enabled) {
    if (!workflow.inboundWebhook.token) workflow.inboundWebhook.token = newToken()
    if (!workflow.inboundWebhook.secret) workflow.inboundWebhook.secret = newSecret()
  }
  return workflow
}

/**
 * Apply inboundWebhook patch from a create/update body.
 */
const applyInboundWebhookPatch = (workflow, patch) => {
  if (!patch || typeof patch !== 'object') return
  if (!workflow.inboundWebhook) workflow.inboundWebhook = { enabled: false }

  if (typeof patch.enabled === 'boolean') {
    workflow.inboundWebhook.enabled = patch.enabled
  }
  if (patch.requireSignature !== undefined) {
    workflow.inboundWebhook.requireSignature = patch.requireSignature
  }
  if (typeof patch.callbackUrl === 'string') {
    workflow.inboundWebhook.callbackUrl = patch.callbackUrl.trim()
  }
  if (Array.isArray(patch.expectedFields)) {
    workflow.inboundWebhook.expectedFields = patch.expectedFields
      .filter((f) => f && f.id)
      .map((f) => ({
        id: String(f.id).trim(),
        label: String(f.label || f.id).trim(),
        type: String(f.type || 'text'),
        required: f.required === true
      }))
  }
  if (patch.regenerateToken === true && workflow.inboundWebhook.enabled) {
    workflow.inboundWebhook.token = newToken()
    workflow.inboundWebhook.secret = newSecret()
  }
  ensureWebhookToken(workflow)
}

const skipSignatureInDev = () =>
  process.env.NODE_ENV !== 'production' &&
  String(process.env.WEBHOOK_SKIP_SIGNATURE || '').toLowerCase() === '1'

const signBody = (secret, rawBody) => {
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8')
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('hex')
}

const verifyWebhookSignature = (req, inboundWebhook) => {
  if (inboundWebhook && inboundWebhook.requireSignature === false) {
    return { ok: true }
  }
  
  const secret = inboundWebhook?.secret
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: 'Webhook secret not configured', status: 401 }
    }
    return { ok: true }
  }
  if (skipSignatureInDev()) return { ok: true }

  const header = String(req.get('x-netflow-signature') || req.get('X-NetFlow-Signature') || '').trim()
  if (!header) {
    return { ok: false, reason: 'Missing X-NetFlow-Signature header', status: 401 }
  }
  const match = header.match(/^sha256\s*=\s*([a-fA-F0-9]+)$/)
  if (!match) {
    return { ok: false, reason: 'Invalid X-NetFlow-Signature format (expected sha256=<hex>)', status: 401 }
  }

  const raw = req.rawBody != null
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}), 'utf8')
  const expected = signBody(secret, raw)
  const provided = match[1].toLowerCase()
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'Invalid webhook signature', status: 401 }
  }
  return { ok: true }
}

/** Validate formData against inboundWebhook.expectedFields (if any). */
const validateExpectedFields = (expectedFields, formData) => {
  const fields = Array.isArray(expectedFields) ? expectedFields : []
  if (!fields.length) return { ok: true }
  const data = formData && typeof formData === 'object' ? formData : {}
  const missing = fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = data[f.id]
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    })
    .map((f) => f.label || f.id)
  if (missing.length) {
    return { ok: false, reason: `Missing required field(s): ${missing.join(', ')}`, status: 400 }
  }
  return { ok: true }
}

module.exports = {
  newToken,
  newSecret,
  ensureWebhookToken,
  applyInboundWebhookPatch,
  signBody,
  verifyWebhookSignature,
  skipSignatureInDev,
  validateExpectedFields
}
