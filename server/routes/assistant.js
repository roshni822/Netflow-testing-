// AI-02 - routes/assistant.js
// In-app AI assistant chatbot. Answers natural-language questions about the
// signed-in user's requests and approvals ("where is my request?", "who
// approved invoice #123?"). Answers are GROUNDED strictly in the user's own
// data and ROLE-SCOPED: regular users only see requests they submitted or were
// assigned; elevated roles (Admin/CEO/Manager) can search across all requests.

const express = require('express')

const Task = require('../models/Task')
const { protect } = require('../middleware/auth')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { isConfigured: llmConfigured, getModel, generateText } = require('../utils/llm')

const router = express.Router()

const ELEVATED_ROLES = ['Admin', 'CEO', 'Manager']
const isElevated = (user) => ELEVATED_ROLES.includes(user?.role?.name)

const SYSTEM = [
  "You are NetFlow's in-app assistant. NetFlow is a workflow and approvals platform.",
  'You help the signed-in user track their requests and approvals.',
  'Rules:',
  '- Answer ONLY using the CONTEXT provided in the user message. The context lists the requests this user is allowed to see, each with its status, who it is currently waiting on, and its approval history (who approved / rejected / requested changes, and when).',
  "- If the answer is not in the context, say you couldn't find that request or that you don't have access to it. NEVER invent names, dates, statuses, or requests.",
  '- Be concise and friendly. When asked "who approved X", name the approver and the date. When asked "where is my request", give its status and who it is currently waiting on.',
  '- Refer to requests by their title (and the short ref in brackets). Do not expose long internal database ids.',
  '- Use plain text with short sentences or small bullet lists. Do not use markdown headings.',
].join('\n')

const fmtDate = (d) => {
  if (!d) return 'unknown date'
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return 'unknown date'
  }
}

const shortRef = (id) => String(id || '').slice(-6).toUpperCase()

const cleanTitle = (s) => (s || 'Untitled request').replace(/\s*—\s*Approval Required\s*$/i, '')

// Flatten a form-response's formData object into a short "key: value" string so
// the model can match things like an invoice/PO number a submitter typed.
const formDataToText = (fd) => {
  if (!fd || typeof fd !== 'object') return ''
  const parts = []
  for (const [k, v] of Object.entries(fd)) {
    let val = v
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) val = v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : x)).join(', ')
      else if (v.name) val = v.name // file upload
      else if (v.text) val = v.text // typed signature
      else val = JSON.stringify(v)
    }
    if (val === undefined || val === null || String(val).trim() === '') continue
    parts.push(`${k}: ${String(val).slice(0, 80)}`)
    if (parts.length >= 12) break
  }
  return parts.join('; ')
}

const ACTION_LABEL = {
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'rejected',
  request_changes: 'requested changes',
  escalated: 'escalated',
  reassigned: 'reassigned',
}

// Render one task into a compact, grounded context block.
const formatTask = (t, n) => {
  const lines = []
  lines.push(`#${n} — ${cleanTitle(t.title)} [ref ${shortRef(t._id)}]`)
  if (t.formResponseId?.formId?.title) lines.push(`Form: ${t.formResponseId.formId.title}`)
  if (t.submittedBy?.name) {
    lines.push(`Submitted by: ${t.submittedBy.name}${t.submittedBy.department ? ` (${t.submittedBy.department})` : ''}`)
  }
  lines.push(`Status: ${t.status}`)
  if (t.status === 'pending' && t.assignedTo?.name) lines.push(`Currently waiting on: ${t.assignedTo.name}`)
  const hist = (t.approvalHistory || []).map((h) => {
    const who = h.performedBy?.name || 'someone'
    const act = ACTION_LABEL[h.action] || h.action
    const cm = h.comment ? ` — "${String(h.comment).slice(0, 120)}"` : ''
    return `   - ${who} ${act} on ${fmtDate(h.performedAt)}${cm}`
  })
  if (hist.length) {
    lines.push('History:')
    lines.push(...hist)
  }
  const fd = formDataToText(t.formResponseId?.formData)
  if (fd) lines.push(`Fields: ${fd}`)
  return lines.join('\n')
}

