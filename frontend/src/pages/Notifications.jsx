// M3 - Phase 2 - Notifications.jsx - Full notifications inbox

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import { ListRowSkeleton } from '../components/Skeleton'
import { AlertBanner } from '../components/Alert'
import { useNotifications, useNotificationsStatus, notificationsStore } from '../lib/notificationsStore'

const FILTERS = [
  { value: 'all',    label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read',   label: 'Read' }
]

const SORTS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc',  label: 'Oldest first' },
  { value: 'name_asc',  label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'unread',    label: 'Unread first' }
]

function Notifications() {
  const navigate = useNavigate()
  const items = useNotifications()
  const { loading, error } = useNotificationsStatus()
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('date_desc')
  const [busy, setBusy] = useState(false)

  // Filter, then sort. Note: n.time is a relative string, so sort on the raw
  // createdAt; sort "name" on the title (falling back to the message).
  const visible = useMemo(() => {
    let list = items
    if (filter === 'unread') list = list.filter((n) => !n.read)
    else if (filter === 'read') list = list.filter((n) => n.read)

    const byDate = (a, b) => new Date(a._raw?.createdAt) - new Date(b._raw?.createdAt)
    const byName = (a, b) => (a.title || a.message || '').localeCompare(b.title || b.message || '')

    list = [...list]
    switch (sort) {
      case 'date_asc':  list.sort(byDate); break
      case 'name_asc':  list.sort(byName); break
      case 'name_desc': list.sort((a, b) => byName(b, a)); break
      case 'unread':    list.sort((a, b) => Number(a.read) - Number(b.read) || byDate(b, a)); break
      default:          list.sort((a, b) => byDate(b, a)) // date_desc — newest first
    }
    return list
  }, [items, filter, sort])

  const unreadCount = items.filter((n) => !n.read).length

  const handleClick = async (n) => {
    if (!n.read) await notificationsStore.markRead(n.id).catch(() => {})
    if (n.taskId) navigate(`/tasks/${n.taskId}`)
  }

  const handleMarkAll = async () => {
    setBusy(true)
    await notificationsStore.markAllRead().catch(() => {})
    setBusy(false)
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    await notificationsStore.remove(id).catch(() => {})
  }

  const subtitle = (
    <span className="flex items-center gap-2">
      <span>{items.length} {items.length === 1 ? 'notification' : 'notifications'}</span>
      {unreadCount > 0 && (
        <span className="text-xs font-medium text-info-fg bg-info-subtle px-2 py-0.5 rounded-md">
          {unreadCount} unread
        </span>
      )}
    </span>
  )

  const actions = (
    <>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="text-sm px-3 py-1.5 rounded-md border border-line bg-surface text-fg hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
      >
        {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        aria-label="Sort notifications"
        className="text-sm px-3 py-1.5 rounded-md border border-line bg-surface text-fg hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
      >
        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <button
        onClick={handleMarkAll}
        disabled={busy || unreadCount === 0}
        className="px-3 py-1.5 text-sm rounded-md border border-line bg-surface hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed text-fg transition"
      >
        {busy ? 'Marking...' : 'Mark all read'}
      </button>
    </>
  )

  return (
    <AppShell title="Notifications" subtitle={subtitle} actions={actions}>
      {error && (
        <AlertBanner className="mb-4" onRetry={() => notificationsStore.refresh().catch(() => {})}>
          {error}
        </AlertBanner>
      )}

      <div className="bg-surface border border-line rounded-lg overflow-hidden">
            {loading && items.length === 0 ? (
              <div className="divide-y divide-line">
                {Array.from({ length: 6 }).map((_, i) => <ListRowSkeleton key={i} />)}
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                title={items.length === 0 ? "You're all caught up" : 'Nothing matches this filter'}
                description={
                  items.length === 0
                    ? 'New notifications will show up here.'
                    : 'Try switching the filter back to All.'
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {visible.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`group px-5 py-4 flex items-start gap-3 cursor-pointer transition ${
                      n.read ? 'bg-surface hover:bg-surface-2' : 'bg-info-subtle/50 hover:bg-info-subtle'
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-full shrink-0 ${n.dotColor}`} />
                    <div className="flex-1 min-w-0">
                      {n.title && (
                        <p className={`text-xs font-semibold uppercase tracking-wide mb-0.5 ${n.read ? 'text-fg-subtle' : 'text-fg-muted'}`}>
                          {n.title}
                        </p>
                      )}
                      <p className={`text-sm ${n.read ? 'text-fg-muted' : 'text-fg font-medium'}`}>
                        {n.message}
                      </p>
                      <p className="text-xs text-fg-subtle mt-1">{n.time}</p>
                    </div>
                    {!n.read && <span className="w-2 h-2 mt-2 rounded-full bg-blue-500 shrink-0" />}
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, n.id)}
                      aria-label="Delete notification"
                      title="Delete"
                      className="shrink-0 -mr-1 p-1 rounded-md text-fg-subtle hover:text-danger-fg hover:bg-danger-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-1 0v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7m3 4v6m4-6v6" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </AppShell>
  )
}

export default Notifications
