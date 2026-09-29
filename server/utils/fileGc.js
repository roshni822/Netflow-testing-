// Licensing Phase 3 - utils/fileGc.js
// Gives storage back when the records that referenced a file are deleted.
//
// Uploads are metered on arrival (routes/uploads.js), so the meter is only honest
// if deletes decrement it. Getting that right needs one rule: a file is freed by
// the record that OWNS it, never by a record that merely quotes it.
//
// The distinction matters because the engine copies a submission's answers into
// WorkflowExecution.variables.formData for condition evaluation. Walking an
// execution wholesale would therefore "find" the submitter's attachments and
// delete them while the form response still points at them — so the collectors
// below name the fields they read instead of scanning whole documents.
//
// Owners:
//   FormResponse         its file-field answers + attachments (incl. signed PDFs)
//   Task                 the inline uploads a Submit-node assignee attached
//   WorkflowExecution    only variables.documents — the documents it generated
//   User                 its avatar

const fs = require('fs')

const { resolveStored, removeStored, dirForOrg, UPLOAD_ROOT } = require('./fileStore')
const { releaseStorage } = require('./usageMeter')
const Organization = require('../models/Organization')
const dms = require('../services/dmsClient')
const s3 = require('../services/s3Client')

// Matches the capability URLs produced by fileStore.urlFor. Legacy flat
// "/uploads/<name>" links are deliberately ignored: they live outside any org
// directory and were never counted, so deleting them would push the meter below
// what is really on disk.
const FILE_URL_RE = /\/api\/files\/([0-9a-fA-F]{24})\/([A-Za-z0-9._-]+)/

const MAX_DEPTH = 8

// Collects "<orgId>/<filename>" for every stored file reachable from `value`.
// Answers nest (a grid is an array of row objects, each holding file objects), so
// this recurses — but only through data it was handed.
const collectInto = (value, into, depth = 0) => {
  if (value === null || value === undefined || depth > MAX_DEPTH) return into
  if (typeof value === 'string') {
    const match = FILE_URL_RE.exec(value)
    if (match) into.add(`${match[1]}/${match[2]}`)
    return into
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectInto(item, into, depth + 1))
    return into
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectInto(item, into, depth + 1))
  }
  return into
}

const collect = (values) => {
  const found = new Set()
  values.forEach((v) => collectInto(v, found))
  return found
}

const urlsOfFormResponse = (response) => collect([response?.formData, response?.attachments])
const urlsOfTask = (task) => collect([task?.formData, task?.attachments])
const urlsOfExecution = (execution) => collect([execution?.variables?.documents])
const urlsOfUser = (user) => collect([user?.avatar])

// Deletes the named files and decrements the tenant's meters by what was actually
// removed. Anything belonging to another org is skipped rather than trusted —
// these lists come from documents, and a stale reference must never be able to
// reach across tenants.
//
// Never throws: a delete that cannot free space must still succeed, and the
// nightly reconciliation repairs whatever drifted.
const releaseRefs = async (orgId, refs) => {
  if (!orgId || !refs || refs.size === 0) return { bytes: 0, files: 0 }

  let bytes = 0
  let files = 0
  for (const ref of refs) {
    const [refOrg, filename] = String(ref).split('/')
    if (String(refOrg) !== String(orgId)) continue

    const target = resolveStored(refOrg, filename)
    if (!target) continue
    let size = 0
    try {
      size = fs.statSync(target.abs).size
    } catch {
      continue  // already gone — nothing to give back
    }
    if (await removeStored(refOrg, filename)) {
      bytes += size
      files += 1
    }
  }

  if (files) await releaseStorage(orgId, bytes, { files })
  return { bytes, files }
}

// Convenience wrapper for a delete that spans record types.
const releaseFor = async (orgId, { responses = [], tasks = [], executions = [], users = [] } = {}) => {
  const refs = new Set()
  responses.forEach((r) => urlsOfFormResponse(r).forEach((ref) => refs.add(ref)))
  tasks.forEach((t) => urlsOfTask(t).forEach((ref) => refs.add(ref)))
  executions.forEach((e) => urlsOfExecution(e).forEach((ref) => refs.add(ref)))
  users.forEach((u) => urlsOfUser(u).forEach((ref) => refs.add(ref)))
  const local = await releaseRefs(orgId, refs)

  // Auto-fill source PDFs stored in DMS/S3 are owned by the FormResponse too.
  // Limit remote deletion to this explicit kind so legacy DMS metering rules for
  // ordinary uploads remain unchanged.
  const remote = new Map()
  for (const response of responses) {
    for (const attachment of response?.attachments || []) {
      if (attachment?.kind !== 'auto_fill_source') continue
      const key = attachment.dmsDocId ? 'dms:' + attachment.dmsDocId : attachment.s3Key ? 's3:' + attachment.s3Key : null
      if (key) remote.set(key, attachment)
    }
  }

  if (!remote.size) return local
  const org = await Organization.findById(orgId).lean()
  if (!org) return local
  let remoteBytes = 0
  let remoteFiles = 0
  for (const attachment of remote.values()) {
    try {
      if (attachment.dmsDocId) {
        await dms.deleteDoc(attachment.dmsDocId, { org })
        remoteBytes += Number(attachment.size || 0)
        remoteFiles += 1
      } else if (attachment.s3Key) {
        await s3.deleteFile(org, attachment.s3Key)
      }
    } catch (error) {
      console.warn('[file-gc] remote auto-fill source delete failed:', error.message)
    }
  }
  if (remoteFiles) await releaseStorage(orgId, remoteBytes, { files: remoteFiles })
  return { bytes: local.bytes + remoteBytes, files: local.files + remoteFiles }
}

// Whole-tenant cleanup for a deleted organization: the directory goes, and with
// it every attachment, so there is no meter left to correct.
const purgeOrgFiles = async (orgId) => {
  if (!orgId) return false
  const dir = dirForOrg(orgId)
  if (!dir.startsWith(UPLOAD_ROOT)) return false
  try {
    await fs.promises.rm(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

module.exports = {
  collect,
  urlsOfFormResponse,
  urlsOfTask,
  urlsOfExecution,
  urlsOfUser,
  releaseRefs,
  releaseFor,
  purgeOrgFiles
}
