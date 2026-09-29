'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { validateProduction } = require('../config/production')
const { isPublicAddress, safeRequest } = require('../utils/safeHttp')
const good = () => ({ NODE_ENV: 'production', JWT_SECRET: crypto.randomBytes(48).toString('hex'), FILE_URL_SECRET: crypto.randomBytes(48).toString('hex'), CLIENT_URL: 'https://localhost:8443', DATABASE_URL: 'postgresql://runtime@localhost/netflow' })
test('production refuses incomplete and unsafe configuration without exposing secrets', () => {
  assert.doesNotThrow(() => validateProduction(good()))
  for (const patch of [{ JWT_SECRET: 'short' }, { FILE_URL_SECRET: '' }, { CLIENT_URL: 'http://localhost' }, { CLIENT_URL: 'https://localhost/path' }, { DISABLE_RATE_LIMIT: '1' }, { SERVE_LEGACY_UPLOADS: '1' }, { WEBHOOK_ALLOW_PRIVATE: 'true' }, { MS_CLIENT_ID: 'incomplete' }]) {
    assert.throws(() => validateProduction({ ...good(), ...patch }), { code: 'PRODUCTION_CONFIG_INVALID' })
  }
  const env = good(); env.FILE_URL_SECRET = env.JWT_SECRET
  assert.throws(() => validateProduction(env), /independent signing secrets/)
})
test('webhooks reject private, reserved and IPv4-mapped IPv6 destinations', async () => {
  for (const address of ['127.0.0.1', '0.0.0.0', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(isPublicAddress(address), false, address)
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    for (const url of ['http://8.8.8.8', 'https://user:password@8.8.8.8', 'https://127.0.0.1', 'https://[::1]']) await assert.rejects(safeRequest({ url }))
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous }
})
test('SSO state is bound to the initiating browser and cannot be reused without its nonce', () => {
  const previous = process.env.JWT_SECRET
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
  try {
    const sso = require('../utils/msSso')
    const nonce = crypto.randomBytes(32).toString('hex'), state = sso.signState(nonce)
    assert.equal(sso.verifyState(state, nonce), true)
    assert.equal(sso.verifyState(state), false)
    assert.equal(sso.verifyState(state, crypto.randomBytes(32).toString('hex')), false)
  } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous }
})
