// M3 - Phase 2 - TaskDetail.jsx - Live task + approve/reject/request-changes

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { tasksStore, useTask } from '../lib/tasksStore'
import { useUser } from '../utils/auth'
import { api, toAbsoluteUrl } from '../utils/api'
import { isApprover } from '../utils/permissions'
import { SignaturePad, SignatureMark, FieldRow, FieldValueView } from '../components/FormFields'
import { validateFields, isFieldVisible, stripHiddenValues } from '../components/formFieldHelpers'
import { confirm } from '../lib/confirmStore'
import { ListRowSkeleton } from '../components/Skeleton'
import { ErrorState } from '../components/Alert'
import { formatDateTime, isoAttr } from '../utils/datetime'

const statusPill = (status) => {
  switch (status) {
    case 'Approved':  return { label: 'Approved',  cls: 'text-success-fg' }
    case 'Rejected':  return { label: 'Rejected',  cls: 'text-danger-fg' }
    case 'Escalated': return { label: 'Escalated', cls: 'text-warning-fg' }
    default:          return { label: 'Awaiting approval', cls: 'text-blue-600' }
  }
}

const statusTone = (status) => {
  switch (status) {
    case 'Approved': return 'is-approved'
    case 'Rejected': return 'is-rejected'
    case 'Escalated': return 'is-escalated'
    default: return 'is-pending'
  }
}

function StatusBadge({ status }) {
  const pill = statusPill(status)
  return (
    <span className={'nf-task-status ' + statusTone(status)}>
      <span aria-hidden="true" />
      {pill.label}
    </span>
  )
}

// The submission/request status reflects the WHOLE approval chain, not the
// single stage being viewed. A request is only "Approved" once EVERY required
// stage is approved; while any stage is still pending/escalated it's awaiting
// approval, and any rejection makes the whole request "Rejected".
const requestStatus = (task) => {
  const chain = task.approvalChain || []
  const summary = task.approvalSummary

  // Any rejection (in the chain or on this task) rejects the whole request.
  if (task.status === 'Rejected' || chain.some((s) => s.status === 'rejected')) return 'Rejected'

  // Prefer the "X of Y approved" summary — the most reliable completeness signal
  // ("1 of 2 approved" must read as awaiting, not approved).
  if (summary && Number(summary.required) > 0) {
    return Number(summary.approved) >= Number(summary.required) ? 'Approved' : 'Pending'
  }

  // Fallbacks when no summary is attached.
  if (chain.length > 0) return chain.every((s) => s.status === 'approved') ? 'Approved' : 'Pending'
  return task.status
}

