'use strict'
const { catalog, tableName, q } = require('./catalog')
const { SqlQuery } = require('./query')
const { compileAggregate } = require('./aggregate')
const { transaction } = require('./postgres')
const { decode, write } = require('./storage')
const { get, set, plain, number, clone } = require('./value')
const { applyUpdate } = require('./updates')
const { getOrgId } = require('../tenancy/tenantContext')
const { fieldAt, normalizeFields } = require('./validation')
const originals = new WeakMap()

function projection (input) {
  if (!input) return {}
  if (typeof input === 'object') return input
  return Object.fromEntries(input.split(/\s+/).filter(Boolean).map(key => [key.replace(/^[-+]/, ''), key.startsWith('-') ? 0 : key.startsWith('+') ? 2 : 1]))
}
function project (definition, value, fields) {
  const inclusions = Object.entries(fields).filter(([key, include]) => include === 1 && key !== '_id')
  const result = inclusions.length ? {} : clone(value)
  if (inclusions.length) {
    if (fields._id !== 0) result._id = value._id
    for (const [key] of inclusions) if (get(value, key) !== undefined) set(result, key, get(value, key))
  }
  for (const [path, field] of Object.entries(definition.fields)) if (field.hidden === true && !fields[path]) set(result, path, undefined)
  for (const [key, include] of Object.entries(fields)) {
    if (include === 0) set(result, key, undefined)
    else if (include === 2 && get(value, key) !== undefined) set(result, key, get(value, key))
  }
  return result
}
function scopeFilter (spec, filter, options) {
  const orgId = getOrgId()
  if (orgId && spec.tenantOrganization) return { $and: [filter, { _id: orgId }] }
  if (orgId && spec.fields.some(f => f.path === 'orgId') && !options.skipOrgScope && !Object.hasOwn(filter, 'orgId')) return { ...filter, orgId }
  return filter
}
function translatedError (error) {
  if (error.code === '23505') {
    const duplicate = new Error('A record with this unique value already exists')
    duplicate.code = 11000
    return duplicate
  }
  if (error.code === '23503' || error.code === '23514' || error.code === '23502') return Object.assign(new Error('Data integrity validation failed'), { name: 'ValidationError', code: 'DATA_INTEGRITY' })
  return error
}

