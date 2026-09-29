'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { Client } = require('pg')

async function localCluster () {
  const bin = process.env.NETFLOW_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin'
  const base = path.join(require('node:os').tmpdir(), 'netflow-postgres-verification')
  fs.mkdirSync(base, { recursive: true })
  const directory = fs.mkdtempSync(path.join(base, 'verification-'))
  const passwordFile = path.join(directory, 'init-password')
  const password = crypto.randomBytes(32).toString('hex')
  const appPassword = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(passwordFile, password, { mode: 0o600 })
  const data = path.join(directory, 'data')
  const port = 55439
  const exe = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''))
  const run = (name, args) => {
    const log = fs.openSync(path.join(directory, name + '.log'), 'a', 0o600)
    try { return execFileSync(exe(name), args, { windowsHide: true, stdio: ['ignore', log, log], timeout: 150000 }) }
    finally { fs.closeSync(log) }
  }
  let started = false
  try {
    run('initdb', ['-D', data, '-U', 'netflow_verification_owner', '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C', '--no-sync'])
    fs.unlinkSync(passwordFile)
    run('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', '-t', '120', 'start'])
    started = true
    const ownerConfig = { host: '127.0.0.1', port, user: 'netflow_verification_owner', password, database: 'postgres' }
    const admin = new Client(ownerConfig)
    await admin.connect()
    await admin.query('CREATE DATABASE netflow_verification')
    // Generated credentials consist only of hexadecimal digits.
    await admin.query(`CREATE ROLE netflow_verification_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${appPassword}'`)
    await admin.end()
    const owner = new Client({ ...ownerConfig, database: 'netflow_verification' })
    await owner.connect()
    return {
      owner, directory,
      appURL: `postgresql://netflow_verification_app:${appPassword}@127.0.0.1:${port}/netflow_verification`,
      async stop () {
        await owner.end()
        if (fs.existsSync(path.join(data, 'postmaster.pid'))) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '120', 'stop'])
        // Delete only this newly-created, stopped test cluster. Never traverse
        // outside the verified test workspace or follow an unexpected link.
        const resolvedBase = fs.realpathSync(base)
        const resolvedDirectory = fs.realpathSync(directory)
        const relative = path.relative(resolvedBase, resolvedDirectory)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^verification-[a-zA-Z0-9]+$/.test(relative)) throw new Error('Unsafe test cleanup path')
        if (fs.existsSync(path.join(resolvedDirectory, 'data/postmaster.pid'))) throw new Error('Test database is still running')
        fs.rmSync(resolvedDirectory, { recursive: true })
      }
    }
  } catch (error) {
    if (started || fs.existsSync(path.join(data, 'postmaster.pid'))) {
      try { run('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '120', 'stop']) } catch { /* Preserve the original initialization failure. */ }
    }
    if (fs.existsSync(passwordFile)) fs.unlinkSync(passwordFile)
    throw error
  }
}
module.exports = { localCluster }
