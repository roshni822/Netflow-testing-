// Per-user notification channel preferences.
// Users choose, per event type, whether they want an in-app notification, an
// email, both, or neither. These are the only event types that today produce
// BOTH an in-app notification and an email — so every toggle is meaningful.
// Account/security mail (welcome, password reset) is transactional and is
// intentionally NOT tunable here.

const NOTIFICATION_EVENTS = ['assignment', 'approval', 'rejection', 'escalation']

// User-facing copy (kept here so the client and server agree on the set).
const EVENT_LABELS = {
  assignment: {
    title: 'Task assigned to me',
    description: 'A new approval, review, or submission task is routed to you.'
  },
  approval: {
    title: 'My request was approved',
    description: 'A request you submitted moves forward after approval.'
  },
  rejection: {
    title: 'My request was rejected',
    description: 'A request you submitted is rejected or sent back.'
  },
  escalation: {
    title: 'Task escalated to me',
    description: 'An overdue task is escalated to you as manager/admin.'
  }
}

// A brand-new preference object with every channel on (current behavior).
const defaultPrefs = () => {
  const out = {}
  for (const ev of NOTIFICATION_EVENTS) out[ev] = { inApp: true, email: true }
  return out
}

// Resolve a single event's channels for a (possibly lean / possibly missing)
// user document. Fail-safe: anything not explicitly turned off stays ON, and
// untunable event types (e.g. 'reminder', workflow 'notification' node) always
// deliver so we never silently swallow a message.
const resolvePref = (user, type) => {
  const def = { inApp: true, email: true }
  if (!NOTIFICATION_EVENTS.includes(type)) return def
  const p = user && user.notificationPrefs && user.notificationPrefs[type]
  if (!p) return def
  return {
    inApp: p.inApp !== false,
    email: p.email !== false
  }
}

// Normalize an incoming prefs object from the client into a complete, trusted
// shape (only known events, booleans only). Missing entries default to ON.
const sanitizePrefs = (input) => {
  const src = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const ev of NOTIFICATION_EVENTS) {
    const p = src[ev] && typeof src[ev] === 'object' ? src[ev] : {}
    out[ev] = {
      inApp: p.inApp !== false,
      email: p.email !== false
    }
  }
  return out
}

module.exports = {
  NOTIFICATION_EVENTS,
  EVENT_LABELS,
  defaultPrefs,
  resolvePref,
  sanitizePrefs
}