class RepositoryQuery {
  constructor (model, operation, filter = {}, options = {}, update) {
    this.model = model; this.operation = operation; this.filter = filter || {}; this.options = { ...options }; this.update = update
    this._fields = projection(options.projection || options.select); this.populates = []
  }
  select (value) { Object.assign(this._fields, projection(value)); return this }
  lean (value = true) { this.options.lean = value; return this }
  sort (value) { this.options.sort = value; return this }
  skip (value) { this.options.skip = value; return this }
  limit (value) { this.options.limit = value; return this }
  setOptions (value) { Object.assign(this.options, value); return this }
  getOptions () { return this.options }
  getFilter () { return this.filter }
  selectedInclusively () { return Object.values(this._fields).some(v => v === 1) }
  populate (path, select) {
    if (Array.isArray(path)) this.populates.push(...path)
    else if (typeof path === 'string') this.populates.push(...path.split(/\s+/).filter(Boolean).map(p => ({ path: p, select })))
    else this.populates.push(path)
    return this
  }
  then (yes, no) { return this.exec().then(yes, no) }
  catch (no) { return this.exec().catch(no) }
  finally (fn) { return this.exec().finally(fn) }
  exec () { return this.promise || (this.promise = this.execute().catch(error => { throw translatedError(error) })) }
  async present (values) {
    const result = values.map(value => {
      const selected = project(this.model.definition, value, this._fields)
      if (this.options.lean) return selected
      const document = this.model.fromRow(selected)
      originals.set(document, { source: value, version: value.__sqlVersion })
      return document
    })
    if (this.populates.length) await this.model.populate(result, this.populates.map(p => ({ ...p, options: { ...p.options, lean: !!this.options.lean } })))
    return result
  }
  async execute () {
    const spec = catalog()[this.model.modelName]
    if (!spec) throw Object.assign(new Error('A scoped repository is required'), { code: 'DATABASE_SCOPE_REQUIRED' })
    const filter = scopeFilter(spec, this.filter, this.options)
    return transaction(async client => {
      if (this.options.upsert) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [spec.name + ':' + JSON.stringify(Object.fromEntries(Object.entries(plain(filter)).sort(([a], [b]) => a.localeCompare(b))))])
      const builder = new SqlQuery(spec)
      const where = builder.filter(filter) + (spec.accountScope ? ' AND t.deleted_at IS NULL' : '')
      const single = ['findOne', 'findOneAndUpdate', 'findOneAndDelete', 'updateOne', 'deleteOne', 'exists'].includes(this.operation)
      const mutating = ['findOneAndUpdate', 'updateOne', 'updateMany', 'findOneAndDelete', 'deleteOne', 'deleteMany'].includes(this.operation)
      if (this.operation === 'countDocuments') {
        const result = await client.query(`SELECT count(*) AS count FROM ${tableName(spec)} t WHERE ${where}`, builder.values)
        return number(result.rows[0].count)
      }
      if (this.operation === 'distinct') {
        const field = builder.field(this.options.path)
        const result = await client.query(`SELECT DISTINCT ${field.sql} AS value FROM ${tableName(spec)} t WHERE ${where}`, builder.values)
        return result.rows.map(r => r.value).filter(v => v != null)
      }
      const limit = single ? 1 : this.options.limit || 0
      const skip = this.options.skip || 0
      if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(skip) || skip < 0) throw new Error('Invalid pagination')
      const order = builder.order(this.options.sort || {})
      const claim = ['DocumentExtractionJob', 'FormGenerationJob'].includes(spec.name) && this.operation === 'findOneAndUpdate'
      const result = await client.query(`SELECT t.* FROM ${tableName(spec)} t WHERE ${where}${order ? ' ORDER BY ' + order : ''}${limit ? ' LIMIT ' + limit : ''}${skip ? ' OFFSET ' + skip : ''}${mutating ? ' FOR UPDATE OF t' + (claim ? ' SKIP LOCKED' : '') : ''}`, builder.values)
      let values = await decode(client, spec, result.rows, { includeExtra: true })
      if (this.operation === 'exists') return values[0] ? { _id: values[0]._id } : null
      if (this.operation.includes('Delete') || this.operation.startsWith('delete')) {
        for (const value of values) await remove(client, spec, value._id)
        if (this.operation === 'findOneAndDelete') return (await this.present(values))[0] || null
        return { acknowledged: true, deletedCount: values.length }
      }
      if (mutating) {
        if (!values.length && this.options.upsert) {
          const document = {}
          for (const [path, value] of Object.entries(filter)) if (!path.startsWith('$') && (value == null || typeof value !== 'object')) set(document, path, value)
          applyUpdate(document, this.update, { ...this.options, inserting: true })
          const created = await this.model.create(document)
          if (this.operation === 'findOneAndUpdate') return this.options.new || this.options.returnDocument === 'after' ? (await this.present([created.toObject({ depopulate: true })]))[0] : null
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: created._id }
        }
        const after = []
        for (const value of values) {
          const changed = applyUpdate(plain(value), this.update, this.options)
          const doc = this.model.fromRow(changed)
          const paths = Object.entries(this.update).flatMap(([key, values]) => key.startsWith('$') ? Object.keys(values) : [key])
          for (const path of paths) {
            const castPath = path.replace(/\.\$\[[^\]]*\].*$/, '')
            const known = fieldAt(this.model.definition, castPath) || Object.keys(this.model.definition.fields).some(key => key.startsWith(castPath + '.'))
            if (!known) throw Object.assign(new Error('Unknown update field'), { name: 'ValidationError', code: 'UNKNOWN_FIELD' })
            doc.set(castPath, get(changed, castPath))
          }
          if (this.options.runValidators) await doc.validate()
          if (spec.definition.timestamps) doc.updatedAt = new Date()
          const saved = normalizeFields(this.model.definition.fields, { ...changed, ...doc.toObject({ depopulate: true }) }, { defaults: false, embeddedDefaults: true })
          // Validation casts fields and embedded IDs, without save hooks: update
          // operations never hash an existing password a second time.
          await write(client, spec, saved, { update: true, allowLegacy: true })
          after.push(saved)
        }
        if (this.operation === 'findOneAndUpdate') return (await this.present(this.options.new || this.options.returnDocument === 'after' ? after : values))[0] || null
        return { acknowledged: true, matchedCount: values.length, modifiedCount: values.length }
      }
      values = await this.present(values)
      return single ? values[0] || null : values
    })
  }
}

async function remove (client, spec, id) {
  await require('./fresh/resources').remove(client, spec.name, id)
  if (spec.tenantOrganization) throw Object.assign(new Error('Organization lifecycle requires the platform service'), { code: 'DATABASE_SCOPE_REQUIRED' })
  // History survives a parent deletion: preserve the original reference and
  // detach its FK. Only owned child rows cascade. RLS still applies to all rows.
  for (const target of Object.values(catalog())) {
    for (const part of [target, ...target.children]) {
      // Shared actor/initial-admin links reference the durable directory and
      // survive tenant account deletion. Never mutate platform lifecycle fields.
      if (require('./layout').organizationSchemas() && part.schema === 'platform') continue
      for (const field of part.fields.filter(f => f.ref === spec.name)) {
        if (target.name === 'AuditLog') continue
        await client.query(`UPDATE ${tableName(part)} SET legacy_refs = legacy_refs || jsonb_build_object($1::text, ${q(field.column)}), ${q(field.column)} = NULL WHERE ${q(field.column)} = $2`, [field.path, id])
      }
    }
  }
  await client.query(`DELETE FROM ${tableName(spec)} WHERE id = $1`, [id])
}

