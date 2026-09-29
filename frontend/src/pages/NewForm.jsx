import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { formsStore } from '../lib/formsStore'
import { FORM_TEMPLATES } from '../lib/formTemplates'
import { api } from '../utils/api'
import { fieldMaxMb, MAX_UPLOAD_MB } from '../utils/uploads'
import { SignaturePad } from '../components/FormFields'
import { PATTERN_PRESETS } from '../components/formFieldHelpers'
import { toast } from '../lib/toastStore'
import { confirm } from '../lib/confirmStore'
import { reportLimit } from '../lib/limitFeedback'
import { AlertBanner } from '../components/Alert'
import { Skeleton } from '../components/Skeleton'
import { createDraftStore, useBeforeUnloadWarning } from '../utils/localDraft'
import { useFocusTrap, useScrollLock } from '../utils/a11y'
import { X } from 'lucide-react'

const draftStore = createDraftStore('netflow.form.draft.v1')
const documentHandoffStore = createDraftStore(
  'netflow.form.document-handoff.v1',
  { maxAgeMs: 30 * 60 * 1000 }
)

const AI_EXAMPLE_PROMPTS = [
  'Leave request with type, dates, and reason',
  'Expense claim with amount, receipts, and cost center',
  'IT access request with system, role, and manager',
]

const FIELD_TYPES = [
  {
    type: 'text',
    label: 'Text',
    tile: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
    chip: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
    defaults: { label: 'Untitled field', placeholder: '', required: false, multiline: false, referenceUser: false, maxLength: null },
  },
  {
    type: 'dropdown',
    label: 'Dropdown',
    tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
    chip: 'bg-violet-50 text-violet-800 border-violet-200 hover:bg-violet-100 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
    defaults: { label: 'Select an option', placeholder: 'Choose...', required: false, options: ['Option 1', 'Option 2'] },
  },
  {
    type: 'date',
    label: 'Date',
    tile: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    chip: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    defaults: { label: 'Pick a date', required: false, includeTime: false },
  },
  {
    type: 'file',
    label: 'File',
    tile: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
    chip: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30',
    defaults: { label: 'Upload file', required: false, fileTypes: 'PDF / DOCX', maxSize: 5 },
  },
  {
    type: 'checkbox',
    label: 'Checkbox',
    tile: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    defaults: { label: 'Check this box', required: false, options: ['Option 1', 'Option 2'], layout: 'vertical' },
  },
  {
    type: 'signature',
    label: 'Signature',
    tile: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    chip: 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    defaults: { label: 'Signature', required: false },
  },
  {
    type: 'number',
    label: 'Number',
    tile: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    chip: 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
    defaults: { label: 'Enter a number', placeholder: '', required: false, min: null, max: null },
  },
  {
    type: 'radio',
    label: 'Radio',
    tile: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
    chip: 'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
    defaults: { label: 'Choose one', required: false, options: ['Option 1', 'Option 2'], layout: 'vertical' },
  },
  {
    type: 'grid',
    label: 'Table',
    tile: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    chip: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
    defaults: {
      label: 'Table',
      required: false,
      columns: [{ id: 'c1', label: 'Column 1', type: 'text' }],
    },
  },
  {
    type: 'camera',
    label: 'Camera',
    tile: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
    chip: 'bg-cyan-50 text-cyan-800 border-cyan-200 hover:bg-cyan-100 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30',
    defaults: { label: 'Take a photo', required: false },
  },
  {
    type: 'heading',
    label: 'Heading',
    tile: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
    chip: 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30',
    defaults: { label: 'Section Heading', placeholder: 'Optional description or instructions' },
  },
]

function FieldTypeIcon({ type, className = 'w-4 h-4' }) {
  const props = {
    className,
    fill: 'none',
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    strokeWidth: '2',
    'aria-hidden': 'true',
  }
  switch (type) {
    case 'text':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h14" />
        </svg>
      )
    case 'dropdown':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
        </svg>
      )
    case 'date':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M4 11h16M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
        </svg>
      )
    case 'file':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      )
    case 'checkbox':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'signature':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      )
    case 'number':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      )
    case 'radio':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    case 'grid':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 4h16M4 14h16M10 4v16" />
        </svg>
      )
    case 'camera':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
        </svg>
      )
    case 'heading':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )
  }
}

const newFieldId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

// Clone grid columns with fresh ids so duplicated/added grids never share the
// same column objects (which would alias edits across separate fields).
const freshColumns = (cols) =>
  (Array.isArray(cols) ? cols : []).map((c) => ({
    ...c,
    id: newFieldId(),
    options: Array.isArray(c.options) ? [...c.options] : undefined,
  }))

const seededFields = () => [
  { id: newFieldId(), type: 'text', label: 'Employee name', placeholder: 'Jane Doe', required: true, multiline: false, maxLength: null },
  { id: newFieldId(), type: 'dropdown', label: 'Leave type', placeholder: 'Select leave type', required: true, options: ['Annual leave', 'Sick leave', 'Casual leave', 'Maternity/Paternity'] },
  { id: newFieldId(), type: 'date', label: 'Start date', required: true },
  { id: newFieldId(), type: 'date', label: 'End date', required: true },
  { id: newFieldId(), type: 'text', label: 'Reason', placeholder: 'Briefly explain', required: false, multiline: true, maxLength: 300 },
  { id: newFieldId(), type: 'file', label: 'Attach document', required: true, fileTypes: 'PDF / DOCX', maxSize: 5 },
]

const subtitleFor = (f) => {
  const req = f.required ? 'Required' : 'Optional'
  switch (f.type) {
    case 'text':
      return f.multiline
        ? `Text area · ${req}${f.maxLength ? ` — max ${f.maxLength} chars` : ''}`
        : `Text input · ${req}`
    case 'dropdown':
      return `Dropdown · ${(f.options || []).join(' / ') || 'no options'}`
    case 'date':
      return `Date picker · ${req}`
    case 'file':
      return `File upload · ${f.fileTypes || 'Any file'} up to ${fieldMaxMb(f)} MB`
    case 'checkbox':
      return `Checkbox · ${req}`
    case 'signature':
      return `Signature · ${req}`
    case 'number':
      return `Number · ${req}`
    case 'radio':
      return `Radio · ${(f.options || []).join(' / ') || 'no options'}`
    case 'grid': {
      const n = (f.columns || []).length
      return `Table · ${n} column${n === 1 ? '' : 's'}`
    }
    case 'camera':
      return `Camera · ${f.required ? 'Required' : 'Optional'}`
    default:
      return f.type
  }
}

