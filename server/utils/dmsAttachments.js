// Helpers for refreshing DMS signed URLs and emitting workflow lifecycle events.

const dms = require('../services/dmsClient')
const s3 = require('../services/s3Client')

const EVENT_TYPES = new Set([
  'workflow.submitted',
  'workflow.approved',
  'workflow.rejected',
  'workflow.escalated',
  'workflow.reassigned',
])

/** Collect dmsDocId values from task.attachments, formData file objects, signatures. */
function collectDmsDocIds(task, formResponse) {
  const ids = new Set()

  const take = (obj) => {
    if (!obj || typeof obj !== 'object') return
    if (obj.dmsDocId) ids.add(String(obj.dmsDocId))
  }

  for (const a of task?.attachments || []) take(a)
  for (const h of task?.approvalHistory || []) take(h?.signature)

  const walk = (val) => {
    if (!val || typeof val !== 'object') return
    if (Array.isArray(val)) {
      val.forEach(walk)
      return
    }
    if (require('./documentAccess').canonical(val)) take(val)
    else Object.values(val).forEach(walk)
  }

  if (task?.formData) walk(task.formData)
  if (formResponse?.formData) walk(formResponse.formData)
  for (const a of formResponse?.attachments || []) {
    if (a.dmsDocId) ids.add(String(a.dmsDocId))
  }

  return [...ids]
}

async function refreshFileObject(file, { org, user, mode = 'view' } = {}) {
  if (!file || typeof file !== 'object') return file
  const access = require('./documentAccess')
  const local = access.canonical(file)
  if (local && !local.includes(':') && user && org && await access.canRead(local, user, org._id)) {
    const url = `/api/files/${local}?k=${await access.issue(local, org._id)}`
    return { ...file, url, ...(file.path ? { path: url } : {}) }
  }
  if (file.s3Key && s3.isEnabled(org) && user && await access.canRead(local, user, org._id)) {
    const url = await s3.getPresignedDownloadUrl(org, file.s3Key)
    return { ...file, url, ...(file.path ? { path: url } : {}) }
  }
  if (!file.dmsDocId || !dms.isEnabled() || !user || !await access.canRead(local, user, org?._id)) return file
  try {
    const url = await dms.signedUrl(file.dmsDocId, { mode, org, user, department: file.dmsDepartment })
    if (url) return { ...file, url }
  } catch (err) {
    console.warn('[dms] signedUrl refresh failed', file.dmsDocId, err.message)
  }
  return file
}

async function refreshFormDataUrls(formData, ctx) {
  if (!formData || typeof formData !== 'object' || formData instanceof Date) return formData

  const out = Array.isArray(formData) ? [...formData] : { ...formData }
  const entries = Array.isArray(out) ? out.entries() : Object.entries(out)

  await Promise.all([...entries].map(async ([key, val]) => {
    if (val && typeof val === 'object' && require('./documentAccess').canonical(val)) {
      const refreshed = await refreshFileObject(val, ctx)
      if (Array.isArray(out)) out[key] = refreshed
      else out[key] = refreshed
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      // Nested grids / repeaters
      const nested = await refreshFormDataUrls(val, ctx)
      if (Array.isArray(out)) out[key] = nested
      else out[key] = nested
    } else if (Array.isArray(val)) {
      const nested = await refreshFormDataUrls(val, ctx)
      if (Array.isArray(out)) out[key] = nested
      else out[key] = nested
    }
  }))

  return out
}

async function refreshResponseAttachments(attachments, ctx) {
  if (!Array.isArray(attachments)) return []
  return Promise.all(attachments.map(attachment => refreshFileObject(attachment, ctx)))
}

async function refreshTaskAttachments(taskObj, ctx) {
  // Include signatures, approval history, trigger data and prior forms as well
  // as top-level attachments. Preserve Date values during the recursive walk.
  return refreshFormDataUrls(taskObj, ctx)
}

/** Best-effort DMS audit events — never throws to callers. */
async function emitWorkflowEvents(dmsDocIds, { type, actor, detail, meta, org } = {}) {
  if (!dms.isEnabled() || !EVENT_TYPES.has(type) || !dmsDocIds?.length) return
  await Promise.allSettled(
    dmsDocIds.map((id) =>
      dms.postEvent(id, { type, actor, detail, meta }, { org }).catch((err) => {
        console.warn('[dms] postEvent failed', id, type, err.message)
      })
    )
  )
}

async function emitForTask(task, { type, actor, detail, meta, org, formResponse } = {}) {
  const ids = collectDmsDocIds(task, formResponse)
  await emitWorkflowEvents(ids, { type, actor, detail, meta, org })
}

module.exports = {
  collectDmsDocIds,
  refreshFileObject,
  refreshFormDataUrls,
  refreshTaskAttachments,
  emitWorkflowEvents,
  emitForTask,
  refreshResponseAttachments,
}
