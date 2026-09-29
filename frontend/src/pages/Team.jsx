import { useCallback, useMemo, useState, useEffect } from 'react'
import { AlertTriangle, ArrowRight, Eye, FileText, ListChecks, Search, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import { AlertBanner } from '../components/Alert'
import { Pagination, ViewToggle } from '../components/NetFlowUI'
import { api } from '../utils/api'
import { initials } from '../utils/auth'
import { colourForName } from '../utils/adapters'

const PAGE_SIZE = 10

const relationLabel = {
  report: 'Direct report',
  hr: 'HR partner',
  indirect: 'Reports up to you',
}

const formatAvailabilityDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function TeamMetric({ label, value, hint, icon: Icon, tone = 'blue' }) {
  return (
    <article className={`nf-team-metric nf-team-tone-${tone}`}>
      <div className="nf-team-metric-top">
        <p>{label}</p>
        <span className="nf-team-metric-icon"><Icon aria-hidden="true" /></span>
      </div>
      <strong>{value}</strong>
      <span className="nf-team-metric-hint">{hint}</span>
    </article>
  )
}

function AvailabilityBadge({ member }) {
  const away = Boolean(member.outOfOffice)
  return (
    <span className={`nf-team-availability ${away ? 'is-away' : 'is-available'}`}>
      <span aria-hidden="true" />
      {away ? 'Out of office' : 'Available'}
    </span>
  )
}

function OverdueValue({ value }) {
  const count = Number(value || 0)
  if (count <= 0) return <span className="nf-team-zero">0</span>
  return (
    <span className="nf-team-overdue">
      <span aria-hidden="true" />
      {count}
    </span>
  )
}

function MemberIdentity({ member, size = 'table' }) {
  return (
    <div className={`nf-team-identity is-${size}`}>
      <span aria-hidden="true" className={`nf-team-avatar ${colourForName(member.name)}`}>
        {initials(member.name)}
      </span>
      <div>
        <strong>{member.name || 'Unnamed member'}</strong>
        <span>{member.role || 'Role unavailable'}</span>
      </div>
    </div>
  )
}

function TeamTable({ members, onSelect }) {
  return (
    <div className="nf-team-table-scroll">
      <table className="nf-team-table" aria-label="Team members">
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Department</th>
            <th scope="col">Pending approvals</th>
            <th scope="col">Open requests</th>
            <th scope="col">Overdue</th>
            <th scope="col">Availability</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member._id}>
              <td><MemberIdentity member={member} /></td>
              <td>{member.department || 'Unassigned'}</td>
              <td className="nf-team-number">{member.pendingApprovals || 0}</td>
              <td className="nf-team-number">{member.openRequests || 0}</td>
              <td><OverdueValue value={member.overdue} /></td>
              <td><AvailabilityBadge member={member} /></td>
              <td>
                <div className="nf-team-row-action">
                  <button type="button" className="nf-team-detail-button" onClick={() => onSelect(member)}>
                    View details
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TeamGrid({ members, onSelect }) {
  return (
    <div className="nf-team-grid">
      {members.map((member) => (
        <article key={member._id} className="nf-team-card">
          <div className="nf-team-card-body">
            <div className="nf-team-card-head">
              <span aria-hidden="true" className={`nf-team-avatar is-card ${colourForName(member.name)}`}>
                {initials(member.name)}
              </span>
              <AvailabilityBadge member={member} />
            </div>
            <h2>{member.name || 'Unnamed member'}</h2>
            <p>{[member.role, member.department].filter(Boolean).join(' · ') || 'Role unavailable'}</p>
            <dl className="nf-team-card-facts">
              <div><dt>Pending approvals</dt><dd>{member.pendingApprovals || 0}</dd></div>
              <div><dt>Open requests</dt><dd>{member.openRequests || 0}</dd></div>
              <div className="is-wide"><dt>Overdue</dt><dd><OverdueValue value={member.overdue} /></dd></div>
            </dl>
          </div>
          <footer className="nf-team-card-footer">
            <button type="button" className="nf-team-card-action" onClick={() => onSelect(member)}>
              <Eye aria-hidden="true" />
              View details
            </button>
          </footer>
        </article>
      ))}
    </div>
  )
}

function TeamSkeleton({ view }) {
  if (view === 'grid') {
    return (
      <div className="nf-team-grid" aria-label="Loading team members">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="nf-team-card nf-team-skeleton-card">
            <div className="nf-team-skeleton-line is-avatar" />
            <div className="nf-team-skeleton-line is-title" />
            <div className="nf-team-skeleton-line is-copy" />
            <div className="nf-team-skeleton-line is-facts" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="nf-team-table-skeleton" aria-label="Loading team members">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index}><span /><span /><span /><span /></div>
      ))}
    </div>
  )
}

