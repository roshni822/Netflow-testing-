// M1 - Phase 2 - FillForm.jsx
// Render a published form by id, validate required fields, POST to
// /api/forms/:id/submit, and surface whether the linked workflow fired.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Camera, CheckCircle2, ClipboardCheck, Clock, FileText, Info, RefreshCw, Save, ShieldCheck, Trash2, Upload, User, Users } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { api, toAbsoluteUrl } from '../utils/api'
import { useUser } from '../utils/auth'
import { formsStore } from '../lib/formsStore'
import { fieldMaxMb, MAX_UPLOAD_MB } from '../utils/uploads'
import { SignaturePad, UploadProgress, CameraCapture, ReferenceUserSelect } from '../components/FormFields'
import { fieldDomId, focusFirstError, isFieldVisible, isSignatureEmpty, stripHiddenValues, validateField } from '../components/formFieldHelpers'
import { limitBanner } from '../lib/limitFeedback'
import { FilePreviewPane } from '../components/FilePreviewPane'
import PdfUploadAutoFill from '../components/PdfUploadAutoFill'

const inputCls =
  'w-full px-3 py-2 text-sm rounded-md border border-line bg-surface text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition'

const inputErrorCls =
  'border-red-400 focus:ring-red-200 focus:border-red-400'

const WIDE_FIELD_TYPES = new Set(['textarea', 'file', 'signature', 'grid', 'camera', 'checkbox', 'radio', 'heading'])

const hasMeaningfulValue = (value) => {
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'boolean') return value
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

const reviewValue = (field, value) => {
  if (!hasMeaningfulValue(value)) return 'Not provided'
  if (field.type === 'signature') return 'Signature provided'
  if (field.type === 'grid') return `${value.length} ${value.length === 1 ? 'row' : 'rows'}`
  if (field.type === 'file' || field.type === 'camera') return value?.name || 'Document attached'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return value.label || value.name || 'Selected'
  return String(value)
}

const approvalPreviewData = (fields, values) => {
  const data = {}
  for (const field of fields || []) {
    const value = values[field.id]
    if (value === undefined || value === null) continue
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      data[field.id] = value
    } else if (Array.isArray(value)) {
      data[field.id] = value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))
        ? value
        : value.length > 0
    } else if (typeof value === 'object') {
      data[field.id] = value.value ?? value.label ?? value.name ?? true
    }
  }
  return data
}

const slaLabel = (hours) => {
  const amount = Number(hours) || 0
  if (amount > 0 && amount % 24 === 0) {
    const days = amount / 24
    return `${days} ${days === 1 ? 'day' : 'days'} SLA`
  }
  return `${amount || 48}h SLA`
}

// Heuristic prefill: match a text field's label to the signed-in user's own
// details so they don't retype their name/email/department every time. The
// exclude-list keeps it from grabbing "Manager name", "Company name", etc.
function buildUserPrefill(fields, me) {
  if (!me) return {}
  const role = me.role?.name
  const seed = {}
  for (const f of fields || []) {
    if (f.type !== 'text') continue
    const l = (f.label || '').toLowerCase()
    let v
    if (/e-?mail/.test(l)) v = me.email
    else if (l.includes('department') || l.includes('dept')) v = me.department
    else if (l.includes('designation') || l.includes('role')) v = role
    else if (
      l.includes('name') &&
      !/(company|manager|supervisor|project|product|brand|supplier|vendor|contact|father|spouse|guardian|account)/.test(l)
    ) v = me.name
    if (v) seed[f.id] = v
  }
  return seed
}

