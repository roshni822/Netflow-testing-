'use strict'
const { get, set, plain } = require('./value')
const equal = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b))

function updatePaths (document, path, filters, action) {
  const parts = path.split('.')
  if (parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) throw new Error('Unsafe field path')
  const visit = (object, index) => {
    const key = parts[index]
    if (key.startsWith('$[')) {
      if (!Array.isArray(object)) throw new Error('Array update on a non-array field')
      const identifier = key.slice(2, -1)
      const rules = filters.filter(f => Object.keys(f).some(k => k === identifier || k.startsWith(identifier + '.')))
      if (identifier && !rules.length) throw new Error('Missing array filter')
      object.forEach((value, position) => {
        const matches = rules.every(rule => Object.entries(rule).every(([k, expected]) => equal(k === identifier ? value : get(value, k.slice(identifier.length + 1)), expected)))
        if (matches) {
          if (index === parts.length - 1) object[position] = action(value)
          else visit(value, index + 1)
        }
      })
    } else if (index === parts.length - 1) {
      const value = action(object[key])
      if (value === undefined) delete object[key]
      else object[key] = value
    } else {
      if (!object[key]) object[key] = {}
      visit(object[key], index + 1)
    }
  }
  visit(document, 0)
}

function applyUpdate (document, update, options = {}) {
  for (const [operator, values] of Object.entries(update)) {
    if (!operator.startsWith('$')) { set(document, operator, values); continue }
    if (operator === '$setOnInsert' && !options.inserting) continue
    for (const [path, value] of Object.entries(values)) {
      updatePaths(document, path, options.arrayFilters || [], old => {
        if (operator === '$set' || operator === '$setOnInsert') return value
        if (operator === '$unset') return undefined
        if (operator === '$inc') return (old === undefined ? 0 : Number(old)) + Number(value)
        if (operator === '$push' || operator === '$addToSet') {
          const existing = [...(old || [])]
          const append = value && typeof value === 'object' && value.$each ? value.$each : [value]
          for (const item of append) if (operator === '$push' || !existing.some(v => equal(v, item))) existing.push(item)
          if (value?.$slice !== undefined) return value.$slice < 0 ? existing.slice(value.$slice) : existing.slice(0, value.$slice)
          return existing
        }
        if (operator === '$pull') return (old || []).filter(item => value?.$in ? !value.$in.some(v => equal(v, item)) : !equal(item, value))
        if (operator === '$max') return old == null || old < value ? value : old
        if (operator === '$min') return old == null || old > value ? value : old
        throw new Error('Unsupported update operator: ' + operator)
      })
    }
  }
  return document
}
module.exports = { applyUpdate }
