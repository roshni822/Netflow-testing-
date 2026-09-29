import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { workflowsStore } from '../lib/workflowsStore'
import { useDepartmentNames } from '../lib/departmentsStore'
import { useForms, formsStore } from '../lib/formsStore'
import { api } from '../utils/api'
import NodeTypesSidebar from './WorkflowCanvas/NodeTypesSidebar'
import WorkflowEditor from './WorkflowCanvas/WorkflowEditor'
import NodeConfig from './WorkflowCanvas/NodeConfig'
import { NODE_DEFAULTS, NODE_STYLES, createNodeId } from './WorkflowCanvas/nodeStyles'
import { confirm } from '../lib/confirmStore'
import { toast } from '../lib/toastStore'
import { limitBanner } from '../lib/limitFeedback'
import { AlertBanner } from '../components/Alert'
import { createDraftStore, useBeforeUnloadWarning } from '../utils/localDraft'
import { fetchAllUsers } from '../utils/users'
import { useFocusTrap, useScrollLock } from '../utils/a11y'

const apiBase = () => String(import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '')

const draftStore = createDraftStore('netflow.workflow.draft.v1')
const readDraft = () => {
  const d = draftStore.read()
  return d?.data?.settings ? d : null
}

function webhookUrlFor(token) {
  if (!token) return ''
  return `${apiBase()}/api/hooks/${token}`
}

