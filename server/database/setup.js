'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const VERSION = '001'
const schemaFile = path.join(__dirname, 'migrations/001_initial.sql')
const releaseFile = path.join(__dirname, 'migrations/002_release_controls.sql')
const checksum = value => crypto.createHash('sha256').update(value).digest('hex')

async function applySchema (client) {
  const sql = fs.readFileSync(schemaFile, 'utf8')
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('netflow:schema-setup'))")
    const existing = await client.query("SELECT to_regclass('netflow_migration.schema_versions') AS present")
    if (existing.rows[0].present) {
      const version = await client.query('SELECT checksum FROM netflow_migration.schema_versions WHERE version=$1', [VERSION])
      if (version.rows[0]?.checksum !== checksum(sql)) throw Object.assign(new Error('Existing schema differs; use a fresh target or a reviewed upgrade migration'), { code: 'SCHEMA_MISMATCH' })
      await applyRelease(client)
      await client.query('COMMIT')
      return { alreadyApplied: true }
    }
    // CREATE SCHEMA intentionally refuses any conflicting partial installation.
    // There are no DROP, TRUNCATE or old-data import operations in this tool.
    await client.query(sql)
    await client.query('INSERT INTO netflow_migration.schema_versions(version,checksum) VALUES($1,$2)', [VERSION, checksum(sql)])
    await applyRelease(client)
    await client.query('COMMIT')
    return { applied: true }
  } catch (error) { await client.query('ROLLBACK'); throw error }
}

async function applyRelease (client) {
  const sql = fs.readFileSync(releaseFile, 'utf8')
  const result = await client.query('SELECT checksum FROM netflow_migration.schema_versions WHERE version=$1', ['002'])
  if (result.rows.length) {
    if (result.rows[0].checksum !== checksum(sql)) throw Object.assign(new Error('Release migration checksum differs'), { code: 'SCHEMA_MISMATCH' })
    return
  }
  await client.query(sql)
  await client.query('INSERT INTO netflow_migration.schema_versions(version,checksum) VALUES($1,$2)', ['002', checksum(sql)])
}

function guardTarget (args, runtime = false) {
  if (!['development', 'staging', 'production'].includes(process.env.SETUP_ENV)) throw Object.assign(new Error('Configure SETUP_ENV as development, staging or production'), { code: 'SETUP_ENV_REQUIRED' })
  if (process.env.SETUP_ENV === 'production' && !args.includes('--confirm-production')) throw Object.assign(new Error('Explicit production confirmation required'), { code: 'PRODUCTION_CONFIRMATION_REQUIRED' })
  const label = process.env.SETUP_TARGET
  const index = args.indexOf('--target')
  if (!label || index < 0 || args[index + 1] !== label) throw Object.assign(new Error('Confirm SETUP_TARGET with --target'), { code: 'TARGET_LABEL_REQUIRED' })
  const prefix = runtime ? 'DATABASE' : 'SETUP_DATABASE'
  let url
  try { url = new URL(process.env[`${prefix}_URL`]) } catch { throw Object.assign(new Error('Database connection configuration is missing'), { code: 'CONNECTION_REQUIRED' }) }
  const expected = ['HOST', 'NAME', 'USER'].map(key => process.env[`${prefix}_${key}`])
  if (expected.some(value => !value)) throw Object.assign(new Error('Configure independently verified target host, database and user'), { code: 'TARGET_IDENTITY_REQUIRED' })
  const actual = [url.hostname, decodeURIComponent(url.pathname.slice(1)), decodeURIComponent(url.username)]
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || actual.some((value, i) => value !== expected[i])) throw Object.assign(new Error('Database target identity does not match'), { code: 'TARGET_MISMATCH' })
  return label
}

module.exports = { VERSION, schemaFile, checksum, applySchema, guardTarget }
