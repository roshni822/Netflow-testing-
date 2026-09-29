'use strict'
const monitor = require('./monitor')
const { withSystemAccess } = require('../database/context')
async function sweep () {
  const now = Date.now()
  const policies = [
    ['PlatformBroadcast', 'expiresAt', 0],
    ['IntegrationDeadLetter', 'createdAt', 90],
    ['WebhookDeliveryLog', 'createdAt', 30],
    ['WebhookIdempotency', 'createdAt', 7]
  ]
  return withSystemAccess('worker', async () => {
    for (const [name, field, days] of policies) {
      // Platform broadcast lifecycle belongs to platform administration.
      if (name === 'PlatformBroadcast' && require('../database/layout').organizationSchemas()) continue
      await require(`../models/${name}`).deleteMany({ [field]: { $lte: new Date(now - days * 86400000) } })
    }
  })
}
const startRetention = () => monitor.schedule('retention', '* * * * *', 60000, sweep)
module.exports = { sweep, startRetention }
