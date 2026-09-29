'use strict'
const crypto = require('node:crypto')
const { verifySchema } = require('./setup')
const { getPasswordPolicy } = require('../../utils/passwordPolicy')
const { PLAN_PRESETS } = require('../../config/plans')
const id = () => crypto.randomBytes(12).toString('hex')
const fail = code => Object.assign(new Error(code), { code })

async function bootstrapPlatform (client, input) {
  const name = String(input.name || '').trim()
  const email = String(input.email || '').trim().toLowerCase()
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('ADMIN_IDENTITY_REQUIRED')
  const policy = getPasswordPolicy(input.password)
  if (!policy.valid) throw fail(policy.code)
  await client.query('BEGIN')
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('netflow:fresh-bootstrap')),set_config('netflow.system','startup',true)")
    await verifySchema(client)
    const existing = (await client.query('SELECT id,name,email,is_protected FROM platform.admin_users WHERE is_bootstrap')).rows
    if (existing.length) {
      if (existing.length !== 1 || existing[0].email !== email || existing[0].name !== name || !existing[0].is_protected) throw fail('BOOTSTRAP_IDENTITY_CONFLICT')
      const valid = (await client.query(`SELECT 1 FROM platform.admin_auth a JOIN platform.admin_users u ON u.id=a.owner_id
        JOIN platform.admin_roles r ON r.id=u.role_id JOIN system.user_directory d ON d.user_id=u.id
        WHERE u.id=$1 AND r.name_key='superadmin' AND d.account_scope='platform' AND d.org_id IS NULL`, [existing[0].id])).rowCount
      if (!valid) throw fail('BOOTSTRAP_INCOMPLETE')
      await client.query('COMMIT')
      return { alreadyInitialized: true, adminId: existing[0].id, passwordChanged: false }
    }
    const conflicting = (await client.query(`SELECT EXISTS(SELECT 1 FROM platform.organizations) OR EXISTS(SELECT 1 FROM platform.admin_roles) OR EXISTS(SELECT 1 FROM platform.admin_users)
      OR EXISTS(SELECT 1 FROM system.user_directory) OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname LIKE 'tenant\_%') AS present`)).rows[0].present
    if (conflicting) throw fail('BOOTSTRAP_TARGET_NOT_EMPTY')
    const roleId = id(); const userId = id()
    for (const [key, plan] of Object.entries(PLAN_PRESETS)) {
      const expected = { label: plan.label, limits: plan.limits || { maxUsers: 0, maxBuilders: 0, maxForms: 0, maxWorkflows: 0, maxSubmissionsPerPeriod: 0, maxStorageMb: 0, maxFiles: 0 }, features: plan.features, isCustom: key==='custom', trialDays: plan.trialDays || null }
      if ((await client.query('SELECT 1 FROM platform.plans WHERE key=$1', [key])).rowCount) throw fail('BOOTSTRAP_PLAN_CONFLICT')
      await client.query(`INSERT INTO platform.plans(id,key,label,limits,features,is_custom,trial_days) VALUES($1,$2,$3,$4,$5,$6,$7)`, [id(),key,expected.label,JSON.stringify(expected.limits),JSON.stringify(expected.features),expected.isCustom,expected.trialDays])
    }
    await client.query(`INSERT INTO platform.admin_roles(id,name,name_key,description,permissions) VALUES($1,'SuperAdmin','superadmin','Platform administration',ARRAY['platform:manage_orgs'])`, [roleId])
    await client.query(`INSERT INTO platform.admin_users(id,name,email,role_id,department,is_active,is_protected,is_bootstrap,counts_toward_seats,can_build)
      VALUES($1,$2,$3,$4,'Platform',true,true,true,false,false)`, [userId,name,email,roleId])
    const passwordHash = await require('../../models/User').hashPassword(input.password)
    await client.query('INSERT INTO platform.admin_auth(owner_id,password,token_version,failed_login_attempts,mfa_enabled) VALUES($1,$2,0,0,false)', [userId,passwordHash])
    await client.query('COMMIT')
    return { initialized: true, adminId: userId, platformAdmins: 1, organizations: 0, tenantSchemas: 0 }
  } catch (error) { await client.query('ROLLBACK'); throw error }
}
module.exports = { bootstrapPlatform }
