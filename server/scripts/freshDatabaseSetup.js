'use strict'
require('../config/environment')()
const { Client } = require('pg')
const { connectionOptions } = require('../database/postgres')
const { guardTarget } = require('../database/setup')
const { applyFreshSchema, verifySchema, migrations } = require('../database/fresh/setup')

async function main () {
  const args = process.argv.slice(2)
  const command = args[0]
  if (command === 'schema-preview') return process.stdout.write(migrations().map(m => m.sql).join('\n'))
  if (!['schema-apply','bootstrap','check'].includes(command)) throw Object.assign(new Error('Use schema-preview, schema-apply, bootstrap or check'), { code: 'UNKNOWN_COMMAND' })
  guardTarget(args)
  const client = new Client(connectionOptions('SETUP_DATABASE_URL'))
  try {
    await client.connect()
    const result = command === 'schema-apply' ? await applyFreshSchema(client)
      : command === 'check' ? await verifySchema(client)
        : await require('../database/fresh/bootstrap').bootstrapPlatform(client, { name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
    console.log(JSON.stringify(result))
  } finally { await client.end() }
}
main().catch(error => { console.error(JSON.stringify({ failed: true, code: error.code || 'FRESH_SETUP_FAILED' })); process.exitCode=1 })
