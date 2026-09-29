'use strict'
const crypto = require('node:crypto')
// Keep the existing API's 24-character identity format without a BSON type.
const newId = () => crypto.randomBytes(12).toString('hex')
const isValidId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
function asId (value) {
  const id = value && typeof value === 'object' ? value._id : value
  if (!isValidId(id)) throw Object.assign(new Error('Invalid record identifier'), { name: 'CastError', path: '_id', value: '[invalid identifier]' })
  return id.toLowerCase()
}
module.exports = { newId, isValidId, asId }