function FieldPalette({ onAdd }) {
  return (
    <aside
      data-tour="form-builder-fields"
      aria-label="Field types"
      className="w-44 lg:w-52 shrink-0 border-r border-line bg-surface flex flex-col min-h-0"
    >
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <div className="text-[11px] font-semibold tracking-wider text-fg-muted">FIELDS</div>
      </div>
      <ul className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
        {FIELD_TYPES.map((t) => (
          <li key={t.type}>
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-field-type', t.type)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => onAdd(t.type)}
              title={t.label}
              aria-label={`Add ${t.label} field`}
              className={`group w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-lg border transition cursor-grab active:cursor-grabbing active:scale-[0.99] shadow-sm ${t.chip}`}
            >
              <span className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${t.tile}`}>
                <FieldTypeIcon type={t.type} />
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold leading-tight truncate">
                {t.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

// MIME type used to distinguish a "reorder existing field" drag from a
// "drop a new field type from the palette" drag.
const REORDER_MIME = 'application/x-field-id'

function FieldCard({
  field,
  index,
  total,
  selected,
  dropPosition, // null | 'before' | 'after' — shows the drop indicator line
  onSelect,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveUp,
  onMoveDown,
}) {
  return (
    <div
      onClick={() => onSelect(field.id)}
      onDragEnter={(e) => onDragEnter(e, field.id)}
      onDragOver={(e) => onDragOver(e, field.id)}
      onDragLeave={() => onDragLeave(field.id)}
      onDrop={(e) => onDrop(e, field.id)}
      onDragEnd={onDragEnd}
      className={`group relative flex items-start gap-3 px-4 py-3.5 rounded-xl border bg-surface shadow-sm cursor-pointer transition ${
        selected
          ? 'border-indigo-500 ring-2 ring-indigo-500/20'
          : 'border-line hover:border-indigo-300 dark:hover:border-indigo-500/40'
      }`}
    >
      {/* drop-target indicator line */}
      {dropPosition === 'before' && (
        <span className="absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-indigo-500" />
      )}
      {dropPosition === 'after' && (
        <span className="absolute -bottom-1 left-2 right-2 h-0.5 rounded-full bg-indigo-500" />
      )}

      {/* drag handle — initiates the reorder drag */}
      <div
        role="button"
        draggable
        onDragStart={(e) => onDragStart(e, field.id)}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        className="mt-0.5 w-5 h-6 rounded text-fg-subtle hover:text-fg-muted hover:bg-surface-3 flex items-center justify-center cursor-grab active:cursor-grabbing transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
          <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
          <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
        </svg>
      </div>

      <span
        className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          (FIELD_TYPES.find((t) => t.type === field.type) || FIELD_TYPES[0]).tile
        }`}
      >
        <FieldTypeIcon type={field.type} />
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-fg tracking-tight">
          {field.label}
          {field.required && <span className="text-danger-fg ml-0.5">*</span>}
        </p>
        <p className="text-xs text-fg-muted mt-0.5 truncate">{subtitleFor(field)}</p>
      </div>

      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
        {/* keyboard / no-drag fallback: up + down arrows */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveUp(field.id) }}
          disabled={index === 0}
          title="Move up"
          aria-label="Move field up"
          className="w-7 h-6 rounded-md border border-line bg-surface-2 hover:bg-surface-3 text-fg-muted disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveDown(field.id) }}
          disabled={index === total - 1}
          title="Move down"
          aria-label="Move field down"
          className="w-7 h-6 rounded-md border border-line bg-surface-2 hover:bg-surface-3 text-fg-muted disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDuplicate(field.id)
          }}
          title="Duplicate"
          aria-label={`Duplicate ${field.label || 'field'}`}
          className="w-7 h-6 rounded-md border border-line bg-surface-2 hover:bg-surface-3 text-fg-muted flex items-center justify-center transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v10a2 2 0 002 2h7M16 5H8a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V9l-4-4z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(field.id)
          }}
          title="Delete"
          aria-label={`Delete ${field.label || 'field'}`}
          className="w-7 h-6 rounded-md border border-danger-line bg-danger-subtle hover:bg-danger-subtle text-danger-fg flex items-center justify-center transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
          </svg>
        </button>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-3.5 py-2.5 text-sm rounded-lg border border-line bg-surface text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition'

// Options are plain strings with no id, so the rows used to be keyed by index.
// Deleting or reordering then made React hand the focused input to a different
// option. A parallel key list, spliced alongside the options, keeps each row
// tied to its own value.
let optionKeySeq = 0
const nextOptionKey = () => `opt-${++optionKeySeq}`

function OptionsEditor({ field, update }) {
  const options = field.options || []
  const [keys, setKeys] = useState(() => options.map(() => nextOptionKey()))
  if (keys.length !== options.length) {
    setKeys(options.map((_, i) => keys[i] || nextOptionKey()))
  }

  const setOptions = (next, keyList) => {
    setKeys(keyList)
    update({ options: next })
  }

  const move = (idx, delta) => {
    const to = idx + delta
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const nextKeys = [...keys]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    ;[nextKeys[idx], nextKeys[to]] = [nextKeys[to], nextKeys[idx]]
    setOptions(next, nextKeys)
  }

  return (
    <div className="mb-3" role="group" aria-labelledby="fs-options-caption">
      <span id="fs-options-caption" className="block text-xs font-medium text-fg mb-1">Options</span>
      <div className="space-y-1.5">
        {options.map((opt, idx) => (
          <div key={keys[idx]} className="flex gap-1.5">
            <input
              type="text"
              value={opt}
              aria-label={`Option ${idx + 1}`}
              onChange={(e) => {
                const next = [...options]
                next[idx] = e.target.value
                setOptions(next, keys)
              }}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              title="Move option up"
              aria-label={`Move option ${idx + 1} up`}
              className="w-7 shrink-0 rounded-md border border-line text-fg-subtle hover:text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => move(idx, 1)}
              disabled={idx === options.length - 1}
              title="Move option down"
              aria-label={`Move option ${idx + 1} down`}
              className="w-7 shrink-0 rounded-md border border-line text-fg-subtle hover:text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() =>
                setOptions(
                  options.filter((_, i) => i !== idx),
                  keys.filter((_, i) => i !== idx)
                )
              }
              title="Remove option"
              aria-label={`Remove option ${idx + 1}`}
              className="w-7 shrink-0 rounded-md border border-line text-fg-subtle hover:text-danger-fg hover:border-danger-line hover:bg-danger-subtle transition flex items-center justify-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          setOptions(
            [...options, `Option ${options.length + 1}`],
            [...keys, nextOptionKey()]
          )
        }
        className="mt-2 w-full px-3 py-1.5 rounded-md border border-line text-sm text-fg hover:bg-surface-2 transition"
      >
        Add option
      </button>
    </div>
  )
}

