// Licensing Phase 2 - utils/fileStore.js
// Where attachments live on disk and how their URLs are authorised.
//
// Two problems are solved here at once:
//
//  1. Isolation. Files used to land in one flat directory served by
//     express.static, so anybody who could guess a filename could read another
//     tenant's payslip. New uploads go to uploads/<orgId>/<random> and are served
//     by routes/files.js, which checks the caller belongs to that org.
//
//  2. Anonymous access. A public form submitter has no login, and an approver
//     opens an attachment with a plain <a href> that cannot carry a bearer token.
//     So each stored URL carries a path-bound HMAC ("capability URL"): unguessable,
//     scoped to exactly one file, and revocable by rotating the secret.
//
// Storage accounting depends on the layout above — a per-org directory is what
// lets the reconciliation job recompute a tenant's usage from the filesystem.

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || path.join(__dirname, '..', 'uploads'))

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

ensureDir(UPLOAD_ROOT)

const dirForOrg = (orgId) => ensureDir(path.join(UPLOAD_ROOT, String(orgId || 'shared')))

// Random name + original extension: the extension is kept so downloads open in
// the right app, and randomised so a crafted filename cannot traverse paths.
const safeFilename = (originalname) => {
  const ext = path.extname(String(originalname || '')).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, '')
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`
}

// Short-lived, versioned capability URL. Callers must already authorize issuance.
const urlFor = async (orgId, filename) => {
  const rel = `${orgId}/${filename}`
  return `/api/files/${rel}?k=${await require('./documentAccess').issue(rel, orgId)}`
}

// Rejects anything that is not exactly <24-hex orgId>/<filename> — the only shape
// this store ever produces, which keeps `..` and absolute paths out.
const REL_RE = /^[0-9a-fA-F]{24}\/[A-Za-z0-9._-]+$/

const resolveStored = (orgId, filename) => {
  const rel = `${orgId}/${filename}`
  if (!REL_RE.test(rel)) return null
  const abs = path.join(UPLOAD_ROOT, orgId, filename)
  // Belt and braces: the resolved path must still be inside the upload root.
  if (!abs.startsWith(UPLOAD_ROOT + path.sep)) return null
  return { rel, abs }
}

// Bytes actually on disk for an org — the source of truth the nightly
// reconciliation compares the stored counter against.
const measureOrg = (orgId) => {
  const dir = path.join(UPLOAD_ROOT, String(orgId))
  let bytes = 0
  let files = 0
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { bytes: 0, files: 0 }
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      bytes += fs.statSync(path.join(dir, entry.name)).size
      files += 1
    } catch { /* raced with a delete */ }
  }
  return { bytes, files }
}

const removeStored = async (orgId, filename) => {
  const target = resolveStored(String(orgId), String(filename))
  if (!target) return false
  try {
    await fs.promises.unlink(target.abs)
    return true
  } catch {
    return false
  }
}

module.exports = {
  UPLOAD_ROOT,
  dirForOrg,
  safeFilename,
  urlFor,
  resolveStored,
  measureOrg,
  removeStored
}
