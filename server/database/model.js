'use strict'
const { Record } = require('./record')
const models = new Map()
module.exports = function defineModel (name) {
  if (models.has(name)) return models.get(name)
  class Model extends Record {}
  Model.modelName = name
  Model.definition = require('../models/definitions/' + name + '.json')
  Model.fromRow = value => new Model(value, { newRecord: false })
  Model.populate = (records, instructions) => require('./relations').populate(Model, records, instructions)
  models.set(name, Model)
  return require('./repository').attachRepository(Model)
}
