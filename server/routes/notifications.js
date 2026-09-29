// M3 - Phase 2 - routes/notifications.js
// Per-user notifications: list, mark single read, mark all read.

const express = require('express')

const Notification = require('../models/Notification')
const { protect } = require('../middleware/auth')
const { sendSuccess, sendError } = require('../utils/apiResponse')

const router = express.Router()

const sameId = (a, b) => String(a) === String(b)

// GET /api/notifications
router.get('/', protect, async (req, res, next) => {
  try {
    const query = { userId: req.user._id }
    if (req.query.isRead !== undefined) query.isRead = req.query.isRead === 'true'
    if (req.query.type) query.type = req.query.type

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20))

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(query)
        .populate('triggeredBy', 'name')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({ userId: req.user._id, isRead: false })
    ])

    return sendSuccess(res, {
      count: notifications.length,
      unreadCount,
      notifications
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/mark-all-read
// IMPORTANT: declared before /:id/read so Express doesn't capture
// "mark-all-read" as a route param.
router.patch('/mark-all-read', protect, async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, isRead: false },
      { $set: { isRead: true } }
    )
    return sendSuccess(res, {
      updatedCount: result.modifiedCount ?? result.nModified ?? 0
    })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/:id/read
router.patch('/:id/read', protect, async (req, res, next) => {
  try {
    const notif = await Notification.findById(req.params.id)
    if (!notif) return sendError(res, 'Notification not found', 'NOTIFICATION_NOT_FOUND', 404)
    if (!sameId(notif.userId, req.user._id)) {
      return sendError(res, 'Not authorised to read this notification', 'FORBIDDEN', 403)
    }

    notif.isRead = true
    await notif.save()

    return sendSuccess(res, { notification: notif.toObject() })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/notifications/:id — remove a single notification the user owns.
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const notif = await Notification.findById(req.params.id)
    if (!notif) return sendError(res, 'Notification not found', 'NOTIFICATION_NOT_FOUND', 404)
    if (!sameId(notif.userId, req.user._id)) {
      return sendError(res, 'Not authorised to delete this notification', 'FORBIDDEN', 403)
    }

    await notif.deleteOne()
    return sendSuccess(res, { deleted: true })
  } catch (err) {
    next(err)
  }
})

module.exports = router
