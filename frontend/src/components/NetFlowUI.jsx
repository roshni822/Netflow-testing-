import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  Grid2X2,
  List,
} from 'lucide-react'
import { toast } from '../lib/toastStore'

export function Button({ variant = 'secondary', className = '', children, ...props }) {
  const variantClass = variant === 'primary'
    ? 'nf-button-primary'
    : variant === 'danger'
      ? 'nf-button-danger'
      : ''
  return (
    <button className={`nf-button ${variantClass} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function IconButton({ label, className = '', children, ...props }) {
  return (
    <button className={`nf-icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function ComingSoonButton({ feature, children, className = '', icon, variant = 'secondary' }) {
  const message = `${feature || 'This action'} is coming soon.`
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={() => toast.info(message)}
      aria-label={`${feature || 'Action'} — coming soon`}
    >
      {icon}
      {children || 'Coming soon'}
    </Button>
  )
}

export function Panel({ as: Component = 'section', className = '', children, ...props }) {
  return <Component className={`nf-panel ${className}`} {...props}>{children}</Component>
}

export function PanelHeader({ title, description, actions, className = '' }) {
  return (
    <div className={`nf-panel-header ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[18px] font-bold tracking-[-0.02em] text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

const STATUS_TONE = {
  active: 'success',
  approved: 'success',
  completed: 'success',
  published: 'success',
  available: 'success',
  draft: 'warning',
  pending: 'warning',
  trial: 'warning',
  waiting: 'warning',
  paused: 'warning',
  rejected: 'danger',
  failed: 'danger',
  suspended: 'danger',
  overdue: 'danger',
  archived: 'neutral',
  inactive: 'neutral',
}

export function StatusBadge({ children, status, tone, className = '' }) {
  const label = children ?? status ?? 'Unknown'
  const resolved = tone || STATUS_TONE[String(label).toLowerCase()] || 'info'
  return <span className={`nf-status nf-status-${resolved} ${className}`}>{label}</span>
}

export function ViewToggle({ value, onChange, label = 'Layout' }) {
  return (
    <div className="inline-flex items-center rounded-[10px] border border-line bg-surface p-1" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`w-8 h-8 rounded-md inline-flex items-center justify-center transition ${value === 'list' ? 'bg-indigo-50 text-indigo-700' : 'text-fg-muted hover:bg-surface-3'}`}
        aria-label="List view"
        aria-pressed={value === 'list'}
        title="List view"
      >
        <List className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={`w-8 h-8 rounded-md inline-flex items-center justify-center transition ${value === 'grid' ? 'bg-indigo-50 text-indigo-700' : 'text-fg-muted hover:bg-surface-3'}`}
        aria-label="Grid view"
        aria-pressed={value === 'grid'}
        title="Grid view"
      >
        <Grid2X2 className="w-4 h-4" />
      </button>
    </div>
  )
}

export function Pagination({ page, pageSize = 10, total, onPageChange, noun = 'items' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : ((safePage - 1) * pageSize) + 1
  const to = Math.min(safePage * pageSize, total)
  return (
    <div className="min-h-[58px] px-4 py-3 flex items-center justify-between gap-3 border-t border-line bg-surface">
      <span className="text-xs text-fg-muted">Showing {from}–{to} of {total} {noun}</span>
      <div className="flex items-center gap-2">
        <Button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="min-h-9 px-3 disabled:opacity-40 disabled:cursor-not-allowed">
          Previous
        </Button>
        <span className="min-w-9 h-9 px-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 inline-flex items-center justify-center text-sm font-semibold tabular-nums">
          {safePage}
        </span>
        <Button type="button" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)} className="min-h-9 px-3 disabled:opacity-40 disabled:cursor-not-allowed">
          Next
        </Button>
      </div>
    </div>
  )
}

const formatRange = (range) => {
  if (!range?.from || !range?.to) return 'Set dashboard date range'
  const fmt = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  })
  return `${fmt(range.from)} – ${fmt(range.to)}`
}

const localIsoDate = (date) => {
  const shifted = new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
  return shifted.toISOString().slice(0, 10)
}

const recentRange = (days) => {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - days + 1)
  return { from: localIsoDate(from), to: localIsoDate(to) }
}

const inclusiveRangeDays = (range) => {
  if (!range?.from || !range?.to) return 0
  return Math.floor((new Date(`${range.to}T00:00:00Z`) - new Date(`${range.from}T00:00:00Z`)) / 86400000) + 1
}

const RANGE_PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

const rangeButtonLabel = (range) => {
  const matched = RANGE_PRESETS.find(({ days }) => {
    const preset = recentRange(days)
    return preset.from === range?.from && preset.to === range?.to
  })
  return matched?.label || formatRange(range)
}

export function DateRangeControl({ value, onApply, label = 'Dashboard date range', maxDays = 90 }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => value || { from: '', to: '' })
  const [error, setError] = useState('')
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const buttonLabel = rangeButtonLabel(value)
  const exactRangeLabel = useMemo(() => formatRange(value), [value])
  const today = localIsoDate(new Date())

  useEffect(() => {
    if (!open) return undefined
    dialogRef.current?.querySelector('button')?.focus()
    const close = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    const key = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const leave = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', leave)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', leave)
    }
  }, [open])

  const applyRange = (nextRange) => {
    if (!nextRange?.from || !nextRange?.to) {
      setError('Choose both From and Till dates.')
      return false
    }
    if (nextRange.from > nextRange.to) {
      setError('From date must be before the Till date.')
      return false
    }
    if (nextRange.to > today) {
      setError('The dashboard range cannot end in the future.')
      return false
    }
    if (inclusiveRangeDays(nextRange) > maxDays) {
      setError(`Choose a range of ${maxDays} days or fewer.`)
      return false
    }
    setError('')
    onApply?.(nextRange)
    setOpen(false)
    triggerRef.current?.focus()
    return true
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${exactRangeLabel}`}
        title={exactRangeLabel}
        onClick={() => {
          if (!open) {
            setDraft(value || { from: '', to: '' })
            setError('')
          }
          setOpen((current) => !current)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`nf-button whitespace-nowrap ${value?.from && value?.to ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : ''}`}
      >
        <CalendarDays aria-hidden="true" className="w-4 h-4" />
        <span className="hidden sm:inline opacity-80">Date range:</span>
        <span>{buttonLabel}</span>
      </button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-label={label} className="absolute left-0 top-full mt-2 z-30 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-4 shadow-[0_20px_48px_rgb(36_39_44/0.18)]">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-bold text-fg">Dashboard date range</h2>
              <p className="text-xs text-fg-muted mt-0.5">Applies to every activity panel. Dates use UTC.</p>
            </div>
            <CalendarDays aria-hidden="true" className="w-5 h-5 text-fg-muted" />
          </div>
          <fieldset>
            <legend className="text-xs font-semibold text-fg-muted">Quick ranges</legend>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {RANGE_PRESETS.map((preset) => {
                const presetRange = recentRange(preset.days)
                const selected = value?.from === presetRange.from && value?.to === presetRange.to
                return (
                  <button
                    key={preset.days}
                    type="button"
                    className={`min-h-9 rounded-lg border px-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${selected ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-line bg-surface text-fg hover:bg-surface-3'}`}
                    aria-pressed={selected}
                    onClick={() => applyRange(presetRange)}
                  >
                    {preset.days} days
                  </button>
                )
              })}
            </div>
          </fieldset>
          <div className="my-4 border-t border-line" />
          <p className="mb-1.5 text-xs font-semibold text-fg-muted">Custom range</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-fg-muted">
              From
              <input type="date" value={draft.from || ''} max={draft.to || today} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} className="nf-field mt-1.5" />
            </label>
            <label className="text-xs font-semibold text-fg-muted">
              Till
              <input type="date" value={draft.to || ''} min={draft.from || undefined} max={today} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} className="nf-field mt-1.5" />
            </label>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-danger-fg">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus() }}>Cancel</Button>
            <Button type="button" variant="primary" onClick={() => applyRange(draft)}>Apply range</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function UnsupportedRangeState({ title = 'Custom-range data is unavailable' }) {
  return (
    <div className="min-h-[220px] flex flex-col items-center justify-center p-6 text-center">
      <span className="w-11 h-11 rounded-full bg-warning-subtle text-warning-fg inline-flex items-center justify-center mb-3">
        <CalendarDays className="w-5 h-5" />
      </span>
      <h3 className="text-sm font-bold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-fg-muted">This panel does not yet have an exact date-range API. No approximate or invented values are shown.</p>
    </div>
  )
}
