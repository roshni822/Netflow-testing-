'use strict'

// Isolated tests: real JWT verification and route code, in-memory persistence.
// No .env, database, provider requests or application files are modified.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')
const express = require('express')
const apiResponse = require('../utils/apiResponse')
const secret = crypto.randomBytes(32).toString('hex')

function load (file, dependencies) {
  const sandbox = { module: { exports: {} }, process: { env: { JWT_SECRET: secret, MS_TENANT_ID: 'test-tenant' } }, console,
    require: name => {
      if (!(name in dependencies)) throw new Error('Unexpected dependency: ' + name)
      return dependencies[name]
    } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file })
  return sandbox.module.exports
}

function fixture (fresh = false) {
  const user = { _id: fresh ? '1'.repeat(24) : 'user-one', orgId: 'org-one', isActive: true, tokenVersion: 0,
    activeSessions: ['session-one', 'session-two'], role: { name: 'Employee' },
    save: async () => {} }
  let present = true
  const query = () => ({ select () { return this }, populate () { return this },
    lean: async () => present ? { ...user } : null,
    then (resolve, reject) { return Promise.resolve(present ? user : null).then(resolve, reject) } })
  const User = { findById: query, findOne: query, updateOne: async (_filter, update) => {
    if (update.$push?.activeSessions) user.activeSessions.push(update.$push.activeSessions)
  } }
  const auth = load('utils/sessionAuth.js', { jsonwebtoken: jwt, '../models/User': User,
    '../database/layout': { organizationSchemas: () => fresh },
    // Directory/placement isolation is exercised by the real PostgreSQL suite;
    // this unit fixture isolates token/profile validation.
    '../database/fresh/routing': { withClaims: async (_claims, fn) => fn() } })
  const sign = (overrides = {}, options = {}) => jwt.sign({ id: user._id, tv: 0, sid: 'session-one', ...overrides }, secret, { expiresIn: '10m', ...options })
  const challenge = purpose => jwt.sign({ id: user._id, tv: user.tokenVersion, mfa: purpose }, secret, { expiresIn: '10m' })
  return { user, User, auth, sign, challenge, remove: () => { present = false } }
}

test('completed sessions work; challenges, old token shapes, wrong signatures and expired tokens do not', async () => {
  const f = fixture()
  assert.equal((await f.auth.authenticateSession(f.sign())).currentSessionId, 'session-one')
  const invalid = [f.challenge('verify'), f.challenge('setup'),
    f.sign({ sid: undefined }), f.sign({ tv: undefined }), f.sign({ tv: '0' }),
    f.sign({ mfa: 'verify' }), f.sign({ sso: 'ms' }), f.sign({}, { expiresIn: -1 }),
    jwt.sign({ id: f.user._id, tv: 0, sid: 'session-one' }, 'different-key', { expiresIn: '10m' }),
    jwt.sign({ id: f.user._id, tv: 0, sid: 'session-one' }, secret)]
  for (const token of invalid) await assert.rejects(f.auth.authenticateSession(token), { code: 'INVALID_TOKEN' })
})

test('single-device revocation preserves other sessions; account-wide revocation rejects both', async () => {
  const f = fixture()
  f.user.activeSessions = ['session-two']
  await assert.rejects(f.auth.authenticateSession(f.sign()), { code: 'SESSION_REVOKED' })
  assert.ok(await f.auth.authenticateSession(f.sign({ sid: 'session-two' })))
  f.user.tokenVersion++
  await assert.rejects(f.auth.authenticateSession(f.sign({ sid: 'session-two' })), { code: 'TOKEN_REVOKED' })
})

test('inactive and deleted accounts cannot authenticate', async () => {
  const f = fixture()
  f.user.isActive = false
  await assert.rejects(f.auth.authenticateSession(f.sign()), { code: 'ACCOUNT_DEACTIVATED' })
  f.remove()
  await assert.rejects(f.auth.authenticateSession(f.sign()), { code: 'USER_NOT_FOUND' })
})

test('MFA challenges require the correct purpose and current account version', () => {
  const f = fixture()
  const claims = f.auth.verifyMfaChallenge(f.challenge('verify'), 'verify')
  f.auth.validateTokenUser(claims, f.user)
  assert.throws(() => f.auth.verifyMfaChallenge(f.challenge('setup'), 'verify'), { code: 'MFA_BAD_CHALLENGE' })
  assert.throws(() => f.auth.verifyMfaChallenge(f.sign(), 'verify'), { code: 'MFA_BAD_CHALLENGE' })
  f.user.tokenVersion++
  assert.throws(() => f.auth.validateTokenUser(claims, f.user), { code: 'TOKEN_REVOKED' })
})

