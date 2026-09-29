'use strict'
const { catalog, tableName, q } = require('./catalog')
const { get, set, plain, number } = require('./value')
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
function rowSignature (spec, row, columns) {
  return JSON.stringify(ordered(Object.fromEntries(columns.map(column => {
    const field = spec.fields.find(f => f.column === column)
    let value = row[column]
    if (value != null && field?.type === 'numeric') value = number(value)
    if (value != null && field?.type === 'timestamptz') value = new Date(value).toISOString()
    if (value != null && field?.type === 'jsonb' && typeof value === 'string') value = JSON.parse(value)
    return [column, value]
  }))))
}

function serialize (field, value) {
  if (value === undefined || value === null) return null
  if (field.ref || field.type === 'text') return String(value?._id || value)
  if (field.type === 'jsonb') return JSON.stringify(plain(value))
  if (field.type === 'numeric') return number(value)
  if (field.type === 'timestamptz') {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date at ${field.path}`)
    return date
  }
  return value
}

async function encodePart (part, source, resolver, options = {}) {
  const row = { legacy_extra: plain(source) || {}, legacy_refs: {}, source_missing: [] }
  for (const field of part.fields) {
    const path = part.owner && !part.one ? field.localPath : field.path
    const value = get(source, path)
    if (path) set(row.legacy_extra, path, undefined)
    if (value === undefined) row.source_missing.push(field.path)
    if (field.ref && value != null) {
      const id = String(value?._id || value)
      const found = await resolver(field.ref, id, field.path)
      row[field.column] = found ? id : null
      if (!found) {
        if (!(typeof options.allowLegacy === 'function' ? options.allowLegacy(field.path, id) : options.allowLegacy)) throw Object.assign(new Error(`Unresolved ${field.ref} reference at ${field.path}`), { code: 'INVALID_REFERENCE' })
        row.legacy_refs[field.path] = id
      }
    } else row[field.column] = serialize(field, value)
  }
  return row
}

async function encode (spec, document, resolver, options = {}) {
  const source = plain(document)
  if (spec.accountScope === 'platform') {
    if (source.orgId) throw Object.assign(new Error('Platform accounts cannot belong to an organization'), { code: 'ACCOUNT_SCOPE_MISMATCH' })
    delete source.orgId
    delete source.accountScope
  }
  if (spec.accountScope === 'tenant') delete source.accountScope
  const row = await encodePart(spec, source, resolver, options)
  if (spec.name === 'Organization') row.departments_mode = Array.isArray(source.departments) && source.departments.length ? 'configured' : 'legacy_default'
  row.api_version = source.__v ?? null
  delete row.legacy_extra.__v
  const children = []
  for (const child of spec.children) {
    let values
    if (child.group) values = [source]
    else {
      const value = get(source, child.path)
      if (value === undefined) row.source_missing.push(child.path)
      // Explicit null and empty array/object have distinct source semantics.
      if (value === null) row.legacy_extra[`__null:${child.path}`] = true
      values = child.one ? (value == null ? [] : [source]) : (value || [])
      if (!Array.isArray(values)) throw new Error(`Expected array at ${child.path}`)
      set(row.legacy_extra, child.path, undefined)
    }
    const legacyDepartments = spec.name === 'Organization' && child.path === 'departments' && row.departments_mode === 'legacy_default'
    if (legacyDepartments) values = require('../utils/departments').listFor(source)
    for (const field of child.fields) if (child.group) set(row.legacy_extra, field.path, undefined)
    for (let position = 0; position < values.length; position++) {
      const value = values[position]
      let childRow
      if (child.primitive) {
        childRow = { legacy_extra: {}, legacy_refs: {}, source_missing: [] }
        const field = child.fields[0]
        const id = value == null ? null : String(value)
        if (field.ref && id != null && !await resolver(field.ref, id, child.path)) {
          if (!(typeof options.allowLegacy === 'function' ? options.allowLegacy(child.path, id) : options.allowLegacy)) throw Object.assign(new Error(`Unresolved reference at ${child.path}`), { code: 'INVALID_REFERENCE' })
          childRow[field.column] = null
          childRow.legacy_refs[field.path] = id
        } else childRow[field.column] = id
      } else {
        childRow = await encodePart(child, value, resolver, options)
        if (child.one) {
          // One-to-one rows own only their assigned fields, never a copy of the
          // whole source document (which could duplicate secrets into public data).
          childRow.legacy_extra = child.group ? {} : plain(get(source, child.path)) || {}
          for (const field of child.fields) set(childRow.legacy_extra, field.localPath, undefined)
          for (const exclude of child.exclude || []) set(childRow.legacy_extra, exclude, undefined)
        }
      }
      childRow.owner_id = String(source._id)
      childRow.tenant_id = spec.name === 'Organization' || spec.tenantOrganization ? String(source._id) : source.orgId || null
      if (!child.one) childRow.position = position
      if (legacyDepartments) childRow.from_legacy_default = true
      children.push({ spec: child, row: childRow })
    }
  }
  return { row, children }
}

function decodePart (part, row, options = {}) {
  const result = options.includeExtra ? structuredClone(row.legacy_extra || {}) : {}
  const missing = new Set(row.source_missing || [])
  for (const field of part.fields) {
    if (missing.has(field.path)) continue
    let value = row.legacy_refs?.[field.path] ?? row[field.column]
    if (field.type === 'numeric' && value != null) value = number(value)
    if (value !== undefined) set(result, part.owner && !part.one ? field.localPath : field.path, value)
  }
  return result
}

async function decode (client, spec, rows, options = {}) {
  if (!rows.length) return []
  const result = rows.map(row => {
    const value = decodePart(spec, row, options)
    if (spec.accountScope) { value.accountScope = spec.accountScope; if (spec.accountScope === 'platform') value.orgId = null }
    if (row.api_version != null) value.__v = number(row.api_version)
    Object.defineProperty(value, '__sqlVersion', { value: number(row.row_version), enumerable: false })
    return value
  })
  const ids = rows.map(r => r.id)
  for (const child of spec.children) {
    const { rows: childRows } = await client.query(`SELECT * FROM ${tableName(child)} WHERE owner_id = ANY($1::text[])${child.one ? '' : ' ORDER BY position'}`, [ids])
    const groups = new Map()
    for (const row of childRows) {
      if (!groups.has(row.owner_id)) groups.set(row.owner_id, [])
      groups.get(row.owner_id).push(row)
    }
    for (let i = 0; i < rows.length; i++) {
      const owner = rows[i]
      // Shared organization metadata describes the original reservation, not
      // subsequent tenant-child presence. Read presence from the local tables.
      if (!spec.tenantOrganization && child.path && owner.source_missing.includes(child.path)) continue
      const records = (groups.get(owner.id) || []).filter(r => spec.tenantOrganization || !r.from_legacy_default)
      if (child.group || child.one) {
        for (const record of records) {
          const object = decodePart(child, record, { includeExtra: false })
          for (const field of child.fields) {
            const value = get(object, field.path)
            if (value !== undefined) set(result[i], field.path, value)
          }
          if (options.includeExtra && !child.group && child.path) {
            const current = get(result[i], child.path) || {}
            set(result[i], child.path, { ...record.legacy_extra, ...current })
          }
        }
        if (!spec.tenantOrganization && child.path && owner.legacy_extra?.[`__null:${child.path}`]) set(result[i], child.path, null)
      } else {
        const values = records.map(record => child.primitive
          ? record.legacy_refs?.[child.path] ?? record[child.primitive]
          : decodePart(child, record, options))
        set(result[i], child.path, !spec.tenantOrganization && owner.legacy_extra?.[`__null:${child.path}`] ? null : values)
      }
      if (options.includeExtra && child.path) delete result[i][`__null:${child.path}`]
    }
  }
  return result
}

async function insertRow (client, spec, row) {
  if (['users', 'workflow_access_departments', 'organization_department_integrations'].includes(spec.table)) {
    const orgId = spec.table === 'users' ? row.org_id : row.tenant_id
    const name = spec.table === 'workflow_access_departments' ? row.department_name : row.department
    const result = await client.query(`SELECT department_id FROM ${spec.schema ? q(spec.schema) : 'netflow'}.organization_departments WHERE owner_id=$1 AND name_key=lower(btrim($2))`, [orgId, name])
    row.department_id = result.rows[0]?.department_id || null
  }
  const fields = Object.keys(row)
  const values = fields.map(key => ['legacy_extra', 'legacy_refs'].includes(key) ? JSON.stringify(row[key]) : row[key])
  await client.query(`INSERT INTO ${tableName(spec)} (${fields.map(q).join(',')}) VALUES (${values.map((_, i) => '$' + (i + 1)).join(',')})`, values)
}

async function write (client, spec, document, options = {}) {
  if (options.update && options.allowLegacy === true && !options.resolver) {
    const allowed = new Set()
    const root = await client.query(`SELECT legacy_refs FROM ${tableName(spec)} WHERE id=$1`, [String(document._id)])
    for (const row of root.rows) for (const [path, id] of Object.entries(row.legacy_refs)) allowed.add(path + ':' + id)
    for (const child of spec.children) {
      const records = await client.query(`SELECT legacy_refs FROM ${tableName(child)} WHERE owner_id=$1`, [String(document._id)])
      for (const row of records.rows) for (const [path, id] of Object.entries(row.legacy_refs)) allowed.add(path + ':' + id)
    }
    options = { ...options, allowLegacy: (path, id) => allowed.has(path + ':' + id) }
  }
  const resolver = options.resolver || (async (name, id) => {
    const target = catalog()[name]
    const result = await client.query(`SELECT id FROM ${tableName(target)} WHERE id = $1`, [id])
    return result.rowCount > 0
  })
  // Tenant settings may update approved shared profile columns and local
  // children, never licence, placement, plan or platform actor references.
  const mutableOrg = ['id', 'name', 'billing_email', 'pdf_auto_fill', 'updated_at']
  if (spec.tenantOrganization && options.update) {
    const stored = (await client.query(`SELECT * FROM ${tableName(spec)} WHERE id=$1`, [String(document._id)])).rows[0]
    for (const field of spec.fields.filter(f => !mutableOrg.includes(f.column))) {
      const value = get(document, field.path)
      if (value === undefined && stored.source_missing.includes(field.path)) continue
      if (rowSignature(spec, { [field.column]: serialize(field, value) }, [field.column]) !== rowSignature(spec, stored, [field.column])) {
        throw Object.assign(new Error('This organization setting requires platform administration'), { code: 'PLATFORM_SETTING_PROTECTED', statusCode: 403 })
      }
    }
  }
  const encodingSpec = spec.tenantOrganization ? { ...spec, fields: spec.fields.filter(f => mutableOrg.includes(f.column)) } : spec
  const encoded = await encode(encodingSpec, document, resolver, options)
  if (spec.tenantOrganization) {
    if (!options.update) throw Object.assign(new Error('Use organization provisioning'), { code: 'DATABASE_SCOPE_REQUIRED' })
    for (const key of Object.keys(encoded.row)) if (!mutableOrg.includes(key)) delete encoded.row[key]
  }
  if (spec.name === 'User' && options.update) {
    const result = await client.query(`SELECT department_id FROM ${spec.schema ? q(spec.schema) : 'netflow'}.organization_departments WHERE owner_id=$1 AND name_key=lower(btrim($2))`, [encoded.row.org_id, encoded.row.department])
    encoded.row.department_id = result.rows[0]?.department_id || null
  }
  if (options.update) {
    const fields = Object.keys(encoded.row).filter(k => k !== 'id')
    const values = fields.map(k => ['legacy_extra', 'legacy_refs'].includes(k) ? JSON.stringify(encoded.row[k]) : encoded.row[k])
    values.push(String(document._id))
    await client.query(`UPDATE ${tableName(spec)} SET ${fields.map((k, i) => `${q(k)} = $${i + 1}`).join(',')}, row_version = row_version + 1 WHERE id = $${values.length}`, values)
  } else await insertRow(client, spec, encoded.row)
  for (const child of spec.children) {
    const incoming = encoded.children.filter(entry => entry.spec === child)
    if (options.update) {
      const existing = await client.query(`SELECT * FROM ${tableName(child)} WHERE owner_id=$1${child.one ? '' : ' ORDER BY position'}`, [String(document._id)])
      const unchanged = incoming.length === existing.rows.length && incoming.every((entry, i) => {
        const columns = Object.keys(entry.row)
        return rowSignature(child, entry.row, columns) === rowSignature(child, existing.rows[i], columns)
      })
      if (unchanged) continue
      await client.query(`DELETE FROM ${tableName(child)} WHERE owner_id=$1`, [String(document._id)])
    }
    for (const entry of incoming) await insertRow(client, child, entry.row)
  }
  if (spec.name === 'Organization' || spec.tenantOrganization) {
    const schema = spec.tenantOrganization ? q(require('../tenancy/tenantContext').getPlacement().schemaName) : 'netflow'
    await client.query(`UPDATE ${schema}.users u SET department_id=d.department_id FROM ${schema}.organization_departments d WHERE u.org_id=$1 AND d.owner_id=u.org_id AND d.name_key=lower(btrim(u.department))`, [String(document._id)])
    await client.query(`UPDATE ${schema}.workflow_access_departments w SET department_id=d.department_id FROM ${schema}.organization_departments d WHERE w.tenant_id=$1 AND d.owner_id=w.tenant_id AND d.name_key=lower(btrim(w.department_name))`, [String(document._id)])
  }
  if (spec.accountScope === 'tenant') {
    // Account reset routing and credential changes commit together. The auth
    // handler still verifies the actual local hash/expiry on every use.
    await client.query("DELETE FROM system.resource_routes WHERE purpose='password_reset' AND account_scope='tenant' AND org_id=$1 AND resource_id=$2", [String(document.orgId), String(document._id)])
    if (document.resetPasswordToken && document.resetPasswordExpires) await client.query("INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id,expires_at) VALUES('password_reset',$1,'tenant',$2,$3,$4)", [document.resetPasswordToken, String(document.orgId), String(document._id), document.resetPasswordExpires])
  }
  await require('./fresh/resources').sync(client, spec.name, document)
  return encoded
}

module.exports = { encode, decode, write, insertRow, serialize }
