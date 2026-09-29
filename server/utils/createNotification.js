// M3 - Phase 2 - utils/createNotification.js
// Fire-and-forget notification writer. NEVER throws — notification failure
// must not break the action that triggered it.

const Notification = require('../models/Notification')
const User = require('../models/User')
const { resolvePref } = require('./notificationPrefs')

const createNotification = async ({
  userId,
  title,
  message,
  type,
  taskId,
  triggeredBy
}) => {
  try {
    if (!userId) return null
    // Respect the recipient's in-app channel preference for this event type.
    // Untunable types always deliver (resolvePref returns on-by-default).
    const recipient = await User.findById(userId).select('notificationPrefs').lean()
    if (!recipient) return null
    if (!resolvePref(recipient, type).inApp) return null
    return await Notification.create({
      userId,
      title,
      message,
      type,
      taskId,
      triggeredBy
    })
  } catch (err) {
    console.error('createNotification error:', err.message)
    return null
  }
}

module.exports = { createNotification: (...args) => require('../database/context').trackBackground(createNotification(...args)) }
