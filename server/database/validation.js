'use strict'
const Ajv = require('ajv')
const { get, set, clone, plain } = require('./value')
const { newId, asId } = require('./ids')
const ajv = new Ajv({ allErrors: true, strict: false, ownProperties: true })
ajv.addFormat('date-time', value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
const validators = new WeakMap()

function validationError (path, message) {
  const error = new Error(path ? `${path}: ${message}` : message)
  error.name = 'ValidationError'
  error.errors = { [path || 'record']: { path, message: error.message } }
  return error
}
function tree (fields) {
  const root = { kind: 'object', fields: {} }
  for (const [path, field] of Object.entries(fields)) {
    const parts = path.split('.')
    let current = root
    for (const key of parts.slice(0, -1)) {
      current.fields[key] ||= { kind: 'object', fields: {}, implicit: true }
      current = current.fields[key]
    }
    current.fields[parts.at(-1)] = field
  }
  return root
}
function jsonSchema (field) {
  if (field.kind === 'json') return field.required ? { not: { type: 'null' } } : {}
  const kind = { id: 'string', date: 'string' }[field.kind] || field.kind
  const result = { type: field.required ? kind : [kind, 'null'] }
  if (field.kind === 'object') {
    const fields = tree(field.fields || {}).fields
    result.properties = Object.fromEntries(Object.entries(fields).map(([name, child]) => [name, jsonSchema(child)]))
    result.additionalProperties = true // Unknown data is retained, never silently discarded.
    const required = Object.keys(fields).filter(name => fields[name].required || (fields[name].implicit && containsRequired(fields[name])))
    if (required.length) result.required = required
  }
  if (field.kind === 'array') result.items = jsonSchema(field.items || { kind: 'json' })
  if (field.kind === 'id') result.pattern = '^[a-f0-9]{24}$'
  if (field.kind === 'date') result.format = 'date-time'
  if (field.kind === 'string' && field.required) result.minLength = Math.max(1, field.minlength || 0)
  if (field.minlength !== undefined) result.minLength = field.minlength
  if (field.maxlength !== undefined) result.maxLength = field.maxlength
  if (field.min !== undefined) result.minimum = field.min
  if (field.max !== undefined) result.maximum = field.max
  if (field.enum) result.enum = field.required ? field.enum : [...field.enum, null]
  if (field.pattern && !field.patternFlags) result.pattern = field.pattern
  return result
}
function containsRequired (field) {
  return Object.values(field.fields || {}).some(child => child.required || (child.implicit && containsRequired(child)))
}
function normalizeField (field, value, options, path) {
  if (value === undefined && options.defaults) {
    if (field.defaultFactory === 'id') value = newId()
    else if (field.defaultFactory === 'now') value = new Date()
    else if (Object.hasOwn(field, 'default')) value = clone(field.default)
  }
  if (value === undefined && field.kind === 'object' && field.implicit && options.defaults) value = {}
  if (value == null) return value
  if (field.kind === 'id') return asId(value)
  if (field.kind === 'string') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw validationError(path, 'Must be text')
    value = String(value)
    if (field.trim) value = value.trim()
    if (field.lowercase) value = value.toLowerCase()
    if (field.uppercase) value = value.toUpperCase()
    if (field.patternFlags && !new RegExp(field.pattern, field.patternFlags).test(value)) throw validationError(path, 'Invalid format')
    return value
  }
  if (field.kind === 'number') {
    if (value === '') return null
    if (!['number', 'string', 'boolean'].includes(typeof value) || !Number.isFinite(Number(value))) throw validationError(path, 'Must be a finite number')
    return Number(value)
  }
  if (field.kind === 'boolean') {
    if ([true, 1, '1', 'true', 'yes'].includes(value)) return true
    if ([false, 0, '0', 'false', 'no'].includes(value)) return false
    throw validationError(path, 'Must be a boolean')
  }
  if (field.kind === 'date') {
    if (value === '') return null
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) throw validationError(path, 'Must be a valid date')
    return date
  }
  if (field.kind === 'array') {
    const values = Array.isArray(value) ? value : [value]
    return values.map((item, index) => normalizeField(field.items || { kind: 'json' }, item, options, `${path}.${index}`))
  }
  if (field.kind === 'object') {
    if (typeof value !== 'object' || Array.isArray(value) || value instanceof Date) throw validationError(path, 'Must be an object')
    // Newly appended embedded records still need IDs, timestamps and defaults
    // when their parent already exists. Do not default projected root fields.
    return normalizeFields(field.fields, value, options.embeddedDefaults && !field.implicit ? { ...options, defaults: true } : options, path)
  }
  return clone(value)
}
function normalizeFields (fields, source, options = {}, prefix = '') {
  const result = clone(source || {})
  for (const [name, field] of Object.entries(tree(fields).fields)) {
    const value = normalizeField(field, result[name], options, prefix ? `${prefix}.${name}` : name)
    if (value !== undefined) result[name] = value
  }
  return result
}
function validate (definition, value, options = {}) {
  const result = normalizeFields(definition.fields, value, options)
  let validator = validators.get(definition)
  if (!validator) {
    // Plan keys are database records. Keep the frozen source definition for
    // historical schema generation, but allow dynamically managed plan keys.
    const fields={...definition.fields}
    if(definition.name==='Organization' && fields.plan) {fields.plan={...fields.plan};delete fields.plan.enum;fields.plan.pattern='^[a-z0-9-]{1,48}$'}
    validator = ajv.compile(jsonSchema({ kind: 'object', required: true, fields })); validators.set(definition, validator)
  }
  if (!validator(plain(result))) {
    const errors = {}
    for (const issue of validator.errors) {
      const path = [issue.instancePath.split('/').filter(Boolean).join('.'), issue.params.missingProperty].filter(Boolean).join('.')
      errors[path || 'record'] = { path, message: `${path || 'Record'} ${issue.message}` }
    }
    throw Object.assign(new Error('Record validation failed'), { name: 'ValidationError', errors })
  }
  return result
}
function fieldAt (definition, path) {
  if (definition.fields[path]) return definition.fields[path]
  const parts = path.split('.')
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = definition.fields[parts.slice(0, i).join('.')]
    if (!parent) continue
    const child = parent.kind === 'array' ? parent.items : parent
    const tail = parts.slice(i).filter(part => !/^\d+$/.test(part)).join('.')
    if (child.kind === 'json') return child
    if (child.fields) return fieldAt(child, tail)
  }
}
function depopulate (definition, input) {
  const value = clone(input)
  for (const [path, field] of Object.entries(definition.fields)) {
    const original = get(value, path)
    if (original == null) continue
    if (field.kind === 'id') set(value, path, typeof original === 'object' ? original._id : original)
    else if (field.kind === 'array') set(value, path, (Array.isArray(original) ? original : [original]).map(item => field.items?.kind === 'id' ? item?._id || item : field.items?.fields && item ? depopulate(field.items, item) : item))
    else if (field.fields) set(value, path, depopulate(field, original))
  }
  return value
}
module.exports = { validate, normalizeFields, fieldAt, depopulate, validationError, jsonSchema }
