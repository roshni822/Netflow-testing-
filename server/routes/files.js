// Licensing Phase 2 (security) - routes/files.js
// Serves attachments with an access check, replacing the public express.static
// mount for everything uploaded from now on.
//
// Two ways in, because attachments are opened in two very different contexts:
//
//   * a signed capability URL (?k=), which is what gets stored in form data and
//     emailed. It is path-bound, unguessable and works from a plain <a href> or
//     <img src> — neither of which can send an Authorization header.
//   * a bearer token, for fetch/XHR callers. The caller's organization must match
//     the file's and the user must own it, manage documents, or participate in its work.
//
// Either way the request never touches the filesystem until the path has been
// validated by utils/fileStore, so a crafted name cannot escape the upload root.

const express = require('express')
const fs = require('fs')
const path = require('path')
const { authenticateSession } = require('../utils/sessionAuth')
const { sendError } = require('../utils/apiResponse')
const { resolveStored } = require('../utils/fileStore')

const access = require('../utils/documentAccess')
const router = express.Router()
router.use('/:orgId/:filename', async (req, res, next) => {
  if (!require('../database/layout').organizationSchemas()) return next()
  try {
    const placement = await require('../database/fresh/routing').resolvePlacement(req.params.orgId)
    return require('../tenancy/tenantContext').runWithPlacement(placement, next)
  } catch (error) {
    if (error.status) return sendError(res, 'File not found', 'FILE_NOT_FOUND', 404)
    next(error)
  }
})

// Resolves a bearer token to its user without the full `protect` pipeline: this
// route must stay usable when the tenant is read-only, and it makes no writes.
const userFromBearer = async (req) => {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return null
  try {
    return await authenticateSession(header.slice(7))
  } catch {
    return null
  }
}

// GET /api/files/:orgId/:filename[?k=<signature>]
router.get('/:orgId/:filename', async (req, res, next) => {
  try {
    const target = resolveStored(String(req.params.orgId), String(req.params.filename))
    if (!target) return sendError(res, 'File not found', 'FILE_NOT_FOUND', 404)

    let allowed = await access.verify(target.rel, req.params.orgId, req.query.k)

    if (!allowed) {
      const user = await userFromBearer(req)
      if (user && user.isActive !== false) {
        allowed = await access.canRead(target.rel, user, req.params.orgId)
      }
    }

    if (!allowed) {
      return sendError(res, 'Not authorized to view this file', 'FILE_FORBIDDEN', 403)
    }

    if (!fs.existsSync(target.abs)) {
      return sendError(res, 'File not found', 'FILE_NOT_FOUND', 404)
    }

    // Attachments are user-supplied content: never let a browser run one inline
    // in the app's origin, and do not let it sniff a type we did not declare.
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.removeHeader('X-Frame-Options') // Allow embedding in our frontend iframe during split-screen preview
    // A capability URL is stable for the life of the file, so it can be cached —
    // privately, because the file itself is not public.
    res.setHeader('Cache-Control', 'private, no-store')

    const download = String(req.query.download || '') === '1'
    if (download) {
      return res.download(target.abs, path.basename(target.abs))
    }
    return res.sendFile(target.abs)
  } catch (err) {
    next(err)
  }
})

// Authenticated refresh makes legacy stored URLs usable without retaining permanent sharing.
router.post('/:orgId/:filename/link', async (req, res, next) => {
  try {
    const target = resolveStored(String(req.params.orgId), String(req.params.filename))
    const user = await userFromBearer(req)
    if (!target || !await access.canRead(target.rel, user, req.params.orgId)) return sendError(res, 'Document access denied', 'DOCUMENT_FORBIDDEN', 403)
    if (req.body?.revoke === true) await access.revoke(target.rel, req.params.orgId)
    const token = await access.issue(target.rel, req.params.orgId)
    res.json({ success: true, url: `/api/files/${target.rel}?k=${token}`, expiresIn: 300 })
  } catch (error) { next(error) }
})
module.exports = router
