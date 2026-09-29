const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')

const RECEIPT_PURPOSE = 'platform_integration_connection'
const RECEIPT_TTL_SECONDS = 600

const secret = () => String(process.env.JWT_SECRET || '')

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key])
      return result
    }, {})
}

const fingerprintIntegrationConfig = (integration, config) =>
  crypto
    .createHmac('sha256', secret())
    .update(JSON.stringify({ integration, config: stableValue(config || {}) }))
    .digest('hex')

const issueIntegrationReceipt = ({ integration, config, actorId }) => {
  const testedAt = new Date()
  const expiresAt = new Date(testedAt.getTime() + RECEIPT_TTL_SECONDS * 1000)
  const verificationReceipt = jwt.sign({
    purpose: RECEIPT_PURPOSE,
    integration,
    actorId: String(actorId),
    fingerprint: fingerprintIntegrationConfig(integration, config)
  }, secret(), { expiresIn: RECEIPT_TTL_SECONDS })

  return {
    verificationReceipt,
    testedAt: testedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  }
}

const receiptMatches = ({ receipt, integration, config, actorId }) => {
  if (!receipt) return false
  try {
    const decoded = jwt.verify(String(receipt), secret())
    if (
      decoded?.purpose !== RECEIPT_PURPOSE ||
      decoded?.integration !== integration ||
      String(decoded?.actorId || '') !== String(actorId)
    ) return false

    const expected = Buffer.from(fingerprintIntegrationConfig(integration, config), 'hex')
    const actual = Buffer.from(String(decoded?.fingerprint || ''), 'hex')
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

module.exports = {
  RECEIPT_TTL_SECONDS,
  fingerprintIntegrationConfig,
  issueIntegrationReceipt,
  receiptMatches
}
