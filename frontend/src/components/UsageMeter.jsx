// Licensing Phase 4 - components/UsageMeter.jsx
// One resource, one bar. Used by the Org Admin's usage card and the Super
// Admin's org list, so both read the same way.
//
// The bar's colour comes from the server's `state` field rather than being
// recomputed here — the thing on screen and the thing that sends the warning
// email are then guaranteed to agree.

import { meterText, toneFor } from '../lib/licensing'

// `brand` keeps the ok state on the indigo accent (platform org cards); the
// default stays green so Org Admin usage cards still read as "healthy".
const BRAND_OK = { bar: 'bg-indigo-500', text: 'text-fg-muted' }

export default function UsageMeter({ resource, label, meter, compact = false, variant = 'default' }) {
  if (!meter) return null
  const tone = variant === 'brand' && (!meter.state || meter.state === 'ok')
    ? BRAND_OK
    : toneFor(meter)
  // An unlimited resource has no bar to fill; showing an empty track next to
  // "Unlimited" reads as "0% used", which is not the same thing.
  const width = meter.unlimited ? 0 : Math.min(100, Math.max(meter.percent || 0, meter.used > 0 ? 2 : 0))

  return (
    <div className={compact ? '' : 'space-y-1'}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${compact ? 'text-[11px]' : 'text-xs'} font-medium text-fg-muted`}>{label}</span>
        <span className={`${compact ? 'text-[11px]' : 'text-xs'} tabular-nums ${tone.text}`}>
          {meter.unlimited ? `${meterText(resource, meter)} · unlimited` : meterText(resource, meter)}
        </span>
      </div>
      <div
        className={`${compact ? 'h-1' : 'h-1.5'} mt-1 w-full rounded-full bg-surface-3 overflow-hidden`}
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuenow={meter.unlimited ? 0 : meter.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${tone.bar} transition-[width] duration-300`} style={{ width: `${width}%` }} />
      </div>
      {!compact && !meter.unlimited && meter.state !== 'ok' && (
        <p className={`text-[11px] ${tone.text}`}>
          {meter.state === 'exceeded'
            ? 'Full — new items are blocked.'
            : `${meter.percent}% used${meter.remaining !== null ? ` · ${meter.remaining} left` : ''}.`}
        </p>
      )}
    </div>
  )
}
