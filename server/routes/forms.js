// M1 - Phase 2 - routes/forms.js
// Form CRUD + publish + submit. Submit triggers the linked workflow (if any)
// via M2's workflowEngine.

const express = require('express')
const crypto = require('crypto')
const { newId } = require('../database/ids')

const Form = require('../models/Form')
const FormResponse = require('../models/FormResponse')
const FormDraft = require('../models/FormDraft')
const Workflow = require('../models/Workflow')
const User = require('../models/User')
const { protect } = require('../middleware/auth')
const { requirePermission } = require('../middleware/capabilityGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { writeAuditLog } = require('../utils/writeAuditLog')
const { isConfigured: llmConfigured, getModel: llmModel, generateJSON, generateText } = require('../utils/llm')
const { isFieldVisible } = require('../utils/conditionalLogic')
const { validateField } = require('../utils/validation')
const { requireQuota, requireCanBuild, hasBuilderAccess, checkQuota, respond } = require('../middleware/quota')
const { meterSubmission } = require('../utils/usageMeter')
const { releaseFor } = require('../utils/fileGc')
const { refreshResponseAttachments, refreshFormDataUrls } = require('../utils/dmsAttachments')
const { asStr, sanitizeAiFields } = require('../utils/formDraftSchema')
const { policyFor } = require('../utils/pdfAutoFillPolicy')
const {
  prepareExtractionAttachment,
  markExtractionConsumed,
  releaseExtractionClaim
} = require('../services/extractionProcessor')
const { recordSubmissionFeedback } = require('../services/pdfAutoFillLearning')

const { linkedFormMatch, linkedFormsMatchAny } = require('../utils/linkedForms')

const router = express.Router()
const validateDocuments = async (req, res, next) => {
  try { await require('../utils/documentAccess').validateInputs(req.body, req.user, req.orgId); next() } catch (error) { next(error) }
}

// Builder access is a licensed per-user entitlement. Everyone else only sees
// published forms they are allowed to submit.
const isBuilder = hasBuilderAccess
const requireFormManager = (req, res, next) => isBuilder(req.user)
  ? next()
  : sendError(res, 'You do not have access to manage forms', 'FORBIDDEN', 403)
const formWithAutoFillPolicy = (form, organization) => {
  const value = typeof form?.toObject === 'function' ? form.toObject() : { ...form }
  const policy = policyFor(organization, 'authenticated')
  value.autoFill = { enabled: policy.enabled, languageMode: policy.languageMode }
  return value
}

// A "manager" for the "Managers only" submit rule = a people-manager: someone
// with a manager-ish role OR at least one direct report.
const userIsManager = async (user) => {
  if (hasCapability(user, 'decide_tasks')) return true
  return !!(await User.exists({ managerId: user._id }))
}

// Can this user SEE a form, given its linked workflow's access config?
//   company     → everyone
//   departments → only the listed departments
//   people      → only the listed users (access.visibleTo)
// Back-compat: workflows saved before the visibility field infer it from departments.
const canSeeWorkflowForm = (access, user) => {
  if (!access) return true
  let vis = access.visibility
  if (!vis) vis = (access.departments || []).length ? 'departments' : 'company'
  if (vis === 'departments') {
    const depts = access.departments || []
    return depts.length === 0 || depts.includes(user.department)
  }
  if (vis === 'people') {
    const people = (access.visibleTo || []).map(String)
    return people.length === 0 || people.includes(String(user._id))
  }
  return true
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- AI Form Builder helpers ----------
// System prompt pins Gemini to the exact field schema the builder understands.
// Note: long/paragraph answers are `text` + `multiline:true` (there is no
// separate "textarea" type in the builder UI).
const AI_FORM_SYSTEM = `You are a form-design assistant for a workflow app.
Given a plain-English description, output a JSON object ONLY (no prose, no markdown):
{ "title": string, "description": string, "fields": Field[] }

Field = {
  "type": "text" | "dropdown" | "date" | "file" | "checkbox" | "signature" | "number" | "radio" | "grid",
  "label": string,
  "required": boolean,
  // type-specific (include ONLY when relevant):
  "placeholder"?: string,        // text, number, dropdown
  "multiline"?: boolean,         // text only — true for long/paragraph answers
  "options"?: string[],          // dropdown, radio (2+ options)
  "fileTypes"?: string,          // file, e.g. "PDF / DOCX"
  "maxSize"?: number,            // file, in MB (1-50)
  "columns"?: { "label": string, "type": "text"|"number"|"date"|"dropdown", "options"?: string[] }[], // grid only
  "page"?: number                // pagination: page number (1, 2, etc.)
}

Rules:
- Use "text" with "multiline": true for paragraph/long answers (e.g. reason, comments). There is no "textarea" type.
- For email/phone/short answers use "type": "text".
- IMPORTANT: Use "type": "number" for any costs, amounts, quantities, or numeric identifiers (e.g., Aadhar Number, SSN).
- dropdown and radio MUST include a non-empty "options" array.
- grid MUST include a non-empty "columns" array.
- Keep it concise: at most 15 fields. Choose sensible "required" flags.
- Support pagination by setting "page" (starting at 1) if the prompt specifically asks to add pages or split the form.
- Return JSON only.`

// GET /api/forms
router.get('/', protect, async (req, res, next) => {
  try {
    const { status, department, search } = req.query
    const query = {}
    if (status) query.status = status
    if (department) query.department = department
    if (search) {
      const regex = new RegExp(escapeRegex(String(search).trim()), 'i')
      query.$or = [{ title: regex }, { description: regex }]
    }

    if (!isBuilder(req.user)) query.status = 'published'

    const forms = await Form.find(query)
      .populate('createdBy', 'name email')
      .sort({ updatedAt: -1 })
      .lean()

    // Visibility: non-builders only see forms their linked published workflow
    // makes visible to them (company-wide / their department / them specifically).
    // Forms with no linked workflow stay visible to everyone.
    let visible = forms
    if (!isBuilder(req.user) && forms.length) {
      const formIds = forms.map((f) => f._id)
      const wfs = await Workflow.find({
        ...linkedFormsMatchAny(formIds),
        status: 'published'
      }).select('linkedFormId linkedFormIds access').lean()
      const accessByForm = new Map()
      for (const w of wfs) {
        if (!w.access) continue
        const ids = new Set([
          ...(w.linkedFormIds || []).map(String),
          ...(w.linkedFormId ? [String(w.linkedFormId)] : []),
        ])
        for (const id of ids) accessByForm.set(id, w.access)
      }
      visible = forms.filter((f) =>
        canSeeWorkflowForm(accessByForm.get(String(f._id)), req.user)
      )
    }

    // Attach a real submission count per form so the list can display it.
    if (visible.length) {
      const counts = await FormResponse.aggregate([
        { $match: { formId: { $in: visible.map((f) => f._id) } } },
        { $group: { _id: '$formId', n: { $sum: 1 } } }
      ])
      const countMap = new Map(counts.map((c) => [String(c._id), c.n]))
      visible.forEach((f) => { f.submissions = countMap.get(String(f._id)) || 0 })
    }
    const pdfPolicy = policyFor(req.organization, 'authenticated')
    visible.forEach((form) => {
      form.autoFill = {
        enabled: pdfPolicy.enabled,
        languageMode: pdfPolicy.languageMode
      }
    })

    return sendSuccess(res, { count: visible.length, forms: visible })
  } catch (err) {
    next(err)
  }
})

// GET /api/forms/ai-status — is an LLM key configured? (drives UI visibility)
// MUST be registered before GET /:id so it isn't captured as an id.
router.get('/ai-status', protect, (req, res) => {
  const pdfPolicy = policyFor(req.organization, 'authenticated')
  return sendSuccess(res, {
    aiConfigured: llmConfigured(),
    model: llmModel(),
    pdfAutoFillAvailable: pdfPolicy.enabled,
    pdfAutoFill: pdfPolicy
  })
})

// POST /api/forms/ai-draft — turn a plain-English description into form fields.
// Builder-only. Returns a draft { title, description, fields } the client merges
// into the builder; it does NOT persist anything.
router.post('/ai-draft', protect, validateDocuments, requireCanBuild, async (req, res, next) => {
  try {
    const prompt = asStr(req.body?.prompt, 2000)
    if (!prompt) return sendError(res, 'Describe the form you want to generate.', 'MISSING_PROMPT', 400)
    if (!llmConfigured()) return sendError(res, 'AI is not configured on the server.', 'AI_DISABLED', 503)

    let out
    try {
      out = await generateJSON(`Design a form for this request: ${prompt}`, {
        system: AI_FORM_SYSTEM,
        temperature: 0.3
      })
    } catch (err) {
      console.error('ai-draft LLM error:', err.message)
      return sendError(res, 'The AI service failed to respond. Please try again.', 'AI_ERROR', 502)
    }

    const fields = sanitizeAiFields(out?.fields)
    if (!fields.length) {
      return sendError(res, 'The AI did not return usable fields. Try rephrasing your description.', 'AI_EMPTY', 422)
    }

    return sendSuccess(res, {
      title: asStr(out?.title, 120),
      description: asStr(out?.description, 500),
      fields,
      model: llmModel()
    })
  } catch (err) {
    next(err)
  }
})

// IDE-style ghost text (VS Code / Cursor): next few tokens only, not a sentence.
const AI_SUGGEST_SYSTEM = `You are inline autocomplete for a form-builder prompt (same feel as VS Code / Cursor ghost text).

The user is typing what form to generate. Reply with ONLY the suffix they would type next.

Hard rules:
- Output ONLY the continuation. Never repeat their text. No quotes, labels, markdown, or explanations.
- Prefer 1–4 words (hard max 5). Never a full sentence. Never end with . ! ?
- If they are mid-word, finish THAT word first (e.g. "employ" → "ee", "reimbur" → "sement").
- Continue the current phrase. Do not invent a long field list unless they already asked for fields.
- Prefer form-building words: request, dates, reason, amount, attachment, signature, approval.
- If the phrase already feels complete, return an empty string.

Examples (input → output):
- "Leave request form with" → " dates and reason"
- "expense reimb" → "ursement with receipts"
- "employee onboarding" → " checklist"
- "IT access request form" → ""`

// Remove any leading overlap so we never repeat words the user already typed
// (models sometimes echo the tail of the prompt).
const trimOverlap = (typed, completion) => {
  let c = completion
  const tail = typed.slice(-40).toLowerCase()
  const cl = c.toLowerCase()
  for (let n = Math.min(tail.length, cl.length); n > 0; n--) {
    if (tail.slice(-n) === cl.slice(0, n)) { c = c.slice(n); break }
  }
  return c
}

// Clamp model output to IDE-like ghost text: short, mid-word aware.
const normalizeSuggest = (typed, raw) => {
  let completion = String(raw || '')
    .replace(/^["'`\s]+|["'`]+$/g, '')
    .replace(/\s*\n[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
  completion = trimOverlap(typed, completion)
  completion = completion.replace(/[.!?…]+$/g, '').replace(/^[:\-~]+\s*/, '')

  const midWord = typed.length > 0 && !/\s$/.test(typed)
  if (midWord) {
    completion = completion.replace(/^\s+/, '')
    const partial = (typed.match(/[A-Za-z0-9'_-]+$/) || [''])[0]
    if (partial && completion.toLowerCase().startsWith(partial.toLowerCase())) {
      completion = completion.slice(partial.length)
    }
  } else if (completion && !completion.startsWith(' ')) {
    completion = ' ' + completion
  }

  const lead = completion.startsWith(' ') ? ' ' : ''
  const words = completion.trim().split(/\s+/).filter(Boolean).slice(0, 4)
  if (!words.length) return ''
  return (lead + words.join(' ')).slice(0, 42).trimEnd()
}

// POST /api/forms/ai-suggest — ghost-text autocomplete for the AI prompt box.
// Builder-only. Returns only the suffix to append. Never throws to the client:
// on any failure it returns an empty suggestion so typing is never disrupted.
router.post('/ai-suggest', protect, validateDocuments, requireCanBuild, async (req, res) => {
  try {
    const prompt = asStr(req.body?.prompt, 300)
    if (!llmConfigured() || prompt.length < 3) return sendSuccess(res, { completion: '' })

    let raw = ''
    try {
      raw = await generateText(
        `Typed so far:\n${prompt}\n\nGhost continuation (next 1-4 words only):`,
        {
          system: AI_SUGGEST_SYSTEM,
          temperature: 0.1,
          maxTokens: 16,
          timeoutMs: 4000
        }
      )
    } catch (err) {
      return sendSuccess(res, { completion: '' })
    }

    return sendSuccess(res, { completion: normalizeSuggest(prompt, raw) })
  } catch (err) {
    return sendSuccess(res, { completion: '' })
  }
})

// GET /api/forms/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean()
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)

    // Hide draft / archived forms from non-admins
    if (!isBuilder(req.user) && form.status !== 'published') {
      return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
    }

    // Visibility: block direct-URL access for non-builders the linked published
    // workflow doesn't make visible to them.
    if (!isBuilder(req.user)) {
      const wf = await Workflow.findOne({
        ...linkedFormMatch(form._id),
        status: 'published'
      }).select('access').lean()
      if (wf && !canSeeWorkflowForm(wf.access, req.user)) {
        return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
      }
    }

    const pdfPolicy = policyFor(req.organization, 'authenticated')
    form.autoFill = {
      enabled: pdfPolicy.enabled,
      languageMode: pdfPolicy.languageMode
    }
    return sendSuccess(res, { form })
  } catch (err) {
    next(err)
  }
})

// POST /api/forms/:id/approval-preview — resolve the real, currently applicable
// approval route without creating a response, execution, task, notification, or
// audit event. Conditions are evaluated against the answers supplied so far.
router.post('/:id/approval-preview', protect, validateDocuments, requirePermission('forms:submit'), async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id).lean()
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
    if (form.status !== 'published') {
      return sendError(res, 'Form is not published', 'FORM_NOT_PUBLISHED', 400)
    }

    const linkedWorkflow = await Workflow.findOne({
      ...linkedFormMatch(form._id),
      status: 'published'
    }).lean()

    if (linkedWorkflow && !isBuilder(req.user) && !canSeeWorkflowForm(linkedWorkflow.access, req.user)) {
      return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
    }

    const formData = req.body?.formData
    if (formData !== undefined && (!formData || typeof formData !== 'object' || Array.isArray(formData))) {
      return sendError(res, 'formData must be an object', 'INVALID_FORM_DATA', 400)
    }

    if (!linkedWorkflow) {
      return sendSuccess(res, {
        approvalRoute: {
          linked: false,
          workflowTitle: null,
          automatic: false,
          confirmation: 'confirmed',
          message: 'No published approval workflow is linked to this form.',
          requiredInputs: [],
          issues: [{
            code: 'workflow_unlinked',
            severity: 'warning',
            nodeId: null,
            title: 'No approval workflow linked',
            message: 'This request will be recorded without an automatic approval route.',
          }],
          canSubmit: true,
          stages: [],
          summary: { approvalStages: 0, approvalsRequired: 0, reviewStages: 0 },
        }
      })
    }

    const submitter = await User.findById(req.user._id).populate('role', 'name').lean()
    const { previewApprovalRoute } = require('../utils/workflowEngine')
    const approvalRoute = await previewApprovalRoute({
      workflow: linkedWorkflow,
      form,
      formData: formData || {},
      submitter,
    })

    return sendSuccess(res, { approvalRoute })
  } catch (err) {
    next(err)
  }
})

// POST /api/forms
router.post('/', protect, validateDocuments, requireCanBuild, requireQuota('forms'), async (req, res, next) => {
  try {
    const { title, description, fields, department } = req.body
    if (!title) return sendError(res, 'title is required', 'MISSING_FIELDS', 400)

    const form = await Form.create({
      title,
      description,
      fields: Array.isArray(fields) ? fields : [],
      department,
      status: 'draft',
      createdBy: req.user._id,
      version: 1
    })

    return sendSuccess(res, { form: formWithAutoFillPolicy(form, req.organization) }, 201)
  } catch (err) {
    next(err)
  }
})

// PUT /api/forms/:id
// If the form is published, create a new versioned draft instead of mutating.
router.put('/:id', protect, validateDocuments, requireCanBuild, async (req, res, next) => {
  try {
    const existing = await Form.findById(req.params.id)
    if (!existing) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)

    // Form-level auto-fill is legacy data. Tenant policy now controls every
    // form, so ignore client attempts to mutate that compatibility field.
    const { _id, status, createdBy, autoFill, ...updates } = req.body

    // Always update in place — the edit button is Admin-only and the user
    // explicitly chose to overwrite. The previous versioning branch created a
    // new draft for published forms, which caused duplicates in the list.
    Object.assign(existing, updates)
    await existing.save()
    return sendSuccess(res, { form: formWithAutoFillPolicy(existing, req.organization), versioned: false })
  } catch (err) {
    next(err)
  }
})

// POST /api/forms/:id/archive  (soft "unpublish" — keeps the form in the DB)
router.post('/:id/archive', protect, validateDocuments, requireCanBuild, async (req, res, next) => {
  try {
    const form = await Form.findByIdAndUpdate(
      req.params.id,
      { status: 'archived' },
      { returnDocument: 'after' }
    )
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
    return sendSuccess(res, { message: 'Form archived', form: formWithAutoFillPolicy(form, req.organization) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/forms/:id  (HARD delete — removes the form AND its submissions)
router.delete('/:id', protect, requireCanBuild, async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id)
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
    if (require('../database/layout').organizationSchemas() && await require('../models/DocumentExtractionJob').exists({ formId: form._id })) {
      return sendError(res, 'Archive this form while its document processing records are retained. Permanent deletion is available after their scheduled cleanup.', 'FORM_DOCUMENTS_RETAINED', 409)
    }

    // Read the submissions before they go, so their attachments can be deleted
    // from disk and the storage meter credited back.
    const docs = await FormResponse.find({ formId: form._id }).select('formData attachments').lean()
    const responses = await FormResponse.deleteMany({ formId: form._id })
    await form.deleteOne()
    const freed = await releaseFor(req.orgId, { responses: docs })

    writeAuditLog({
      action: 'form_deleted',
      performedBy: req.user._id,
      targetEntity: `Form: ${form.title}`,
      department: form.department,
      ipAddress: req.ip,
      detail: `${req.user.name} permanently deleted form "${form.title}" (${responses.deletedCount} submission(s) removed)`,
      metadata: { formId: String(form._id), responsesDeleted: responses.deletedCount, filesDeleted: freed.files }
    })

    return sendSuccess(res, {
      message: 'Form deleted',
      deleted: { form: 1, responses: responses.deletedCount, files: freed.files }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/forms/:id/publish
router.post('/:id/publish', protect, validateDocuments, requireCanBuild, async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id)
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)

    form.status = 'published'
    await form.save()
    return sendSuccess(res, { form: formWithAutoFillPolicy(form, req.organization) })
  } catch (err) {
    next(err)
  }
})

// POST /api/forms/:id/public   { enabled: boolean }
// Enable/disable a public share link. Generates an unguessable token on first
// enable and returns the updated form so the UI can build the link.
router.post('/:id/public', protect, validateDocuments, requireCanBuild, async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id)
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)

    const enabled = req.body?.enabled !== false
    const token = form.public?.token || crypto.randomBytes(24).toString('hex')
    form.public = { enabled, token }
    await form.save()

    return sendSuccess(res, { form: formWithAutoFillPolicy(form, req.organization) })
  } catch (err) {
    next(err)
  }
})

