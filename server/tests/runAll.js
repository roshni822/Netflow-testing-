// Test runner — executes every automated suite (as child processes) against a
// live server, aggregates each TC-ID → status into tests/results.json, and
// prints a summary. Suites run SEQUENTIALLY: each qa-* suite wipes all qa data
// before/after itself, so overlapping runs would clobber each other.
//
// Usage (server must be running, roles + superadmin seeded):
//   node tests/runAll.js
//
// New suites emit a machine-readable `__RESULTS__ {json}` line (see
// lib/harness.js). The three legacy scripts don't, so their exit code stamps a
// curated set of TC IDs they are known to verify.

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Suites built on the harness — their __RESULTS__ line is authoritative.
const HARNESS_SUITES = [
  'licensing_unit.test.js',
  'licensing.test.js',
  'licensing_quota.test.js',
  'licensing_usage.test.js',
  'storage_usage.test.js',
  'permissions.test.js',
  'admin_users.test.js',
  'org_admin.test.js',
  'ops.test.js',
  'workspace.test.js',
  'profile.test.js',
  'tasks_approvals.test.js',
  'workflow_engine.test.js',
  'notifications.test.js',
  'analytics_audit.test.js',
  'platform_orgs.test.js',
  'platform_dashboard.test.js',
  'edge_security.test.js',
  'hooks_inbound.test.js',
  // Browser suites (Playwright). They need the Vite dev server as well as the
  // API; when it isn't reachable they report their cases as Pending rather than
  // failing the run. They own the cases the API suites can only note.
  'ui_permissions.test.js',
  'ui_admin.test.js',
  'ui_org_admin.test.js',
  'ui_ops.test.js',
  'ui_workspace.test.js',
  'ui_profile.test.js',
  'ui_tasks.test.js',
  'ui_workflows.test.js',
  'ui_notifications.test.js',
  'ui_analytics.test.js',
  'ui_platform_integrations.test.js',
  'ui_platform.test.js'
]

// Fast, self-contained suites that protect shared extraction/LLM utilities and
// the document-to-form sanitizer. They do not need a running API server.
const UNIT_SUITES = [
  { file: 'pdf_autofill.test.js', tc: 'PDF-AUTOFILL-UNIT' },
  { file: 'document_form_llm_first.test.js', tc: 'DOCUMENT-FORM-UNIT' },
  { file: 'platform_integration_validation.test.js', tc: 'PLATFORM-INTEGRATION-UNIT' },
  { file: 'llm_failover.test.js', tc: 'LLM-FAILOVER-UNIT' }
]

// Legacy standalone scripts — exit 0 means the listed TC IDs passed.
// Superseded MongoDB-specific standalone suites were removed. The disposable
// PostgreSQL suite covers fresh setup, authentication and tenant isolation.
const LEGACY_SUITES = []

const results = {}

// Several TC IDs are reported by two suites — an API suite that can only note
// "this one is browser-only" and a UI suite that actually proves it. Fail stays
// sticky; otherwise the most informative outcome wins whatever order they ran in.
const RANK = { Pending: 0, 'N/A': 1, Pass: 2 }

const merge = (tcId, status, note) => {
  const prev = results[tcId]
  if (prev?.status === 'Fail') return
  if (status === 'Fail' || !prev) {
    results[tcId] = { status, note: note || prev?.note || '' }
    return
  }
  if ((RANK[status] ?? 0) > (RANK[prev.status] ?? 0)) results[tcId] = { status, note }
}

const runNode = (file) => {
  console.log(`\n${'='.repeat(70)}\n▶ ${file}\n${'='.repeat(70)}`)
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  })
  const out = (res.stdout || '') + (res.stderr || '')
  process.stdout.write(out)
  return { code: res.status, out }
}

const parseResultsLine = (out) => {
  // Last __RESULTS__ line wins.
  const lines = out.split(/\r?\n/).filter((l) => l.startsWith('__RESULTS__'))
  if (!lines.length) return null
  try { return JSON.parse(lines[lines.length - 1].slice('__RESULTS__'.length).trim()) } catch { return null }
}

const summary = { suites: [] }

const run = () => {
  for (const { file, tc } of UNIT_SUITES) {
    const { code } = runNode(file)
    const passed = code === 0
    merge(tc, passed ? 'Pass' : 'Fail', passed
      ? 'Verified by the self-contained unit suite.'
      : `Unit suite exited ${code}.`)
    summary.suites.push({
      file,
      pass: passed ? 1 : 0,
      fail: passed ? 0 : 1,
      other: 0,
      code
    })
  }

  for (const file of HARNESS_SUITES) {
    let { code, out } = runNode(file)
    let parsed = parseResultsLine(out)
    // A suite that dies before printing its results told us nothing. The
    // browser suites occasionally lose their process outright on Windows
    // (exit 0xC0000409, no output at all), so give one a second chance before
    // calling it a failure — a real break fails twice.
    if (!parsed) {
      console.log(`\n  ↻ ${file} produced no results (exit ${code}) — retrying once\n`)
      const retry = runNode(file)
      parsed = parseResultsLine(retry.out)
      code = retry.code
    }
    if (parsed) {
      let pass = 0; let fail = 0; let other = 0
      for (const [tcId, r] of Object.entries(parsed)) {
        merge(tcId, r.status, r.note)
        if (r.status === 'Pass') pass++
        else if (r.status === 'Fail') fail++
        else other++
      }
      summary.suites.push({ file, pass, fail, other, code })
    } else {
      // Suite crashed before emitting results.
      merge(`${file}-SUITE`, 'Fail', `Suite did not emit results (exit ${code}).`)
      summary.suites.push({ file, pass: 0, fail: 1, other: 0, code, crashed: true })
    }
  }

  for (const { file, tcs, note } of LEGACY_SUITES) {
    const { code } = runNode(file)
    const status = code === 0 ? 'Pass' : 'Fail'
    for (const tc of tcs) merge(tc, status, code === 0 ? note : `${note} — suite exited ${code}.`)
    summary.suites.push({ file, pass: code === 0 ? tcs.length : 0, fail: code === 0 ? 0 : tcs.length, other: 0, code })
  }

  const outPath = path.join(__dirname, 'results.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))

  // Totals.
  let pass = 0; let fail = 0; let other = 0
  for (const r of Object.values(results)) {
    if (r.status === 'Pass') pass++
    else if (r.status === 'Fail') fail++
    else other++
  }

  console.log(`\n${'#'.repeat(70)}\n# SUMMARY\n${'#'.repeat(70)}`)
  for (const s of summary.suites) {
    const tag = s.crashed ? 'CRASHED' : `exit ${s.code}`
    console.log(`  ${s.file.padEnd(26)}  ${String(s.pass).padStart(3)} pass  ${String(s.fail).padStart(3)} fail  (${tag})`)
  }
  console.log(`${'-'.repeat(70)}`)
  console.log(`  TOTAL TC IDs recorded: ${Object.keys(results).length}  →  ${pass} Pass, ${fail} Fail, ${other} other`)
  console.log(`  Results written to: ${path.relative(path.join(__dirname, '..', '..'), outPath)}`)
  console.log(`${'#'.repeat(70)}\n`)

  process.exit(fail > 0 ? 1 : 0)
}

run()
