'use strict'
require('../config/environment')()
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const postgres = require('../database/postgres')
const { applySchema, guardTarget, schemaFile } = require('../database/setup')

async function main () {
  const args = process.argv.slice(2)
  const command = args[0]
  if (command === 'schema-preview') { process.stdout.write(fs.readFileSync(schemaFile, 'utf8')); return }
  if (!['schema-apply', 'provision-runtime', 'bootstrap'].includes(command)) throw Object.assign(new Error('Commands: schema-preview, schema-apply, provision-runtime, bootstrap'), { code: 'UNKNOWN_COMMAND' })
  guardTarget(args, command === 'bootstrap')
  if (command === 'bootstrap') {
    try {
      await postgres.connect()
      const result = await require('../database/bootstrap').bootstrap({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: process.env.ADMIN_NAME })
      console.log(JSON.stringify(result))
    } finally { await postgres.close() }
    return
  }
  const client = new Client(postgres.connectionOptions('SETUP_DATABASE_URL'))
  try {
    await client.connect()
    if (command === 'schema-apply') console.log(JSON.stringify(await applySchema(client)))
    else {
      await client.query('BEGIN')
      try {
        await client.query(fs.readFileSync(path.join(__dirname, '../database/provision-runtime.sql'), 'utf8'))
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error }
      console.log('Runtime permission group provisioned; grant your separate runtime login membership in netflow_app.')
    }
  } finally { await client.end() }
}

main().catch(error => {
  // Database error details may contain row values or connection credentials.
  console.error(JSON.stringify({ failed: true, code: error.code || 'SETUP_FAILED' }))
  process.exitCode = 1
})
