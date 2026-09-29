import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, LayoutGrid, List, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { AlertBanner } from '../components/Alert'
import { Skeleton } from '../components/Skeleton'
import { Button, IconButton, StatusBadge } from '../components/NetFlowUI'
import { toast } from '../lib/toastStore'
import { confirm } from '../lib/confirmStore'
import { api } from '../utils/api'

const LIMIT_ROWS = [
  { key: 'users', field: 'maxUsers', label: 'Users' },
  { key: 'builders', field: 'maxBuilders', label: 'Builders' },
  { key: 'forms', field: 'maxForms', label: 'Forms' },
  { key: 'workflows', field: 'maxWorkflows', label: 'Workflows' },
  { key: 'submissions', field: 'maxSubmissionsPerPeriod', label: 'Submissions / billing period' },
  { key: 'storage', field: 'maxStorageMb', label: 'Storage (MB)' },
  { key: 'files', field: 'maxFiles', label: 'Files' },
]

const VIEW_KEY = 'netflow.plans.view'

const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

const descriptionFor = (plan) => {
  if (plan.key === 'custom') return 'Organization-specific limits managed from Organizations.'
  if (plan.key === 'trial') return 'Time-limited access for evaluation and onboarding.'
  if (plan.key === 'basic') return 'Core allowances for smaller operational teams.'
  if (plan.key === 'professional') return 'Expanded capacity for growing organizations.'
  if (plan.key === 'enterprise') return 'Governed scale with unrestricted allowances.'
  return 'Configured subscription allowances and feature access.'
}

