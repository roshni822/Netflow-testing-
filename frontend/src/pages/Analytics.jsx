// M3 - Phase 2 - Analytics.jsx - Live from /api/analytics/*

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  RefreshCw,
  TriangleAlert,
  Workflow,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { useUser } from '../utils/auth'
import { useDepartmentNames } from '../lib/departmentsStore'
import { Skeleton } from '../components/Skeleton'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// `days` drives the from/to window for the summary / approval / department
// endpoints; `months` and `weeks` set the granularity for the two time-series
// endpoints (which take their own params).
const RANGES = [
  { label: 'Last 7 days',  days: 7,   months: 1,  weeks: 1  },
  { label: 'Last 30 days', days: 30,  months: 1,  weeks: 4  },
  { label: 'Last 90 days', days: 90,  months: 3,  weeks: 13 },
  { label: 'This year',    days: 365, months: 12, weeks: 52 }
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const OUTCOME_COLOURS = {
  approved: 'var(--color-success-solid)',
  rejected: 'var(--color-danger-solid)',
  escalated: 'var(--color-warning-solid)',
  pending: 'var(--color-fg-subtle)',
  completed: 'var(--color-info-solid)'
}

const STATUS_ORDER = { approved: 0, completed: 1, pending: 2, escalated: 3, rejected: 4 }
const CHART_MARGIN = { top: 10, right: 12, bottom: 0, left: 0 }
const formatNumber = (value) => Number(value || 0).toLocaleString()
const formatPercent = (value, digits = 0) =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(digits)}%`

const EXPORT_BLUE = [36, 90, 154]
const EXPORT_GREEN = [35, 113, 78]
const EXPORT_RED = [190, 61, 53]
const EXPORT_INK = [24, 33, 47]
const EXPORT_MUTED = [99, 108, 122]
const EXPORT_LINE = [216, 224, 234]

const finiteOrNull = (value) => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const safeExportText = (value) => {
  const text = String(value ?? '')
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

const downloadTextFile = (text, filename, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const styleReportSheet = (sheet, title, columnWidths, dataRowCount) => {
  const lastColumn = Math.max(0, columnWidths.length - 1)
  sheet['!cols'] = columnWidths.map((width) => ({ wch: width }))
  sheet['!rows'] = [{ hpt: 28 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 }]
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } }]
  sheet['!freeze'] = { xSplit: 0, ySplit: 6, topLeftCell: 'A7', activePane: 'bottomLeft', state: 'frozen' }
  if (dataRowCount > 0) {
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: 5 + dataRowCount, c: lastColumn } }) }
  }

  const titleCell = sheet.A1
  if (titleCell) {
    titleCell.v = title
    titleCell.s = {
      font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '245A9A' } },
      alignment: { vertical: 'center' },
    }
  }

  for (let column = 0; column <= lastColumn; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 5, c: column })]
    if (!cell) continue
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '245A9A' } },
      alignment: { vertical: 'center', wrapText: true },
      border: { bottom: { style: 'thin', color: { rgb: 'D8E0EA' } } },
    }
  }
}

const createReportSheet = ({ title, meta, headers, rows, widths, percentColumns = [], cellFormats = [] }) => {
  const values = [
    [title],
    ['Scope', meta.scope],
    ['Date range', meta.range],
    ['Generated', meta.generatedLabel],
    [],
    headers,
    ...rows,
  ]
  const sheet = XLSX.utils.aoa_to_sheet(values)
  styleReportSheet(sheet, title, widths, rows.length)

  for (let index = 0; index < rows.length; index += 1) {
    for (const column of percentColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r: index + 6, c: column })]
      if (cell && typeof cell.v === 'number') cell.z = '0.0%'
    }
  }
  for (const { row, column, format } of cellFormats) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row + 6, c: column })]
    if (cell) cell.z = format
  }
  return sheet
}

function Panel({ title, subtitle, action, children, error, onRetry, className = '' }) {
  return (
    <section className={`nf-analytics-panel ${className}`}>
      <header className="nf-analytics-panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="nf-analytics-panel-action">{action}</div> : null}
      </header>
      <div className="nf-analytics-panel-body">
        {error ? <PanelError message={error} onRetry={onRetry} /> : children}
      </div>
    </section>
  )
}

function PanelError({ message, onRetry }) {
  return (
    <div className="nf-analytics-panel-state" role="alert">
      <span className="nf-analytics-state-icon is-danger"><TriangleAlert aria-hidden="true" /></span>
      <strong>Unable to load this report</strong>
      <p>{message}</p>
      <button type="button" className="nf-button" onClick={onRetry}>
        <RefreshCw aria-hidden="true" className="w-4 h-4" />
        Retry
      </button>
    </div>
  )
}

function KpiCard({ label, value, hint, icon: Icon, tone = 'blue', loading, error }) {
  return (
    <article className={`nf-analytics-kpi nf-analytics-kpi-${tone}`} aria-label={`${label}: ${error ? 'unavailable' : value}`}>
      <div className="nf-analytics-kpi-top">
        <span>{label}</span>
        <span className="nf-analytics-kpi-icon"><Icon aria-hidden="true" /></span>
      </div>
      {loading ? <Skeleton className="h-8 w-24 rounded-md" /> : <strong className="nf-analytics-kpi-value">{error ? '—' : value}</strong>}
      <p className={error ? 'is-error' : ''}>{error ? 'Data source unavailable' : hint}</p>
    </article>
  )
}

function ChartSkeleton({ bars = false }) {
  return (
    <div className={`nf-analytics-chart-skeleton ${bars ? 'is-bars' : ''}`} aria-hidden="true">
      {Array.from({ length: bars ? 8 : 5 }).map((_, index) => (
        <div key={index} className={bars ? 'nf-analytics-skeleton-bar' : ''} style={bars ? { height: `${28 + ((index * 19) % 62)}%` } : undefined}>
          <Skeleton className={bars ? 'w-full h-full rounded-t-md' : 'h-3 w-full rounded-full'} />
        </div>
      ))}
    </div>
  )
}

function EmptyChart({ title, message, positive = false }) {
  return (
    <div className="nf-analytics-panel-state">
      <span className={`nf-analytics-state-icon ${positive ? 'is-success' : ''}`}>
        {positive ? <CheckCircle2 aria-hidden="true" /> : <Activity aria-hidden="true" />}
      </span>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  )
}

function CompletionTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload || {}
  return (
    <div className="nf-analytics-tooltip">
      <strong>{label}</strong>
      <span><i className="is-blue" />Average completion <b>{Number(point.hours || 0).toFixed(1)}h</b></span>
      <small>{formatNumber(point.totalCompleted)} completed runs</small>
    </div>
  )
}

function CompletionTimeChart({ data, loading, error, onRetry }) {
  const latest = data.at(-1)
  const peak = data.length ? Math.max(...data.map((point) => point.hours)) : 0
  const accessibleSummary = data.length
    ? `Average completion time ranges from ${Math.min(...data.map((point) => point.hours)).toFixed(1)} to ${peak.toFixed(1)} hours. Latest value is ${latest.hours.toFixed(1)} hours for ${latest.month}.`
    : ''
  return (
    <Panel
      title="Completion time"
      subtitle="Average hours from workflow start to completion"
      action={latest ? <span className="nf-analytics-panel-stat">{latest.month}: {latest.hours.toFixed(1)}h</span> : null}
      error={error}
      onRetry={onRetry}
      className="nf-analytics-span-7"
    >
      {loading ? (
        <ChartSkeleton />
      ) : data.length === 0 ? (
        <EmptyChart title="No completed workflows" message="Completion trends appear after workflow runs finish." />
      ) : (
        <div className="nf-analytics-chart" role="img" tabIndex="0" aria-label={accessibleSummary}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={CHART_MARGIN}>
              <defs>
                <linearGradient id="nfAnalyticsCompletionFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-info-solid)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--color-info-solid)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 5" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 11 }} dy={8} />
              <YAxis axisLine={false} tickLine={false} width={48} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 11 }} tickFormatter={(value) => `${value}h`} />
              <Tooltip content={<CompletionTooltip />} cursor={{ stroke: 'var(--color-primary-line)', strokeWidth: 1 }} />
              <Area type="monotone" dataKey="hours" stroke="var(--color-info-solid)" strokeWidth={2.5} fill="url(#nfAnalyticsCompletionFill)" dot={{ r: 4, fill: 'var(--color-surface)', stroke: 'var(--color-info-solid)', strokeWidth: 2.5 }} activeDot={{ r: 5, fill: 'var(--color-info-solid)', stroke: 'var(--color-surface)', strokeWidth: 2 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
          <table className="sr-only">
            <caption>Average completion time data</caption>
            <thead><tr><th>Month</th><th>Hours</th><th>Completed runs</th></tr></thead>
            <tbody>{data.map((point) => <tr key={point.month}><td>{point.month}</td><td>{point.hours.toFixed(1)}</td><td>{point.totalCompleted}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function OutcomeTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0]?.payload || {}
  return (
    <div className="nf-analytics-tooltip">
      <strong>{item.label}</strong>
      <span><i style={{ background: item.color }} />Requests <b>{formatNumber(item.count)}</b></span>
      <small>{formatPercent(item.pct, 1)} of recorded outcomes</small>
    </div>
  )
}

function OutcomeBreakdown({ outcomes, loading, error, onRetry }) {
  const total = outcomes.reduce((sum, item) => sum + Number(item.count || 0), 0)
  const approved = outcomes.find((item) => item.key === 'approved')
  return (
    <Panel
      title="Approval outcomes"
      subtitle="Decision and task-status mix"
      action={approved ? <span className="nf-analytics-panel-stat is-success">{formatPercent(approved.pct)} approved</span> : null}
      error={error}
      onRetry={onRetry}
      className="nf-analytics-span-5"
    >
      {loading ? (
        <ChartSkeleton />
      ) : outcomes.length === 0 ? (
        <EmptyChart title="No outcomes yet" message="Outcome distribution appears after requests enter the workflow." />
      ) : (
        <div className="nf-analytics-outcomes">
          <div
            className="nf-analytics-donut"
            role="img"
            tabIndex="0"
            aria-label={`${formatNumber(total)} recorded requests. ${outcomes.map((item) => `${item.label} ${formatPercent(item.pct)}`).join(', ')}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomes} dataKey="chartValue" nameKey="label" innerRadius="67%" outerRadius="88%" paddingAngle={outcomes.length > 1 ? 2 : 0} stroke="var(--color-surface)" strokeWidth={2} isAnimationActive={false}>
                  {outcomes.map((item) => <Cell key={item.key} fill={item.color} />)}
                </Pie>
                <Tooltip content={<OutcomeTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="nf-analytics-donut-label" aria-hidden="true">
              <strong>{formatNumber(total)}</strong>
              <span>requests</span>
            </div>
          </div>
          <ul className="nf-analytics-outcome-list">
            {outcomes.map((item) => (
              <li key={item.key}>
                <i style={{ background: item.color }} aria-hidden="true" />
                <span>{item.label}</span>
                <b>{formatNumber(item.count)}</b>
                <strong>{formatPercent(item.pct)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

function SlaTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const item = payload[0]?.payload || {}
  return (
    <div className="nf-analytics-tooltip">
      <strong>{label}</strong>
      <span><i className="is-danger" />SLA breaches <b>{formatNumber(item.value)}</b></span>
      {item.target != null ? <small>Reference threshold: {item.target} per week</small> : null}
    </div>
  )
}

function SlaBreachTrend({ data, loading, error, onRetry }) {
  const total = data.reduce((sum, point) => sum + point.value, 0)
  const target = data.find((point) => point.target != null)?.target
  return (
    <Panel
      title="SLA breach trend"
      subtitle="Weekly deadline misses in the selected period"
      action={target != null ? <span className="nf-analytics-panel-stat">Reference: {target}/week</span> : null}
      error={error}
      onRetry={onRetry}
      className="nf-analytics-span-4"
    >
      {loading ? (
        <ChartSkeleton bars />
      ) : data.length === 0 ? (
        <EmptyChart positive title="No SLA breaches" message="No deadline misses were recorded in this period." />
      ) : (
        <div className="nf-analytics-chart nf-analytics-chart-compact" role="img" tabIndex="0" aria-label={`${formatNumber(total)} SLA breaches across ${data.length} reported weeks.`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 5" />
              <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 10 }} dy={8} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={34} tick={{ fill: 'var(--color-fg-subtle)', fontSize: 10 }} />
              <Tooltip content={<SlaTooltip />} cursor={{ fill: 'var(--color-danger-subtle)', opacity: 0.55 }} />
              {target != null ? <ReferenceLine y={target} stroke="var(--color-warning-solid)" strokeDasharray="5 5" /> : null}
              <Bar dataKey="value" fill="var(--color-danger-solid)" radius={[5, 5, 0, 0]} maxBarSize={34} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <table className="sr-only">
            <caption>SLA breach trend data</caption>
            <thead><tr><th>Week</th><th>Breaches</th><th>Reference</th></tr></thead>
            <tbody>{data.map((point) => <tr key={point.week}><td>{point.week}</td><td>{point.value}</td><td>{point.target ?? 'Not set'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function DepartmentTable({ data, loading, error, onRetry, filtered }) {
  const sorted = useMemo(
    () => [...data].sort((left, right) => right.totalTasks - left.totalTasks || left.name.localeCompare(right.name)),
    [data]
  )
  return (
    <Panel
      title="Department performance"
      subtitle={filtered ? `Performance for ${filtered}` : 'Volume, turnaround, and SLA health by department'}
      action={data.length ? <span className="nf-analytics-panel-stat">{data.length} {data.length === 1 ? 'department' : 'departments'}</span> : null}
      error={error}
      onRetry={onRetry}
      className="nf-analytics-span-8"
    >
      {loading ? (
        <div className="nf-analytics-table-skeleton" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-11 w-full rounded-lg" />)}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyChart title="No department activity" message="Department comparisons appear after people submit requests." />
      ) : (
        <div className="nf-analytics-table-wrap">
          <table className="nf-analytics-table">
            <thead><tr><th scope="col">Department</th><th scope="col">Volume</th><th scope="col">Approval</th><th scope="col">Avg completion</th><th scope="col">Breaches</th><th scope="col">Compliance</th></tr></thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.name}>
                  <td><strong>{item.name}</strong></td>
                  <td>{formatNumber(item.totalTasks)}</td>
                  <td>{formatPercent(item.pct)}</td>
                  <td>{item.avgCompletionDays > 0 ? `${item.avgCompletionDays.toFixed(1)}d` : '—'}</td>
                  <td><span className={`nf-analytics-breach-count ${item.slaBreaches > 0 ? 'has-breaches' : ''}`}>{formatNumber(item.slaBreaches)}</span></td>
                  <td>
                    <div className="nf-analytics-compliance" aria-label={`${item.name} compliance ${formatPercent(item.complianceRate)}`}>
                      <span><i style={{ width: `${Math.max(0, Math.min(100, item.complianceRate))}%` }} /></span>
                      <b>{formatPercent(item.complianceRate)}</b>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function ExportMenu({ onCsv, onXlsx, onPdf, disabled }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const firstItemRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.requestAnimationFrame(() => firstItemRef.current?.focus())
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const pick = (callback) => () => {
    callback()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="nf-analytics-export" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="nf-analytics-control nf-analytics-export-trigger"
      >
        <Download aria-hidden="true" />
        Export
        <ChevronDown aria-hidden="true" className={open ? 'is-open' : ''} />
      </button>
      {open ? (
        <div role="menu" aria-label="Export format" className="nf-analytics-export-menu">
          <button ref={firstItemRef} type="button" role="menuitem" onClick={pick(onCsv)}>CSV <span>.csv</span></button>
          <button type="button" role="menuitem" onClick={pick(onXlsx)}>Excel <span>.xlsx</span></button>
          <button type="button" role="menuitem" onClick={pick(onPdf)}>PDF <span>.pdf</span></button>
        </div>
      ) : null}
    </div>
  )
}

function messageForFailure(reason) {
  if (reason?.status === 403) return 'You do not have permission to view this analytics source.'
  return reason?.message || 'The analytics service did not respond.'
}

function Analytics() {
  const user = useUser()
  const [range, setRange] = useState(RANGES[1])
  const [department, setDepartment] = useState('')
  const orgDepartments = useDepartmentNames()
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState({})
  const [summary, setSummary] = useState(null)
  // What the API actually counted. A leader only ever sees their own people, so
  // saying "whole workspace" over their numbers would be a lie.
  const [scope, setScope] = useState(null)
  const [completion, setCompletion] = useState([])
  const [outcomes, setOutcomes] = useState([])
  const [departments, setDepartments] = useState([])
  const [slaTrend, setSlaTrend] = useState([])
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      setLoading(true)
      setErrors({})

    const iso = (d) => d.toISOString().slice(0, 10)
    const fromDate = new Date(Date.now() - Math.max(0, range.days - 1) * 86400000)
    const dept = department ? `&department=${encodeURIComponent(department)}` : ''
    const win = `from=${iso(fromDate)}&to=${iso(new Date())}${dept}`

    Promise.allSettled([
      api.get(`/api/analytics/summary?${win}`),
      api.get(`/api/analytics/completion-time?months=${range.months}${dept}`),
      api.get(`/api/analytics/approval-rate?${win}`),
      api.get(`/api/analytics/department-kpis?${win}`),
      api.get(`/api/analytics/sla-breaches?weeks=${range.weeks}${dept}`)
    ]).then((results) => {
      if (cancelled) return
      const [s, c, a, d, sla] = results
      const nextErrors = {}

      if (s.status === 'fulfilled') {
        setSummary(s.value.summary || s.value)
        setScope(s.value.scope || null)
      } else {
        setSummary(null)
        setScope(null)
        nextErrors.summary = messageForFailure(s.reason)
      }

      if (c.status === 'fulfilled') {
        const list = c.value.series || c.value.completionTime || c.value.data || []
        setCompletion(list.map((row) => ({
          month: (row.year && row.month) ? `${MONTHS[row.month - 1]} ${row.year}` : (row.label || row._id || 'Unavailable'),
          hours: Number(row.avgDays != null ? row.avgDays * 24 : (row.avgHours ?? row.hours ?? 0)),
          totalCompleted: Number(row.totalCompleted || 0)
        })))
      } else {
        setCompletion([])
        nextErrors.completion = messageForFailure(c.reason)
      }

      if (a.status === 'fulfilled') {
        const breakdown = a.value.distribution || a.value.approvalRate || a.value.breakdown || a.value.data || []
        const totalCount = breakdown.reduce((sum, row) => sum + Number(row.count ?? 0), 0)
        const mapped = breakdown.map((row) => {
          const key = String(row.status || row._id || 'unknown').toLowerCase()
          const count = Number(row.count ?? 0)
          const pct = Number(row.percentage ?? row.pct ?? (totalCount > 0 ? (count / totalCount) * 100 : 0))
          return {
            key,
            label: row.label || key.replace(/\b\w/g, (character) => character.toUpperCase()),
            count,
            pct,
            chartValue: count || pct,
            color: OUTCOME_COLOURS[key] || row.color || 'var(--color-fg-subtle)',
            order: STATUS_ORDER[key] ?? 99
          }
        })
        mapped.sort((left, right) => left.order - right.order)
        setOutcomes(mapped)
      } else {
        setOutcomes([])
        nextErrors.outcomes = messageForFailure(a.reason)
      }

      if (d.status === 'fulfilled') {
        const deptRows = d.value.kpis || d.value.departmentKpis || d.value.departments || d.value.data || []
        setDepartments(deptRows.map((row) => {
          const total = Number(row.totalRequests ?? row.totalTasks ?? row.total ?? 0)
          return {
            name: row.department || row._id || 'Unassigned',
            pct: Number(row.approvalRate ?? (total > 0 ? (Number(row.approved || 0) / total) * 100 : 0)),
            totalTasks: total,
            approved: Number(row.approved || 0),
            rejected: Number(row.rejected || 0),
            escalated: Number(row.escalated || 0),
            slaBreaches: Number(row.slaBreaches || 0),
            avgCompletionDays: Number(row.avgCompletionDays || 0),
            complianceRate: Number(row.complianceRate || 0)
          }
        }))
      } else {
        setDepartments([])
        nextErrors.departments = messageForFailure(d.reason)
      }

      if (sla.status === 'fulfilled') {
        const list = sla.value.series || sla.value.slaBreaches || sla.value.data || []
        setSlaTrend(list.map((row) => ({
          week: row.week != null ? `W${row.week}` : (row.label ? row.label.split('-').pop() : (row._id || 'Unavailable')),
          value: Number(row.breaches ?? row.count ?? row.value ?? 0),
          target: row.target == null ? null : Number(row.target)
        })))
      } else {
        setSlaTrend([])
        nextErrors.sla = messageForFailure(sla.reason)
      }

      setErrors(nextErrors)
      setLoading(false)
    })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [range, department, reloadKey])

  const retry = () => setReloadKey((current) => current + 1)

  const kpis = useMemo(() => {
    const measuredRuns = completion.reduce((sum, point) => sum + point.totalCompleted, 0)
    const totalHours = completion.reduce((sum, point) => sum + (point.hours * (point.totalCompleted || 1)), 0)
    const divisor = measuredRuns || completion.length
    const averageHours = divisor ? totalHours / divisor : null
    const approvalRate = summary?.approvalRate ?? outcomes.find((item) => item.key === 'approved')?.pct
    const slaTotal = slaTrend.reduce((sum, point) => sum + point.value, 0)
    const decisions = Number(summary?.approvedTasks || 0) + Number(summary?.rejectedTasks || 0)
    return [
      {
        label: 'Workflow runs',
        value: formatNumber(summary?.totalExecutions),
        hint: `${formatNumber(summary?.runningExecutions)} active · ${formatNumber(summary?.completedExecutions)} completed`,
        icon: Workflow,
        tone: 'blue',
        error: errors.summary
      },
      {
        label: 'Avg completion',
        value: averageHours == null ? '—' : `${averageHours.toFixed(1)}h`,
        hint: measuredRuns ? `${formatNumber(measuredRuns)} completed runs measured` : 'No completed runs in this period',
        icon: Clock3,
        tone: 'primary',
        error: errors.completion
      },
      {
        label: 'Approval rate',
        value: formatPercent(approvalRate),
        hint: decisions ? `${formatNumber(summary?.approvedTasks)} approved of ${formatNumber(decisions)} decisions` : 'No completed decisions in this period',
        icon: CheckCircle2,
        tone: 'success',
        error: errors.summary || errors.outcomes
      },
      {
        label: 'SLA breaches',
        value: formatNumber(slaTotal),
        hint: summary?.slaCompliance == null ? 'Task deadline misses' : `${formatPercent(summary.slaCompliance)} execution compliance`,
        icon: TriangleAlert,
        tone: slaTotal > 0 ? 'danger' : 'success',
        error: errors.sla
      }
    ]
  }, [completion, errors, outcomes, slaTrend, summary])

  const reportScope = department
    || (scope?.reach === 'team' ? 'Your team' : 'Whole workspace')
  const scopeNote = `${reportScope} · ${range.label}`
  const fileBase = `analytics-${range.label.toLowerCase().replaceAll(' ', '-')}`

  const createExportSnapshot = () => {
    const generatedAt = new Date()
    const measuredRuns = completion.reduce((sum, point) => sum + point.totalCompleted, 0)
    const weightedHours = completion.reduce((sum, point) => sum + (point.hours * (point.totalCompleted || 1)), 0)
    const divisor = measuredRuns || completion.length
    const averageHours = divisor ? weightedHours / divisor : null
    const approvalRate = finiteOrNull(summary?.approvalRate ?? outcomes.find((item) => item.key === 'approved')?.pct)
    const slaTotal = slaTrend.reduce((sum, point) => sum + point.value, 0)

    const metric = (label, value, unit, error, note) => ({
      label,
      value: error ? null : finiteOrNull(value),
      unit,
      status: error ? 'Unavailable' : finiteOrNull(value) == null ? 'No data' : 'Available',
      note: error || note || '',
    })

    return {
      meta: {
        scope: reportScope,
        range: range.label,
        generatedIso: generatedAt.toISOString(),
        generatedLabel: generatedAt.toLocaleString(),
      },
      overview: [
        metric('Workflow runs', summary?.totalExecutions, 'count', errors.summary, kpis[0]?.hint),
        metric('Average completion', averageHours, 'hours', errors.completion, kpis[1]?.hint),
        metric('Approval rate', approvalRate, '%', errors.summary || errors.outcomes, kpis[2]?.hint),
        metric('SLA breaches', slaTotal, 'count', errors.sla, kpis[3]?.hint),
      ],
      completion,
      outcomes,
      departments,
      slaTrend,
      errors: { ...errors },
    }
  }

  const exportCsv = () => {
    const report = createExportSnapshot()
    const rows = []
    const add = (section, dimension, metricName, value, unit, status = 'Available', note = '') => {
      rows.push([
        safeExportText(section),
        safeExportText(dimension),
        safeExportText(metricName),
        value ?? '',
        safeExportText(unit),
        status,
        safeExportText(report.meta.scope),
        safeExportText(report.meta.range),
        report.meta.generatedIso,
        safeExportText(note),
      ])
    }
    const addSectionState = (section, error, hasData) => {
      if (error) add(section, 'All', 'Data status', '', '', 'Unavailable', error)
      else if (!hasData) add(section, 'All', 'Data status', '', '', 'No data', 'No data in selected range')
    }

    report.overview.forEach((item) => add('Overview', 'All', item.label, item.value, item.unit, item.status, item.note))

    if (report.errors.completion || !report.completion.length) addSectionState('Completion', report.errors.completion, report.completion.length > 0)
    else report.completion.forEach((item) => {
      add('Completion', item.month, 'Average completion', Number(item.hours.toFixed(1)), 'hours')
      add('Completion', item.month, 'Completed runs', item.totalCompleted, 'count')
    })

    if (report.errors.outcomes || !report.outcomes.length) addSectionState('Outcomes', report.errors.outcomes, report.outcomes.length > 0)
    else report.outcomes.forEach((item) => {
      add('Outcomes', item.label, 'Requests', item.count, 'count')
      add('Outcomes', item.label, 'Share of outcomes', Number(item.pct.toFixed(1)), '%')
    })

    if (report.errors.departments || !report.departments.length) addSectionState('Departments', report.errors.departments, report.departments.length > 0)
    else report.departments.forEach((item) => {
      add('Departments', item.name, 'Request volume', item.totalTasks, 'count')
      add('Departments', item.name, 'Approved', item.approved, 'count')
      add('Departments', item.name, 'Rejected', item.rejected, 'count')
      add('Departments', item.name, 'Escalated', item.escalated, 'count')
      add('Departments', item.name, 'Approval rate', Number(item.pct.toFixed(1)), '%')
      add('Departments', item.name, 'Average completion', Number(item.avgCompletionDays.toFixed(1)), 'days')
      add('Departments', item.name, 'SLA breaches', item.slaBreaches, 'count')
      add('Departments', item.name, 'SLA compliance', Number(item.complianceRate.toFixed(1)), '%')
    })

    if (report.errors.sla || !report.slaTrend.length) addSectionState('SLA trend', report.errors.sla, report.slaTrend.length > 0)
    else report.slaTrend.forEach((item) => {
      add('SLA trend', item.week, 'SLA breaches', item.value, 'count')
      if (item.target != null) add('SLA trend', item.week, 'Reference', item.target, 'count')
    })

    const headers = ['Section', 'Dimension', 'Metric', 'Value', 'Unit', 'Status', 'Scope', 'Date range', 'Generated at', 'Note']
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    downloadTextFile(`\ufeff${csv}`, `${fileBase}.csv`, 'text/csv;charset=utf-8')
  }

  const exportXlsx = () => {
    const report = createExportSnapshot()
    const workbook = XLSX.utils.book_new()
    workbook.Props = {
      Title: 'NetFlow Analytics Report',
      Subject: `${report.meta.scope} - ${report.meta.range}`,
      Author: 'NetFlow',
      CreatedDate: new Date(report.meta.generatedIso),
    }
    const sectionState = (error, width) => [
      Array.from({ length: width }, (_, index) => index === width - 2
        ? (error ? 'Unavailable' : 'No data')
        : index === width - 1
          ? (error || 'No data in selected range')
          : ''),
    ]

    const overviewRows = report.overview.map((item) => [
      item.label,
      item.unit === '%' && item.value != null ? item.value / 100 : item.value ?? '',
      item.unit,
      item.status,
      item.note,
    ])
    const overviewFormats = report.overview
      .map((item, row) => item.unit === '%' ? { row, column: 1, format: '0.0%' } : null)
      .filter(Boolean)
    XLSX.utils.book_append_sheet(workbook, createReportSheet({
      title: 'Analytics overview',
      meta: report.meta,
      headers: ['Metric', 'Value', 'Unit', 'Status', 'Details'],
      rows: overviewRows,
      widths: [28, 16, 12, 15, 44],
      cellFormats: overviewFormats,
    }), 'Overview')

    const completionRows = report.errors.completion || !report.completion.length
      ? sectionState(report.errors.completion, 5)
      : report.completion.map((item) => [item.month, Number(item.hours.toFixed(1)), item.totalCompleted, 'Available', ''])
    XLSX.utils.book_append_sheet(workbook, createReportSheet({
      title: 'Completion time', meta: report.meta,
      headers: ['Month', 'Average completion (hours)', 'Completed runs', 'Status', 'Note'],
      rows: completionRows, widths: [18, 28, 18, 15, 42],
    }), 'Completion')

    const outcomeRows = report.errors.outcomes || !report.outcomes.length
      ? sectionState(report.errors.outcomes, 5)
      : report.outcomes.map((item) => [item.label, item.count, item.pct / 100, 'Available', ''])
    XLSX.utils.book_append_sheet(workbook, createReportSheet({
      title: 'Approval outcomes', meta: report.meta,
      headers: ['Outcome', 'Count', 'Percentage', 'Status', 'Note'],
      rows: outcomeRows, widths: [22, 14, 16, 15, 42], percentColumns: [2],
    }), 'Outcomes')

    const departmentRows = report.errors.departments || !report.departments.length
      ? sectionState(report.errors.departments, 11)
      : report.departments.map((item) => [
          item.name, item.totalTasks, item.approved, item.rejected, item.escalated,
          item.pct / 100, Number(item.avgCompletionDays.toFixed(1)), item.slaBreaches,
          item.complianceRate / 100, 'Available', '',
        ])
    XLSX.utils.book_append_sheet(workbook, createReportSheet({
      title: 'Department performance', meta: report.meta,
      headers: ['Department', 'Volume', 'Approved', 'Rejected', 'Escalated', 'Approval rate', 'Avg completion (days)', 'SLA breaches', 'Compliance', 'Status', 'Note'],
      rows: departmentRows, widths: [24, 12, 12, 12, 12, 16, 24, 16, 16, 15, 36], percentColumns: [5, 8],
    }), 'Departments')

    const slaRows = report.errors.sla || !report.slaTrend.length
      ? sectionState(report.errors.sla, 5)
      : report.slaTrend.map((item) => [item.week, item.value, item.target ?? '', 'Available', ''])
    XLSX.utils.book_append_sheet(workbook, createReportSheet({
      title: 'SLA breach trend', meta: report.meta,
      headers: ['Week', 'SLA breaches', 'Reference', 'Status', 'Note'],
      rows: slaRows, widths: [18, 18, 18, 15, 42],
    }), 'SLA Breaches')

    XLSX.writeFile(workbook, `${fileBase}.xlsx`, { compression: true, cellStyles: true })
  }

  const exportPdf = () => {
    const report = createExportSnapshot()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 14
    const contentWidth = pageWidth - (margin * 2)
    const formatMetric = (item) => {
      if (item.status !== 'Available') return item.status
      if (item.unit === '%') return `${item.value.toFixed(1)}%`
      if (item.unit === 'hours') return `${item.value.toFixed(1)}h`
      return formatNumber(item.value)
    }

    doc.setProperties({
      title: 'NetFlow Analytics Report',
      subject: `${report.meta.scope} - ${report.meta.range}`,
      author: 'NetFlow',
    })
    const drawDocumentHeader = () => {
      doc.setFillColor(...EXPORT_BLUE)
      doc.rect(0, 0, pageWidth, 24, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(17)
      doc.text('NetFlow', margin, 10)
      doc.setFontSize(12)
      doc.text('Analytics report', margin, 18)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.text(`${report.meta.scope}  |  ${report.meta.range}  |  Generated ${report.meta.generatedLabel}`, pageWidth - margin, 17, { align: 'right' })
    }
    drawDocumentHeader()

    const gap = 4
    const cardWidth = (contentWidth - (gap * 3)) / 4
    const cardY = 31
    report.overview.forEach((item, index) => {
      const x = margin + (index * (cardWidth + gap))
      const alert = item.label === 'SLA breaches' && Number(item.value) > 0
      doc.setFillColor(248, 250, 252)
      doc.setDrawColor(...EXPORT_LINE)
      doc.roundedRect(x, cardY, cardWidth, 27, 2, 2, 'FD')
      doc.setFillColor(...(alert ? EXPORT_RED : index === 2 ? EXPORT_GREEN : EXPORT_BLUE))
      doc.rect(x, cardY, 2, 27, 'F')
      doc.setTextColor(...EXPORT_MUTED)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(item.label.toUpperCase(), x + 5, cardY + 7)
      doc.setTextColor(...EXPORT_INK)
      doc.setFontSize(15)
      doc.text(formatMetric(item), x + 5, cardY + 17)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...EXPORT_MUTED)
      doc.setFontSize(7)
      doc.text(doc.splitTextToSize(item.note || item.status, cardWidth - 9).slice(0, 1), x + 5, cardY + 23)
    })

    const stateRows = (error, columnCount) => [
      Array.from({ length: columnCount }, (_, index) => index === 0
        ? (error ? 'Unavailable' : 'No data in selected range')
        : index === columnCount - 1
          ? (error || '')
          : ''),
    ]
    const addSection = (title, subtitle, head, body, columnStyles = {}) => {
      let startY = (doc.lastAutoTable?.finalY ?? 64) + 10
      if (startY > pageHeight - 34) {
        doc.addPage()
        startY = 34
      }
      doc.setTextColor(...EXPORT_INK)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(title, margin, startY)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...EXPORT_MUTED)
      doc.setFontSize(7.5)
      doc.text(subtitle, margin, startY + 4.5)
      autoTable(doc, {
        startY: startY + 7,
        margin: { left: margin, right: margin, top: 31, bottom: 15 },
        head: [head],
        body,
        theme: 'grid',
        showHead: 'everyPage',
        styles: { font: 'helvetica', fontSize: 7.5, textColor: EXPORT_INK, cellPadding: 2.3, lineColor: EXPORT_LINE, lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: EXPORT_BLUE, textColor: [255, 255, 255], fontStyle: 'bold', lineColor: EXPORT_BLUE },
        alternateRowStyles: { fillColor: [247, 249, 252] },
        columnStyles,
      })
    }

    const completionRows = report.errors.completion || !report.completion.length
      ? stateRows(report.errors.completion, 4)
      : report.completion.map((item) => [item.month, item.hours.toFixed(1), String(item.totalCompleted), 'Available'])
    addSection('Completion time', 'Average workflow duration by month', ['Month', 'Average hours', 'Completed runs', 'Status'], completionRows)

    const outcomeRows = report.errors.outcomes || !report.outcomes.length
      ? stateRows(report.errors.outcomes, 4)
      : report.outcomes.map((item) => [item.label, String(item.count), `${item.pct.toFixed(1)}%`, 'Available'])
    addSection('Approval outcomes', 'Decision and task status mix', ['Outcome', 'Count', 'Percentage', 'Status'], outcomeRows)

    const departmentRows = report.errors.departments || !report.departments.length
      ? stateRows(report.errors.departments, 9)
      : report.departments.map((item) => [
          item.name, String(item.totalTasks), String(item.approved), String(item.rejected), String(item.escalated),
          `${item.pct.toFixed(1)}%`, item.avgCompletionDays.toFixed(1), String(item.slaBreaches), `${item.complianceRate.toFixed(1)}%`,
        ])
    addSection(
      'Department performance',
      'Volume, decision outcomes, turnaround, and SLA compliance',
      ['Department', 'Volume', 'Approved', 'Rejected', 'Escalated', 'Approval rate', 'Avg days', 'Breaches', 'Compliance'],
      departmentRows,
      { 0: { cellWidth: 40 } }
    )

    const slaRows = report.errors.sla || !report.slaTrend.length
      ? stateRows(report.errors.sla, 4)
      : report.slaTrend.map((item) => [item.week, String(item.value), item.target == null ? 'Not set' : String(item.target), 'Available'])
    addSection('SLA breach trend', 'Weekly deadline misses in the selected range', ['Week', 'Breaches', 'Reference', 'Status'], slaRows)

    const pages = doc.getNumberOfPages()
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page)
      if (page > 1) drawDocumentHeader()
      doc.setDrawColor(...EXPORT_LINE)
      doc.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...EXPORT_MUTED)
      doc.text(`${report.meta.scope} | ${report.meta.range}`, margin, pageHeight - 6)
      doc.text(`Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 6, { align: 'right' })
    }
    doc.save(`${fileBase}.pdf`)
  }

  const actions = (
    <>
      {scope?.reach === 'team' ? (
        <div className="nf-analytics-scope" title="Analytics are limited to your reporting line">
          <Activity aria-hidden="true" />
          {user?.department || 'My team'}
        </div>
      ) : (
        <select className="nf-analytics-control nf-analytics-select" value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {orgDepartments.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      )}
      <select
        value={range.label}
        onChange={(event) => setRange(RANGES.find((item) => item.label === event.target.value) || RANGES[1])}
        aria-label="Date range"
        className="nf-analytics-control nf-analytics-select"
      >
        {RANGES.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
      </select>
      <ExportMenu onCsv={exportCsv} onXlsx={exportXlsx} onPdf={exportPdf} disabled={loading} />
    </>
  )

  const errorCount = Object.keys(errors).length

  return (
    <AppShell
      title="Analytics & reports"
      subtitle={scopeNote}
      actions={actions}
      mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto"
    >
      <div className="nf-analytics-page">
        {errorCount > 0 ? (
          <div className="nf-analytics-error-summary" role="alert">
            <TriangleAlert aria-hidden="true" />
            <div>
              <strong>{errorCount === 1 ? 'One report is unavailable' : `${errorCount} reports are unavailable`}</strong>
              <p>Available results are still shown below. Retry to refresh every data source.</p>
            </div>
            <button type="button" className="nf-button" onClick={retry}><RefreshCw aria-hidden="true" className="w-4 h-4" />Retry all</button>
          </div>
        ) : null}

        <section className="nf-analytics-kpis" aria-label="Analytics overview">
          {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} loading={loading} />)}
        </section>

        <div className="nf-analytics-dashboard">
          <CompletionTimeChart data={completion} loading={loading} error={errors.completion} onRetry={retry} />
          <OutcomeBreakdown outcomes={outcomes} loading={loading} error={errors.outcomes} onRetry={retry} />
          <SlaBreachTrend data={slaTrend} loading={loading} error={errors.sla} onRetry={retry} />
          <DepartmentTable data={departments} loading={loading} error={errors.departments} onRetry={retry} filtered={department} />
        </div>
      </div>
    </AppShell>
  )
}

export default Analytics
