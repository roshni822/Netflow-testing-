// Shared - Phase 2 - server.js
// NetFlow main HTTP entry point.

const path = require('path')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
require('./config/environment')()
require('./config/production').validateProduction()

const connectDB = require('./config/db')
const errorHandler = require('./middleware/errorHandler')
const { withSystemAccess } = require('./database/context')

if (String(process.env.DMS_ENABLED || '').toLowerCase() !== 'true') {
  console.warn('[dms] DMS service disabled. Set DMS_ENABLED=true to allow configured DMS connections (S3 remains independent).')
} else if (!process.env.DMS_API_URL || !process.env.DMS_API_KEY) {
  console.warn('[dms] DMS service enabled. Configure each organization endpoint and API key; no legacy platform default is configured.')
} else {
  console.log('[dms] DMS integration enabled →', String(process.env.DMS_API_URL).replace(/\/$/, ''))
}

const app = express()

// Trust the first proxy hop so rate-limiting sees the real client IP
// (needed when deployed behind Nginx / a platform load balancer).
app.set('trust proxy', 1)

const databaseReady = connectDB().then(() => withSystemAccess('startup', async () => {
  if (require('./database/layout').organizationSchemas()) {
    const Plan = require('./models/Plan')
    const bootstrapAdmin = await require('./database/postgres').query(`SELECT 1 FROM platform.admin_users u
      JOIN platform.admin_auth a ON a.owner_id=u.id JOIN platform.admin_roles r ON r.id=u.role_id
      WHERE u.is_bootstrap AND r.name_key='superadmin'`)
    if (!await Plan.countDocuments() || !bootstrapAdmin.rowCount) throw Object.assign(new Error('Run the fresh platform bootstrap first'), { code: 'PLATFORM_BOOTSTRAP_REQUIRED' })
    await require('./config/plans').reloadPlans()
    console.log('Organization-schema Phase 6 enabled: tenant routing, platform operations and recovery; production rollout remains gated')
  }
  // Load subscription plans from DB to memory
  const { reloadPlans } = require('./config/plans')
  try {
    await reloadPlans()
    console.log('Plans loaded from DB')
  } catch (err) {
    console.error('Failed to load plans from DB', err)
  }

  // PAUSE_BACKGROUND_JOBS=1 skips the hourly escalation sweep — used by the automated
  // test server so a shared/production database is never swept during a run.
  if (process.env.PAUSE_BACKGROUND_JOBS === '1') {
    console.log('Background jobs disabled (PAUSE_BACKGROUND_JOBS=1)')
    return
  }
  return withSystemAccess('worker', () => {
  const { startEscalationCron } = require('./jobs/escalationCron')
  startEscalationCron()
  console.log('Escalation cron started')
  const { startTimerCron } = require('./jobs/timerCron')
  startTimerCron()
  console.log('Timer cron started (every minute)')
  const { startLicenceCron } = require('./jobs/licenceCron')
  startLicenceCron()
  const { startUsageCron } = require('./jobs/usageCron')
  startUsageCron()
  const { startExtractionProcessor } = require('./services/extractionProcessor')
  startExtractionProcessor()
  const { startFormGenerationProcessor } = require('./services/formGenerationProcessor')
  startFormGenerationProcessor()
  require('./jobs/postgresRetention').startRetention()
  require('./database/outbox').startOutbox()
  })
}))

app.use(helmet())
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
app.use(cors({
  origin: (origin, cb) => {
    // No origin = curl/server-to-server. Allow in dev.
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    if (process.env.NODE_ENV !== 'production') return cb(null, true)
    return cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true
}))
// Do not log signed URLs, form tokens, credentials or customer request bodies.
app.use(morgan(':method :status :response-time ms'))
// Capture raw body for /api/hooks HMAC verification (X-NetFlow-Signature).
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/hooks')) {
      req.rawBody = Buffer.from(buf)
    }
  }
}))
app.use(express.urlencoded({ extended: false }))
app.use('/api', require('./database/fresh/authentication').foundationGate)

// Attachments uploaded from now on are org-scoped and access-checked — see
// routes/files.js. Mounted before the API routers because it authenticates
// itself (a signed URL or a bearer token) and must keep working while a tenant
// is read-only.
app.use('/api/files', (req, res, next) => withSystemAccess('signed-file', next), require('./routes/files'))

