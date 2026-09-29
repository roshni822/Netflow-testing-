// Inbound webhook triggers + public execution status.

const express = require('express')
const crypto = require('crypto')

const Workflow = require('../models/Workflow')
const WorkflowExecution = require('../models/WorkflowExecution')
const WebhookIdempotency = require('../models/WebhookIdempotency')
const WebhookDeliveryLog = require('../models/WebhookDeliveryLog')
const Organization = require('../models/Organization')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { triggerWorkflow } = require('../utils/workflowEngine')
const { runWithOrgId } = require('../tenancy/tenantContext')
const {
  verifyWebhookSignature,
  validateExpectedFields
} = require('../utils/inboundWebhook')
const { hooksLimiter } = require('../middleware/rateLimit')
const { writeAuditLog } = require('../utils/writeAuditLog')
const { statusUrlFor } = require('../utils/resultCallback')
const { checkQuota } = require('../middleware/quota')
const { writeBlockFor } = require('../middleware/licence')
const { meterSubmission } = require('../utils/usageMeter')

const router = express.Router()
router.use('/status/:statusToken', require('../database/fresh/resources').route('execution_status', req => req.params.statusToken))
router.post('/:token', require('../database/fresh/resources').route('inbound_webhook', req => req.params.token))

const MAX_PAYLOAD_BYTES = 100 * 1024
const MAX_FORM_KEYS = 200

const idempotencyKeyOf = (req) => {
  const raw = req.get('idempotency-key') || req.get('x-idempotency-key') || ''
  return String(raw).trim().slice(0, 200)
}

const logDelivery = async (fields) => {
  try {
    await WebhookDeliveryLog.create(fields)
  } catch (err) {
    console.error('WebhookDeliveryLog write failed:', err.message)
  }
}