function FieldSettings({ field, fields = [], onChange, onDelete }) {
  if (!field) {
    return (
      <aside className="w-64 xl:w-80 shrink-0 border-l border-line bg-surface flex flex-col min-h-0">
        <div className="px-4 xl:px-5 pt-4 pb-3 border-b border-line">
          <div className="text-[11px] font-semibold tracking-wider text-fg-muted">SETTINGS</div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">Select a field</p>
        </div>
      </aside>
    )
  }

  const update = (patch) => onChange({ ...field, ...patch })
  const meta = FIELD_TYPES.find((t) => t.type === field.type) || FIELD_TYPES[0]
  const typeLabel = meta.label || field.type

  return (
    <aside className="w-64 xl:w-80 shrink-0 border-l border-line bg-surface flex flex-col min-h-0">
      <div className="px-4 xl:px-5 pt-4 pb-3 border-b border-line shrink-0">
        <div className="text-[11px] font-semibold tracking-wider text-fg-muted">SETTINGS</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 xl:px-5 py-5">
      <div className="rounded-xl border border-line bg-surface-2/50 px-4 py-3 mb-5 flex items-start gap-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.tile}`}>
          <FieldTypeIcon type={field.type} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg truncate">{field.label}</p>
          <p className="text-xs text-fg-muted mt-0.5">{typeLabel}</p>
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="fs-label" className="block text-xs font-medium text-fg mb-1">Field label</label>
        <input id="fs-label" type="text" value={field.label} onChange={(e) => update({ label: e.target.value })} className={inputCls} />
      </div>

      <div className="mb-3">
        <label htmlFor="fs-page" className="block text-xs font-medium text-fg mb-1">Page number</label>
        <input id="fs-page" type="number" min={1} value={field.page || 1} onChange={(e) => update({ page: Math.max(1, Number(e.target.value)) })} className={inputCls} />
      </div>

      {(field.type === 'text' || field.type === 'dropdown' || field.type === 'number' || field.type === 'heading') && (
        <div className="mb-3">
          <label htmlFor="fs-placeholder" className="block text-xs font-medium text-fg mb-1">Placeholder</label>
          <input id="fs-placeholder" type="text" value={field.placeholder || ''} onChange={(e) => update({ placeholder: e.target.value })} className={inputCls} />
        </div>
      )}

      {field.type === 'text' && (
        <>
          <label className="flex items-center gap-2 mb-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={!!field.multiline}
              onChange={(e) => update({ multiline: e.target.checked })}
              className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
            />
            Multiline (text area)
          </label>
          <label className="flex items-center gap-2 mb-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={!!field.referenceUser}
              onChange={(e) => update({ referenceUser: e.target.checked })}
              className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
            />
            Reference User
          </label>
        </>
      )}

      {field.type === 'date' && (
        <label className="flex items-center gap-2 mb-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={!!field.includeTime}
            onChange={(e) => update({ includeTime: e.target.checked })}
            className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
          />
          Include time
        </label>
      )}

      {(field.type === 'dropdown' || field.type === 'radio' || field.type === 'checkbox') && (
        <>
          <OptionsEditor key={field.id} field={field} update={update} />
          {(field.type === 'radio' || field.type === 'checkbox') && (
            <div className="mb-3">
              <label htmlFor="fs-layout" className="block text-xs font-medium text-fg mb-1">Layout</label>
              <select
                id="fs-layout"
                value={field.layout || 'vertical'}
                onChange={(e) => update({ layout: e.target.value })}
                className={inputCls}
              >
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
              </select>
            </div>
          )}
        </>
      )}

      {field.type === 'grid' && (
        <div className="mb-3" role="group" aria-labelledby="fs-columns-caption">
          <span id="fs-columns-caption" className="block text-xs font-medium text-fg mb-1">Columns</span>
          <div className="space-y-2">
            {(field.columns || []).map((col, idx) => {
              const setCol = (patch) =>
                update({ columns: field.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)) })
              return (
                <div key={col.id} className="rounded-md border border-line p-2 space-y-1.5">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={col.label}
                      onChange={(e) => setCol({ label: e.target.value })}
                      placeholder="Column name"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => update({ columns: field.columns.filter((_, i) => i !== idx) })}
                      title="Remove column"
                      aria-label={`Remove column ${col.label || idx + 1}`}
                      className="w-8 shrink-0 rounded-md border border-line text-fg-subtle hover:text-danger-fg hover:border-danger-line hover:bg-danger-subtle transition flex items-center justify-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <select
                    value={col.type}
                    onChange={(e) => {
                      const t = e.target.value
                      setCol({ type: t, options: t === 'dropdown' ? (col.options || ['Option 1']) : undefined })
                    }}
                    className={inputCls}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="dropdown">Dropdown</option>
                    <option value="date">Date</option>
                  </select>
                  {col.type === 'dropdown' && (
                    <input
                      type="text"
                      value={(col.options || []).join(', ')}
                      onChange={(e) =>
                        setCol({ options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                      }
                      placeholder="Option 1, Option 2"
                      className={inputCls}
                    />
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() =>
              update({
                columns: [
                  ...(field.columns || []),
                  { id: newFieldId(), label: `Column ${(field.columns?.length || 0) + 1}`, type: 'text' },
                ],
              })
            }
            className="mt-2 w-full px-3 py-1.5 rounded-md border border-line text-sm text-fg hover:bg-surface-2 transition"
          >
            Add column
          </button>
        </div>
      )}

      {field.type === 'file' && (
        <>
          <div className="mb-3">
            <label htmlFor="fs-file-types" className="block text-xs font-medium text-fg mb-1">Allowed file types</label>
            <input
              id="fs-file-types"
              type="text"
              value={field.fileTypes || ''}
              placeholder="e.g. PDF / DOCX"
              onChange={(e) => update({ fileTypes: e.target.value })}
              className={inputCls}
            />
          </div>
          <div className="mb-3">
            <label htmlFor="fs-max-size" className="block text-xs font-medium text-fg mb-1">Max size (MB)</label>
            <input
              id="fs-max-size"
              type="number"
              min={1}
              max={MAX_UPLOAD_MB}
              value={field.maxSize ?? ''}
              placeholder="e.g. 25"
              onChange={(e) => update({ maxSize: Number(e.target.value) || '' })}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-fg-subtle">Up to {MAX_UPLOAD_MB} MB per file.</p>
          </div>
        </>
      )}

      {field.type !== 'heading' && (
        <>
          <ValidationEditor field={field} update={update} />

          <label className="flex items-center gap-2 mb-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(e) => update({ required: e.target.checked })}
              className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
            />
            Required field
          </label>
          <ConditionalLogicEditor field={field} fields={fields} update={update} />
        </>
      )}

      <button
        type="button"
        onClick={() => onDelete(field.id)}
        className="w-full px-3 py-2.5 rounded-lg border border-danger-line text-danger-fg hover:bg-danger-subtle text-sm font-medium transition"
      >
        Delete field
      </button>
      </div>
    </aside>
  )
}

// Length / range / format-pattern rules for text and number fields. Writes into
// the canonical nested `validation` object; reads legacy flat props (maxLength/
// min/max) as an initial fallback so older forms show their existing rule.
function ValidationEditor({ field, update }) {
  const isText = field.type === 'text' || field.type === 'textarea'
  const isNum = field.type === 'number'
  if (!isText && !isNum) return null

  const v = field.validation && typeof field.validation === 'object' ? field.validation : {}
  const setV = (patch) => {
    const next = { ...v, ...patch }
    Object.keys(next).forEach((k) => {
      if (next[k] === null || next[k] === '' || next[k] === undefined) delete next[k]
    })
    update({ validation: next })
  }
  const numOrNull = (s) => (s === '' ? null : Number(s))

  const minLength = v.minLength ?? field.minLength ?? ''
  const maxLength = v.maxLength ?? field.maxLength ?? ''
  const min = v.min ?? field.min ?? ''
  const max = v.max ?? field.max ?? ''

  const currentPreset = (() => {
    if (!v.pattern) return 'none'
    for (const [key, p] of Object.entries(PATTERN_PRESETS)) if (p.pattern === v.pattern) return key
    return 'custom'
  })()

  const onPresetChange = (key) => {
    if (key === 'none') return setV({ pattern: null, patternLabel: null })
    if (key === 'custom') return setV({ pattern: currentPreset === 'custom' ? v.pattern : ' ', patternLabel: null })
    const p = PATTERN_PRESETS[key]
    setV({ pattern: p.pattern, patternLabel: p.label })
  }

  return (
    <div className="mb-3 rounded-md border border-line p-3">
      <p className="text-[11px] font-semibold tracking-wider text-fg-muted mb-2">VALIDATION</p>

      {isText && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label htmlFor="fv-min-length" className="block text-xs font-medium text-fg mb-1">Min length</label>
              <input
                id="fv-min-length"
                type="number"
                min="0"
                value={minLength}
                onChange={(e) => setV({ minLength: numOrNull(e.target.value) })}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="fv-max-length" className="block text-xs font-medium text-fg mb-1">Max length</label>
              <input
                id="fv-max-length"
                type="number"
                min="1"
                value={maxLength}
                onChange={(e) => setV({ maxLength: numOrNull(e.target.value) })}
                className={inputCls}
              />
            </div>
          </div>
          <div className="mb-2">
            <label htmlFor="fv-format" className="block text-xs font-medium text-fg mb-1">Format</label>
            <select id="fv-format" value={currentPreset} onChange={(e) => onPresetChange(e.target.value)} className={inputCls}>
              <option value="none">No pattern</option>
              <option value="email">Email</option>
              <option value="phone">Phone number</option>
              <option value="digits">Digits only</option>
              <option value="alnum">Letters &amp; numbers</option>
              <option value="custom">Custom regex…</option>
            </select>
          </div>
          {currentPreset === 'custom' && (
            <>
              <input
                type="text"
                value={v.pattern ?? ''}
                aria-label="Custom regex"
                onChange={(e) => setV({ pattern: e.target.value })}
                placeholder="e.g. ^[A-Z]{2}[0-9]{4}$"
                className={`${inputCls} mb-2 font-mono text-xs`}
              />
              <input
                type="text"
                aria-label="Error message shown when the pattern fails"
                value={v.patternLabel ?? ''}
                onChange={(e) => setV({ patternLabel: e.target.value })}
                placeholder="Error message (optional)"
                className={`${inputCls}`}
              />
            </>
          )}
        </>
      )}

      {isNum && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="fv-min" className="block text-xs font-medium text-fg mb-1">Min</label>
            <input
              id="fv-min"
              type="number"
              value={min}
              onChange={(e) => setV({ min: numOrNull(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="fv-max" className="block text-xs font-medium text-fg mb-1">Max</label>
            <input
              id="fv-max"
              type="number"
              value={max}
              onChange={(e) => setV({ max: numOrNull(e.target.value) })}
              className={inputCls}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Operators offered for a show/hide rule. `nonempty` needs no comparison value.
const CONDITION_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'nonempty', label: 'is filled in' },
]

// Per-field "show this field only when …" editor. `dependsOn` can only point at
// an EARLIER field (prevents circular rules). Stores the object shape the model
// + renderers expect: { enabled, dependsOn, operator, showWhen }.
function ConditionalLogicEditor({ field, fields = [], update }) {
  // Tolerate the legacy boolean value from the old builder.
  const cl = field.conditionalLogic && typeof field.conditionalLogic === 'object' ? field.conditionalLogic : {}
  const enabled = !!cl.enabled
  const operator = cl.operator || 'eq'

  const idx = fields.findIndex((f) => f.id === field.id)
  const earlier = idx > 0 ? fields.slice(0, idx) : []
  const source = fields.find((f) => f.id === cl.dependsOn) || null

  const setCL = (patch) => update({ conditionalLogic: { enabled: true, operator: 'eq', ...cl, ...patch } })

  const needsValue = operator !== 'nonempty'
  const sourceOptions =
    source && (source.type === 'dropdown' || source.type === 'radio') ? source.options || [] : null

  return (
    <div className="mb-4 rounded-md border border-line p-3">
      <label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => update({ conditionalLogic: { ...cl, operator, enabled: e.target.checked } })}
          className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
        />
        Conditional logic
      </label>

      {enabled && (
        <div className="mt-3 space-y-2">
          {earlier.length === 0 ? (
            <p className="text-[11px] text-warning-fg">
              Add at least one field above this one to use as the trigger.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="fc-depends-on" className="block text-[11px] font-medium text-fg-muted mb-1">Show this field when</label>
                <select
                  id="fc-depends-on"
                  value={cl.dependsOn || ''}
                  onChange={(e) => setCL({ dependsOn: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— Select a field —</option>
                  {earlier.map((f) => (
                    <option key={f.id} value={f.id}>{f.label || f.id}</option>
                  ))}
                </select>
              </div>

              <select
                value={operator}
                aria-label="Condition"
                onChange={(e) => setCL({ operator: e.target.value })}
                className={inputCls}
              >
                {CONDITION_OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {needsValue && (
                sourceOptions ? (
                  <select
                    value={cl.showWhen || ''}
                    onChange={(e) => setCL({ showWhen: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">— Select a value —</option>
                    {sourceOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : source && source.type === 'checkbox' ? (
                  <select
                    value={cl.showWhen || 'true'}
                    onChange={(e) => setCL({ showWhen: e.target.value })}
                    className={inputCls}
                  >
                    <option value="true">is checked</option>
                    <option value="false">is unchecked</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={cl.showWhen || ''}
                    onChange={(e) => setCL({ showWhen: e.target.value })}
                    placeholder="value to match"
                    className={inputCls}
                  />
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PreviewModal({ open, onClose, name, fields }) {
  const panelRef = useRef(null)
  useScrollLock(open)
  useFocusTrap(open, panelRef, { onEscape: onClose })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-preview-title"
        tabIndex={-1}
        className="w-full max-w-lg bg-surface rounded-xl shadow-xl border border-line max-h-[85vh] overflow-y-auto focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface">
          <div>
            <p className="text-xs text-fg-muted">Preview</p>
            <h2 id="form-preview-title" className="text-base font-semibold text-fg">{name || 'Untitled form'}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg-muted flex items-center justify-center transition"
            aria-label="Close preview"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form className="px-6 py-5 space-y-4" onSubmit={(e) => e.preventDefault()}>
          {fields.length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-8">No fields yet.</p>
          ) : (
            fields.map((f) => <PreviewField key={f.id} field={f} />)
          )}

          {fields.length > 0 && (
            <button type="submit" className="w-full mt-2 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition">
              Submit
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

function PreviewField({ field }) {
  const label = (
    <label className="block text-sm font-medium text-fg mb-1">
      {field.label}
      {field.required && <span className="text-danger-fg ml-0.5">*</span>}
    </label>
  )

  switch (field.type) {
    case 'text':
      return (
        <div>
          {label}
          {field.referenceUser ? (
            <input type="text" placeholder="Search users (e.g. Aman, Amit)..." className={inputCls} readOnly disabled />
          ) : field.multiline ? (
            <textarea
              rows={3}
              maxLength={field.validation?.maxLength ?? field.maxLength ?? undefined}
              placeholder={field.placeholder}
              className={`${inputCls} resize-none`}
            />
          ) : (
            <input type="text" placeholder={field.placeholder} className={inputCls} />
          )}
        </div>
      )
    case 'dropdown':
      return (
        <div>
          {label}
          <select className={inputCls} defaultValue="">
            <option value="" disabled>{field.placeholder || 'Choose...'}</option>
            {(field.options || []).map((opt) => (
              <option key={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )
    case 'date':
      return (
        <div>
          {label}
          <input type="date" className={inputCls} />
        </div>
      )
    case 'file':
      return (
        <div>
          {label}
          <div className="flex items-center gap-3">
            <input type="file" className="block w-full text-sm text-fg-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
            <button
              type="button"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-surface-2 text-fg border border-line"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
              </svg>
              Camera
            </button>
          </div>
          <p className="mt-1 text-xs text-fg-subtle">{field.fileTypes || 'Any file'} up to {fieldMaxMb(field)} MB</p>
        </div>
      )
    case 'number':
      return (
        <div>
          {label}
          <input
            type="number"
            min={field.min ?? undefined}
            max={field.max ?? undefined}
            placeholder={field.placeholder}
            className={inputCls}
          />
        </div>
      )
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400" />
          {field.label}
          {field.required && <span className="text-danger-fg ml-0.5">*</span>}
        </label>
      )
    case 'signature':
      return (
        <div>
          {label}
          <SignaturePad disabled onChange={() => {}} />
          <p className="mt-1.5 text-[11px] text-fg-subtle">
            Submitters can type a name in a signature font or upload an image.
          </p>
        </div>
      )
    case 'camera':
      return (
        <div>
          {label}
          <div className="w-full py-6 border-2 border-dashed border-line rounded-xl text-fg-muted bg-surface-2 flex flex-col items-center justify-center gap-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
            </svg>
            <span className="text-xs font-medium">Camera field</span>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">Respondents will see a live camera feed or file upload option.</p>
        </div>
      )
    case 'radio':
      return (
        <div>
          {label}
          <div className="space-y-1.5">
            {(field.options || []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-fg">
                <input type="radio" name={`preview-${field.id}`} className="w-4 h-4 border-line text-indigo-600 focus:ring-indigo-400" />
                {opt}
              </label>
            ))}
          </div>
        </div>
      )
    case 'grid':
      return (
        <div>
          {label}
          <div className="overflow-x-auto border border-line rounded-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2">
                  {(field.columns || []).map((c) => (
                    <th scope="col" key={c.id} className="px-2 py-1.5 text-left font-medium text-fg-muted border-b border-line whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {(field.columns || []).map((c) => (
                    <td key={c.id} className="px-2 py-2 border-b border-line text-fg-subtle">—</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-fg-subtle">Respondents can add rows when filling.</p>
        </div>
      )
    default:
      return null
  }
}

function NewForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: editId } = useParams()
  const pristineRef = useRef(null)
  const [searchParams] = useSearchParams()
  const isEditMode = !!editId

  // How the builder was opened from the "New form" chooser:
  //   ?template=<id> → seed a ready-made template
  //   ?ai=1          → start blank and focus the AI prompt box
  //   ?ai=1 + location.state.aiDraft → fields already generated in the chooser
  //   ?blank=1       → start with no fields
  // (no param keeps the legacy default: a seeded Leave Request form)
  const templateId = searchParams.get('template')
  const aiMode = searchParams.get('ai') === '1'
  const documentMode = searchParams.get('document') === '1'
  const blankMode = searchParams.get('blank') === '1'
  const template = !isEditMode && templateId
    ? FORM_TEMPLATES.find((t) => t.id === templateId) || null
    : null

  // One-shot seed from Generate Now in the chooser (router state, not URL).
  const [aiDraft] = useState(() =>
    !isEditMode && location.state?.aiDraft ? location.state.aiDraft : null
  )
  const [documentDraft] = useState(() =>
    !isEditMode
      ? (location.state?.documentDraft || (documentMode ? documentHandoffStore.read() : null))
      : null
  )

  // Restore a document handoff only when its matching entry mode is present.
  // This prevents a blank/template flow from silently inheriting another flow's
  // draft while allowing ?document=1 refreshes to recover generated fields.
  const [restoredDraft] = useState(() => {
    if (isEditMode || templateId || aiMode || aiDraft) return null
    const saved = draftStore.read()
    if (documentMode) {
      return !documentDraft && saved?.entryMode === 'document' ? saved : null
    }
    if (blankMode) {
      return !saved?.entryMode || saved.entryMode === 'blank' ? saved : null
    }
    return saved
  })
  const documentSeed = documentDraft ||
    (restoredDraft?.entryMode === 'document' ? restoredDraft : null)

  // Entry chrome mode for create flow (edit mode has no chooser badge).
  const entryMode = isEditMode
    ? null
    : documentMode || documentSeed
      ? 'document'
      : aiMode || aiDraft
      ? 'ai'
      : template
        ? 'template'
        : blankMode
          ? 'blank'
          : null

  const [name, setName] = useState(() => {
    if (documentSeed?.title || documentSeed?.name) return documentSeed.title || documentSeed.name
    if (aiDraft?.title) return aiDraft.title
    if (restoredDraft) return restoredDraft.name || ''
    if (isEditMode) return ''
    if (template) return template.name
    if (aiMode || documentMode || blankMode) return ''
    return 'Leave Request Form'
  })
  const [fields, setFields] = useState(() => {
    if (documentSeed?.fields?.length) {
      return documentSeed.fields.map((f) => ({
        ...f,
        id: newFieldId(),
        options: Array.isArray(f.options) ? [...f.options] : f.options,
        columns: f.type === 'grid' ? freshColumns(f.columns) : f.columns,
      }))
    }
    if (aiDraft?.fields?.length) {
      return aiDraft.fields.map((f) => ({
        ...f,
        id: newFieldId(),
        options: Array.isArray(f.options) ? [...f.options] : f.options,
        columns: f.type === 'grid' ? freshColumns(f.columns) : f.columns,
      }))
    }
    if (restoredDraft) return restoredDraft.fields || []
    if (isEditMode || aiMode || documentMode || blankMode) return []
    if (template) {
      return template.fields.map((f) => ({
        ...f,
        id: newFieldId(),
        options: Array.isArray(f.options) ? [...f.options] : f.options,
        columns: f.type === 'grid' ? freshColumns(f.columns) : f.columns,
      }))
    }
    return seededFields()
  })
  const [description, setDescription] = useState(() => {
    if (documentSeed?.description) return documentSeed.description
    if (aiDraft?.description) return aiDraft.description
    if (restoredDraft) return restoredDraft.description || ''
    return !isEditMode && template ? template.description || '' : ''
  })
  const [draftNotice, setDraftNotice] = useState(!!restoredDraft)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(() =>
    (documentSeed?.fields?.length || aiDraft?.fields?.length) ? (fields[0]?.id ?? null) : null
  )
  const [activePage, setActivePage] = useState(1)
  const totalPages = Math.max(1, activePage, ...fields.map(f => f.page || 1))
  const [previewOpen, setPreviewOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // AI Form Builder
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiStatusReady, setAiStatusReady] = useState(false)
  const [aiPrompt, setAiPrompt] = useState(() => aiDraft?.prompt || searchParams.get('prompt') || '')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const aiInputRef = useRef(null)
  // Ghost-text inline suggestion for the AI prompt box.
  const [aiSuggestion, setAiSuggestion] = useState('')
  const suggestTimer = useRef(null)
  const latestSuggestBase = useRef('')
  // Blank/template hide AI by default; AI mode shows it. Pre-seeded AI draft opens the canvas.
  const [showAiPanel, setShowAiPanel] = useState(() => aiMode && !aiDraft)
  const [templateBannerDismissed, setTemplateBannerDismissed] = useState(false)

  const aiFirstEmpty = aiMode && fields.length === 0 && !aiDraft
  const showCompactAi =
    aiAvailable && !aiFirstEmpty && (aiMode || showAiPanel || !!aiDraft)
  const showOptionalAiToggle =
    aiAvailable && !aiMode && !aiDraft && !showAiPanel && !isEditMode

  // In edit mode, fetch the existing form and populate state.
  useEffect(() => {
    if (!editId) return
    ;(async () => {
      try {
        const { form } = await api.get(`/api/forms/${editId}`)
        // What the server returned is the new "unchanged" baseline.
        pristineRef.current = null
        setName(form.title || '')
        setDescription(form.description || '')
        setFields(Array.isArray(form.fields) ? form.fields : [])
      } catch (err) {
        setLoadError(err.message || 'Could not load form')
      }
    })()
  }, [editId])

  // Is the AI form-builder available? (server has an LLM key configured)
  useEffect(() => {
    let cancelled = false
    api.get('/api/forms/ai-status')
      .then((d) => {
        if (cancelled) return
        setAiAvailable(!!d.aiConfigured)
        setAiStatusReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setAiAvailable(false)
        setAiStatusReady(true)
      })
    return () => { cancelled = true }
  }, [])

  // Keep AI panel visibility in sync when the chooser query changes without remount.
  const modeKey = `${aiMode}:${blankMode}:${templateId}`
  const [previousMode, setPreviousMode] = useState(modeKey)
  if (previousMode !== modeKey) {
    setPreviousMode(modeKey)
    if (aiMode) setShowAiPanel(true)
    else if (blankMode || templateId) setShowAiPanel(false)
  }

  // AI entry with no LLM key → blank builder (avoid a flashy "not configured" card).
  useEffect(() => {
    if (!aiFirstEmpty || !aiStatusReady || aiAvailable) return
    navigate('/forms/new?blank=1', { replace: true })
  }, [aiFirstEmpty, aiStatusReady, aiAvailable, navigate])

  // Opened via the chooser's AI option (empty canvas) → focus the prompt box.
  useEffect(() => {
    if (aiDraft) return
    if (aiMode && aiStatusReady && aiAvailable && aiInputRef.current) {
      aiInputRef.current.focus()
      try { aiInputRef.current.scrollIntoView({ block: 'center' }) } catch { /* noop */ }
    }
  }, [aiMode, aiDraft, aiStatusReady, aiAvailable, aiFirstEmpty])

  // Drop router state so a refresh does not try to re-apply a one-shot seed.
  useEffect(() => {
    if (!location.state?.aiDraft) return
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Document-generated fields are copied into the local draft immediately
  // before the one-shot router state is cleared, so a refresh cannot lose them.
  useEffect(() => {
    if (!documentDraft) return
    documentHandoffStore.clear()
    draftStore.write({ name, description, fields, entryMode: 'document' })
    if (location.state?.documentDraft) {
      navigate(location.pathname + location.search, { replace: true, state: {} })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reorder drag state. `draggingId` is the field being moved, `dropTarget`
  // is `{ id, position: 'before' | 'after' }` for the indicator line.
  const [draggingId, setDraggingId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  const selectedField = useMemo(() => fields.find((f) => f.id === selectedId) || null, [fields, selectedId])

  const addField = (type, atEnd = true) => {
    const def = FIELD_TYPES.find((t) => t.type === type)
    if (!def) return
    const id = newFieldId()
    const newField = { id, type, ...def.defaults, label: def.defaults.label, page: activePage }
    if (Array.isArray(def.defaults.options)) newField.options = [...def.defaults.options]
    if (type === 'grid') newField.columns = freshColumns(def.defaults.columns)
    setFields((prev) => (atEnd ? [...prev, newField] : [newField, ...prev]))
    setSelectedId(id)
  }

  const deletePage = async (pageNum) => {
    if (totalPages <= 1) return // Cannot delete the only page
    
    // Check if page has fields
    const hasFields = fields.some(f => (f.page || 1) === pageNum)
    if (hasFields) {
      const ok = await confirm({
        title: 'Delete page?',
        message: 'This page contains fields. Are you sure you want to permanently delete this page and all its fields?',
        confirmLabel: 'Delete page',
        danger: true
      })
      if (!ok) return
    }

    // Remove fields on the deleted page, and shift fields on subsequent pages down
    setFields(prev => prev
      .filter(f => (f.page || 1) !== pageNum)
      .map(f => {
        const p = f.page || 1
        if (p > pageNum) {
          return { ...f, page: p - 1 }
        }
        return f
      })
    )

    // Adjust active page if needed
    if (activePage >= pageNum) {
      setActivePage(Math.max(1, activePage - 1))
    }
  }

  // Turn a plain-English description into fields via the server's Gemini client,
  // then merge them into the builder (assigning fresh ids on the client).
  const generateWithAI = async () => {
    const prompt = aiPrompt.trim()
    if (!prompt || aiBusy) return
    setAiBusy(true)
    setAiError('')
    try {
      const res = await api.post('/api/forms/ai-draft', { prompt })
      const incoming = (res.fields || []).map((f) => ({
        ...f,
        id: newFieldId(),
        page: activePage,
        columns: f.type === 'grid' ? freshColumns(f.columns) : f.columns,
      }))
      if (!incoming.length) {
        setAiError('No fields were generated. Try rephrasing.')
        return
      }
      const replace =
        fields.length === 0 ||
        await confirm({
          title: 'Replace existing fields?',
          message: 'Replace your current fields with the AI-generated ones, or add them below?',
          confirmLabel: 'Replace',
          cancelLabel: 'Add below',
          danger: false,
        })
      setFields((prev) => (replace ? incoming : [...prev, ...incoming]))
      setSelectedId(incoming[0].id)
      if (res.title && (!name.trim() || name === 'Leave Request Form')) setName(res.title)
      setAiPrompt('')
    } catch (err) {
      setAiError(err.message || 'AI generation failed. Please try again.')
    } finally {
      setAiBusy(false)
    }
  }

  // Ask the server for a short continuation of what the user has typed. Stale
  // responses (user kept typing / caret moved) are dropped so the ghost text
  // always matches the current input.
  const fetchSuggestion = async (base) => {
    latestSuggestBase.current = base
    try {
      const res = await api.post('/api/forms/ai-suggest', { prompt: base })
      if (latestSuggestBase.current !== base) return
      const el = aiInputRef.current
      if (!el || el.value !== base || el.selectionStart !== base.length) return
      setAiSuggestion(res?.completion || '')
    } catch {
      setAiSuggestion('')
    }
  }

  const onAiPromptChange = (e) => {
    const val = e.target.value
    setAiPrompt(val)
    setAiSuggestion('')
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (!aiAvailable || aiBusy || val.trim().length < 3) return
    suggestTimer.current = setTimeout(() => fetchSuggestion(val), 350)
  }

  const acceptSuggestion = () => {
    const next = aiPrompt + aiSuggestion
    setAiPrompt(next)
    setAiSuggestion('')
    requestAnimationFrame(() => {
      const el = aiInputRef.current
      if (el) { el.focus(); el.setSelectionRange(next.length, next.length) }
    })
  }

  const onAiKeyDown = (e) => {
    const el = e.target
    const caretAtEnd = el.selectionStart === aiPrompt.length && el.selectionStart === el.selectionEnd
    if (aiSuggestion && (e.key === 'Tab' || (e.key === 'ArrowRight' && caretAtEnd))) {
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === 'Escape') { setAiSuggestion(''); return }
    if (e.key === 'Enter') { setAiSuggestion(''); generateWithAI() }
  }

  // Cancel any pending suggestion fetch on unmount.
  useEffect(() => () => { if (suggestTimer.current) clearTimeout(suggestTimer.current) }, [])

  const updateField = (updated) =>
    setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))

  const duplicateField = (id) => {
    const idx = fields.findIndex((f) => f.id === id)
    if (idx === -1) return
    const src = fields[idx]
    const newField = { ...src, id: newFieldId(), label: `${src.label} (copy)` }
    if (Array.isArray(src.options)) newField.options = [...src.options]
    if (src.type === 'grid') newField.columns = freshColumns(src.columns)
    const next = [...fields]
    next.splice(idx + 1, 0, newField)
    setFields(next)
    setSelectedId(newField.id)
  }

  const deleteField = async (id) => {
    const target = fields.find((f) => f.id === id)
    const ok = await confirm({
      title: 'Delete field?',
      message: `"${target?.label || 'This field'}" will be removed from the form. There's no undo.`,
      confirmLabel: 'Delete field',
      danger: true,
    })
    if (!ok) return
    setFields((prev) => prev.filter((f) => f.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // ---------- reorder via drag handle ----------
  const moveField = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return
    setFields((prev) => {
      if (fromIdx >= prev.length || toIdx >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }

  const moveUp = (id) => {
    const idx = fields.findIndex((f) => f.id === id)
    if (idx > 0) moveField(idx, idx - 1)
  }
  const moveDown = (id) => {
    const idx = fields.findIndex((f) => f.id === id)
    if (idx >= 0 && idx < fields.length - 1) moveField(idx, idx + 1)
  }

  const handleReorderStart = (e, id) => {
    e.dataTransfer.setData(REORDER_MIME, id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }

  const handleReorderEnter = (e) => {
    if (!e.dataTransfer.types.includes(REORDER_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleReorderOver = (e, overId) => {
    if (!e.dataTransfer.types.includes(REORDER_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    
    // Don't draw the blue drop indicator line if hovering over itself
    if (draggingId === overId) return 
    const rect = e.currentTarget.getBoundingClientRect()
    const isAbove = (e.clientY - rect.top) < rect.height / 2
    setDropTarget({ id: overId, position: isAbove ? 'before' : 'after' })
  }

  const handleReorderLeave = (overId) => {
    setDropTarget((dt) => (dt?.id === overId ? null : dt))
  }

  const handleReorderDrop = (e, overId) => {
    const droppedId = e.dataTransfer.getData(REORDER_MIME) || draggingId;
    if (!droppedId || droppedId === overId) {
      setDraggingId(null)
      setDropTarget(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()

    const fromIdx = fields.findIndex((f) => f.id === droppedId)
    let toIdx = fields.findIndex((f) => f.id === overId)
    if (fromIdx === -1 || toIdx === -1) {
      setDraggingId(null)
      setDropTarget(null)
      return
    }
    
    const rect = e.currentTarget.getBoundingClientRect()
    const isAbove = (e.clientY - rect.top) < rect.height / 2
    const position = isAbove ? 'before' : 'after'
    
    if (position === 'after') toIdx += 1
    // Removing the source first shifts later indices down by one.
    if (fromIdx < toIdx) toIdx -= 1
    moveField(fromIdx, toIdx)

    setDraggingId(null)
    setDropTarget(null)
  }

  const handleReorderEnd = () => {
    setDraggingId(null)
    setDropTarget(null)
  }

  // Mirror the builder into localStorage so a refresh doesn't lose the fields,
  // and warn before an unload while there's unsaved work.
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const snapshot = JSON.stringify({ name, description, fields })
    if (pristineRef.current === null) {
      pristineRef.current = snapshot
      return
    }
    const changed = snapshot !== pristineRef.current
    setDirty(changed)
    if (isEditMode) return
    if (!changed) {
      draftStore.clear()
      return
    }
    const t = setTimeout(() => draftStore.write({
      name,
      description,
      fields,
      entryMode: entryMode || 'blank'
    }), 600)
    return () => clearTimeout(t)
  }, [name, description, fields, isEditMode, entryMode])

  useBeforeUnloadWarning(dirty && !saving)

  const handleDiscard = async () => {
    if (await confirm({ title: 'Discard form?', message: 'Unsaved changes will be lost.', confirmLabel: 'Discard', danger: false })) {
      draftStore.clear()
      navigate('/forms')
    }
  }

  const persist = async (status) => {
    if (!name.trim()) {
      toast.error('Give the form a name first.')
      return
    }
    if (fields.length === 0) {
      toast.error('Add at least one field before saving.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        // Only fall back to the generated blurb when there's nothing to keep —
        // this used to clobber the real description on every save.
        description: description.trim() || `${fields.length} field form`,
        fields,
      }
      let saved
      if (isEditMode) {
        saved = await formsStore.update(editId, payload)
      } else {
        saved = await formsStore.add(payload)
      }
      // Only call publish when explicitly requested AND the form isn't already
      // published (avoids a redundant round-trip when editing a live form).
      if (status === 'Published' && saved.status !== 'Published') {
        await formsStore.publish(saved.id)
      }
      draftStore.clear()
      setDirty(false)
      toast.success(status === 'Published' ? 'Form published' : 'Form saved')
      navigate('/forms')
    } catch (err) {
      // The work stays on screen either way — a form limit must not cost the
      // builder the layout they just built.
      if (!reportLimit(err)) toast.error(err.message || 'Failed to save the form')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-2">
        <div className="p-6 rounded-lg bg-danger-subtle border border-danger-line text-danger-fg text-sm max-w-md text-center">
          <p className="font-semibold mb-1">Could not load form</p>
          <p>{loadError}</p>
          <button onClick={() => navigate('/forms')} className="mt-4 px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition">Back to forms</button>
        </div>
      </div>
    )
  }

  // Dedicated AI entry experience — distinct from the blank/template builder chrome.
  if (aiFirstEmpty) {
    return (
      <div className="h-dvh flex flex-col bg-surface text-fg overflow-hidden">
        <header className="h-14 shrink-0 border-b border-line px-4 sm:px-6 flex items-center justify-between gap-4 bg-surface/90 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => navigate('/forms')}
            className="flex items-center gap-2.5 shrink-0 rounded-lg hover:bg-surface-2 px-1.5 py-1 transition"
            title="Back to forms"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm overflow-hidden">
              <img src="/netflow-icon.png" alt="" className="w-full h-full object-contain" />
            </div>
            <span className="font-semibold text-fg tracking-tight">NetFlow</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/forms/new?blank=1', { replace: true })}
              className="px-3 py-2 rounded-lg text-sm font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition"
            >
              Blank form
            </button>
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="px-3 py-2 rounded-lg border border-line hover:bg-surface-2 disabled:opacity-50 text-sm font-medium text-fg transition"
            >
              Discard
            </button>
          </div>
        </header>

        <main className="relative flex-1 min-h-0 overflow-y-auto">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-50/80 via-surface to-surface-2 dark:from-indigo-500/10 dark:via-surface dark:to-surface-2"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(to right, var(--color-line, #e5e7eb) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line, #e5e7eb) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center, black 20%, transparent 75%)',
            }}
            aria-hidden="true"
          />

          <div className="relative min-h-full flex items-center justify-center px-5 sm:px-8 py-10 sm:py-16">
            {!aiStatusReady || !aiAvailable ? (
              <div className="w-full max-w-2xl" aria-busy="true" aria-label="Loading AI form builder">
                <Skeleton className="mb-6 h-9 w-56 sm:w-72" />
                <div className="rounded-2xl border border-line bg-surface/90 backdrop-blur-sm shadow-lg shadow-slate-900/5 dark:shadow-black/20 p-5 sm:p-6">
                  <Skeleton className="h-28 w-full rounded-xl" />
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-10 w-28 rounded-lg" />
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Skeleton className="h-8 w-44 rounded-full" />
                  <Skeleton className="h-8 w-52 rounded-full" />
                  <Skeleton className="h-8 w-40 rounded-full" />
                </div>
              </div>
            ) : (
              <div className="w-full max-w-2xl">
                <h1 className="mb-6 text-2xl sm:text-3xl font-bold tracking-tight text-fg">
                  Describe your form
                </h1>

                <div className="rounded-2xl border border-line bg-surface/90 backdrop-blur-sm shadow-lg shadow-slate-900/5 dark:shadow-black/20 p-5 sm:p-6">
                  <div className="relative">
                    {aiSuggestion && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 z-10 px-4 py-3.5 text-base whitespace-pre-wrap overflow-hidden rounded-xl border border-transparent"
                      >
                        <span className="invisible">{aiPrompt}</span>
                        <span className="text-fg-subtle">{aiSuggestion}</span>
                      </div>
                    )}
                    <textarea
                      id="ai-form-prompt"
                      ref={aiInputRef}
                      rows={4}
                      value={aiPrompt}
                      onChange={onAiPromptChange}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (aiPrompt.trim() && !aiBusy) generateWithAI()
                        } else {
                          onAiKeyDown(e)
                        }
                      }}
                      onBlur={() => setAiSuggestion('')}
                      placeholder="Leave request with type, dates, and reason…"
                      disabled={aiBusy}
                      aria-label="Form description for AI"
                      className="w-full px-4 py-3.5 text-base rounded-xl border border-line bg-surface-2/50 text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 focus:bg-surface transition resize-none disabled:opacity-60 min-h-[7.5rem]"
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={generateWithAI}
                      disabled={aiBusy || !aiPrompt.trim()}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-sm transition"
                    >
                      {aiBusy ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                  {aiError && <p className="mt-3 text-xs text-danger-fg">{aiError}</p>}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {AI_EXAMPLE_PROMPTS.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => {
                        setAiPrompt(example)
                        setAiSuggestion('')
                        setAiError('')
                        requestAnimationFrame(() => aiInputRef.current?.focus())
                      }}
                      className="px-3 py-1.5 rounded-lg border border-line bg-surface/80 text-xs font-medium text-fg hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 transition text-left"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="h-dvh flex flex-col bg-surface-2 text-fg overflow-hidden">
      <header className="h-16 shrink-0 bg-surface border-b border-line px-4 sm:px-6 flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate('/forms')}
            className="flex items-center gap-2.5 shrink-0 rounded-lg hover:bg-surface-2 px-1.5 py-1.5 transition"
            title="Back to forms"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm overflow-hidden">
              <img src="/netflow-icon.png" alt="" className="w-full h-full object-contain" />
            </div>
            <span className="font-semibold text-fg tracking-tight hidden sm:inline leading-none">NetFlow</span>
          </button>
          <div className="w-px h-8 bg-line shrink-0 hidden sm:block self-center" />
          <div className="min-w-0 flex-1 max-w-xl flex flex-col justify-center gap-0.5">
            <div className="flex items-center gap-2 min-w-0">
              {entryMode && (
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide uppercase leading-none ${
                    entryMode === 'document'
                      ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                      : entryMode === 'ai'
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : entryMode === 'template'
                        ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                        : 'bg-surface-2 text-fg-muted border border-line'
                  }`}
                >
                  {entryMode === 'document' ? 'From document' : entryMode === 'ai' ? 'Build with AI' : entryMode === 'template' ? 'From template' : 'Blank form'}
                </span>
              )}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Form name"
                aria-label="Form name"
                className="min-w-0 flex-1 text-sm font-semibold text-fg bg-transparent border-0 px-0 py-0 leading-5 focus:outline-none focus:ring-0 placeholder:text-fg-subtle"
              />
            </div>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              aria-label="Form description"
              className="w-full text-xs text-fg-muted bg-transparent border-0 px-0 py-0 leading-4 focus:outline-none focus:ring-0 placeholder:text-fg-subtle hidden sm:block"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-center">
          <button
            onClick={handleDiscard}
            disabled={saving}
            className="px-3 py-2 rounded-lg border border-line hover:bg-surface-2 disabled:opacity-50 text-sm font-medium text-fg transition"
          >
            Discard
          </button>
          <button
            onClick={() => persist('Draft')}
            disabled={saving}
            className="px-3 py-2 rounded-lg border border-line hover:bg-surface-2 disabled:opacity-50 text-sm font-medium text-fg transition hidden sm:inline-flex"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            onClick={() => setPreviewOpen(true)}
            disabled={saving}
            className="px-3 py-2 rounded-lg border border-line hover:bg-surface-2 disabled:opacity-50 text-sm font-medium text-fg transition"
          >
            Preview
          </button>
          <button
            data-tour="form-builder-publish"
            onClick={() => persist('Published')}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium shadow-sm transition"
          >
            {saving ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <FieldPalette onAdd={(type) => addField(type, true)} />

        <main className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-8 py-5 sm:py-6">
          <div className="max-w-3xl mx-auto">
          {draftNotice && (
            <div className="mb-4">
              <AlertBanner
                tone="info"
                onRetry={async () => {
                  const ok = await confirm({
                    title: 'Start over?',
                    message: 'Your restored draft will be thrown away and the builder resets to a blank form.',
                    confirmLabel: 'Start fresh',
                    danger: true,
                  })
                  if (!ok) return
                  draftStore.clear()
                  setDraftNotice(false)
                  navigate(0)
                }}
                retryLabel="Start fresh"
              >
                Unsaved draft restored from your last visit.
              </AlertBanner>
            </div>
          )}

          {template && !templateBannerDismissed && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/80 dark:border-teal-500/30 dark:bg-teal-500/10 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-teal-800 dark:text-teal-200 truncate">
                  From template: {template.name}
                </p>
                <p className="text-xs text-teal-700/80 dark:text-teal-300/80 mt-0.5">
                  {template.fields.length} fields · customize anything below
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTemplateBannerDismissed(true)}
                className="shrink-0 text-xs font-medium text-teal-700 dark:text-teal-300 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {showOptionalAiToggle && (
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAiPanel(true)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                Use AI
              </button>
            </div>
          )}

          {/* Compact AI strip (after generate, or when blank/template opts in) */}
          {showCompactAi && (
            <div className="mb-5 rounded-xl border border-line bg-surface shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-semibold text-fg">AI</span>
                {!aiMode && (
                  <button
                    type="button"
                    onClick={() => setShowAiPanel(false)}
                    className="text-xs text-fg-muted hover:text-fg"
                  >
                    Hide
                  </button>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  {aiSuggestion && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-10 px-3.5 py-2.5 text-sm whitespace-pre overflow-hidden rounded-lg border border-transparent"
                    >
                      <span className="invisible">{aiPrompt}</span>
                      <span className="text-fg-subtle">{aiSuggestion}</span>
                    </div>
                  )}
                  <input
                    ref={aiInputRef}
                    type="text"
                    value={aiPrompt}
                    onChange={onAiPromptChange}
                    onKeyDown={onAiKeyDown}
                    onBlur={() => setAiSuggestion('')}
                    placeholder="Describe the form…"
                    disabled={aiBusy}
                    className={`${inputCls} disabled:opacity-60`}
                  />
                </div>
                <button
                  type="button"
                  onClick={generateWithAI}
                  disabled={aiBusy || !aiPrompt.trim()}
                  className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium shadow-sm transition whitespace-nowrap"
                >
                  {aiBusy ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {aiError && <p className="mt-2 text-xs text-danger-fg">{aiError}</p>}
            </div>
          )}

          <div
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-field-type')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes('application/x-field-type')) return
              e.preventDefault()
              setDragOver(false)
              const type = e.dataTransfer.getData('application/x-field-type')
              if (type) addField(type, false)
            }}
            className={`rounded-xl border transition flex-1 flex flex-col ${
              dragOver
                ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-500/10 ring-2 ring-indigo-500/20'
                : 'border-line bg-surface shadow-sm'
            }`}
          >
            {/* Page Tabs */}
            <div className="flex items-center gap-6 px-4 pt-3 border-b border-line overflow-x-auto bg-surface rounded-t-xl">
              {Array.from({ length: totalPages }).map((_, i) => {
                const pageNum = i + 1
                return (
                  <div 
                    key={pageNum} 
                    className={`flex items-center gap-1.5 pb-2.5 border-b-2 transition ${
                      activePage === pageNum
                        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-fg-muted hover:text-fg hover:border-line'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActivePage(pageNum)}
                      className="text-sm font-medium whitespace-nowrap focus:outline-none"
                    >
                      Page {pageNum}
                    </button>
                    {totalPages > 1 && (
                      <button
                        type="button"
                        onClick={() => deletePage(pageNum)}
                        className={`p-0.5 rounded-full transition focus:outline-none ${
                          activePage === pageNum 
                            ? 'text-indigo-400 hover:text-red-500 hover:bg-red-500/10' 
                            : 'text-fg-muted/50 hover:text-red-500 hover:bg-red-500/10'
                        }`}
                        title="Delete this page"
                      >
                        <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() => setActivePage(totalPages + 1)}
                className="pb-2.5 text-sm font-medium whitespace-nowrap transition text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
              >
                + Add Page
              </button>
            </div>

            {fields.filter(f => (f.page || 1) === activePage).length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto w-12 h-12 rounded-xl bg-surface-2 border border-line flex items-center justify-center text-fg-muted mb-3">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-fg">Add fields</p>
              </div>
            ) : (
              <div className="p-3 sm:p-4 space-y-2 flex-1">
                {fields.filter(f => (f.page || 1) === activePage).map((f, idx) => (
                  <FieldCard
                    key={f.id}
                    field={f}
                    index={idx}
                    total={fields.length}
                    selected={selectedId === f.id}
                    dropPosition={dropTarget?.id === f.id ? dropTarget.position : null}
                    onSelect={setSelectedId}
                    onDuplicate={duplicateField}
                    onDelete={deleteField}
                    onDragStart={handleReorderStart}
                    onDragEnter={handleReorderEnter}
                    onDragOver={handleReorderOver}
                    onDragLeave={handleReorderLeave}
                    onDrop={handleReorderDrop}
                    onDragEnd={handleReorderEnd}
                    onMoveUp={moveUp}
                    onMoveDown={moveDown}
                  />
                ))}
              </div>
            )}
          </div>
          </div>
        </main>

        <FieldSettings field={selectedField} fields={fields} onChange={updateField} onDelete={deleteField} />
      </div>

      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} name={name} fields={fields} />
    </div>
  )
}

export default NewForm
