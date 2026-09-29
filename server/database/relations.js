'use strict'
const { fieldAt } = require('./validation')

function locations (object, parts, output = []) {
  if (!object) return output
  if (Array.isArray(object)) { object.forEach(item => locations(item, parts, output)); return output }
  const [key, ...rest] = parts
  if (rest.length) locations(object[key], rest, output)
  else if (Object.hasOwn(object, key)) output.push({ object, key, value: object[key] })
  return output
}
async function populate (model, records, instructions) {
  const list = Array.isArray(records) ? records : [records]
  for (const instruction of instructions) {
    const dirty = new Set(list.filter(record => record?.isModified?.(instruction.path.split('.')[0])))
    const field = fieldAt(model.definition, instruction.path)
    const name = field?.ref || field?.items?.ref
    if (!name) throw new Error(`Unknown relation: ${model.modelName}.${instruction.path}`)
    const Related = require(`../models/${name}`)
    const slots = list.flatMap(record => locations(record, instruction.path.split('.')))
    const ids = [...new Set(slots.flatMap(slot => Array.isArray(slot.value) ? slot.value : [slot.value]).filter(Boolean).map(value => String(value._id || value)))]
    if (!ids.length) continue
    let query = Related.find({ ...(instruction.match || {}), _id: { $in: ids } }).select(instruction.select)
    if (instruction.options?.lean) query = query.lean()
    if (instruction.populate) query = query.populate(instruction.populate)
    const found = await query
    const byId = new Map(found.map(record => [String(record._id), record]))
    for (const slot of slots) {
      const resolve = id => byId.get(String(id?._id || id)) || null
      slot.object[slot.key] = Array.isArray(slot.value) ? slot.value.map(resolve).filter(Boolean) : slot.value == null ? slot.value : resolve(slot.value)
    }
    for (const record of list) if (record?.acceptLoadedRelation && !dirty.has(record)) record.acceptLoadedRelation(instruction.path)
  }
  return records
}
module.exports = { populate }
