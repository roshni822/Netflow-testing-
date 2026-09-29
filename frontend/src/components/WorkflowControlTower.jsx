import { AlertTriangle, ArrowRight, Clock3, GitBranch } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Panel, PanelHeader } from './NetFlowUI'

const asNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const plural = (value, one, many = `${one}s`) => value === 1 ? one : many

const formatDuration = (milliseconds) => {
  if (milliseconds == null || !Number.isFinite(Number(milliseconds))) return '—'
  const value = Math.max(0, Number(milliseconds))
  if (value < 60000) return '<1m'
  if (value < 3600000) return `${Math.round(value / 60000)}m`
  if (value < 86400000) return `${Number((value / 3600000).toFixed(1))}h`
  return `${Number((value / 86400000).toFixed(1))}d`
}

const formatRelativeTime = (value) => {
  if (!value) return 'Never'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Never'
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const formatStatus = (value) => {
  const status = String(value || 'unknown')
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function SummaryStrip({ totals }) {
  const items = [
    { label: 'Open requests', value: asNumber(totals?.openRequests).toLocaleString(), hint: 'Running or paused now', tone: 'text-fg' },
    { label: 'Overdue', value: asNumber(totals?.overdueTasks).toLocaleString(), hint: 'Active tasks past due', tone: asNumber(totals?.overdueTasks) > 0 ? 'text-danger-fg' : 'text-fg' },
    { label: 'Failed runs', value: asNumber(totals?.failedRuns).toLocaleString(), hint: 'In selected period', tone: asNumber(totals?.failedRuns) > 0 ? 'text-danger-fg' : 'text-fg' },
    { label: 'Median completion', value: formatDuration(totals?.medianCompletionMs), hint: 'Completed runs in period', tone: 'text-fg' },
  ]
  return (
    <div className='grid grid-cols-2 border-y border-line bg-surface-2/45 xl:grid-cols-4' aria-label='Workflow control summary'>
      {items.map((item, index) => (
        <div key={item.label} className={`min-w-0 px-4 py-3 sm:px-5 ${index < 2 ? 'border-b xl:border-b-0' : ''} ${index % 2 === 0 ? 'border-r xl:border-r-0' : ''} ${index > 0 ? 'xl:border-l' : ''} border-line`}>
          <p className='text-[11px] font-semibold text-fg-muted'>{item.label}</p>
          <p className={`mt-1 text-xl font-bold leading-none tabular-nums ${item.tone}`}>{item.value}</p>
          <p className='mt-1.5 truncate text-[10px] text-fg-subtle' title={item.hint}>{item.hint}</p>
        </div>
      ))}
    </div>
  )
}

function LoadingState() {
  return (
    <div role='status' aria-label='Loading workflow control tower'>
      <div className='grid animate-pulse grid-cols-2 border-y border-line bg-surface-2/45 xl:grid-cols-4'>
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className='space-y-2 border-line px-5 py-4'>
            <div className='h-2.5 w-20 rounded bg-surface-3' />
            <div className='h-6 w-12 rounded bg-surface-3' />
            <div className='h-2 w-28 max-w-full rounded bg-surface-3' />
          </div>
        ))}
      </div>
      <div className='animate-pulse space-y-3 p-5'>
        {[0, 1, 2].map((item) => <div key={item} className='h-12 rounded-lg bg-surface-2' />)}
      </div>
    </div>
  )
}

function ErrorState({ onRetry }) {
  return (
    <div className='flex min-h-[188px] flex-col items-center justify-center px-6 py-6 text-center' role='alert'>
      <span className='inline-flex h-11 w-11 items-center justify-center rounded-full bg-danger-subtle text-danger-fg'>
        <AlertTriangle aria-hidden='true' className='h-5 w-5' />
      </span>
      <h3 className='mt-3 text-sm font-bold text-fg'>Workflow control data unavailable</h3>
      <p className='mt-1 max-w-md text-xs leading-5 text-fg-muted'>The connected analytics service did not return the workflow snapshot.</p>
      <button type='button' className='nf-button mt-3' onClick={onRetry}>Try again</button>
    </div>
  )
}

