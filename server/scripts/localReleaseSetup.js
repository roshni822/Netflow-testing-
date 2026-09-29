'use strict'
// Dedicated local container setup. Never reads the existing workspace .env.
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const postgres = require('../database/postgres')

async function main () {
  const target = new URL(process.env.SETUP_DATABASE_URL)
  const runtime = new URL(process.env.DATABASE_URL)
  if (target.hostname !== 'postgres' || target.pathname !== '/netflow' || runtime.hostname !== target.hostname || runtime.pathname !== target.pathname || runtime.username !== 'netflow_runtime') throw new Error('Only the dedicated local container database is allowed')
  if (!/^[a-f\d]{64}$/.test(process.env.RUNTIME_PASSWORD || '')) throw new Error('Generate local secrets with deploy/local/init.mjs')
  const owner = new Client(postgres.connectionOptions('SETUP_DATABASE_URL'))
  try {
    await owner.connect()
    await require('../database/setup').applySchema(owner)
    await owner.query(fs.readFileSync(path.join(__dirname, '../database/provision-runtime.sql'), 'utf8'))
    const exists = await owner.query("SELECT 1 FROM pg_roles WHERE rolname='netflow_runtime'")
    if (!exists.rowCount) await owner.query(`CREATE ROLE netflow_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${process.env.RUNTIME_PASSWORD}'`)
    await owner.query('GRANT netflow_app TO netflow_runtime')
    await postgres.connect()
    const result = await require('../database/bootstrap').bootstrap({ email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME, password: process.env.ADMIN_PASSWORD })
    console.log(JSON.stringify(result))
  } finally { await owner.end(); await postgres.close() }
}
main().catch(error => { console.error('Local setup failed', { code: error.code || 'LOCAL_SETUP_FAILED' }); process.exitCode = 1 })
