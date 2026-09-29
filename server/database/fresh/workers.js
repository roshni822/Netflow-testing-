'use strict'
const { query } = require('../postgres')
const { withSystemAccess } = require('../context')
const { runWithOrgId, runWithPlacement, getPlacement } = require('../../tenancy/tenantContext')
const { resolvePlacement } = require('./routing')
const cursors = new Map()
// Rotate the starting organization per job. A busy tenant cannot monopolize a
// process's document slots. Registry reads are paged, never cached placements.
async function forEachTenant (name, work) {
  if (getPlacement()) throw Object.assign(new Error('Worker sweep requires a service context'), { code: 'DATABASE_SCOPE_SWITCH' })
  return runWithOrgId(null, () => withSystemAccess('worker', async () => {
    const start = cursors.get(name) || ''
    let after = start; let first = null; let failures = 0; let scanned = 0
    for (const wrap of [false, true]) {
      if (wrap && !start) break
      if (wrap) after = ''
      while (true) {
        const { rows } = await query(`SELECT id FROM platform.organizations WHERE status='active' AND deleted_at IS NULL
          AND provisioning_status='ready' AND id>$1 AND ($2::text IS NULL OR id<=$2) ORDER BY id LIMIT 100`, [after, wrap ? start : null])
        if (!rows.length) break
        for (const row of rows) {
          first ||= row.id; after = row.id; scanned++
          try {
            const result = await runWithPlacement(await resolvePlacement(row.id), async () => await work())
            if (result?.error) throw Object.assign(new Error('Tenant job failed'), { code: 'WORKER_FAILED' })
          }
          catch (error) { failures++; console.error('Tenant worker failed', { job: name, orgId: row.id, code: error.code || 'WORKER_FAILED' }) }
        }
      }
    }
    if (first) cursors.set(name, first)
    if (failures) throw Object.assign(new Error('One or more tenant jobs failed'), { code: 'TENANT_WORKER_FAILED' })
    return { scanned }
  }))
}
module.exports = { forEachTenant }
