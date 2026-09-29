// Shared - Phase 2 - utils/adapters.js
// Translates backend payloads into the shapes the existing UI components
// already render. Keeps every page from having to know API field names.

import { initials } from './auth'

// ---------- shared helpers ----------

import { formatDateTime, formatDateTimeWithRelative, relativeTime } from './datetime'

// Re-exported so existing `import { relativeTime } from './adapters'` callers
// keep working while the formatting itself lives in utils/datetime.
export { relativeTime }

// Identity hues, not statuses — each needs its own dark pair rather than a
// semantic token, so two people never end up the same colour.
const AVATAR_PALETTE = [
  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200',
  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200',
  'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200',
  'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200',
  'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
]
export const colourForName = (name) => {
  if (!name) return AVATAR_PALETTE[0]
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

const titleCase = (s) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// ---------- tasks ----------

const TASK_STATUS_MAP = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  escalated: 'Escalated',
  completed: 'Approved',
  cancelled: 'Cancelled'
}

const ACTION_DOT = {
  submitted: 'bg-info-solid',
  approved: 'bg-success-solid',
  rejected: 'bg-danger-solid',
  escalated: 'bg-orange-500',
  request_changes: 'bg-warning-solid',
  reassigned: 'bg-purple-500'
}

// Friendly labels for the semantic approver tokens the engine resolves at runtime.
const APPROVER_ROLE_LABELS = {
  direct_manager: 'Reporting manager',
  hr_partner: 'HR partner',
  hr_admin: 'Admin',
  ceo: 'CEO',
  super_admin: 'Admin',
  hr_manager: 'HR Manager',
  finance_manager: 'Finance Manager',
  it_manager: 'IT Manager',
  operations_manager: 'Operations Manager',
  sales_manager: 'Sales Manager',
  legal_manager: 'Legal Manager'
}

