'use strict'
const { isDeepStrictEqual } = require('node:util')
const { get, set, clone } = require('./value')
const { normalizeFields, validate, depopulate } = require('./validation')
const states = new WeakMap()
const stateOf = record => states.get(record)
function changedPaths (before, after, prefix = '') {
  if (isDeepStrictEqual(before, after)) return []
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after) || before instanceof Date || after instanceof Date) return [prefix]
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key))
}
function publicValue (value) {
  if (value instanceof Record) return value.toJSON()
  if (Array.isArray(value)) return value.map(publicValue)
  if (!value || typeof value !== 'object' || value instanceof Date) return clone(value)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, publicValue(child)]))
}
class Record {
  constructor (data = {}, options = {}) {
    const value = normalizeFields(this.constructor.definition.fields, data, { defaults: options.newRecord !== false })
    for (const [key, item] of Object.entries(value)) {
      if (key in Record.prototype || key in this.constructor.prototype) throw new Error('Reserved record property')
      this[key] = item
    }
    states.set(this, { isNew: options.newRecord !== false, forced: new Set(), locals: {}, baseline: depopulate(this.constructor.definition, value) })
  }
  // Workflow hop guards use transient document state. Keep it outside the
  // persisted/serialized fields so it never becomes customer JSONB data.
  get $locals () { return stateOf(this).locals }
  get isNew () { return stateOf(this).isNew }
  set isNew (value) { stateOf(this).isNew = value }
  get (path) { return get(this, path) }
  set (path, value) { set(this, path, value); return this }
  markModified (path) { stateOf(this).forced.add(path) }
  directModifiedPaths () {
    return [...new Set([...changedPaths(stateOf(this).baseline, this.toObject({ depopulate: true })), ...stateOf(this).forced])].filter(Boolean)
  }
  isModified (path) {
    if (this.isNew) return get(this, path) !== undefined
    return this.directModifiedPaths().some(changed => changed === path || changed.startsWith(path + '.') || path.startsWith(changed + '.'))
  }
  resetChanges () {
    stateOf(this).baseline = this.toObject({ depopulate: true })
    stateOf(this).forced.clear()
  }
  acceptLoadedRelation (path) {
    const root = path.split('.')[0]
    set(stateOf(this).baseline, root, get(this.toObject({ depopulate: true }), root))
  }
  toObject (options = {}) { return options.depopulate ? depopulate(this.constructor.definition, this) : clone(this) }
  toJSON () {
    const value = Object.fromEntries(Object.entries(this).map(([key, item]) => [key, publicValue(item)]))
    return this.constructor.serialize ? this.constructor.serialize(value) : value
  }
  async validate () {
    if (this.constructor.beforeValidate) await this.constructor.beforeValidate(this)
    const value = validate(this.constructor.definition, this.toObject({ depopulate: true }), { defaults: this.isNew, embeddedDefaults: true })
    // Preserve populated objects until the repository serializes references.
    for (const [key, item] of Object.entries(value)) {
      const field = this.constructor.definition.fields[key]
      if (field?.kind === 'id' && this[key] && typeof this[key] === 'object') continue
      this[key] = item
    }
    return this
  }
  async populate (path, select) {
    const instructions = typeof path === 'string' ? [{ path, select }] : Array.isArray(path) ? path : [path]
    await require('./relations').populate(this.constructor, this, instructions)
    return this
  }
}
module.exports = { Record, changedPaths }
