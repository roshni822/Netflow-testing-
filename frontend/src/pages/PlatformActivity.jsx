// SuperAdmin platform organization-lifecycle activity.

import { useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { api, buildQuery } from '../utils/api'
import { formatDateTime, isoAttr, relativeTime } from '../utils/datetime'
import { useDebouncedValue } from '../utils/useDebouncedValue'
import EmptyState from '../components/EmptyState'
import { AlertBanner } from '../components/Alert'

const PAGE_SIZE = 25

const ACTION_FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'org_created', label: 'Created' },
  { value: 'org_updated', label: 'Updated' },
  { value: 'org_suspended', label: 'Suspended' },
  { value: 'org_activated', label: 'Activated' },
  { value: 'org_deleted', label: 'Deleted' },
  { value: 'org_admin_password_reset', label: 'Password reset' },
  { value: 'org_storage_extended', label: 'Storage granted' },
  { value: 'org_storage_extension_revoked', label: 'Storage revoked' }
]

const ACTION_META = {
  org_created: {
    label: 'Organization created',
    status: 'Created',
    tone: 'success',
    Icon: IconOrganization
  },
  org_updated: {
    label: 'Organization updated',
    status: 'Updated',
    tone: 'info',
    Icon: IconPencil
  },
  org_suspended: {
    label: 'Organization suspended',
    status: 'Suspended',
    tone: 'danger',
    Icon: IconLock
  },
  org_activated: {
    label: 'Organization reactivated',
    status: 'Reactivated',
    tone: 'success',
    Icon: IconCheck
  },
  org_deleted: {
    label: 'Organization deleted',
    status: 'Deleted',
    tone: 'danger',
    Icon: IconTrash
  },
  org_admin_password_reset: {
    label: 'Admin password reset',
    status: 'Password reset',
    tone: 'warning',
    Icon: IconKey
  },
  org_storage_extended: {
    label: 'Storage extension granted',
    status: 'Storage granted',
    tone: 'info',
    Icon: IconDisk
  },
  org_storage_extension_revoked: {
    label: 'Storage extension revoked',
    status: 'Storage revoked',
    tone: 'warning',
    Icon: IconDisk
  }
}

const fallbackMeta = {
  label: 'Platform event',
  status: 'Event',
  tone: 'neutral',
  Icon: IconActivity
}

function eventMeta(log) {
  if (
    log.action === 'org_updated' &&
    (log.metadata?.planFrom || log.metadata?.planTo)
  ) {
    return {
      label: 'Plan assigned',
      status: 'Plan assigned',
      tone: 'warning',
      Icon: IconPlan
    }
  }

  return ACTION_META[log.action] || fallbackMeta
}

function ActivityTableSkeletonRow() {
  return (
    <tr className="nf-activity-skeleton" aria-hidden="true">
      <td><span className="nf-activity-skeleton-line w-24" /></td>
      <td><span className="nf-activity-skeleton-line w-32" /></td>
      <td>
        <span className="nf-activity-event">
          <span className="nf-activity-skeleton-icon" />
          <span className="nf-activity-skeleton-line w-32" />
        </span>
      </td>
      <td><span className="nf-activity-skeleton-line w-40" /></td>
      <td><span className="nf-activity-skeleton-pill" /></td>
    </tr>
  )
}