// Uploads the chosen file to /api/uploads and stores { name, url, mime, size }
// as the field value, so the approver can later open the actual attachment.
function FileField({ value, onChange, maxMb = MAX_UPLOAD_MB, onRequestPreview }) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [useCamera, setUseCamera] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const uploadFile = async (file) => {
    if (!file) return
    // Block oversize files up front so the user gets instant feedback instead
    // of waiting for the server to reject the upload.
    if (file.size > maxMb * 1024 * 1024) {
      setUploadError(`File is too large. Max ${maxMb} MB.`)
      onChange('')
      return
    }
    setUploading(true)
    setProgress(0)
    setUploadError('')
    try {
      const { file: saved } = await api.upload(file, maxMb, { onProgress: setProgress })
      onChange(saved)
    } catch (err) {
      // "Storage full" is not the same problem as "that file is too big".
      const limit = limitBanner(err)
      setUploadError(limit ? `${limit.title} — ${limit.message}` : (err.message || 'Upload failed'))
      onChange('')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  const handleFile = async (event) => {
    const input = event.currentTarget
    await uploadFile(input.files?.[0])
    input.value = ''
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragActive(false)
    if (!uploading) uploadFile(event.dataTransfer.files?.[0])
  }

  const current = value && typeof value === 'object' && value.url ? value : null

  if (useCamera) {
    return (
      <div className="space-y-2">
        <CameraCapture
          value={value}
          onChange={(val) => {
            onChange(val)
            if (val) setUseCamera(false)
          }}
          autoStart={true}
          inlineMode={true}
          onCancel={() => setUseCamera(false)}
        />
      </div>
    )
  }

  return (
    <div className="nf-fill-file-field">
      <div className="nf-fill-file-actions">
        <label
          className={`nf-fill-file-drop ${dragActive ? 'is-dragging' : ''} ${uploading ? 'is-disabled' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); if (!uploading) setDragActive(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <input type="file" onChange={handleFile} disabled={uploading} className="sr-only" />
          <span className="nf-fill-file-icon"><Upload aria-hidden="true" /></span>
          <span className="nf-fill-file-copy">
            <strong>{current ? 'Replace document' : 'Drop a file or choose from device'}</strong>
            <small>Maximum file size: {maxMb} MB</small>
          </span>
        </label>
        <button
          type="button"
          onClick={() => setUseCamera(true)}
          disabled={uploading}
          className="nf-button nf-fill-camera-button"
        >
          <Camera aria-hidden="true" />
          Camera
        </button>
      </div>
      {uploading && <UploadProgress percent={progress} />}
      {uploadError && <p className="nf-fill-file-error" role="alert">{uploadError}</p>}
      {current && !uploading && (
        <p className="nf-fill-uploaded-file">
          <span>
            Uploaded:{' '}
            <a href={toAbsoluteUrl(current.url)} target="_blank" rel="noreferrer" className="underline hover:brightness-110">
              {current.name}
            </a>
          </span>
          {onRequestPreview && (current.mime?.startsWith('image/') || current.mime === 'application/pdf' || current.name?.match(/\.(pdf|jpe?g|png|webp|gif)$/i)) && (
            <button
              type="button"
              onClick={() => onRequestPreview(current)}
              className="text-fg-muted hover:text-indigo-600 transition flex items-center gap-1 bg-surface-2 px-2 py-0.5 rounded border border-line"
              title="Preview file"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Preview
            </button>
          )}
        </p>
      )}
    </div>
  )
}

// One editable cell inside a grid/table row, rendered per its column type.
function GridCell({ col, value, onChange, ariaLabel }) {
  const cls =
    'w-full px-2 py-1 text-sm rounded border border-line bg-surface focus:outline-none focus:ring-1 focus:ring-indigo-300'
  switch (col.type) {
    case 'number':
      return <input aria-label={ariaLabel} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
    case 'date':
      return <input aria-label={ariaLabel} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
    case 'dropdown':
      return (
        <select aria-label={ariaLabel} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">—</option>
          {(col.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )
    default:
      return <input aria-label={ariaLabel} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
  }
}

// A table/grid field: fixed columns (set by the form designer), and the
// respondent adds/removes as many rows as needed. Value = array of row objects
// keyed by column id: [{ [colId]: cellValue }, ...].
function GridField({ field, value, onChange }) {
  const cols = field.columns || []
  const rows = Array.isArray(value) ? value : []

  const addRow = () => onChange([...rows, {}])
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i))
  const setCell = (i, colId, v) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [colId]: v } : r)))

  return (
    <div className="nf-fill-grid-field">
      <div className="nf-fill-grid-scroll">
        <table className="nf-fill-grid-table">
          <thead>
            <tr className="bg-surface-2">
              {cols.map((c) => (
                <th scope="col" key={c.id} className="px-2 py-1.5 text-left font-medium text-fg-muted border-b border-line whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="w-8 border-b border-line"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-2 py-3 text-center text-xs text-fg-subtle">
                  No rows yet — click “Add row”.
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.id} className="px-2 py-1 border-b border-line align-top">
                    <GridCell col={c} value={row[c.id]} onChange={(v) => setCell(i, c.id, v)} ariaLabel={`${c.label}, row ${i + 1}`} />
                  </td>
                ))}
                <td className="px-1 py-1 border-b border-line text-center align-top">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    title="Remove row"
                    aria-label={`Remove row ${i + 1}`}
                    className="text-fg-subtle hover:text-danger-fg transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="nf-fill-add-row"
      >
        + Add row
      </button>
    </div>
  )
}

function FieldRow({ field, value, onChange, error, onRequestPreview, confidence, index = 0 }) {
  if (field.type === 'heading') {
    return (
      <div data-field-row={field.id} className="nf-fill-section-heading">
        <h3 className="text-lg font-semibold text-fg">{field.label}</h3>
        {field.placeholder && <p className="text-sm text-fg-muted mt-1">{field.placeholder}</p>}
      </div>
    )
  }

  const cls = `${inputCls} ${error ? inputErrorCls : ''}`
  // Same wiring as the shared FieldRow: the label points at the control and
  // focusFirstError finds it by this id after a failed submit.
  const inputId = fieldDomId(field.id)
  const labelId = `${inputId}-label`
  const errorId = error ? `${inputId}-error` : undefined
  const a11y = {
    id: inputId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': errorId,
  }

  const renderInput = () => {
    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            {...a11y}
            rows={4}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            className={`${cls} resize-y`}
          />
        )
      case 'number':
        return (
          <input
            {...a11y}
            type="number"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            className={cls}
          />
        )
      case 'date':
        return (
          <input
            {...a11y}
            type={field.includeTime ? "datetime-local" : "date"}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={cls}
          />
        )
      case 'dropdown':
        return (
          <select
            {...a11y}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={cls}
          >
            <option value="">— Select —</option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )
      case 'checkbox':
        if (field.options && field.options.length > 0) {
          const selectedValues = Array.isArray(value) ? value : []
          return (
            <div className={field.layout === 'horizontal' ? "flex flex-wrap gap-x-6 gap-y-2" : "space-y-1.5"} role="group" aria-labelledby={labelId}>
              {field.options.map((opt, i) => (
                <label key={opt} className="flex items-center gap-2 text-sm text-fg">
                  <input
                    id={i === 0 ? inputId : undefined}
                    type="checkbox"
                    value={opt}
                    checked={selectedValues.includes(opt)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange([...selectedValues, opt])
                      } else {
                        onChange(selectedValues.filter((v) => v !== opt))
                      }
                    }}
                    className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          )
        }
        return (
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              {...a11y}
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
            />
            <span>{field.placeholder || 'Yes'}</span>
          </label>
        )
      case 'signature':
        return (
          <SignaturePad
            id={inputId}
            onChange={onChange}
          />
        )
      case 'file':
        return <FileField value={value} onChange={onChange} maxMb={fieldMaxMb(field)} onRequestPreview={onRequestPreview} />

      case 'radio':
        return (
          <div className={field.layout === 'horizontal' ? "flex flex-wrap gap-x-6 gap-y-2" : "space-y-1.5"} role="radiogroup" aria-labelledby={labelId} aria-describedby={errorId}>
            {(field.options || []).map((opt, i) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-fg">
                <input
                  id={i === 0 ? inputId : undefined}
                  type="radio"
                  name={field.id}
                  value={opt}
                  checked={value === opt}
                  onChange={(e) => onChange(e.target.value)}
                  className="w-4 h-4 border-line text-indigo-600 focus:ring-indigo-400"
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        )
      case 'camera':
        return <CameraCapture value={value} onChange={onChange} />
      case 'grid':
        return <GridField field={field} value={value} onChange={onChange} />

      case 'repeater':
        return (
          <div className="text-xs text-fg-muted italic">
            Repeater fields aren&apos;t supported in this view.
          </div>
        )
      case 'text':
      default:
        if (field.referenceUser) {
          return (
            <ReferenceUserSelect
              a11y={a11y}
              value={value ?? ''}
              onChange={(val) => onChange(val)}
              placeholder={field.placeholder || 'Search users...'}
              className={cls}
            />
          )
        }
        return (
          <input
            {...a11y}
            type="text"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            className={cls}
          />
        )
    }
  }

  return (
    <div data-field-row={field.id} className={`nf-fill-field ${WIDE_FIELD_TYPES.has(field.type) || index === 0 ? 'nf-fill-field-wide' : ''}`}>
      <label id={labelId} htmlFor={inputId} className="nf-fill-label">
        {field.label}
        {field.required && <span className="text-danger-fg ml-0.5" aria-hidden="true">*</span>}
        {confidence && (
          <span className="ml-2 inline-flex rounded-full border border-line bg-surface-2 px-2 py-0.5 align-middle text-[10px] font-semibold text-fg-muted" aria-label={'Auto-fill confidence ' + confidence.confidence + ' percent'}>
            {confidence.confidence}% {confidence.tier}
          </span>
        )}
        {field.required && <span className="sr-only"> (required)</span>}
      </label>
      {renderInput()}
      {error && <p id={errorId} role="alert" className="nf-fill-field-error">{error}</p>}
    </div>
  )
}

function FillProgress({ steps, activeIndex }) {
  return (
    <div className="nf-fill-progress">
      <ol className="nf-fill-steps" aria-label="Form progress">
        {steps.map((label, index) => {
          const complete = index < activeIndex
          const current = index === activeIndex
          return (
            <li key={`${label}-${index}`} className={`${complete ? 'is-complete' : ''} ${current ? 'is-current' : ''}`} aria-current={current ? 'step' : undefined}>
              <span className="nf-fill-step-marker" aria-hidden="true">{complete ? '✓' : index + 1}</span>
              <span className="nf-fill-step-label">{label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const pageLabel = (fields, index, total) => {
  const heading = fields.find((field) => field.type === 'heading')?.label?.trim()
  if (heading) return heading
  if (total === 1) return 'Request'
  if (index === 0) return 'Request'
  return total === 2 ? 'Details' : `Details ${index}`
}

function ValidationSummary({ errors, fields, summaryRef }) {
  const items = fields.filter((field) => errors[field.id])
  if (items.length < 2) return null
  return (
    <div ref={summaryRef} className="nf-fill-error-summary" role="alert" tabIndex={-1} aria-labelledby="fill-error-summary-title">
      <strong id="fill-error-summary-title">Check {items.length} fields before continuing</strong>
      <ul>
        {items.map((field) => (
          <li key={field.id}>
            <a href={`#${fieldDomId(field.id)}`}>{errors[field.id]}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ReviewRequest({ pages, values, labels, onEdit }) {
  return (
    <section className="nf-fill-review" aria-labelledby="fill-review-title">
      <div className="nf-fill-review-intro">
        <span className="nf-fill-review-icon"><ClipboardCheck aria-hidden="true" /></span>
        <div>
          <h2 id="fill-review-title">Review your request</h2>
          <p>Confirm the information below before submitting it.</p>
        </div>
      </div>
      <div className="nf-fill-review-sections">
        {pages.map((fields, pageIndex) => {
          const reviewFields = fields.filter((field) => !['heading', 'page_break', 'repeater'].includes(field.type))
          if (!reviewFields.length) return null
          return (
            <section key={pageIndex} className="nf-fill-review-section">
              <header>
                <h3>{labels[pageIndex]}</h3>
                <button type="button" onClick={() => onEdit(pageIndex)}>Edit</button>
              </header>
              <dl>
                {reviewFields.map((field) => (
                  <div key={field.id}>
                    <dt>{field.label}</dt>
                    <dd className={!hasMeaningfulValue(values[field.id]) ? 'is-empty' : ''}>{reviewValue(field, values[field.id])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>
    </section>
  )
}

function DraftProtection({ state, message }) {
  return (
    <section className="nf-fill-draft-card" aria-label="Draft protection">
      <Info aria-hidden="true" />
      <div>
        <h2>Draft protection</h2>
        <strong>{state}</strong>
        <p>{message}</p>
      </div>
    </section>
  )
}

const approvalSummaryLabel = (summary = {}) => {
  const parts = []
  const approvals = Number(summary.approvalsRequired) || 0
  const reviews = Number(summary.reviewStages) || 0
  if (approvals > 0) parts.push(`${approvals} ${approvals === 1 ? 'approval' : 'approvals'} required`)
  if (reviews > 0) parts.push(`${reviews} ${reviews === 1 ? 'review' : 'reviews'}`)
  return parts.join(' · ') || 'No approval required'
}

function ApprovalRoute({ route, loading, error, open, onToggle, onRetry }) {
  const hasRoute = route && route.linked
  const stages = route?.stages || []
  const issues = route?.issues || []
  return (
    <section className="nf-fill-next-card" aria-labelledby="fill-next-title">
      <header>
        <div>
          <h2 id="fill-next-title">What's Next</h2>
        </div>
        <button type="button" className="nf-fill-next-toggle" aria-expanded={open} aria-controls="fill-next-content" onClick={onToggle}>
          {open ? 'Hide' : 'Show'}
        </button>
      </header>
      <div id="fill-next-content" className={`nf-fill-next-content ${open ? 'is-open' : ''}`} aria-live="polite">
        {loading && !route && (
          <div className="nf-fill-route-skeleton" aria-label="Loading approval route">
            <span /><span /><span />
          </div>
        )}

        {error && !route && (
          <div className="nf-fill-route-state is-error">
            <AlertCircle aria-hidden="true" />
            <strong>Approval route unavailable</strong>
            <p>We couldn&apos;t verify the approval route. Try again before submitting this request.</p>
            <button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" /> Retry</button>
          </div>
        )}

        {!loading && !error && route && !route.linked && (
          <div className="nf-fill-route-alert is-warning" role="status">
            <Info aria-hidden="true" />
            <div>
              <strong>No approval workflow linked</strong>
              <p>{issues[0]?.message || 'This request will be recorded without an automatic approval route.'}</p>
            </div>
          </div>
        )}

        {hasRoute && (
          <>
            <div className="nf-fill-route-summary">
              <strong>{approvalSummaryLabel(route.summary)}</strong>
              {loading && <em><RefreshCw aria-hidden="true" /> Updating</em>}
            </div>

            {issues.map((issue) => (
              <div
                key={`${issue.code}-${issue.nodeId || 'route'}`}
                className={`nf-fill-route-alert ${issue.severity === 'error' ? 'is-error' : 'is-warning'}`}
                role={issue.severity === 'error' ? 'alert' : 'status'}
              >
                {issue.severity === 'error'
                  ? <AlertCircle aria-hidden="true" />
                  : <Info aria-hidden="true" />}
                <div>
                  <strong>{issue.title}</strong>
                  <p>{issue.message}</p>
                </div>
              </div>
            ))}

            {!route.automatic && (
              <div className="nf-fill-route-notice">
                <Info aria-hidden="true" />
                <span>This workflow is configured for manual start.</span>
              </div>
            )}

            {route.confirmation !== 'confirmed' && route.confirmation !== 'invalid' && (
              <div className={`nf-fill-route-notice ${route.confirmation === 'invalid' ? 'is-error' : ''}`}>
                <Info aria-hidden="true" />
                <span>{route.message || 'The remaining route will be confirmed later.'}</span>
              </div>
            )}

            {error && (
              <div className="nf-fill-route-notice is-error">
                <AlertCircle aria-hidden="true" />
                <span>Could not refresh the route. Showing the last confirmed result.</span>
                <button type="button" onClick={onRetry}>Retry</button>
              </div>
            )}

            {stages.length > 0 ? (
              <ol className="nf-fill-route-list">
                {stages.map((stage, index) => {
                  const person = stage.approver
                  const people = stage.approvers || []
                  const roleAndDepartment = [person?.role || stage.configuredRole, person?.department || stage.department]
                    .filter(Boolean)
                    .filter((value, itemIndex, list) => list.indexOf(value) === itemIndex)
                    .join(' · ')
                  return (
                    <li key={stage.nodeId} className={stage.status === 'unconfigured' ? 'is-unconfigured' : undefined}>
                      <span className="nf-fill-route-index" aria-hidden="true">{index + 1}</span>
                      <div className="nf-fill-route-stage">
                        <div className="nf-fill-route-stage-title">
                          {stage.kind === 'multiApproval' ? <Users aria-hidden="true" /> : <User aria-hidden="true" />}
                          <strong>{stage.title}</strong>
                        </div>
                        {stage.kind === 'multiApproval' ? (
                          <>
                            <p>{people.length ? people.map((item) => item.name).join(', ') : 'Approvers not configured'}</p>
                            <span>
                              {stage.quorum?.total
                                ? `${stage.quorum.required} of ${stage.quorum.total} approvers required`
                                : 'No active committee approvers'}
                            </span>
                          </>
                        ) : (
                          <>
                            <p>{person?.name || stage.configuredRole || 'Approver not configured'}</p>
                            {roleAndDepartment && <span>{roleAndDepartment}</span>}
                          </>
                        )}
                      </div>
                      <span className="nf-fill-route-sla"><Clock aria-hidden="true" /> {slaLabel(stage.slaHours)}</span>
                    </li>
                  )
                })}
              </ol>
            ) : route.confirmation === 'confirmed' ? (
              <div className="nf-fill-route-state is-compact">
                <CheckCircle2 aria-hidden="true" />
                <strong>No approval required</strong>
                <p>The linked workflow has no approval or review stages on this route.</p>
              </div>
            ) : null}

          </>
        )}
      </div>
    </section>
  )
}

function FillForm() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [values, setValues] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [pdfExtraction, setPdfExtraction] = useState(null)
  const [confidenceScores, setConfidenceScores] = useState({})
  const [reviewing, setReviewing] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [nextStepsOpen, setNextStepsOpen] = useState(false)
  const [approvalRoute, setApprovalRoute] = useState(null)
  const [approvalRouteLoading, setApprovalRouteLoading] = useState(true)
  const [approvalRouteError, setApprovalRouteError] = useState('')
  const [approvalRouteRefresh, setApprovalRouteRefresh] = useState(0)

  const [draftRestored, setDraftRestored] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState(null)
  const [draftError, setDraftError] = useState('')

  const me = useUser()
  const errorSummaryRef = useRef(null)
  const approvalRouteRequest = useRef(0)

  const availableDocs = useMemo(() => {
    const docs = []
    if (!form?.fields) return docs
    for (const f of form.fields) {
      const v = values[f.id]
      if (v && typeof v === 'object' && v.url && (v.mime?.startsWith('image/') || v.mime === 'application/pdf' || v.name?.match(/\.(pdf|jpe?g|png|webp|gif)$/i))) {
        docs.push({ ...v, fieldLabel: f.label })
      }
    }
    return docs
  }, [form, values])

  const routePreviewData = useMemo(
    () => approvalPreviewData(form?.fields, values),
    [form, values]
  )

  useEffect(() => {
    let cancelled = false
    api.get(`/api/forms/${id}`)
      .then((data) => {
        if (cancelled) return
        setForm(data.form)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err.message || 'Failed to load form')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id])

  // Auto-fill fields that look like the signed-in user's own details. Runs once
  // when the form + user are ready, and never overwrites anything already typed.
  useEffect(() => {
    if (!form || !me) return
    const seed = buildUserPrefill(form.fields || [], me)
    if (!Object.keys(seed).length) return
    const timer = window.setTimeout(() => setValues((prev) => ({ ...seed, ...prev })), 0)
    return () => window.clearTimeout(timer)
  }, [form, me])

  // Restore a previously saved draft once the form is loaded. Draft values are
  // merged OVER anything already present (prefill), so a saved draft wins. The
  // prefill effect above also keeps existing values ahead of its seed, so the
  // two effects can run in either order and the draft still takes precedence.
  useEffect(() => {
    if (!form) return
    let cancelled = false
    formsStore.getDraft(id)
      .then((res) => {
        const data = res?.draft?.formData
        if (cancelled || !data || typeof data !== 'object' || Object.keys(data).length === 0) return
        setValues((prev) => ({ ...prev, ...data }))
        setDraftRestored(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [form, id])

  useEffect(() => {
    if (!form || form.status !== 'published') return
    const requestId = ++approvalRouteRequest.current
    const timer = window.setTimeout(() => {
      setApprovalRouteLoading(true)
      setApprovalRouteError('')
      formsStore.previewApprovalRoute(id, routePreviewData)
        .then((data) => {
          if (approvalRouteRequest.current !== requestId) return
          const nextRoute = data?.approvalRoute || null
          setApprovalRoute(nextRoute)
          if ((nextRoute?.issues || []).length > 0) setNextStepsOpen(true)
        })
        .catch((error) => {
          if (approvalRouteRequest.current !== requestId) return
          setApprovalRouteError(error.message || 'Could not load the approval route.')
        })
        .finally(() => {
          if (approvalRouteRequest.current === requestId) setApprovalRouteLoading(false)
        })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [form, id, routePreviewData, approvalRouteRefresh])

  const blockingRouteIssues = (approvalRoute?.issues || [])
    .filter((issue) => issue.severity === 'error')
  const approvalRouteBlocked = approvalRoute?.canSubmit === false
  const blockingRouteLabel = blockingRouteIssues
    .map((issue) => issue.title)
    .filter(Boolean)
    .join(', ')

  // Recomputes on every value change so conditional show/hide rules (and chained
  // rules) resolve live as the user answers dependent fields.
  const visibleFields = useMemo(() => {
    if (!form?.fields) return []
    return form.fields.filter((f) => f.type !== 'repeater' && isFieldVisible(f, values))
  }, [form, values])

  const pages = useMemo(() => {
    const maxPage = visibleFields.reduce((max, f) => Math.max(max, f.page || 1), 1)
    const p = []
    for (let i = 1; i <= maxPage; i++) {
      const pageFields = visibleFields.filter(f => (f.page || 1) === i)
      if (pageFields.length > 0) p.push(pageFields)
    }
    if (p.length === 0) p.push([])
    return p
  }, [visibleFields])

  const [currentPage, setCurrentPage] = useState(0)
  useEffect(() => {
    if (currentPage < pages.length) return
    const timer = window.setTimeout(() => setCurrentPage(Math.max(0, pages.length - 1)), 0)
    return () => window.clearTimeout(timer)
  }, [pages.length, currentPage])

  const pageLabels = useMemo(
    () => pages.map((pageFields, index) => pageLabel(pageFields, index, pages.length)),
    [pages]
  )
  const progressSteps = useMemo(() => [...pageLabels, 'Review'], [pageLabels])
  const hasAnswers = useMemo(() => Object.values(values).some(hasMeaningfulValue), [values])
  const draftState = savingDraft
    ? { state: 'Saving draft…', message: 'Your answers are being saved.' }
    : draftSavedAt
      ? { state: `Saved at ${new Date(draftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, message: 'You can safely return and continue later.' }
      : draftRestored
        ? { state: 'Draft restored', message: 'Your previously saved answers are ready to continue.' }
        : hasAnswers
          ? { state: 'Unsaved changes', message: 'Save a draft before leaving to keep these answers.' }
          : { state: 'Not saved yet', message: 'Save a draft to return and continue later.' }

  const setFieldValue = (fieldId, v) => {
    setValues((prev) => ({ ...prev, [fieldId]: v }))
    setConfidenceScores((previous) => {
      if (!previous[fieldId]) return previous
      const next = { ...previous }
      delete next[fieldId]
      return next
    })
    setFieldErrors((prev) => (prev[fieldId] ? { ...prev, [fieldId]: '' } : prev))
    setSubmitError('')
    if (draftSavedAt) setDraftSavedAt(null)

    // Feature: File Preview Split Screen
    if (v && typeof v === 'object' && v.url && (v.mime?.startsWith('image/') || v.mime === 'application/pdf')) {
      setPreviewFile(v)
    }
  }


  const applyPdfSuggestion = (suggestion) => {
    const field = form?.fields?.find((candidate) => candidate.id === suggestion.fieldId)
    if (!field) return
    setValues((previous) => {
      const current = previous[suggestion.fieldId]
      const occupied = current !== undefined && current !== null && current !== '' && (!Array.isArray(current) || current.length > 0)
      if (occupied || !isFieldVisible(field, previous)) return previous
      setConfidenceScores((scores) => ({ ...scores, [suggestion.fieldId]: suggestion }))
      return { ...previous, [suggestion.fieldId]: suggestion.value }
    })
  }

  const validate = (fieldsToValidate) => {
    const errs = {}
    for (const f of fieldsToValidate) {
      const v = values[f.id]
      if (f.required) {
        if (f.type === 'grid') {
          const rows = Array.isArray(v) ? v : []
          const cols = f.columns || []
          const cellEmpty = (cell) => cell === undefined || cell === null || String(cell).trim() === ''
          if (rows.length === 0) {
            errs[f.id] = `${f.label} needs at least one row`
          } else if (rows.some((r) => cols.some((c) => cellEmpty(r[c.id])))) {
            errs[f.id] = `Fill every cell in ${f.label}`
          }
          continue
        }
          const isEmpty = f.type === 'signature'
          ? isSignatureEmpty(v)
          : (
            v === undefined ||
            v === null ||
            v === '' ||
            (f.type === 'checkbox' && f.options && f.options.length > 0 && (!Array.isArray(v) || v.length === 0)) ||
            (f.type === 'checkbox' && (!f.options || f.options.length === 0) && v === false)
          )
        if (isEmpty) {
          errs[f.id] = `${f.label} is required`
          continue
        }
      }
      // Advanced rules (length/range/pattern) apply to filled fields, required or not.
      const adv = validateField(f, v)
      if (adv) errs[f.id] = adv
    }
    return errs
  }

  const focusValidationFeedback = (fieldsToValidate, errs) => {
    window.setTimeout(() => {
      if (Object.keys(errs).length > 1 && errorSummaryRef.current) {
        errorSummaryRef.current.focus()
      } else {
        focusFirstError(fieldsToValidate, errs)
      }
    }, 0)
  }

  const handleNext = () => {
    setSubmitError('')
    const currentFields = pages[currentPage] || []
    const errs = validate(currentFields)
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      focusValidationFeedback(currentFields, errs)
      return
    }
    if (currentPage < pages.length - 1) {
      setCurrentPage((page) => page + 1)
    } else {
      setReviewing(true)
    }
  }

  const handlePrev = () => {
    setSubmitError('')
    if (reviewing) {
      setReviewing(false)
      setCurrentPage(Math.max(0, pages.length - 1))
      return
    }
    setCurrentPage((page) => Math.max(0, page - 1))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError('')

    if (!reviewing) {
      handleNext()
      return
    }

    const errs = validate(visibleFields.filter(f => f.type !== 'page_break'))
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      const errPageIdx = pages.findIndex(p => p.some(f => errs[f.id]))
      if (errPageIdx !== -1) {
        setReviewing(false)
        setCurrentPage(errPageIdx)
        focusValidationFeedback(pages[errPageIdx], errs)
      } else {
        focusValidationFeedback(pages[currentPage], errs)
      }
      return
    }

    if (pdfExtraction?.jobId && pdfExtraction.reviewConfirmed !== true) {
      setReviewing(false)
      setCurrentPage(0)
      setSubmitError('Review and confirm the PDF auto-filled information before submitting.')
      return
    }

    if (approvalRouteBlocked) {
      setSubmitError('Submission is unavailable until every approval step has an active approver.')
      return
    }

    setSubmitting(true)
    try {
      // Only submit currently-visible fields — a value entered then hidden by a
      // rule change must not leak into the response.
      const payload = stripHiddenValues(visibleFields, values)
      const uploadedPayload = await api.uploadPendingFiles(payload)
      const data = await formsStore.submit(id, uploadedPayload, pdfExtraction)
      // The server clears the draft on submit; reflect that locally too.
      setDraftRestored(false)
      setResult(data)
    } catch (err) {
      // A refused submission is usually the workspace being out of allowance or
      // read-only, not a bad form — say which, and keep the answers on screen.
      const limit = limitBanner(err)
      setSubmitError(limit ? `${limit.title} — ${limit.message}` : (err.message || 'Submission failed'))
    } finally {
      setSubmitting(false)
    }
  }

  // Save the raw current values (not stripped) so text typed into a field that
  // is temporarily hidden by a conditional rule isn't lost. No validation gate:
  // a draft is allowed to be incomplete.
  const handleSaveDraft = async () => {
    setDraftError('')
    setSavingDraft(true)
    try {
      await formsStore.saveDraft(id, values)
      setDraftSavedAt(Date.now())
      setDraftRestored(false)
    } catch (err) {
      setDraftError(err.message || 'Could not save draft')
    } finally {
      setSavingDraft(false)
    }
  }

  const handleDiscardDraft = async () => {
    try {
      await formsStore.discardDraft(id)
    } catch {
      // ignore — clearing the local form is what the user sees anyway
    }
    setValues({})
    setFieldErrors({})
    setSubmitError('')
    setConfidenceScores({})
    setPdfExtraction(null)
    setPreviewFile(null)
    setDraftRestored(false)
    setDraftSavedAt(null)
    setReviewing(false)
    setCurrentPage(0)
  }

  const confirmDiscard = async () => {
    await handleDiscardDraft()
    setDiscardOpen(false)
  }

  // ---------- render states ----------

  if (loading) {
    return (
      <AppShell title="Loading form…">
        <div className="nf-fill-state-page" aria-label="Loading form">
          <div className="nf-fill-loading-card">
            <span className="nf-fill-skeleton is-title" />
            <span className="nf-fill-skeleton is-copy" />
            <span className="nf-fill-skeleton is-field" />
            <span className="nf-fill-skeleton is-field" />
            <span className="nf-fill-skeleton is-field" />
          </div>
        </div>
      </AppShell>
    )
  }

  if (loadError || !form) {
    return (
      <AppShell title="Form unavailable" back={{ to: '/forms', label: 'Back to forms' }}>
        <div className="nf-fill-state-card">
          <span className="nf-fill-state-icon"><FileText aria-hidden="true" /></span>
          <h2>We couldn&apos;t open this form</h2>
          <p>{loadError || 'The form could not be found.'}</p>
          <div className="nf-fill-state-actions">
            <Link to="/forms" className="nf-button">Back to forms</Link>
            <button type="button" className="nf-button nf-button-primary" onClick={() => window.location.reload()}>Try again</button>
          </div>
        </div>
      </AppShell>
    )
  }

  if (form.status !== 'published') {
    return (
      <AppShell title={form.title} back={{ to: '/forms', label: 'Back to forms' }}>
        <div className="nf-fill-state-card">
          <span className="nf-fill-state-icon"><FileText aria-hidden="true" /></span>
          <h2>This form isn&apos;t published yet</h2>
          <p>
            An admin needs to publish &ldquo;{form.title}&rdquo; before it can accept submissions.
          </p>
          <div className="nf-fill-state-actions"><Link to="/forms" className="nf-button nf-button-primary">Back to forms</Link></div>
        </div>
      </AppShell>
    )
  }

  if (result) {
    return (
      <AppShell title={form.title} back={{ to: '/forms', label: 'Back to forms' }}>
        <div className="nf-fill-state-card nf-fill-success-card">
          <span className="nf-fill-state-icon is-success"><CheckCircle2 aria-hidden="true" /></span>
          <h2>Request submitted</h2>
          <p>Your response was recorded successfully.</p>

          {result.workflowTriggered ? (
            <div className="nf-fill-result-note is-workflow">
              Approval workflow started. The first approver has been notified
              and the task is now in their inbox.
            </div>
          ) : (
            <div className="nf-fill-result-note is-manual">
              No published workflow is linked to this form, so no approval
              task was created.
            </div>
          )}

          <div className="nf-fill-state-actions">
            <Link to="/forms" className="nf-button">Back to forms</Link>
            <Link to="/tasks" className="nf-button nf-button-primary">View my requests</Link>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title={form.title}
      subtitle={form.description || 'Complete the required details. You can save a draft and return later.'}
      back={{ to: '/forms', label: 'Back to forms' }}
      actions={(
        <div className="nf-fill-header-actions">
          <button type="button" className="nf-button" onClick={handleSaveDraft} disabled={savingDraft || visibleFields.length === 0}>
            <Save aria-hidden="true" />
            {savingDraft ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" className="nf-fill-discard-button" onClick={() => setDiscardOpen(true)} disabled={!hasAnswers && !draftRestored}>
            Discard
          </button>
        </div>
      )}
    >
      <div className="nf-fill-page">
        <div className={`nf-fill-layout ${previewFile ? 'has-preview' : ''}`}>
          <form onSubmit={handleSubmit} noValidate className="nf-fill-card" aria-busy={submitting || savingDraft}>
            <FillProgress
              steps={progressSteps}
              activeIndex={reviewing ? pages.length : currentPage}
            />

            {draftRestored && (
              <div className="nf-fill-restored-banner" role="status">
                <ShieldCheck aria-hidden="true" />
                <span>We restored your saved draft. Pick up where you left off.</span>
                <button type="button" onClick={() => setDiscardOpen(true)}>Discard draft</button>
              </div>
            )}

            {!reviewing && currentPage === 0 && form.autoFill?.enabled === true && (
              <div className="nf-fill-document-assist">
                <PdfUploadAutoFill
                  formId={id}
                  languageMode={form.autoFill?.languageMode}
                  fields={form.fields || []}
                  values={values}
                  onApply={applyPdfSuggestion}
                  onExtractionChange={setPdfExtraction}
                />
              </div>
            )}

            {!reviewing && visibleFields.length === 0 && (
              <div className="nf-fill-empty-fields">
                <FileText aria-hidden="true" />
                <h2>This form has no fields to fill</h2>
                <p>An admin needs to add fields to &ldquo;{form.title}&rdquo; before it can accept submissions.</p>
                <Link to="/forms" className="nf-button">Back to forms</Link>
              </div>
            )}

            {!reviewing && visibleFields.length > 0 && (
              <div className="nf-fill-form-body">
                <p className="nf-fill-required-legend">Required fields are marked <span aria-hidden="true">*</span></p>
                <ValidationSummary errors={fieldErrors} fields={pages[currentPage] || []} summaryRef={errorSummaryRef} />
                <div className="nf-fill-fields">
                  {pages[currentPage]?.map((field, index) => (
                    <FieldRow
                      key={field.id}
                      index={index}
                      confidence={confidenceScores[field.id]}
                      field={field}
                      value={values[field.id]}
                      onChange={(value) => setFieldValue(field.id, value)}
                      error={fieldErrors[field.id]}
                      onRequestPreview={(file) => setPreviewFile(file)}
                    />
                  ))}
                </div>
              </div>
            )}

            {reviewing && (
              <ReviewRequest
                pages={pages}
                values={values}
                labels={pageLabels}
                onEdit={(page) => { setCurrentPage(page); setReviewing(false) }}
              />
            )}

            {reviewing && approvalRouteBlocked && (
              <div id="nf-fill-route-blocked" className="nf-fill-route-blocked" role="alert">
                <AlertCircle aria-hidden="true" />
                <div>
                  <strong>Submission unavailable</strong>
                  <p>
                    {blockingRouteLabel
                      ? `Configure an approver for: ${blockingRouteLabel}.`
                      : 'Every approval step needs an active approver before this request can be submitted.'}
                  </p>
                </div>
              </div>
            )}
            {submitError && <div className="nf-fill-submit-error" role="alert">{submitError}</div>}
            {draftError && <p className="nf-fill-draft-error" role="alert">{draftError}</p>}

            <footer className="nf-fill-actions">
              <div className="nf-fill-actions-start">
                {reviewing || currentPage > 0 ? (
                  <button type="button" className="nf-button" onClick={handlePrev}>
                    <ArrowLeft aria-hidden="true" />
                    {reviewing ? 'Back to edit' : 'Previous'}
                  </button>
                ) : (
                  <button type="button" className="nf-button nf-fill-cancel" onClick={() => navigate('/forms')}>Cancel</button>
                )}
                {draftSavedAt && !savingDraft && <span className="nf-fill-saved-status"><CheckCircle2 aria-hidden="true" /> Draft saved</span>}
              </div>
              <div className="nf-fill-actions-end">
                <button type="button" className="nf-button nf-fill-save-button" onClick={handleSaveDraft} disabled={savingDraft || visibleFields.length === 0}>
                  {savingDraft ? 'Saving…' : 'Save as draft'}
                </button>
                <button
                  type="submit"
                  className="nf-button nf-button-primary nf-fill-primary-action"
                  disabled={submitting || visibleFields.length === 0 || (reviewing && approvalRouteBlocked)}
                  aria-describedby={reviewing && approvalRouteBlocked ? 'nf-fill-route-blocked' : undefined}
                  title={reviewing && approvalRouteBlocked ? 'An approval step needs an active approver.' : undefined}
                >
                  {reviewing
                    ? (submitting ? 'Submitting…' : 'Submit request')
                    : currentPage < pages.length - 1
                      ? 'Next'
                      : 'Continue to review'}
                  {!submitting && <ArrowRight aria-hidden="true" />}
                </button>
              </div>
            </footer>
          </form>

          <aside className="nf-fill-side" aria-label="Form guidance">
            {previewFile ? (
              <div className="nf-fill-preview-pane">
                <FilePreviewPane
                  file={previewFile}
                  onClose={() => setPreviewFile(null)}
                  availableDocs={availableDocs}
                  onSelect={(file) => setPreviewFile(file)}
                />
              </div>
            ) : (
              <>
                <DraftProtection state={draftState.state} message={draftState.message} />
                <ApprovalRoute
                  route={approvalRoute}
                  loading={approvalRouteLoading}
                  error={approvalRouteError}
                  open={nextStepsOpen}
                  onToggle={() => setNextStepsOpen((open) => !open)}
                  onRetry={() => setApprovalRouteRefresh((value) => value + 1)}
                />
              </>
            )}
          </aside>
        </div>

        {discardOpen && (
          <Modal onClose={() => setDiscardOpen(false)} title="Discard this draft?" description="Your current answers will be cleared and cannot be recovered unless they were saved elsewhere.">
            <div className="nf-fill-discard-actions">
              <button type="button" className="nf-button" onClick={() => setDiscardOpen(false)}>Keep editing</button>
              <button type="button" className="nf-button nf-fill-danger-button" onClick={confirmDiscard}>
                <Trash2 aria-hidden="true" />
                Discard answers
              </button>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  )
}

export default FillForm