export default function Team() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [availability, setAvailability] = useState('all')
  const [workload, setWorkload] = useState('all')
  const [sort, setSort] = useState('name')
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('netflow.team.view') === 'grid' ? 'grid' : 'list' } catch { return 'list' }
  })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api.get('/api/team')
      .then(setData)
      .catch((cause) => setError(cause.message || 'Could not load your team'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const members = useMemo(() => data?.members || [], [data])
  const totals = data?.totals || { members: 0, pendingApprovals: 0, openRequests: 0, overdue: 0 }

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const visible = members.filter((member) => {
      const away = Boolean(member.outOfOffice)
      if (availability === 'available' && away) return false
      if (availability === 'away' && !away) return false
      if (workload === 'attention' && !(member.overdue > 0 || member.pendingApprovals > 0)) return false
      if (workload === 'overdue' && !(member.overdue > 0)) return false
      return !needle || [member.name, member.email, member.department, member.role]
        .some((value) => String(value || '').toLowerCase().includes(needle))
    })

    return [...visible].sort((a, b) => {
      const byName = String(a.name || '').localeCompare(String(b.name || ''))
      if (sort === 'pending') return (b.pendingApprovals - a.pendingApprovals) || byName
      if (sort === 'overdue') return (b.overdue - a.overdue) || byName
      if (sort === 'requests') return (b.openRequests - a.openRequests) || byName
      return byName
    })
  }, [members, query, availability, workload, sort])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const displayed = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const updateView = (next) => {
    setView(next)
    try { localStorage.setItem('netflow.team.view', next) } catch { /* optional preference */ }
  }
  const updateQuery = (next) => { setQuery(next); setPage(1) }
  const updateAvailability = (next) => { setAvailability(next); setPage(1) }
  const updateWorkload = (next) => { setWorkload(next); setPage(1) }
  const updateSort = (next) => { setSort(next); setPage(1) }
  const filtered = Boolean(query.trim() || availability !== 'all' || workload !== 'all')
  const metricValue = (value) => (loading && !data ? '—' : value)

  return (
    <AppShell
      title="My team"
      subtitle="See each member's pending decisions, open requests, deadlines, and availability."
      actions={(
        <Link to="/tasks" className="nf-button nf-team-open-approvals">
          <ListChecks aria-hidden="true" />
          Open approvals
        </Link>
      )}
    >
      <div className="nf-team-page">
        {error && <AlertBanner className="mb-4" onRetry={load}>{error}</AlertBanner>}

        <section className="nf-team-metrics" aria-label="Team workload overview">
          <TeamMetric label="Team members" value={metricValue(totals.members)} hint="Populated from the existing API" icon={UsersRound} />
          <TeamMetric label="Pending approvals" value={metricValue(totals.pendingApprovals)} hint="Populated from the existing API" icon={ListChecks} tone="amber" />
          <TeamMetric label="Open requests" value={metricValue(totals.openRequests)} hint="Populated from the existing API" icon={FileText} tone="purple" />
          <TeamMetric label="Overdue" value={metricValue(totals.overdue)} hint="Populated from the existing API" icon={AlertTriangle} tone="coral" />
        </section>

        <section className="nf-team-management" aria-label="Team member catalogue">
          <div className="nf-team-toolbar">
            <div className="nf-team-toolbar-fields">
              <label className="nf-team-search" htmlFor="team-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Search team members</span>
                <input
                  id="team-search"
                  type="search"
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                  placeholder="Search name, role, or department"
                />
              </label>
              <select value={availability} onChange={(event) => updateAvailability(event.target.value)} aria-label="Filter by availability">
                <option value="all">All availability</option>
                <option value="available">Available</option>
                <option value="away">Out of office</option>
              </select>
              <select value={workload} onChange={(event) => updateWorkload(event.target.value)} aria-label="Filter by workload">
                <option value="all">All workload</option>
                <option value="attention">Needs attention</option>
                <option value="overdue">Has overdue work</option>
              </select>
              <select value={sort} onChange={(event) => updateSort(event.target.value)} aria-label="Sort team members">
                <option value="name">Name A-Z</option>
                <option value="pending">Most pending</option>
                <option value="overdue">Most overdue</option>
                <option value="requests">Most open requests</option>
              </select>
            </div>
            <ViewToggle value={view} onChange={updateView} label="My team layout" />
          </div>

          <div className="nf-team-results" aria-live="polite">
            {loading && !data ? (
              <TeamSkeleton view={view} />
            ) : members.length === 0 ? (
              <div className="nf-team-empty">
                <EmptyState icon={<UsersRound aria-hidden="true" />} title="No one reports to you yet" description="People appear here after an administrator assigns a manager or HR partner." />
              </div>
            ) : rows.length === 0 ? (
              <div className="nf-team-empty">
                <EmptyState
                  icon={<UsersRound aria-hidden="true" />}
                  title="No matching team members"
                  description="Try another name, role, or department."
                  action={filtered ? <button type="button" className="nf-team-clear" onClick={() => { updateQuery(''); updateAvailability('all'); updateWorkload('all') }}>Clear filters</button> : null}
                />
              </div>
            ) : view === 'grid' ? (
              <TeamGrid members={displayed} onSelect={setSelected} />
            ) : (
              <TeamTable members={displayed} onSelect={setSelected} />
            )}
          </div>

          {!loading && rows.length > 0 && (
            <div className="nf-team-pagination">
              <Pagination page={safePage} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} noun="team members" />
            </div>
          )}
        </section>
      </div>

      {selected && (
        <Modal onClose={() => setSelected(null)} title={selected.name} description="Current team workload">
          <dl className="nf-team-modal-facts">
            <div><dt>Role</dt><dd>{selected.role || 'Role unavailable'}</dd></div>
            <div><dt>Department</dt><dd>{selected.department || 'Unassigned'}</dd></div>
            <div><dt>Relationship</dt><dd>{relationLabel[selected.relation] || 'Team member'}</dd></div>
            <div><dt>Email</dt><dd>{selected.email || 'Not available'}</dd></div>
            <div><dt>Pending approvals</dt><dd className="is-number">{selected.pendingApprovals || 0}</dd></div>
            <div><dt>Open requests</dt><dd className="is-number">{selected.openRequests || 0}</dd></div>
            <div><dt>Overdue</dt><dd className="is-number is-danger">{selected.overdue || 0}</dd></div>
            <div>
              <dt>Availability</dt>
              <dd>{selected.outOfOffice ? `Out of office${formatAvailabilityDate(selected.outOfOffice.until) ? ` until ${formatAvailabilityDate(selected.outOfOffice.until)}` : ''}` : 'Available'}</dd>
            </div>
          </dl>
          <div className="nf-team-modal-actions">
            <button type="button" className="nf-button" onClick={() => setSelected(null)}>Close</button>
            <Link to="/tasks?scope=team" className="nf-button nf-button-primary">
              Open team requests
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
