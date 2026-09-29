'use strict'
const crypto = require('node:crypto')
const { transaction } = require('./postgres')
const { currentAccess, withSystemAccess } = require('./context')

async function enqueue (type, payload, key = crypto.randomUUID()) {
  return transaction(async client => {
    if (require('./layout').organizationSchemas()) {
      const org = currentAccess().org || null
      const result = await client.query("INSERT INTO system.outbox(account_scope,org_id,delivery_purpose,event_key,event_type,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_key) DO NOTHING RETURNING id", [org ? 'tenant' : 'platform', org, org ? 'business' : 'platform', key, type, JSON.stringify(payload)])
      return { queued: true, id: result.rows[0]?.id || null }
    }
    const result = await client.query("INSERT INTO netflow_private.outbox(tenant_id,event_key,event_type,payload) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING RETURNING id", [currentAccess().org || null, key, type, JSON.stringify(payload)])
    return { queued: true, id: result.rows[0]?.id || null }
  })
}

async function deliver (event) {
  if (event.event_type === 'email') return require('../utils/emailService').deliverMail(event.payload)
  if (event.event_type === 'callback') {
    const result = await require('../utils/webhook').callWebhook(event.payload)
    if (!result.ok) throw new Error('Callback delivery failed')
    return result
  }
  throw new Error('Unknown outbox event type')
}
async function drain (send = deliver) {
  if (require('./layout').organizationSchemas()) return drainScoped(send)
  return withSystemAccess('worker', async () => {
    let delivered = 0
    for (let i = 0; i < 10; i++) {
      const event = await transaction(async client => {
        const { rows } = await client.query("WITH claimed AS (SELECT id FROM netflow_private.outbox WHERE status IN ('pending','failed','processing') AND (retry_at IS NULL OR retry_at<=now()) AND attempts<12 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE netflow_private.outbox o SET status='processing', attempts=attempts+1, retry_at=now()+interval '5 minutes' FROM claimed WHERE o.id=claimed.id RETURNING o.*")
        return rows[0]
      })
      if (!event) break
      try {
        await send(event)
        await transaction(client => client.query("UPDATE netflow_private.outbox SET status='sent',completed_at=now(),retry_at=NULL WHERE id=$1", [event.id]))
        delivered++
      } catch {
        await transaction(client => client.query("UPDATE netflow_private.outbox SET status='failed',retry_at=now()+make_interval(secs=>LEAST(3600, power(2,attempts)::integer*15)) WHERE id=$1", [event.id]))
      }
    }
    return delivered
  })
}
async function drainScoped (send) {
  if (require('../tenancy/tenantContext').getOrgId()) throw Object.assign(new Error('Outbox requires a service context'), { code: 'DATABASE_SCOPE_SWITCH' })
  return withSystemAccess('worker', async () => {
    let delivered = 0
    for (let i = 0; i < 10; i++) {
      const event = await transaction(async client => (await client.query(`WITH claimed AS (
        SELECT o.id FROM system.outbox o WHERE o.status IN ('pending','failed','processing')
        AND (o.retry_at IS NULL OR o.retry_at<=now()) AND o.attempts<12
        AND (o.account_scope='platform' OR EXISTS(SELECT 1 FROM platform.organizations t
          WHERE t.id=o.org_id AND t.status='active' AND t.provisioning_status='ready' AND t.deleted_at IS NULL))
        ORDER BY o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1)
        UPDATE system.outbox o SET status='processing',attempts=attempts+1,retry_at=now()+interval '5 minutes'
        FROM claimed WHERE o.id=claimed.id RETURNING o.*`)).rows[0])
      if (!event) break
      // Attempt number fences stale acknowledgements. Delivery is at-least-once;
      // receivers must use event_key for idempotency after an uncertain timeout.
      const acknowledge = (success) => transaction(client => client.query(`UPDATE system.outbox SET
        status=$3,completed_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,
        retry_at=CASE WHEN $3='sent' THEN NULL ELSE now()+make_interval(secs=>LEAST(3600,power(2,attempts)::integer*15)) END
        WHERE id=$1 AND attempts=$2 AND status='processing'`, [event.id,event.attempts,success ? 'sent' : 'failed']))
      let heartbeatError = null
      let renewing = null
      const heartbeat = setInterval(() => {
        if (renewing) return
        renewing = transaction(client => client.query("UPDATE system.outbox SET retry_at=now()+interval '5 minutes' WHERE id=$1 AND attempts=$2 AND status='processing'", [event.id,event.attempts]))
          .catch(error => { heartbeatError = error }).finally(() => { renewing = null })
      }, 60000)
      heartbeat.unref()
      try {
        if (event.account_scope === 'tenant') {
          const placement = await require('./fresh/routing').resolvePlacement(event.org_id)
          await require('../tenancy/tenantContext').runWithPlacement(placement, async () => await send(event))
        } else await send(event)
        if (heartbeatError) throw heartbeatError
        const result = await acknowledge(true)
        delivered += result.rowCount
      } catch { await acknowledge(false) }
      finally { clearInterval(heartbeat); if (renewing) await renewing }
    }
    return delivered
  })
}
function startOutbox () {
  return require('../jobs/monitor').interval('outbox', 1000, drain)
}

module.exports = { enqueue, drain, startOutbox }
