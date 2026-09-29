'use strict'
const Role = require('../database/model')('Role')
Role.beforeValidate = record => {
  record.name = String(record.name || '').trim()
  record.nameKey = record.name.toLowerCase()
}
module.exports = Role
