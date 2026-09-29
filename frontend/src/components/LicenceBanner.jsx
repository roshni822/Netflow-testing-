// Licensing Phase 4 - components/LicenceBanner.jsx
// Two notices, rendered by AppShell above every page.
//
//   1. Read-only. Shown to everyone the moment the workspace stops accepting new
//      work. This is the one banner that must never be dismissible or hidden
//      behind a page: without it, "the save button does nothing" is the only
//      symptom a user sees.
//
//   2. Nearly out of something. Admins only, because they are the only people who
//      can act on it, and dismissible for the day — a 90% warning that cannot be
//      put away becomes wallpaper.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '../utils/auth'
import { isSuperAdmin, canManageUsers } from '../utils/permissions'
import { useLicensing } from '../lib/usageStore'
import { readOnlyCopy, METER_ORDER, formatMb, meterText } from '../lib/licensing'

const DISMISS_KEY = 'fs.usageNoticeDismissed'

// Dismissal lasts for the calendar day: the situation is not resolved by
// clicking "later", so tomorrow it should be said again.
const today = () => new Date().toISOString().slice(0, 10)

const readDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) } catch { return null }
}

// The resources worth interrupting an admin over, worst first.
const pressing = (usage) => {
  if (!usage?.resources) return []
  return METER_ORDER
    .map(({ key, label }) => ({ key, label, meter: usage.resources[key] }))
    .filter(({ meter }) => meter && !meter.unlimited && (meter.state === 'exceeded' || meter.state === 'critical'))
    .sort((a, b) => (b.meter.percent || 0) - (a.meter.percent || 0))
}

export default function LicenceBanner() {
  const user = useUser()
  const { licence, usage } = useLicensing()
  const [dismissedAt, setDismissedAt] = useState(readDismissed)

  const readOnly = useMemo(() => readOnlyCopy(licence), [licence])
  const urgent = useMemo(() => pressing(usage), [usage])

  // Belt and braces: AppShell already keeps this out of the platform shell.
  if (!user || isSuperAdmin(user)) return null

  const dismiss = () => {
    const day = today()
    try { localStorage.setItem(DISMISS_KEY, day) } catch { /* storage unavailable */ }
    setDismissedAt(day)
  }

  const showUsage = canManageUsers(user) && urgent.length > 0 && dismissedAt !== today() && !readOnly

  if (!readOnly && !showUsage) return null

  const top = urgent[0]
  const others = urgent.length - 1

  return (
    <div className="mb-4 space-y-3">
      {readOnly && (
        <div role="alert" className="rounded-lg border border-danger-line bg-danger-subtle text-danger-fg p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{readOnly.title}</p>
              <p className="text-xs mt-0.5 leading-relaxed">{readOnly.body}</p>
            </div>
          </div>
        </div>
      )}

      {showUsage && (
        <div role="status" className="rounded-lg border border-warning-line bg-warning-subtle text-warning-fg p-3">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {top.meter.state === 'exceeded'
                  ? `${top.label} limit reached`
                  : `${top.label} is ${top.meter.percent}% used`}
              </p>
              <p className="text-xs mt-0.5">
                {top.key === 'storage'
                  ? `${formatMb(top.meter.used)} of ${formatMb(top.meter.limit)} used on your ${usage.planLabel} plan.`
                  : `${meterText(top.key, top.meter)} used on your ${usage.planLabel} plan.`}
                {others > 0 && ` ${others} other limit${others > 1 ? 's are' : ' is'} also running out.`}
                {' '}
                <Link to="/admin" className="underline font-medium">Review usage</Link>
              </p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss until tomorrow"
              className="shrink-0 px-2 py-0.5 rounded border border-current/30 text-[11px] font-semibold hover:bg-current/10 transition"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