function PublishSuccessModal({ open, name, webhookUrl, secret, onClose, onGoToList }) {
  const panelRef = useRef(null)
  useScrollLock(open)
  useFocusTrap(open, panelRef, { onEscape: onClose })

  if (!open) return null
  const copy = async (text, label) => {
    try {
      await navigator.clipboard?.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`)
    }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-success-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl bg-surface border border-line shadow-xl overflow-hidden focus:outline-none"
      >
        <div className="px-5 py-4 border-b border-line flex items-start gap-3">
          <span className="mt-0.5 w-8 h-8 rounded-full bg-success-subtle text-success-fg flex items-center justify-center text-sm font-bold shrink-0">
            ✓
          </span>
          <div className="min-w-0">
            <h2 id="publish-success-title" className="text-base font-semibold text-fg">Workflow published</h2>
            <p className="text-sm text-fg-muted mt-0.5 truncate">
              {name || 'Untitled workflow'} is live.
              {webhookUrl ? ' Copy the webhook credentials below for your external form.' : ''}
            </p>
          </div>
        </div>
        {webhookUrl ? (
          <div className="px-5 py-4 space-y-3">
            <div>
              <label htmlFor="publish-webhook-url" className="block text-xs font-medium text-fg-muted mb-1">Webhook URL</label>
              <div className="flex gap-2">
                <input
                  id="publish-webhook-url"
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="flex-1 px-3 py-2 text-xs font-mono rounded-md border border-line bg-surface-2 text-fg"
                />
                <button
                  type="button"
                  onClick={() => copy(webhookUrl, 'Webhook URL')}
                  className="shrink-0 px-3 py-2 text-xs font-medium rounded-md border border-line bg-surface hover:bg-surface-2 text-fg"
                >
                  Copy
                </button>
              </div>
            </div>
            {secret ? (
              <div>
                <label htmlFor="publish-signing-secret" className="block text-xs font-medium text-fg-muted mb-1">Signing secret</label>
                <div className="flex gap-2">
                  <input
                    id="publish-signing-secret"
                    type="text"
                    readOnly
                    value={secret}
                    className="flex-1 px-3 py-2 text-xs font-mono rounded-md border border-line bg-surface-2 text-fg"
                  />
                  <button
                    type="button"
                    onClick={() => copy(secret, 'Signing secret')}
                    className="shrink-0 px-3 py-2 text-xs font-medium rounded-md border border-line bg-surface hover:bg-surface-2 text-fg"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-fg-muted">
                  Send header <code className="text-[10px]">X-NetFlow-Signature: sha256=&lt;hmac&gt;</code> with
                  each POST. You can also find these anytime under Settings.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-2 bg-surface-2/50">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium rounded-md border border-line bg-surface hover:bg-surface-2 text-fg"
          >
            {webhookUrl ? 'Stay in editor' : 'Close'}
          </button>
          <button
            type="button"
            onClick={onGoToList}
            className="px-3 py-2 text-sm font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            Go to workflows
          </button>
        </div>
      </div>
    </div>
  )
}

function TagInput({ tags = [], onChange, inputValue, onInputChange, placeholder, className, id }) {
  const [internalInput, setInternalInput] = useState('')
  
  const isControlled = inputValue !== undefined && onInputChange !== undefined
  const input = isControlled ? inputValue : internalInput
  const setInput = isControlled ? onInputChange : setInternalInput

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  const addTag = () => {
    const parts = input.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
    if (parts.length === 0) {
      setInput('')
      return
    }
    const newTags = [...tags]
    let changed = false
    for (const p of parts) {
      if (!newTags.includes(p)) {
        newTags.push(p)
        changed = true
      }
    }
    if (changed) {
      onChange(newTags)
    }
    setInput('')
  }

  const removeTag = (indexToRemove) => {
    onChange(tags.filter((_, i) => i !== indexToRemove))
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 p-2 bg-surface-2/50 backdrop-blur-sm border border-line rounded-xl focus-within:ring-2 focus-within:ring-indigo-500/50 focus-within:bg-surface transition-all duration-300 min-h-[46px] ${className || ''}`}>
      {tags.map((tag, i) => (
        <span 
          key={i} 
          className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/60 dark:bg-black/20 backdrop-blur-md border border-white/50 dark:border-white/10 text-fg text-[13px] font-medium shadow-sm hover:-translate-y-0.5 hover:shadow-md hover:bg-white/80 dark:hover:bg-black/40 transition-all duration-300 ease-out cursor-default"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(i)}
            className="hover:bg-black/5 dark:hover:bg-white/10 rounded-full p-0.5 transition-colors text-fg-muted group-hover:text-danger-fg focus:outline-none focus:ring-2 focus:ring-danger-fg/50"
            aria-label={`Remove ${tag}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-fg focus:outline-none px-1 py-1 placeholder:text-fg-subtle"
      />
    </div>
  )
}

const TEMPLATES = [
  {
    id: 'leave',
    title: 'Leave approval',
    subtitle: 'Employee → Manager → HR two-step leave flow',
    icon: 'calendar',
    iconClass: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
    defaults: {
      name: 'Leave Approval Workflow',
      category: 'HR',
      description: 'Two-step leave request flow with manager and HR approval gates.',
      formHint: 'leave',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Manager review', subtitle: 'Approval node · 24h SLA', x: 300, y: 120, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours', onBreach: 'Escalate to admin', sequential: true },
        { id: 'n3', type: 'condition', title: 'Decision', subtitle: 'Approved / Rejected', x: 300, y: 230, branches: ['Approved', 'Rejected'] },
        { id: 'n4', type: 'notify', title: 'Notify reject', subtitle: 'Email + in-app', x: 110, y: 340, channels: ['Email', 'In-app'] },
        { id: 'n5', type: 'approval', title: 'HR approval', subtitle: 'Approval node · 48h SLA', x: 470, y: 340, approverRole: 'hr_admin', slaValue: 48, slaUnit: 'Hours', onBreach: 'Escalate to admin' },
        { id: 'n6', type: 'end', title: 'Approved', subtitle: 'Generate PDF', x: 470, y: 440 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4', dashed: true },
        { from: 'n3', to: 'n5' },
        { from: 'n5', to: 'n6' },
      ],
    },
  },
  {
    id: 'expense',
    title: 'Expense reimbursement',
    subtitle: 'Submit receipts, manager sign-off, finance payout',
    icon: 'receipt',
    iconClass: 'bg-success-subtle text-success-fg',
    defaults: {
      name: 'Expense Reimbursement',
      category: 'Finance',
      description: 'Receipt submission → manager approval → finance payout.',
      formHint: 'expense',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Manager sign-off', subtitle: 'Approval node · 24h SLA', x: 300, y: 130, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n3', type: 'approval', title: 'Finance payout', subtitle: 'Approval node · 48h SLA', x: 300, y: 240, approverRole: 'finance_manager', slaValue: 48, slaUnit: 'Hours' },
        { id: 'n4', type: 'end', title: 'Reimbursed', subtitle: 'Generate PDF', x: 300, y: 350 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
      ],
    },
  },
  {
    id: 'it',
    title: 'IT access request',
    subtitle: 'Software / hardware provisioning approval',
    icon: 'key',
    iconClass: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
    defaults: {
      name: 'IT Access Request',
      category: 'IT',
      description: 'Software / hardware provisioning approval flow.',
      formHint: 'access',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Manager approval', subtitle: 'Approval node · 24h SLA', x: 300, y: 130, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n3', type: 'approval', title: 'IT provisioning', subtitle: 'Approval node · 24h SLA', x: 300, y: 240, approverRole: 'it_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n4', type: 'notify', title: 'Notify requester', subtitle: 'Email + in-app', x: 300, y: 350, channels: ['Email', 'In-app'] },
        { id: 'n5', type: 'end', title: 'Access granted', subtitle: 'Finish', x: 300, y: 450 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
      ],
    },
  },
  {
    id: 'po',
    title: 'Purchase order',
    subtitle: 'Multi-tier PO approval with CFO escalation',
    icon: 'cart',
    iconClass: 'bg-warning-subtle text-warning-fg',
    defaults: {
      name: 'Purchase Order',
      category: 'Finance',
      description: 'Multi-tier PO approval with CFO escalation over $10k.',
      formHint: 'purchase',
      nodes: [
        { id: 'n1', type: 'start', title: 'PO submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Dept head approval', subtitle: 'Approval node · 24h SLA', x: 300, y: 130, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n3', type: 'condition', title: 'Amount > $10k?', subtitle: 'Branch logic', x: 300, y: 240, branches: ['Yes', 'No'] },
        { id: 'n4', type: 'approval', title: 'CFO approval', subtitle: 'Approval node · 48h SLA', x: 470, y: 350, approverRole: 'ceo', slaValue: 48, slaUnit: 'Hours' },
        { id: 'n5', type: 'end', title: 'PO issued', subtitle: 'Generate PDF', x: 300, y: 460 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n3', to: 'n5', dashed: true },
        { from: 'n4', to: 'n5' },
      ],
    },
  },
  {
    id: 'onboarding',
    title: 'Onboarding checklist',
    subtitle: 'New hire document collection and sign-offs',
    icon: 'userPlus',
    iconClass: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300',
    defaults: {
      name: 'Onboarding Checklist',
      category: 'HR',
      description: 'New hire document collection and sign-offs.',
      formHint: 'onboarding',
      nodes: [
        { id: 'n1', type: 'start', title: 'New hire created', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'notify', title: 'Send docs to hire', subtitle: 'Email + in-app', x: 300, y: 130, channels: ['Email', 'In-app'] },
        { id: 'n3', type: 'approval', title: 'HR verification', subtitle: 'Approval node · 24h SLA', x: 300, y: 240, approverRole: 'hr_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n4', type: 'timer', title: 'Wait 24h', subtitle: 'Delay', x: 300, y: 350, waitValue: 24, waitUnit: 'Hours' },
        { id: 'n5', type: 'end', title: 'Onboarded', subtitle: 'Finish', x: 300, y: 450 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
      ],
    },
  },
  {
    id: 'scratch',
    title: 'Start from scratch',
    subtitle: 'Build a custom workflow from an empty canvas',
    icon: 'plus',
    iconClass: 'bg-surface-3 text-fg-muted',
    defaults: {
      name: '',
      category: 'HR',
      description: '',
      formHint: '',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 320, y: 80 },
        { id: 'n2', type: 'end', title: 'Completed', subtitle: 'Finish', x: 320, y: 220 },
      ],
      connections: [{ from: 'n1', to: 'n2' }],
    },
  },
]

function templateMeta(nodes = []) {
  const steps = nodes.length
  const approvals = nodes.filter((n) => n.type === 'approval' || n.type === 'multiApproval').length
  const branching = nodes.some((n) => n.type === 'condition')
  const parts = [
    `${steps} step${steps === 1 ? '' : 's'}`,
    `${approvals} approval${approvals === 1 ? '' : 's'}`,
  ]
  if (branching) parts.push('branching')
  return parts.join(' · ')
}

function TemplateIcon({ name, className = 'w-5 h-5' }) {
  const props = {
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    fill: 'none',
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    strokeWidth: '2',
    'aria-hidden': 'true',
  }
  switch (name) {
    case 'calendar':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )
    case 'receipt':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
        </svg>
      )
    case 'key':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      )
    case 'cart':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    case 'userPlus':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      )
  }
}

// The category *is* the owning department (it saves to Workflow.department), so
// both pickers read the tenant's own list from useDepartmentNames() rather than
// a constant — an org that renamed "Finance" to "Commercial" must not be shown
// a category it no longer uses.

// 'Manual trigger only' saves the linked form submission but does NOT auto-fire
// the workflow — it can be started later via the execute endpoint instead.
const TRIGGER_OPTIONS = [
  'Every form submission',
  'Manual trigger only',
]

const SUBMITTER_OPTIONS = ['All employees', 'Managers only', 'Specific people']

const SLA_OPTIONS = ['Always', 'After first breach', 'Never']

function Step1Template({
  selected,
  onSelect,
  aiAvailable,
  aiPrompt,
  onAiPromptChange,
  onAiKeyDown,
  aiSuggestion,
  aiBusy,
  generateWithAI,
  aiError,
  showAiPanel,
  setShowAiPanel,
  aiInputRef,
}) {
  const prebuilt = TEMPLATES.filter((t) => t.id !== 'scratch')
  const scratch = TEMPLATES.find((t) => t.id === 'scratch')
  const scratchSelected = selected === 'scratch'

  return (
    <div className="max-w-5xl mx-auto pb-10">
      <h2 className="text-2xl font-bold tracking-tight text-fg mb-6">Choose a template</h2>

      <div className="flex flex-nowrap overflow-x-auto gap-4 snap-x snap-mandatory pb-4 -mx-1 px-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {prebuilt.map((t) => {
          const isSelected = selected === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setShowAiPanel(false)
                onSelect(t.id)
              }}
              aria-pressed={isSelected}
              className={`shrink-0 w-[280px] snap-start group relative text-left p-5 rounded-xl border bg-surface shadow-sm transition ${
                isSelected && !showAiPanel
                  ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/10'
                  : 'border-line hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500/40'
              }`}
            >
              <span
                className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
                  isSelected && !showAiPanel
                    ? 'border-indigo-600 bg-indigo-600'
                    : 'border-line bg-surface group-hover:border-indigo-300'
                }`}
                aria-hidden="true"
              >
                {isSelected && !showAiPanel && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>

              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${t.iconClass}`}>
                <TemplateIcon name={t.icon} />
              </div>
              <p className="font-semibold text-fg pr-6">{t.title}</p>
              <p className="mt-3 pt-3 border-t border-line text-xs text-fg-subtle">
                {templateMeta(t.defaults.nodes)}
              </p>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 my-7">
        <hr className="flex-1 border-line" />
        <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">or</span>
        <hr className="flex-1 border-line" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {aiAvailable && (
          <button
            type="button"
            onClick={() => {
              setShowAiPanel(true)
              onSelect('ai_generated')
            }}
            aria-pressed={showAiPanel}
            className={`w-full flex items-center gap-4 text-left px-5 py-4 rounded-xl border-2 transition ${
              showAiPanel
                ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/10 shadow-sm'
                : 'border-line bg-surface hover:border-indigo-300 dark:hover:border-indigo-500/40'
            }`}
          >
            <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 font-semibold text-fg">Build with AI</span>
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition ${
                showAiPanel
                  ? 'bg-indigo-600 text-white'
                  : 'border-2 border-line text-transparent'
              }`}
              aria-hidden="true"
            >
              {showAiPanel && (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          </button>
        )}

        {scratch && (
          <button
            type="button"
            onClick={() => {
              setShowAiPanel(false)
              onSelect(scratch.id)
            }}
            aria-pressed={scratchSelected && !showAiPanel}
            className={`w-full flex items-center gap-4 text-left px-5 py-4 rounded-xl border-2 border-dashed transition ${
              scratchSelected && !showAiPanel
                ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/10'
                : 'border-line bg-surface hover:border-indigo-300 dark:hover:border-indigo-500/40'
            }`}
          >
            <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${scratch.iconClass}`}>
              <TemplateIcon name={scratch.icon} />
            </span>
            <span className="min-w-0 flex-1 font-semibold text-fg">{scratch.title}</span>
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition ${
                scratchSelected && !showAiPanel
                  ? 'bg-indigo-600 text-white'
                  : 'border-2 border-line text-transparent'
              }`}
              aria-hidden="true"
            >
              {scratchSelected && !showAiPanel && (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          </button>
        )}
      </div>

      {showAiPanel && (
        <div className="mt-8 p-6 rounded-2xl bg-surface border border-line shadow-sm">
          <label htmlFor="ai-workflow-prompt" className="block text-sm font-semibold text-fg mb-2">
            What kind of workflow do you need?
          </label>
          <p className="text-sm text-fg-subtle mb-4">
            Describe the process in plain English, and our AI will build a draft for you.
          </p>
          
          <div className="relative">
            {aiSuggestion && (
              <div
                className="absolute inset-0 pointer-events-none px-4 py-3 text-sm font-mono whitespace-pre-wrap break-words"
                aria-hidden="true"
              >
                <span className="invisible">{aiPrompt}</span>
                <span className="text-fg-subtle">{aiSuggestion}</span>
              </div>
            )}
            <textarea
              id="ai-workflow-prompt"
              ref={aiInputRef}
              rows={4}
              value={aiPrompt}
              onChange={onAiPromptChange}
              onKeyDown={onAiKeyDown}
              onBlur={() => onAiPromptChange({ target: { value: aiPrompt } })}
              disabled={aiBusy}
              aria-label="Workflow description for AI"
              placeholder="e.g. A purchase order request that needs department head approval, and CFO approval if the amount is over $10k."
              className="w-full relative z-10 bg-transparent text-fg px-4 py-3 text-sm font-mono rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none placeholder:text-fg-subtle/50 transition-shadow disabled:opacity-50"
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-fg-subtle">
              Press <kbd className="font-mono bg-surface-2 px-1 py-0.5 rounded border border-line">Tab</kbd> to accept suggestions.
            </p>
            <button
              type="button"
              onClick={generateWithAI}
              disabled={aiBusy || !aiPrompt.trim()}
              className="px-6 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm flex items-center gap-2"
            >
              {aiBusy ? (
                <>
                  <svg className="animate-spin w-4 h-4 text-white/70" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating...
                </>
              ) : (
                'Generate Workflow'
              )}
            </button>
          </div>
          {aiError && <p className="mt-3 text-xs text-danger-fg">{aiError}</p>}
        </div>
      )}
    </div>
  )
}

// "Tail" = best node to extend the chain from when the user clicks a node
// type in the palette. Preference: the currently-selected node, else the most
// recently added non-end node, else the last node, else nothing. We never
// extend out of an `end` node because by definition the flow has finished.
const pickTailNode = (nodes, selectedNodeId) => {
  if (nodes.length === 0) return null
  if (selectedNodeId) {
    const sel = nodes.find((n) => n.id === selectedNodeId)
    if (sel && sel.type !== 'end') return sel
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].type !== 'end') return nodes[i]
  }
  return nodes[nodes.length - 1]
}

const GRID = 10
const snap = (v) => Math.round(v / GRID) * GRID

// Decision / Review need tagged approve|reject edges. A plain drag from those
// nodes gets the next free branch so a dashed “looks connected” line isn’t left
// untagged (which would fail at publish / runtime).
function withBranchIfNeeded(fromNode, conn, existing) {
  if (!fromNode || (fromNode.type !== 'condition' && fromNode.type !== 'review')) {
    return conn
  }
  if (conn.branch === 'approve' || conn.branch === 'reject') return conn
  const outs = existing.filter((c) => c.from === conn.from)
  const hasApprove = outs.some((c) => c.branch === 'approve' || (!c.branch && !c.dashed))
  const hasReject = outs.some((c) => c.branch === 'reject' || c.dashed)
  if (!hasApprove) return { ...conn, branch: 'approve', dashed: false }
  if (!hasReject) return { ...conn, branch: 'reject', dashed: true }
  return conn
}

function Step2Builder({ data, setData, fitKey = 0 }) {
  const { nodes, connections, selectedNodeId } = data
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null
  const [isMaximized, setIsMaximized] = useState(false)
  const flowProblems = useMemo(
    () => graphIssues(nodes, connections),
    [nodes, connections]
  )
  const problemNodeIds = useMemo(() => {
    const ids = new Set()
    for (const issue of flowProblems) {
      for (const id of issue.nodeIds || []) ids.add(id)
    }
    return ids
  }, [flowProblems])

  const selectNode = (id) => setData((d) => ({ ...d, selectedNodeId: id }))

  const updateNode = (updated) =>
    setData((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === updated.id ? updated : n)) }))

  // Snap to a 10px grid so hand-placed nodes still line up with each other.
  const moveNode = (id, x, y) =>
    setData((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, x: snap(x), y: snap(y) } : n)),
    }))

  const deleteNode = (id) =>
    setData((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== id),
      connections: d.connections.filter((c) => c.from !== id && c.to !== id),
      selectedNodeId: d.selectedNodeId === id ? null : d.selectedNodeId,
    }))

  // Drag-and-drop from the palette: place exactly where the user dropped it,
  // no auto-connect (user is positioning manually).
  const addNodeAt = (type, x, y) => {
    const def = NODE_DEFAULTS[type] || {}
    const id = createNodeId()
    const node = { id, type, x: snap(x), y: snap(y), ...def }
    setData((d) => ({ ...d, nodes: [...d.nodes, node], selectedNodeId: id }))
  }

  // Click from the palette: smart insert. Drops below the tail node and
  // auto-connects from it so a click stream builds a chain step by step.
  const addNodeAfterTail = (type) => {
    const def = NODE_DEFAULTS[type] || {}
    const id = createNodeId()

    setData((d) => {
      const tail = pickTailNode(d.nodes, d.selectedNodeId)
      const x = tail ? tail.x : 300
      // Flow new nodes straight down. The canvas is a large pannable world now,
      // so we only cap near the world's bottom (use Fit/zoom to see them all).
      const y = tail ? Math.min(tail.y + 120, 3900) : 40
      const node = { id, type, x, y, ...def }

      // Skip auto-connect if the tail already has an outgoing edge to avoid
      // silently inserting a stray branch — user can wire it manually.
      const tailHasOutgoing =
        tail && d.connections.some((c) => c.from === tail.id)

      let nextConnections = d.connections
      if (tail && !tailHasOutgoing) {
        const conn = withBranchIfNeeded(tail, { from: tail.id, to: id }, d.connections)
        nextConnections = [...d.connections, conn]
      }

      return {
        ...d,
        nodes: [...d.nodes, node],
        connections: nextConnections,
        selectedNodeId: id,
      }
    })
  }

  const addConnection = (conn) =>
    setData((d) => {
      const fromNode = d.nodes.find((n) => n.id === conn.from)
      const next = withBranchIfNeeded(fromNode, conn, d.connections)
      return { ...d, connections: [...d.connections, next] }
    })

  const deleteConnection = (idx) =>
    setData((d) => ({ ...d, connections: d.connections.filter((_, i) => i !== idx) }))

  const setConnections = (next) =>
    setData((d) => ({ ...d, connections: typeof next === 'function' ? next(d.connections) : next }))

  const jumpToProblem = (issue) => {
    const id = issue?.nodeIds?.[0]
    if (id) selectNode(id)
  }

  return (
    <div className={`bg-surface overflow-hidden transition-all duration-300 ${isMaximized ? 'fixed inset-0 z-50 flex flex-col' : 'flex-1 min-h-0 flex flex-col'}`}>
      <div className="flex flex-1 min-h-0">
        {!isMaximized && <NodeTypesSidebar onAddNode={addNodeAfterTail} />}
        <WorkflowEditor
          isMaximized={isMaximized}
          onToggleMaximize={() => setIsMaximized(m => !m)}
          fitKey={fitKey}
          nodes={nodes}
          connections={connections}
          selectedNodeId={selectedNodeId}
          problemNodeIds={problemNodeIds}
          flowProblems={flowProblems}
          onSelectProblem={jumpToProblem}
          onSelectNode={selectNode}
          onMoveNode={moveNode}
          onDropNewNode={addNodeAt}
          onDeleteNode={deleteNode}
          onAddConnection={addConnection}
          onDeleteConnection={deleteConnection}
        />
        {!isMaximized && (
          <NodeConfig
            node={selectedNode}
            onChange={updateNode}
            nodes={nodes}
            connections={connections}
            onConnectionsChange={setConnections}
            onClose={() => selectNode(null)}
          />
        )}
      </div>
    </div>
  )
}

