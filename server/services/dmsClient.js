// API-compatible DMS client — NetFlow → DMS document pipeline.
// When DMS_ENABLED !== 'true', every method no-ops (returns null) so local
// /uploads behaviour stays unchanged for pure local development.

const fs = require('fs')
const path = require('path')
const { normalizeEndpoint, fetchEndpoint } = require('./dmsEndpoint')

const isEnabled = () => String(process.env.DMS_ENABLED || '').toLowerCase() === 'true'

const baseUrl = () => String(process.env.DMS_API_URL || '').replace(/\/$/, '')

const boundedMs = (value, fallback, min, max) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

// DMS ingestion may synchronously classify and file a document before returning.
// Ten seconds was too short for real PDFs and produced false failures even though
// the DMS had already stored the file. Keep the values configurable for providers
// with different latency profiles while retaining bounded production defaults.
const uploadTimeoutMs = () => boundedMs(process.env.DMS_UPLOAD_TIMEOUT_MS, 60000, 1000, 180000)
const uploadRecoveryWindowMs = () => boundedMs(process.env.DMS_UPLOAD_RECOVERY_WINDOW_MS, 15000, 0, 60000)
const uploadRecoveryIntervalMs = () => boundedMs(process.env.DMS_UPLOAD_RECOVERY_INTERVAL_MS, 1000, 100, 5000)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isConfiguredFor = (org, department = null) => {
  if (!isEnabled()) return false
  if (org?.integrations?.dmsBaseUrl && org.integrations.dmsEnabled !== true) return false
  const root = resolveBaseUrl(org, department)
  if (!root) return false
  const key = resolveApiKey(org, department)
  const token = resolveJwt(org, department)
  return Boolean(key || token)
}

// Finds the per-department DMS config entry for a given department name.
// Returns null when no entry exists or the department is disabled.
const resolveDeptConfig = (org, department) => {
  if (!department || !org?.integrations?.departmentDms?.length) return null
  const wanted = String(department).toLowerCase().trim()
  const entry = org.integrations.departmentDms.find(
    (d) => String(d.department || '').toLowerCase().trim() === wanted
  )
  // disabled entries are treated as non-existent for routing purposes
  if (!entry || entry.enabled === false) return null
  return entry
}

// Resolves the DMS API key for a given org + department.
// Priority: department key → org key → platform env key.
const resolveApiKey = (org, department) => {
  // 1. Department-level key
  if (department) {
    const deptCfg = resolveDeptConfig(org, department)
    if (deptCfg?.apiKey && String(deptCfg.apiKey).trim()) return String(deptCfg.apiKey).trim()
  }
  // A different department server must supply its own credential.
  if (department && resolveDeptConfig(org, department)?.baseUrl && resolveBaseUrl(org, department) !== resolveBaseUrl(org)) return ''
  // 2. Org-level key
  const fromOrg = org?.integrations?.dmsApiKey || org?.dmsApiKey
  if (fromOrg && String(fromOrg).trim()) return String(fromOrg).trim()
  // Explicit tenant endpoints never inherit platform credentials.
  return org?.integrations?.dmsBaseUrl ? '' : String(process.env.DMS_API_KEY || '').trim()
}

// Resolves the DMS base URL for a given org + department.
// A department may point to a completely different DMS server.
// Priority: department baseUrl → organization endpoint → legacy platform default.
const resolveBaseUrl = (org, department) => {
  if (department) {
    const deptCfg = resolveDeptConfig(org, department)
    if (deptCfg?.baseUrl && String(deptCfg.baseUrl).trim()) {
      return String(deptCfg.baseUrl).trim().replace(/\/$/, '')
    }
  }
  return String(org?.integrations?.dmsBaseUrl || '').trim().replace(/\/+$/, '') || baseUrl()
}

const resolveJwt = (org, department) => {
  if (department && resolveBaseUrl(org, department) !== resolveBaseUrl(org)) return ''
  return String(org?.integrations?.dmsJwt || '').trim() || (org?.integrations?.dmsBaseUrl ? '' : String(process.env.DMS_JWT || '').trim())
}