function NoWorkflowsState({ canManage }) {
  return (
    <div className='flex min-h-[188px] flex-col items-center justify-center px-6 py-6 text-center'>
      <span className='inline-flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200'>
        <GitBranch aria-hidden='true' className='h-5 w-5' />
      </span>
      <h3 className='mt-3 text-sm font-bold text-fg'>No workflows available</h3>
      <p className='mt-1 max-w-md text-xs leading-5 text-fg-muted'>No workflow definitions are available in your reporting scope.</p>
      {canManage && <Link to='/workflows/new' className='nf-button nf-button-primary mt-3'>Create workflow</Link>}
    </div>
  )
}

function WorkloadBar({ row, maximum }) {
  const value = asNumber(row.openRequests)
  const width = maximum > 0 ? Math.max(value > 0 ? 6 : 0, Math.round((value / maximum) * 100)) : 0
  const risky = asNumber(row.overdueTasks) > 0
  return (
    <div
      className='flex min-w-[170px] items-center gap-3'
      role='img'
      aria-label={`${row.title || 'Workflow'} has ${value} open ${plural(value, 'request')}`}
    >
      <div className='h-2 flex-1 overflow-hidden rounded-full bg-surface-3'>
        <span className={`block h-full rounded-full ${risky ? 'bg-danger-fg' : 'bg-indigo-600 dark:bg-indigo-400'}`} style={{ width: `${width}%` }} />
      </div>
      <strong className='w-7 text-right text-sm tabular-nums text-fg'>{value}</strong>
    </div>
  )
}

function WorkflowName({ row }) {
  return (
    <div className='min-w-0'>
      <strong className='block truncate text-sm text-fg' title={row.title || 'Untitled workflow'}>{row.title || 'Untitled workflow'}</strong>
      <span className='mt-0.5 block text-[11px] text-fg-muted'>
        {formatStatus(row.status)}
        {asNumber(row.failedRuns) > 0 ? ` · ${row.failedRuns} failed in period` : ''}
      </span>
    </div>
  )
}

