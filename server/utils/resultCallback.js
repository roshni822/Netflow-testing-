// Fire-and-forget HTTP callback when a webhook-started workflow finishes.

const { signBody } = require('./inboundWebhook')
const { isSafeUrl, callWebhook } = require('./webhook')

const publicBaseUrl = () => {
  const fromEnv = String(process.env.PUBLIC_API_URL || process.env.CLIENT_URL || '').split(',')[0].trim()
  if (fromEnv) {
    // Prefer API base; if CLIENT_URL is the SPA, callers should set PUBLIC_API_URL.
    return fromEnv.replace(/\/$/, '')
  }
  return `http://localhost:${process.env.PORT || 5000}`
}

const statusUrlFor = (statusToken) => {
  if (!statusToken) return null
  return `${publicBaseUrl()}/api/hooks/status/${statusToken}`
}

/**
 * Notify the external system of the final outcome.
 * outcome: 'completed' | 'failed' | 'cancelled' | 'rejected'
 */
const sendResultCallback = async (workflow, execution, outcome) => {
  const url = String(workflow?.inboundWebhook?.callbackUrl || '').trim()
  if (!url) return { skipped: true, reason: 'no_callback_url' }
  if (execution?.variables?.source !== 'webhook' && execution?.triggeredByExternal?.source !== 'webhook') {
    return { skipped: true, reason: 'not_webhook_run' }
  }

  const safe = isSafeUrl(url)
  if (!safe.ok) {
    console.warn('resultCallback blocked unsafe URL:', safe.reason)
    return { skipped: true, reason: safe.reason }
  }

  const payload = {
    executionId: String(execution._id),
    workflowId: String(workflow._id),
    workflowTitle: workflow.title,
    status: execution.status,
    outcome,
    formData: execution.variables?.formData || {},
    submitter: execution.variables?.submitter || execution.triggeredByExternal || null,
    failureReason: execution.failureReason || null,
    statusUrl: statusUrlFor(execution.statusToken),
    completedAt: execution.completedAt || execution.failedAt || new Date()
  }
  const raw = JSON.stringify(payload)
  const headers = { 'Content-Type': 'application/json' }
  const secret = workflow.inboundWebhook?.secret
  if (secret) {
    headers['X-NetFlow-Signature'] = `sha256=${signBody(secret, raw)}`
  }

  try {
    if (require('../database/context').transactions.getStore()) {
      return require('../database/outbox').enqueue('callback', { url, method: 'POST', headers, body: raw, retries: 2, timeoutMs: 8000 }, `callback:${execution._id}:${outcome}`)
    }
    const result = await callWebhook({
      url,
      method: 'POST',
      headers,
      body: raw,
      retries: 2,
      timeoutMs: 8000
    })
    return { ok: result.ok, status: result.status }
  } catch (err) {
    console.error('resultCallback error:', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = { sendResultCallback, statusUrlFor, publicBaseUrl }