// Do not silently redirect an existing connection's document IDs to another server.
const assertEndpointChange = (org, nextEndpoint) => {
  const next = normalizeEndpoint(nextEndpoint)
  const current = resolveBaseUrl(org)
  const hasCredentials = Boolean(resolveApiKey(org) || resolveJwt(org))
  if (current && hasCredentials && (next || baseUrl()) !== current) {
    throw new DmsError('This organization already has a DMS connection. Endpoint changes require a separate document migration.', { code: 'DMS_ENDPOINT_MIGRATION_REQUIRED', status: 409 })
  }
  return next
}

// Builds the DMS folder path: "<orgSlug>/<department>"
// orgSlug = org.integrations.dmsOrgSlug if set, else org.subdomain
// department is lowercased and sanitised to a safe folder name.
const buildDmsFolder = (orgSlug, department) => {
  if (!orgSlug) return null
  const slug = String(orgSlug).toLowerCase().trim()
  if (!department) return slug
  const dept = String(department).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
  return `${slug}/${dept}`
}

class DmsError extends Error {
  constructor(message, { status = 0, code = 'DMS_ERROR', body = null } = {}) {
    super(message)
    this.name = 'DmsError'
    this.status = status
    this.code = code
    this.body = body
  }
}

const withTimeout = async (ms, fn) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fn(controller.signal)
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new DmsError(`DMS request timed out after ${ms}ms`, { status: 504, code: 'DMS_TIMEOUT' })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const parseJsonSafe = async (res) => {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function dmsFetch(pathname, {
  method = 'GET',
  headers = {},
  body,
  apiKey,
  rootUrl,   // department-specific DMS server URL override
  user,
  org,       // tenant context for dynamic resolution
  jwtToken,  // tenant-specific DMS JWT override
  timeoutMs = 5000,
  formData = false,
  quiet = false,
} = {}) {
  if (!isEnabled()) return null

  const root = rootUrl || (org ? resolveBaseUrl(org) : baseUrl())
  if (!root) throw new DmsError('DMS_API_URL is not configured', { code: 'DMS_MISCONFIGURED' })
  const sameConnection = !org || root === resolveBaseUrl(org)
  const key = apiKey !== undefined ? apiKey : (sameConnection ? resolveApiKey(org) : '')
  const tokenToUse = jwtToken !== undefined ? jwtToken : (sameConnection ? resolveJwt(org) : '')

  if (!key && !tokenToUse) {
    throw new DmsError('DMS authentication not configured', { status: 401, code: 'DMS_UNAUTHORIZED' })
  }

  const url = `${root}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  const hdrs = { ...headers }
  if (key) hdrs['X-Api-Key'] = key
  if (tokenToUse) hdrs['Authorization'] = `Bearer ${tokenToUse}`
  if (user?.name) hdrs['X-On-Behalf-Of'] = String(user.name)
  if (user?.email) hdrs['X-On-Behalf-Of-Email'] = String(user.email)

  const started = Date.now()
  const res = await withTimeout(timeoutMs, (signal) =>
    (org?.integrations?.dmsBaseUrl || root !== baseUrl() ? fetchEndpoint : fetch)(url, { method, headers: hdrs, body, signal, redirect: 'error' })
  )
  const json = await parseJsonSafe(res)
  const ms = Date.now() - started

  if (process.env.DMS_DEBUG === '1') {
    console.debug(`[dms] ${method} ${pathname} → ${res.status} (${ms}ms)`)
  }

  if (!res.ok) {
    const code = json.code || json.error?.code || `DMS_HTTP_${res.status}`
    const message = json.error || json.message || json.detail || `DMS HTTP ${res.status}`
    if (!quiet) console.warn(`[dms] ${method} ${pathname} failed`, res.status, code, message)
    throw new DmsError(message, { status: res.status, code, body: json })
  }

  return json
}

/**
 * Lightweight connectivity check — calls GET /health on the DMS API.
 * Returns true on 2xx, false on any error. Never throws.
 * @param {object} [opts]
 * @param {object} [opts.org] - for per-org API key
 */
async function ping({ org } = {}) {
  if (!isEnabled()) return false
  if (org?.integrations?.dmsBaseUrl) {
    try {
      await testConnection({ baseUrl: org.integrations.dmsBaseUrl, apiKey: resolveApiKey(org), jwtToken: resolveJwt(org), orgSlug: org.integrations.dmsOrgSlug, timeoutMs: 3000 })
      return true
    } catch { return false }
  }
  try {
    await dmsFetch('/health', { apiKey: resolveApiKey(org), org, timeoutMs: 3000, quiet: true })
    return true
  } catch (err) {
    require('fs').appendFileSync('ping-error.log', new Date().toISOString() + ' - Ping failed: ' + (err.stack || err.message || err) + '\n');
    console.error('DMS Ping Failed:', err.message || err);
    return false
  }
}

// Builds the exact effective configuration used by the pre-save connection
// check. Keeping this next to the runtime resolver prevents receipts from being
// issued for a different API key or base URL than the request actually tested.
const connectionConfig = ({ apiKey, jwtToken, orgSlug, baseUrl: endpoint } = {}) => {
  const custom = normalizeEndpoint(endpoint)
  return {
    apiKey: String(apiKey || '').trim() || (custom ? '' : String(process.env.DMS_API_KEY || '').trim()),
    jwtToken: String(jwtToken || '').trim() || (custom ? '' : String(process.env.DMS_JWT || '').trim()),
    rootUrl: custom || baseUrl(),
    orgSlug: String(orgSlug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
  }
}

// Unlike ping(), this calls an authenticated, read-only endpoint so a healthy
// DMS with an invalid tenant credential cannot be reported as connected.
async function testConnection({ apiKey, jwtToken, orgSlug, baseUrl: endpoint, timeoutMs = 10000 } = {}) {
  if (!isEnabled()) {
    throw new DmsError('DMS is disabled on this server', { status: 503, code: 'DMS_DISABLED' })
  }

  const effective = connectionConfig({ apiKey, jwtToken, orgSlug, baseUrl: endpoint })
  if (!effective.rootUrl) {
    throw new DmsError('DMS API URL is not configured', { status: 503, code: 'DMS_MISCONFIGURED' })
  }
  if (!effective.apiKey && !effective.jwtToken) {
    throw new DmsError('DMS authentication is not configured', { status: 401, code: 'DMS_UNAUTHORIZED' })
  }

  const org = {
    subdomain: effective.orgSlug || 'connection-test',
    integrations: {
      dmsEnabled: true,
      dmsBaseUrl: normalizeEndpoint(endpoint),
      dmsApiKey: effective.apiKey,
      dmsJwt: effective.jwtToken,
      dmsOrgSlug: effective.orgSlug
    }
  }

  const response = await dmsFetch('/documents?limit=1&offset=0', {
    apiKey: effective.apiKey,
    jwtToken: effective.jwtToken,
    rootUrl: effective.rootUrl,
    org,
    timeoutMs,
    quiet: true
  })

  const documents = response?.documents ?? response?.data?.documents ?? response?.items
  if (!Array.isArray(documents)) {
    throw new DmsError('DMS does not implement the expected document-list API.', { status: 422, code: 'DMS_INCOMPATIBLE_API' })
  }

  return {
    checks: [
      { key: 'configuration', status: 'passed' },
      { key: 'authentication', status: 'passed' },
      { key: 'readAccess', status: 'passed' }
    ]
  }
}

const externalRefQuery = ({ taskId, formResponseId, workflowId, id } = {}) => {
  const usp = new URLSearchParams({ app: 'netflow' })
  if (taskId) usp.set('taskId', String(taskId))
  if (formResponseId) usp.set('formResponseId', String(formResponseId))
  if (workflowId) usp.set('workflowId', String(workflowId))
  if (id) usp.set('id', String(id))
  return [...usp.keys()].length > 1 ? usp : null
}

const unpackDocument = (json) => {
  if (!json || typeof json !== 'object') return null
  return json.document || json.data?.document || json.data || json
}

const documentId = (doc, json = {}) => {
  const duplicate = json?.duplicateOf
  return doc?.id || doc?._id || doc?.dmsDocId ||
    (typeof duplicate === 'string' ? duplicate : duplicate?.id || duplicate?._id || duplicate?.dmsDocId) ||
    null
}

async function findByRefOnConnection(ref, {
  org,
  user,
  apiKey,
  rootUrl,
  jwtToken,
  timeoutMs = 5000,
  quiet = false
} = {}) {
  const usp = externalRefQuery(ref)
  if (!usp) return null

  try {
    const json = await dmsFetch(`/documents/by-external-ref?${usp}`, {
      apiKey: apiKey !== undefined ? apiKey : resolveApiKey(org),
      rootUrl,
      jwtToken,
      org,
      user,
      timeoutMs,
      quiet
    })
    return unpackDocument(json)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

async function recoverTimedOutUpload(ref, options = {}) {
  if (!externalRefQuery(ref)) return null
  const windowMs = boundedMs(options.recoveryWindowMs, uploadRecoveryWindowMs(), 0, 60000)
  const intervalMs = boundedMs(options.recoveryIntervalMs, uploadRecoveryIntervalMs(), 10, 5000)
  const deadline = Date.now() + windowMs

  do {
    try {
      const doc = await findByRefOnConnection(ref, {
        ...options,
        timeoutMs: Math.min(5000, Math.max(1000, windowMs || 1000)),
        quiet: true
      })
      if (documentId(doc)) return doc
    } catch (error) {
      // Authentication/configuration failures are definitive. A transient read
      // failure remains subordinate to the original upload timeout.
      if (['DMS_UNAUTHORIZED', 'DMS_MISCONFIGURED', 'DMS_DISABLED'].includes(error.code)) throw error
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await wait(Math.min(intervalMs, remaining))
  } while (Date.now() <= deadline)

  return null
}

/**
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {string} opts.filename
 * @param {string} [opts.mime]
 * @param {object} [opts.user]
 * @param {object} [opts.ref] - taskId, formResponseId, workflowId, id
 * @param {object} [opts.org] - for per-org API key
 * @param {string} [opts.department] - user's department (e.g. 'hr', 'finance')
 * @param {string} [opts.orgSubdomain] - org subdomain used as DMS folder root
 */
async function uploadFile({
  filePath,
  filename,
  mime,
  user,
  ref = {},
  org,
  department,
  orgSubdomain,
  timeoutMs,
  recoveryWindowMs,
  recoveryIntervalMs,
  quiet = false
} = {}) {
  if (!isEnabled()) return null

  // Resolve department-specific DMS credentials first, then fall back to org/env.
  const deptApiKey  = resolveApiKey(org, department)
  const deptRootUrl = resolveBaseUrl(org, department)

  const buf = await fs.promises.readFile(filePath)
  const blob = new Blob([buf], { type: mime || 'application/octet-stream' })
  const fd = new FormData()
  fd.append('file', blob, filename || path.basename(filePath))
  // Department-based folder routing: tells DMS which sub-folder to store the
  // file in, e.g. "acme/hr". The folder is also embedded in sourceRef so the
  // DMS side can enforce the same layout independently.
  const dmsOrgSlug = org?.integrations?.dmsOrgSlug || orgSubdomain || null
  const dmsFolder = resolveDeptConfig(org, department)?.folder || buildDmsFolder(dmsOrgSlug, department)

  fd.append('sourceRef', JSON.stringify({
    app: 'netflow',
    ...(department ? { department: String(department).toLowerCase().trim() } : {}),
    ...(dmsOrgSlug ? { orgSlug: dmsOrgSlug } : {}),
    ...(ref.taskId ? { taskId: String(ref.taskId) } : {}),
    ...(ref.formResponseId ? { formResponseId: String(ref.formResponseId) } : {}),
    ...(ref.workflowId ? { workflowId: String(ref.workflowId) } : {}),
    ...(ref.id ? { id: String(ref.id) } : {}),
  }))

  // Some DMS implementations route by a top-level "folder" field.
  if (dmsFolder) fd.append('folder', dmsFolder)

  let json
  let recoveredAfterTimeout = false
  try {
    json = await dmsFetch('/documents/upload', {
      method: 'POST',
      body: fd,
      formData: true,
      apiKey: deptApiKey,       // department-specific or org fallback
      org,
      rootUrl: deptRootUrl,     // department-specific server or global URL
      user,
      timeoutMs: boundedMs(timeoutMs, uploadTimeoutMs(), 10, 180000),
      quiet,
    })
  } catch (error) {
    if (error.code !== 'DMS_TIMEOUT') throw error
    const recovered = await recoverTimedOutUpload(ref, {
      org,
      user,
      apiKey: deptApiKey,
      rootUrl: deptRootUrl,
      recoveryWindowMs,
      recoveryIntervalMs
    })
    if (!recovered) throw error
    recoveredAfterTimeout = true
    json = { document: recovered }
    console.warn('[dms] upload response timed out; recovered stored document by source reference')
  }

  const doc = unpackDocument(json)
  const id = documentId(doc, json)
  if (!id) {
    throw new DmsError('DMS upload returned no document id', { code: 'DMS_EMPTY', body: json })
  }

  let viewUrl = null
  await require('../database/fresh/documentConnections').register(String(id),org,department)
  try {
    viewUrl = await signedUrl(id, { mode: 'view', org, user, department })
  } catch {
    viewUrl = null
  }

  return {
    id: String(id),
    name: doc.name || filename,
    mime: doc.mime || mime || 'application/octet-stream',
    size: doc.size != null ? Number(doc.size) : buf.length,
    type: doc.type || null,
    channel: doc.channel || null,
    externalRef: doc.externalRef || doc.sourceRef || null,
    folder: doc.folder || dmsFolder || null,  // ← department-based folder path
    url: viewUrl,
    duplicateOf: json.duplicateOf || doc.duplicateOf || null,
    extraction: json.extraction || null,
    recoveredAfterTimeout,
  }
}

async function signedUrl(dmsDocId, { mode = 'view', org, user, department } = {}) {
  if (!isEnabled() || !dmsDocId) return null
  const connections=require('../database/fresh/documentConnections')
  if(connections.scoped(org)) department=await connections.resolve(dmsDocId,org)

  const q = mode === 'download' ? 'mode=download' : 'mode=view'
  const json = await dmsFetch(`/documents/${encodeURIComponent(dmsDocId)}/url?${q}`, {
    apiKey: resolveApiKey(org, department),
    rootUrl: resolveBaseUrl(org, department),
    jwtToken: resolveJwt(org, department),
    org,
    user,
    timeoutMs: 5000,
  })

  const url = json.url || json.data?.url || null
  const signed = json.signed !== false
  if (url && signed) {
    if (org?.integrations?.dmsBaseUrl || resolveBaseUrl(org, department) !== baseUrl()) {
      let target
      try { target = new URL(String(url), resolveBaseUrl(org, department) + '/') } catch {
        throw new DmsError('DMS returned an invalid document URL', { code: 'DMS_INVALID_ENDPOINT', status: 422 })
      }
      if (target.username || target.password) {
        throw new DmsError('DMS document URL must not contain credentials', { code: 'DMS_INVALID_ENDPOINT', status: 422 })
      }
      normalizeEndpoint(target.origin + target.pathname)
      return target.href
    }
    return String(url)
  }

  const root = resolveBaseUrl(org, department)
  const suffix = mode === 'download' ? '?download=1' : ''
  return `${root}/documents/${encodeURIComponent(dmsDocId)}/file${suffix}`
}

async function getDoc(dmsDocId, { org, user, department } = {}) {
  if (!isEnabled() || !dmsDocId) return null
  const connections=require('../database/fresh/documentConnections')
  if(connections.scoped(org)) department=await connections.resolve(dmsDocId,org)
  return dmsFetch(`/documents/${encodeURIComponent(dmsDocId)}`, {
    apiKey: resolveApiKey(org,department),rootUrl:resolveBaseUrl(org,department),jwtToken:resolveJwt(org,department),
    org,
    user,
  })
}

async function findByRef({ taskId, formResponseId, workflowId, id } = {}, { org, user, department } = {}) {
  if (!isEnabled()) return null
  return findByRefOnConnection({ taskId, formResponseId, workflowId, id }, { org, user,
    apiKey: resolveApiKey(org,department),rootUrl:resolveBaseUrl(org,department),jwtToken:resolveJwt(org,department),quiet:true })
}

async function postEvent(dmsDocId, { type, actor, detail, meta } = {}, { org, department } = {}) {
  if (!isEnabled() || !dmsDocId || !type) return null
  const connections=require('../database/fresh/documentConnections')
  if(connections.scoped(org)) department=await connections.resolve(dmsDocId,org)

  const actorPayload = actor && typeof actor === 'object'
    ? {
        id: actor._id ? String(actor._id) : actor.id || undefined,
        name: actor.name || undefined,
        email: actor.email || undefined,
      }
    : actor

  return dmsFetch(`/documents/${encodeURIComponent(dmsDocId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      actor: actorPayload,
      detail: detail || undefined,
      meta: meta || undefined,
    }),
    apiKey: resolveApiKey(org,department),rootUrl:resolveBaseUrl(org,department),jwtToken:resolveJwt(org,department),
    org,
    user: typeof actor === 'object' ? actor : undefined,
    timeoutMs: 5000,
  })
}

