'use strict'

// Explicit PostgreSQL storage mappings and database-independent validation metadata.
const snake = value => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\./g, '_').toLowerCase()
const definitions = {
  Plan: { table: 'plans', json: ['limits', 'features'] },
  Organization: { table: 'organizations', json: ['features', 'pdfAutoFill', 'limits', 'licence.notified'],
    children: {
      departments: { table: 'organization_departments', primitive: 'name' },
      usage: { table: 'organization_usage', one: true, json: ['notified'] },
      integrations: { table: 'organization_integrations', one: true, private: true, exclude: ['departmentDms'] },
      'integrations.departmentDms': { table: 'organization_department_integrations', private: true }
    } },
  Role: { table: 'roles' },
  User: { table: 'users', json: ['notificationPrefs'],
    groups: { user_auth: { private: true, fields: ['password', 'tokenVersion', 'resetPasswordToken', 'resetPasswordExpires', 'failedLoginAttempts', 'lockUntil', 'mfaEnabled', 'mfaSecret'] } },
    children: { activeSessions: { table: 'user_sessions', private: true, primitive: 'session_id' }, mfaBackupCodes: { table: 'user_mfa_backup_codes', private: true, primitive: 'code_hash' } } },
  Form: { table: 'forms', json: ['fields'] },
  FormDraft: { table: 'form_drafts', json: ['formData'] },
  FormResponse: { table: 'form_responses', json: ['formData', 'attachments', 'submittedByExternal'] },
  Workflow: { table: 'workflows', json: ['nodes', 'edges', 'inboundWebhook.expectedFields'],
    children: {
      linkedFormIds: { table: 'workflow_forms', primitive: 'form_id', ref: 'Form' },
      'access.allowedInitiators': { table: 'workflow_initiators', primitive: 'user_id', ref: 'User' },
      'access.visibleTo': { table: 'workflow_viewers', primitive: 'user_id', ref: 'User' },
      'access.departments': { table: 'workflow_access_departments', primitive: 'department_name' }
    } },
  WorkflowExecution: { table: 'workflow_executions', json: ['variables', 'triggeredByExternal'], children: { executionLog: { table: 'execution_events', json: ['output'] } } },
  Task: { table: 'tasks', json: ['formFields', 'formData', 'attachments'], children: {
    parallelApprovers: { table: 'task_approvers', primitive: 'user_id', ref: 'User' },
    parallelApprovals: { table: 'task_votes' },
    approvalHistory: { table: 'task_history', json: ['signature'] }
  } },
  Notification: { table: 'notifications' },
  AuditLog: { table: 'audit_logs', json: ['metadata'] },
  PlatformBroadcast: { table: 'platform_broadcasts' },
  DocumentExtractionJob: { table: 'document_extraction_jobs', json: ['sourceFile', 'pageMeta', 'lines', 'suggestions', 'summary'] },
  FormGenerationJob: { table: 'form_generation_jobs', json: ['sourceFile', 'pageMeta', 'lines', 'candidates', 'confidenceSummary', 'qualitySummary', 'coverage'] },
  PdfAutoFillLearningProfile: { table: 'pdf_auto_fill_learning_profiles' },
  PdfAutoFillSemanticProfile: { table: 'pdf_auto_fill_semantic_profiles' },
  IntegrationDeadLetter: { table: 'integration_dead_letters' },
  WebhookDeliveryLog: { table: 'webhook_delivery_logs' },
  WebhookIdempotency: { table: 'webhook_idempotencies' }
}

const sqlType = field => {
  if (['id', 'string'].includes(field.kind)) return 'text'
  if (field.kind === 'date') return 'timestamptz'
  if (field.kind === 'boolean') return 'boolean'
  if (field.kind === 'number') return 'numeric'
  if (field.kind === 'array' && field.items?.kind === 'string') return 'text[]'
  return 'jsonb'
}
const under = (path, prefix) => path === prefix || path.startsWith(prefix + '.')
const q = name => '"' + name.replace(/"/g, '""') + '"'
const tableName = spec => {
  if (!spec) throw Object.assign(new Error('A scoped storage mapping is required'), { code: 'DATABASE_SCOPE_REQUIRED' })
  return `${spec.schema ? q(spec.schema) : (spec.private ? 'netflow_private' : 'netflow')}.${q(spec.table)}`
}
let cache

function sourceCatalog () {
  if (cache) return cache
  cache = {}
  for (const [name, definition] of Object.entries(definitions)) {
    const model = require(`../models/${name}`)
    const schema = model.definition
    const spec = { ...definition, name, model, definition: schema, collection: schema.collection, fields: [], children: [] }
    const addFields = (target, localSchema, prefix = '', excluded = [], json = []) => {
      const seen = new Set()
      for (const [path, schemaPath] of Object.entries(localSchema.fields)) {
        if (path === '__v' || excluded.some(p => under(path, p))) continue
        const jsonRoot = json.find(p => under(path, p))
        const key = jsonRoot || path
        if (seen.has(key)) continue
        seen.add(key)
        target.fields.push({ path: prefix + key, localPath: key, column: key === '_id' ? 'id' : snake(key), type: jsonRoot ? 'jsonb' : sqlType(schemaPath),
          ref: jsonRoot ? undefined : schemaPath.ref,
          required: key !== '_id' && !jsonRoot && !schemaPath.ref && schemaPath.required === true,
          enum: jsonRoot ? [] : (schemaPath.enum || []), validation: schemaPath })
      }
    }
    const childPaths = Object.keys(definition.children || {})
    const groupPaths = Object.values(definition.groups || {}).flatMap(g => g.fields)
    addFields(spec, schema, '', [...childPaths, ...groupPaths], definition.json || [])
    for (const [table, group] of Object.entries(definition.groups || {})) {
      const child = { table, private: group.private, one: true, group: true, fields: [], owner: spec }
      addFields(child, schema, '', Object.keys(schema.fields).filter(p => !group.fields.includes(p)))
      spec.children.push(child)
    }
    for (const [path, childDef] of Object.entries(definition.children || {})) {
      const child = { ...childDef, path, fields: [], owner: spec }
      if (child.primitive) {
        child.fields.push({ path, localPath: '', column: child.primitive, type: 'text', ref: child.ref, required: !child.ref })
      } else if (child.one) {
        // Nested relational objects retain their relative field paths.
        const subset = { fields: Object.fromEntries(Object.entries(schema.fields).filter(([p]) => p.startsWith(path + '.')).map(([p, v]) => [p.slice(path.length + 1), v])) }
        addFields(child, subset, path + '.', child.exclude || [], child.json || [])
      } else {
        const nested = schema.fields[path]?.items
        if (!nested) throw new Error(`Missing child schema: ${name}.${path}`)
        addFields(child, nested, '', [], child.json || [])
      }
      spec.children.push(child)
    }
    cache[name] = spec
  }
  return cache
}

function catalog () {
  const source = sourceCatalog()
  if (!require('./layout').organizationSchemas()) return source
  if (require('../tenancy/tenantContext').getOrgId()) {
    const placement = require('../tenancy/tenantContext').getPlacement()
    if (!placement) throw Object.assign(new Error('Resolve tenant placement before using repositories'), { code: 'DATABASE_SCOPE_REQUIRED' })
    return require('./fresh/manifest').tenantCatalog(source, placement)
  }
  return require('./fresh/manifest').platformCatalog(source)
}

module.exports = { catalog, sourceCatalog, definitions, snake, q, tableName, under }