// Pull useful search terms out of the question (drop common filler words).
const STOP = new Set([
  'the', 'my', 'is', 'are', 'who', 'what', 'where', 'when', 'how', 'of', 'for', 'to', 'a', 'an',
  'request', 'requests', 'approved', 'approve', 'status', 'show', 'me', 'did', 'was', 'on', 'in',
  'and', 'please', 'tell', 'do', 'does', 'this', 'that', 'about', 'has', 'have', 'been', 'it',
])
const extractTerms = (msg) => {
  const tokens = String(msg).toLowerCase().match(/[a-z0-9#-]{2,}/g) || []
  const cleaned = tokens.map((x) => x.replace(/^#+/, '')).filter((x) => x && !STOP.has(x))
  return [...new Set(cleaned)].slice(0, 8)
}

const haystackFor = (t) => [
  t.title,
  t.formResponseId?.formId?.title,
  t.submittedBy?.name,
  t.assignedTo?.name,
  formDataToText(t.formResponseId?.formData),
  shortRef(t._id),
].filter(Boolean).join(' ').toLowerCase()

const scoreTask = (t, terms) => {
  const hay = haystackFor(t)
  let score = 0
  for (const term of terms) if (hay.includes(term)) score += 1
  return score
}

// GET /api/assistant/status — lets the UI hide the widget when no LLM is set.
router.get('/status', protect, (req, res) =>
  sendSuccess(res, { aiConfigured: llmConfigured(), model: llmConfigured() ? getModel() : null })
)

// POST /api/assistant/ask  { message, history? } -> { answer }
router.post('/ask', protect, async (req, res, next) => {
  try {
    if (!llmConfigured()) {
      return sendError(res, 'The assistant is not configured.', 'AI_NOT_CONFIGURED', 503)
    }

    const message = String((req.body && req.body.message) || '').trim()
    if (!message) return sendError(res, 'Ask a question first.', 'EMPTY_MESSAGE', 400)
    if (message.length > 1000) return sendError(res, 'That question is too long.', 'MESSAGE_TOO_LONG', 400)

    const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-6) : []

    const me = req.user._id
    const elevated = isElevated(req.user)

    // Role-scoped candidate set. Non-elevated users only see their own requests
    // (submitted by them) and their approval queue (assigned to them).
    const baseQuery = elevated ? {} : { $or: [{ assignedTo: me }, { submittedBy: me }] }
    const candidates = await Task.find(baseQuery)
      .populate('submittedBy', 'name email department')
      .populate('assignedTo', 'name email department')
      .populate('workflowId', 'title')
      .populate({ path: 'formResponseId', select: 'formData formId', populate: { path: 'formId', select: 'title' } })
      .populate('approvalHistory.performedBy', 'name')
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(elevated ? 250 : 80)
      .lean()

    // Narrow to the requests the question is actually about. If nothing matches
    // the keywords, fall back to the most recent requests (handles vague
    // questions like "where are my requests?").
    const terms = extractTerms(message)
    let matched = candidates
    if (terms.length) {
      const scored = candidates
        .map((t) => ({ t, score: scoreTask(t, terms) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
      if (scored.length) matched = scored.map((x) => x.t)
    }

    const top = matched.slice(0, 15)
    const context = top.length
      ? top.map((t, i) => formatTask(t, i + 1)).join('\n\n')
      : 'No requests were found for this user.'

    const historyText = history
      .filter((h) => h && h.role && h.content)
      .map((h) => `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${String(h.content).slice(0, 400)}`)
      .join('\n')

    const prompt = [
      "CONTEXT — the requests this user is allowed to see:",
      context,
      '',
      historyText ? `Recent conversation:\n${historyText}\n` : '',
      `User question: ${message}`,
      '',
      'Answer using ONLY the context above.',
    ].filter(Boolean).join('\n')

    let answer
    try {
      answer = await generateText(prompt, { system: SYSTEM, temperature: 0.2 })
    } catch (err) {
      console.error('assistant generateText error:', err.message)
      return sendError(res, 'The assistant is busy right now. Please try again in a moment.', 'AI_ERROR', 503)
    }

    return sendSuccess(res, {
      answer: (answer || '').trim() || "I couldn't find anything about that in your requests.",
      matched: top.length,
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
