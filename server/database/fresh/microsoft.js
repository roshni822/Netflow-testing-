'use strict'
const { query } = require('../postgres')
const { withAccount } = require('./routing')
// Microsoft tid+oid is a stable identity. Email/domain never selects an account.
async function withMicrosoftIdentity (tenantId, objectId, work) {
  const identity = (await query(`SELECT d.user_id,d.account_scope,d.org_id FROM system.microsoft_identities m
    JOIN system.user_directory d ON d.user_id=m.user_id
    WHERE m.tenant_id=$1 AND m.object_id=$2 AND d.state='active'`, [tenantId.toLowerCase(),objectId.toLowerCase()])).rows[0]
  if (!identity) return null
  return withAccount(identity, () => work(identity.user_id))
}
module.exports = { withMicrosoftIdentity }
