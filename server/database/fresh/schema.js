'use strict'

const { sourceCatalog, q } = require('../catalog')
const { platformCatalog, TENANT_TABLES } = require('./manifest')
const literal = value => "'" + String(value).replace(/'/g, "''") + "'"
const table = spec => `${q(spec.schema)}.${q(spec.table)}`
const metadata = ["legacy_extra jsonb NOT NULL DEFAULT '{}'", "legacy_refs jsonb NOT NULL DEFAULT '{}'",
  "source_missing text[] NOT NULL DEFAULT '{}'", 'row_version bigint NOT NULL DEFAULT 0']

// Keep API field/JSON shapes and validation metadata; the fresh baseline has its
// own immutable SQL files, independent of the historical 001/002 migrations.
function fieldSQL (field, child = false) {
  const col = q(field.column)
  if (field.column === 'id' && !child) return `${col} text PRIMARY KEY CHECK (${col} ~ '^[0-9a-f]{24}$')`
  let sql = `${col} ${field.type}`
  if (field.required || field.validation?.required === true || (!child && ['createdAt', 'updatedAt'].includes(field.path))) sql += ' NOT NULL'
  const opts = field.validation || {}
  if (['createdAt', 'updatedAt'].includes(field.path)) sql += ' DEFAULT now()'
  else if (opts.default != null && !field.ref && (field.type !== 'jsonb' || typeof opts.default === 'object')) {
    if (typeof opts.default === 'boolean' || typeof opts.default === 'number') sql += ` DEFAULT ${opts.default}`
    else if (typeof opts.default === 'string') sql += ` DEFAULT ${literal(opts.default)}`
    else if (field.type === 'jsonb') sql += ` DEFAULT ${literal(JSON.stringify(opts.default))}::jsonb`
    else if (field.type === 'text[]' && Array.isArray(opts.default)) sql += ` DEFAULT ARRAY[${opts.default.map(literal).join(',')}]::text[]`
  }
  if (field.enum?.length && field.path !== 'plan') sql += ` CHECK (${col} IN (${field.enum.map(literal).join(',')}))`
  if (typeof opts.min === 'number') sql += ` CHECK (${col} >= ${opts.min})`
  if (typeof opts.max === 'number') sql += ` CHECK (${col} <= ${opts.max})`
  if (typeof opts.maxlength === 'number') sql += ` CHECK (char_length(${col}) <= ${opts.maxlength})`
  return sql
}

function createTables (models) {
  const sql = []
  for (const spec of Object.values(models)) {
    sql.push(`CREATE TABLE ${table(spec)} (${[...spec.fields.map(f => fieldSQL(f)), 'api_version bigint', ...metadata].join(',\n  ')});`)
    for (const child of spec.children) sql.push(createChild(child, spec))
  }
  return sql
}
function createChild (child, owner) {
  return `CREATE TABLE ${table(child)} (${[
    `owner_id text NOT NULL REFERENCES ${table(owner)}(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED`,
    'tenant_id text', ...(child.one ? [] : ['position integer NOT NULL CHECK (position >= 0)']),
    ...child.fields.map(f => fieldSQL(f, true)), ...metadata,
    child.one ? 'PRIMARY KEY (owner_id)' : 'PRIMARY KEY (owner_id,position)'
  ].join(',\n  ')});`
}
function indexesAndReferences (models, targets) {
  const sql = []
  for (const [key, spec] of Object.entries(models)) {
    for (const part of [spec, ...spec.children]) {
      for (const f of part.fields.filter(f => f.ref)) {
        // Audits retain immutable historical IDs without destructive account FKs.
        if (key === 'AuditLog') continue
        if (key === 'Organization' && f.path === 'adminUserId') continue
        if (spec.schema !== 'platform' && ((key==='Notification' && f.path==='triggeredBy') || (key==='IntegrationDeadLetter' && f.path==='resolvedBy'))) {
          sql.push(`ALTER TABLE ${table(part)} ADD CONSTRAINT ${q(`${part.table}_${f.column}_fk`)} FOREIGN KEY (${q(f.column)}) REFERENCES system.user_directory(user_id) DEFERRABLE INITIALLY DEFERRED;`)
          sql.push(`CREATE TRIGGER ${q(`${part.table}_${f.column}_scope`)} BEFORE INSERT OR UPDATE ON ${table(part)} FOR EACH ROW EXECUTE FUNCTION system.check_directory_actor(${literal(f.column)});`)
          continue
        }
        const target = targets[f.ref]
        if (!target) throw new Error('Unmapped reference: ' + f.ref)
        sql.push(`ALTER TABLE ${table(part)} ADD CONSTRAINT ${q(`${part.table}_${f.column}_fk`)} FOREIGN KEY (${q(f.column)}) REFERENCES ${table(target)}(id) DEFERRABLE INITIALLY DEFERRED;`)
        sql.push(`CREATE INDEX ${q(`${part.table}_${f.column}_idx`)} ON ${table(part)}(${q(f.column)});`)
      }
    }
    let ordinal = 0
    for (const [keys, options] of spec.definition.indexes) {
      const fields = Object.keys(keys).map(path => spec.fields.find(f => f.path === path))
      if (fields.some(f => !f || f.type === 'jsonb') || (options.unique && ['User', 'Role'].includes(key))) continue
      const columns = fields.map((f, i) => `${q(f.column)} ${Object.values(keys)[i] === -1 ? 'DESC' : 'ASC'}`).join(',')
      const where = options.sparse ? ' WHERE ' + fields.map(f => `${q(f.column)} IS NOT NULL`).join(' AND ') : ''
      sql.push(`CREATE ${options.unique ? 'UNIQUE ' : ''}INDEX ${q(`${spec.table}_source_${ordinal++}`)} ON ${table(spec)}(${columns})${where};`)
    }
  }
  return sql
}

function generatePlatformSQL () {
  const models = platformCatalog(sourceCatalog())
  const sql = ['CREATE SCHEMA platform;', 'CREATE SCHEMA system;',
    'REVOKE ALL ON SCHEMA platform, system FROM PUBLIC;', ...createTables(models), ...indexesAndReferences(models, models)]
  sql.push(`ALTER TABLE platform.admin_users ADD COLUMN account_scope text NOT NULL DEFAULT 'platform' CHECK (account_scope='platform'), ADD COLUMN deleted_at timestamptz,
 ADD COLUMN is_bootstrap boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX single_bootstrap_admin ON platform.admin_users(is_bootstrap) WHERE is_bootstrap;
ALTER TABLE platform.admin_users ALTER COLUMN role_id SET NOT NULL;
CREATE UNIQUE INDEX admin_users_email_live ON platform.admin_users(lower(btrim(email))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX admin_roles_name ON platform.admin_roles(name_key);
ALTER TABLE platform.admin_roles ALTER COLUMN name_key SET NOT NULL;
ALTER TABLE platform.admin_users ADD CONSTRAINT admin_email_normalized CHECK (email=lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$');
ALTER TABLE platform.organizations ADD COLUMN schema_name text NOT NULL UNIQUE CHECK (schema_name ~ '^tenant_[a-z0-9]+(_[a-z0-9]+)*$' AND octet_length(schema_name)<=63),
 ADD COLUMN provisioning_status text NOT NULL DEFAULT 'provisioning' CHECK (provisioning_status IN ('provisioning','ready','failed','maintenance','deleting','deleted')),
 ADD COLUMN schema_version text, ADD COLUMN deleted_at timestamptz;
ALTER TABLE platform.organizations ADD CONSTRAINT organizations_plan_fk FOREIGN KEY(plan) REFERENCES platform.plans(key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE platform.organizations ADD CONSTRAINT organizations_subdomain_format CHECK (subdomain ~ '^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$');
ALTER TABLE platform.plans ADD CONSTRAINT plans_key_format CHECK (key ~ '^[a-z0-9-]+$');
CREATE UNIQUE INDEX admin_sessions_identity ON platform.admin_sessions(owner_id,session_id);
CREATE UNIQUE INDEX admin_mfa_codes_identity ON platform.admin_mfa_backup_codes(owner_id,code_hash);
ALTER TABLE platform.admin_auth ADD CONSTRAINT admin_token_version_valid CHECK(token_version>=0 AND token_version=trunc(token_version));
ALTER TABLE platform.admin_auth ADD CONSTRAINT admin_password_hash CHECK(password ~ '^\\$2[aby]\\$[0-9]{2}\\$');
ALTER TABLE platform.admin_auth ADD CONSTRAINT admin_auth_no_tenant CHECK(tenant_id IS NULL);
ALTER TABLE platform.admin_sessions ADD CONSTRAINT admin_sessions_no_tenant CHECK(tenant_id IS NULL);
ALTER TABLE platform.admin_mfa_backup_codes ADD CONSTRAINT admin_codes_no_tenant CHECK(tenant_id IS NULL);`)
  return sql.join('\n\n') + '\n'
}

function generateTenantSQL () {
  // These markers are replaced only by the setup/provisioning code after strict
  // validation. They are not client inputs and cannot contain arbitrary SQL.
  const schema = '__TENANT_SCHEMA__'
  const source = sourceCatalog()
  const models = {}
  for (const [key, original] of Object.entries(source)) {
    if (['Organization', 'Plan', 'PlatformBroadcast'].includes(key)) continue
    const spec = { ...original, schema, fields: original.fields.map(f => ({ ...f })), children: [] }
    spec.children = original.children.map(child => ({ ...child, schema, owner: spec }))
    models[key] = spec
  }
  const shared = platformCatalog(source)
  const sql = [`CREATE SCHEMA ${q(schema)};`, `REVOKE ALL ON SCHEMA ${q(schema)} FROM PUBLIC;`, ...createTables(models)]
  const orgChildren = source.Organization.children.map(child => ({ ...child, schema }))
  for (const child of orgChildren) sql.push(createChild(child, shared.Organization))
  sql.push(...indexesAndReferences(models, { ...models, Organization: shared.Organization, PlatformBroadcast: shared.PlatformBroadcast }))
  for (const child of orgChildren) for (const field of child.fields.filter(f => f.ref)) {
    const target = models[field.ref] || shared[field.ref]
    sql.push(`ALTER TABLE ${table(child)} ADD FOREIGN KEY (${q(field.column)}) REFERENCES ${table(target)}(id) DEFERRABLE INITIALLY DEFERRED;`)
  }
  sql.push(`ALTER TABLE "${schema}".organization_departments ADD COLUMN department_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 ADD COLUMN name_key text GENERATED ALWAYS AS(lower(btrim(name))) STORED, ADD COLUMN from_legacy_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX organization_department_name ON "${schema}".organization_departments(owner_id,name_key);
ALTER TABLE "${schema}".users ADD COLUMN deleted_at timestamptz;
CREATE UNIQUE INDEX users_email_live ON "${schema}".users(org_id,lower(btrim(email))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX roles_name ON "${schema}".roles(org_id,name_key);
ALTER TABLE "${schema}".users ALTER COLUMN role SET NOT NULL;
ALTER TABLE "${schema}".users ADD CONSTRAINT user_email_normalized CHECK(email=lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$');
ALTER TABLE "${schema}".users ADD CONSTRAINT user_directory_fk FOREIGN KEY(org_id,id) REFERENCES system.user_directory(org_id,user_id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX user_sessions_identity ON "${schema}".user_sessions(owner_id,session_id);
CREATE UNIQUE INDEX user_mfa_codes_identity ON "${schema}".user_mfa_backup_codes(owner_id,code_hash);
CREATE UNIQUE INDEX task_approvers_identity ON "${schema}".task_approvers(owner_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX task_votes_identity ON "${schema}".task_votes(owner_id,user_id) WHERE user_id IS NOT NULL;
ALTER TABLE "${schema}".workflow_forms ADD CONSTRAINT workflow_form_owner UNIQUE(tenant_id,form_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "${schema}".file_grants(path text PRIMARY KEY,org_id text NOT NULL REFERENCES platform.organizations(id),
 owner_id text REFERENCES "${schema}".users(id), granted_by_admin_id text REFERENCES platform.admin_users(id),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now());`)
  for (const name of ['users', 'workflow_access_departments', 'organization_department_integrations']) sql.push(`ALTER TABLE "${schema}".${q(name)} ADD COLUMN department_id bigint REFERENCES "${schema}".organization_departments(department_id) DEFERRABLE INITIALLY DEFERRED;`)
  const parts = Object.values(models).flatMap(spec => [spec, ...spec.children]).concat(orgChildren)
  if (new Set([...parts.map(p => p.table), 'file_grants']).size !== TENANT_TABLES.length || parts.some(p => !TENANT_TABLES.includes(p.table))) throw new Error('Tenant manifest drift')
  for (const part of [...parts, { table: 'file_grants', fields: [{ path: 'orgId' }] }]) {
    const column = part.owner ? 'tenant_id' : 'org_id'
    const qualified = `"${schema}".${q(part.table)}`
    sql.push(`ALTER TABLE ${qualified} ALTER COLUMN ${column} SET NOT NULL;
ALTER TABLE ${qualified} ADD CONSTRAINT fixed_organization CHECK(${column}='__ORG_ID__');
ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON ${qualified} USING (${column}=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (${column}=nullif(current_setting('netflow.org_id',true),''));`)
    if (part.owner?.name === 'Organization') sql.push(`ALTER TABLE ${qualified} ADD CONSTRAINT organization_child_owner CHECK(owner_id=tenant_id);`)
  }
  sql.push(`CREATE TRIGGER user_directory_sync AFTER INSERT OR UPDATE OR DELETE ON "${schema}".users FOR EACH ROW EXECUTE FUNCTION system.sync_user_directory('tenant','__ORG_ID__');
CREATE CONSTRAINT TRIGGER user_directory_consistency AFTER INSERT OR UPDATE ON "${schema}".users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION system.check_user_directory('tenant','__ORG_ID__');
CREATE TRIGGER audit_history_protection BEFORE UPDATE OR DELETE ON "${schema}".audit_logs FOR EACH ROW EXECUTE FUNCTION system.protect_audit_history();
CREATE INDEX tasks_inbox ON "${schema}".tasks(assigned_to,status,due_date,created_at DESC);
CREATE INDEX audit_recent ON "${schema}".audit_logs(created_at DESC,id);
CREATE INDEX responses_form ON "${schema}".form_responses(form_id,created_at DESC);`)
  for (const name of ['document_extraction_jobs', 'form_generation_jobs']) sql.push(`CREATE INDEX ${name}_claim ON "${schema}".${name}(created_at,id) WHERE status='queued';`)
  sql.push(`REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM PUBLIC;
GRANT USAGE ON SCHEMA "${schema}" TO netflow_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO netflow_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO netflow_app;
REVOKE UPDATE,DELETE,TRUNCATE ON "${schema}".audit_logs FROM netflow_app;`)
  return sql.join('\n\n') + '\n'
}

module.exports = { generatePlatformSQL, generateTenantSQL }