export const adaptTask = (apiTask) => {
  if (!apiTask) return null

  // Webhook / external forms may send submitter on the execution; prefer that
  // over the workflow owner recorded as submittedBy for attribution.
  const external = apiTask.triggerSubmitter
  const submitter = external?.name
    || apiTask.submittedBy?.name
    || 'Unknown'
  const submitterLabel = external?.email
    ? `${submitter} (${external.email})`
    : submitter
  const status = TASK_STATUS_MAP[apiTask.status] || 'Pending'
  const isResolved = apiTask.status !== 'pending' && apiTask.status !== 'escalated'

  const lastApprovalAction = Array.isArray(apiTask.approvalHistory) && apiTask.approvalHistory.length > 0
    ? apiTask.approvalHistory[apiTask.approvalHistory.length - 1]
    : null
  const resolvedAt = isResolved
    ? lastApprovalAction?.performedAt || apiTask.updatedAt || null
    : null
  let compareTime = Date.now()
  if (resolvedAt) {
    const resolvedTime = new Date(resolvedAt).getTime()
    if (!Number.isNaN(resolvedTime)) compareTime = resolvedTime
  }

  const dueMs = apiTask.dueDate ? new Date(apiTask.dueDate).getTime() - compareTime : 0
  const dueInMinutes = Math.round(dueMs / 60000)
  const slaBreached = apiTask.status === 'escalated' || apiTask.isEscalated || dueInMinutes < 0

  // Internal form → formResponseId; inbound webhook → triggerFormData on the task.
  const formData = apiTask.formResponseId?.formData || apiTask.triggerFormData || {}
  // Map field id -> definition so we can show the human label (not the raw id)
  // and detect file fields to render as download links.
  const fieldDefs = apiTask.formResponseId?.formId?.fields || apiTask.triggerFormFields || []
  const fieldMap = new Map(fieldDefs.map((f) => [f.id, f]))

  const looksLikeTechnicalId = (key) =>
    /^[0-9a-f]{24}$/i.test(key) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)

  const fileValue = (v) => {
    // A file field stores { name, url, ... } or { name, s3Key, ... }.
    if (v && typeof v === 'object') {
      if (v.s3Key) return { name: v.name || 'Attachment', url: v.url || v.path || '' }
      if (v.url) return { name: v.name || 'Attachment', url: v.url }
    }
    return null
  }

  const submission = Object.entries(formData)
    .filter(([k]) => k !== 'submitter')
    .map(([k, v]) => {
    const def = fieldMap.get(k)
    const isUnlabelled = !def && looksLikeTechnicalId(k)
    const label = def?.label || (isUnlabelled ? 'Field label unavailable' : titleCase(k))
    // Grid/table fields carry an array of row objects — pass the column defs +
    // rows through so the UI can render a real table instead of raw JSON.
    if (def?.type === 'grid' && Array.isArray(v)) {
      return { label, grid: { columns: def.columns || [], rows: v }, isUnlabelled, fieldRef: k }
    }
    if (def?.type === 'signature' || (v && typeof v === 'object' && v.kind && (v.text || v.url || v.dataURL))) {
      return { label, value: v, isSignature: true, isUnlabelled, fieldRef: k }
    }
    // Legacy executions may no longer have their original field definitions.
    // A stored file object is still authoritative, so recognise it by shape and
    // render the real file instead of leaking its JSON representation.
    const file = fileValue(v)
    if (file) {
      if (def?.type === 'camera') {
        return { label, value: file.name, url: file.url, isCamera: true, isUnlabelled, fieldRef: k }
      }
      return { label, value: file.name, href: file.url, isFile: true, isUnlabelled, fieldRef: k }
    }
    return {
      label,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''),
      isUnlabelled,
      fieldRef: isUnlabelled ? k : undefined
    }
  })
  if (submitterLabel) submission.unshift({ label: 'Submitted by', value: submitterLabel })
  if (!external && apiTask.submittedBy?.department) {
    submission.push({ label: 'Department', value: apiTask.submittedBy.department })
  }

  const history = (apiTask.approvalHistory || []).map((h) => {
    const who = h.performedBy?.name || 'System'
    const verb = h.action === 'submitted' ? 'submitted' : h.action.replace(/_/g, ' ')
    return {
      label: `${who} ${verb}${h.comment ? ` — "${h.comment}"` : ''}`,
      time: formatDateTimeWithRelative(h.performedAt),
      at: h.performedAt || null,
      dotColor: ACTION_DOT[h.action] || 'bg-fg-subtle',
      signature: h.signature || null
    }
  })

  // SLA is only real when the workflow set a due date; otherwise the panel says
  // so instead of inventing a 48h budget.
  const createdMs = apiTask.createdAt ? new Date(apiTask.createdAt).getTime() : Date.now()
  const hasSla = !!apiTask.dueDate
  const totalHours = apiTask.dueDate
    ? Math.max(1, Math.round((new Date(apiTask.dueDate).getTime() - createdMs) / 3600000))
    : 48
  const assignedHoursAgo = Math.max(0, Math.round((compareTime - createdMs) / 3600000))

  // assignedTo / submittedBy may be populated objects or raw ObjectId strings,
  // depending on the endpoint. Normalise both to plain id strings so the UI can
  // decide who is allowed to act on the task.
  const idOf = (v) => (v && typeof v === 'object' ? v._id : v) || null
  const approver = apiTask.assignedTo?.name || null

  return {
    _raw: apiTask,
    id: apiTask._id,
    title: apiTask.formResponseId?.formId?.title || apiTask.triggerFormTitle || apiTask.workflowId?.title || apiTask.title,
    subject: apiTask.formResponseId?.formId?.title || apiTask.triggerFormTitle || apiTask.workflowId?.title || apiTask.title,
    // 'submit' tasks ask the assignee to upload a file + comment (no approve/reject).
    actionType: apiTask.actionType || 'approval',
    instructions: apiTask.instructions || '',
    requireAttachment: !!apiTask.requireAttachment,
    requireSignature: !!apiTask.requireSignature,
    // Submit-node inline form: field definitions + the submitted values.
    formFields: Array.isArray(apiTask.formFields) ? apiTask.formFields : [],
    formData: apiTask.formData && typeof apiTask.formData === 'object' ? apiTask.formData : {},
    attachments: Array.isArray(apiTask.attachments)
      ? apiTask.attachments.map((a) => ({ name: a.name, url: a.url, mime: a.mime, size: a.size }))
      : [],
    sourceAttachments: Array.isArray(apiTask.formResponseId?.attachments)
      ? apiTask.formResponseId.attachments
          .filter((attachment) => attachment.kind === 'auto_fill_source')
          .map((attachment) => ({ name: attachment.filename, url: attachment.path, mime: attachment.mimetype, size: attachment.size, kind: attachment.kind }))
      : [],
    // Documents carried over from earlier workflow steps (submit-node uploads).
    priorDocuments: Array.isArray(apiTask.priorDocuments)
      ? apiTask.priorDocuments.map((d) => ({ name: d.name, url: d.url, mime: d.mime, size: d.size, step: d.step }))
      : [],
    // Structured form values submitted at earlier submit-node steps.
    priorForms: Array.isArray(apiTask.priorForms)
      ? apiTask.priorForms.map((f) => ({
          step: f.step,
          nodeId: f.nodeId,
          fields: Array.isArray(f.fields) ? f.fields : [],
          data: f.data && typeof f.data === 'object' ? f.data : {},
        }))
      : [],
    // Outbound Integration (api) node results from the parent execution.
    integrationEvents: Array.isArray(apiTask.integrationEvents)
      ? apiTask.integrationEvents.map((e) => ({
          nodeId: e.nodeId,
          status: e.status,
          ok: e.ok !== false,
          error: e.error || null,
          httpStatus: e.httpStatus ?? null,
          attempts: e.attempts ?? null,
          skipped: !!e.skipped,
          exitedAt: e.exitedAt || null,
        }))
      : [],
    detail: apiTask.type || apiTask.workflowId?.title || 'General',
    requester: submitter,
    approver,
    department: apiTask.type || apiTask.workflowId?.department || apiTask.submittedBy?.department || 'General',
    assignedToId: idOf(apiTask.assignedTo),
    submittedById: idOf(apiTask.submittedBy),
    executionId: idOf(apiTask.workflowExecutionId),
    executionStatus: apiTask.executionStatus || null,
    canCancel: !!apiTask.canCancel,
    workflow: apiTask.workflowId?.title || apiTask.type || 'Standalone',
    initials: initials(submitter),
    avatarColor: colourForName(submitter),
    dueInMinutes,
    slaBreached,
    status,
    dueDate: apiTask.dueDate,
    resolvedAt,
    createdAt: apiTask.createdAt,
    updatedAt: apiTask.updatedAt || apiTask.createdAt,
    hasUnavailableLabels: submission.some((row) => row.isUnlabelled),
    submission,
    history,
    approvalChain: (apiTask.approvalChain || []).map((s) => ({
      nodeId: s.nodeId,
      title: s.title,
      roleLabel: s.role ? (APPROVER_ROLE_LABELS[s.role] || titleCase(s.role)) : null,
      status: s.status, // approved | rejected | escalated | pending | upcoming
      isCurrent: !!s.isCurrent,
      assignee: s.assignee?.name || null,
      decidedBy: s.decidedBy || null,
      decidedAt: formatDateTime(s.decidedAt) || null,
      decidedAtIso: s.decidedAt || null,
      quorum: s.quorum || null // { total, approved, required } for committee stages
    })),
    approvalSummary: apiTask.approvalSummary || null,
    // Committee / quorum approval (multiApproval node): the roster of voters,
    // each person's vote, and how many approvals are required (N of M).
    isMultiApproval:
      apiTask.approvalType === 'parallel' &&
      Array.isArray(apiTask.parallelApprovers) &&
      apiTask.parallelApprovers.length > 0,
    requiredApprovals: apiTask.requiredApprovals || 1,
    parallelApprovers: (apiTask.parallelApprovers || []).map((p) =>
      p && typeof p === 'object'
        ? { id: idOf(p), name: p.name || null, email: p.email || null }
        : { id: p, name: null, email: null }
    ),
    parallelApprovals: (apiTask.parallelApprovals || []).map((p) => ({
      id: idOf(p.userId),
      name: p.userId?.name || null,
      status: p.status || 'pending',
      decidedAt: formatDateTime(p.decidedAt) || null,
      decidedAtIso: p.decidedAt || null
    })),
    sla: { totalHours, assignedHoursAgo, hasSla },
    comments: []
  }
}

