'use strict'
const assert = require('node:assert/strict')
const { guardTarget } = require('../../database/setup')
const { connectionOptions } = require('../../database/postgres')

// Configuration-only checks: no .env files are loaded and no connection is opened.
function setupConfigChecks () {
  const values = {
    SETUP_ENV: 'development', SETUP_TARGET: 'isolated-config-check',
    DATABASE_URL: 'postgresql://test_app@app.invalid/netflow_test',
    DATABASE_HOST: 'app.invalid', DATABASE_NAME: 'netflow_test', DATABASE_USER: 'test_app',
    SETUP_DATABASE_URL: 'postgresql://test_setup@setup.invalid/netflow_test',
    SETUP_DATABASE_HOST: 'setup.invalid', SETUP_DATABASE_NAME: 'netflow_test', SETUP_DATABASE_USER: 'test_setup'
  }
  const tuning = ['PGPOOL_MAX', 'PG_STATEMENT_TIMEOUT_MS', 'PGSSL_CA_FILE', 'PGSSL_LOCAL']
  const keys = [...Object.keys(values), ...tuning]
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const reset = () => {
    for (const key of keys) delete process.env[key]
    Object.assign(process.env, values)
  }
  const args = ['--target', values.SETUP_TARGET]
  try {
    reset()
    for (const environment of ['development', 'staging']) {
      process.env.SETUP_ENV = environment
      assert.equal(guardTarget(args), values.SETUP_TARGET)
      assert.equal(guardTarget(args, true), values.SETUP_TARGET)
    }
    for (const environment of ['']) {
      process.env.SETUP_ENV = environment
      assert.throws(() => guardTarget(args), error => error.code === 'SETUP_ENV_REQUIRED')
    }
    process.env.SETUP_ENV = 'production'
    assert.throws(() => guardTarget(args), error => error.code === 'PRODUCTION_CONFIRMATION_REQUIRED')
    assert.equal(guardTarget([...args, '--confirm-production']), values.SETUP_TARGET)
    reset()
    assert.throws(() => guardTarget([]), error => error.code === 'TARGET_LABEL_REQUIRED')
    assert.throws(() => guardTarget(['--target', 'wrong-project']), error => error.code === 'TARGET_LABEL_REQUIRED')
    for (const runtime of [false, true]) {
      const prefix = runtime ? 'DATABASE' : 'SETUP_DATABASE'
      for (const field of ['HOST', 'NAME', 'USER']) {
        reset()
        delete process.env[`${prefix}_${field}`]
        assert.throws(() => guardTarget(args, runtime), error => error.code === 'TARGET_IDENTITY_REQUIRED')
        reset()
        process.env[`${prefix}_${field}`] = 'wrong-value'
        assert.throws(() => guardTarget(args, runtime), error => error.code === 'TARGET_MISMATCH')
      }
      reset()
      delete process.env[`${prefix}_URL`]
      assert.throws(() => guardTarget(args, runtime), error => error.code === 'CONNECTION_REQUIRED')
    }
    reset()
    for (const key of ['DATABASE_URL', 'SETUP_DATABASE_URL']) {
      const config = connectionOptions(key)
      assert.equal(config.max, 10)
      assert.equal(config.statement_timeout, 30000)
      assert.equal(config.ssl.rejectUnauthorized, true, 'Remote TLS verification remains enabled')
      assert.equal(new URL(config.connectionString).hostname, values[key.replace('_URL', '_HOST')])
    }
    console.log('PASS: simpler configuration names, both setup targets, mismatch rejection, development/staging restriction and secure defaults')
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
module.exports = { setupConfigChecks }
if (require.main === module) setupConfigChecks()
