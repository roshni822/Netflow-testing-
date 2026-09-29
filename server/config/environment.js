'use strict'
const path = require('node:path')
module.exports = function loadEnvironment () {
  if (process.env.NETFLOW_SKIP_DOTENV === '1') return
  // All backend settings share one private file; deployment variables still win.
  require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true })
}
