// Shared - badges.js
// One home for the status / category chip classes, which used to be copy-pasted
// (and slightly different) in Workflows, Forms, NewFormModal, Dashboard,
// TaskInbox and TaskDetail.
//
// Status chips use the semantic tokens from index.css, so they re-resolve in
// dark mode automatically. The decorative category accents have no token, so
// each one carries an explicit `dark:` pair — a bare `bg-pink-50 text-pink-700`
// chip is unreadable on a dark card.

export const CATEGORY_BADGE = {
  'Company-wide': 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  HR:            'bg-pink-50 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  Finance:       'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  Procurement:   'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  IT:            'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  Operations:    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  Marketing:     'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  Sales:         'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  Legal:         'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
}

export const categoryBadge = (category) =>
  CATEGORY_BADGE[category] || 'bg-surface-3 text-fg-muted'

// `badge` is the chip (fill + text + border), `dot` the small leading circle.
export const STATUS_BADGE = {
  Approved:  { badge: 'bg-success-subtle text-success-fg border-success-line', dot: 'bg-success-solid' },
  Completed: { badge: 'bg-success-subtle text-success-fg border-success-line', dot: 'bg-success-solid' },
  Rejected:  { badge: 'bg-danger-subtle text-danger-fg border-danger-line',   dot: 'bg-danger-solid' },
  Pending:   { badge: 'bg-warning-subtle text-warning-fg border-warning-line', dot: 'bg-warning-solid' },
  Escalated: {
    badge: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
    dot: 'bg-orange-500',
  },
  default:   { badge: 'bg-info-subtle text-info-fg border-info-line', dot: 'bg-info-solid' },
}

export const statusBadge = (status) => STATUS_BADGE[status] || STATUS_BADGE.default
