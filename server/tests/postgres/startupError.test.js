'use strict'
const assert = require('node:assert/strict')
const startupError = require('../../database/startupError')

const unsafe = startupError({ code: 'DATABASE_ROLE_UNSAFE' })
assert.equal(unsafe.code, 'DATABASE_ROLE_UNSAFE')
assert.match(unsafe.hint, /restricted LOGIN/)
assert.match(unsafe.hint, /SETUP_DATABASE_URL/)
assert.match(startupError({ code: '42501' }).hint, /permissions/)
assert.match(startupError({ code: 'PLATFORM_BOOTSTRAP_REQUIRED' }).hint, /db:fresh bootstrap/)
assert.match(startupError({ code: 'FRESH_SCHEMA_MISMATCH' }).hint, /do not overwrite/)

const secret = 'postgresql://private-user:private-password@private-host/database'
for (const code of [undefined, '28P01', 'UNKNOWN_DRIVER_ERROR']) {
  const diagnostic = startupError(Object.assign(new Error(secret), { code, detail: secret }))
  assert.equal(diagnostic.code, code || 'DATABASE_STARTUP_FAILED')
  assert.ok(diagnostic.hint)
  assert.ok(!JSON.stringify(diagnostic).includes(secret), 'Never log raw driver messages or details')
}
console.log('PASS: actionable startup diagnostics without connection secrets')
