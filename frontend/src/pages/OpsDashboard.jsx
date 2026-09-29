// Shell 3 (Business Ops) - OpsDashboard.jsx
// The home screen for CEO / VP / Manager / HR.
//
// These roles used to land on the builder dashboard, which opens with "Total
// Workflows" and an execution chart — a designer's view of the workspace. A
// leader's first question is narrower and more urgent: what is waiting on my
// signature, and who on my side is stuck? So the page opens with the decision
// queue, oldest first, and the team's load sits next to it.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { useUser } from '../utils/auth'
import { useTasks, tasksStore } from '../lib/tasksStore'
import { adaptTask } from '../utils/adapters'
import { StatCardSkeleton, ListRowSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { statusBadge } from '../utils/badges'
import { relativeTime } from '../utils/datetime'

const OPEN = ['Pending', 'Escalated']

const greeting = () => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// How long a decision has been sitting with someone. Leaders act on the oldest
// item, so this reads as an age rather than a timestamp.
const waitingFor = (task) => relativeTime(task.createdAt) || 'just now'

function StatCard({ icon: Icon, tone, label, value, hint }) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
    danger: 'bg-danger-subtle text-danger-fg',
    warning: 'bg-warning-subtle text-warning-fg',
    success: 'bg-success-subtle text-success-fg',
    sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300'
  }
  const corners = {
    indigo: 'bg-indigo-50',
    danger: 'bg-danger-subtle',
    warning: 'bg-warning-subtle',
    success: 'bg-success-subtle',
    sky: 'bg-indigo-50',
  }
  return (
    <div className="nf-panel relative min-h-[142px] overflow-hidden px-[18px] py-4">
      <span aria-hidden="true" className={`absolute -right-[25px] -bottom-[48px] h-[98px] w-[98px] rounded-full opacity-60 ${corners[tone] || corners.indigo}`} />
      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-fg-muted">{label}</p>
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] ${tones[tone] || tones.indigo}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="relative z-10 mt-5 text-[28px] font-bold leading-none tabular-nums text-fg">{value}</p>
      {hint ? <p className="relative z-10 mt-2 text-[11px] text-fg-muted truncate">{hint}</p> : null}
    </div>
  )
}

