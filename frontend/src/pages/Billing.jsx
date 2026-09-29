
import AppShell from '../components/AppShell'
import { AlertBanner } from '../components/Alert'
import { Skeleton } from '../components/Skeleton'
import { StatusBadge } from '../components/NetFlowUI'
import { METER_ORDER, formatDate, licenceChip, meterText, toneFor } from '../lib/licensing'
import { useUsage, usageStore } from '../lib/usageStore'

function UsageMeter({ label, resourceKey, meter }) {
  const tone = toneFor(meter)
  const width = meter?.unlimited ? 100 : Math.min(100, Math.max(0, Number(meter?.percent || 0)))
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <strong className="text-fg">{label}</strong>
        <span className={`truncate tabular-nums ${tone.text}`}>{meterText(resourceKey, meter)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3" aria-label={`${label}: ${meterText(resourceKey, meter)}`}>
        <div className={`h-full rounded-full transition-[width] duration-300 ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

export default function Billing() {
  const { usage, loading, error, canManage } = useUsage()
  const refresh = () => usageStore.refresh({ withUsage: true })

  if (loading && !usage) {
    return (
      <AppShell title="Workspace plan" subtitle="Review the current plan, licence state, reset or renewal date, and every enforced allowance.">
        <div className="space-y-4"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-72 w-full rounded-xl" /></div>
      </AppShell>
    )
  }

  if (!canManage) {
    return (
      <AppShell title="Workspace plan" subtitle="Review the current plan, licence state, reset or renewal date, and every enforced allowance.">
        <AlertBanner tone="error" onRetry={refresh}>You do not have permission to view plan and usage data.</AlertBanner>
      </AppShell>
    )
  }

  if (!usage) {
    return (
      <AppShell title="Workspace plan" subtitle="Review the current plan, licence state, reset or renewal date, and every enforced allowance.">
        <AlertBanner tone="error" onRetry={refresh}>{error || 'Plan and usage data could not be loaded.'}</AlertBanner>
      </AppShell>
    )
  }

  const { licence, period, resources, planLabel } = usage
  const chip = licenceChip(licence)
  const exceeded = METER_ORDER.filter(({ key }) => resources?.[key]?.state === 'exceeded')

  return (
    <AppShell
      title="Workspace plan"
      subtitle="Review the current plan, licence state, reset or renewal date, and every enforced allowance."
    >
      {error && <AlertBanner className="mb-4" onRetry={refresh}>{error}</AlertBanner>}

      <section className="nf-panel p-[18px] md:p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.08em] text-indigo-700">Current plan</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-fg md:text-[28px]">{planLabel || 'Unavailable'}</h2>
            <p className="mt-1 text-sm text-fg-muted">Entitlements are loaded from the current plan service.</p>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:min-w-[620px] xl:grid-cols-4">
            <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Status</dt><dd className="mt-1">{chip ? <StatusBadge tone={chip.tone}>{chip.label}</StatusBadge> : <span className="text-sm font-semibold text-fg">Unavailable</span>}</dd></div>
            <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Licence expires</dt><dd className="mt-1 text-sm font-semibold text-fg">{licence?.expiresAt ? formatDate(licence.expiresAt) : 'No expiry'}</dd></div>
            <div><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Usage resets</dt><dd className="mt-1 text-sm font-semibold text-fg">{formatDate(period?.end)}</dd></div>
            <div className="min-w-0"><dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Billing contact</dt><dd className="mt-1 cursor-pointer truncate text-sm font-semibold text-fg" title={usage.billingEmail || undefined}>{usage.billingEmail || 'Not configured'}</dd></div>
          </dl>
        </div>
      </section>

      <section className="nf-panel mt-4 overflow-hidden">
        <header className="nf-panel-header">
          <div><h2>Usage against plan</h2></div>
          <div className="flex items-center gap-2">
            <span className="nf-status nf-status-neutral">Current cycle</span>
            {/* <button type="button" className="nf-icon-button" onClick={refresh} aria-label="Refresh plan usage" title="Refresh"><RefreshCw className="h-4 w-4" /></button> */}
          </div>
        </header>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-[18px] md:grid-cols-2 md:p-5">
          {METER_ORDER.map(({ key, label }) => resources?.[key] ? <UsageMeter key={key} label={label} resourceKey={key} meter={resources[key]} /> : null)}
        </div>
      </section>

      {exceeded.length > 0 && (
        <AlertBanner tone="warning" className="mt-4">
          {exceeded.length === 1 ? `${exceeded[0].label} is over its plan allowance.` : `${exceeded.length} resources are over their plan allowances.`}
        </AlertBanner>
      )}
    </AppShell>
  )
}