// GET /api/forms/:id/responses — builder-only list of submissions for a form.
router.get('/:id/responses', protect, requireFormManager, async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id).lean()
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)

    const responses = await FormResponse.find({ formId: form._id })
      .populate('submittedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean()
    for (const response of responses) {
      response.formData = await refreshFormDataUrls(response.formData, { org: req.organization, user: req.user })
      response.attachments = await refreshResponseAttachments(response.attachments, { org: req.organization, user: req.user })
    }

    return sendSuccess(res, {
      form: { _id: form._id, title: form.title, fields: form.fields || [] },
      count: responses.length,
      responses
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/forms/:id/draft — the caller's saved draft for this form (or null).
router.get('/:id/draft', protect, requirePermission('forms:submit'), async (req, res, next) => {
  try {
    const draft = await FormDraft.findOne({ formId: req.params.id, userId: req.user._id })
      .select('formData updatedAt')
      .lean()
    return sendSuccess(res, {
      draft: draft ? { formData: draft.formData || {}, updatedAt: draft.updatedAt } : null
    })
  } catch (err) {
    next(err)
  }
})

// PUT /api/forms/:id/draft — save/overwrite the caller's draft. Intentionally
// NO required-field or advanced validation: a draft is allowed to be partial.
router.put('/:id/draft', protect, validateDocuments, requirePermission('forms:submit'), async (req, res, next) => {
  try {
    const { formData } = req.body || {}
    if (!formData || typeof formData !== 'object') {
      return sendError(res, 'formData object is required', 'MISSING_FORM_DATA', 400)
    }
    const draft = await FormDraft.findOneAndUpdate(
      { formId: req.params.id, userId: req.user._id },
      { formData },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    )
    return sendSuccess(res, { draft: { formData: draft.formData || {}, updatedAt: draft.updatedAt } })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/forms/:id/draft — discard the caller's draft.
router.delete('/:id/draft', protect, requirePermission('forms:submit'), async (req, res, next) => {
  try {
    await FormDraft.deleteOne({ formId: req.params.id, userId: req.user._id })
    return sendSuccess(res, { discarded: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/forms/:id/submit
// Every workspace role can submit, Admins included — in practice they also file
// their own leave and expense requests.
router.post('/:id/submit', protect, validateDocuments, requirePermission('forms:submit'), requireQuota('submissions'), async (req, res, next) => {
  try {
    const form = await Form.findById(req.params.id).lean()
    if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
    if (form.status !== 'published') {
      return sendError(res, 'Form is not published', 'FORM_NOT_PUBLISHED', 400)
    }

    // A published workflow linked to this form drives the access checks below
    // and the trigger after submission.
    const linkedWorkflow = await Workflow.findOne({
      ...linkedFormMatch(form._id),
      status: 'published'
    }).select('_id title access triggerOn preventDuplicates nodes department').lean()

    // --- Who-can-submit / department access enforcement -------------------
    // Builders (Admin/Manager/HR/…) administer everything, so they bypass. For
    // everyone else, restrictions apply. Open by default: no config = anyone.
    if (linkedWorkflow && !isBuilder(req.user)) {
      const access = linkedWorkflow.access || {}

      // Visibility gate — you must be able to see a form to submit it.
      if (!canSeeWorkflowForm(access, req.user)) {
        return sendError(res, 'This request is not available to you', 'NOT_VISIBLE', 403)
      }

      // Who-can-submit gate (independent of visibility).
      if (access.whoCanSubmit === 'Specific people') {
        const allowed = (access.allowedInitiators || []).map(String)
        if (allowed.length && !allowed.includes(String(req.user._id))) {
          return sendError(res, 'You are not authorized to start this request', 'INITIATOR_NOT_ALLOWED', 403)
        }
      } else if (access.whoCanSubmit === 'Managers only') {
        if (!(await userIsManager(req.user))) {
          return sendError(res, 'Only managers can start this request', 'MANAGERS_ONLY', 403)
        }
      }
    }

    // --- Duplicate prevention (one submission per user per form per day) ---
    if (linkedWorkflow?.preventDuplicates) {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)
      const dupe = await FormResponse.findOne({
        formId: form._id,
        submittedBy: req.user._id,
        createdAt: { $gte: startOfDay }
      }).select('_id').lean()
      if (dupe) {
        return sendError(res, 'You have already submitted this form today', 'DUPLICATE_SUBMISSION', 409)
      }
    }

    const { formData, extraction } = req.body || {}
    if (!formData || typeof formData !== 'object') {
      return sendError(res, 'formData object is required', 'MISSING_FORM_DATA', 400)
    }

    // Required-field check
    const missing = (form.fields || [])
      .filter(f => f.required && isFieldVisible(f, formData) && (formData[f.id] === undefined || formData[f.id] === null || formData[f.id] === ''))
      .map(f => f.label || f.id)
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

    // Do not persist a response that is already known to enter an approval
    // stage with no resolvable person. The same read-only resolver drives the
    // Fill Form alert, keeping UI guidance and server enforcement aligned.
    if (linkedWorkflow) {
      const submitter = await User.findById(req.user._id).populate('role', 'name').lean()
      const { previewApprovalRoute } = require('../utils/workflowEngine')
      const approvalRoute = await previewApprovalRoute({
        workflow: linkedWorkflow,
        form,
        formData,
        submitter,
      })
      if (approvalRoute.canSubmit === false) {
        return sendError(
          res,
          'Submission is unavailable because an approval step has no configured approver.',
          'APPROVAL_ROUTE_UNAVAILABLE',
          409,
          { approvalRoute }
        )
      }
    }


    const preparedExtraction = await prepareExtractionAttachment({
      extraction,
      formId: form._id,
      org: req.organization,
      requesterId: req.user._id,
      audience: 'authenticated'
    })

    // Persist DMS ids from file/signature field values onto response.attachments.
    const attachmentRows = []
    for (const f of form.fields || []) {
      if (f.type !== 'file') continue
      const v = formData[f.id]
      if (v && typeof v === 'object' && (v.dmsDocId || v.url || v.s3Key)) {
        attachmentRows.push({
          filename: v.name || f.label || 'file',
          kind: 'form_upload',
          path: v.url || (v.s3Key ? '/api/s3/download?key=' + encodeURIComponent(v.s3Key) : ''),
          mimetype: v.mime || '',
          size: v.size || 0,
          dmsDocId: v.dmsDocId ? String(v.dmsDocId) : null,
          provisionalId: v.provisionalId ? String(v.provisionalId) : null,
          s3Key: v.s3Key ? String(v.s3Key) : null,
        })
      }
    }

    if (preparedExtraction) attachmentRows.push(preparedExtraction.attachment)
    const reservedResponseId = preparedExtraction ? newId() : undefined
    if (preparedExtraction) await markExtractionConsumed(preparedExtraction.job._id, reservedResponseId)

    let formResponse
    try {
      formResponse = await FormResponse.create({
        ...(reservedResponseId ? { _id: reservedResponseId } : {}),
        formId: form._id,
        submittedBy: req.user._id,
        formData,
        status: 'submitted',
        attachments: attachmentRows,
      })
    } catch (error) {
      if (preparedExtraction) {
        await releaseExtractionClaim(preparedExtraction.job._id, reservedResponseId).catch(() => {})
      }
      throw error
    }

    // Best-effort DMS audit — never block submit.
    // Learn only after an authenticated response has been persisted. The
    // feedback payload contains field IDs only; values are compared ephemerally.
    if (preparedExtraction) {
      try {
        await recordSubmissionFeedback({
          job: preparedExtraction.job,
          formData,
          feedback: extraction?.feedback,
          responseId: formResponse._id,
          audience: 'authenticated'
        })
      } catch (error) {
        console.warn('[pdf-auto-fill] feedback learning failed:', error.message)
      }
    }

    try {
      const { emitWorkflowEvents } = require('../utils/dmsAttachments')
      const ids = attachmentRows.map((a) => a.dmsDocId).filter(Boolean)
      await emitWorkflowEvents(ids, {
        type: 'workflow.submitted',
        actor: req.user,
        detail: `Submitted "${form.title}"`,
        meta: {
          formResponseId: formResponse._id,
          formId: form._id,
          workflowId: linkedWorkflow?._id,
        },
        org: req.organization,
      })
    } catch (err) {
      console.warn('[dms] submit events failed', err.message)
    }

    // Metered after the response exists so a failed create is never billed.
    // Await it: the count has to be visible to the next quota check.
    await meterSubmission(req.orgId)

    // A completed submission should not leave a stale draft behind. Best-effort:
    // never fail the submit if draft cleanup errors.
    FormDraft.deleteOne({ formId: form._id, userId: req.user._id }).catch(() => {})

    writeAuditLog({
      action: 'form_submitted',
      performedBy: req.user._id,
      targetEntity: `Form: ${form.title}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} submitted "${form.title}"`,
      metadata: { formId: form._id, formResponseId: formResponse._id }
    })

    // Trigger the published workflow linked to this form (looked up above).
    // "Manual trigger only" workflows save the response but don't auto-fire —
    // they're started later via POST /api/workflows/:id/execute.
    const workflow = linkedWorkflow

    let workflowTriggered = false
    let executionId = null

    if (workflow && workflow.triggerOn !== 'Manual trigger only') {
      try {
        // Lazy-require the engine so a corrupt engine module can't take down /submit
        const { triggerWorkflow } = require('../utils/workflowEngine')
        const execution = await triggerWorkflow(
          workflow._id,
          formResponse._id,
          req.user._id
        )
        workflowTriggered = true
        executionId = execution._id
      } catch (err) {
        console.error('triggerWorkflow error:', err.message)
        // Do NOT fail the submit — the response is already persisted.
      }
    }

    return sendSuccess(res, {
      formResponseId: formResponse._id,
      workflowTriggered,
      executionId
    }, 201)
  } catch (err) {
    next(err)
  }
})

module.exports = require('../database/atomicRoutes').atomicRoutes(router)