function Section({ title, description, icon, children }) {
  return (
    <section className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-line bg-surface-2/40 flex items-start gap-3">
        {icon && (
          <span className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 flex items-center justify-center shrink-0 ring-1 ring-indigo-100 dark:ring-indigo-500/30">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg tracking-tight">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-fg-muted leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      <div className="p-5 sm:p-6 space-y-5">{children}</div>
    </section>
  )
}

function FieldLabel({ htmlFor, children, hint, className = '' }) {
  return (
    <div className={`mb-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {children}
      </label>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  )
}

function ToggleRow({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface-2/40 px-4 py-3 cursor-pointer hover:bg-surface-2 transition">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="block mt-0.5 text-xs text-fg-muted leading-relaxed">{hint}</span>}
      </span>
      <span className="relative inline-flex shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="peer sr-only"
        />
        <span className="w-10 h-6 rounded-full bg-line peer-checked:bg-indigo-600 transition" />
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
    </label>
  )
}

function Step3Settings({ data, setData, forms, editId }) {
  const { settings } = data
  const orgDepartments = useDepartmentNames()
  // A workflow written before a department was renamed still names the old one;
  // keep it in the list so opening the page does not quietly re-file the flow.
  const categories = useMemo(
    () => (settings.category && !orgDepartments.includes(settings.category)
      ? [...orgDepartments, settings.category]
      : orgDepartments),
    [orgDepartments, settings.category]
  )
  const update = (patch) => setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
  // A brand-new workflow starts with no category; once the tenant's list
  // arrives, file it under the first team rather than showing an empty select.
  useEffect(() => {
    if (!settings.category && orgDepartments.length) setData(d => ({ ...d, settings: { ...d.settings, category: orgDepartments[0] } }))
  }, [settings.category, orgDepartments, setData])
  const updateAdvanced = (patch) =>
    setData((d) => ({
      ...d,
      settings: { ...d.settings, advanced: { ...d.settings.advanced, ...patch } },
    }))
  const updateWebhook = (patch) =>
    update({ inboundWebhook: { ...(settings.inboundWebhook || {}), ...patch } })

  const [users, setUsers] = useState([])
  const [deliveries, setDeliveries] = useState([])
  const [dlq, setDlq] = useState([])
  const [showSecret, setShowSecret] = useState(false)
  const [aiStatus, setAiStatus] = useState(null)
  const [isGeneratingForm, setIsGeneratingForm] = useState(false)
  const [isAiModalOpen, setIsAiModalOpen] = useState(false)
  const [aiModalTab, setAiModalTab] = useState('auto')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiDraft, setAiDraft] = useState(null)
  const [aiPreviewActivePage, setAiPreviewActivePage] = useState(1)
  const [editingIndex, setEditingIndex] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  const [addingNew, setAddingNew] = useState(false)
  const [newField, setNewField] = useState({ label: '', type: 'text', required: false })
  

  useEffect(() => {
    let cancelled = false
    fetchAllUsers({ isActive: true })
      .then((d) => { if (!cancelled) setUsers(d.users || []) })
      .catch(() => {})
      
    api.get('/api/workflows/ai-status')
      .then((res) => { if (!cancelled) setAiStatus(res) })
      .catch(() => {})
      
    return () => { cancelled = true }
  }, [])

  const handleGeneratePreview = async () => {
    const finalPrompt = aiModalTab === 'auto' 
      ? `Create a form for a workflow named: ${settings.name || 'Workflow'}`
      : aiPrompt

    if (!finalPrompt.trim()) return toast.error('Please enter a prompt first.')

    setIsGeneratingForm(true)
    try {
      const draft = await api.post('/api/forms/ai-draft', { prompt: finalPrompt })
      setAiDraft(draft)
    } catch (err) {
      console.error('Auto-generate error:', err)
      toast.error(err.message || 'Failed to auto-generate form preview.')
    } finally {
      setIsGeneratingForm(false)
    }
  }

  const handleApproveAndPublish = async () => {
    if (!aiDraft) return
    setIsGeneratingForm(true)
    try {
      const newFieldId = () =>
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

      const fieldsWithIds = (aiDraft.fields || []).map(f => ({
        ...f,
        id: f.id || newFieldId()
      }))

      const newForm = await formsStore.add({
        name: aiDraft.title || `${settings.name || 'Workflow'} Form`,
        description: aiDraft.description || '',
        category: settings.category || '',
        fields: fieldsWithIds
      })

      if (newForm && newForm.id) {
        await formsStore.publish(newForm.id)
        
        const linkedIds = settings.linkedFormIds?.length
          ? settings.linkedFormIds.map(String)
          : (settings.linkedFormId ? [String(settings.linkedFormId)] : [])
        
        const nextIds = [...linkedIds, String(newForm.id)]
        update({ linkedFormIds: nextIds, linkedFormId: nextIds[0] || null })
        toast.success('Form automatically generated, published, and linked!')
        setIsAiModalOpen(false)
        setAiDraft(null)
        setAiPrompt('')
      }
    } catch (err) {
      console.error('Publish error:', err)
      toast.error(err.message || 'Failed to publish form.')
    } finally {
      setIsGeneratingForm(false)
    }
  }

  useEffect(() => {
    if (!editId || !settings.inboundWebhook?.enabled) return
    let cancelled = false
    Promise.all([
      api.get(`/api/workflows/${editId}/webhook-deliveries?limit=20`).catch(() => ({ deliveries: [] })),
      api.get(`/api/workflows/${editId}/integration-dlq?limit=20`).catch(() => ({ items: [] })),
    ]).then(([d, q]) => {
      if (cancelled) return
      setDeliveries(d.deliveries || [])
      setDlq(q.items || [])
    })
    return () => { cancelled = true }
  }, [editId, settings.inboundWebhook?.enabled])

  const allowedInitiators = settings.allowedInitiators || []
  const addInitiator = (id) => {
    if (id && !allowedInitiators.includes(id)) {
      update({ allowedInitiators: [...allowedInitiators, id] })
    }
  }
  const removeInitiator = (id) =>
    update({ allowedInitiators: allowedInitiators.filter((x) => x !== id) })

  const visibleTo = settings.visibleTo || []
  const addVisiblePerson = (id) => {
    if (id && !visibleTo.includes(id)) update({ visibleTo: [...visibleTo, id] })
  }
  const removeVisiblePerson = (id) =>
    update({ visibleTo: visibleTo.filter((x) => x !== id) })

  const publishedForms = forms.filter((f) => f.status === 'Published')

  const toggleDept = (dept) => {
    const has = settings.visibleDepartments.includes(dept)
    update({
      visibleDepartments: has
        ? settings.visibleDepartments.filter((d) => d !== dept)
        : [...settings.visibleDepartments, dept],
    })
  }

  const inputCls =
    'w-full px-3.5 py-2.5 text-sm rounded-lg border border-line bg-surface text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition'
  const btnGhost =
    'shrink-0 px-3 py-2.5 text-xs font-semibold rounded-lg border border-line bg-surface hover:bg-surface-2 text-fg transition'

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-2">
      <h2 className="text-2xl font-bold tracking-tight text-fg">Settings</h2>

      <Section
        title="Basic info"
        icon={(
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="wf-name">Workflow name</FieldLabel>
            <input
              id="wf-name"
              type="text"
              value={settings.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Leave Approval Workflow"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="wf-description">Description</FieldLabel>
            <textarea
              id="wf-description"
              rows={2}
              value={settings.description}
              onChange={(e) => update({ description: e.target.value })}
              className={`${inputCls} resize-none`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="wf-category">Category (Department)</FieldLabel>
            <select
              id="wf-category"
              value={settings.category}
              onChange={(e) => update({ category: e.target.value })}
              className={inputCls}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="wf-tags" >Tags</FieldLabel>
            <TagInput
              id="wf-tags"
              tags={settings.tags || []}
              onChange={(tags) => update({ tags })}
              inputValue={settings.tagInput || ''}
              onInputChange={(tagInput) => update({ tagInput })}
              placeholder="e.g. Urgent, Setup, HR"
            />
          </div>
        </div>
      </Section>

      <Section
        title="Form & trigger"
        icon={(
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
      >
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel htmlFor="wf-linked-forms" className="mb-0">Linked forms</FieldLabel>
              {aiStatus?.aiConfigured && (
                <button
                  type="button"
                  onClick={() => setIsAiModalOpen(true)}
                  disabled={!settings.name}
                  className="text-[13px] font-medium flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 transition -mt-1.5"
                >
                  ✨ Auto-generate Form
                </button>
              )}
            </div>
            {(() => {
              const linkedIds = settings.linkedFormIds?.length
                ? settings.linkedFormIds.map(String)
                : (settings.linkedFormId ? [String(settings.linkedFormId)] : [])
              return (
                <>
            <select
              id="wf-linked-forms"
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                if (linkedIds.includes(id)) return
                const next = [...linkedIds, id]
                update({ linkedFormIds: next, linkedFormId: next[0] || null })
                e.target.value = ''
              }}
              className={inputCls}
            >
              <option value="">+ Add a published form…</option>
              {publishedForms
                .filter((f) => !linkedIds.includes(String(f.id)))
                .map((f) => (
                  <option key={f.id} value={f.id}>{f.title}</option>
                ))}
            </select>
            {publishedForms.length === 0 && (
              <p className="mt-1.5 text-xs text-warning-fg">No published forms yet.</p>
            )}
            {linkedIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {linkedIds.map((id) => {
                  const f = publishedForms.find((x) => String(x.id) === String(id))
                    || forms.find((x) => String(x.id) === String(id))
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs rounded-md border border-info-line bg-info-subtle text-info-fg"
                    >
                      {f ? f.title : 'Unknown form'}
                      <button
                        type="button"
                        onClick={() => {
                          const next = linkedIds.filter((x) => String(x) !== String(id))
                          update({ linkedFormIds: next, linkedFormId: next[0] || null })
                        }}
                        className="w-4 h-4 rounded hover:brightness-95 flex items-center justify-center text-info-fg"
                        aria-label="Remove form"
                      >
                        &times;
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
                </>
              )
            })()}
          </div>
          <div>
            <FieldLabel htmlFor="wf-trigger-on">Trigger on</FieldLabel>
            <select
              id="wf-trigger-on"
              value={settings.triggerOn}
              onChange={(e) => update({ triggerOn: e.target.value })}
              className={inputCls}
            >
              {TRIGGER_OPTIONS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <ToggleRow
          checked={settings.preventDuplicates}
          onChange={(e) => update({ preventDuplicates: e.target.checked })}
          label="Block duplicate submissions (per user / day)"
        />
      </Section>

      <Section
        title="Inbound webhook"
        icon={(
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
      >
        <ToggleRow
          checked={!!settings.inboundWebhook?.enabled}
          onChange={(e) =>
            update({
              inboundWebhook: {
                ...(settings.inboundWebhook || {}),
                enabled: e.target.checked,
              },
            })
          }
          label="Enable inbound webhook"
        />
        {settings.inboundWebhook?.enabled && (
          <div className="space-y-3">
            {settings.inboundWebhook?.token ? (
              <>
                <div>
                  <FieldLabel htmlFor="wf-webhook-url">Webhook URL</FieldLabel>
                  <div className="flex gap-2">
                    <input
                      id="wf-webhook-url"
                      type="text"
                      readOnly
                      value={webhookUrlFor(settings.inboundWebhook.token)}
                      className={`${inputCls} font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const url = webhookUrlFor(settings.inboundWebhook.token)
                        navigator.clipboard?.writeText(url)
                        toast.success('Webhook URL copied')
                      }}
                      className={btnGhost}
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <div className="pt-2">
                  <ToggleRow
                    checked={settings.inboundWebhook?.requireSignature !== false}
                    onChange={(e) =>
                      updateWebhook({ requireSignature: e.target.checked })
                    }
                    label="Require HMAC Signature (Authentication)"
                  />
                  {settings.inboundWebhook?.requireSignature === false && (
                    <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                      <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                        Warning: Your webhook is now completely public. Anyone with the URL can trigger this workflow.
                      </p>
                    </div>
                  )}
                </div>
                {settings.inboundWebhook?.requireSignature !== false && settings.inboundWebhook?.secret && (
                  <div>
                    <FieldLabel htmlFor="wf-signing-secret">Signing secret</FieldLabel>
                    <div className="flex gap-2">
                      {/* Masked by default — this screen gets shared and
                          screen-shared far more often than the secret is read. */}
                      <input
                        id="wf-signing-secret"
                        type={showSecret ? 'text' : 'password'}
                        readOnly
                        value={settings.inboundWebhook.secret}
                        className={`${inputCls} font-mono text-xs`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((v) => !v)}
                        className={btnGhost}
                      >
                        {showSecret ? 'Hide' : 'Reveal'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(settings.inboundWebhook.secret)
                          toast.success('Signing secret copied')
                        }}
                        className={btnGhost}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <FieldLabel htmlFor="wf-callback-url">
                    Result callback URL
                  </FieldLabel>
                  <input
                    id="wf-callback-url"
                    type="url"
                    value={settings.inboundWebhook?.callbackUrl || ''}
                    onChange={(e) => updateWebhook({ callbackUrl: e.target.value })}
                    placeholder="https://friend-app.example.com/netflow-result"
                    className={inputCls}
                  />
                </div>
                <div role="group" aria-labelledby="wf-payload-contract" className="rounded-lg border border-line bg-surface-2/30 p-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span id="wf-payload-contract" className="block text-sm font-medium text-fg">Expected fields</span>
                    <button
                      type="button"
                      className="text-xs font-medium text-indigo-600"
                      onClick={() =>
                        updateWebhook({
                          expectedFields: [
                            ...(settings.inboundWebhook?.expectedFields || []),
                            { id: '', label: '', type: 'text', required: false },
                          ],
                        })
                      }
                    >
                      + Add field
                    </button>
                  </div>
                  {(settings.inboundWebhook?.expectedFields || []).length === 0 ? (
                    <p className="text-[11px] text-fg-muted">None — any JSON keys accepted.</p>
                  ) : (
                    <div className="space-y-2">
                      {(settings.inboundWebhook.expectedFields || []).map((f, i) => (
                        <div key={i} className="flex flex-wrap gap-2 items-center">
                          <input
                            className={`${inputCls} flex-1 min-w-[6rem]`}
                            placeholder="id (e.g. grnNo)"
                            value={f.id}
                            onChange={(e) => {
                              const next = [...(settings.inboundWebhook.expectedFields || [])]
                              next[i] = { ...next[i], id: e.target.value }
                              updateWebhook({ expectedFields: next })
                            }}
                          />
                          <input
                            className={`${inputCls} flex-1 min-w-[6rem]`}
                            placeholder="Label"
                            value={f.label}
                            onChange={(e) => {
                              const next = [...(settings.inboundWebhook.expectedFields || [])]
                              next[i] = { ...next[i], label: e.target.value }
                              updateWebhook({ expectedFields: next })
                            }}
                          />
                          <label className="flex items-center gap-1 text-xs text-fg">
                            <input
                              type="checkbox"
                              checked={!!f.required}
                              onChange={(e) => {
                                const next = [...(settings.inboundWebhook.expectedFields || [])]
                                next[i] = { ...next[i], required: e.target.checked }
                                updateWebhook({ expectedFields: next })
                              }}
                            />
                            Required
                          </label>
                          <button
                            type="button"
                            className="text-xs text-danger-fg"
                            onClick={() => {
                              const next = (settings.inboundWebhook.expectedFields || []).filter((_, j) => j !== i)
                              updateWebhook({ expectedFields: next })
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => updateWebhook({ regenerateToken: true })}
                  className="text-xs font-medium text-warning-fg hover:text-warning-fg"
                >
                  Regenerate token &amp; secret on next save
                </button>
                {settings.inboundWebhook?.regenerateToken && (
                  <p className="text-[11px] text-warning-fg">
                    New token &amp; secret on next save.
                  </p>
                )}
                {editId && (
                  <div className="pt-2 border-t border-line space-y-2">
                    <p className="text-xs font-semibold text-fg">Recent deliveries</p>
                    {deliveries.length === 0 ? (
                      <p className="text-[11px] text-fg-muted">None yet.</p>
                    ) : (
                      <ul className="text-[11px] space-y-1 max-h-36 overflow-y-auto">
                        {deliveries.map((d) => (
                          <li key={d._id} className="flex gap-2 flex-wrap">
                            <span className={d.ok ? 'text-success-fg' : 'text-danger-fg'}>{d.ok ? 'OK' : 'Fail'}</span>
                            <span className="text-fg-muted">{d.statusCode}</span>
                            <span className="text-fg-subtle">{d.createdAt ? new Date(d.createdAt).toLocaleString() : ''}</span>
                            {d.error && <span className="text-fg">{d.error}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs font-semibold text-fg pt-1">Dead letters</p>
                    {dlq.length === 0 ? (
                      <p className="text-[11px] text-fg-muted">None.</p>
                    ) : (
                      <ul className="text-[11px] space-y-1 max-h-36 overflow-y-auto">
                        {dlq.map((d) => (
                          <li key={d._id} className="text-warning-fg">
                            {d.nodeId}: {d.error} {d.httpStatus ? `(HTTP ${d.httpStatus})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-warning-fg">
                Save or publish to generate the webhook URL and secret.
              </p>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Access"
        icon={(
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        )}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <FieldLabel htmlFor="wf-who-can-submit">Who can submit</FieldLabel>
          <select
            id="wf-who-can-submit"
            value={settings.whoCanSubmit}
            onChange={(e) => update({ whoCanSubmit: e.target.value })}
            className={inputCls}
          >
            {SUBMITTER_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>

          {settings.whoCanSubmit === 'Specific people' && (
            <div className="mt-2 space-y-2">
              <select
                value=""
                onChange={(e) => { addInitiator(e.target.value); e.target.value = '' }}
                className={inputCls}
              >
                <option value="">+ Add a person…</option>
                {users
                  .filter((u) => !allowedInitiators.includes(String(u._id)))
                  .map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name}{u.department ? ` · ${u.department}` : ''}
                    </option>
                  ))}
              </select>

              {allowedInitiators.length === 0 ? (
                <p className="text-[11px] text-warning-fg">Add at least one person.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allowedInitiators.map((id) => {
                    const u = users.find((x) => String(x._id) === String(id))
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs rounded-md border border-info-line bg-info-subtle text-info-fg"
                      >
                        {u ? u.name : 'Unknown user'}
                        <button
                          type="button"
                          onClick={() => removeInitiator(id)}
                          className="w-4 h-4 rounded hover:brightness-95 flex items-center justify-center text-info-fg"
                          aria-label={`Remove ${u ? u.name : 'user'}`}
                        >
                          &times;
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <FieldLabel htmlFor="wf-sla-notify">SLA breach notify</FieldLabel>
          <select
            id="wf-sla-notify"
            value={settings.notifyOnSlaBreach}
            onChange={(e) => update({ notifyOnSlaBreach: e.target.value })}
            className={inputCls}
          >
            {SLA_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        </div>

        <div>
          <FieldLabel htmlFor="wf-visibility">Visibility</FieldLabel>
          <select
            id="wf-visibility"
            value={settings.visibility}
            onChange={(e) => {
              const visibility = e.target.value
              const needsSeed = visibility === 'departments' && !(settings.visibleDepartments || []).length
              update(needsSeed ? { visibility, visibleDepartments: [...orgDepartments] } : { visibility })
            }}
            className={inputCls}
          >
            <option value="company">Company-wide (everyone)</option>
            <option value="departments">Specific departments</option>
            <option value="people">Specific people</option>
          </select>

          {settings.visibility === 'departments' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {orgDepartments.map((d) => {
                const on = settings.visibleDepartments.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDept(d)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 ${
                      on
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/40'
                        : 'border-line bg-surface text-fg-muted hover:bg-surface-2'
                    }`}
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center ${
                        on ? 'bg-indigo-600 text-white' : 'border border-line'
                      }`}
                    >
                      {on && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    {d}
                  </button>
                )
              })}
            </div>
          )}

          {settings.visibility === 'people' && (
            <div className="mt-3 space-y-2">
              <select
                value=""
                onChange={(e) => {
                  addVisiblePerson(e.target.value)
                  e.target.value = ''
                }}
                className={inputCls}
              >
                <option value="">+ Add a person…</option>
                {users
                  .filter((u) => !visibleTo.includes(String(u._id)))
                  .map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name}
                      {u.department ? ` · ${u.department}` : ''}
                    </option>
                  ))}
              </select>

              {visibleTo.length === 0 ? (
                <p className="text-[11px] text-warning-fg">Add at least one person.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {visibleTo.map((id) => {
                    const u = users.find((x) => String(x._id) === String(id))
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs rounded-lg border border-info-line bg-info-subtle text-info-fg"
                      >
                        {u ? u.name : 'Unknown user'}
                        <button
                          type="button"
                          onClick={() => removeVisiblePerson(id)}
                          className="w-4 h-4 rounded hover:brightness-95 flex items-center justify-center text-info-fg"
                          aria-label="Remove person"
                        >
                          &times;
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Advanced"
        icon={(
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        )}
      >
        <div className="space-y-3">
          <ToggleRow
            checked={!!settings.advanced.allowCancel}
            onChange={(e) => updateAdvanced({ allowCancel: e.target.checked })}
            label="Allow submitter to cancel"
          />
          <ToggleRow
            checked={!!settings.advanced.autoPdf}
            onChange={(e) => updateAdvanced({ autoPdf: e.target.checked })}
            label="Auto-generate PDF on completion"
          />
        </div>
      </Section>

      {isAiModalOpen && (() => {
        const FIELD_TYPES = ['text','number','date','dropdown','radio','textarea','checkbox','file','email','phone']

        const handleDeleteField = (idx) => {
          const removed = aiDraft.fields[idx]
          setAiDraft(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== idx) }))
          if (editingIndex === idx) { setEditingIndex(null); setEditDraft({}) }
          // undo toast
          const toastId = toast(
            <div className="flex items-center gap-3">
              <span className="text-sm text-fg">Field <strong>{removed.label}</strong> removed.</span>
              <button
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline whitespace-nowrap"
                onClick={() => {
                  setAiDraft(prev => ({
                    ...prev,
                    fields: [...prev.fields.slice(0, idx), removed, ...prev.fields.slice(idx)]
                  }))
                  toast.dismiss(toastId)
                }}
              >Undo</button>
            </div>,
            { duration: 5000 }
          )
        }

        const handleStartEdit = (idx) => {
          setEditingIndex(idx)
          setEditDraft({ ...aiDraft.fields[idx] })
          setAddingNew(false)
        }

        const handleSaveEdit = (idx) => {
          if (!editDraft.label?.trim()) return
          setAiDraft(prev => ({
            ...prev,
            fields: prev.fields.map((f, i) => i === idx ? { ...f, ...editDraft } : f)
          }))
          setEditingIndex(null)
          setEditDraft({})
        }

        const handleAddField = () => {
          if (!newField.label?.trim()) return
          const maxP = Math.max(1, ...(aiDraft?.fields || []).map(f => f.page || 1))
          setAiDraft(prev => ({ ...prev, fields: [...(prev.fields || []), { ...newField, page: maxP, id: `f_${Date.now()}` }] }))
          setNewField({ label: '', type: 'text', required: false })
          setAddingNew(false)
          setAiPreviewActivePage(maxP)
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-surface border border-line rounded-lg shadow-xl w-full max-w-xl flex flex-col max-h-[90vh]">

              {/* ── Header ── */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-semibold text-fg text-base">AI Form Generator</span>
                  {aiDraft && (
                    <>
                      <svg className="w-3.5 h-3.5 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      <span className="text-fg-muted font-medium">Preview</span>
                    </>
                  )}
                </div>
                <button onClick={() => { setIsAiModalOpen(false); setEditingIndex(null); setAddingNew(false) }} className="text-fg-muted hover:text-fg transition-colors rounded-md p-1 hover:bg-surface-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* ── Body ── */}
              <div className="p-6 overflow-y-auto flex-1">
                {!aiDraft ? (
                  /* ── PROMPT SCREEN ── */
                  <>
                    <div className="flex border-b border-line mb-4">
                      <button
                        onClick={() => setAiModalTab('auto')}
                        className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${aiModalTab === 'auto' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-fg-muted hover:text-fg'}`}
                      >Auto-Generate (Fast)</button>
                      <button
                        onClick={() => setAiModalTab('custom')}
                        className={`ml-6 pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${aiModalTab === 'custom' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-fg-muted hover:text-fg'}`}
                      >Custom Prompt</button>
                    </div>
                    {aiModalTab === 'auto' ? (
                      <p className="text-sm text-fg-muted mb-4">
                        The AI will automatically generate a form based on the workflow name:<br />
                        <strong className="text-fg">{settings.name || '(No name set)'}</strong>
                      </p>
                    ) : (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-fg mb-1">Detailed Requirements</label>
                        <textarea
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          placeholder="e.g., Create a KYC form with Aadhar Number, Full Name, and a grid for address history..."
                          className="w-full h-32 px-3 py-2 text-sm bg-surface border border-line rounded-md focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none text-fg"
                        />
                      </div>
                    )}
                    <div className="flex justify-end gap-3 mt-6">
                      <button onClick={() => setIsAiModalOpen(false)} className="px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg">Cancel</button>
                      <button
                        onClick={handleGeneratePreview}
                        disabled={isGeneratingForm || (aiModalTab === 'custom' && !aiPrompt.trim())}
                        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-50 flex items-center gap-2 transition-colors"
                      >
                        {isGeneratingForm && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>}
                        Generate Preview
                      </button>
                    </div>
                  </>
                ) : (
                  /* ── EDITABLE PREVIEW SCREEN ── */
                  <>
                    {/* Form title + subtitle */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-fg text-base leading-tight">{aiDraft.title}</h4>
                        {aiDraft.description && <p className="text-xs text-fg-muted mt-0.5">Generated fields preview <span className="text-indigo-500 font-medium">(Editable)</span></p>}
                      </div>
                      {/* + Add Field button */}
                      <button
                        onClick={() => { 
                          setAddingNew(true); 
                          setEditingIndex(null);
                          const maxP = Math.max(1, ...(aiDraft?.fields || []).map(f => f.page || 1))
                          setAiPreviewActivePage(maxP)
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded-full transition-colors whitespace-nowrap ml-4 flex-shrink-0"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                        Add Field
                      </button>
                    </div>

                    {/* Fields list */}
                    {(() => {
                      const totalAiPages = Math.max(1, ...(aiDraft.fields || []).map(f => f.page || 1))
                      const pageFields = (aiDraft.fields || []).map((f, i) => ({ ...f, originalIndex: i })).filter(f => (f.page || 1) === aiPreviewActivePage)

                      return (
                        <>
                          {totalAiPages > 1 && (
                            <div className="flex px-4 border-b border-line mb-3 overflow-x-auto no-scrollbar gap-4">
                              {Array.from({ length: totalAiPages }, (_, i) => i + 1).map(p => (
                                <button
                                  key={p}
                                  onClick={() => { setAiPreviewActivePage(p); setEditingIndex(null) }}
                                  className={`py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                    aiPreviewActivePage === p
                                      ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                                      : 'border-transparent text-fg-muted hover:text-fg hover:border-line'
                                  }`}
                                >
                                  Page {p}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="border border-line rounded-lg overflow-hidden max-h-[42vh] overflow-y-auto">
                            {pageFields.length === 0 && !addingNew ? (
                              <div className="p-6 text-sm text-fg-muted italic text-center">No fields on this page. Click <strong>+ Add Field</strong> to add one.</div>
                            ) : (
                              <div className="divide-y divide-line">
                                {pageFields.map((f) => {
                                  const i = f.originalIndex
                                  return (
                                    <div key={i}>
                                      {/* Field row */}
                                      <div className={`px-4 py-3 flex items-center justify-between group transition-colors ${editingIndex === i ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-surface-2'}`}>
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="font-medium text-sm text-fg truncate">{f.label}</span>
                                          {f.required && <span className="text-red-500 text-xs font-bold flex-shrink-0">*</span>}
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                          <span className="text-xs px-2 py-0.5 bg-surface-2 rounded-full text-fg-muted border border-line capitalize font-medium">{f.type}</span>
                                          {/* Edit button */}
                                          <button
                                            onClick={() => editingIndex === i ? (setEditingIndex(null), setEditDraft({})) : handleStartEdit(i)}
                                            title="Edit field"
                                            className={`p-1.5 rounded-md transition-colors ${
                                              editingIndex === i
                                                ? 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900'
                                                : 'text-fg-muted hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 opacity-0 group-hover:opacity-100'
                                            }`}
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                          </button>
                                          {/* Delete button */}
                                          <button
                                            onClick={() => handleDeleteField(i)}
                                            title="Delete field"
                                            className="p-1.5 rounded-md text-fg-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors opacity-0 group-hover:opacity-100"
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                          </button>
                                        </div>
                                      </div>

                                      {/* Inline Edit Expand */}
                                      {editingIndex === i && (
                                        <div className="px-4 py-4 bg-indigo-50/60 dark:bg-indigo-950/30 border-t border-indigo-100 dark:border-indigo-900">
                                          <div className="grid grid-cols-2 gap-3 mb-3">
                                            <div>
                                              <label className="block text-xs font-medium text-fg-muted mb-1">Label</label>
                                              <input
                                                autoFocus
                                                value={editDraft.label || ''}
                                                onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))}
                                                className="w-full px-2.5 py-1.5 text-sm bg-surface border border-line rounded-md focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-fg"
                                                placeholder="Field label"
                                              />
                                            </div>
                                            <div>
                                              <label className="block text-xs font-medium text-fg-muted mb-1">Type</label>
                                              <select
                                                value={editDraft.type || 'text'}
                                                onChange={e => setEditDraft(d => ({ ...d, type: e.target.value }))}
                                                className="w-full px-2.5 py-1.5 text-sm bg-surface border border-line rounded-md focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-fg capitalize"
                                              >
                                                {FIELD_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                                              </select>
                                            </div>
                                          </div>
                                          <div className="flex items-center justify-between">
                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                              <input
                                                type="checkbox"
                                                checked={!!editDraft.required}
                                                onChange={e => setEditDraft(d => ({ ...d, required: e.target.checked }))}
                                                className="w-3.5 h-3.5 rounded accent-indigo-600"
                                              />
                                              <span className="text-xs text-fg-muted font-medium">Required</span>
                                            </label>
                                            <div className="flex gap-2">
                                              <button
                                                onClick={() => { setEditingIndex(null); setEditDraft({}) }}
                                                className="px-3 py-1 text-xs font-medium text-fg-muted border border-line rounded-md hover:bg-surface-2 transition-colors"
                                              >Cancel</button>
                                              <button
                                                onClick={() => handleSaveEdit(i)}
                                                disabled={!editDraft.label?.trim()}
                                                className="px-3 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-40 transition-colors"
                                              >Save</button>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}

                          {/* Add Field inline form */}
                          {addingNew && (
                            <div className="px-4 py-4 bg-green-50/60 dark:bg-green-950/20 border-t border-green-100 dark:border-green-900">
                              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-3">New Field</p>
                              <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                  <label className="block text-xs font-medium text-fg-muted mb-1">Label</label>
                                  <input
                                    autoFocus
                                    value={newField.label}
                                    onChange={e => setNewField(f => ({ ...f, label: e.target.value }))}
                                    className="w-full px-2.5 py-1.5 text-sm bg-surface border border-line rounded-md focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none text-fg"
                                    placeholder="e.g. Invoice Number"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-fg-muted mb-1">Type</label>
                                  <select
                                    value={newField.type}
                                    onChange={e => setNewField(f => ({ ...f, type: e.target.value }))}
                                    className="w-full px-2.5 py-1.5 text-sm bg-surface border border-line rounded-md focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none text-fg"
                                  >
                                    {FIELD_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={newField.required}
                                    onChange={e => setNewField(f => ({ ...f, required: e.target.checked }))}
                                    className="w-3.5 h-3.5 rounded accent-green-600"
                                  />
                                  <span className="text-xs text-fg-muted font-medium">Required</span>
                                </label>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => { setAddingNew(false); setNewField({ label: '', type: 'text', required: false }) }}
                                    className="px-3 py-1 text-xs font-medium text-fg-muted border border-line rounded-md hover:bg-surface-2 transition-colors"
                                  >Cancel</button>
                                  <button
                                    onClick={handleAddField}
                                    disabled={!newField.label.trim()}
                                    className="px-3 py-1 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-40 transition-colors"
                                  >Add</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}

                    {/* Footer actions */}
                    <div className="flex justify-between items-center mt-5 pt-4 border-t border-line">
                      <button
                        onClick={() => { setAiDraft(null); setEditingIndex(null); setAddingNew(false) }}
                        disabled={isGeneratingForm}
                        className="px-4 py-2 text-sm font-medium text-fg border border-line hover:bg-surface-2 rounded-md transition-colors"
                      >
                        Back to Prompt
                      </button>
                      <button
                        onClick={handleApproveAndPublish}
                        disabled={isGeneratingForm || (aiDraft.fields || []).length === 0}
                        className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50 flex items-center gap-2 transition-colors"
                      >
                        {isGeneratingForm && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>}
                        Approve & Publish
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// Renders one row of node chips joined by arrows. `muted` = smaller styling,
// used for the rejected-branch sub-lines shown beneath the main flow.
function PreviewChips({ path, muted = false }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {path.map((n, i) => {
        const s = NODE_STYLES[n.type] || NODE_STYLES.start
        return (
          <React.Fragment key={n.id}>
            <span
              className={`rounded-md border font-medium ${s.card} ${s.title} ${
                muted ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
              }`}
            >
              {n.title}
            </span>
            {i < path.length - 1 && <span className="text-fg-subtle">→</span>}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function Step4Review({ data, forms }) {
  const { settings, nodes, connections } = data
  const { main: mainPath, branches, orphans } = useMemo(
    () => buildPreviewPaths(nodes, connections),
    [nodes, connections]
  )
  const slaPolicy = useMemo(() => {
    const approvals = nodes.filter((n) => n.type === 'approval')
    if (approvals.length === 0) return 'No SLA defined'
    return approvals
      .map((a) => `${a.slaValue ?? 24}${(a.slaUnit || 'Hours')[0].toLowerCase()} ${a.title}`)
      .join(' · ')
  }, [nodes])

  const linkedFormsLabel = useMemo(() => {
    const ids = settings.linkedFormIds?.length
      ? settings.linkedFormIds
      : (settings.linkedFormId ? [settings.linkedFormId] : [])
    if (!ids.length) return 'None'
    const titles = ids.map((id) => {
      const f = forms.find((x) => String(x.id) === String(id))
      return f ? f.title : '(missing)'
    })
    return titles.join(', ')
  }, [forms, settings.linkedFormId, settings.linkedFormIds])

  const hasApprover = (n) =>
    n.type === 'multiApproval'
      ? Array.isArray(n.approverIds) && n.approverIds.length > 0
      : !!(n.approverId || n.approverRole || n.approver)

  const flowProblems = graphIssues(nodes, connections)
  const notifyNodes = nodes.filter((n) => n.type === 'notify')

  const checklist = [
    {
      label: 'Name set',
      ok: !!settings.name?.trim(),
    },
    {
      label: 'Trigger configured',
      ok: !!(settings.linkedFormIds?.length || settings.linkedFormId) || !!settings.inboundWebhook?.enabled,
    },
    {
      label: 'Owners assigned',
      ok: nodes.filter((n) => n.type === 'approval' || n.type === 'multiApproval' || n.type === 'submit' || n.type === 'review').every(hasApprover),
    },
    {
      label: 'SLA set on approvals',
      ok: nodes.filter((n) => n.type === 'approval').every((n) => !!n.slaValue),
    },
    {
      label: 'All steps connected',
      ok: flowProblems.length === 0,
    },
    {
      label: notifyNodes.length ? 'Notify channels set' : 'No notify steps',
      // `every` on an empty list is true, so this passes when there are none.
      ok: notifyNodes.every((n) => (n.channels || []).length > 0),
    },
  ]
  const failing = checklist.filter((c) => !c.ok).length
  const connectionsCount = connections?.length ?? 0

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold text-fg">Review</h2>
        {failing > 0 && (
          <p className="text-sm text-warning-fg">
            {failing} {failing === 1 ? 'item' : 'items'} to fix
          </p>
        )}
      </div>

      <Section title="Summary">
        <div className="flex justify-end -mt-2">
          <span className="px-2.5 py-0.5 rounded-md bg-warning-subtle text-warning-fg text-xs font-medium">
            Draft
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          {[
            ['Name', settings.name || '(unnamed)'],
            ['Category', settings.category],
            ['Forms', linkedFormsLabel],
            ['Trigger', settings.triggerOn],
            ['Webhook', settings.inboundWebhook?.enabled ? 'On' : 'Off'],
            ['Visibility',
              settings.visibility === 'company'
                ? 'Company-wide'
                : settings.visibility === 'departments'
                  ? (settings.visibleDepartments.join(', ') || 'No departments')
                  : `${(settings.visibleTo || []).length} people`],
            ['Submitters', settings.whoCanSubmit],
            ...(settings.whoCanSubmit === 'Specific people'
              ? [[
                  'Initiators',
                  (settings.allowedInitiators || []).length
                    ? `${settings.allowedInitiators.length} people`
                    : 'None',
                ]]
              : []),
            ['SLA', slaPolicy],
            ['PDF', settings.advanced.autoPdf ? 'On' : 'Off'],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="col-span-1 text-fg-muted">{k}</dt>
              <dd className="col-span-2 font-medium text-fg">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Section>

      <Section title="Flow preview">
        <div className="flex items-center justify-between -mt-2 mb-1">
          <span className="text-xs text-fg-muted">
            {nodes.length} nodes · {connectionsCount} links
          </span>
        </div>
        {/* Main (approved) flow rendered inline; each Decision's rejected branch
            drops straight DOWN from its Decision chip (↓) so the split reads
            top-to-bottom (e.g. Decision ↓ Notify → End) instead of as a
            left-side sub-line. */}
        <div className="flex flex-wrap items-start gap-2">
          {mainPath.map((n, i) => {
            const s = NODE_STYLES[n.type] || NODE_STYLES.start
            const branch = branches.find((b) => b[0]?.id === n.id)
            return (
              <React.Fragment key={n.id}>
                <div className="flex flex-col items-center gap-1">
                  <span className={`px-3 py-1.5 rounded-md border text-sm font-medium ${s.card} ${s.title}`}>
                    {n.title}
                  </span>
                  {branch && (
                    <div className="flex flex-col items-center gap-1 mt-1">
                      <span className="text-rose-400 leading-none">↓</span>
                      <span className="text-[10px] font-medium text-rose-500">reject</span>
                      <PreviewChips path={branch.slice(1)} muted />
                    </div>
                  )}
                </div>
                {i < mainPath.length - 1 && <span className="text-fg-subtle leading-9">→</span>}
              </React.Fragment>
            )
          })}
        </div>
        {orphans.length > 0 && (
          <div className="mt-3 pl-2">
            <p className="text-[11px] font-medium text-warning-fg mb-1">Disconnected</p>
            <PreviewChips path={orphans} muted />
          </div>
        )}
      </Section>

      <Section title="Checklist">
        <ul className="-my-2">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center gap-2 py-2 border-b border-line last:border-0">
              <span
                className={`w-5 h-5 rounded-md flex items-center justify-center ${
                  c.ok ? 'bg-success-subtle text-success-fg' : 'bg-warning-subtle text-warning-fg'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span className="text-sm text-fg">{c.label}</span>
            </li>
          ))}
        </ul>
      </Section>

      {flowProblems.length > 0 && (
        <div className="p-4 rounded-md bg-danger-subtle border border-danger-line text-sm text-danger-fg">
          <p className="font-semibold mb-1.5">Fix before publishing</p>
          <ul className="list-disc pl-5 space-y-1">
            {flowProblems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function NewWorkflow() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: editId } = useParams()
  const isEditMode = !!editId
  const forms = useForms()
  const orgDepartments = useDepartmentNames()
  // Read once, before any state initialiser looks at it.
  const [restoredDraft] = useState(() => isEditMode ? null : readDraft())
  // Edit mode starts at the canvas (step 2); create mode starts at template picker (step 1).
  // After publishing with inbound webhook, we reopen settings so the URL is copyable.
  const [step, setStep] = useState(
    location.state?.openSettings ? 3 : isEditMode ? 2 : restoredDraft?.step || 1
  )
  const [publishing, setPublishing] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loadedStatus, setLoadedStatus] = useState('')
  const [draftNotice, setDraftNotice] = useState(!!restoredDraft)
  const [publishSuccess, setPublishSuccess] = useState(() => location.state?.publishSuccess || null)
  // Bumped when the canvas graph is replaced so WorkflowEditor auto-fits again.
  const [canvasFitKey, setCanvasFitKey] = useState(0)
  const isLive = isEditMode && loadedStatus === 'published'

  // --- AI Builder State ---
  const [aiAvailable, setAiAvailable] = useState(false)
  // eslint-disable-next-line no-unused-vars
  const [aiStatusReady, setAiStatusReady] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiSuggestion, setAiSuggestion] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(false)
  const aiInputRef = useRef(null)

  useEffect(() => {
    api.get('/api/workflows/ai-status')
      .then((d) => {
        setAiAvailable(!!d.aiConfigured)
        setAiStatusReady(true)
      })
      .catch(() => {
        setAiAvailable(false)
        setAiStatusReady(true)
      })
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (location.state?.openSettings) setStep(3)
    if (location.state?.publishSuccess) setPublishSuccess(location.state.publishSuccess)
  }, [location.state])

  const [data, setData] = useState(() => {
    if (restoredDraft?.data) return restoredDraft.data
    const tpl = TEMPLATES.find((t) => t.id === 'scratch')
    return {
      template: 'scratch',
      nodes: tpl.defaults.nodes.map((n) => ({ ...n })),
      connections: tpl.defaults.connections.map((c) => ({ ...c })),
      selectedNodeId: null,
      settings: {
        name: '',
        description: '',
        category: '',
        linkedFormId: null,
        linkedFormIds: [],
        triggerOn: 'Every form submission',
        preventDuplicates: true,
        whoCanSubmit: 'All employees',
        // Filled from the tenant's list the first time visibility is set to
        // 'departments' — there is no list to copy from at this point.
        visibleDepartments: [],
        allowedInitiators: [],
        visibility: 'company',
        visibleTo: [],
        notifyOnSlaBreach: 'Always',
        inboundWebhook: {
          enabled: false,
          token: '',
          secret: '',
          callbackUrl: '',
          expectedFields: [],
          regenerateToken: false,
        },
        advanced: {
          allowCancel: false,
          autoPdf: true,
        },
        webhookUrl: '',
      },
    }
  })

  const generateWithAI = async () => {
    const prompt = aiPrompt.trim()
    if (!prompt || aiBusy) return
    setAiBusy(true)
    setAiError('')
    try {
      const res = await api.post('/api/workflows/ai-draft', { prompt })
      if (!res.nodes || !res.connections) throw new Error('Invalid AI response format.')
      setData((d) => ({
        ...d,
        template: 'ai_generated',
        nodes: res.nodes,
        connections: res.connections,
        settings: {
          ...d.settings,
          name: res.title || 'AI Generated Workflow',
          description: res.description || prompt,
        },
      }))
      setCanvasFitKey((k) => k + 1)
      setStep(2)
      toast.success('Workflow generated successfully!')
    } catch (err) {
      setAiError(err.message || 'AI generation failed. Please try again.')
    } finally {
      setAiBusy(false)
    }
  }

  const onAiPromptChange = (e) => {
    const val = e.target.value
    setAiPrompt(val)
    setAiSuggestion('')
    if (!aiAvailable || aiBusy || val.trim().length < 3) return
    if (!val.endsWith(' ')) return
    const base = val.trim()
    api.post('/api/workflows/ai-suggest', { prompt: base })
      .then((res) => {
        const el = aiInputRef.current
        if (el && document.activeElement === el) setAiSuggestion(res?.completion || '')
      })
      .catch(() => setAiSuggestion(''))
  }

  const onAiKeyDown = (e) => {
    const el = aiInputRef.current
    if (!el) return
    const caretAtEnd = el.selectionStart === aiPrompt.length && el.selectionStart === el.selectionEnd
    if (aiSuggestion && (e.key === 'Tab' || (e.key === 'ArrowRight' && caretAtEnd))) {
      e.preventDefault()
      const next = aiPrompt + aiSuggestion
      setAiPrompt(next)
      setAiSuggestion('')
      requestAnimationFrame(() => {
        const el2 = aiInputRef.current
        if (el2) { el2.focus(); el2.setSelectionRange(next.length, next.length) }
      })
      return
    }
    if (e.key === 'Escape') { setAiSuggestion(''); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setAiSuggestion(''); generateWithAI() }
  }

  // Load existing workflow if edit mode, fetch the existing workflow and populate the form state.
  useEffect(() => {
    if (!editId) return
    ;(async () => {
      try {
        const { workflow } = await api.get(`/api/workflows/${editId}`)
        const nodes = deserializeNodes(workflow.nodes)
        const connections = deserializeEdges(workflow.edges)
        setLoadedStatus(workflow.status || '')
        // Re-baseline the dirty check: what came back from the server is the
        // new "unchanged" state, not whatever the empty initial state was.
        pristineRef.current = null
        setData((d) => ({
          ...d,
          nodes,
          connections,
          settings: {
            ...d.settings,
            name: workflow.title || '',
            description: workflow.description || '',
            category: workflow.department || d.settings.category,
            tags: workflow.tags || [],
            linkedFormIds: (() => {
              if (Array.isArray(workflow.linkedFormIds) && workflow.linkedFormIds.length) {
                return workflow.linkedFormIds.map(String)
              }
              return workflow.linkedFormId ? [String(workflow.linkedFormId)] : []
            })(),
            linkedFormId: workflow.linkedFormId
              ? String(workflow.linkedFormId)
              : (workflow.linkedFormIds?.[0] ? String(workflow.linkedFormIds[0]) : null),
            whoCanSubmit: SUBMITTER_OPTIONS.includes(workflow.access?.whoCanSubmit)
              ? workflow.access.whoCanSubmit
              : d.settings.whoCanSubmit,
            visibleDepartments: workflow.access?.departments?.length
              ? workflow.access.departments
              : d.settings.visibleDepartments,
            allowedInitiators: (workflow.access?.allowedInitiators || []).map((x) => String(x)),
            visibility:
              workflow.access?.visibility ||
              (workflow.access?.departments?.length ? 'departments' : 'company'),
            visibleTo: (workflow.access?.visibleTo || []).map((x) => String(x)),
            triggerOn: TRIGGER_OPTIONS.includes(workflow.triggerOn)
              ? workflow.triggerOn
              : d.settings.triggerOn,
            preventDuplicates: workflow.preventDuplicates === true,
            notifyOnSlaBreach: workflow.notifyOnSlaBreach || d.settings.notifyOnSlaBreach,
            inboundWebhook: {
              enabled: workflow.inboundWebhook?.enabled === true,
              token: workflow.inboundWebhook?.token || '',
              secret: workflow.inboundWebhook?.secret || '',
              requireSignature: workflow.inboundWebhook?.requireSignature !== false,
              callbackUrl: workflow.inboundWebhook?.callbackUrl || '',
              expectedFields: Array.isArray(workflow.inboundWebhook?.expectedFields)
                ? workflow.inboundWebhook.expectedFields.map((f) => ({
                    id: f.id || '',
                    label: f.label || '',
                    type: f.type || 'text',
                    required: f.required === true,
                  }))
                : [],
              regenerateToken: false,
            },
            advanced: {
              ...d.settings.advanced,
              allowCancel: workflow.advanced?.allowCancel === true,
              autoPdf: workflow.advanced?.autoPdf === true,
            },
          },
        }))
        setCanvasFitKey((k) => k + 1)
      } catch (err) {
        setLoadError(err.message || 'Could not load workflow')
      }
    })()
  }, [editId])

  const applyTemplate = (templateId) => {
    const tpl = TEMPLATES.find((t) => t.id === templateId)
    // Try to auto-select a published form whose title matches the hint.
    const hint = (tpl.defaults.formHint || '').toLowerCase()
    const matched = hint
      ? forms.find(
          (f) => f.status === 'Published' && f.title.toLowerCase().includes(hint)
        )
      : null

    setData((d) => ({
      ...d,
      template: templateId,
      nodes: tpl.defaults.nodes.map((n) => ({ ...n })),
      connections: tpl.defaults.connections.map((c) => ({ ...c })),
      selectedNodeId: null,
      settings: {
        ...d.settings,
        name: tpl.defaults.name || d.settings.name,
        // Templates are named after common teams; only adopt the suggestion when
        // this tenant actually has that department.
        category: orgDepartments.includes(tpl.defaults.category)
          ? tpl.defaults.category
          : d.settings.category,
        description: tpl.defaults.description || d.settings.description,
        linkedFormIds: matched
          ? [matched.id]
          : (d.settings.linkedFormIds || []),
        linkedFormId: matched
          ? matched.id
          : d.settings.linkedFormId,
      },
    }))
    setCanvasFitKey((k) => k + 1)
  }

  // Mirror the wizard into localStorage so a refresh doesn't lose the canvas.
  // Debounced, and only once the user has actually changed something — otherwise
  // opening the builder and leaving would leave a "restore draft" prompt behind.
  const pristineRef = useRef(null)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    const snapshot = JSON.stringify({ step, data })
    if (pristineRef.current === null) {
      // eslint-disable-next-line react-hooks/immutability
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
    const t = setTimeout(() => draftStore.write({ step, data }), 600)
    return () => clearTimeout(t)
  }, [step, data, isEditMode])

  useBeforeUnloadWarning(dirty && !publishing && !savingDraft)

  const handleDiscard = async () => {
    if (await confirm({ title: 'Discard workflow?', message: 'Unsaved changes will be lost.', confirmLabel: 'Discard', danger: false })) {
      draftStore.clear()
      navigate('/workflows')
    }
  }

  const buildPayload = () => {
    const settings = data.settings
    return {
      name: settings.name.trim(),
      description: settings.description,
      department: settings.category,
      tags: (() => {
        const currentTags = [...(settings.tags || [])]
        if (settings.tagInput) {
          const parts = settings.tagInput.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean)
          for (const p of parts) {
            if (!currentTags.includes(p)) currentTags.push(p)
          }
        }
        return currentTags
      })(),
      linkedFormIds: (() => {
        const ids = settings.linkedFormIds?.length
          ? settings.linkedFormIds
          : (settings.linkedFormId ? [settings.linkedFormId] : [])
        return ids.map(String)
      })(),
      linkedFormId: (() => {
        const ids = settings.linkedFormIds?.length
          ? settings.linkedFormIds
          : (settings.linkedFormId ? [settings.linkedFormId] : [])
        return ids[0] || undefined
      })(),
      access: {
        whoCanSubmit: settings.whoCanSubmit,
        allowedInitiators:
          settings.whoCanSubmit === 'Specific people'
            ? settings.allowedInitiators || []
            : [],
        visibility: settings.visibility,
        // departments only apply in 'departments' mode; an empty list there means
        // "no restriction", which is also what selecting every team amounts to.
        departments:
          settings.visibility !== 'departments' ? [] : (settings.visibleDepartments || []),
        visibleTo: settings.visibility === 'people' ? settings.visibleTo || [] : [],
      },
      triggerOn: settings.triggerOn,
      preventDuplicates: settings.preventDuplicates === true,
      notifyOnSlaBreach: settings.notifyOnSlaBreach,
      inboundWebhook: {
        enabled: settings.inboundWebhook?.enabled === true,
        requireSignature: settings.inboundWebhook?.requireSignature !== false,
        callbackUrl: settings.inboundWebhook?.callbackUrl || '',
        expectedFields: Array.isArray(settings.inboundWebhook?.expectedFields)
          ? settings.inboundWebhook.expectedFields
          : [],
        ...(settings.inboundWebhook?.regenerateToken ? { regenerateToken: true } : {}),
      },
      advanced: {
        allowCancel: settings.advanced.allowCancel === true,
        autoPdf: settings.advanced.autoPdf === true,
      },
      nodes: serializeNodes(data.nodes, data.connections),
      edges: serializeEdges(data.connections),
    }
  }

  // A name is the one thing we can't invent — it used to silently become
  // "Untitled workflow", leaving lists full of identical entries.
  const requireName = () => {
    if (data.settings.name.trim()) return true
    toast.error('Give the workflow a name before saving')
    setStep(3)
    return false
  }

  const handleSaveDraft = async () => {
    if (!requireName()) return
    if (isLive) {
      const ok = await confirm({
        title: 'Push changes live now?',
        message: `"${data.settings.name.trim()}" is published, so saving applies your changes to new runs immediately. Runs already in progress keep the old steps.`,
        confirmLabel: 'Save & go live',
      })
      if (!ok) return
    }
    setPublishError('')
    setSavingDraft(true)
    try {
      if (isEditMode) {
        await workflowsStore.update(editId, buildPayload())
        toast.success(isLive ? 'Changes are live' : 'Draft saved')
      } else {
        const created = await workflowsStore.add(buildPayload())
        draftStore.clear()
        setDraftNotice(false)
        toast.success('Draft saved — publish when you are ready')
        navigate(`/workflows/${created.id}/edit`, { replace: true })
      }
    } catch (err) {
      const limit = limitBanner(err)
      const msg = limit ? `${limit.title} — ${limit.message}` : (err.message || 'Could not save the draft')
      setPublishError(msg)
      toast.error(msg)
    } finally {
      setSavingDraft(false)
    }
  }

  const handlePublish = async () => {
    setPublishError('')
    if (!requireName()) return
    const issues = graphIssues(data.nodes, data.connections)
    if (issues.length) {
      const msg = `Can't publish yet — ${issues[0].message}${issues.length > 1 ? ` (+${issues.length - 1} more)` : ''}`
      setPublishError(msg)
      toast.error(msg)
      return
    }
    if (isLive) {
      const ok = await confirm({
        title: 'Push changes live now?',
        message: `"${data.settings.name.trim()}" is already published, so new submissions start using these steps as soon as you save. Runs already in progress keep the old steps.`,
        confirmLabel: 'Save & go live',
      })
      if (!ok) return
    }
    setPublishing(true)
    try {
      const payload = buildPayload()
      let saved
      if (isEditMode) {
        const updated = await workflowsStore.update(editId, payload)
        // Only publish if the updated doc came back as a draft (e.g. it was
        // paused before editing). If it's already published the PUT preserved
        // that status and a second publish call is unnecessary.
        saved = updated.status !== 'Active'
          ? await workflowsStore.publish(updated.id)
          : updated
      } else {
        const created = await workflowsStore.add(payload)
        saved = await workflowsStore.publish(created.id)
      }
      const savedId = saved?.id
      const wh = saved?.inboundWebhook || saved?._raw?.inboundWebhook
      draftStore.clear()
      setDraftNotice(false)

      if (payload.inboundWebhook?.enabled && savedId) {
        const token = wh?.token || ''
        const secret = wh?.secret || ''
        setData((d) => ({
          ...d,
          settings: {
            ...d.settings,
            inboundWebhook: {
              ...(d.settings.inboundWebhook || {}),
              enabled: true,
              token,
              secret,
              regenerateToken: false,
            },
          },
        }))
        const successPayload = {
          name: payload.name,
          webhookUrl: webhookUrlFor(token),
          secret,
        }
        setPublishSuccess(successPayload)
        toast.success('Workflow published')
        navigate(`/workflows/${savedId}/edit`, {
          replace: true,
          state: {
            openSettings: true,
            justPublished: true,
            publishSuccess: successPayload,
          },
        })
        setStep(3)
        return
      }

      toast.success('Workflow published')
      navigate('/workflows')
    } catch (err) {
      // Keeps the canvas intact and names the limit, so the builder can archive
      // an old workflow and press publish again.
      const limit = limitBanner(err)
      const msg = limit ? `${limit.title} — ${limit.message}` : (err.message || 'Failed to save workflow')
      setPublishError(msg)
      toast.error(msg)
    } finally {
      setPublishing(false)
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-2">
        <div className="p-6 rounded-lg bg-danger-subtle border border-danger-line text-danger-fg text-sm max-w-md text-center">
          <p className="font-semibold mb-1">Could not load workflow</p>
          <p>{loadError}</p>
          <button onClick={() => navigate('/workflows')} className="mt-4 px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition">Back to workflows</button>
        </div>
      </div>
    )
  }

  const builderFullscreen = step === 2

  return (
    <div className="h-dvh flex flex-col bg-surface-2 text-fg overflow-hidden">
      <main
        data-tour="workflow-builder-main"
        className={
          builderFullscreen
            ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
            : 'flex-1 min-h-0 p-6 overflow-y-auto'
        }
      >
        {draftNotice && (
          <div className={`mb-4 shrink-0 ${builderFullscreen ? 'px-4 pt-3' : 'max-w-3xl mx-auto'}`}>
            <AlertBanner
              tone="info"
              onRetry={async () => {
                const ok = await confirm({
                  title: 'Start over?',
                  message: 'Your restored draft will be thrown away and the builder resets to a blank workflow.',
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
              Picked up where you left off — this is an unsaved draft from your last visit.
            </AlertBanner>
          </div>
        )}
        {isLive && (
          <div className={`mb-4 shrink-0 ${builderFullscreen ? 'px-4 pt-3' : 'max-w-3xl mx-auto'}`}>
            <AlertBanner tone="warning">
              This workflow is live. Saving applies your changes to new submissions straight away;
              runs already in progress keep the steps they started with.
            </AlertBanner>
          </div>
        )}
        {step === 1 && !isEditMode && (
          <Step1Template
            selected={data.template}
            onSelect={applyTemplate}
            aiAvailable={aiAvailable}
            aiPrompt={aiPrompt}
            onAiPromptChange={onAiPromptChange}
            onAiKeyDown={onAiKeyDown}
            aiSuggestion={aiSuggestion}
            aiBusy={aiBusy}
            generateWithAI={generateWithAI}
            aiError={aiError}
            showAiPanel={showAiPanel}
            setShowAiPanel={setShowAiPanel}
            aiInputRef={aiInputRef}
          />
        )}
        {step === 2 && <Step2Builder data={data} setData={setData} fitKey={canvasFitKey} />}
        {step === 3 && <Step3Settings data={data} setData={setData} forms={forms} editId={editId} />}
        {step === 4 && (
          <>
            <Step4Review data={data} forms={forms} />
            {publishError && (
              <div className="max-w-3xl mx-auto mt-3 p-3 rounded-md bg-danger-subtle border border-danger-line text-danger-fg text-sm">
                {publishError}
              </div>
            )}
          </>
        )}

      </main>

      <footer data-tour="workflow-builder-actions" className="h-16 shrink-0 bg-surface border-t border-line px-6 flex items-center justify-end">
        <div className="flex items-center gap-2">
          {step > 1 && (
            <button
              onClick={() => {
                if (step === 2 && isEditMode) {
                  handleDiscard();
                } else {
                  setStep((s) => s - 1);
                }
              }}
              className="px-4 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          )}
          <button
            onClick={handleDiscard}
            className="px-4 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition flex items-center gap-1.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Discard
          </button>
          <button
            onClick={handleSaveDraft}
            disabled={savingDraft || publishing}
            className="px-4 py-2 rounded-md border border-line hover:bg-surface-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-medium text-fg transition flex items-center gap-1.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4l-3 3-3-3m3 3V3" />
            </svg>
            {savingDraft ? 'Saving…' : isLive ? 'Save changes' : 'Save draft'}
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm transition flex items-center gap-1.5"
            >
              Continue
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium shadow-sm transition flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {publishing ? 'Publishing…' : isEditMode ? 'Save & publish' : 'Publish workflow'}
            </button>
          )}
        </div>
      </footer>

      <PublishSuccessModal
        open={!!publishSuccess}
        name={publishSuccess?.name}
        webhookUrl={publishSuccess?.webhookUrl}
        secret={publishSuccess?.secret}
        onClose={() => setPublishSuccess(null)}
        onGoToList={() => {
          setPublishSuccess(null)
          navigate('/workflows')
        }}
      />
    </div>
  )
}

// Frontend uses 'notify' but the backend Workflow.node enum spells it
// 'notification'. Mongoose silently rejects the doc without this map.
const NODE_TYPE_TO_API = {
  start: 'start',
  approval: 'approval',
  multiApproval: 'multiApproval',
  submit: 'submit',
  review: 'review',
  condition: 'condition',
  notify: 'notification',
  api: 'api',
  timer: 'timer',
  end: 'end'
}

const SLA_UNIT_TO_HOURS = { Minutes: 1 / 60, Hours: 1, Days: 24 }

const toHours = (value, unit) => {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return 48
  return Math.max(1, Math.round(v * (SLA_UNIT_TO_HOURS[unit] ?? 1)))
}

// Is this edge the approved / forward branch? Explicit tag wins; a plain
// (non-dashed) edge from a Decision/Review counts as approve for legacy graphs.
const isApproveEdge = (c) => c.branch === 'approve' || (!c.branch && !c.dashed)
// Reject / changes-required: explicit tag or legacy dashed style.
const isRejectEdge = (c) => c.branch === 'reject' || c.dashed === true

// Structural checks for the canvas banner, Review checklist, and publish gate.
// Returns { message, nodeIds }[] so the builder can highlight the bad nodes.
function graphIssues(nodes, connections) {
  const issues = []
  const conns = connections || []
  const label = (n) => n.title || n.id
  const outFrom = (id) => conns.filter((c) => c.from === id)
  const push = (message, nodeIds = []) => issues.push({ message, nodeIds: nodeIds.filter(Boolean) })

  for (const n of nodes) {
    if (n.type === 'condition') {
      const outs = outFrom(n.id)
      const hasApprove = outs.some(isApproveEdge)
      const hasReject = outs.some(isRejectEdge)
      if (!hasApprove || !hasReject) {
        const missing = [!hasApprove && 'Approved', !hasReject && 'Rejected']
          .filter(Boolean)
          .join(' and ')
        push(
          `Decision "${label(n)}" is missing its ${missing} branch — connect both paths (or set them in Node Config).`,
          [n.id]
        )
      }
      // Untagged extras confuse runtime; Decision may only have two branch edges.
      if (outs.length > 2) {
        push(
          `Decision "${label(n)}" has extra connections — keep only Approved and Rejected paths.`,
          [n.id]
        )
      }
    }
    if (n.type === 'review') {
      const outs = outFrom(n.id)
      const hasForward = outs.some(isApproveEdge)
      const hasChanges = outs.some(isRejectEdge)
      if (!hasForward || !hasChanges) {
        const missing = [!hasForward && 'No-changes / forward', !hasChanges && 'Changes-required']
          .filter(Boolean)
          .join(' and ')
        push(
          `Review "${label(n)}" is missing its ${missing} branch — connect both paths (or set them in Node Config).`,
          [n.id]
        )
      }
    }
    if ((n.type === 'approval' || n.type === 'multiApproval' || n.type === 'submit' || n.type === 'notify' || n.type === 'api' || n.type === 'timer') && outFrom(n.id).length === 0) {
      push(
        `"${label(n)}" has no next step — connect it to the following node (e.g. the next approval or End).`,
        [n.id]
      )
    }
    if (n.type === 'end' && outFrom(n.id).length > 0) {
      push(
        `"${label(n)}" is an End step and should not connect onward — remove its outgoing link.`,
        [n.id]
      )
    }
  }

  // Self-loops and edges to missing nodes.
  for (const c of conns) {
    if (c.from === c.to) {
      const n = nodes.find((x) => x.id === c.from)
      push(`"${label(n || { id: c.from })}" connects to itself — remove that loop.`, [c.from])
    }
    if (!nodes.some((n) => n.id === c.to)) {
      push('A connection points to a missing node — delete the broken link.', [c.from])
    }
  }

  // Reachability from the Start node.
  const start = nodes.find((n) => n.type === 'start')
  if (!start) {
    push('There is no Start step — add one so NetFlow knows where a run begins.')
  } else if (outFrom(start.id).length === 0) {
    push('Start has no next step — drag a connection from it to the first step of the flow.', [start.id])
  }
  if (start) {
    const seen = new Set([start.id])
    const stack = [start.id]
    while (stack.length) {
      const id = stack.pop()
      for (const c of conns.filter((edge) => edge.from === id)) {
        if (!seen.has(c.to)) {
          seen.add(c.to)
          stack.push(c.to)
        }
      }
    }
    for (const n of nodes) {
      if (n.type === 'start') continue
      if (!seen.has(n.id)) {
        push(`"${label(n)}" is not reachable from Start — nothing connects into it.`, [n.id])
      }
    }
  }

  return issues
}

// Builds the chip preview as a MAIN path (Start → … → End, following the
// approved/plain edges) plus one sub-line per Decision's rejected branch
// (Decision → … → merge node, usually End). A single straight line can't show a
// branch that splits and re-merges, so the rejected path is rendered beneath the
// main flow. `orphans` surfaces any node reachable by neither, so nothing hides.
function buildPreviewPaths(nodes, connections) {
  const list = nodes || []
  const byId = new Map(list.map((n) => [n.id, n]))
  const start = list.find((n) => n.type === 'start') || list[0]
  if (!start) return { main: list, branches: [], orphans: [] }

  const outBy = new Map()
  for (const c of connections || []) {
    if (!outBy.has(c.from)) outBy.set(c.from, [])
    outBy.get(c.from).push(c)
  }
  // Primary edge = the approved branch, else a plain edge, else whatever exists.
  const primary = (id) => {
    const e = outBy.get(id) || []
    return (
      e.find((c) => c.branch === 'approve') ||
      e.find((c) => !c.branch && !c.dashed) ||
      e[0]
    )
  }

  // Main line: walk primary edges from Start until End / a repeat / a dead end.
  const main = []
  const onMain = new Set()
  let cur = start.id
  while (cur && byId.has(cur) && !onMain.has(cur)) {
    onMain.add(cur)
    main.push(byId.get(cur))
    cur = primary(cur)?.to
  }

  // One sub-line per Decision reject/false branch: Decision → … → (merge node).
  const branches = []
  for (const node of main) {
    if (node.type !== 'condition' && node.type !== 'review') continue
    const rej = (outBy.get(node.id) || []).find((c) => c.branch === 'reject' || c.dashed)
    if (!rej) continue
    const line = [node] // include the Decision for context
    const seen = new Set([node.id])
    let id = rej.to
    while (id && byId.has(id) && !seen.has(id)) {
      seen.add(id)
      line.push(byId.get(id))
      if (onMain.has(id)) break // merged back into the main path (e.g. End)
      id = primary(id)?.to
    }
    if (line.length > 1) branches.push(line)
  }

  // Anything shown in neither the main line nor a branch (truly disconnected).
  const shown = new Set(onMain)
  for (const b of branches) for (const n of b) shown.add(n.id)
  const orphans = list.filter((n) => !shown.has(n.id))

  return { main, branches, orphans }
}

function serializeNodes(nodes, connections) {
  // Build a map for nextNode. For most nodes this is just the first outgoing
  // edge. For Decision (condition) nodes we deliberately skip — branching is
  // expressed via truePath / falsePath in config, not via a single nextNode.
  const firstNext = new Map()
  for (const c of connections || []) {
    if (c.branch) continue
    if (!firstNext.has(c.from)) firstNext.set(c.from, c.to)
  }

  // Index Decision / Review branch targets (truePath / falsePath, forward / changes).
  // Legacy dashed edges count as reject; plain untagged as approve.
  const approveTargetByFrom = new Map()
  const rejectTargetByFrom = new Map()
  for (const c of connections || []) {
    if (isApproveEdge(c) && !approveTargetByFrom.has(c.from)) {
      approveTargetByFrom.set(c.from, c.to)
    }
    if (isRejectEdge(c) && !rejectTargetByFrom.has(c.from)) {
      rejectTargetByFrom.set(c.from, c.to)
    }
  }

  return nodes.map((n) => {
    const config = {}
    if (n.type === 'approval') {
      // Prefer a specific assigned user; fall back to a semantic role token.
      // Backward compat: older nodes might still carry a free-form `approver`
      // string (e.g. "Direct manager") from the previous demo UI.
      if (n.approverId) {
        config.approverId = n.approverId
      } else if (n.approverRole) {
        config.approverRole = n.approverRole
      } else if (n.approver) {
        config.approverRole = n.approver
      }
      config.slaHours = toHours(n.slaValue, n.slaUnit)
      config.approvalType = n.sequential ? 'sequential' : 'parallel'
      config.requireSignature = n.requireSignature === true
    }
    if (n.type === 'multiApproval') {
      // Committee approval: an explicit list of people + how many (N of M) must
      // approve. The engine builds one shared task from these.
      const ids = Array.isArray(n.approverIds) ? n.approverIds.filter(Boolean) : []
      config.approverIds = ids
      config.requiredApprovals = Math.min(
        Math.max(1, Number(n.requiredApprovals) || 1),
        Math.max(1, ids.length)
      )
      config.slaHours = toHours(n.slaValue, n.slaUnit)
      config.requireSignature = n.requireSignature === true
    }
    if (n.type === 'submit') {
      // Submit node: the assignee fills an inline form + comment to advance.
      // Reuses the approver fields to resolve who the submission task goes to.
      if (n.approverId) {
        config.approverId = n.approverId
      } else if (n.approverRole) {
        config.approverRole = n.approverRole
      } else if (n.approver) {
        config.approverRole = n.approver
      }
      config.instructions = n.instructions || ''
      config.formFields = Array.isArray(n.formFields) ? n.formFields : []
      config.slaHours = toHours(n.slaValue, n.slaUnit)
    }
    if (n.type === 'review') {
      // Review (viewer) node: assigns a reviewer (reuses the approver fields) and
      // branches like a Decision. Forward (no changes) = 'approve' edge, Changes
      // required = 'reject' edge. Engine reads config.forwardPath / changesPath.
      if (n.approverId) {
        config.approverId = n.approverId
      } else if (n.approverRole) {
        config.approverRole = n.approverRole
      } else if (n.approver) {
        config.approverRole = n.approver
      }
      config.instructions = n.instructions || ''
      config.slaHours = toHours(n.slaValue, n.slaUnit)
      const forwardPath = approveTargetByFrom.get(n.id)
      const changesPath = rejectTargetByFrom.get(n.id)
      if (forwardPath) config.forwardPath = forwardPath
      if (changesPath) config.changesPath = changesPath
    }
    if (n.type === 'api') {
      // Integration / webhook node: outbound HTTP call config.
      config.apiUrl = n.apiUrl || ''
      config.apiMethod = n.apiMethod || 'POST'
      config.apiHeaders = (Array.isArray(n.apiHeaders) ? n.apiHeaders : [])
        .filter((h) => h && h.key)
        .map((h) => ({ key: h.key, value: h.value || '' }))
      config.apiBody = n.apiBody || ''
      config.apiAuth = {
        mode: n.apiAuth?.mode || 'none',
        token: n.apiAuth?.token || '',
        username: n.apiAuth?.username || '',
        password: n.apiAuth?.password || ''
      }
      config.saveResponseAs = n.saveResponseAs || ''
      config.continueOnError = n.continueOnError !== false
    }
    if (n.type === 'condition') {
      // Decision nodes branch on whether the immediately preceding approval
      // was approved or rejected. The engine's `advanceWorkflow` caches that
      // outcome as `variables.lastApprovalOutcome`.
      config.conditionField = 'lastApprovalOutcome'
      config.conditionOperator = 'eq'
      config.conditionValue = 'approved'
      const truePath = approveTargetByFrom.get(n.id)
      const falsePath = rejectTargetByFrom.get(n.id)
      if (truePath) config.truePath = truePath
      if (falsePath) config.falsePath = falsePath
    }
    if (n.type === 'timer') {
      config.slaHours = toHours(n.waitValue, n.waitUnit)
    }
    if (n.type === 'end') {
      config.generatePdf = n.generatePdf === true
    }
    return {
      id: n.id,
      type: NODE_TYPE_TO_API[n.type] || n.type,
      label: n.title,
      position: { x: n.x, y: n.y },
      config,
      nextNode: firstNext.get(n.id)
    }
  })
}

function serializeEdges(connections) {
  return (connections || []).map((c, i) => {
    let label = ''
    if (c.branch === 'approve') label = 'approved'
    else if (c.branch === 'reject' || c.dashed) label = 'rejected'
    return {
      id: `e${i}`,
      source: c.from,
      target: c.to,
      label
    }
  })
}

// Reverse of NODE_TYPE_TO_API — map backend type back to UI type.
const API_NODE_TYPE_TO_UI = {
  start: 'start',
  approval: 'approval',
  multiApproval: 'multiApproval',
  submit: 'submit',
  review: 'review',
  condition: 'condition',
  notification: 'notify',
  api: 'api',
  timer: 'timer',
  end: 'end',
  document: 'end',
}

const SLA_HOURS_TO_DISPLAY = (hours) => {
  if (!hours) return { slaValue: 48, slaUnit: 'Hours' }
  if (hours < 1) return { slaValue: Math.round(hours * 60), slaUnit: 'Minutes' }
  if (hours % 24 === 0 && hours >= 24) return { slaValue: hours / 24, slaUnit: 'Days' }
  return { slaValue: hours, slaUnit: 'Hours' }
}

function deserializeNodes(apiNodes) {
  return (apiNodes || []).map((n) => {
    const uiType = API_NODE_TYPE_TO_UI[n.type] || n.type
    const base = {
      id: n.id,
      type: uiType,
      title: n.label || n.id,
      subtitle: '',
      x: n.position?.x ?? 300,
      y: n.position?.y ?? 40,
    }
    const cfg = n.config || {}
    if (uiType === 'approval') {
      const { slaValue, slaUnit } = SLA_HOURS_TO_DISPLAY(cfg.slaHours)
      Object.assign(base, {
        approverRole: cfg.approverRole || '',
        approverId: cfg.approverId || null,
        slaValue,
        slaUnit,
        sequential: cfg.approvalType !== 'parallel',
        requireSignature: cfg.requireSignature === true,
      })
    }
    if (uiType === 'multiApproval') {
      const { slaValue, slaUnit } = SLA_HOURS_TO_DISPLAY(cfg.slaHours)
      const ids = Array.isArray(cfg.approverIds)
        ? cfg.approverIds.map((id) => (id && typeof id === 'object' ? id._id || String(id) : id)).filter(Boolean)
        : []
      Object.assign(base, {
        approverIds: ids,
        requiredApprovals: Math.min(Math.max(1, Number(cfg.requiredApprovals) || 1), Math.max(1, ids.length)),
        requireSignature: cfg.requireSignature === true,
        slaValue,
        slaUnit,
      })
    }
    if (uiType === 'submit') {
      const { slaValue, slaUnit } = SLA_HOURS_TO_DISPLAY(cfg.slaHours)
      Object.assign(base, {
        approverRole: cfg.approverRole || '',
        approverId: cfg.approverId || null,
        instructions: cfg.instructions || '',
        formFields: Array.isArray(cfg.formFields)
          ? cfg.formFields.map((f) => ({
              id: f.id,
              type: f.type,
              label: f.label,
              required: !!f.required,
              placeholder: f.placeholder || '',
              options: Array.isArray(f.options) ? f.options : [],
              conditionalLogic:
                f.conditionalLogic && typeof f.conditionalLogic === 'object'
                  ? f.conditionalLogic
                  : undefined,
              validation:
                f.validation && typeof f.validation === 'object'
                  ? f.validation
                  : undefined,
            }))
          : [],
        slaValue,
        slaUnit,
      })
    }
    if (uiType === 'review') {
      const { slaValue, slaUnit } = SLA_HOURS_TO_DISPLAY(cfg.slaHours)
      Object.assign(base, {
        approverRole: cfg.approverRole || '',
        approverId: cfg.approverId || null,
        instructions: cfg.instructions || '',
        slaValue,
        slaUnit,
      })
    }
    if (uiType === 'api') {
      Object.assign(base, {
        apiUrl: cfg.apiUrl || '',
        apiMethod: cfg.apiMethod || 'POST',
        apiHeaders: Array.isArray(cfg.apiHeaders)
          ? cfg.apiHeaders.map((h) => ({ key: h.key || '', value: h.value || '' }))
          : [],
        apiBody: cfg.apiBody || '',
        apiAuth: {
          mode: cfg.apiAuth?.mode || 'none',
          token: cfg.apiAuth?.token || '',
          username: cfg.apiAuth?.username || '',
          password: cfg.apiAuth?.password || ''
        },
        saveResponseAs: cfg.saveResponseAs || '',
        continueOnError: cfg.continueOnError !== false,
      })
    }
    if (uiType === 'timer') {
      const { slaValue, slaUnit } = SLA_HOURS_TO_DISPLAY(cfg.slaHours)
      Object.assign(base, { waitValue: slaValue, waitUnit: slaUnit })
    }
    if (uiType === 'end') {
      base.generatePdf = cfg.generatePdf === true
    }
    return base
  })
}

function deserializeEdges(apiEdges) {
  return (apiEdges || []).map((e) => {
    const conn = { from: e.source, to: e.target }
    if (e.label === 'approved') {
      conn.branch = 'approve'
    } else if (e.label === 'rejected' || e.label === 'reject') {
      conn.branch = 'reject'
      conn.dashed = true
    }
    return conn
  })
}

export default NewWorkflow