const MB = 1024 * 1024

/** Normalize assorted DMS usage/quota payloads into bytes. */
const parseUsagePayload = (json) => {
  if (!json || typeof json !== 'object') return null
  const root = json.data || json.usage || json.stats || json
  const storage =
    root.storage ||
    root.Storage ||
    (root.resource === 'storage' ? root : null) ||
    root.resources?.storage ||
    null

  const pickBytes = (...candidates) => {
    for (const c of candidates) {
      if (c == null || c === '') continue
      const n = Number(c)
      if (Number.isFinite(n) && n >= 0) return n
    }
    return null
  }

  // Prefer explicit byte fields; fall back to MB fields.
  let usedBytes = pickBytes(
    storage?.usedBytes, storage?.bytes, storage?.usageBytes,
    root.storageBytes, root.usedBytes, root.bytes,
    storage?.usage, root.usage
  )
  let limitBytes = pickBytes(
    storage?.limitBytes, storage?.quotaBytes,
    root.storageLimitBytes, root.limitBytes, root.quotaBytes,
    storage?.limit, root.limit
  )

  if (usedBytes == null) {
    const usedMb = pickBytes(storage?.usedMb, storage?.used, root.usedMb, root.storageMb)
    if (usedMb != null) usedBytes = usedMb * MB
  }
  if (limitBytes == null) {
    const limitMb = pickBytes(storage?.limitMb, root.limitMb, root.storageLimitMb)
    if (limitMb != null) limitBytes = limitMb * MB
  }

  // If "usage"/"limit" look like MB (small integers) vs bytes, prefer treating
  // values < 10_000 without a unit as MB only when a sibling *Mb field exists —
  // otherwise leave as bytes when already set above.
  if (usedBytes == null && limitBytes == null) return null

  return {
    usedBytes: usedBytes != null ? usedBytes : 0,
    limitBytes: limitBytes != null ? limitBytes : null,
    documentCount: pickBytes(root.documentCount, root.documents, root.count, storage?.documents),
    organizationId: root.organizationId || storage?.organizationId || null,
    raw: json,
  }
}