// ---------- notifications ----------

const NOTIF_DOT = {
  approval:   'bg-success-subtle',
  rejection:  'bg-danger-subtle',
  escalation: 'bg-warning-subtle',
  assignment: 'bg-info-subtle',
  reminder:   'bg-warning-subtle'
}

export const adaptNotification = (n) => ({
  _raw: n,
  id: n._id,
  message: n.message,
  title: n.title,
  time: relativeTime(n.createdAt),
  read: n.isRead,
  type: n.type,
  taskId: n.taskId,
  dotColor: NOTIF_DOT[n.type] || 'bg-surface-3'
})

// ---------- forms ----------

const FORM_STATUS_MAP = {
  draft:     'Draft',
  published: 'Published',
  archived:  'Archived'
}

export const adaptForm = (f) => ({
  _raw: f,
  id: f._id,
  name: f.title,
  title: f.title,
  description: f.description || '',
  category: f.department || 'General',
  tags: f.tags || [],
  status: FORM_STATUS_MAP[f.status] || 'Draft',
  fields: Array.isArray(f.fields) ? f.fields.length : 0,
  fieldDefs: f.fields || [],
  submissions: f.submissions || 0,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt || f.createdAt,
  createdBy: f.createdBy?.name || 'Unknown',
  version: f.version || 1,
  isPublic: !!f.public?.enabled,
  publicToken: f.public?.token || null
})

