'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const jwt = require('jsonwebtoken')

async function httpChecks (owner, appURL, loginCredentials) {
  const secret = crypto.randomBytes(32).toString('hex')
  const port = 15549
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '../..'), windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP,
      NODE_ENV: 'test', NETFLOW_SKIP_DOTENV: '1', DATABASE_URL: appURL,
      JWT_SECRET: secret, PAUSE_BACKGROUND_JOBS: '1', PORT: String(port), DMS_ENABLED: 'false',
      CLIENT_URL: 'http://127.0.0.1:15549', SERVE_LEGACY_UPLOADS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let failedCode
  server.on('error', error => { failedCode = error.code })
  // Never print server output: errors from existing integrations can contain PII.
  let output = ''
  server.stdout.on('data', data => { output = (output + data.toString()).slice(-12000) })
  server.stderr.on('data', data => { output = (output + data.toString()).slice(-12000) })
  const call = async (route, token, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers } })
    return { status: response.status, body: await response.json() }
  }
  try {
    let ready = false
    for (let i = 0; i < 80; i++) {
      if (failedCode || server.exitCode !== null) throw new Error('Isolated HTTP server failed to start: ' + (failedCode || server.exitCode))
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(ready, 'Isolated HTTP server readiness')
    assert.equal((await call('/forms')).status, 401)
    let loginToken
    if (loginCredentials) {
      const login = await call('/auth/login', null, { method: 'POST', body: JSON.stringify(loginCredentials) })
      if (login.status !== 200) console.error(JSON.stringify({ phase: 'password-login', status: login.status, code: login.body.code }))
      assert.equal(login.status, 200, 'New administrator signs in with a real password check')
      assert.ok(login.body.token, 'Login issues a session token')
      loginToken = login.body.token
      assert.equal((await call('/auth/me', login.body.token)).status, 200)
    }
    const { rows: users } = await owner.query("SELECT u.id, u.org_id, a.token_version, r.name AS role FROM netflow.users u JOIN netflow_private.user_auth a ON a.owner_id=u.id JOIN netflow.roles r ON r.id=u.role WHERE u.is_active IS DISTINCT FROM false AND (r.name IN ('Admin','CEO','SuperAdmin')) ORDER BY u.created_at")
    const admin = users.find(u => u.org_id && u.role === 'Admin')
    assert.ok(admin, 'Isolated test administrator available')
    const fixtureSession = async user => {
      const sid = crypto.randomBytes(16).toString('hex')
      await owner.query(`INSERT INTO netflow_private.user_sessions(owner_id, tenant_id, position, session_id)
        SELECT $1, $2, COALESCE(MAX(position), -1) + 1, $3 FROM netflow_private.user_sessions WHERE owner_id=$1`, [user.id, user.org_id, sid])
      return jwt.sign({ id: user.id, tv: Number(user.token_version || 0), org: user.org_id, sid }, secret, { expiresIn: '10m' })
    }
    const token = await fixtureSession(admin)
    const routes = ['/auth/me', '/users', '/roles', '/departments', '/forms', '/workflows', '/tasks/my-tasks', '/notifications', '/audit-logs', '/analytics/summary', '/analytics/completion-time', '/analytics/sla-breaches', '/analytics/approval-rate', '/analytics/activity', '/analytics/department-kpis', '/analytics/workflow-control-tower', '/team', '/usage']
    const failures = []
    for (const route of routes) {
      const result = await call(route, token)
      if (result.status !== 200) failures.push({ route, status: result.status, code: result.body.code })
    }
    if (failures.length) console.error(JSON.stringify({ phase: 'http-contracts', failures }))
    assert.deepEqual(failures, [], 'HTTP API compatibility')
    const orgForms = await owner.query('SELECT id, status FROM netflow.forms WHERE org_id=$1 ORDER BY created_at DESC', [admin.org_id])
    if (orgForms.rows.length) {
      const formId = orgForms.rows[0].id
      const draft = await call(`/forms/${formId}/draft`, token, { method: 'PUT', body: JSON.stringify({ formData: {} }) })
      if (draft.status !== 200) console.error(JSON.stringify({ phase: 'draft-write', status: draft.status, code: draft.body.code }))
      assert.equal(draft.status, 200, 'Form draft upsert in disposable SQL database')
      assert.equal((await call(`/forms/${formId}/draft`, token)).status, 200)
    }
    assert.equal((await call('/auth/product-tour/complete', token, { method: 'POST', body: '{}' })).status, 200)
    const platform = users.find(u => u.role === 'SuperAdmin')
    if (platform) {
      const platformToken = await fixtureSession(platform)
      for (const route of ['/platform/health', '/platform/orgs', '/platform/overview', '/platform/historical-stats', '/platform/activity', '/platform/plans', '/platform/admins']) {
        const result = await call(route, platformToken)
        if (result.status !== 200) console.error(JSON.stringify({ phase: 'platform-http', route, status: result.status, code: result.body.code }))
        assert.equal(result.status, 200, route + ': ' + result.body.code)
      }
      assert.equal((await call('/forms', platformToken)).status, 403, 'Platform accounts retain shell restrictions')
      assert.equal((await call('/platform/health', token)).status, 403, 'Tenant administrators cannot access platform operations')
      const newOrg = {
        name: 'Isolated platform creation', subdomain: 'qa-platform-create',
        allowedDomains: ['qa.test'], adminEmail: 'new-admin@qa.test',
        adminName: 'Isolated organization administrator', plan: 'basic',
        adminCanBuild: true, countAdminTowardSeats: true
      }
      const create = auth => call('/platform/orgs', auth, { method: 'POST', body: JSON.stringify(newOrg) })
      assert.equal((await create()).status, 401, 'Anonymous callers cannot create organizations')
      assert.equal((await create(token)).status, 403, 'Tenant administrators cannot create organizations')
      const created = await create(platformToken)
      if (created.status !== 201) console.error(JSON.stringify({ phase: 'platform-org-create', status: created.status, code: created.body.code }))
      assert.equal(created.status, 201, 'SuperAdmin can create an organization outside the internal platform tenant')
      const orgId = created.body.org._id
      assert.ok(orgId)
      const records = await owner.query(`SELECT u.org_id, u.must_change_password, u.can_build,
        u.counts_toward_seats, r.name AS role, r.org_id AS role_org,
        a.password, o.admin_user_id = u.id AS linked_admin
        FROM netflow.users u JOIN netflow.roles r ON r.id=u.role
        JOIN netflow_private.user_auth a ON a.owner_id=u.id
        JOIN netflow.organizations o ON o.id=u.org_id WHERE u.org_id=$1`, [orgId])
      assert.equal(records.rowCount, 1)
      const createdAdmin = records.rows[0]
      assert.equal(createdAdmin.role, 'Admin')
      assert.equal(createdAdmin.role_org, orgId)
      assert.ok(createdAdmin.linked_admin && createdAdmin.must_change_password)
      assert.ok(createdAdmin.can_build && createdAdmin.counts_toward_seats)
      assert.ok(await require('bcryptjs').compare(created.body.admin.tempPassword, createdAdmin.password))
      const listed = await call('/platform/orgs', platformToken)
      assert.ok(listed.body.orgs.some(org => org._id === orgId), 'Platform lists the new customer organization')
      assert.ok(listed.body.orgs.some(org => org._id === admin.org_id), 'Platform lists other customer organizations')
      const tenantUsers = await call('/users', token)
      assert.ok(!JSON.stringify(tenantUsers.body).includes(newOrg.adminEmail), 'Tenant user lists remain isolated')
      assert.equal((await create(platformToken)).body.code, 'SUBDOMAIN_TAKEN', 'Retry does not create duplicate organizations')
      console.log('PASS: platform organization creation, restricted caller rejection, admin password hash, tenant isolation and duplicate prevention')
    }
    if (loginToken) {
      const post = (route, auth, body = {}) => call(route, auth, { method: 'POST', body: JSON.stringify(body) })
      const setup = await post('/auth/mfa/setup', loginToken)
      assert.equal(setup.status, 200, 'MFA setup persists the private secret')
      const totp = () => require('speakeasy').totp({ secret: setup.body.manualKey, encoding: 'base32' })
      const enable = await post('/auth/mfa/enable', loginToken, { code: totp() })
      assert.equal(enable.status, 200)
      assert.equal(enable.body.enabled, true)
      assert.equal(enable.body.backupCodes.length, 8)
      const challenge = await post('/auth/login', null, loginCredentials)
      assert.equal(challenge.body.mfaRequired, true)
      assert.equal(challenge.body.token, undefined, 'MFA gate withholds the session token')
      const identity = jwt.decode(loginToken)
      const fileRoute = `/files/${identity.org}/auth-regression-absent.txt`
      assert.equal((await call('/auth/me', challenge.body.challenge)).status, 401, 'MFA challenge is not a session')
      assert.equal((await call(fileRoute, challenge.body.challenge)).status, 403, 'MFA challenge cannot authorize files')
      assert.equal((await post('/auth/mfa/setup', challenge.body.challenge)).status, 401)
      assert.equal((await call(fileRoute, loginToken)).status, 404, 'Valid session reaches file lookup')
      const other = users.find(user => user.org_id && user.org_id !== identity.org && user.role === 'Admin')
      assert.ok(other)
      assert.equal((await call(`/files/${other.org_id}/auth-regression-absent.txt`, loginToken)).status, 403)
      const verified = await post('/auth/mfa/verify', null, { challenge: challenge.body.challenge, code: totp() })
      assert.equal(verified.status, 200, 'TOTP login succeeds')
      assert.equal((await call('/auth/me', verified.body.token)).status, 200)
      for (const field of ['password', 'mfaSecret', 'mfaBackupCodes']) assert.equal(verified.body.user[field], undefined)
      const backup = { challenge: challenge.body.challenge, code: enable.body.backupCodes[0] }
      assert.equal((await post('/auth/mfa/verify', null, backup)).status, 200, 'Backup code works once')
      assert.equal((await post('/auth/mfa/verify', null, backup)).status, 401, 'Used backup code cannot be replayed')
      const rejectedEverywhere = async auth => {
        assert.equal((await call('/auth/me', auth)).status, 401)
        assert.equal((await call(fileRoute, auth)).status, 403)
        assert.equal((await post('/auth/mfa/setup', auth)).status, 401)
        assert.equal((await post('/auth/mfa/enable', auth, { code: totp() })).status, 401)
      }
      assert.equal((await post('/auth/logout', verified.body.token)).status, 200)
      await rejectedEverywhere(verified.body.token)
      assert.equal((await call('/auth/me', loginToken)).status, 200, 'Other device remains signed in')
      await owner.query('UPDATE netflow.users SET is_active=false WHERE id=$1', [identity.id])
      await rejectedEverywhere(loginToken)
      assert.equal((await post('/auth/mfa/verify', null, { challenge: challenge.body.challenge, code: totp() })).status, 401, 'Deactivated account cannot complete MFA')
      await owner.query('UPDATE netflow.users SET is_active=true WHERE id=$1', [identity.id])
      assert.equal((await post('/auth/logout', loginToken, { allDevices: true })).status, 200)
      await rejectedEverywhere(loginToken)
      assert.equal((await post('/auth/mfa/verify', null, { challenge: challenge.body.challenge, code: totp() })).status, 401, 'All-device logout invalidates pending MFA')
      const freshChallenge = await post('/auth/login', null, loginCredentials)
      const fresh = await post('/auth/mfa/verify', null, { challenge: freshChallenge.body.challenge, code: totp() })
      assert.equal(fresh.status, 200, 'Fresh MFA sign-in succeeds after revocation')
      // Seed a reset token only inside this disposable database; exercise the real reset endpoint.
      const resetToken = crypto.randomBytes(32).toString('hex')
      await owner.query('UPDATE netflow_private.user_auth SET reset_password_token=$1, reset_password_expires=$2 WHERE owner_id=$3',
        [crypto.createHash('sha256').update(resetToken).digest('hex'), new Date(Date.now() + 600000), identity.id])
      const reset = await post('/auth/reset-password', null, { token: resetToken, email: loginCredentials.email, password: crypto.randomBytes(24).toString('base64url') + 'Aa1!' })
      assert.equal(reset.status, 200, 'Password reset succeeds')
      await rejectedEverywhere(fresh.body.token)
      assert.equal((await post('/auth/mfa/verify', null, { challenge: freshChallenge.body.challenge, code: totp() })).status, 401, 'Password reset invalidates pending MFA')
      console.log('PASS: MFA challenge rejection, file authorization, enrollment revocation, logout, deactivation and password reset')
    }
    console.log('PASS: isolated HTTP API, password and MFA login, permissions, dashboard/report feeds, forms, workflows, tasks, users, audit and notifications')
  } finally {
    if (server.exitCode === null) {
      server.kill()
      await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 5000).unref() })
    }
  }
}
module.exports = { httpChecks }
