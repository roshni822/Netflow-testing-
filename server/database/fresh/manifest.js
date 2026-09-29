'use strict'

const TENANT_TABLES = Object.freeze([
  'organization_departments', 'organization_usage', 'roles', 'users', 'forms',
  'form_drafts', 'form_responses', 'workflows', 'workflow_forms', 'workflow_initiators',
  'workflow_viewers', 'workflow_access_departments', 'workflow_executions',
  'execution_events', 'tasks', 'task_approvers', 'task_votes', 'task_history',
  'notifications', 'audit_logs', 'document_extraction_jobs', 'form_generation_jobs',
  'pdf_auto_fill_learning_profiles', 'pdf_auto_fill_semantic_profiles',
  'integration_dead_letters', 'webhook_delivery_logs', 'webhook_idempotencies',
  'organization_integrations', 'organization_department_integrations',
  'user_auth', 'user_sessions', 'user_mfa_backup_codes', 'file_grants'
])
const PLATFORM_TABLES = Object.freeze(['admin_users', 'admin_roles', 'admin_auth',
  'admin_sessions', 'admin_mfa_backup_codes', 'organizations', 'plans',
  'platform_broadcasts', 'audit_logs'])
const SYSTEM_TABLES = Object.freeze(['schema_migrations', 'provisioning_operations',
  'user_directory', 'resource_routes', 'outbox', 'microsoft_identities', 'tenant_lifecycle'])

function tenantSchemaName (name) {
  const slug = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!slug || slug.length > 56) throw Object.assign(new Error('Organization name must produce 1–56 ASCII characters'), { code: 'INVALID_SCHEMA_NAME' })
  return 'tenant_' + slug
}

function platformCatalog (source) {
  // Platform mappings never contain tenant placement. Scoped tenant mappings
  // are built separately for each verified context, without global caching.
  const copy = (key, name, table, omit = []) => {
    const original = source[key]
    const spec = { ...original, name, table, schema: 'platform', children: [],
      fields: original.fields.filter(f => !omit.includes(f.path)).map(f => ({ ...f })) }
    return spec
  }
  const User = copy('User', 'PlatformAdmin', 'admin_users', ['orgId'])
  User.accountScope = 'platform'
  User.fields.find(f => f.path === 'role').column = 'role_id'
  User.children = source.User.children.map(child => ({ ...child, schema: 'platform', owner: User,
    table: { user_auth: 'admin_auth', user_sessions: 'admin_sessions', user_mfa_backup_codes: 'admin_mfa_backup_codes' }[child.table] }))
  const AuditLog = copy('AuditLog', 'PlatformAudit', 'audit_logs')
  AuditLog.fields = AuditLog.fields.map(f => f.path === 'orgId' ? { ...f, column: 'target_org_id' } : f)
  return {
    User,
    Role: copy('Role', 'PlatformRole', 'admin_roles', ['orgId']),
    Organization: copy('Organization', 'PlatformOrganization', 'organizations', ['isDefault']),
    Plan: copy('Plan', 'Plan', 'plans'),
    AuditLog,
    PlatformBroadcast: copy('PlatformBroadcast', 'PlatformBroadcast', 'platform_broadcasts')
  }
}

function tenantCatalog (source, placement) {
  const shared = platformCatalog(source)
  const result = { Plan: shared.Plan, PlatformBroadcast: shared.PlatformBroadcast }
  for (const [key, original] of Object.entries(source)) {
    if (['Plan', 'PlatformBroadcast', 'Organization'].includes(key)) continue
    const spec = { ...original, schema: placement.schemaName, fields: original.fields.map(f => ({ ...f })) }
    spec.children = original.children.map(child => ({ ...child, schema: placement.schemaName, owner: spec }))
    result[key] = spec
  }
  result.User.accountScope = 'tenant'
  const org = { ...shared.Organization, name: 'TenantOrganization', tenantOrganization: true }
  org.children = source.Organization.children.map(child => ({ ...child, schema: placement.schemaName, owner: org }))
  result.Organization = org
  return result
}
module.exports = { TENANT_TABLES, PLATFORM_TABLES, SYSTEM_TABLES, tenantSchemaName, platformCatalog, tenantCatalog }