test('fresh platform sessions require a matching explicit scope and no organization claim', async () => {
  const f = fixture(true)
  f.user.orgId = null
  f.user.accountScope = 'platform'
  assert.ok(await f.auth.authenticateSession(f.sign({ scope: 'platform' })))
  for (const claims of [{}, { scope: 'tenant', org: 'some-org' }, { scope: 'platform', org: 'some-org' }]) {
    await assert.rejects(f.auth.authenticateSession(f.sign(claims)), { code: 'ACCOUNT_SCOPE_MISMATCH' })
  }
  f.user.accountScope = 'tenant'
  await assert.rejects(f.auth.authenticateSession(f.sign({ scope: 'platform' })), { code: 'ACCOUNT_SCOPE_MISMATCH' })
})

function response () {
  return { statusCode: 200, status (code) { this.statusCode = code; return this },
    json (body) { this.body = body; return this }, setHeader () {}, removeHeader () {},
    sendFile (file) { this.file = file }, download (file) { this.file = file },
    clearCookie () {}, redirect (url) { this.redirectUrl = url } }
}

test('file route enforces revocation and tenant boundaries; signed links remain independent', async () => {
  const f = fixture()
  const router = load('routes/files.js', { express, fs: { existsSync: () => true }, path,
    '../utils/sessionAuth': f.auth, '../utils/apiResponse': apiResponse,
    '../utils/documentAccess': { verify: async (_path, _org, key) => key === 'fixture-signature', canRead: async (_path, user, org) => user.orgId === org },
    '../utils/fileStore': { resolveStored: (org, name) => ({ rel: org + '/' + name, abs: '/fixture/file.txt' }),
      verifyPath: (_rel, key) => key === 'fixture-signature' } })
  const handler = router.stack.find(layer => layer.route?.methods.get).route.stack[0].handle
  const call = async (token, org = f.user.orgId, key) => {
    const res = response()
    await handler({ headers: token ? { authorization: 'Bearer ' + token } : {},
      params: { orgId: org, filename: 'file.txt' }, query: { k: key } }, res, error => { throw error })
    return res
  }
  assert.equal((await call(f.sign())).file, '/fixture/file.txt')
  assert.equal((await call(f.sign(), 'other-org')).statusCode, 403)
  assert.equal((await call(f.challenge('verify'))).statusCode, 403)
  f.user.activeSessions = []
  assert.equal((await call(f.sign())).statusCode, 403)
  assert.equal((await call(null, f.user.orgId, 'fixture-signature')).file, '/fixture/file.txt')
  f.user.activeSessions = ['session-one']
  f.user.tokenVersion++
  assert.equal((await call(f.sign())).statusCode, 403)
  f.user.isActive = false
  assert.equal((await call(f.sign({ tv: 1 }))).statusCode, 403)
})

test('Microsoft SSO callback still issues a registered session accepted by shared validation', async () => {
  const f = fixture()
  const dependencies = { express, jsonwebtoken: jwt, crypto, speakeasy: {}, qrcode: {},
    '../models/User': f.User, '../models/Role': {}, '../models/Organization': {}, '../models/AuditLog': {},
    '../middleware/auth': { protect: (_req, _res, next) => next() }, '../utils/sessionAuth': f.auth,
    '../middleware/rateLimit': { authLimiter: (_req, _res, next) => next() }, '../utils/apiResponse': apiResponse,
    '../utils/emailService': {}, '../utils/defaultOrg': {}, '../middleware/tenant': {}, '../middleware/quota': {},
    '../middleware/licence': {}, '../utils/departments': {}, '../utils/roleProvisioning': {},
    '../utils/roleCapabilities': {}, '../utils/passwordPolicy': {},
    '../database/fresh/authentication': { authGate: (_req, _res, next) => next(), accountClaims: () => ({}) },
    '../database/layout': { organizationSchemas: () => false },
    '../database/postgres': { query: async () => ({ rows: [{ user_id: f.user._id }] }), transaction: work => work() },
    '../utils/msSso': { isConfigured: () => true, verifyState: () => true,
      acquireTokenByCode: async () => ({ idTokenClaims: { tid: 'test-tenant', oid: 'test-object' } }), emailFromResult: () => 'fixture@example.test' } }
  const router = load('routes/auth.js', dependencies)
  const callback = router.stack.find(layer => layer.route?.path === '/oauth/microsoft/callback').route.stack[0].handle
  const res = response()
  await callback({ query: { state: 'fixture-state', code: 'fixture-code' } }, res)
  const token = new URL(res.redirectUrl).hash.slice('#token='.length)
  const user = await f.auth.authenticateSession(token)
  assert.ok(f.user.activeSessions.includes(user.currentSessionId))
})
