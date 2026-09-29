'use strict'

// Explicit opt-in while the organization-schema rollout is in progress. Never
// infer a layout from missing tables or silently fall back to the old database.
function organizationSchemas () {
  const layout = process.env.DATABASE_LAYOUT || 'shared'
  if (!['shared', 'organization-schemas'].includes(layout)) {
    throw Object.assign(new Error('Unsupported DATABASE_LAYOUT'), { code: 'DATABASE_LAYOUT_INVALID' })
  }
  return layout === 'organization-schemas'
}

module.exports = { organizationSchemas }