/**
 * List documents visible to the configured API key (paginated).
 * @returns {{ documents: object[], total: number|null }}
 */
async function listDocuments({ org, user, department, limit = 100, offset = 0, page } = {}) {
  if (!isEnabled()) return null
  const usp = new URLSearchParams()
  usp.set('limit', String(Math.min(Math.max(Number(limit) || 100, 1), 200)))
  if (page != null) usp.set('page', String(page))
  else usp.set('offset', String(Math.max(0, Number(offset) || 0)))

  const json = await dmsFetch(`/documents?${usp}`, {
    apiKey: resolveApiKey(org, department),
    rootUrl: resolveBaseUrl(org, department),
    jwtToken: resolveJwt(org, department),
    quiet: true,
    org,
    user,
    timeoutMs: 10000,
  })
  const documents = json.documents || json.data?.documents || json.items || []
  const total = json.total ?? json.count ?? json.data?.total ?? null
  return { documents: Array.isArray(documents) ? documents : [], total: total != null ? Number(total) : null, raw: json }
}

/**
 * Real storage used in the connected DMS for the API key's organization.
 * Prefers GET /usage|/stats when the key is accepted; otherwise sums document.size.
 */
async function getStorageUsage({ org, user } = {}) {
  if (!isEnabled()) return null

  // DMS /usage + /stats currently require a user JWT, not X-Api-Key. Opt in if
  // the configured server exposes them to service keys (avoids two failed round-trips).
  if (String(process.env.DMS_USAGE_ENDPOINT || '').toLowerCase() === 'true') {
    const key = resolveApiKey(org)
    for (const path of ['/usage', '/stats']) {
      try {
        const json = await dmsFetch(path, { apiKey: key, org, user, timeoutMs: 5000, quiet: true })
        const parsed = parseUsagePayload(json)
        if (parsed) {
          return {
            enabled: true,
            source: path.slice(1),
            usedBytes: parsed.usedBytes,
            usedMb: parsed.usedBytes / MB,
            limitBytes: parsed.limitBytes,
            limitMb: parsed.limitBytes != null ? parsed.limitBytes / MB : null,
            documentCount: parsed.documentCount,
            organizationId: parsed.organizationId,
          }
        }
      } catch (err) {
        if (process.env.DMS_DEBUG === '1') {
          console.debug(`[dms] getStorageUsage ${path} skipped:`, err.status || err.message)
        }
      }
    }
  }

  let offset = 0
  let page = 1
  let usedBytes = 0
  let documentCount = 0
  let organizationId = null
  const seen = new Set()
  const maxPages = 50

  for (let i = 0; i < maxPages; i += 1) {
    const batch = await listDocuments({ org, user, limit: 100, offset, page })
    if (!batch) break
    const docs = batch.documents
    if (!docs.length) break

    for (const doc of docs) {
      const id = doc.id || doc._id
      if (id && seen.has(String(id))) continue
      if (id) seen.add(String(id))
      usedBytes += Number(doc.size || doc.fileSize || doc.bytes || 0) || 0
      documentCount += 1
      if (!organizationId && doc.organizationId) organizationId = String(doc.organizationId)
    }

    if (docs.length < 100) break
    // Prefer offset when the API honours it; also bump page for page-based APIs.
    offset += docs.length
    page += 1
  }

  const customLimit = Number(process.env.DMS_QUOTA_MB)
  const limitBytes = (customLimit && !Number.isNaN(customLimit) && customLimit > 0) ? customLimit * MB : null

  return {
    enabled: true,
    source: 'documents_sum',
    usedBytes,
    usedMb: usedBytes / MB,
    limitBytes,
    limitMb: limitBytes ? customLimit : null,
    documentCount,
    organizationId,
  }
}

