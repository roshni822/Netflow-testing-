// Shared - Phase 2 - utils/apiResponse.js
// Every route MUST use these to keep response shape consistent.

const sendSuccess = (res, data = {}, statusCode = 200) => {
  return res.status(statusCode).json({ success: true, ...data })
}

// `extra` carries machine-readable context the client needs to react rather than
// just print — e.g. a LIMIT_REACHED body ships { resource, limit, used, plan } so
// the UI can offer "contact your admin to upgrade" instead of a bare message.
const sendError = (res, error, code = 'BAD_REQUEST', statusCode = 400, extra = null) => {
  const body = { success: false, error, code }
  if (extra && typeof extra === 'object') Object.assign(body, extra)
  return res.status(statusCode).json(body)
}

module.exports = { sendSuccess, sendError }