// Fresh databases use authenticated/signed file routes. Flat legacy files require opt-in.
if (process.env.SERVE_LEGACY_UPLOADS === '1') {
  app.use(
    '/uploads',
    helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
    // Flat files only. Without this, /uploads/<orgId>/<file> would walk straight
    // into the per-org directories and undo the access control above.
    (req, res, next) => {
      const rel = String(req.path || '').replace(/^\/+/, '')
      if (!rel || rel.includes('/')) {
        return res.status(404).json({ success: false, error: 'File not found', code: 'FILE_NOT_FOUND' })
      }
      next()
    },
    express.static(path.join(__dirname, 'uploads'), {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
    })
  )
}

let draining = false
app.get('/api/ready', async (req, res) => {
  const database = await withSystemAccess('startup', () => require('./database/operations').health())
  const workers = require('./jobs/monitor').snapshot()
  const redis = !process.env.REDIS_URL || require('./utils/redis').isRedisReady()
  const foundationOnly = require('./database/layout').organizationSchemas()
  const ready = !foundationOnly && !draining && database.ok && redis && workers.every(worker => worker.healthy)
  res.status(ready ? 200 : 503).json({ ready, database: database.ok ? 'connected' : 'unavailable', redis: redis ? 'ready' : 'unavailable', workers, ...(foundationOnly ? { code: 'SCHEMA_PHASE_NOT_READY', phase: 6 } : {}) })
})

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'flowsphere-server',
    env: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    sourceCodeUrl: process.env.SOURCE_CODE_URL || null
  })
})

// Routes — M1
app.use('/api/auth', (req, res, next) => withSystemAccess('authentication', next), require('./routes/auth'))
app.use('/api/users', require('./routes/users'))
app.use('/api/roles', require('./routes/roles'))
// Routes — Shell 2 (an Org Admin configuring their own tenant)
app.use('/api/departments', require('./routes/departments'))
app.use('/api/organization', require('./routes/organization'))
const extractionRoutes = require('./routes/formExtractions')
app.use('/api/forms/:formId/extractions', extractionRoutes.authenticatedRouter())
app.use('/api/public/forms/:token/extractions', (req, res, next) => withSystemAccess('public-form', next), require('./database/fresh/resources').route('public_form', req => req.params.token), extractionRoutes.publicRouter())
app.use('/api/forms/document-drafts', require('./routes/formGeneration'))

app.use('/api/forms', require('./routes/forms'))
app.use('/api/uploads', require('./routes/uploads'))
app.use('/api/dms', require('./routes/dms'))
app.use('/api/s3', require('./routes/s3'))

// Public (unauthenticated) form links — collect data from non-users.
app.use('/api/public', (req, res, next) => withSystemAccess('public-form', next), require('./routes/public'))

// Inbound webhook triggers (n8n-style) — external forms POST here to start a run.
app.use('/api/hooks', (req, res, next) => withSystemAccess('webhook', next), require('./routes/hooks'))

// Routes — M2
app.use('/api/workflows', require('./routes/workflows'))

// Routes — Shell 3 (a leader operating: approvals, their team, reports)
app.use('/api/team', require('./routes/team'))

// Routes — M3
app.use('/api/tasks', require('./routes/tasks'))
app.use('/api/notifications', require('./routes/notifications'))
app.use('/api/broadcasts', require('./routes/broadcasts'))
app.use('/api/audit-logs', require('./routes/auditLogs'))
app.use('/api/analytics', require('./routes/analytics'))

// Routes — Licensing (a tenant reading its own licence state and usage meters)
app.use('/api/usage', require('./routes/usage'))

// Routes — AI-01 (Approval-Routing AI / Delegation-of-Authority)
// Routes — AI-02 (In-app AI assistant chatbot)
app.use('/api/assistant', require('./routes/assistant'))

// Routes — Multi-tenancy (platform-level org management, SuperAdmin only)
app.use('/api/platform', require('./routes/platform'))

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND'
  })
})

app.use(errorHandler)

const PORT = process.env.PORT || 5000
databaseReady.then(() => {
  const server = app.listen(PORT, () => console.log(`NetFlow server running on port ${PORT}`))
  const shutdown = () => {
    if (draining) return
    draining = true
    const deadline = setTimeout(() => process.exit(1), 30000)
    deadline.unref()
    const requestsClosed = new Promise(resolve => server.close(resolve))
    Promise.all([requestsClosed, require('./jobs/monitor').stop()]).then(async () => {
      await require('./utils/redis').getRedis()?.quit()
      await require('./database/postgres').close()
      process.exit(0)
    }).catch(() => process.exit(1))
    server.closeIdleConnections()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  return server
}).catch(error => {
  console.error('Database startup failed', require('./database/startupError')(error))
  process.exitCode = 1
  return require('./database/postgres').close().catch(() => {})
})

module.exports = app