// ---------- workflows ----------

const WORKFLOW_STATUS_MAP = {
  draft:     'Draft',
  published: 'Active',
  paused:    'Paused',
  archived:  'Archived'
}

export const adaptWorkflow = (w) => ({
  _raw: w,
  id: w._id,
  name: w.title,
  title: w.title,
  description: w.description || '',
  category: w.department || 'General',
  tags: w.tags || [],
  status: WORKFLOW_STATUS_MAP[w.status] || 'Draft',
  steps: Array.isArray(w.nodes) ? w.nodes.length : 0,
  nodes: w.nodes || [],
  edges: w.edges || [],
  linkedFormId: w.linkedFormId
    ? String(w.linkedFormId)
    : (Array.isArray(w.linkedFormIds) && w.linkedFormIds[0] ? String(w.linkedFormIds[0]) : null),
  linkedFormIds: Array.isArray(w.linkedFormIds) && w.linkedFormIds.length
    ? w.linkedFormIds.map(String)
    : (w.linkedFormId ? [String(w.linkedFormId)] : []),
  inboundWebhook: w.inboundWebhook
    ? {
        enabled: w.inboundWebhook.enabled === true,
        token: w.inboundWebhook.token || '',
        secret: w.inboundWebhook.secret || '',
        requireSignature: w.inboundWebhook.requireSignature !== false,
        callbackUrl: w.inboundWebhook.callbackUrl || '',
        expectedFields: Array.isArray(w.inboundWebhook.expectedFields)
          ? w.inboundWebhook.expectedFields
          : [],
      }
    : { enabled: false, token: '', secret: '', callbackUrl: '', expectedFields: [] },
  createdAt: w.createdAt,
  updatedAt: w.updatedAt || w.createdAt,
  createdBy: w.createdBy?.name || 'Unknown',
  version: w.version || 1
})
