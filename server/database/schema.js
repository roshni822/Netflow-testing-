'use strict'
const { catalog, q, tableName } = require('./catalog')
const literal = v => "'" + String(v).replace(/'/g, "''") + "'"
const metadata = ["legacy_extra jsonb NOT NULL DEFAULT '{}'", "legacy_refs jsonb NOT NULL DEFAULT '{}'", "source_missing text[] NOT NULL DEFAULT '{}'", 'row_version bigint NOT NULL DEFAULT 0']

function generateSchema () {
  const models = Object.values(catalog())
  const sql = [
    '-- Generated from database/catalog.js and the reviewed application schemas.',
    '-- Apply only with the guarded migration CLI. Never run through the HTTP API.',
    'CREATE SCHEMA netflow;', 'CREATE SCHEMA netflow_private;', 'CREATE SCHEMA netflow_migration;',
    'REVOKE ALL ON SCHEMA netflow, netflow_private, netflow_migration FROM PUBLIC;',
    `CREATE TABLE netflow_migration.schema_versions (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());`,
  ]
  const fieldSQL = (field, embedded = false) => {
    let s = `${q(field.column)} ${field.type}`
    if (field.column === 'id' && !embedded) return s + " PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$')"
    if (field.required || (!embedded && ['createdAt', 'updatedAt'].includes(field.path))) s += ' NOT NULL'
    // SQL defaults and constraints share the application validation schema.
    const value = field.validation?.default
    if (value !== undefined && value !== null && typeof value !== 'function' && !field.ref && field.type !== 'jsonb' && field.type !== 'text[]') {
      if (typeof value === 'boolean') s += ` DEFAULT ${value}`
      else if (typeof value === 'number') s += ` DEFAULT ${value}`
      else if (typeof value === 'string') s += ` DEFAULT ${literal(value)}`
    }
    // Organization plan names come from the dynamic plans table.
    if (field.enum?.length && field.path !== 'plan') s += ` CHECK (${q(field.column)} IN (${field.enum.map(literal).join(', ')}))`
    const opts = field.validation || {}
    if (typeof opts.min === 'number') s += ` CHECK (${q(field.column)} >= ${opts.min})`
    if (typeof opts.max === 'number') s += ` CHECK (${q(field.column)} <= ${opts.max})`
    if (typeof opts.maxlength === 'number') s += ` CHECK (char_length(${q(field.column)}) <= ${opts.maxlength})`
    return s
  }
  for (const spec of models) {
    sql.push(`CREATE TABLE ${tableName(spec)} (\n  ${[...spec.fields.map(f => fieldSQL(f)), 'api_version bigint', ...metadata].join(',\n  ')}\n);`)
    for (const child of spec.children) {
      sql.push(`CREATE TABLE ${tableName(child)} (\n  ${[
        `owner_id text NOT NULL REFERENCES ${tableName(spec)}(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED`,
        'tenant_id text', ...(child.one ? [] : ['position integer NOT NULL CHECK (position >= 0)']),
        ...child.fields.map(f => fieldSQL(f, true)), ...metadata,
        child.one ? 'PRIMARY KEY (owner_id)' : 'PRIMARY KEY (owner_id, position)'
      ].join(',\n  ')}\n);`)
    }
  }
  sql.push("ALTER TABLE netflow.organizations ADD COLUMN departments_mode text NOT NULL DEFAULT 'configured' CHECK (departments_mode IN ('configured','legacy_default')); ");
  sql.push("ALTER TABLE netflow.organization_departments ADD COLUMN department_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE, ADD COLUMN name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED, ADD COLUMN from_legacy_default boolean NOT NULL DEFAULT false;");
  sql.push('CREATE UNIQUE INDEX organization_department_name ON netflow.organization_departments(owner_id,name_key);');
  for (const table of ['netflow.users', 'netflow.workflow_access_departments', 'netflow_private.organization_department_integrations']) {
    sql.push(`ALTER TABLE ${table} ADD COLUMN department_id bigint REFERENCES netflow.organization_departments(department_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;`)
  }
  for (const spec of models) {
    for (const part of [spec, ...spec.children]) {
      for (const f of part.fields.filter(f => f.ref)) {
        const target = catalog()[f.ref]
        if (!target) throw new Error('Unmapped reference: ' + f.ref)
        sql.push(`ALTER TABLE ${tableName(part)} ADD CONSTRAINT ${q(`${part.table}_${f.column}_fk`)} FOREIGN KEY (${q(f.column)}) REFERENCES ${tableName(target)}(id) DEFERRABLE INITIALLY DEFERRED;`)
        sql.push(`CREATE INDEX ${q(`${part.table}_${f.column}_idx`)} ON ${tableName(part)} (${q(f.column)});`)
      }
    }
    // Port scalar and compound indexes. Array indexes are represented by their
    // normalized child tables; expiry indexes are retained, with TTL in a worker.
    let ordinal = 0
    for (const [keys, options] of spec.definition.indexes) {
      const fields = Object.keys(keys).map(path => spec.fields.find(f => f.path === path))
      if (fields.some(f => !f) || fields.some(f => f.type === 'jsonb')) continue
      if (!options.unique && fields.length === 1 && fields[0].ref) continue
      let where = ''
      if (spec.name === 'Role' && options.unique) where = ' WHERE org_id IS NOT NULL'
      else if (options.sparse) where = ' WHERE ' + fields.map(f => `${q(f.column)} IS NOT NULL`).join(' AND ')
      const columns = fields.map((f, i) => {
        const column = options.unique && f.ref ? `(COALESCE(${q(f.column)}, legacy_refs->>${literal(f.path)}))` : q(f.column)
        return `${column} ${Object.values(keys)[i] === -1 ? 'DESC' : 'ASC'}`
      }).join(', ')
      // Unique indexes treat missing/null as the same key. Sparse indexes
      // and the tenant-role partial index retain their explicit exclusion policy.
      sql.push(`CREATE ${options.unique ? 'UNIQUE ' : ''}INDEX ${q(`${spec.table}_source_${ordinal++}`)} ON ${tableName(spec)} (${columns})${options.unique && !options.sparse ? ' NULLS NOT DISTINCT' : ''}${where};`)
    }
  }
  sql.push('ALTER TABLE netflow.organizations ADD CONSTRAINT organizations_plan_fk FOREIGN KEY (plan) REFERENCES netflow.plans(key) DEFERRABLE INITIALLY DEFERRED;')
  sql.push("ALTER TABLE netflow.organizations ADD CONSTRAINT organizations_subdomain_format CHECK (subdomain ~ '^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$');")
  sql.push("ALTER TABLE netflow.plans ADD CONSTRAINT plans_key_format CHECK (key ~ '^[a-z0-9-]+$');")
  sql.push('CREATE UNIQUE INDEX user_sessions_identity ON netflow_private.user_sessions(owner_id, session_id);')
  sql.push('CREATE UNIQUE INDEX user_mfa_backup_codes_identity ON netflow_private.user_mfa_backup_codes(owner_id, code_hash);')
  sql.push('CREATE UNIQUE INDEX task_approvers_identity ON netflow.task_approvers(owner_id, user_id) WHERE user_id IS NOT NULL;')
  sql.push('CREATE UNIQUE INDEX task_votes_identity ON netflow.task_votes(owner_id, user_id) WHERE user_id IS NOT NULL;')
  sql.push('ALTER TABLE netflow.workflow_forms ADD CONSTRAINT workflow_form_owner UNIQUE(tenant_id, form_id) DEFERRABLE INITIALLY DEFERRED;')
  for (const name of ['document_extraction_jobs', 'form_generation_jobs']) sql.push(`CREATE INDEX ${name}_claim ON netflow.${name}(created_at, id) WHERE status = 'queued';`)
  sql.push("CREATE INDEX tasks_tenant_inbox ON netflow.tasks(org_id, assigned_to, status, due_date, created_at DESC);")
  sql.push("CREATE INDEX audit_logs_tenant_recent ON netflow.audit_logs(org_id, created_at DESC, id);")
  sql.push("CREATE INDEX form_responses_tenant_form ON netflow.form_responses(org_id, form_id, created_at DESC);")
  sql.push("CREATE TABLE netflow_private.outbox (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text, event_key text NOT NULL UNIQUE, event_type text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')), attempts integer NOT NULL DEFAULT 0, retry_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);")
  sql.push("CREATE INDEX outbox_pending ON netflow_private.outbox(retry_at, id) WHERE status IN ('pending','failed');")
  const system = "nullif(current_setting('netflow.system', true), '') IS NOT NULL"
  const tenant = "nullif(current_setting('netflow.org_id', true), '')"
  for (const spec of models) {
    for (const part of [spec, ...spec.children]) {
      const tenantColumn = part.owner ? 'tenant_id' : spec.name === 'Organization' ? 'id' : spec.fields.some(f => f.path === 'orgId') ? 'org_id' : null
      const owned = tenantColumn ? `${q(tenantColumn)} = ${tenant}` : 'false'
      const read = ['Plan', 'PlatformBroadcast'].includes(spec.name) ? 'true' : spec.name === 'Role' ? `${owned} OR org_id IS NULL` : owned
      sql.push(`ALTER TABLE ${tableName(part)} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${tableName(part)} FORCE ROW LEVEL SECURITY;`)
      sql.push(`CREATE POLICY read_access ON ${tableName(part)} FOR SELECT USING (${system} OR ${read});`)
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        sql.push(`CREATE POLICY ${operation.toLowerCase()}_access ON ${tableName(part)} FOR ${operation} ${operation === 'INSERT' ? '' : `USING (${system} OR ${owned})`} ${operation === 'DELETE' ? '' : `WITH CHECK (${system} OR ${owned})`};`)
      }
    }
  }
  sql.push('ALTER TABLE netflow_private.outbox ENABLE ROW LEVEL SECURITY;', 'ALTER TABLE netflow_private.outbox FORCE ROW LEVEL SECURITY;', `CREATE POLICY outbox_access ON netflow_private.outbox USING (${system} OR tenant_id = ${tenant}) WITH CHECK (${system} OR tenant_id = ${tenant});`)
  sql.push('REVOKE ALL ON ALL TABLES IN SCHEMA netflow, netflow_private, netflow_migration FROM PUBLIC;')
  return sql.join('\n\n') + '\n'
}
module.exports = { generateSchema }
