// HOOK — Inbound webhook security: HMAC signature, idempotency, guest submitter.

const crypto = require('crypto')
const h = require('./lib/harness')
const { runWithOrgId, Workflow, WorkflowExecution } = h
const { signBody } = require('../utils/inboundWebhook')

const postHook = async (token, bodyObj, { secret, idempotencyKey, badSig } = {}) => {
  const raw = JSON.stringify(bodyObj)
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
  if (secret) {
    const hex = badSig ? '00'.repeat(32) : signBody(secret, raw)
    headers['X-NetFlow-Signature'] = `sha256=${hex}`
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const res = await fetch(`${h.API}/hooks/${token}`, {
    method: 'POST',
    headers,
    body: raw
  })
  let json = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, body: json }
}

h.runSuite('hooks_inbound', async () => {
  const org = await h.createOrg('hooks')
  const admin = await h.createUser(org, {
    name: 'HOOK Admin',
    email: h.emailIn(org, 'hook-admin'),
    roleName: 'Admin',
    department: 'IT'
  })

  const secret = crypto.randomBytes(32).toString('hex')
  const token = crypto.randomBytes(24).toString('hex')

  const wf = await runWithOrgId(org._id, () => Workflow.create({
    title: 'HOOK inbound wf',
    status: 'published',
    createdBy: admin._id,
    department: 'IT',
    inboundWebhook: { enabled: true, token, secret },
    nodes: [
      { id: 'n1', type: 'start', label: 'Start', nextNode: 'n2', config: {} },
      { id: 'n2', type: 'end', label: 'End', config: {} }
    ],
    edges: [{ id: 'e0', source: 'n1', target: 'n2' }]
  }))

  // HOOK-001 valid HMAC → 201
  const ok = await postHook(token, {
    grnNo: 'G-1',
    submitter: { name: 'External Ada', email: 'ada@example.com' }
  }, { secret })
  h.check('HOOK-001', 'Valid HMAC starts a workflow (201)', ok.status === 201 && !!ok.body?.executionId, `status ${ok.status}`)

  const exec1 = ok.body?.executionId
    ? await runWithOrgId(org._id, () => WorkflowExecution.findById(ok.body.executionId).lean())
    : null
  h.check(
    'HOOK-002',
    'External submitter stored on execution',
    !!exec1 &&
      exec1.triggeredByExternal?.name === 'External Ada' &&
      exec1.variables?.submitter?.email === 'ada@example.com',
    `got ${JSON.stringify(exec1?.triggeredByExternal)}`
  )

  // HOOK-003 bad HMAC → 401
  const bad = await postHook(token, { grnNo: 'G-2' }, { secret, badSig: true })
  h.check('HOOK-003', 'Bad HMAC is rejected (401)', bad.status === 401, `status ${bad.status} code ${bad.body?.code}`)

  // HOOK-004 missing signature → 401 (WEBHOOK_SKIP_SIGNATURE must not be set in test env)
  const miss = await postHook(token, { grnNo: 'G-3' }, {})
  h.check('HOOK-004', 'Missing signature is rejected (401)', miss.status === 401, `status ${miss.status}`)

  // HOOK-005 idempotency replay → same executionId
  const key = `idem-${Date.now()}`
  const first = await postHook(token, { grnNo: 'G-4', submitter: { name: 'Idem' } }, { secret, idempotencyKey: key })
  const second = await postHook(token, { grnNo: 'G-4-dup', submitter: { name: 'Idem' } }, { secret, idempotencyKey: key })
  h.check(
    'HOOK-005',
    'Idempotency-Key replay returns same executionId',
    first.status === 201 &&
      second.status === 200 &&
      String(first.body?.executionId) === String(second.body?.executionId) &&
      second.body?.replay === true,
    `first ${first.status}/${first.body?.executionId}, second ${second.status}/${second.body?.executionId}`
  )

  // HOOK-006 unknown token → 404
  const missing = await postHook('ffffffffffffffffffffffffffffffffffffffff', { a: 1 }, { secret: 'x' })
  h.check('HOOK-006', 'Unknown webhook token → 404', missing.status === 404, `status ${missing.status}`)

  h.note('HOOK-007', 'Pending', 'Multi-instance Redis rate-limit share requires REDIS_URL in CI')

  // HOOK-008 status URL
  h.check('HOOK-008', 'Webhook response includes statusToken/statusUrl', !!(ok.body?.statusToken && ok.body?.statusUrl), JSON.stringify(ok.body))
  if (ok.body?.statusToken) {
    const st = await fetch(`${h.API}/hooks/status/${ok.body.statusToken}`)
    const stJson = await st.json().catch(() => ({}))
    h.check('HOOK-009', 'GET status token returns execution status', st.status === 200 && !!stJson.status, `status ${st.status}`)
  } else {
    h.check('HOOK-009', 'GET status token returns execution status', false, 'no statusToken')
  }

  // HOOK-010 payload contract
  const token2 = crypto.randomBytes(24).toString('hex')
  const secret2 = crypto.randomBytes(32).toString('hex')
  await runWithOrgId(org._id, () => Workflow.create({
    title: 'HOOK contract wf',
    status: 'published',
    createdBy: admin._id,
    department: 'IT',
    inboundWebhook: {
      enabled: true,
      token: token2,
      secret: secret2,
      expectedFields: [{ id: 'grnNo', label: 'GRN', type: 'text', required: true }]
    },
    nodes: [
      { id: 'n1', type: 'start', nextNode: 'n2', config: {} },
      { id: 'n2', type: 'end', config: {} }
    ]
  }))
  const noField = await postHook(token2, { other: 1 }, { secret: secret2 })
  h.check('HOOK-010', 'Missing required contract field → 400', noField.status === 400 && noField.body?.code === 'CONTRACT_INVALID', `status ${noField.status}`)

  // HOOK-011 delivery log written
  const adminTok = await h.getToken({ email: admin.email })
  const logs = await h.api('GET', `/workflows/${wf._id}/webhook-deliveries?limit=10`, adminTok)
  h.check('HOOK-011', 'Delivery logs listable for builders', logs.status === 200 && (logs.body?.count || 0) >= 1, `count ${logs.body?.count}`)

  // HOOK-012 env secret resolver
  const { resolveSecret } = require('../utils/secrets')
  process.env.HOOK_TEST_SECRET = 'abc123'
  h.check('HOOK-012', 'env: vault resolver reads process.env', resolveSecret('env:HOOK_TEST_SECRET') === 'abc123')
})