function CompletionValue({ row }) {
  if (row.completionRate == null) return <span className='text-fg-subtle' aria-label='No terminal runs in selected period'>—</span>
  const value = Math.max(0, Math.min(100, Number(row.completionRate)))
  return (
    <div className='min-w-[100px]' aria-label={`${value}% completion rate from ${asNumber(row.terminalRuns)} terminal runs`}>
      <div className='flex items-center justify-between gap-2'>
        <strong className='text-sm tabular-nums text-fg'>{value}%</strong>
        <span className='text-[10px] text-fg-subtle'>{asNumber(row.completedRuns)}/{asNumber(row.terminalRuns)}</span>
      </div>
      <div className='mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3'>
        <span className='block h-full rounded-full bg-success-fg' style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function DesktopRows({ rows, maximum }) {
  return (
    <div className='hidden overflow-x-auto md:block'>
      <table className='nf-data-table min-w-[900px]'>
        <caption className='sr-only'>Highest-risk workflows with live workload and selected-period completion performance.</caption>
        <thead>
          <tr>
            <th className='w-[28%]'>Workflow</th>
            <th className='w-[25%]'>Current workload</th>
            <th>Pending</th>
            <th>Overdue</th>
            <th>Completion</th>
            <th>Last run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.workflowId}>
              <td><WorkflowName row={row} /></td>
              <td><WorkloadBar row={row} maximum={maximum} /></td>
              <td><span className='tabular-nums text-fg'>{asNumber(row.pendingTasks)}</span></td>
              <td>
                {asNumber(row.overdueTasks) > 0
                  ? <span className='inline-flex items-center gap-1.5 font-semibold tabular-nums text-danger-fg'><i aria-hidden='true' className='h-1.5 w-1.5 rounded-full bg-danger-fg' />{row.overdueTasks}</span>
                  : <span className='tabular-nums text-fg'>0</span>}
              </td>
              <td><CompletionValue row={row} /></td>
              <td>
                <time className='whitespace-nowrap text-xs text-fg-muted' dateTime={row.lastRunAt || undefined} title={row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : 'No recorded executions'}>
                  {formatRelativeTime(row.lastRunAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MobileRows({ rows, maximum }) {
  return (
    <div className='divide-y divide-line md:hidden'>
      {rows.map((row) => (
        <article key={row.workflowId} className='space-y-4 px-4 py-4'>
          <WorkflowName row={row} />
          <div>
            <p className='mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-fg-subtle'>Current workload</p>
            <WorkloadBar row={row} maximum={maximum} />
          </div>
          <dl className='grid grid-cols-2 gap-x-4 gap-y-3'>
            <div><dt className='text-[10px] font-semibold text-fg-muted'>Pending</dt><dd className='mt-1 text-sm font-bold tabular-nums text-fg'>{asNumber(row.pendingTasks)}</dd></div>
            <div><dt className='text-[10px] font-semibold text-fg-muted'>Overdue</dt><dd className={`mt-1 text-sm font-bold tabular-nums ${asNumber(row.overdueTasks) > 0 ? 'text-danger-fg' : 'text-fg'}`}>{asNumber(row.overdueTasks)}</dd></div>
            <div><dt className='text-[10px] font-semibold text-fg-muted'>Completion</dt><dd className='mt-1'><CompletionValue row={row} /></dd></div>
            <div><dt className='text-[10px] font-semibold text-fg-muted'>Last run</dt><dd className='mt-1 text-sm font-semibold text-fg'>{formatRelativeTime(row.lastRunAt)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  )
}

export default function WorkflowControlTower({ data, loading, error, onRetry, canManage }) {
  const rows = Array.isArray(data?.workflows) ? data.workflows : []
  const totalWorkflows = asNumber(data?.totalWorkflows)
  const maximum = Math.max(0, ...rows.map((row) => asNumber(row.openRequests)))
  const hasActivity = rows.some((row) =>
    asNumber(row.openRequests) > 0 ||
    asNumber(row.pendingTasks) > 0 ||
    asNumber(row.terminalRuns) > 0 ||
    Boolean(row.lastRunAt)
  )
  const action = (
    <Link to={canManage ? '/workflows' : '/analytics'} className='nf-button'>
      {canManage ? 'View all workflows' : 'View full report'}
      <ArrowRight aria-hidden='true' className='h-4 w-4' />
    </Link>
  )

  return (
    <Panel className='mt-4 overflow-hidden'>
      <PanelHeader
        title='Workflow Operations Overview'
        description='Monitor workload, performance, and workflow activity for the selected period'
        actions={action}
      />
      {loading ? <LoadingState /> : error ? <ErrorState onRetry={onRetry} /> : totalWorkflows === 0 ? (
        <NoWorkflowsState canManage={canManage} />
      ) : (
        <>
          <p className='sr-only'>Open requests, pending work and overdue tasks are live. Failed runs and completion performance use the selected dashboard period.</p>
          <SummaryStrip totals={data?.totals} />
          {!hasActivity && (
            <div className='flex items-center gap-3 border-b border-line bg-indigo-50/60 px-4 py-3 text-xs text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200'>
              <Clock3 aria-hidden='true' className='h-4 w-4 shrink-0' />
              <span><strong>No workflow activity yet.</strong> These workflows have no recorded runs or active tasks in your reporting scope.</span>
            </div>
          )}
          <DesktopRows rows={rows} maximum={maximum} />
          <MobileRows rows={rows} maximum={maximum} />
          <div className='border-t border-line bg-surface px-4 py-3 text-[11px] text-fg-muted'>
            Showing the highest-risk {rows.length.toLocaleString()} of {totalWorkflows.toLocaleString()} {plural(totalWorkflows, 'workflow')}
          </div>
        </>
      )}
    </Panel>
  )
}