// The queue. One row per decision, oldest at the top, overdue called out.
function DecisionQueue({ tasks, loading }) {
  const rows = tasks.slice(0, 7)
  return (
    <div className="bg-surface border border-line rounded-xl flex flex-col xl:col-span-2">
      <div className="px-5 py-4 flex items-center justify-between border-b border-line">
        <div>
          <h2 className="text-sm font-semibold text-fg">Needs your decision</h2>
          <p className="text-xs text-fg-muted mt-0.5">Oldest first — {tasks.length} waiting</p>
        </div>
        <Link to="/tasks" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Open inbox</Link>
      </div>

      {loading && rows.length === 0 ? (
        <ul className="divide-y divide-line">
          {Array.from({ length: 4 }).map((_, i) => <li key={i}><ListRowSkeleton /></li>)}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="Nothing waiting on you"
          description="Your approval queue is clear. New requests will land here as they reach your step."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((t) => {
            const badge = statusBadge(t.slaBreached ? 'Escalated' : t.status)
            return (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition">
                  <span className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-semibold shrink-0 ${t.avatarColor}`}>
                    {t.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg truncate">{t.title}</p>
                    <p className="text-xs text-fg-muted truncate">
                      {t.requester} · waiting {waitingFor(t)}
                    </p>
                  </div>
                  {t.slaBreached ? (
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${badge.badge}`}>Overdue</span>
                  ) : (
                    <span className="text-[11px] text-fg-subtle">{t.department}</span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Who on the team is carrying the load. Sorted by trouble: overdue first, then
// the biggest queue — the people a leader should unblock today.
function TeamLoad({ team, loading }) {
  const rows = useMemo(() => {
    const members = team?.members || []
    return [...members]
      .filter((m) => m.pendingApprovals > 0 || m.openRequests > 0 || m.outOfOffice)
      .sort((a, b) => (b.overdue - a.overdue) || (b.pendingApprovals - a.pendingApprovals))
      .slice(0, 6)
  }, [team])

  return (
    <div className="bg-surface border border-line rounded-xl flex flex-col">
      <div className="px-5 py-4 flex items-center justify-between border-b border-line">
        <div>
          <h2 className="text-sm font-semibold text-fg">Team load</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            {team?.totals?.members || 0} {team?.totals?.members === 1 ? 'person' : 'people'}
          </p>
        </div>
        <Link to="/team" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">View team</Link>
      </div>

      {loading ? (
        <ul className="divide-y divide-line">
          {Array.from({ length: 3 }).map((_, i) => <li key={i}><ListRowSkeleton /></li>)}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          className="flex-1"
          title={team?.totals?.members ? 'Team is clear' : 'No one reports to you yet'}
          description={
            team?.totals?.members
              ? 'Nobody on your team has anything pending right now.'
              : 'Once reporting lines are set in Users, your people show up here.'
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((m) => (
            <li key={m._id} className="px-5 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg truncate">
                  {m.name}
                  {m.outOfOffice ? <span className="ml-2 text-[11px] text-fg-subtle">away</span> : null}
                </p>
                <p className="text-xs text-fg-muted truncate">{m.role || m.department}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-fg">{m.pendingApprovals}</p>
                <p className="text-[11px] text-fg-subtle">
                  {m.overdue > 0 ? <span className="text-danger-fg">{m.overdue} overdue</span> : 'in queue'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// What the team has raised that is still moving — the leader's early warning on
// work that has not reached them yet.
function TeamRequests({ tasks, loading }) {
  const rows = tasks.slice(0, 6)
  return (
    <div className="bg-surface border border-line rounded-xl flex flex-col">
      <div className="px-5 py-4 flex items-center justify-between border-b border-line">
        <h2 className="text-sm font-semibold text-fg">Team requests in flight</h2>
        <Link to="/tasks?scope=team" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">See all</Link>
      </div>
      {loading && rows.length === 0 ? (
        <ul className="divide-y divide-line">
          {Array.from({ length: 3 }).map((_, i) => <li key={i}><ListRowSkeleton /></li>)}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="Nothing in flight"
          description="Requests raised by your team appear here while they move through approvals."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((t) => {
            const badge = statusBadge(t.status)
            return (
              <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{t.title}</p>
                  <p className="text-xs text-fg-muted truncate">
                    {t.requester} · with {t.approver || 'unassigned'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium shrink-0 ${badge.badge}`}>
                  {t.status}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// A leader's own decisions, most recent first — useful when someone asks "did
// you already sign this off?".
function RecentDecisions({ tasks }) {
  const rows = tasks.slice(0, 6)
  return (
    <div className="bg-surface border border-line rounded-xl flex flex-col">
      <div className="px-5 py-4 flex items-center justify-between border-b border-line">
        <h2 className="text-sm font-semibold text-fg">Your recent decisions</h2>
        <Link to="/analytics" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Reports</Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="No decisions yet"
          description="Approvals and rejections you make will be listed here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((t) => {
            const badge = statusBadge(t.status)
            return (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="px-5 py-3 flex items-center gap-3 hover:bg-surface-2 transition">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg truncate">{t.title}</p>
                    <p className="text-xs text-fg-muted truncate">{t.requester} · {relativeTime(t.createdAt)}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium shrink-0 ${badge.badge}`}>
                    {t.status}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function OpsDashboard() {
  const user = useUser()
  const myTasks = useTasks()
  const myId = user?._id || user?.id || null
  const firstName = (user?.name || 'there').split(' ')[0]

  const [team, setTeam] = useState(null)
  const [teamTasks, setTeamTasks] = useState([])
  const [booting, setBooting] = useState(true)
  const [teamLoading, setTeamLoading] = useState(true)

  useEffect(() => {
    tasksStore.refresh().finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([
      api.get('/api/team').catch(() => null),
      api.get('/api/tasks/my-tasks?scope=team').catch(() => null)
    ])
      .then(([teamRes, taskRes]) => {
        if (!alive) return
        setTeam(teamRes || { members: [], totals: {} })
        setTeamTasks((taskRes?.tasks || []).map(adaptTask).filter(Boolean))
      })
      .finally(() => { if (alive) setTeamLoading(false) })
    return () => { alive = false }
  }, [])

  // Waiting on me: assigned to me, or a committee vote I am one of, and not yet
  // decided. Committee tasks name a single representative in `assignedTo`, so
  // matching on that alone would hide them from every other voter.
  const queue = useMemo(() => {
    const isMine = (t) =>
      t.assignedToId === myId ||
      (t.isMultiApproval && (t.parallelApprovers || []).some((p) => p.id === myId))
    return myTasks
      .filter((t) => OPEN.includes(t.status) && isMine(t))
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
  }, [myTasks, myId])

  const overdue = useMemo(() => queue.filter((t) => t.slaBreached), [queue])

  const decided = useMemo(
    () => myTasks
      .filter((t) => t.assignedToId === myId && ['Approved', 'Rejected'].includes(t.status))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [myTasks, myId]
  )

  const teamOpen = useMemo(() => teamTasks.filter((t) => OPEN.includes(t.status)), [teamTasks])

  const oldest = queue[0]

  return (
    <AppShell
      title={<>{greeting()}, {firstName}</>}
      subtitle="Your approvals and your team, at a glance."
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {booting && myTasks.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard
                icon={IconInbox}
                tone="indigo"
                label="Waiting on you"
                value={queue.length}
                hint={oldest ? `oldest ${waitingFor(oldest)}` : 'queue is clear'}
              />
              <StatCard icon={IconAlert} tone="danger" label="Overdue" value={overdue.length} />
              <StatCard
                icon={IconTeam}
                tone="success"
                label="Team open requests"
                value={team?.totals?.openRequests ?? 0}
                hint={`${team?.totals?.members || 0} people`}
              />
              <StatCard
                icon={IconCheck}
                tone="indigo"
                label="Decisions made"
                value={decided.length}
                hint="All available data"
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <DecisionQueue tasks={queue} loading={booting} />
          <TeamLoad team={team} loading={teamLoading} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <TeamRequests tasks={teamOpen} loading={teamLoading} />
          <RecentDecisions tasks={decided} />
        </div>
      </div>
    </AppShell>
  )
}

function IconInbox(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6l3.5-7z" /></svg> }
function IconAlert(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg> }
function IconCheck(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
function IconTeam(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3" /><path strokeLinecap="round" strokeLinejoin="round" d="M2 20c0-2.8 3.1-4.5 7-4.5s7 1.7 7 4.5M16 5.5a3 3 0 010 5.8M18 20c0-2 .8-3.3 4-4" /></svg> }

export default OpsDashboard
