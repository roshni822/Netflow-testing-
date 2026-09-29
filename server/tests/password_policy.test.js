// Pure policy + real route-handler tests. All persistence is in-memory; no DB,
// email, real reset links, or real user accounts are accessed.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const bcrypt = require('bcryptjs')
const policy = require('../utils/passwordPolicy')

async function main() {
  const clientPath = path.resolve(__dirname, '../../frontend/src/utils/passwordPolicy.js')
  const client = await import(pathToFileURL(clientPath).href)
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../utils/passwordPolicy.js'), 'utf8').split('module.exports =')[0].trim()
  const clientSource = fs.readFileSync(clientPath, 'utf8').split('export {')[0].trim()
  assert.equal(serverSource, clientSource, 'Frontend and backend policy implementations must stay identical')
  assert.equal(policy.MIN_PASSWORD_LENGTH, 12)
  const boundary = 'cedar-river-' + 'x'.repeat(60)
  assert.equal(Buffer.byteLength(boundary), 72)
  const unicodeBoundary = Array.from({ length: 24 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('')
  const cases = [
    [undefined, 'PASSWORD_REQUIRED'], [null, 'PASSWORD_REQUIRED'], [{}, 'PASSWORD_REQUIRED'],
    [123456789012, 'PASSWORD_REQUIRED'], [['cedar river moon'], 'PASSWORD_REQUIRED'], ['', 'PASSWORD_REQUIRED'],
    ['short', 'PASSWORD_TOO_SHORT'], ['cedar river', 'PASSWORD_TOO_SHORT'],
    ['🌱🌲🌳🌴🌵🌷🌸🌹🌺🌻🌼', 'PASSWORD_TOO_SHORT'],
    ['password1234', 'PASSWORD_TOO_COMMON'], ['Password123!', 'PASSWORD_TOO_COMMON'],
    ['P@ssw0rd12345!', 'PASSWORD_TOO_COMMON'], ['welcome123456', 'PASSWORD_TOO_COMMON'],
    ['123456789012', 'PASSWORD_TOO_COMMON'], ['qwertyuiopasdfghjkl', 'PASSWORD_TOO_COMMON'],
    ['abcdefghijklmnop', 'PASSWORD_TOO_COMMON'], ['abcabcabcabc', 'PASSWORD_TOO_COMMON'],
    ['🌱'.repeat(12), 'PASSWORD_TOO_COMMON'], [' '.repeat(12), 'PASSWORD_TOO_COMMON'],
    ['correct horse battery staple', 'PASSWORD_TOO_COMMON'],
    ['cedar river!', ''], ['cedar river moon', ''], ['  cedar river moon  ', ''],
    ['🌱🌲🌳🌴🌵🌷🌸🌹🌺🌻🌼🌽', ''], [boundary, ''], [unicodeBoundary, ''],
    [boundary + 'x', 'PASSWORD_TOO_LONG'], [unicodeBoundary + 'x', 'PASSWORD_TOO_LONG']
  ]
  for (const [value, code] of cases) {
    const result = policy.getPasswordPolicy(value)
    assert.equal(result.code, code, 'Policy case failed: ' + JSON.stringify(value))
    assert.deepEqual(client.getPasswordPolicy(value), result, 'Client/server parity')
  }

  // Do not connect to optional external services during isolated route tests.
  delete process.env.REDIS_URL
  process.env.JWT_SECRET = 'isolated-password-policy-test-secret'
  const User = require('../models/User')
  const router = require('../routes/auth')
  const originals = { findOne: User.findOne, findById: User.findById, updateOne: User.updateOne }
  let account, queries = 0, saves = 0, sessions = 0, savedPassword, resetFilter
  const oldPassword = 'existing cedar valley'
  async function fresh(forced = false) {
    queries = saves = sessions = 0
    savedPassword = undefined
    account = {
      _id: 'isolated-user', mustChangePassword: forced, tokenVersion: 7,
      password: await bcrypt.hash(oldPassword, 4),
      resetPasswordToken: User.hashResetToken('isolated-reset-token'), resetPasswordExpires: new Date(Date.now() + 60000),
      comparePassword(candidate) { return bcrypt.compare(candidate, this.password) },
      async save() { saves++; savedPassword = this.password; this.password = await bcrypt.hash(this.password, 4) },
      toJSON() { return { _id: this._id, mustChangePassword: this.mustChangePassword } }
    }
  }
  User.findById = () => { queries++; return { populate: async () => account } }
  User.findOne = (filter) => {
    queries++; resetFilter = filter
    return { select: async () => account && filter.resetPasswordToken === account.resetPasswordToken && account.resetPasswordExpires > filter.resetPasswordExpires.$gt ? account : null }
  }
  User.updateOne = async () => { sessions++ }
  const invoke = async (routePath, body) => {
    const route = router.stack.find((layer) => layer.route?.path === routePath && layer.route.methods.post).route
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this }, json(value) { this.body = value; return this } }
    // Exercise the actual route handler after authentication/rate-limit middleware.
    await route.stack.at(-1).handle({ body, user: { _id: 'isolated-user' } }, response, (error) => { throw error })
    return response
  }
  const reset = (password, token = 'isolated-reset-token') => invoke('/reset-password', { password, token, email: 'fixture@example.test' })
  const change = (newPassword, currentPassword = oldPassword) => invoke('/change-password', { newPassword, currentPassword })
  try {
    for (const [value, code] of cases.filter(([, code]) => code)) {
      await fresh()
      const changed = await change(value)
      assert.equal(changed.statusCode, 400)
      assert.equal(changed.body.code, ['PASSWORD_REQUIRED', 'PASSWORD_TOO_SHORT'].includes(code) ? 'WEAK_PASSWORD' : code)
      const restored = await reset(value)
      assert.equal(restored.statusCode, 400)
      assert.equal(restored.body.code, !value ? 'MISSING_FIELDS' : code)
      assert.equal(queries, 0, 'Invalid policy must be rejected before lookup, hashing, or reset-token consumption')
      assert.equal(saves, 0)
      assert.equal(account.tokenVersion, 7)
    }
    await fresh()
    assert.equal((await change('cedar river!', 'incorrect')).body.code, 'INVALID_CURRENT_PASSWORD')
    assert.equal((await change('cedar river!', '')).body.code, 'MISSING_CURRENT_PASSWORD')
    assert.equal((await change(oldPassword)).body.code, 'SAME_PASSWORD')
    assert.equal((await reset(oldPassword)).body.code, 'SAME_PASSWORD')
    assert.equal(saves, 0)
    assert.ok(account.resetPasswordToken, 'Rejected reuse preserves reset link')
    assert.equal((await reset('cedar river!', 'invalid-token')).body.code, 'INVALID_RESET_TOKEN')
    account.resetPasswordExpires = new Date(0)
    assert.equal((await reset('cedar river!')).body.code, 'INVALID_RESET_TOKEN')
    assert.equal(saves, 0)

    for (const forced of [false, true]) {
      await fresh(forced)
      if (forced) assert.equal((await invoke('/change-password', { newPassword: oldPassword })).body.code, 'SAME_PASSWORD')
      const result = await invoke('/change-password', { newPassword: 'cedar river!', ...(forced ? {} : { currentPassword: oldPassword }) })
      assert.equal(result.statusCode, 200)
      assert.ok(result.body.token)
      assert.equal(account.mustChangePassword, false)
      assert.equal(account.tokenVersion, 8)
      assert.equal(saves, 1)
      assert.equal(sessions, 1)
      assert.equal(await account.comparePassword('cedar river!'), true)
    }
    for (const password of ['  cedar river moon  ', boundary, unicodeBoundary]) {
      await fresh()
      const result = await reset(password)
      assert.equal(result.statusCode, 200)
      assert.equal(savedPassword, password, 'Never trim or silently truncate the chosen password')
      assert.equal(account.tokenVersion, 8)
      assert.equal(account.resetPasswordToken, null)
      assert.equal(account.resetPasswordExpires, null)
      assert.equal(saves, 1)
      assert.equal(sessions, 0)
      assert.equal(resetFilter.email, 'fixture@example.test')
      assert.equal((await reset('another cedar river')).body.code, 'INVALID_RESET_TOKEN', 'Reset token is single-use')
    }
    console.log('Password policy passed: 12-character boundary, Unicode/UTF-8 limit, local blocklist, frontend/server parity, direct API rejection, current-password verification/reuse, forced change, token preservation/expiry/consumption, session revocation. No real DB writes.')
  } finally { Object.assign(User, originals) }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
