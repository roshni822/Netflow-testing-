import { useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, Plus, Trash2
} from 'lucide-react'
import { FieldConfidenceDetails } from './DocumentConfidence'

const FIELD_TYPES = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['dropdown', 'Dropdown'],
  ['radio', 'Radio'],
  ['checkbox', 'Checkbox'],
  ['file', 'File'],
  ['signature', 'Signature'],
  ['grid', 'Table'],
  ['heading', 'Heading']
]

function ConfidenceBadge({ candidate }) {
  const notValidated = candidate.criticStatus === 'unavailable' && candidate.validationReason !== 'unresolved'
  const tier = candidate.scoreVersion === 2 && candidate.criticStatus === 'validated'
    ? candidate.confidenceTier : 'low'
  const label = notValidated ? 'Not validated' : tier === 'high' ? 'High confidence' : tier === 'medium' ? 'Review suggested' : 'Needs review'
  const classes = tier === 'high'
    ? 'border-success-line bg-success-subtle text-success-fg'
    : tier === 'medium'
      ? 'border-warning-line bg-warning-subtle text-warning-fg'
      : 'border-warning-line bg-warning-subtle text-warning-fg'
  return (
    <span className={'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + classes}>
      {label}
    </span>
  )
}


function NecessityBadge({ necessity }) {
  const value = ['core', 'optional', 'conditional'].includes(necessity) ? necessity : 'optional'
  const classes = value === 'core'
    ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200'
    : value === 'conditional' ? 'border-warning-line bg-warning-subtle text-warning-fg' : 'border-line bg-surface-2 text-fg-muted'
  return <span className={'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ' + classes}>{value}</span>
}

function CandidateCard({
  candidate,
  active,
  index,
  count,
  onSelect,
  onChange,
  onMove,
  onToggle
}) {
  const field = candidate.field || {}
  const choiceField = ['dropdown', 'radio', 'checkbox'].includes(field.type)
  const updateField = (changes) => onChange(candidate.candidateId, {
    field: { ...field, ...changes }
  })

  return (
    <article
      role="group"
      tabIndex={0}
      aria-label={(candidate.included ? 'Included field: ' : 'Suggestion: ') + (field.label || 'Untitled field')}
      aria-current={active ? 'true' : undefined}
      className={
        'rounded-xl border p-3 transition ' +
        (active ? 'border-indigo-400 bg-indigo-50/60 shadow-sm dark:bg-indigo-500/10' : 'border-line bg-surface')
      }
      onPointerDownCapture={() => onSelect(candidate)}
      onClick={() => onSelect(candidate)}
      onFocus={() => onSelect(candidate)}
      onKeyDown={(event) => {
        if (!['Enter', ' '].includes(event.key) || event.target !== event.currentTarget) return
        event.preventDefault()
        onSelect(candidate)
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
            {candidate.included ? 'Included field' : 'Suggestion'}
          </p>
          <p className="text-[11px] text-fg-muted">
            {candidate.sourceRegions?.length
              ? 'Source page ' + candidate.sourceRegions[0].page
              : 'No source highlight available'}
          </p>
          {candidate.context && <p className="text-[11px] text-fg-muted">{candidate.context}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <NecessityBadge necessity={candidate.necessity} />
          <ConfidenceBadge candidate={candidate} />
        </div>
      </div>


      {(candidate.sourceLabel || candidate.decisionReason) && (
        <div className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          {candidate.sourceLabel && <p><span className="font-semibold text-fg">Source label:</span> {candidate.sourceLabel}</p>}
          {candidate.decisionReason && <p className={candidate.sourceLabel ? 'mt-1' : ''}><span className="font-semibold text-fg">LLM decision:</span> {candidate.decisionReason}</p>}
        </div>
      )}
      <FieldConfidenceDetails candidate={candidate} />

      {field.type === 'text' && (
        <label className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-fg">
          <input
            type="checkbox"
            checked={field.multiline === true}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField({ multiline: event.target.checked })}
            className="h-4 w-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
          />
          Long answer (multiline)
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <label className="block text-xs font-medium text-fg-muted">
          Field label
          <input
            type="text"
            value={field.label || ''}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField({ label: event.target.value })}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>
        <label className="block text-xs font-medium text-fg-muted">
          Input type
          <select
            value={field.type || 'text'}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField({ type: event.target.value })}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {choiceField && (
        <label className="mt-3 block text-xs font-medium text-fg-muted">
          Options, separated by commas
          <input
            type="text"
            value={(field.options || []).join(', ')}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateField({
              options: event.target.value.split(',').map((value) => value.trim()).filter(Boolean)
            })}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>
      )}

      {field.type === 'grid' && (
        <label className="mt-3 block text-xs font-medium text-fg-muted">
          Table columns, separated by commas
          <input
            type="text"
            value={(field.columns || []).map((column) => column?.label || '').filter(Boolean).join(', ')}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const labels = event.target.value.split(',').map((value) => value.trim()).filter(Boolean)
              updateField({
                columns: labels.map((label, index) => ({
                  ...(field.columns?.[index] || {}),
                  id: field.columns?.[index]?.id || 'c' + (index + 1),
                  label,
                  type: field.columns?.[index]?.type || 'text'
                }))
              })
            }}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>
      )}

      {field.type !== 'heading' && (
        <div className="mt-3">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-fg">
            <input
              type="checkbox"
              checked={field.required === true}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateField({ required: event.target.checked })}
              className="h-4 w-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
            />
            Required field
          </label>
          {field.required === true && candidate.requiredReason && <p className="mt-1 text-xs text-fg-muted">{candidate.requiredReason}</p>}
        </div>
      )}


      {candidate.reviewWarnings?.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning-line bg-warning-subtle px-3 py-2 text-xs text-warning-fg">
          {candidate.reviewWarnings.map((warning) => <p key={warning} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}</p>)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Move field up" disabled={index <= 0} onClick={(event) => { event.stopPropagation(); onMove(candidate.candidateId, -1, candidate.included) }} className="rounded-md border border-line p-1.5 text-fg-muted hover:bg-surface-2 disabled:opacity-35"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Move field down" disabled={index >= count - 1} onClick={(event) => { event.stopPropagation(); onMove(candidate.candidateId, 1, candidate.included) }} className="rounded-md border border-line p-1.5 text-fg-muted hover:bg-surface-2 disabled:opacity-35"><ArrowDown className="h-3.5 w-3.5" /></button>
        </div>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onToggle(candidate.candidateId) }}
          className={
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ' +
            (candidate.included
              ? 'border border-line bg-surface text-fg hover:bg-surface-2'
              : 'bg-indigo-600 text-white hover:bg-indigo-700')
          }
        >
          {candidate.included ? <Trash2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {candidate.included ? 'Move to suggestions' : 'Include field'}
        </button>
      </div>
    </article>
  )
}