function attachRepository (model) {
  for (const op of ['find', 'findOne', 'countDocuments', 'exists', 'deleteOne', 'deleteMany', 'findOneAndDelete']) model[op] = (filter, select, options = {}) => new RepositoryQuery(model, op, filter, options).select(select)
  model.findById = (id, select, options = {}) => model.findOne({ _id: id }, select, options)
  model.findByIdAndDelete = (id, options = {}) => new RepositoryQuery(model, 'findOneAndDelete', { _id: id }, options)
  for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) model[op] = (filter, update, options = {}) => new RepositoryQuery(model, op, filter, options, update)
  model.findByIdAndUpdate = (id, update, options = {}) => model.findOneAndUpdate({ _id: id }, update, options)
  model.distinct = (path, filter = {}) => new RepositoryQuery(model, 'distinct', filter, { path })
  model.create = async value => {
    if (Array.isArray(value)) return transaction(async () => { const result = []; for (const entry of value) result.push(await new model(entry).save()); return result })
    return new model(value).save()
  }
  model.insertMany = (values) => model.create(values)
  model.aggregate = pipeline => {
    const options = {}
    const exec = () => transaction(async client => {
      const spec = catalog()[model.modelName]
      if (!spec) throw Object.assign(new Error('A scoped repository is required'), { code: 'DATABASE_SCOPE_REQUIRED' })
      const compiled = compileAggregate(spec, pipeline, scopeFilter(spec, {}, options))
      const { rows } = await client.query(compiled.sql, compiled.values)
      for (const row of rows) for (const [key, field] of Object.entries(compiled.fields || {})) if (field.type === 'numeric' && row[key] != null) row[key] = number(row[key])
      return rows
    })
    const query = { option: value => { Object.assign(options, value); return query }, exec, then: (yes, no) => exec().then(yes, no) }
    return query
  }
  model.prototype.save = async function () {
    const document = this
    const spec = catalog()[model.modelName]
    if (!spec) throw Object.assign(new Error('A scoped repository is required'), { code: 'DATABASE_SCOPE_REQUIRED' })
    try {
      return await transaction(async client => {
        if (document.isNew && spec.fields.some(f => f.path === 'orgId') && !document.orgId && getOrgId()) document.orgId = getOrgId()
        let candidate = document
        const modified = document.directModifiedPaths()
        if (!document.isNew) {
          const existing = await client.query(`SELECT * FROM ${tableName(spec)} WHERE id=$1${spec.accountScope ? ' AND deleted_at IS NULL' : ''} FOR UPDATE`, [String(document._id)])
          if (!existing.rowCount) throw new Error('Record not found or access denied')
          const original = originals.get(document)
          if (original && original.version !== undefined && number(existing.rows[0].row_version) !== original.version) throw Object.assign(new Error('This record changed; reload and retry'), { code: 'CONCURRENT_UPDATE', statusCode: 409 })
          const current = (await decode(client, spec, existing.rows, { includeExtra: true }))[0]
          const full = clone(current)
          const selected = document.toObject({ depopulate: true })
          for (const path of modified) set(full, path, get(selected, path))
          candidate = model.fromRow(full)
          for (const path of modified) candidate.markModified(path)
        }
        // Validate the complete row, including unselected required/private fields.
        // Password hashing sees only an actual password change, never a projection.
        await candidate.validate()
        if (model.beforeSave) await model.beforeSave(candidate)
        const now = new Date()
        if (spec.definition.timestamps) {
          if (document.isNew && !candidate.createdAt) candidate.createdAt = now
          candidate.updatedAt = now
        }
        const data = candidate.toObject({ depopulate: true })
        if (data.__v === undefined && document.isNew) data.__v = 0
        await write(client, spec, data, { update: !document.isNew, allowLegacy: !document.isNew })
        if (candidate !== document) {
          for (const path of modified) set(document, path, get(data, path))
          if (spec.definition.timestamps) document.updatedAt = data.updatedAt
        }
        if (document.isNew) document.__v = data.__v
        document.isNew = false
        document.resetChanges()
        const version = await client.query(`SELECT row_version FROM ${tableName(spec)} WHERE id=$1`, [String(document._id)])
        originals.set(document, { source: data, version: number(version.rows[0].row_version) })
        return document
      })
    } catch (error) { throw translatedError(error) }
  }
  model.prototype.deleteOne = function () { return model.deleteOne({ _id: this._id }) }
  // Unsupported repository operations fail explicitly.
  for (const op of ['bulkWrite', 'replaceOne', 'findOneAndReplace', 'watch', 'mapReduce']) model[op] = () => { throw new Error(`Unported database operation: ${model.modelName}.${op}`) }
  return model
}
module.exports = { attachRepository, RepositoryQuery, project }
