// Automated checklist test harness (shared).
// Extends the existing plain-Node test convention (fetch + PostgreSQL + a tiny
// check() recorder) used by isolation.test.js / _verifyStep9.js. Every check is
// tagged with a checklist TC ID (e.g. "TSK-011") so runAll.js can stamp the
// result back into NetFlow-Testing-Checklist.xlsx.
//
// Safety: all test data is namespaced (qa-* orgs, *@qa.test emails) and wiped
// before + after each suite. Nothing outside the qa-* namespace is ever touched.

require('../../config/environment')()

const jwt = require('jsonwebtoken')
const speakeasy = require('speakeasy')

const { runWithOrgId } = require('../../tenancy/tenantContext')

const Organization = require('../../models/Organization')
const User = require('../../models/User')
const Role = require('../../models/Role')
const Form = require('../../models/Form')
const FormDraft = require('../../models/FormDraft')
const FormResponse = require('../../models/FormResponse')
const Workflow = require('../../models/Workflow')
const WorkflowExecution = require('../../models/WorkflowExecution')
const Task = require('../../models/Task')
const Notification = require('../../models/Notification')
const AuditLog = require('../../models/AuditLog')
const WebhookIdempotency = require('../../models/WebhookIdempotency')
const WebhookDeliveryLog = require('../../models/WebhookDeliveryLog')
const IntegrationDeadLetter = require('../../models/IntegrationDeadLetter')

// 127.0.0.1 (not "localhost") avoids Node's IPv6-first resolution missing an
// IPv4-only listener.
const API = process.env.TEST_API_URL || 'http://127.0.0.1:5000/api'
const QA_SUB_PREFIX = 'qa-'
const QA_EMAIL_DOMAIN = 'qa.test'
const DEFAULT_PASSWORD = 'QaTest@12345'

const TENANT_MODELS = [
  Role, User, Form, FormDraft, FormResponse, Workflow,
  WorkflowExecution, Task, Notification, AuditLog,
  WebhookIdempotency, WebhookDeliveryLog, IntegrationDeadLetter
]

// ── result recording ─────────────────────────────────────────────────────────
const results = {}     // tcId -> { status: 'Pass'|'Fail', note }
let passed = 0
let failed = 0

// Record a TC outcome. A TC is Fail if ANY of its checks fail; once Fail it
// stays Fail. Notes accumulate the first failing reason.
const record = (tcId, ok, note) => {
  const prev = results[tcId]
  if (ok) {
    if (!prev || prev.status !== 'Fail') results[tcId] = { status: 'Pass', note: prev?.note || '' }
  } else {
    results[tcId] = { status: 'Fail', note: (prev?.note ? prev.note + ' | ' : '') + (note || 'assertion failed') }
  }
}

// check(tcId, name, condition[, extra]) — asserts and records under the TC ID.
const check = (tcId, name, cond, extra = '') => {
  if (cond) {
    passed++
    console.log(`  PASS  ${tcId}  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${tcId}  ${name}${extra ? ` — ${extra}` : ''}`)
  }
  record(tcId, cond, cond ? '' : `${name}${extra ? ` — ${extra}` : ''}`)
}

// Mark a TC as Pending/Skip/Blocked with a reason (things AI can't do here).
const note = (tcId, status, reason) => {
  results[tcId] = { status, note: reason || '' }
  console.log(`  ${status.toUpperCase()}  ${tcId}  ${reason || ''}`)
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const api = async (method, p, token, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })
  let json = null
  try { json = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body: json }
}

// Raw POST that sends an arbitrary (possibly malformed) string body.
const apiRaw = async (method, p, token, rawBody, contentType = 'application/json') => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: rawBody
  })
  let json = null
  try { json = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body: json }
}

const waitForServer = async (tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await api('GET', '/health')
      if (r.status) return true
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error(`Server not reachable at ${API} after ${tries} tries`)
}

// ── DB lifecycle ─────────────────────────────────────────────────────────────
const connect = async () => {
  if (process.env.NETFLOW_ALLOW_INTEGRATION_TEST_DB !== '1' || !process.env.TEST_DATABASE_URL || !process.env.TEST_API_URL) throw new Error('Set NETFLOW_ALLOW_INTEGRATION_TEST_DB=1, TEST_DATABASE_URL and TEST_API_URL for an isolated PostgreSQL test deployment')
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  await require('../../database/postgres').connect()
  return require('../../database/postgres').getPool()
}
const disconnect = async () => { await require('../../database/postgres').close() }

const roleCache = new Map()
const roleId = async (name) => {
  if (roleCache.has(name)) return roleCache.get(name)
  const r = await Role.findOne({ name }).lean()
  const id = r?._id || null
  roleCache.set(name, id)
  return id
}

// ── namespaced fixtures ──────────────────────────────────────────────────────
let orgSeq = 0
const uniqueSub = (label) => `${QA_SUB_PREFIX}${label}-${Date.now().toString(36)}-${orgSeq++}`

// Create a qa organization (never the default org). extra can set allowedDomains,
// features, limits, status, etc.
const createOrg = async (label, extra = {}) => {
  return Organization.create({
    name: `QA ${label}`,
    subdomain: uniqueSub(label),
    ...extra
  })
}

