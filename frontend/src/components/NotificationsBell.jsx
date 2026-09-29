// Bell dropdown — SaaS-style notification panel (no page navigation).
// New arrivals also surface as top-right info toasts via notificationsStore.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { notificationsStore, useNotifications, useUnreadCount } from '../lib/notificationsStore'
import { useOutsideDismiss } from '../utils/a11y'

export default function NotificationsBell() {
  const navigate = useNavigate()
  const items = useNotifications()
  const unreadCount = useUnreadCount()
  const [open, setOpen] = useState(false)
  const [marking, setMarking] = useState(false)
  const wrapRef = useRef(null)

  useOutsideDismiss(open, wrapRef, () => setOpen(false))

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Newest first in the panel.
  const sorted = useMemo(() => {
    return [...items].sort(
      (a, b) => new Date(b._raw?.createdAt || 0) - new Date(a._raw?.createdAt || 0)
    )
  }, [items])

  const onToggle = () => {
    setOpen((v) => {
      const next = !v
      if (next) notificationsStore.refresh().catch(() => {})
      return next
    })
  }

  const onNotificationClick = async (n) => {
    if (!n.read) {
      try { await notificationsStore.markRead(n.id) } catch { /* ignore */ }
    }
    if (n.taskId) {
      setOpen(false)
      navigate(`/tasks/${n.taskId}`)
    }
  }

  const onMarkAll = async () => {
    setMarking(true)
    try { await notificationsStore.markAllRead() } catch { /* ignore */ }
    setMarking(false)
  }

  return (
    <div ref={wrapRef} data-tour="notifications" className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        title="Notifications"
        className={`relative w-10 h-10 rounded-[10px] border border-line bg-surface flex items-center justify-center text-fg-muted transition ${
          open ? 'bg-surface-3 text-fg' : 'hover:bg-surface-2 hover:text-fg'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.17V11a6 6 0 10-12 0v3.17a2 2 0 01-.6 1.43L4 17h5m6 0a3 3 0 11-6 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-danger-solid text-white text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 mt-2 w-[22rem] sm:w-[26rem] max-w-[calc(100vw-1.5rem)] bg-surface border border-line rounded-xl shadow-xl z-30 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">Notifications</h3>
              <p className="text-[11px] text-fg-subtle mt-0.5">
                {unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up'}
              </p>
            </div>
            <button
              type="button"
              onClick={onMarkAll}
              disabled={unreadCount === 0 || marking}
              className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-fg-subtle disabled:cursor-not-allowed transition"
            >
              {marking ? 'Marking…' : 'Mark all read'}
            </button>
          </div>

          <ul className="max-h-[min(24rem,60vh)] overflow-y-auto">
            {sorted.length === 0 ? (
              <li className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-fg">No notifications yet</p>
                <p className="text-xs text-fg-subtle mt-1">Approvals and updates will show up here.</p>
              </li>
            ) : (
              sorted.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onNotificationClick(n)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-line last:border-b-0 transition ${
                      n.read ? 'bg-surface hover:bg-surface-2' : 'bg-info-subtle/50 hover:bg-info-subtle'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ${n.read ? 'bg-line' : 'bg-indigo-500'}`} />
                    <div className="flex-1 min-w-0">
                      {n.title && (
                        <p className={`text-[11px] font-semibold uppercase tracking-wide truncate ${n.read ? 'text-fg-subtle' : 'text-fg-muted'}`}>
                          {n.title}
                        </p>
                      )}
                      <p className={`text-sm leading-snug line-clamp-2 ${n.read ? 'text-fg-muted' : 'text-fg font-medium'}`}>
                        {n.message}
                      </p>
                      <p className="text-[11px] text-fg-subtle mt-1">{n.time}</p>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
