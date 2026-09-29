'use strict'
function get (object, path) {
  if (!path) return object
  return path.split('.').reduce((v, key) => v == null ? undefined : v[key], object)
}
function set (object, path, value) {
  const parts = path.split('.')
  const last = parts.pop()
  let current = object
  for (const key of parts) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe field path')
    if (value === undefined && (!current[key] || typeof current[key] !== 'object')) return
    if (!current[key] || typeof current[key] !== 'object') current[key] = {}
    current = current[key]
  }
  if (['__proto__', 'constructor', 'prototype'].includes(last)) throw new Error('Unsafe field path')
  if (value === undefined) delete current[last]
  else current[last] = value
}
function plain (value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}
function clone (value) {
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Date) return new Date(value.getTime())
  if (Array.isArray(value)) return value.map(clone)
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe object key')
    result[key] = clone(child)
  }
  return result
}
function number (value) {
  const n = Number(value)
  if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) throw new Error('Numeric value is outside the API safe range')
  return n
}
module.exports = { get, set, plain, clone, number }