// GET /api/hooks/status/:statusToken — public poll for external forms.
router.get('/status/:statusToken', async (req, res, next) => {
  try {
    const statusToken = String(req.params.statusToken || '').trim()
    if (!statusToken || statusToken.length < 16) {
      return sendError(res, 'Invalid status token', 'INVALID_TOKEN', 404)
    }
    const execution = await WorkflowExecution.findOne({ statusToken })
      .select('status failureReason completedAt failedAt startedAt variables triggeredByExternal workflowId')
      .populate('workflowId', 'title')
      .setOptions({ skipOrgScope: true })
      .lean()
    if (!execution) return sendError(res, 'Execution not found', 'NOT_FOUND', 404)

    const outcome =
      execution.status === 'completed'
        ? (execution.variables?.lastApprovalOutcome === 'rejected' ? 'rejected' : 'approved')
        : execution.status === 'failed'
          ? (/reject/i.test(String(execution.failureReason || '')) ? 'rejected' : 'failed')
          : execution.status

    return sendSuccess(res, {
      executionId: execution._id,
      workflowTitle: execution.workflowId?.title || null,
      status: execution.status,
      outcome,
      failureReason: execution.failureReason || null,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt || execution.failedAt || null,
      submitter: execution.variables?.submitter || execution.triggeredByExternal || null,
      formData: execution.variables?.formData || {}
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/hooks/:token — start a workflow from an external caller.
router.post('/:token', hooksLimiter, async (req, res, next) => {
  const ip = req.ip || 'unknown'
  let workflow = null
  try {
    const token = String(req.params.token || '').trim()
    if (!token || token.length < 16) {
      await logDelivery({ ok: false, statusCode: 404, error: 'Invalid token', code: 'INVALID_TOKEN', ip })
      return sendError(res, 'Invalid webhook token', 'INVALID_TOKEN', 404)
    }

    if (req.rawBody && req.rawBody.length > MAX_PAYLOAD_BYTES) {
      await logDelivery({ ok: false, statusCode: 413, error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE', ip })
      return sendError(res, 'Payload too large (max 100KB)', 'PAYLOAD_TOO_LARGE', 413)
    }

    workflow = await Workflow.findOne({
      'inboundWebhook.token': token,
      'inboundWebhook.enabled': true,
      status: 'published'
    }).setOptions({ skipOrgScope: true })

    if (!workflow) {
      await logDelivery({ ok: false, statusCode: 404, error: 'Webhook not found', code: 'WEBHOOK_NOT_FOUND', ip })
      return sendError(res, 'Webhook not found or workflow is not published', 'WEBHOOK_NOT_FOUND', 404)
    }
    if (!workflow.orgId) {
      return sendError(res, 'Workflow has no organization', 'ORG_MISSING', 500)
    }
    if (!workflow.createdBy) {
      return sendError(res, 'Workflow has no owner to attribute the run to', 'OWNER_MISSING', 500)
    }

    // Licence + submission allowance. An inbound webhook has no NetFlow user, so
    // the gates that middleware/auth applies elsewhere are called here — this is
    // the highest-volume way into the product and therefore the one that most
    // needs a ceiling. Both refusals are logged as deliveries so the workflow
    // owner can see why their integration stopped.
    const tenant = await Organization.findById(workflow.orgId).lean()
    const licenceBlock = writeBlockFor(tenant)
    if (licenceBlock) {
      await runWithOrgId(workflow.orgId, () => logDelivery({
        orgId: workflow.orgId,
        workflowId: workflow._id,
        ok: false,
        statusCode: licenceBlock.status,
        error: licenceBlock.error,
        code: licenceBlock.code,
        ip
      }))
      return sendError(res, licenceBlock.error, licenceBlock.code, licenceBlock.status, licenceBlock.extra)
    }
    const overQuota = await checkQuota(tenant, 'submissions')
    if (overQuota) {
      await runWithOrgId(workflow.orgId, () => logDelivery({
        orgId: workflow.orgId,
        workflowId: workflow._id,
        ok: false,
        statusCode: overQuota.status,
        error: overQuota.error,
        code: overQuota.code,
        ip
      }))
      return sendError(res, overQuota.error, overQuota.code, overQuota.status, overQuota.extra)
    }

    const hasSignature = Boolean(req.get('x-netflow-signature') || req.get('X-NetFlow-Signature'))
    const sig = verifyWebhookSignature(req, workflow.inboundWebhook)
    if (!sig.ok) {
      await runWithOrgId(workflow.orgId, () => logDelivery({
        orgId: workflow.orgId,
        workflowId: workflow._id,
        ok: false,
        statusCode: sig.status || 401,
        error: sig.reason,
        code: 'WEBHOOK_SIGNATURE_INVALID',
        ip,
        hasSignature
      }))
      return sendError(res, sig.reason, 'WEBHOOK_SIGNATURE_INVALID', sig.status || 401)
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const formData = (body.formData && typeof body.formData === 'object' && !Array.isArray(body.formData))
      ? body.formData
      : Object.fromEntries(
        Object.entries(body).filter(([k]) => !['submitter', 'formData', 'variables'].includes(k))
      )

    if (Object.keys(formData).length > MAX_FORM_KEYS) {
      return sendError(res, 'Too many fields in payload', 'PAYLOAD_TOO_COMPLEX', 400)
    }

    const contract = validateExpectedFields(workflow.inboundWebhook?.expectedFields, formData)
    if (!contract.ok) {
      await runWithOrgId(workflow.orgId, () => logDelivery({
        orgId: workflow.orgId,
        workflowId: workflow._id,
        ok: false,
        statusCode: 400,
        error: contract.reason,
        code: 'CONTRACT_INVALID',
        ip,
        hasSignature,
        payloadKeys: Object.keys(formData)
      }))
      return sendError(res, contract.reason, 'CONTRACT_INVALID', 400)
    }

    const submitterIn = body.submitter && typeof body.submitter === 'object' ? body.submitter : {}
    const submitter = {
      name: String(
        submitterIn.name || formData.name || formData.fullName || formData.supplier || ''
      ).trim() || 'External submitter',
      email: String(submitterIn.email || formData.email || '').trim(),
      source: 'webhook'
    }

    const idemKey = idempotencyKeyOf(req)

    const runStart = async () => {
      if (idemKey) {
        const existing = await WebhookIdempotency.findOne({
          orgId: workflow.orgId,
          workflowId: workflow._id,
          key: idemKey
        }).setOptions({ skipOrgScope: true }).lean()
        if (existing) {
          const prev = await WorkflowExecution.findById(existing.executionId)
            .select('statusToken')
            .setOptions({ skipOrgScope: true })
            .lean()
          return {
            replay: true,
            executionId: existing.executionId,
            status: 'deduped',
            workflowId: workflow._id,
            workflowTitle: workflow.title,
            statusToken: prev?.statusToken || null,
            statusUrl: statusUrlFor(prev?.statusToken)
          }
        }
      }

      const extraVariables = {
        formData,
        submitter,
        source: 'webhook',
        ...(body.variables && typeof body.variables === 'object' ? body.variables : {})
      }

      const execution = await runWithOrgId(workflow.orgId, () =>
        triggerWorkflow(workflow._id, null, workflow.createdBy, extraVariables)
      )

      // Counted here rather than for every request so a deduped replay of the
      // same idempotency key is not billed twice.
      await meterSubmission(workflow.orgId)

      if (idemKey) {
        try {
          await runWithOrgId(workflow.orgId, () =>
            WebhookIdempotency.create({
              orgId: workflow.orgId,
              workflowId: workflow._id,
              key: idemKey,
              executionId: execution._id
            })
          )
        } catch (err) {
          if (err && err.code === 11000) {
            const won = await WebhookIdempotency.findOne({
              orgId: workflow.orgId,
              workflowId: workflow._id,
              key: idemKey
            }).setOptions({ skipOrgScope: true }).lean()
            if (won) {
              const prev = await WorkflowExecution.findById(won.executionId)
                .select('statusToken')
                .setOptions({ skipOrgScope: true })
                .lean()
              return {
                replay: true,
                executionId: won.executionId,
                status: 'deduped',
                workflowId: workflow._id,
                workflowTitle: workflow.title,
                statusToken: prev?.statusToken || null,
                statusUrl: statusUrlFor(prev?.statusToken)
              }
            }
          }
          throw err
        }
      }

      await runWithOrgId(workflow.orgId, () =>
        writeAuditLog({
          action: 'webhook_received',
          performedBy: workflow.createdBy,
          targetEntity: `Workflow: ${workflow.title}`,
          detail: `External webhook from ${submitter.name}${submitter.email ? ` <${submitter.email}>` : ''}`,
          metadata: {
            workflowId: String(workflow._id),
            executionId: String(execution._id),
            idempotencyKey: idemKey || null,
            missingIdempotencyKey: !idemKey,
            source: 'webhook'
          }
        })
      )

      return {
        replay: false,
        executionId: execution._id,
        status: execution.status,
        workflowId: workflow._id,
        workflowTitle: workflow.title,
        statusToken: execution.statusToken || null,
        statusUrl: statusUrlFor(execution.statusToken)
      }
    }

    const result = await runWithOrgId(workflow.orgId, () => require('../database/postgres').transaction(async client => {
      if (idemKey) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`webhook:${workflow.orgId}:${workflow._id}:${idemKey}`])
      return runStart()
    }))
    await runWithOrgId(workflow.orgId, () => logDelivery({
      orgId: workflow.orgId,
      workflowId: workflow._id,
      executionId: result.executionId,
      ok: true,
      statusCode: result.replay ? 200 : 201,
      ip,
      hasSignature,
      payloadKeys: Object.keys(formData),
      idempotencyKey: idemKey || undefined,
      replay: !!result.replay
    }))
    return sendSuccess(res, result, result.replay ? 200 : 201)
  } catch (err) {
    if (workflow?.orgId) {
      await runWithOrgId(workflow.orgId, () => logDelivery({
        orgId: workflow.orgId,
        workflowId: workflow._id,
        ok: false,
        statusCode: 500,
        error: err.message,
        code: 'HOOK_ERROR',
        ip
      }))
    }
    next(err)
  }
})

module.exports = router