// Roles that could build forms/workflows before builder seats existed. Fixtures
// default to the post-migration state for these roles (canBuild = true) so a
// suite that is not about licensing does not have to know licensing exists.
const LEGACY_BUILDER_ROLES = ['Admin', 'CEO', 'Manager', 'HR', 'VP']

// Create a user inside an org's tenant context so orgId is stamped. For MFA
// (Admin) users, pass mfaEnabled:true — a TOTP secret is generated and returned
// on the doc as `._mfaSecret` for later logins.
const createUser = async (org, opts = {}) => {
  const {
    name = 'QA User',
    email,
    roleName = 'Employee',
    department = 'IT',
    password = DEFAULT_PASSWORD,
    managerId,
    hrId,
    isActive = true,
    mfaEnabled = false,
    mustChangePassword = false,
    canBuild = LEGACY_BUILDER_ROLES.includes(roleName)
  } = opts

  const rid = await roleId(roleName)
  if (!rid) throw new Error(`Role "${roleName}" not seeded — run npm run seed`)

  const mfaSecret = mfaEnabled ? speakeasy.generateSecret({ length: 20 }).base32 : null

  const user = await runWithOrgId(org._id, () => User.create({
    name,
    email: String(email).toLowerCase(),
    password,
    department,
    role: rid,
    managerId: managerId || undefined,
    hrId: hrId || undefined,
    isActive,
    mfaEnabled,
    mfaSecret: mfaSecret || undefined,
    mustChangePassword,
    canBuild
  }))
  user._mfaSecret = mfaSecret
  return user
}

const emailIn = (org, local) => `${local}@${QA_EMAIL_DOMAIN}`

// ── auth ─────────────────────────────────────────────────────────────────────
// Logs a user in and returns a real session token, completing MFA verify when
// the account has MFA enabled.
const getToken = async ({ email, password = DEFAULT_PASSWORD, subdomain, mfaSecret }) => {
  const r = await api('POST', '/auth/login', null, { email, password, subdomain })
  if (r.body?.token) return r.body.token
  if (r.body?.mfaRequired) {
    const code = speakeasy.totp({ secret: mfaSecret, encoding: 'base32' })
    const v = await api('POST', '/auth/mfa/verify', null, { challenge: r.body.challenge, code })
    return v.body?.token || null
  }
  return null
}

const decodeJwt = (token) => { try { return jwt.decode(token) } catch { return null } }

// ── async helpers ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Poll fn() until it returns a truthy value or the timeout elapses. Used because
// the task routes advance the workflow engine fire-and-forget (not awaited), so
// downstream effects (next-stage task, execution status) settle a beat later.
const waitUntil = async (fn, { timeout = 12000, interval = 200 } = {}) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const v = await fn()
    if (v) return v
    await sleep(interval)
  }
  return null
}

// ── cleanup ──────────────────────────────────────────────────────────────────
// Removes every qa-* organization and all records stamped with their orgIds.
// Runs with NO ambient tenant context, so the org-scope plugin does not narrow
// these deletes; the filters name orgId explicitly.
const wipeQa = async () => {
  const orgs = await Organization.find({ subdomain: new RegExp(`^${QA_SUB_PREFIX}`) }).lean()
  if (orgs.length) {
    const ids = orgs.map((o) => o._id)
    for (const model of TENANT_MODELS) {
      await model.deleteMany({ orgId: { $in: ids } }).setOptions({ skipOrgScope: true })
    }
    await Organization.deleteMany({ _id: { $in: ids } })
  }
}

// ── run wrapper ──────────────────────────────────────────────────────────────
// Wraps a suite body: connect, wait for server, clean slate, run, always clean
// up, then emit machine-readable results for the runner and exit with the right
// code. Never leaves qa data behind, even on error.
const runSuite = async (label, body) => require('../../database/context').withSystemAccess('test', async () => {
  console.log(`\n=== ${label} ===`)
  let connected = false
  try {
    await connect()
    connected = true
    await waitForServer()
    await wipeQa()
    await body()
  } catch (err) {
    console.error(`SUITE ERROR (${label}):`, err.stack || err.message)
    // Record a synthetic failure so the runner sees the suite didn't finish.
    record(`${label}-SUITE`, false, err.message)
    failed++
  } finally {
    if (connected) { try { await wipeQa() } catch { /* best effort */ } }
    await disconnect()
  }
  console.log(`\n${label}: ${passed} passed, ${failed} failed`)
  // Machine-readable line consumed by runAll.js.
  console.log(`__RESULTS__ ${JSON.stringify(results)}`)
  process.exit(failed > 0 ? 1 : 0)
})

module.exports = {
  API, DEFAULT_PASSWORD, QA_SUB_PREFIX, QA_EMAIL_DOMAIN,
  speakeasy, runWithOrgId,
  Organization, User, Role, Form, FormDraft, FormResponse, Workflow,
  WorkflowExecution, Task, Notification, AuditLog,
  WebhookIdempotency, WebhookDeliveryLog, IntegrationDeadLetter,
  api, apiRaw, waitForServer, connect, disconnect, roleId,
  createOrg, createUser, emailIn, getToken, decodeJwt, wipeQa,
  check, note, record, runSuite, sleep, waitUntil
}
