// Shared - Toaster.jsx
// Fixed, stacked toast container. Mount once near the app root (App.jsx).
// Reads from toastStore; renders nothing when there are no toasts.

import { useToasts, toast } from '../lib/toastStore'

const STYLES = {
  success: { bar: 'bg-success-solid', iconWrap: 'bg-success-subtle text-success-fg', icon: '\u2713' },
  error:   { bar: 'bg-danger-solid',  iconWrap: 'bg-danger-subtle text-danger-fg',   icon: '!' },
  info:    { bar: 'bg-info-solid',    iconWrap: 'bg-info-subtle text-info-fg',       icon: 'i' },
}

export default function Toaster() {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => {
        const s = STYLES[t.type] || STYLES.info
        return (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className="flex items-stretch gap-3 bg-surface border border-line rounded-xl shadow-lg overflow-hidden"
          >
            <span className={`w-1 shrink-0 ${s.bar}`} />
            <span className={`mt-2.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${s.iconWrap}`}>
              {s.icon}
            </span>
            <p className="flex-1 py-2.5 text-sm text-fg">{t.message}</p>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="px-2 text-fg-subtle hover:text-fg-muted text-lg shrink-0"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        )
      })}
    </div>
  )
}
