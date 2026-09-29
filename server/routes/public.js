// Public (unauthenticated) form access.
// Lets non-users fill a shared form via an unguessable token link, like Google
// Forms. Submissions are stored as FormResponse with source 'public'. No auth,
// no workflow trigger — pure data collection.

const express = require('express')
const fs = require('fs')
const multer = require('multer')
const { newId } = require('../database/ids')

const Form = require('../models/Form')
const FormResponse = require('../models/FormResponse')
const Organization = require('../models/Organization')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { isFieldVisible } = require('../utils/conditionalLogic')
const dms = require('../services/dmsClient')
const { validateField } = require('../utils/validation')
const { checkQuota, checkStorage } = require('../middleware/quota')
const { writeBlockFor } = require('../middleware/licence')
const {
  prepareExtractionAttachment,
  markExtractionConsumed,
  releaseExtractionClaim
} = require('../services/extractionProcessor')
const { policyFor } = require('../utils/pdfAutoFillPolicy')

const { meterSubmission, addStorage } = require('../utils/usageMeter')
const { dirForOrg, safeFilename } = require('../utils/fileStore')
const s3Client = require('../services/s3Client')

const documentAccess = require('../utils/documentAccess')
const router = express.Router()
router.use('/forms/:token', require('../database/fresh/resources').route('public_form', req => req.params.token))

// The public routes run without `protect`, so the licence/quota gates that
// middleware/auth applies to everyone else have to be called explicitly here.
// A public link is still the tenant's capacity being consumed — by strangers,
// which makes it the easiest limit to blow through.
const tenantOf = (form) => (form?.orgId ? Organization.findById(form.orgId).lean() : Promise.resolve(null))

const gateTenant = async (res, org, resource) => {
  if (!org) return false
  const blocked = writeBlockFor(org)
  if (blocked) {
    sendError(res, blocked.error, blocked.code, blocked.status, blocked.extra)
    return true
  }
  if (resource) {
    const overQuota = await checkQuota(org, resource)
    if (overQuota) {
      // Deliberately vague to an anonymous submitter: they cannot fix a plan
      // limit and should not learn the tenant's licence details.
      sendError(res, 'This form is not accepting submissions right now. Please contact the form owner.',
        'LIMIT_REACHED', 403, { resource })
      return true
    }
  }
  return false
}

// GET /api/public/org?subdomain=acme
// Pre-login tenant lookup for the login page: which org lives on this
// subdomain? Returns only non-sensitive fields (name + status), so the page
// can show "Sign in to Acme" or a friendly suspended/unknown message.
router.get('/org', async (req, res, next) => {
  try {
    const subdomain = String(req.query.subdomain || '').toLowerCase().trim()
    if (!subdomain) return sendError(res, 'subdomain is required', 'MISSING_SUBDOMAIN', 400)

    const org = await Organization.findOne({ subdomain }).select('name subdomain status').lean()
    if (!org) return sendError(res, 'No organization on this subdomain', 'ORG_NOT_FOUND', 404)

    return sendSuccess(res, { org: { name: org.name, subdomain: org.subdomain, status: org.status } })
  } catch (err) {
    next(err)
  }
})

// --- naive per-IP rate limit (in-memory; fine for a single instance) --------
const hits = new Map()
const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = 30
const rateLimit = (req, res, next) => {
  const ip = req.ip || 'unknown'
  const now = Date.now()
  const rec = hits.get(ip) || { count: 0, reset: now + WINDOW_MS }
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS }
  rec.count += 1
  hits.set(ip, rec)
  if (rec.count > MAX_PER_WINDOW) {
    return sendError(res, 'Too many requests. Please slow down.', 'RATE_LIMITED', 429)
  }
  next()
}

// Only serve forms that are explicitly public AND published.
const findPublicForm = (token) => {
  if (!token) return null
  return Form.findOne({
    'public.token': token,
    'public.enabled': true,
    status: 'published'
  }).lean()
}

