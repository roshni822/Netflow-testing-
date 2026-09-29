'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')
const { currentAccess, transactions } = require('./context')
let pool

function connectionOptions (variable = 'DATABASE_URL') {
  const value = process.env[variable]
  if (!value) throw new Error(`${variable} is required`)
  let parsed
  try { parsed = new URL(value) } catch { throw new Error(`${variable} must be a PostgreSQL URL`) }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('PostgreSQL URL required')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  // Prevent URL sslmode parameters overriding certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) parsed.searchParams.delete(key)
  return { connectionString: parsed.toString(), ssl: local && process.env.PGSSL_LOCAL !== '1' ? false : {
    rejectUnauthorized: true, ...(process.env.PGSSL_CA_FILE ? { ca: fs.readFileSync(path.resolve(__dirname, '..', process.env.PGSSL_CA_FILE), 'utf8') } : {})
  }, max: Number(process.env.PGPOOL_MAX || 10), connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000, application_name: 'netflow', statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30000) }
}
function getPool () {
  if (!pool) {
    pool = new Pool(connectionOptions())
    pool.on('error', error => console.error('PostgreSQL pool connection failed', { code: error.code || 'POOL_ERROR' }))
  }
  return pool
}

async function transaction (fn, options = {}) {
  const existing = transactions.getStore()
  if (existing) {
    if (require('./layout').organizationSchemas() && JSON.stringify(currentAccess()) !== existing.accessKey) {
      throw Object.assign(new Error('Database scope cannot change within a transaction'), { code: 'DATABASE_SCOPE_SWITCH' })
    }
    const pending = Promise.resolve().then(() => fn(existing.client))
    existing.pending.add(pending)
    pending.then(() => existing.pending.delete(pending), error => { existing.pending.delete(pending); existing.error = error })
    return pending
  }
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    if (options.readOnly) await client.query('SET TRANSACTION READ ONLY')
    const ctx = currentAccess()
    if (!ctx.org && !ctx.system) throw new Error('Database access requires a tenant or an explicit service context')
    await client.query("SELECT set_config('netflow.org_id', $1, true), set_config('netflow.system', $2, true), set_config('TimeZone', 'UTC', true)", [ctx.org || '', ctx.system || ''])
    if (ctx.schema) await require('./fresh/routing').checkTransactionPlacement(client, require('../tenancy/tenantContext').getPlacement())
    const state = { client, pending: new Set(), error: null, accessKey: JSON.stringify(ctx) }
    const result = await transactions.run(state, () => fn(client))
    // Existing helpers intentionally start notification/audit writes without
    // awaiting them. Drain those writes before commit or releasing this client.
    while (state.pending.size) await Promise.allSettled([...state.pending])
    if (state.error) throw state.error
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}
const query = (sql, values = []) => transaction(client => client.query(sql, values))
async function connect () {
  const client = await getPool().connect()
  try {
    const { rows } = await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')
    if (rows[0].rolsuper || rows[0].rolbypassrls) {
      throw Object.assign(new Error('DATABASE_URL must use a non-superuser role without BYPASSRLS'), { code: 'DATABASE_ROLE_UNSAFE' })
    }
    if (require('./layout').organizationSchemas()) {
      await require('./fresh/setup').verifySchema(client)
      const unsafe = await client.query(`SELECT EXISTS(SELECT 1 FROM pg_namespace n WHERE (n.nspname IN ('platform','system','public') OR n.nspname ~ '^tenant_')
        AND (pg_has_role(current_user,n.nspowner,'MEMBER') OR has_schema_privilege(current_user,n.oid,'CREATE')))
        OR has_database_privilege(current_user,current_database(),'CREATE')
        OR EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication))
        OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE (n.nspname IN ('platform','system') OR n.nspname ~ '^tenant_') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS unsafe`)
      if (unsafe.rows[0].unsafe) throw Object.assign(new Error('Runtime credentials have administrative privileges'), { code: 'DATABASE_ROLE_UNSAFE' })
    } else await client.query('SELECT 1 FROM netflow_migration.schema_versions LIMIT 1')
  } finally { client.release() }
}
async function close () { if (pool) { const old = pool; pool = undefined; await old.end() } }
module.exports = { connectionOptions, getPool, transaction, query, connect, close }
