import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../utils/api'
import { FORM_TEMPLATES } from '../lib/formTemplates'
import { categoryBadge } from '../utils/badges'
import { useFocusTrap, useScrollLock } from '../utils/a11y'
import { reportLimit } from '../lib/limitFeedback'
import { toast } from '../lib/toastStore'
import { createDraftStore } from '../utils/localDraft'
import DocumentFormGenerator from './DocumentFormGenerator'

const documentHandoffStore = createDraftStore(
  'netflow.form.document-handoff.v1',
  { maxAgeMs: 30 * 60 * 1000 }
)

const choiceCardCls =
  'relative flex min-h-72 flex-col rounded-2xl border bg-surface p-4 text-left shadow-sm transition duration-200 sm:p-5 lg:min-h-[22rem]'

const choiceTones = {
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  slate: 'bg-surface-3 text-fg-muted'
}

const AI_PROMPT_EXAMPLES = [
  'Employee onboarding form',
  'IT access request with manager approval',
  'Purchase request with item details'
]

function ChoiceCard({ title, description, actionLabel, tone, icon, disabled, unavailableReason, featured, onClick }) {
  return (
    <article
      className={`${choiceCardCls} ${featured
        ? 'border-2 border-indigo-500 bg-indigo-50/50 shadow-indigo-100 dark:bg-indigo-500/10 dark:shadow-none'
        : 'border-line hover:border-info-line hover:shadow-md'}`}
    >
      {featured && (
        <span className="absolute right-4 top-4 rounded-md bg-indigo-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
          Recommended
        </span>
      )}

      <div className="flex min-h-20 items-center justify-center pt-3">
        <span className={'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ' + choiceTones[tone]}>
          {icon}
        </span>
      </div>

      <h3 className="mt-5 text-lg font-semibold text-fg">{title}</h3>
      <p className="mt-2 text-sm leading-5 text-fg-muted">{description}</p>

      {unavailableReason && (
        <p className="mt-3 text-xs font-medium text-warning-fg">{unavailableReason}</p>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={unavailableReason || undefined}
        className={`mt-auto inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${featured
          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
          : 'border border-line bg-surface text-fg hover:border-info-line hover:bg-surface-2'}`}
      >
        {actionLabel}
      </button>
    </article>
  )
}

// Choice-first launcher shown when a user clicks "New form".
// Each creation method opens a focused flow while preserving the existing builder handoffs.
export default function NewFormModal({ open, onClose }) {
  const navigate = useNavigate()
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiUnavailableReason, setAiUnavailableReason] = useState('Checking availability...')
  const [documentAvailable, setDocumentAvailable] = useState(false)
  const [documentUnavailableReason, setDocumentUnavailableReason] = useState('Checking availability...')
  const [view, setView] = useState('home') // 'home' | 'ai' | 'templates' | 'document'
  const [quickPrompt, setQuickPrompt] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const panelRef = useRef(null)
  const promptInputRef = useRef(null)
  const suggestTimer = useRef(null)
  const latestSuggestBase = useRef('')

  useEffect(() => {
    if (!open) return
    // The controlled dialog keeps mounted state between openings, so reset its
    // transient workflow before starting the availability request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView('home')
    setQuickPrompt('')
    setSuggestion('')
    setGenError('')
    setGenerating(false)
    setAiUnavailableReason('Checking availability...')
    setDocumentUnavailableReason('Checking availability...')
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    let cancelled = false
    api
      .get('/api/forms/ai-status')
      .then((d) => {
        if (cancelled) return
        setAiAvailable(!!d.aiConfigured)
        setAiUnavailableReason(d.aiConfigured ? '' : 'AI provider is not configured')
        const available = !!d.aiConfigured && !!d.pdfAutoFillAvailable
        setDocumentAvailable(available)
        if (available) {
          setDocumentUnavailableReason('')
        } else if (!d.aiConfigured) {
          setDocumentUnavailableReason('AI provider is not configured')
        } else if (d.pdfAutoFill?.entitled === false) {
          setDocumentUnavailableReason('Not included for this workspace')
        } else if (d.pdfAutoFill?.configured === false || d.pdfAutoFill?.audienceAllowed === false) {
          setDocumentUnavailableReason('Disabled by the organization administrator')
        } else {
          setDocumentUnavailableReason('Document processing is temporarily unavailable')
        }
      })
      .catch(() => {
        if (cancelled) return
        setAiAvailable(false)
        setAiUnavailableReason('Availability could not be checked')
        setDocumentAvailable(false)
        setDocumentUnavailableReason('Availability could not be checked')
      })
    return () => {
      cancelled = true
      if (suggestTimer.current) clearTimeout(suggestTimer.current)
    }
  }, [open])

  useEffect(() => {
    if (open && view === 'ai' && aiAvailable && !generating) {
      requestAnimationFrame(() => promptInputRef.current?.focus())
    }
  }, [open, view, aiAvailable, generating])

  const onEscape = useCallback(() => {
    if (generating) return
    if (view === 'home') onClose()
    else setView('home')
  }, [view, onClose, generating])

  useScrollLock(open)
  useFocusTrap(open, panelRef, { onEscape })

  if (!open) return null

  const go = (path, opts) => { onClose(); navigate(path, opts) }
  const startBlank = () => go('/forms/new?blank=1')
  const startTemplate = (id) => go(`/forms/new?template=${encodeURIComponent(id)}`)

  const fetchSuggestion = async (base) => {
    latestSuggestBase.current = base
    try {
      const res = await api.post('/api/forms/ai-suggest', { prompt: base })
      if (latestSuggestBase.current !== base) return
      const el = promptInputRef.current
      if (!el || el.value !== base || el.selectionStart !== base.length) return
      setSuggestion(res?.completion || '')
    } catch {
      setSuggestion('')
    }
  }

  const onPromptChange = (e) => {
    const val = e.target.value
    setQuickPrompt(val)
    setGenError('')
    setSuggestion('')
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (!aiAvailable || generating || val.trim().length < 3) return
    suggestTimer.current = setTimeout(() => fetchSuggestion(val), 350)
  }

  const acceptSuggestion = () => {
    if (!suggestion) return
    const next = quickPrompt + suggestion
    setQuickPrompt(next)
    setSuggestion('')
    requestAnimationFrame(() => {
      const el = promptInputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(next.length, next.length)
      }
    })
  }

  const onPromptKeyDown = (e) => {
    const el = e.target
    const caretAtEnd =
      el.selectionStart === quickPrompt.length && el.selectionStart === el.selectionEnd
    if (suggestion && (e.key === 'Tab' || (e.key === 'ArrowRight' && caretAtEnd))) {
      e.preventDefault()
      acceptSuggestion()
      return
    }
    if (e.key === 'Escape' && suggestion) {
      e.preventDefault()
      e.stopPropagation()
      setSuggestion('')
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      startQuickGenerate()
    }
  }

  const startQuickGenerate = async () => {
    const prompt = (quickPrompt + (suggestion || '')).trim()
    if (!prompt || !aiAvailable || generating) return
    setSuggestion('')
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    setGenerating(true)
    setGenError('')
    try {
      const res = await api.post('/api/forms/ai-draft', { prompt })
      const fields = Array.isArray(res.fields) ? res.fields : []
      if (!fields.length) {
        setGenError('No fields were generated. Try rephrasing.')
        return
      }
      onClose()
      navigate('/forms/new?ai=1', {
        state: {
          aiDraft: {
            title: res.title || '',
            description: res.description || '',
            fields,
            prompt,
          },
        },
      })
    } catch (err) {
      if (!reportLimit(err)) {
        const msg = err?.message || 'AI generation failed. Please try again.'
        setGenError(msg)
        toast.error(msg)
      }
    } finally {
      setGenerating(false)
    }
  }

  const canGenerate = aiAvailable && !!quickPrompt.trim() && !generating
  const applyPromptExample = (example) => {
    setQuickPrompt(example)
    setSuggestion('')
    setGenError('')
    requestAnimationFrame(() => promptInputRef.current?.focus())
  }
  const openDocumentDraft = (draft) => {
    documentHandoffStore.write({ ...draft, entryMode: 'document' })
    onClose()
    navigate('/forms/new?document=1', { state: { documentDraft: draft } })
  }

  const modalTitle = {
    home: 'Create a new form',
    ai: 'Describe with AI',
    templates: 'Choose a template',
    document: 'Generate form from document'
  }[view]
  const modalSubtitle = {
    home: 'Choose the starting point that best matches your workflow.',
    ai: 'Describe what you need and NetFlow will prepare an editable first draft.',
    templates: 'Start with a ready-made structure and customize it in the builder.',
    document: 'Upload a PDF or image to generate source-grounded fields.'
  }[view]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 backdrop-blur-sm p-4 sm:p-6"
      onClick={generating || view === 'document' ? undefined : onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-form-modal-title"
        tabIndex={-1}
        className={'my-6 w-full rounded-xl bg-surface shadow-2xl focus:outline-none ' + (view === 'document' ? 'max-w-7xl' : view === 'home' ? 'max-w-5xl' : 'max-w-3xl')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {view !== 'home' && (
              <button
                type="button"
                onClick={() => setView('home')}
                disabled={generating}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-subtle transition hover:bg-surface-3 hover:text-fg-muted disabled:opacity-50"
                aria-label="Back to start options"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="min-w-0">
              <h2 id="new-form-modal-title" className="text-lg font-semibold text-fg">
                {modalTitle}
              </h2>
              {view !== 'home' && (
                <p className="mt-0.5 hidden text-xs text-fg-muted sm:block">{modalSubtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-subtle transition hover:bg-surface-3 hover:text-fg-muted disabled:opacity-50"
            aria-label="Close dialog"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {view === 'home' && (
          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="text-center">
              <h3 className="text-xl font-semibold text-fg sm:text-2xl">How would you like to start?</h3>
              <p className="mt-1.5 text-sm text-fg-muted">Choose the best way to create your form.</p>
            </div>

            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ChoiceCard
                title="Describe with AI"
                description="Tell us what you need and we'll build it for you."
                actionLabel="Start with AI"
                tone="indigo"
                featured
                disabled={generating || !aiAvailable}
                unavailableReason={aiAvailable ? '' : aiUnavailableReason}
                onClick={() => setView('ai')}
                icon={(
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 .9 2.8A4 4 0 0 0 15.4 8l2.8.9-2.8.9a4 4 0 0 0-2.5 2.2l-.9 2.8-.9-2.8a4 4 0 0 0-2.5-2.2l-2.8-.9L8.6 8a4 4 0 0 0 2.5-2.2L12 3Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="m18.5 14 .5 1.5a2 2 0 0 0 1.5 1.5l1.5.5-1.5.5a2 2 0 0 0-1.5 1.5l-.5 1.5-.5-1.5a2 2 0 0 0-1.5-1.5l-1.5-.5 1.5-.5a2 2 0 0 0 1.5-1.5l.5-1.5Z" />
                  </svg>
                )}
              />

              <ChoiceCard
                title="Upload document"
                description="Extract fields from your PDF or image files."
                actionLabel="Upload file"
                tone="emerald"
                disabled={generating || !documentAvailable}
                unavailableReason={documentAvailable ? '' : documentUnavailableReason}
                onClick={() => setView('document')}
                icon={(
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l4 4v14H7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M10 13h5M10 17h5" />
                  </svg>
                )}
              />

              <ChoiceCard
                title="Use template"
                description="Start from a pre-built template and customize."
                actionLabel="Browse templates"
                tone="violet"
                disabled={generating}
                onClick={() => setView('templates')}
                icon={(
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3H4V5ZM4 10h7v9H5a1 1 0 0 1-1-1v-8ZM13 10h7v8a1 1 0 0 1-1 1h-6v-9Z" />
                  </svg>
                )}
              />

              <ChoiceCard
                title="Blank form"
                description="Start with an empty form and add your own fields."
                actionLabel="Create blank"
                tone="slate"
                disabled={generating}
                onClick={startBlank}
                icon={(
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                )}
              />
            </div>
          </div>
        )}

        {view === 'ai' && (
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <div className="rounded-xl border border-line bg-surface-2/60 p-4 sm:p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-fg">What should this form collect?</h3>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">
                    Include the purpose, important fields, approvals, or sections you already know about.
                  </p>
                </div>
                <span className="mt-2 w-fit rounded-full border border-success-line bg-success-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-success-fg sm:mt-0">
                  Editable draft
                </span>
              </div>

              <label className="sr-only" htmlFor="new-form-ai-prompt">Describe the form to generate</label>
              <div className="relative mt-4 min-w-0 rounded-xl border border-line bg-surface focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200">
                {suggestion ? (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap px-4 py-3 text-sm leading-6">
                    <span className="invisible">{quickPrompt}</span>
                    <span className="text-fg-subtle">{suggestion}</span>
                  </div>
                ) : null}
                <textarea
                  id="new-form-ai-prompt"
                  ref={promptInputRef}
                  rows={5}
                  value={quickPrompt}
                  onChange={onPromptChange}
                  onKeyDown={onPromptKeyDown}
                  onBlur={() => setSuggestion('')}
                  placeholder="For example: Create an employee onboarding form with personal details, equipment requirements, and manager approval."
                  disabled={!aiAvailable || generating}
                  autoComplete="off"
                  className="relative z-10 block w-full resize-none rounded-xl bg-transparent px-4 py-3 text-sm leading-6 text-fg placeholder:text-fg-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-medium text-fg-muted">Try an example:</span>
                {AI_PROMPT_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={generating}
                    onClick={() => applyPromptExample(example)}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted transition hover:border-info-line hover:bg-info-subtle hover:text-info-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>

              {aiAvailable && !genError && (
                <p className="mt-3 text-xs text-fg-subtle">
                  Press Tab or Right Arrow to accept autocomplete. Use Ctrl or Command + Enter to generate.
                </p>
              )}
              {!aiAvailable && (
                <div className="mt-4 rounded-lg border border-warning-line bg-warning-subtle px-3 py-2 text-xs font-medium text-warning-fg">
                  {aiUnavailableReason}
                </div>
              )}
              {genError && (
                <div role="alert" className="mt-4 rounded-lg border border-danger-line bg-danger-subtle px-3 py-2 text-xs font-medium text-danger-fg">
                  {genError}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-fg-subtle">You can review and edit every generated field before publishing.</p>
              <button
                type="button"
                onClick={startQuickGenerate}
                disabled={!canGenerate}
                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {generating ? 'Generating...' : 'Generate form'}
              </button>
            </div>
          </div>
        )}

        {view === 'document' && (
          <DocumentFormGenerator
            onCancel={() => setView('home')}
            onComplete={openDocumentDraft}
          />
        )}

        {view === 'templates' && (
          <div className="px-6 py-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {FORM_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => startTemplate(t.id)}
                  className="group rounded-lg border border-line p-3 text-left transition hover:border-info-line hover:bg-info-subtle/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-fg group-hover:text-indigo-700">{t.name}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${categoryBadge(t.category)}`}>
                      {t.category}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-subtle">{t.fields.length} fields</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