function CandidateList({ items, emptyMessage, label, activeCandidate, onSelect, onChange, onMove, onToggle }) {
  const [requestedPage, setRequestedPage] = useState(0)
  const listRef = useRef(null)
  const pages = Math.max(1, Math.ceil(items.length / 20))
  const page = Math.min(requestedPage, pages - 1)
  const start = page * 20
  const navigate = (next) => {
    setRequestedPage(next)
    if (items[next * 20]) onSelect(items[next * 20])
    requestAnimationFrame(() => listRef.current?.focus())
  }
  if (!items.length) return <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-fg-muted">{emptyMessage}</div>
  return <div ref={listRef} tabIndex={-1} role="region" aria-label={label + ' list'} className="space-y-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
    {items.slice(start, start + 20).map((candidate, offset) => <CandidateCard
      key={candidate.candidateId} candidate={candidate}
      active={activeCandidate?.candidateId === candidate.candidateId}
      index={start + offset} count={items.length} onSelect={onSelect} onChange={onChange}
      onMove={(id, direction, included) => {
        setRequestedPage(Math.floor((start + offset + direction) / 20))
        onMove(id, direction, included)
      }} onToggle={onToggle}
    />)}
    {pages > 1 && <nav aria-label={label + ' pagination'} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      <p role="status" className="text-xs text-fg-muted">{start + 1}–{Math.min(start + 20, items.length)} of {items.length}</p>
      <div className="flex gap-2">
        <button type="button" disabled={page === 0} onClick={() => navigate(page - 1)} className="min-h-11 rounded-md border border-line px-3 text-xs font-semibold text-fg hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40">Previous</button>
        <button type="button" disabled={page === pages - 1} onClick={() => navigate(page + 1)} className="min-h-11 rounded-md border border-line px-3 text-xs font-semibold text-fg hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40">Next</button>
      </div>
    </nav>}
  </div>
}

export default function DocumentFormReview({
  candidates,
  activeCandidate,
  filterMode,
  onSelect,
  onChange,
  onMove,
  onToggle
}) {
  const included = candidates.filter((candidate) => candidate.included)
  const suggestions = candidates.filter((candidate) => !candidate.included)

  const renderList = (items, emptyMessage, label) => <CandidateList
    items={items} emptyMessage={emptyMessage} label={label} activeCandidate={activeCandidate}
    onSelect={onSelect} onChange={onChange} onMove={onMove} onToggle={onToggle}
  />

  return (
    <section className="min-h-0 overflow-y-auto rounded-xl border border-line bg-surface p-3 sm:p-4" aria-label="Generated form fields">
      <div className={filterMode === 'suggestions' ? 'hidden lg:block' : 'block'}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">Included fields</h3>
            <p className="mt-0.5 text-xs text-fg-muted">High-confidence, critic-approved core fields start here.</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-1 text-xs font-semibold text-success-fg">
            <Check className="h-3.5 w-3.5" /> {included.length}
          </span>
        </div>
        {renderList(included, 'Include at least one field to continue.', 'Included fields')}
      </div>

      <div className={(filterMode === 'fields' ? 'hidden lg:block' : 'block') + ' mt-5 border-t border-line pt-5 lg:block'}>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-fg">Suggestions</h3>
          <p className="text-xs text-fg-muted">{suggestions.length} candidate{suggestions.length === 1 ? '' : 's'}</p>
          <p className="mt-0.5 text-xs text-fg-muted">Optional, conditional, unvalidated, and lower-confidence fields require manual inclusion.</p>
        </div>
        {renderList(suggestions, 'No additional suggestions.', 'Suggestions')}
      </div>
    </section>
  )
}