function PlanForm({ plan, busy, error, submitLabel, onSubmit, onCancel }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <AlertBanner>{error}</AlertBanner>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-fg-muted">
          Plan name
          <input name="label" required defaultValue={plan?.label || ''} placeholder="e.g. Startup" className="nf-field mt-1.5" />
        </label>
        <label className="text-xs font-semibold text-fg-muted">
          Plan key
          <input name="key" required readOnly={Boolean(plan)} defaultValue={plan?.key || ''} pattern="[a-z0-9-]+" placeholder="e.g. startup-tier" className="nf-field mt-1.5 read-only:bg-surface-2 read-only:text-fg-muted" />
        </label>
      </div>
      <label className="block text-xs font-semibold text-fg-muted">
        Trial days <span className="font-normal text-fg-subtle">(optional)</span>
        <input name="trialDays" type="number" min="1" defaultValue={plan?.trialDays || ''} placeholder="e.g. 14" className="nf-field mt-1.5" />
      </label>
      <fieldset className="border-t border-line pt-4">
        <legend className="pr-3 text-sm font-bold text-fg">Resource limits</legend>
        <p className="mb-3 text-xs text-fg-muted">Use 0 for an unlimited allowance.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {LIMIT_ROWS.map((row) => (
            <label key={row.key} className="text-xs font-semibold text-fg-muted">
              {row.label}
              <input name={`limit_${row.key}`} type="number" min="0" required defaultValue={plan?.limits?.[row.field] ?? 0} className="nf-field mt-1.5" />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface-2 p-3">
        <span>
          <span className="block text-sm font-bold text-fg">PDF Auto-Fill</span>
          <span className="mt-0.5 block text-xs text-fg-muted">Allow organizations on this plan to use PDF-assisted form filling.</span>
        </span>
        <input name="feature_pdf_autofill" type="checkbox" defaultChecked={plan ? plan.features?.pdfAutoFill === true : true} className="mt-1 h-4 w-4 rounded" />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</Button>
      </div>
    </form>
  )
}

export default function PlatformPlans() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editPlan, setEditPlan] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('catalogue')
  const [view, setView] = useState(readView)

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const data = await api.get('/api/platform/plans')
      setPlans(data.plans || [])
    } catch (err) {
      setError(err.message || 'Could not load plans')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const changeView = (next) => {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* Ignore unavailable storage. */ }
  }

  const visiblePlans = useMemo(() => {
    return plans.filter((plan) => plan.key !== 'custom')
  }, [plans])

  const filteredPlans = useMemo(() => {
    const query = search.trim().toLowerCase()
    const catalogueIndex = new Map(visiblePlans.map((plan, index) => [plan.key, index]))
    const filtered = visiblePlans.filter((plan) => {
      if (!query) return true
      return [plan.label, plan.key, descriptionFor(plan)]
        .some((value) => String(value || '').toLowerCase().includes(query))
    })

    return [...filtered].sort((left, right) => {
      if (sort === 'name') return String(left.label || '').localeCompare(String(right.label || ''))
      if (sort === 'organizations') {
        return Number(right.tenants?.total || 0) - Number(left.tenants?.total || 0)
          || String(left.label || '').localeCompare(String(right.label || ''))
      }
      return catalogueIndex.get(left.key) - catalogueIndex.get(right.key)
    })
  }, [search, sort, visiblePlans])

  const mostAssignedKey = useMemo(() => {
    const highest = Math.max(0, ...plans.map((plan) => Number(plan.tenants?.total || 0)))
    if (highest === 0) return null
    const winners = plans.filter((plan) => Number(plan.tenants?.total || 0) === highest)
    return winners.length === 1 ? winners[0].key : null
  }, [plans])

  const payloadFromForm = (form, includeKey = true) => {
    const fd = new FormData(form)
    const limits = Object.fromEntries(LIMIT_ROWS.map((row) => [row.field, Number(fd.get(`limit_${row.key}`))]))
    return {
      ...(includeKey ? { key: fd.get('key') } : {}),
      label: fd.get('label'),
      trialDays: fd.get('trialDays') ? Number(fd.get('trialDays')) : null,
      limits,
      features: { pdfAutoFill: fd.get('feature_pdf_autofill') === 'on' },
    }
  }

  const handleCreatePlan = async (event) => {
    event.preventDefault()
    setSaving(true)
    setModalError('')
    try {
      await api.post('/api/platform/plans', payloadFromForm(event.currentTarget))
      setShowCreateModal(false)
      toast.success('Plan created')
      await load()
    } catch (err) {
      setModalError(err.message || 'Could not create plan')
    } finally {
      setSaving(false)
    }
  }

  const handleEditPlan = async (event) => {
    event.preventDefault()
    setSaving(true)
    setModalError('')
    try {
      await api.put(`/api/platform/plans/${editPlan.key}`, payloadFromForm(event.currentTarget, false))
      setEditPlan(null)
      toast.success('Plan updated')
      await load()
    } catch (err) {
      setModalError(err.message || 'Could not update plan')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (plan) => {
    setModalError('')
    setEditPlan(plan)
  }

  const removePlan = async (plan) => {
    if (!await confirm({ title: `Delete ${plan.label}?`, message: 'Only an unused plan can be deleted. Organizations keep their existing settings.', confirmLabel: 'Delete plan', danger: true })) return
    setSaving(true)
    try {
      await api.delete(`/api/platform/plans/${encodeURIComponent(plan.key)}`)
      toast.success('Plan deleted')
      await load()
    } catch (err) { toast.error(err.message || 'Could not delete plan') }
    finally { setSaving(false) }
  }

  return (
    <AppShell
      title="Plan catalogue"
      subtitle="Plan defaults apply when organizations are provisioned. Tenant-specific limits stay under Organizations."
      actions={
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" onClick={() => { setModalError(''); setShowCreateModal(true) }}><Plus className="h-4 w-4" />Create plan</Button>
          <Link to="/platform" className="nf-button hidden sm:inline-flex"><Building2 className="h-4 w-4" />Manage assignments</Link>
        </div>
      }
    >
      {error && <AlertBanner className="mb-4" onRetry={load}>{error}</AlertBanner>}

      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1 sm:max-w-sm">
            <span className="sr-only">Search plans</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search plans"
              className="nf-field min-h-10 pl-9"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort plans"
            className="nf-field min-h-10 sm:w-auto"
          >
            <option value="catalogue">Catalogue order</option>
            <option value="name">Name A-Z</option>
            <option value="organizations">Most organizations</option>
          </select>
          <div className="inline-flex shrink-0 rounded-[10px] border border-line bg-surface-2 p-1" role="group" aria-label="Plan layout">
            <button
              type="button"
              onClick={() => changeView('grid')}
              aria-pressed={view === 'grid'}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === 'grid' ? 'bg-surface text-indigo-700 shadow-sm' : 'text-fg-muted hover:bg-surface-3 hover:text-fg'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />Cards
            </button>
            <button
              type="button"
              onClick={() => changeView('list')}
              aria-pressed={view === 'list'}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === 'list' ? 'bg-surface text-indigo-700 shadow-sm' : 'text-fg-muted hover:bg-surface-3 hover:text-fg'}`}
            >
              <List className="h-3.5 w-3.5" />Compare
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[430px] rounded-xl" />)}
          </div>
        ) : visiblePlans.length === 0 ? (
          <div className="nf-empty">No plans are available.</div>
        ) : filteredPlans.length === 0 ? (
          <div className="nf-empty">
            <p>No plans match your search.</p>
            <Button type="button" className="mt-3" onClick={() => setSearch('')}>Clear search</Button>
          </div>
        ) : view === 'grid' ? (
          <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredPlans.map((plan) => {
              const isCustom = plan.key === 'custom'
              const isMostAssigned = plan.key === mostAssignedKey
              return (
                <article key={plan.key} className="flex h-full min-h-[430px] flex-col rounded-xl border border-line bg-surface p-5 shadow-[0_3px_12px_rgb(36_39_44/0.05)]">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isMostAssigned ? 'bg-warning-subtle text-warning-fg' : 'bg-indigo-50 text-indigo-700'}`}>
                      <Star className="h-5 w-5" />
                    </span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {isMostAssigned && <StatusBadge tone="warning">Most assigned</StatusBadge>}
                      {plan.trialDays && <StatusBadge tone="info">{plan.trialDays}-day trial</StatusBadge>}
                      {isCustom && <StatusBadge tone="neutral">Organization-specific</StatusBadge>}
                    </div>
                  </div>
                  <h2 className="mt-4 text-xl font-bold tracking-[-0.025em] text-fg">{plan.label}</h2>
                  <p className="mt-1 min-h-10 text-sm text-fg-muted">{descriptionFor(plan)}</p>
                  <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface-2/60 py-3 text-center">
                    <div className="px-2"><p className="text-lg font-bold tabular-nums text-fg">{plan.tenants?.total ?? 0}</p><p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Total</p></div>
                    <div className="px-2"><p className="text-lg font-bold tabular-nums text-fg">{plan.tenants?.active ?? 0}</p><p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Active</p></div>
                    <div className="px-2"><p className="text-lg font-bold tabular-nums text-fg">{plan.tenants?.suspended ?? 0}</p><p className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Suspended</p></div>
                  </div>
                  {!isCustom && (
                    <>
                      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
                        {LIMIT_ROWS.map((row) => (
                          <div key={row.key}>
                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{row.label.replace(' (MB)', '')}</dt>
                            <dd className="mt-0.5 text-sm font-bold text-fg">{plan.limitsDisplay?.[row.key] ?? '—'}</dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  )}
                  {isCustom && (
                    <div className="mt-4 flex flex-1 flex-col justify-center rounded-lg border border-dashed border-line bg-surface-2/60 p-4">
                      <p className="text-sm font-bold text-fg">Configured per organization</p>
                      <p className="mt-1 text-xs leading-relaxed text-fg-muted">Limits and feature access are managed individually from each organization.</p>
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                    <Link to={`/platform?plan=${encodeURIComponent(plan.key)}`} className="nf-button">
                      <Building2 className="h-4 w-4" />{isCustom ? 'Manage organizations' : 'View organizations'}
                    </Link>
                    {!isCustom && <Button type="button" onClick={() => openEdit(plan)}><Pencil className="h-4 w-4" />Edit</Button>}
                    {!isCustom && Number(plan.tenants?.total)===0 && <IconButton label={`Delete ${plan.label}`} disabled={saving} onClick={() => removePlan(plan)}><Trash2 className="h-4 w-4" /></IconButton>}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="nf-data-table min-w-[980px]">
              <thead><tr><th>Plan</th><th>Organizations</th><th>Trial</th><th>Limits</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {filteredPlans.map((plan) => {
                  const isCustom = plan.key === 'custom'
                  const isMostAssigned = plan.key === mostAssignedKey
                  return (
                    <tr key={plan.key}>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-fg">{plan.label}</span>
                          {isMostAssigned && <StatusBadge tone="warning">Most assigned</StatusBadge>}
                          {isCustom && <StatusBadge tone="neutral">Organization-specific</StatusBadge>}
                        </div>
                        <div className="mt-0.5 text-xs text-fg-muted">{descriptionFor(plan)}</div>
                      </td>
                      <td><div className="font-bold tabular-nums text-fg">{plan.tenants?.total ?? 0}</div><div className="mt-0.5 text-xs text-fg-muted">{plan.tenants?.active ?? 0} active · {plan.tenants?.suspended ?? 0} suspended</div></td>
                      <td>{plan.trialDays ? `${plan.trialDays} days` : '—'}</td>
                      <td className="max-w-[430px]">
                        {isCustom ? (
                          <span className="text-sm text-fg-muted">Configured per organization</span>
                        ) : (
                          <div className="space-y-1 text-xs text-fg-muted">
                            <p>
                              Users <strong className="text-fg">{plan.limitsDisplay?.users || '\u2014'}</strong>{' \u00b7 '}
                              Builders <strong className="text-fg">{plan.limitsDisplay?.builders || '\u2014'}</strong>{' \u00b7 '}
                              Forms <strong className="text-fg">{plan.limitsDisplay?.forms || '\u2014'}</strong>{' \u00b7 '}
                              Workflows <strong className="text-fg">{plan.limitsDisplay?.workflows || '\u2014'}</strong>
                            </p>
                            <p>
                              Submissions / billing period <strong className="text-fg">{plan.limitsDisplay?.submissions || '\u2014'}</strong>{' \u00b7 '}
                              Storage <strong className="text-fg">{plan.limitsDisplay?.storage || '\u2014'}</strong>{' \u00b7 '}
                              Files <strong className="text-fg">{plan.limitsDisplay?.files || '\u2014'}</strong>
                            </p>
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <Link to={`/platform?plan=${encodeURIComponent(plan.key)}`} className="nf-button">
                            <Building2 className="h-4 w-4" />Organizations
                          </Link>
                          {!isCustom && <IconButton label={`Edit ${plan.label}`} onClick={() => openEdit(plan)}><Pencil className="h-4 w-4" /></IconButton>}
                          {!isCustom && Number(plan.tenants?.total)===0 && <IconButton label={`Delete ${plan.label}`} disabled={saving} onClick={() => removePlan(plan)}><Trash2 className="h-4 w-4" /></IconButton>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create plan" size="md">
        <PlanForm busy={saving} error={modalError} submitLabel="Create plan" onSubmit={handleCreatePlan} onCancel={() => setShowCreateModal(false)} />
      </Modal>
      <Modal open={Boolean(editPlan)} onClose={() => setEditPlan(null)} title={editPlan ? `Edit ${editPlan.label}` : 'Edit plan'} size="md">
        {editPlan && <PlanForm key={editPlan.key} plan={editPlan} busy={saving} error={modalError} submitLabel="Save changes" onSubmit={handleEditPlan} onCancel={() => setEditPlan(null)} />}
      </Modal>
    </AppShell>
  )
}