/**
 * Fetch the real folder tree from the connected DMS using DMS_JWT if available.
 */
async function getFoldersTree({ org, user } = {}) {
  if (!isEnabled()) return null

  try {
    // The /folders endpoint requires the JWT token for authentication
    const json = await dmsFetch('/folders', { 
      org,
      user,
      timeoutMs: 5000, 
      quiet: true 
    })
    
    // Convert the tree response structure to match what NetFlow expects
    if (json && json.tree) {
      return json.tree
    }
    return null
  } catch (err) {
    console.warn(`[dms] getFoldersTree failed:`, err.status || err.message)
    return null
  }
}

async function deleteDoc(dmsDocId, { org, user, department } = {}) {
  if (!isEnabled() || !dmsDocId) return null
  const connections=require('../database/fresh/documentConnections')
  if(connections.scoped(org)) department=await connections.resolve(dmsDocId,org)
  return dmsFetch(`/documents/${encodeURIComponent(dmsDocId)}`, {
    method: 'DELETE',
    apiKey: resolveApiKey(org,department),rootUrl:resolveBaseUrl(org,department),jwtToken:resolveJwt(org,department),
    org,
    user,
    timeoutMs: 10000,
  })
}

module.exports = {
  isEnabled,
  isConfiguredFor,
  resolveApiKey,
  resolveBaseUrl,
  resolveJwt,
  assertEndpointChange,
  normalizeEndpoint,
  resolveDeptConfig,
  buildDmsFolder,
  ping,
  connectionConfig,
  testConnection,
  uploadFile,
  signedUrl,
  getDoc,
  deleteDoc,
  findByRef,
  postEvent,
  listDocuments,
  getStorageUsage,
  getFoldersTree,
  DmsError,
}