export default function PlatformActivity() {
  const [logs, setLogs] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const search = useDebouncedValue(searchInput.trim())

  useEffect(() => {
    const timer = window.setTimeout(() => setPage(1), 0)
    return () => window.clearTimeout(timer)
  }, [search, actionFilter])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      const qs = buildQuery({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        action: actionFilter || undefined
      })

      api.get('/api/platform/activity' + qs)
        .then((data) => {
          if (cancelled) return
          setLogs(data.logs || [])
          setTotal(data.total ?? 0)
        })
        .catch((e) => {
          if (!cancelled) setError(e.message || 'Could not load activity')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [page, search, actionFilter, reloadKey])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const hasFilters = Boolean(search || actionFilter)
  const rangeStart = total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0
  const rangeEnd = Math.min(page * PAGE_SIZE, total)
  const clearFilters = () => {
    setSearchInput('')
    setActionFilter('')
    setPage(1)
  }

  return (
    <AppShell
      title="Activity"
      subtitle="Follow organization lifecycle changes in a readable, chronological record."
    >
      {error && (
        <AlertBanner className="mb-4" onRetry={() => setReloadKey((key) => key + 1)}>
          {error}
        </AlertBanner>
      )}

      <div className="nf-activity-filters">
        <div className="nf-activity-search">
          <svg
            aria-hidden="true"
            className="nf-activity-search-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
          </svg>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search organizations or actors"
            aria-label="Search platform activity"
            className="nf-activity-search-input"
          />
        </div>

        <select
          value={actionFilter}
          onChange={(event) => {
            setActionFilter(event.target.value)
            setPage(1)
          }}
          aria-label="Filter by action"
          className="nf-activity-select"
        >
          {ACTION_FILTERS.map((filter) => (
            <option key={filter.value || 'all'} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button type="button" onClick={clearFilters} className="nf-activity-clear">
            Clear filters
          </button>
        )}
      </div>

      <section className="nf-activity-table-card" aria-label="Platform activity results">
        {loading || logs.length > 0 ? (
          <div
            className="nf-activity-table-scroll"
            role="region"
            aria-label="Platform activity table"
            tabIndex="0"
          >
            <table className="nf-activity-table">
              <caption className="sr-only">
                Platform organization lifecycle events, newest first
              </caption>
              <colgroup>
                <col className="nf-activity-col-time" />
                <col className="nf-activity-col-actor" />
                <col className="nf-activity-col-event" />
                <col className="nf-activity-col-organization" />
                <col className="nf-activity-col-status" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Event</th>
                  <th scope="col">Organization</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, index) => (
                    <ActivityTableSkeletonRow key={index} />
                  ))
                ) : (
                  logs.map((log) => {
                    const meta = eventMeta(log)
                    const Icon = meta.Icon
                    return (
                      <tr key={log._id}>
                        <td>
                          <time
                            className="nf-activity-time"
                            dateTime={isoAttr(log.createdAt)}
                            title={isoAttr(log.createdAt)}
                          >
                            {formatDateTime(log.createdAt)}
                          </time>
                          <span className="nf-activity-secondary">
                            {relativeTime(log.createdAt)}
                          </span>
                        </td>
                        <td>
                          <strong className="nf-activity-primary">
                            {log.performedBy?.name || 'System'}
                          </strong>
                          {log.performedBy?.email && (
                            <span className="nf-activity-secondary nf-activity-truncate">
                              {log.performedBy.email}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="nf-activity-event">
                            <span className={'nf-activity-event-icon nf-activity-tone-' + meta.tone}>
                              <Icon />
                            </span>
                            <span className={'nf-activity-event-label nf-activity-text-' + meta.tone}>
                              {meta.label}
                            </span>
                          </span>
                        </td>
                        <td>
                          <strong className="nf-activity-primary nf-activity-truncate">
                            {log.targetEntity || '\u2014'}
                          </strong>
                          {log.metadata?.subdomain && (
                            <span className="nf-activity-secondary nf-activity-domain">
                              {log.metadata.subdomain}.netflow.app
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={'nf-activity-status nf-activity-tone-' + meta.tone}>
                            {meta.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={hasFilters ? 'No events match these filters' : 'No platform events yet'}
            description={hasFilters
              ? 'Try a different action or search term.'
              : 'Create, suspend, or update an organization to see activity here.'}
            action={hasFilters ? (
              <button type="button" onClick={clearFilters} className="nf-button">
                Clear filters
              </button>
            ) : null}
          />
        )}

        {!loading && logs.length > 0 && (
          <footer className="nf-activity-pagination">
            <p>
              {rangeStart}{'\u2013'}{rangeEnd} of {total.toLocaleString()}
              <span>{' \u00b7 '}page {page} of {totalPages}</span>
            </p>
            {totalPages > 1 && (
              <div className="nf-activity-pagination-actions">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="nf-activity-page-button"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
                  className="nf-activity-page-button"
                >
                  Next
                </button>
              </div>
            )}
          </footer>
        )}
      </section>
    </AppShell>
  )
}

function ActivitySvg({ children }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

function IconOrganization() {
  return (
    <ActivitySvg>
      <rect x="3" y="3" width="8" height="18" rx="1" />
      <rect x="13" y="8" width="8" height="13" rx="1" />
      <path d="M7 7h1M7 11h1M7 15h1M17 12h1M17 16h1M2 21h20" />
    </ActivitySvg>
  )
}

function IconPencil() {
  return (
    <ActivitySvg>
      <path d="m15.2 5.2 3.6 3.6M4 20h4.6a1 1 0 0 0 .7-.3l9.4-9.4a2 2 0 0 0 0-2.8l-2.2-2.2a2 2 0 0 0-2.8 0l-9.4 9.4a1 1 0 0 0-.3.7V20Z" />
    </ActivitySvg>
  )
}

function IconLock() {
  return (
    <ActivitySvg>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </ActivitySvg>
  )
}

function IconCheck() {
  return (
    <ActivitySvg>
      <path d="m5 12 4 4L19 6" />
    </ActivitySvg>
  )
}

function IconPlan() {
  return (
    <ActivitySvg>
      <path d="m12 3 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7Z" />
    </ActivitySvg>
  )
}

function IconTrash() {
  return (
    <ActivitySvg>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
    </ActivitySvg>
  )
}

function IconKey() {
  return (
    <ActivitySvg>
      <circle cx="15" cy="9" r="4" />
      <path d="m12.2 11.8-8.2 8.2M4 20v-3h3v-3h3" />
    </ActivitySvg>
  )
}

function IconDisk() {
  return (
    <ActivitySvg>
      <path d="M4 7a2 2 0 0 1 2-2h10l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
      <path d="M14 5v4h4M8 17h8" />
    </ActivitySvg>
  )
}

function IconActivity() {
  return (
    <ActivitySvg>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </ActivitySvg>
  )
}
