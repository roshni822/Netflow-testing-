// Licensing Phase 4 - components/UsageCard.jsx
// What an Org Admin is entitled to and how much of it is gone. Rendered on the
// Admin panel, because that is where they already go to add the user who no
// longer fits.
//
// Deliberately shows every metered resource, including the ones with room left:
// a card that only appears when something is wrong cannot answer "how close are
// we?", which is the question that avoids the emergency in the first place.

import { useUsage, usageStore } from '../lib/usageStore'
import UsageMeter from './UsageMeter'
import {
  METER_ORDER, PLAN_LABELS, CHIP_CLASS, licenceChip, formatDate
} from '../lib/licensing'
import { Skeleton } from './Skeleton'

function MeterIcon({ resource }) {
  const cls = 'w-4 h-4'
  switch (resource) {
    case 'users':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
        </svg>
      )
    case 'builders':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
      )
    case 'forms':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V5a2 2 0 012-2h7l4 4v11a2 2 0 01-2 2z" />
        </svg>
      )
    case 'workflows':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    case 'storage':
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
        </svg>
      )
    default:
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      )
  }
}

export default function UsageCard({ className = '' }) {
  const { usage, loading, error, canManage } = useUsage()

  if (loading && !usage) {
    return (
      <div className={`rounded-xl border border-line bg-surface shadow-sm overflow-hidden ${className}`}>
        <div className="px-5 py-3.5 border-b border-line flex items-center gap-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-16 rounded-full ml-auto" />
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-line p-3 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!usage || !canManage) return null

  const chip = licenceChip(usage.licence)
  const exceeded = METER_ORDER.filter(({ key }) => {
    const m = usage.resources?.[key]
    return m && !m.unlimited && m.state === 'exceeded'
  })

  return (
    <div className={`rounded-xl border border-line bg-surface shadow-sm overflow-hidden ${className}`}>
      <div className="px-5 py-3.5 border-b border-line bg-surface-2/40 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Plan &amp; usage</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            {PLAN_LABELS[usage.plan] || usage.planLabel} plan
            {usage.licence?.expiresAt
              ? ` · ${usage.licence.readOnly ? 'ended' : 'renews'} ${formatDate(usage.licence.expiresAt)}`
              : ' · perpetual licence'}
            {usage.period?.end && ` · allowance resets ${formatDate(usage.period.end)}`}
          </p>
        </div>
        {chip && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CHIP_CLASS[chip.tone]}`}>
            {chip.label}
          </span>
        )}
        <button
          type="button"
          onClick={() => usageStore.refresh({ withUsage: true })}
          className="ml-auto text-xs px-2.5 py-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition"
        >
          Refresh
        </button>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
        {METER_ORDER.map(({ key, label }) => {
          const meter = usage.resources?.[key]
          if (!meter) return null
          const warn = meter.state === 'warning' || meter.state === 'exceeded'
          return (
            <div
              key={key}
              className={`rounded-xl border p-3 ${
                warn ? 'border-warning-line bg-warning-subtle/40' : 'border-line bg-surface'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ring-1 ${
                  warn
                    ? 'bg-warning-subtle text-warning-fg ring-warning-line'
                    : 'bg-surface-2 text-fg-muted ring-line'
                }`}>
                  <MeterIcon resource={key} />
                </div>
                <div className="min-w-0 flex-1">
                  <UsageMeter resource={key} label={label} meter={meter} compact />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {(exceeded.length > 0 || error) && (
        <div className="px-5 py-3 border-t border-line bg-surface-2/60 text-xs text-fg-muted">
          {exceeded.length > 0 && (
            <p>
              <span className="font-medium text-danger-fg">
                {exceeded.map((e) => e.label).join(', ')} {exceeded.length > 1 ? 'are' : 'is'} at the limit.
              </span>{' '}
              Free something up, or ask your platform administrator to raise the plan.
            </p>
          )}
          {error && <p className="mt-1">{error}</p>}
        </div>
      )}
    </div>
  )
}
