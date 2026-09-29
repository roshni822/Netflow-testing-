'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { PLATFORM_TABLES, SYSTEM_TABLES, TENANT_TABLES } = require('./manifest')
const VERSION = '001'
const RELEASE = 'organization-schemas-phase-1'
const fail = code => Object.assign(new Error(code), { code })
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')
const migrations = () => [
  { schema: 'platform', version: VERSION, release: RELEASE, sql: read('migrations/001_platform.sql') },
  { schema: 'system', version: VERSION, release: RELEASE, sql: read('migrations/001_system.sql') },
  { schema: 'system', version: VERSION + '-permissions', release: RELEASE, sql: read('runtime-grants.sql') },
  { schema: 'system', version: '002-provisioning', release: 'organization-schemas-phase-2', sql: read('migrations/002_provisioning.sql') },
  { schema: 'system', version: '003-routing', release: 'organization-schemas-phase-3', sql: read('migrations/003_tenant_routing.sql') },
  { schema: 'system', version: '004-integrations', release: 'organization-schemas-phase-4', sql: read('migrations/004_integrations.sql') },
  { schema: 'system', version: '005-management', release: 'organization-schemas-phase-5', sql: read('migrations/005_management.sql') },
  { schema: 'system', version: '006-operations', release: 'organization-schemas-phase-6', sql: read('migrations/006_operations.sql') }
]

async function verifySchema (client) {
  for (const migration of migrations()) {
    const { rows } = await client.query('SELECT checksum,release_id FROM system.schema_migrations WHERE schema_name=$1 AND version=$2 AND scope=$1 AND org_id IS NULL', [migration.schema, migration.version])
    if (rows[0]?.checksum !== digest(migration.sql) || rows[0]?.release_id !== migration.release) throw fail('FRESH_SCHEMA_MISMATCH')
  }
  const rows = (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('platform','system') ORDER BY schemaname,tablename")).rows
  const expected = [...PLATFORM_TABLES.map(t => 'platform.' + t), ...SYSTEM_TABLES.map(t => 'system.' + t)].sort()
  if (JSON.stringify(rows.map(r => r.schemaname + '.' + r.tablename).sort()) !== JSON.stringify(expected)) throw fail('FRESH_TABLE_MANIFEST_MISMATCH')
  return { version: '006', release: 'organization-schemas-phase-6', platformTables: PLATFORM_TABLES.length, systemTables: SYSTEM_TABLES.length, tenantTemplateTables: TENANT_TABLES.length }
}

async function assertEmptyTarget (client) {
  // Provider infrastructure is not application data. Recognize Supabase only by
  // its auth schema plus provider roles; never assume arbitrary schemas are safe.
  const provider = (await client.query("SELECT to_regclass('auth.users') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') AS supabase")).rows[0].supabase
  const allowed = ['public', 'extensions']
  if (provider) allowed.push('auth', 'storage', 'realtime', '_realtime', 'graphql', 'graphql_public', 'vault', 'supabase_functions', 'supabase_migrations', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgmq', 'pgmq_public')
  const namespaces = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'")).rows
  if (namespaces.some(r => !allowed.includes(r.nspname))) throw fail('FRESH_TARGET_NOT_EMPTY')
  const objects = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','extensions') AND c.relkind IN ('r','p','v','m','S','f')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') LIMIT 1`)
  const routines = await client.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','extensions')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') LIMIT 1`)
  const types = await client.query(`SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname IN ('public','extensions') AND t.typtype IN ('e','d')
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e') LIMIT 1`)
  if (objects.rowCount || routines.rowCount || types.rowCount) throw fail('FRESH_TARGET_NOT_EMPTY')
}

async function applyFreshSchema (client) {
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('netflow:fresh-schema-setup'))")
    const installed = (await client.query("SELECT to_regclass('system.schema_migrations') AS present")).rows[0].present
    if (!installed) await assertEmptyTarget(client)
    const files = migrations()
    const applied = installed ? (await client.query('SELECT schema_name,version,checksum,release_id FROM system.schema_migrations WHERE scope<>\'tenant\'')).rows : []
    // Validate every installed checksum before executing any upgrade. Historical
    // files are immutable; a missing baseline is not an invitation to recreate it.
    if (installed && files.slice(0, 3).some(m => !applied.some(r => r.schema_name===m.schema && r.version===m.version))) throw fail('FRESH_SCHEMA_MISMATCH')
    for (const record of applied) {
      const migration = files.find(m => m.schema===record.schema_name && m.version===record.version)
      if (!migration || record.checksum!==digest(migration.sql) || record.release_id!==migration.release) throw fail('FRESH_SCHEMA_MISMATCH')
    }
    const pending = files.filter(m => !applied.some(r => r.schema_name===m.schema && r.version===m.version))
    for (const migration of pending) await client.query(migration.sql)
    for (const migration of pending) await client.query('INSERT INTO system.schema_migrations(schema_name,version,scope,checksum,release_id) VALUES($1,$2,$1,$3,$4)', [migration.schema, migration.version, digest(migration.sql), migration.release])
    const report = await verifySchema(client)
    await client.query('COMMIT')
    return { ...report, ...(pending.length ? { applied: true, migrationsApplied: pending.length } : { alreadyApplied: true }) }
  } catch (error) { await client.query('ROLLBACK'); throw error }
}

function renderTenantTemplate (schemaName, orgId) {
  if (!/^tenant_[a-z0-9]+(_[a-z0-9]+)*$/.test(schemaName) || Buffer.byteLength(schemaName)>63 || !/^[0-9a-f]{24}$/.test(orgId)) throw fail('INVALID_TENANT_PLACEMENT')
  const template = read('tenant/001_template.sql')
  return { sql: template.replaceAll('__TENANT_SCHEMA__', schemaName).replaceAll('__ORG_ID__', orgId), checksum: digest(template), version: VERSION }
}

module.exports = { VERSION, RELEASE, applyFreshSchema, verifySchema, renderTenantTemplate, assertEmptyTarget, migrations, digest }
