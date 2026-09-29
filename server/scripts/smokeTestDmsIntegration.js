// Smoke-test BaseLayer DMS from NetFlow's dmsClient.
// Requires: DMS_ENABLED=true, DMS_API_URL, DMS_API_KEY in server/.env
// Run: node scripts/smokeTestDmsIntegration.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const fs = require('fs')
const os = require('os')
const path = require('path')
const dms = require('../services/dmsClient')

async function main() {
  console.log('DMS_ENABLED =', process.env.DMS_ENABLED)
  console.log('DMS_API_URL =', process.env.DMS_API_URL)
  console.log('DMS_API_KEY set =', Boolean(process.env.DMS_API_KEY))

  if (!dms.isEnabled()) {
    console.error('Set DMS_ENABLED=true to run this smoke test.')
    process.exit(1)
  }

  const tmp = path.join(os.tmpdir(), `netflow-dms-smoke-${Date.now()}.txt`)
  fs.writeFileSync(tmp, `NetFlow DMS smoke ${new Date().toISOString()}\n`)

  const user = { name: 'NetFlow Smoke', email: 'smoke@netflow.local' }

  console.log('\n1) uploadFile…')
  const doc = await dms.uploadFile({
    filePath: tmp,
    filename: 'smoke.txt',
    mime: 'text/plain',
    user,
    ref: { taskId: 'smoke-task-1' },
  })
  console.log('   document:', JSON.stringify(doc, null, 2))

  console.log('\n2) signedUrl…')
  const url = await dms.signedUrl(doc.id, { mode: 'view', user })
  console.log('   url:', url)

  console.log('\n3) postEvent workflow.submitted…')
  const ev1 = await dms.postEvent(doc.id, {
    type: 'workflow.submitted',
    actor: user,
    detail: 'Smoke submit',
    meta: { taskId: 'smoke-task-1' },
  })
  console.log('   ok:', Boolean(ev1))

  console.log('\n4) postEvent workflow.approved…')
  const ev2 = await dms.postEvent(doc.id, {
    type: 'workflow.approved',
    actor: user,
    detail: 'Smoke approve',
    meta: { taskId: 'smoke-task-1' },
  })
  console.log('   ok:', Boolean(ev2))

  console.log('\n5) findByRef…')
  const found = await dms.findByRef({ taskId: 'smoke-task-1' }, { user })
  console.log('   found:', found ? (found.id || found._id || 'yes') : null)

  fs.unlinkSync(tmp)
  console.log('\nSmoke test finished.')
}

main().catch((err) => {
  console.error('SMOKE FAILED', err.status || '', err.code || '', err.message)
  if (err.body) console.error(JSON.stringify(err.body, null, 2))
  process.exit(1)
})