// Type-aware "is this required field empty?" — mirrors the client validation so
// a direct API call can't bypass required checkboxes/grids.
const fieldEmpty = (field, v) => {
  if (field.type === 'checkbox') return !v
  if (field.type === 'grid') return !Array.isArray(v) || v.length === 0
  if (field.type === 'signature') {
    if (v === undefined || v === null || v === '') return true
    if (typeof v === 'object') return !(v.text || v.url)
    return !String(v).trim()
  }
  if (field.type === 'file') {
    if (v === undefined || v === null || v === '') return true
    if (typeof v === 'object') return !v.url
    return false
  }
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

// GET /api/public/forms/:token — fetch the public form definition.
router.get('/forms/:token', async (req, res, next) => {
  try {
    const form = await findPublicForm(req.params.token)
    if (!form) return sendError(res, 'This form is not available.', 'FORM_NOT_FOUND', 404)
    const org = await tenantOf(form)
    const pdfPolicy = policyFor(org, 'public')
    // Expose only what the renderer needs — never createdBy, department, etc.
    return sendSuccess(res, {
      form: {
        title: form.title,
        description: form.description || '',
        fields: form.fields || [],
        autoFill: {
          enabled: pdfPolicy.enabled,
          languageMode: pdfPolicy.languageMode
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/public/forms/:token/submit — store an anonymous submission.
router.post('/forms/:token/submit', rateLimit, async (req, res, next) => {
  try {
    const form = await findPublicForm(req.params.token)
    if (!form) return sendError(res, 'This form is not available.', 'FORM_NOT_FOUND', 404)

    const org = await tenantOf(form)
    if (await gateTenant(res, org, 'submissions')) return

    const { formData, submitter, extraction } = req.body || {}
    if (!formData || typeof formData !== 'object') {
      return sendError(res, 'formData object is required', 'MISSING_FORM_DATA', 400)
    }

    await documentAccess.validateInputs(formData, null, form.orgId)
    const missing = (form.fields || [])
      .filter((f) => f.required && isFieldVisible(f, formData) && fieldEmpty(f, formData[f.id]))
      .map((f) => f.label || f.id)
    if (missing.length > 0) {
      return sendError(
        res,
        `Missing required field(s): ${missing.join(', ')}`,
        'REQUIRED_FIELDS_MISSING',
        400
      )
    }

    // Advanced validation (length / range / format) on visible, filled fields.
    for (const f of form.fields || []) {
      if (!isFieldVisible(f, formData)) continue
      const err = validateField(f, formData[f.id])
      if (err) return sendError(res, err, 'FIELD_INVALID', 400)
    }


    const preparedExtraction = await prepareExtractionAttachment({
      extraction,
      formId: form._id,
      org,
      requesterId: null,
      audience: 'public'
    })
    const attachmentRows = []
    for (const field of form.fields || []) {
      if (field.type !== 'file') continue
      const value = formData[field.id]
      if (value && typeof value === 'object' && (value.dmsDocId || value.url || value.s3Key)) {
        attachmentRows.push({
          kind: 'form_upload',
          filename: value.name || field.label || 'file',
          path: value.url || (value.s3Key ? '/api/s3/download?key=' + encodeURIComponent(value.s3Key) : ''),
          mimetype: value.mime || '',
          size: value.size || 0,
          dmsDocId: value.dmsDocId ? String(value.dmsDocId) : null,
          s3Key: value.s3Key ? String(value.s3Key) : null,
          provisionalId: value.provisionalId ? String(value.provisionalId) : null
        })
      }
    }
    if (preparedExtraction) attachmentRows.push(preparedExtraction.attachment)

    const reservedResponseId = preparedExtraction ? newId() : undefined
    if (preparedExtraction) await markExtractionConsumed(preparedExtraction.job._id, reservedResponseId)

    const formResponse = await FormResponse.create({
      // Public path has no tenant context — inherit the org from the form.
      orgId: form.orgId,
      ...(reservedResponseId ? { _id: reservedResponseId } : {}),
      formId: form._id,
      submittedBy: null,
      submittedByExternal: {
        name: (submitter?.name || '').trim(),
        email: (submitter?.email || '').trim()
      },
      source: 'public',
      formData,
      status: 'submitted',
      attachments: attachmentRows
    }).catch(async (error) => {
      if (preparedExtraction) {
        await releaseExtractionClaim(preparedExtraction.job._id, reservedResponseId).catch(() => {})
      }
      throw error
    })

    await meterSubmission(form.orgId)

    // Best-effort DMS audit/link - never block submit.
    try {
      const { collectDmsDocIds, emitWorkflowEvents } = require('../utils/dmsAttachments')
      const dmsDocIds = collectDmsDocIds(null, formResponse)
      if (dmsDocIds.length > 0) {
        await emitWorkflowEvents(dmsDocIds, {
          type: 'workflow.submitted',
          actor: { name: submitter?.name || 'Public User', email: submitter?.email },
          detail: `Public submission of "${form.title}"`,
          meta: { formResponseId: String(formResponse._id) },
          org
        })
      }
    } catch (err) {
      console.warn('[public.js] dms link failed:', err.message)
    }

    // No workflow trigger by design — this is pure data collection.
    return sendSuccess(res, { formResponseId: formResponse._id }, 201)
  } catch (err) {
    next(err)
  }
})

// --- token-gated file upload for public forms with file fields --------------
// Anonymous uploads still land in the owning tenant's folder, so they count
// against that tenant's storage and are served with the same access check as
// everything else (utils/fileStore). The org comes from the form behind the
// token, which is resolved before multer runs.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      cb(null, dirForOrg(req.publicOrgId))
    } catch (err) {
      cb(err)
    }
  },
  filename: (req, file, cb) => cb(null, safeFilename(file.originalname))
})

const MAX_CEILING_MB = 25

// POST /api/public/forms/:token/upload  (multipart, field "file")
router.post('/forms/:token/upload', rateLimit, async (req, res, next) => {
  try {
    const form = await findPublicForm(req.params.token)
    if (!form) return sendError(res, 'This form is not available.', 'FORM_NOT_FOUND', 404)

    const org = await tenantOf(form)
    if (await gateTenant(res, org)) return
    req.publicOrgId = form.orgId

    const reqMb = Math.min(
      Math.max(parseInt(req.query.maxMb, 10) || MAX_CEILING_MB, 1),
      MAX_CEILING_MB
    )
    const upload = multer({ storage, limits: { fileSize: reqMb * 1024 * 1024 } })
    upload.single('file')(req, res, async (err) => {
      if (err) {
        const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED'
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? `File too large. Max ${reqMb} MB.`
          : (err.message || 'Upload failed')
        return sendError(res, msg, code, 400)
      }
      if (!req.file) return sendError(res, 'No file provided', 'NO_FILE', 400)

      // ── DMS path (quota tracked — NetFlow meters DMS storage too) ─────────
      if (!s3Client.isEnabled(org) && dms.isConfiguredFor(org)) {
        // Multer has already written the temp file; check quota before accepting.
        const room = await checkStorage(org, req.file.size)
        if (!room.ok) {
          fs.promises.unlink(req.file.path).catch(() => {})
          return sendError(res, 'This form is not accepting attachments right now. Please contact the form owner.',
            'LIMIT_REACHED', 403, { resource: room.extra?.resource || 'storage' })
        }

        const provisionalId = require('crypto').randomBytes(12).toString('hex')
        try {
          const doc = await dms.uploadFile({
            filePath: req.file.path,
            filename: req.file.originalname,
            mime: req.file.mimetype,
            org: org,
            ref: { id: provisionalId }
          })

          await fs.promises.unlink(req.file.path).catch(() => {})
          await documentAccess.grant('dms:' + doc.id, form.orgId, null)
          await addStorage(form.orgId, req.file.size)

          return sendSuccess(res, {
            file: {
              name: req.file.originalname,
              url: doc.url || null,
              mime: req.file.mimetype,
              size: req.file.size,
              dmsDocId: doc.id,
                uploadToken: await documentAccess.issue('dms:' + doc.id, form.orgId, 'upload'),
              provisionalId,
            }
          }, 201)
        } catch (dmsErr) {
          await fs.promises.unlink(req.file.path).catch(() => {})
          return sendError(res, 'Document service failed to accept the file.', 'DMS_ERROR', 502)
        }
      }

      // ── S3 path (no quota tracking — org manages their own bucket) ─────────
      if (s3Client.isEnabled(org)) {
        const s3Key = `${form.orgId}/${req.file.filename}`
        try {
          const fileBuffer = await fs.promises.readFile(req.file.path)
          await s3Client.uploadFile(org, s3Key, fileBuffer, req.file.mimetype)
            await documentAccess.grant('s3:' + s3Key, form.orgId, null)
          await fs.promises.unlink(req.file.path).catch(() => {})

          return sendSuccess(res, {
            file: {
              name: req.file.originalname,
              s3Key,
                uploadToken: await documentAccess.issue('s3:' + s3Key, form.orgId, 'upload'),
              mime: req.file.mimetype,
              size: req.file.size
            }
          }, 201)
        } catch (s3Err) {
          await fs.promises.unlink(req.file.path).catch(() => {})
          console.error('[s3] public upload failed:', s3Err.message)
          return sendError(res, 'S3 upload failed. Please try again or contact the form owner.', 'S3_UPLOAD_FAILED', 502)
        }
      }

      // ── Local disk path (quota tracked) ────────────────────────────────────
      // Multer has already written the file, so an over-quota upload has to be
      // deleted rather than merely refused — otherwise the disk fills with bytes
      // the tenant was never allowed to store. No buffer here: an anonymous
      // upload is never the thing unblocking an approval.
      const room = await checkStorage(org, req.file.size)
      if (!room.ok) {
        fs.promises.unlink(req.file.path).catch(() => {})
        return sendError(res, 'This form is not accepting attachments right now. Please contact the form owner.',
          'LIMIT_REACHED', 403, { resource: room.extra?.resource || 'storage' })
      }

      await documentAccess.grant(`${form.orgId}/${req.file.filename}`, form.orgId, null)
        await addStorage(form.orgId, req.file.size)

      return sendSuccess(res, {
        file: {
          name: req.file.originalname,
          url: `/api/files/${form.orgId}/${req.file.filename}?k=${await documentAccess.issue(`${form.orgId}/${req.file.filename}`, form.orgId)}`,
            uploadToken: await documentAccess.issue(`${form.orgId}/${req.file.filename}`, form.orgId, 'upload'),
          mime: req.file.mimetype,
          size: req.file.size
        }
      }, 201)
    })
  } catch (err) {
    next(err)
  }
})

module.exports = require('../database/layout').organizationSchemas()
  ? require('../database/atomicRoutes').atomicRoutes(router, { paths: ['/forms/:token/submit'] })
  : router