// Read-only render of a submitted grid/table value (columns + rows).
function GridValueTable({ grid }) {
  const cols = grid?.columns || []
  const rows = Array.isArray(grid?.rows) ? grid.rows : []
  if (cols.length === 0) return <span className="text-fg-subtle">—</span>
  return (
    <div className="nf-task-grid-value">
      <table>
        <thead>
          <tr className="bg-surface-2">
            {cols.map((c) => (
              <th scope="col" key={c.id}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="is-empty">No rows</td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.id}>
                    {r?.[c.id] === undefined || r?.[c.id] === '' ? '—' : String(r[c.id])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function TaskSummary({ task }) {
  const status = requestStatus(task)
  const facts = [
    { label: 'Requester', value: task.requester },
    { label: 'Department', value: task.department },
    { label: 'Submitted', value: formatDateTime(task.createdAt), time: task.createdAt },
    { label: 'Last updated', value: formatDateTime(task.updatedAt), time: task.updatedAt },
  ]

  return (
    <section className="nf-task-summary" aria-label="Request summary">
      <div className={'nf-task-summary-mark ' + statusTone(status)} aria-hidden="true">
        {status === 'Approved' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
          </svg>
        ) : status === 'Rejected' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="m7 7 10 10M17 7 7 17" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        )}
      </div>
      <div className="nf-task-summary-state">
        <span>Request status</span>
        <StatusBadge status={status} />
      </div>
      <dl className="nf-task-summary-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.time
                ? <time dateTime={isoAttr(fact.time)}>{fact.value || '—'}</time>
                : (fact.value || '—')}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SubmissionValue({ row }) {
  if (row.grid) return <GridValueTable grid={row.grid} />
  if (row.href) {
    return (
      <a href={toAbsoluteUrl(row.href)} target="_blank" rel="noreferrer" className="nf-task-file-link">
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M9 15h6m-6 3h4" />
          </svg>
        </span>
        <span><strong>{row.value || 'Attachment'}</strong><small>Open attachment</small></span>
        <svg className="nf-task-file-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7m-7 0h7v7" />
        </svg>
      </a>
    )
  }
  if (row.isCamera) {
    return row.url ? (
      <a href={toAbsoluteUrl(row.url)} target="_blank" rel="noreferrer" className="nf-task-file-link">
        <span aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h3l1.5-2h7L17 7h3v12H4Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          </svg>
        </span>
        <span><strong>{row.value || 'Photo'}</strong><small>View image</small></span>
        <svg className="nf-task-file-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7m-7 0h7v7" />
        </svg>
      </a>
    ) : <span>{row.value}</span>
  }
  if (row.isSignature) return <SignatureMark signature={row.value} />
  return row.value || <span className="text-fg-subtle">—</span>
}

function SubmissionDetails({ task }) {
  const rows = task.submission.filter((row) => row.label !== 'Submitted by' && row.label !== 'Department')
  return (
    <section className="nf-task-card nf-task-request-card">
      <header className="nf-task-card-header">
        <div>
          <span className="nf-task-section-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 3h8l4 4v14H4V3Zm8 0v5h5M8 13h8M8 17h6" />
            </svg>
          </span>
          <div>
            <h2>Request information</h2>
            <p>Details provided when this request was submitted.</p>
          </div>
        </div>
        <span className="nf-task-field-count">{rows.length} field{rows.length === 1 ? '' : 's'}</span>
      </header>

      {task.hasUnavailableLabels && (
        <div className="nf-task-legacy-notice" role="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.7 2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.7a2 2 0 0 0-3.4 0Z" />
          </svg>
          <div>
            <strong>Some original field labels are unavailable</strong>
            <p>The source form no longer exists. The values below are shown exactly as they were submitted.</p>
          </div>
        </div>
      )}

      <div className="nf-task-card-body">
        {rows.length === 0 ? (
          <div className="nf-task-empty-inline">No form data is attached to this request.</div>
        ) : (
          <dl className="nf-task-detail-grid">
            {rows.map((row, i) => {
              const longValue = row.grid || row.href || row.isCamera || row.isSignature || String(row.value || '').length > 72
              return (
                <div
                  key={row.label + '-' + i}
                  className={(longValue ? 'is-wide ' : '') + (row.isUnlabelled ? 'is-legacy' : '')}
                  title={row.isUnlabelled && row.fieldRef ? 'Original field reference: ' + row.fieldRef : undefined}
                >
                  <dt>
                    {row.label}
                    {row.isUnlabelled && <span>Legacy field</span>}
                  </dt>
                  <dd><SubmissionValue row={row} /></dd>
                </div>
              )
            })}
          </dl>
        )}
      </div>
    </section>
  )
}

function ApprovalActions({ task, onAction, commentRef, busy, error }) {
  const [comment, setComment] = useState('')
  const [signature, setSignature] = useState(null)
  const [localErr, setLocalErr] = useState('')
  const isResolved = task.status !== 'Pending'
  const needsSig = !!task.requireSignature

  const submit = async (action) => {
    if (needsSig && !signature) {
      setLocalErr('Please add your e-signature before continuing.')
      return
    }
    // A rejection ends the request, so it needs a reason — same rule the
    // "Request changes" action already enforces.
    if (action === 'reject' && !comment.trim()) {
      setLocalErr('Please add a reason for the rejection.')
      commentRef?.current?.focus()
      return
    }
    setLocalErr('')
    if (action === 'reject') {
      const ok = await confirm({
        title: 'Reject this request?',
        message: 'The requester is notified and the approval stops here.',
        confirmLabel: 'Reject',
        danger: true,
      })
      if (!ok) return
    }
    onAction(action, comment, signature)
    setComment('')
  }

  const blocked = isResolved || !!busy || (needsSig && !signature)

  return (
    <section className="nf-task-card nf-task-action-card">
      <h2 className="text-sm font-semibold text-fg mb-3">Approval actions</h2>

      <textarea
        ref={commentRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment — required when rejecting"
        rows={2}
        disabled={isResolved || !!busy}
        className="w-full px-3 py-2 text-sm rounded-md border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-none disabled:bg-surface-2 disabled:text-fg-subtle"
      />

      {needsSig && (
        <div className="mt-3">
          <SignaturePad
            onChange={setSignature}
            disabled={isResolved || !!busy}
            label={<>E-signature <span className="text-danger-fg">*</span></>}
          />
        </div>
      )}

      {(error || localErr) && (
        <p className="mt-2 text-xs text-danger-fg">{error || localErr}</p>
      )}

      {/* Approve is the filled primary, Reject reads as destructive, and
          Request changes stays a quiet third option — all three used to share
          the same ghost styling. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mt-3">
        <button
          type="button"
          disabled={blocked}
          onClick={() => submit('approve')}
          className="px-4 py-2 rounded-md bg-success-solid text-white hover:brightness-110 text-sm font-semibold shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={blocked}
          onClick={() => submit('reject')}
          className="px-4 py-2 rounded-md border-2 border-danger-solid bg-surface text-danger-fg hover:bg-danger-subtle text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button
          type="button"
          disabled={blocked}
          onClick={() => submit('changes')}
          className="px-4 py-2 rounded-md border border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v1M3 10l4-4m-4 4l4 4" />
          </svg>
          {busy === 'changes' ? 'Sending…' : 'Request changes'}
        </button>
      </div>

      {needsSig && !signature && !isResolved && (
        <p className="mt-2 text-[11px] text-fg-subtle">
          This step requires your e-signature before you can act.
        </p>
      )}

      {isResolved && (
        <p className="mt-3 text-xs text-fg-subtle">
          This task is {task.status.toLowerCase()} — no further action needed.
        </p>
      )}
    </section>
  )
}

// Submit-node action panel: the assignee fills the inline form the designer
// defined (if any) + an optional comment, then submits to advance the workflow.
function SubmitActions({ task, onSubmitted }) {
  const fields = Array.isArray(task.formFields) ? task.formFields : []
  const [values, setValues] = useState({})
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isResolved = task.status !== 'Pending'

  // Conditional logic: only the fields whose show/hide rule currently passes.
  const shownFields = fields.filter((f) => isFieldVisible(f, values))

  const setField = (id, v) => {
    setValues((prev) => ({ ...prev, [id]: v }))
    setErrors((prev) => (prev[id] ? { ...prev, [id]: undefined } : prev))
  }

  const doSubmit = async () => {
    setError('')
    const errs = validateFields(shownFields, values)
    if (Object.keys(errs).length) {
      setErrors(errs)
      setError('Please complete the required fields.')
      return
    }
    setBusy(true)
    try {
      const payload = stripHiddenValues(shownFields, values)
      const uploadedPayload = await api.uploadPendingFiles(payload)
      await tasksStore.submit(task.id, { comment, formData: uploadedPayload })
      onSubmitted?.()
    } catch (err) {
      setError(err.message || 'Submit failed')
      setBusy(false)
    }
  }

  return (
    <section className="nf-task-card nf-task-action-card">
      <h2 className="text-sm font-semibold text-fg mb-1">Submit this step</h2>
      <p className="text-sm text-fg-muted mb-4">
        {task.instructions
          ? task.instructions
          : fields.length
          ? 'Fill out the form below and submit to advance the workflow.'
          : 'Add an optional comment and submit to advance the workflow.'}
      </p>

      {shownFields.length > 0 && (
        <div className="space-y-4 mb-4">
          {shownFields.map((f) => (
            <FieldRow
              key={f.id}
              field={f}
              value={values[f.id]}
              error={errors[f.id]}
              richSignature
              disabled={isResolved || busy}
              onChange={(v) => setField(f.id, v)}
            />
          ))}
        </div>
      )}

      <label htmlFor="task-decision-comment" className="block text-sm font-medium text-fg mb-1">Comment</label>
      <textarea
        id="task-decision-comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment..."
        rows={2}
        disabled={isResolved || busy}
        className="w-full px-3 py-2 text-sm rounded-md border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-none disabled:bg-surface-2 disabled:text-fg-subtle"
      />

      {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}

      <button
        type="button"
        disabled={isResolved || busy}
        onClick={doSubmit}
        className="mt-3 w-full px-4 py-2 rounded-md border border-teal-200 bg-teal-50/60 text-teal-700 hover:brightness-95 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Submitting…' : 'Submit'}
      </button>

      {isResolved && (
        <p className="mt-3 text-xs text-fg-subtle">
          This step has been submitted — no further action needed.
        </p>
      )}
    </section>
  )
}

// Review-node tasks: the reviewer reads the submission + prior documents above,
// then forwards (no changes) or sends it back for changes. Deliberately not an
// approve/reject — it's a review checkpoint that routes the workflow.
function ReviewActions({ task, onReviewed }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const isResolved = task.status !== 'Pending'

  const submit = async (outcome) => {
    setError('')
    if (outcome === 'changes' && !comment.trim()) {
      setError('Please describe what changes are needed before sending it back.')
      return
    }
    setBusy(outcome)
    try {
      await tasksStore.review(task.id, outcome, comment)
      onReviewed?.()
    } catch (err) {
      setError(err.message || 'Action failed')
      setBusy(null)
    }
  }

  return (
    <section className="nf-task-card nf-task-action-card">
      <h2 className="text-sm font-semibold text-fg mb-1">Review</h2>
      <p className="text-sm text-fg-muted mb-3">
        {task.instructions
          ? task.instructions
          : 'Review the submission and documents above, then forward it or send it back for changes. This is a review checkpoint — not an approval.'}
      </p>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (required when requesting changes)..."
        rows={2}
        disabled={isResolved || !!busy}
        className="w-full px-3 py-2 text-sm rounded-md border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-none disabled:bg-surface-2 disabled:text-fg-subtle"
      />

      {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isResolved || !!busy}
          onClick={() => submit('forward')}
          className="px-4 py-2 rounded-md border border-success-line bg-success-subtle/60 text-success-fg hover:bg-success-subtle text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'forward' ? 'Forwarding…' : 'No changes — forward'}
        </button>
        <button
          type="button"
          disabled={isResolved || !!busy}
          onClick={() => submit('changes')}
          className="px-4 py-2 rounded-md border border-warning-line bg-warning-subtle/60 text-warning-fg hover:bg-warning-subtle text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'changes' ? 'Sending back…' : 'Changes required'}
        </button>
      </div>

      {isResolved && (
        <p className="mt-3 text-xs text-fg-subtle">
          This review is complete — no further action needed.
        </p>
      )}
    </section>
  )
}

// Read-only list of files attached to a submit task (visible to everyone once
// the assignee has submitted).
function SubmittedFiles({ task }) {
  const files = [...(task.attachments || []), ...(task.sourceAttachments || [])]
  if (files.length === 0) return null
  return (
    <section className="nf-task-card nf-task-support-card">
      <h2 className="text-sm font-semibold text-fg mb-3">Submitted files</h2>
      <ul className="space-y-2">
        {files.map((a, i) => (
          <li key={`${a.url}-${i}`} className="flex flex-wrap items-center gap-2">
            <a
              href={toAbsoluteUrl(a.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 underline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              {a.name || 'Attachment'}
            </a>
              {a.kind === 'auto_fill_source' && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">Auto-fill source</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

// Read-only list of documents uploaded at EARLIER workflow steps (e.g. a submit
// node's costing doc). Lets the current assignee/approver review everything that
// came before — not just their own step's files.
function PriorDocuments({ task }) {
  if (!task.priorDocuments || task.priorDocuments.length === 0) return null
  return (
    <section className="nf-task-card nf-task-support-card">
      <h2 className="text-sm font-semibold text-fg mb-3">Documents from previous steps</h2>
      <ul className="space-y-2">
        {task.priorDocuments.map((d, i) => (
          <li key={`${d.url}-${i}`} className="flex items-center gap-2">
            <a
              href={toAbsoluteUrl(d.url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 underline"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              {d.name || 'Attachment'}
            </a>
            {d.step && <span className="text-xs text-fg-subtle truncate">— {d.step}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

// Read-only label→value grid for a submitted form. File fields are skipped here
// because they already render as attachments / "Documents from previous steps".
function SubmittedFormFields({ fields, data }) {
  const list = (fields || []).filter((f) => f.type !== 'file' && f.type !== 'heading')
  if (!list.length) return null
  return (
    <dl className="divide-y divide-line">
      {list.map((f) => (
        <div key={f.id} className="py-2 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3">
          <dt className="text-sm text-fg-muted">{f.label}</dt>
          <dd className="sm:col-span-2 text-sm">
            <FieldValueView field={f} value={data?.[f.id]} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

// The current Submit task's own form, shown read-only once it's been submitted.
function SubmittedForm({ task }) {
  if (task.actionType !== 'submit' || task.status === 'Pending') return null
  const fields = Array.isArray(task.formFields) ? task.formFields : []
  if (!fields.some((f) => f.type !== 'file')) return null
  return (
    <section className="nf-task-card nf-task-support-card">
      <h2 className="text-sm font-semibold text-fg mb-3">Submitted form</h2>
      <SubmittedFormFields fields={fields} data={task.formData} />
    </section>
  )
}

// Structured form values submitted at EARLIER submit-node steps, so the current
// reviewer/approver can read them (name, account no., e-signature, …).
function PriorForms({ task }) {
  const forms = Array.isArray(task.priorForms)
    ? task.priorForms.filter((f) => (f.fields || []).some((x) => x.type !== 'file'))
    : []
  if (!forms.length) return null
  return (
    <section className="nf-task-card nf-task-support-card">
      <h2 className="text-sm font-semibold text-fg mb-3">Form data from previous steps</h2>
      <div className="space-y-4">
        {forms.map((f, i) => (
          <div key={`${f.nodeId}-${i}`}>
            {f.step && <p className="text-xs font-medium text-fg-subtle mb-1">{f.step}</p>}
            <SubmittedFormFields fields={f.fields} data={f.data} />
          </div>
        ))}
      </div>
    </section>
  )
}

// Raw transport errors ("ECONNREFUSED 10.0.0.4:443") mean nothing to an
// approver, so map the common ones to plain English and keep the original
// behind a disclosure for whoever has to fix it.
function integrationErrorSummary(event) {
  const raw = String(event.error || '')
  const status = event.httpStatus
  if (status === 401 || status === 403) return 'The external system rejected our credentials.'
  if (status === 404) return "The external system couldn't find that endpoint."
  if (status === 429) return 'The external system is rate-limiting us.'
  if (status >= 500) return 'The external system returned an error.'
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(raw)) return "The external system didn't respond in time."
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i.test(raw)) return "We couldn't reach the external system."
  if (/certificate|SSL|TLS/i.test(raw)) return "The external system's security certificate was rejected."
  return 'The call did not complete.'
}

// Outbound Integration node results (success / failed / skipped) for this run.
function IntegrationEvents({ task }) {
  const events = Array.isArray(task.integrationEvents) ? task.integrationEvents : []
  if (!events.length) return null
  return (
    <section className="nf-task-card nf-task-support-card">
      <h2 className="text-sm font-semibold text-fg mb-3">External calls</h2>
      <ul className="space-y-2">
        {events.map((e, i) => {
          const ok = e.ok && !e.error
          return (
            <li
              key={`${e.nodeId}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm border-b border-line last:border-0 pb-2 last:pb-0"
            >
              <span className={`font-medium ${ok ? 'text-success-fg' : 'text-warning-fg'}`}>
                {ok ? 'OK' : e.skipped ? 'Failed (continued)' : 'Failed'}
              </span>
              <span className="text-fg-muted font-mono text-xs">{e.nodeId}</span>
              {e.httpStatus != null && (
                <span className="text-fg-subtle text-xs">HTTP {e.httpStatus}</span>
              )}
              {e.attempts != null && (
                <span className="text-fg-subtle text-xs">{e.attempts} attempt{e.attempts === 1 ? '' : 's'}</span>
              )}
              {e.error && (
                <div className="w-full">
                  <p className="text-xs text-fg">{integrationErrorSummary(e)}</p>
                  <details className="mt-1">
                    <summary className="text-[11px] text-fg-subtle cursor-pointer hover:text-fg-muted">
                      Technical detail
                    </summary>
                    <p className="mt-1 font-mono text-[11px] text-fg-muted break-all">{e.error}</p>
                  </details>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const STAGE_META = {
  approved:  { dot: 'bg-success-solid',  text: 'text-success-fg',  label: 'Approved' },
  rejected:  { dot: 'bg-danger-solid',    text: 'text-danger-fg',    label: 'Rejected' },
  escalated: { dot: 'bg-orange-500', text: 'text-warning-fg', label: 'Escalated' },
  pending:   { dot: 'bg-blue-500',   text: 'text-blue-600',   label: 'Awaiting approval' },
  upcoming:  { dot: 'bg-gray-300',   text: 'text-fg-subtle',   label: 'Not started' }
}

const VOTE_META = {
  approved: { dot: 'bg-success-solid', text: 'text-success-fg', label: 'Approved' },
  rejected: { dot: 'bg-danger-solid', text: 'text-danger-fg', label: 'Rejected' },
  pending: { dot: 'bg-gray-300', text: 'text-fg-subtle', label: 'Awaiting' }
}

// Committee / quorum panel: shows "N of M approved", a progress bar, and each
// approver's vote. Only rendered for multiApproval tasks.
function CommitteeApprovals({ task }) {
  if (!task.isMultiApproval) return null

  const voters = task.parallelApprovers || []
  const voteById = new Map((task.parallelApprovals || []).map((p) => [String(p.id), p]))
  const required = task.requiredApprovals || 1
  const total = voters.length
  const approved = (task.parallelApprovals || []).filter((p) => p.status === 'approved').length
  const rejected = (task.parallelApprovals || []).filter((p) => p.status === 'rejected').length
  const met = approved >= required
  const failed = total - rejected < required
  const pct = Math.min(100, Math.round((approved / Math.max(1, required)) * 100))

  return (
    <section className="nf-task-card nf-task-rail-card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-fg">Committee approval</h2>
        <span className={`text-xs font-semibold ${met ? 'text-success-fg' : failed ? 'text-danger-fg' : 'text-indigo-600'}`}>
          {approved} of {required} approved
        </span>
      </div>
      <p className="text-[11px] text-fg-muted mb-2">
        {met
          ? `Quorum reached — only ${required} of ${total} approval${required === 1 ? '' : 's'} were needed.`
          : failed
          ? 'Too many rejections — this stage can no longer reach quorum.'
          : `Needs ${required} of ${total} approvals to pass. ${rejected > 0 ? `${rejected} rejected so far.` : ''}`}
      </p>
      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3">
        <div className={`h-full ${met ? 'bg-success-solid' : failed ? 'bg-danger-solid' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-2">
        {voters.map((v) => {
          const vote = voteById.get(String(v.id))
          const meta = VOTE_META[vote?.status] || VOTE_META.pending
          return (
            <li key={v.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                <span className="text-sm text-fg truncate">{v.name || 'Approver'}</span>
              </span>
              <span className={`text-[11px] font-medium shrink-0 ${meta.text}`}>
                {meta.label}
                {vote?.decidedAt ? (
                  <time dateTime={isoAttr(vote.decidedAtIso)}> · {vote.decidedAt}</time>
                ) : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ApprovalChain({ task }) {
  const chain = task.approvalChain || []
  const summary = task.approvalSummary
  if (chain.length === 0) return null

  const stageLine = (s) => {
    if (s.status === 'approved' || s.status === 'rejected' || s.status === 'escalated') {
      const verb = STAGE_META[s.status].label
      return `${verb} by ${s.decidedBy || s.assignee || '—'}`
    }
    if (s.status === 'pending') {
      return `Awaiting ${s.assignee || s.roleLabel || 'approver'}`
    }
    return s.roleLabel ? `${s.roleLabel} (auto-assigned)` : 'Waiting for the previous step'
  }

  return (
    <section className="nf-task-card nf-task-rail-card nf-task-route-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-fg">Approval chain</h2>
        {summary && (
          <span className="text-xs font-medium text-fg-muted">
            {summary.approved} of {summary.required} approved
          </span>
        )}
      </div>
      <ol className="relative">
        {chain.map((s, i) => {
          const meta = STAGE_META[s.status] || STAGE_META.upcoming
          const isLast = i === chain.length - 1
          return (
            <li key={s.nodeId} className="relative pl-6 pb-4 last:pb-0">
              {!isLast && (
                <span className="absolute left-[5px] top-3.5 bottom-0 w-px bg-line" />
              )}
              <span
                className={`absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full ${meta.dot} ${
                  s.isCurrent ? 'ring-2 ring-blue-200' : ''
                }`}
              />
              <div className="leading-tight">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-fg">
                    {s.title}
                    {s.isCurrent && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
                        current
                      </span>
                    )}
                  </p>
                  <span className={`text-[11px] font-medium shrink-0 ${meta.text}`}>{meta.label}</span>
                </div>
                <p className="text-xs text-fg-muted mt-0.5">{stageLine(s)}</p>
                {s.decidedAt && (
                  <time dateTime={isoAttr(s.decidedAtIso)} className="block text-[11px] text-fg-subtle mt-0.5">
                    {s.decidedAt}
                  </time>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function ApprovalHistory({ task }) {
  return (
    <section className="nf-task-card nf-task-rail-card nf-task-history-card">
      <h2 className="text-sm font-semibold text-fg mb-3">Approval history</h2>
      {task.history.length === 0 ? (
        <p className="text-sm text-fg-subtle">No activity on this request yet.</p>
      ) : (
        <ul className="space-y-3">
          {task.history.map((step, idx) => (
            <li key={idx} className="flex items-start gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${step.dotColor}`} />
              <div className="leading-tight">
                <p className="text-sm text-fg">{step.label}</p>
                {step.signature && <SignatureMark signature={step.signature} className="mt-1" />}
                <time dateTime={isoAttr(step.at)} className="block text-xs text-fg-subtle mt-0.5">
                  {step.time}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SlaStatus({ task }) {
  const { totalHours = 24, assignedHoursAgo = 0, hasSla = false } = task.sla || {}

  // Without a due date there is no deadline to report. This panel used to
  // invent "24 hours remaining · 24h SLA" for every such task.
  if (!hasSla) {
    return (
      <section className="nf-task-card nf-task-rail-card nf-task-sla-card">
        <h2 className="text-sm font-semibold text-fg mb-1">SLA status</h2>
        <p className="text-sm text-fg-muted">No deadline set for this step.</p>
        <p className="text-xs text-fg-subtle mt-2">
          Assigned {assignedHoursAgo}h ago
          {task.createdAt ? ` · ${formatDateTime(task.createdAt)}` : ''}
        </p>
      </section>
    )
  }

  const remaining = totalHours - assignedHoursAgo
  const pct = Math.max(0, Math.min(100, (assignedHoursAgo / totalHours) * 100))
  const breached = remaining < 0 || task.slaBreached

  const hoursLabel = (h) => `${h} ${h === 1 ? 'hour' : 'hours'}`
  
  let remainingLabel
  const isResolved = task.status !== 'Pending' && task.status !== 'Escalated'
  if (isResolved) {
    remainingLabel = breached
      ? `Completed ${hoursLabel(Math.abs(Math.round(remaining)))} overdue`
      : 'Completed on time'
  } else {
    remainingLabel = breached
      ? `${hoursLabel(Math.abs(Math.round(remaining)))} overdue`
      : `${hoursLabel(Math.round(remaining))} remaining`
  }

  const barColor = breached
    ? 'bg-danger-solid'
    : pct >= 75
    ? 'bg-warning-solid'
    : 'bg-success-solid'

  return (
    <section className="nf-task-card nf-task-rail-card nf-task-sla-card">
      <h2 className="text-sm font-semibold text-fg mb-3">SLA status</h2>
      <p className={`text-sm font-medium ${breached ? 'text-danger-fg' : 'text-fg'}`}>
        {breached ? '⚠ ' : ''}{remainingLabel}
      </p>
      <div
        className="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden"
        role="progressbar"
        aria-label="SLA elapsed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.max(0, pct)}%` }} />
      </div>
      <p className="text-xs text-fg-subtle mt-2">
        Assigned {assignedHoursAgo}h ago · {totalHours}h SLA
        {task.dueDate ? ` · due ${formatDateTime(task.dueDate)}` : ''}
      </p>
    </section>
  )
}

function TaskDetail() {
  const { id } = useParams()
  const task = useTask(id)
  const me = useUser()
  const navigate = useNavigate()
  const commentRef = useRef(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    setError('')
    tasksStore.loadOne(id)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const pageTitle = useMemo(() => {
    if (!task) return ''
    return `${task.subject} — ${task.requester}`
  }, [task])

  if (loading && !task) {
    return (
      <AppShell title="Loading task…" back={{ to: '/tasks', label: 'Back to inbox' }}>
        <div className="nf-task-card nf-task-loading-card" aria-busy="true" aria-label="Loading request">
          {Array.from({ length: 6 }).map((_, i) => <ListRowSkeleton key={i} />)}
        </div>
      </AppShell>
    )
  }

  if (!task) {
    return (
      <AppShell title="Task unavailable" back={{ to: '/tasks', label: 'Back to inbox' }}>
        <div className="nf-task-card nf-task-error-card">
          <ErrorState
            title="We couldn't open this task"
            message={error || 'Task not found.'}
            onRetry={load}
          />
          <div className="pb-6 text-center">
            <Link to="/tasks" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              Return to inbox
            </Link>
          </div>
        </div>
      </AppShell>
    )
  }

  const handleAction = async (action, comment, signature) => {
    setBusy(action)
    setError('')
    try {
      if (action === 'approve')  await tasksStore.approve(task.id, comment, signature)
      if (action === 'reject')   await tasksStore.reject(task.id, comment, signature)
      if (action === 'changes')  await tasksStore.requestChanges(task.id, comment, signature)
      if (action !== 'changes') {
        setTimeout(() => navigate('/tasks'), 600)
      }
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const focusAction = () => {
    const panel = document.getElementById('task-actions')
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (task.actionType === 'approval') {
      window.setTimeout(() => commentRef.current?.focus(), 250)
    }
  }

  const handleCancel = async () => {
    const ok = await confirm({
      title: 'Cancel request?',
      message: 'This stops the approval and notifies anyone it was waiting on.',
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep it',
      danger: true,
    })
    if (!ok) return
    setBusy('cancel')
    setError('')
    try {
      await tasksStore.cancel(task.executionId)
      setTimeout(() => navigate('/tasks'), 400)
    } catch (err) {
      setError(err.message || 'Could not cancel the request')
      setBusy(null)
    }
  }

  // Only the assignee (or an elevated approver) can act — matches the backend.
  const meId = me?._id ? String(me._id) : null
  const isAssignee = meId && String(task.assignedToId) === meId
  // For committee tasks, any listed voter can act (not just the representative
  // assignee). Their vote is hidden once cast so they can't double-vote.
  const myVote =
    task.isMultiApproval
      ? (task.parallelApprovals || []).find((p) => String(p.id) === meId && p.status !== 'pending')
      : null
  const canAct = task.actionType === 'submit'
    ? isAssignee
    : isApprover(me)

  // Request-level status (the whole chain) drives the requester's summary text.
  const reqStatus = requestStatus(task)
  const reqResolved = reqStatus === 'Approved' || reqStatus === 'Rejected'
  const currentApprover =
    (task.approvalChain || []).find((s) => s.isCurrent || s.status === 'pending')?.assignee ||
    task.approver
  const pageSubtitle = canAct && !reqResolved
    ? 'Review the submitted information and complete the current workflow step.'
    : 'Track the submitted information, approval progress, and request activity.'
  const actionLabel = task.actionType === 'submit'
    ? 'Complete step'
    : task.actionType === 'review'
      ? 'Review request'
      : 'Make decision'

  return (
    <AppShell
      title={pageTitle}
      subtitle={pageSubtitle}
      back={{ to: '/tasks', label: 'Back to inbox' }}
      mainClass="nf-task-detail-main flex-1 p-4 md:p-6 pb-24 md:pb-8 overflow-y-auto"
      actions={
        canAct && !reqResolved && !myVote ? (
          <button type="button" onClick={focusAction} className="nf-task-header-action">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 11.5 11 13.5 15.5 9M12 3l7 3v5c0 4.6-2.9 8.2-7 10-4.1-1.8-7-5.4-7-10V6Z" />
            </svg>
            {actionLabel}
          </button>
        ) : null
      }
    >
      <div className="nf-task-detail-page">
        <TaskSummary task={task} />
        <div className="nf-task-workspace">
          <div className="nf-task-primary">
          <SubmissionDetails task={task} />
          <PriorForms task={task} />
          <IntegrationEvents task={task} />
          <PriorDocuments task={task} />
          <div id="task-actions" className="nf-task-action-anchor">
          {canAct && myVote ? (
            <section className="nf-task-card nf-task-outcome-card is-info">
              <span className="nf-task-outcome-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                </svg>
              </span>
              <h2 className="text-sm font-semibold text-fg mb-1">Your decision</h2>
              <p className="text-sm text-fg-muted">
                You have already <span className={myVote.status === 'approved' ? 'text-success-fg font-medium' : 'text-danger-fg font-medium'}>{myVote.status}</span> this
                committee task. It stays open until the required number of approvals is reached.
              </p>
            </section>
          ) : canAct ? (
            task.actionType === 'submit' ? (
              <SubmitActions
                task={task}
                onSubmitted={() => setTimeout(() => navigate('/tasks'), 600)}
              />
            ) : task.actionType === 'review' ? (
              <ReviewActions
                task={task}
                onReviewed={() => setTimeout(() => navigate('/tasks'), 600)}
              />
            ) : (
              <ApprovalActions
                task={task}
                onAction={handleAction}
                commentRef={commentRef}
                busy={busy}
                error={error}
              />
            )
          ) : (
            <section className={'nf-task-card nf-task-outcome-card ' + (reqStatus === 'Rejected' ? 'is-rejected' : reqResolved ? 'is-approved' : 'is-pending')}>
              <span className="nf-task-outcome-icon" aria-hidden="true">
                {reqResolved && reqStatus !== 'Rejected' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" /></svg>
                ) : reqStatus === 'Rejected' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="m7 7 10 10M17 7 7 17" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                )}
              </span>
              <h2>{reqResolved ? 'Request ' + reqStatus.toLowerCase() : 'Approval in progress'}</h2>
              <p className="text-sm text-fg-muted">
                {reqResolved
                  ? `This request has been ${reqStatus.toLowerCase()}.`
                  : `This request is awaiting approval${currentApprover ? ` from ${currentApprover}` : ''}. You'll be notified when there's an update.`}
              </p>
              {task.canCancel && !reqResolved && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={busy === 'cancel'}
                    className="px-4 py-1.5 text-xs font-medium rounded-md border border-danger-line text-danger-fg hover:bg-danger-subtle disabled:opacity-50 transition"
                  >
                    {busy === 'cancel' ? 'Cancelling…' : 'Cancel request'}
                  </button>
                  {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}
                </div>
              )}
            </section>
          )}
          </div>
          <SubmittedForm task={task} />
          <SubmittedFiles task={task} />
        </div>

          <aside className="nf-task-rail" aria-label="Approval progress and activity">
            <div className="nf-task-rail-sticky">
              <CommitteeApprovals task={task} />
              <ApprovalChain task={task} />
              <SlaStatus task={task} />
              <ApprovalHistory task={task} />
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  )
}

export default TaskDetail
