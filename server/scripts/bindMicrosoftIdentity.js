'use strict'
// Explicit administrator-only binding. No email-based automatic SSO linking.
require('../config/environment')()
const { Client } = require('pg')
const { connectionOptions } = require('../database/postgres')
const args = process.argv.slice(2)
const arg = key => args[args.indexOf(key) + 1]
async function main () {
  require('../database/setup').guardTarget(args)
  const userId = arg('--user'), tenant = arg('--tenant'), object = arg('--object')
  const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
  if (!/^[a-f\d]{24}$/i.test(userId || '') || !uuid.test(tenant || '') || !uuid.test(object || '')) throw new Error('Supply --user USER_ID --tenant MICROSOFT_TENANT_UUID --object MICROSOFT_OBJECT_UUID')
  const client = new Client(connectionOptions('SETUP_DATABASE_URL'))
  try {
    await client.connect()
    await client.query('BEGIN')
    const fresh = require('../database/layout').organizationSchemas()
    const user = await client.query(fresh ? "SELECT user_id FROM system.user_directory WHERE user_id=$1 AND state='active' FOR UPDATE" : 'SELECT id FROM netflow.users WHERE id=$1 AND is_active=true FOR UPDATE', [userId])
    if (user.rowCount !== 1) throw new Error('An active existing Netflow user is required')
    await client.query(`INSERT INTO ${fresh ? 'system' : 'netflow_private'}.microsoft_identities(user_id,tenant_id,object_id) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, object_id=EXCLUDED.object_id`, [userId, tenant.toLowerCase(), object.toLowerCase()])
    await client.query('COMMIT')
    console.log('Microsoft identity binding saved for user', userId)
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error } finally { await client.end() }
}
main().catch(error => { console.error('Identity binding failed', { code: error.code || 'BINDING_FAILED', message: error.code ? undefined : error.message }); process.exitCode = 1 })
