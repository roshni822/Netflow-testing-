import { PLAN_LABELS } from './licensing'

export const HISTORY_OPTIONS = [
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '12M', label: '12M' },
  { value: 'ALL', label: 'All' }
]

export const RESOURCE_OPTIONS = [
  { key: 'users', label: 'Users' },
  { key: 'builders', label: 'Builders' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'storage', label: 'Storage' }
]

const RESOURCE_LABELS = {
  users: 'Users',
  builders: 'Builders',
  forms: 'Forms',
  workflows: 'Workflows',
  submissions: 'Submissions',
  storage: 'Storage',
  files: 'Files'
}

export const titleCase = (value) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

export const resourceLabel = (key) => RESOURCE_LABELS[key] || titleCase(key)
export const organizationName = (org) => org?.name || org?.subdomain || 'Unnamed organization'
export const planLabel = (org) => org?.licensing?.planLabel || PLAN_LABELS[org?.plan] || titleCase(org?.plan || 'Custom')

const organizationId = (org, index) => String(org?._id || org?.subdomain || org?.name || `organization-${index}`)
const percentOf = (meter) => Math.max(0, Number(meter?.percent || 0))

const strongestMeter = (org, states) => Object.entries(org?.licensing?.resources || {})
  .filter(([, meter]) => meter && !meter.unlimited && states.includes(meter.state))
  .sort((a, b) => percentOf(b[1]) - percentOf(a[1]))[0] || null

export function classifyOrganization(org) {
  if ((org?.status || 'active') === 'suspended') {
    return {
      severity: 'critical',
      severityLabel: 'Critical',
      rank: 60,
      type: 'access',
      issue: 'Workspace access is suspended',
      currentLimit: 'Access blocked',
      impact: 'Workspace unavailable',
      utilization: 100
    }
  }

  const licence = org?.licensing?.licence
  const expired = licence?.status === 'expired' || (licence?.daysLeft != null && licence.daysLeft < 0)
  if (licence?.readOnly || expired) {
    return {
      severity: 'critical',
      severityLabel: 'Critical',
      rank: 50,
      type: 'licence',
      issue: licence?.isTrial ? 'Trial period has ended' : 'Licence has expired',
      currentLimit: 'Read-only',
      impact: 'New work blocked',
      utilization: 100
    }
  }

  const exceeded = strongestMeter(org, ['exceeded'])
  if (exceeded) {
    return {
      severity: 'critical',
      severityLabel: 'Critical',
      rank: 40,
      type: 'limit',
      resource: exceeded[0],
      meter: exceeded[1],
      issue: `${resourceLabel(exceeded[0])} allowance exceeded`,
      impact: 'New usage blocked',
      utilization: percentOf(exceeded[1])
    }
  }

  const critical = strongestMeter(org, ['critical'])
  if (critical) {
    return {
      severity: 'warning',
      severityLabel: 'Warning',
      rank: 30,
      type: 'limit',
      resource: critical[0],
      meter: critical[1],
      issue: `${resourceLabel(critical[0])} nearing allowance`,
      impact: 'Capacity at risk',
      utilization: percentOf(critical[1])
    }
  }

  const warning = strongestMeter(org, ['warning'])
  if (warning) {
    return {
      severity: 'warning',
      severityLabel: 'Warning',
      rank: 20,
      type: 'limit',
      resource: warning[0],
      meter: warning[1],
      issue: `${resourceLabel(warning[0])} usage is increasing`,
      impact: 'Review capacity',
      utilization: percentOf(warning[1])
    }
  }

  if (licence?.daysLeft != null && licence.daysLeft <= 30) {
    return {
      severity: 'warning',
      severityLabel: 'Warning',
      rank: 10,
      type: 'licence',
      issue: licence.isTrial ? 'Trial period ending soon' : 'Licence renewal approaching',
      currentLimit: `${Math.max(0, licence.daysLeft)} days left`,
      impact: 'Renewal required',
      utilization: 0
    }
  }

  return null
}

const uniqueFleet = (orgs) => {
  const seen = new Set()
  return (orgs || []).filter((org, index) => {
    const id = organizationId(org, index)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const resourceSummary = (fleet, resource) => {
  const entries = fleet
    .map((org) => ({ org, meter: org?.licensing?.resources?.[resource] }))
    .filter((entry) => entry.meter)

  const metered = entries.filter((entry) => !entry.meter.unlimited)
  const unlimited = entries.filter((entry) => entry.meter.unlimited)
  const used = metered.reduce((sum, entry) => sum + Number(entry.meter.used || 0), 0)
  const limit = metered.reduce((sum, entry) => sum + Number(entry.meter.limit || 0), 0)
  const totalUsed = entries.reduce((sum, entry) => sum + Number(entry.meter.used || 0), 0)
  const percent = limit > 0 ? Math.round((used / limit) * 100) : null
  const highest = metered
    .slice()
    .sort((a, b) => percentOf(b.meter) - percentOf(a.meter))[0] || null

  return {
    resource,
    label: resourceLabel(resource),
    used,
    limit,
    totalUsed,
    percent,
    meteredOrganizations: metered.length,
    unlimitedOrganizations: unlimited.length,
    highestOrganization: highest?.org || null,
    highestMeter: highest?.meter || null,
    hasData: entries.length > 0
  }
}

export function buildDashboardAnalytics(orgs) {
  const fleet = uniqueFleet(orgs)
  const issues = fleet
    .map((org) => {
      const issue = classifyOrganization(org)
      return issue ? { org, ...issue } : null
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.rank - a.rank ||
      b.utilization - a.utilization ||
      organizationName(a.org).localeCompare(organizationName(b.org))
    )

  const active = fleet.filter((org) =>
    (org.status || 'active') !== 'suspended' &&
    org.licensing?.licence?.readOnly !== true
  ).length
  const trial = fleet.filter((org) => org.plan === 'trial' || org.licensing?.licence?.isTrial).length
  const resources = RESOURCE_OPTIONS.map(({ key }) => resourceSummary(fleet, key))
  const highestPressure = resources
    .filter((row) => row.highestMeter)
    .sort((a, b) => percentOf(b.highestMeter) - percentOf(a.highestMeter))[0] || null

  return {
    fleet,
    total: fleet.length,
    active,
    trial,
    suspended: fleet.filter((org) => (org.status || 'active') === 'suspended').length,
    attentionCount: issues.length,
    criticalCount: issues.filter((issue) => issue.severity === 'critical').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    clearCount: Math.max(0, fleet.length - issues.length),
    issues,
    attention: issues.slice(0, 5),
    resources,
    highestPressure
  }
}

export function rankOrganizations(fleet, resource) {
  return (fleet || [])
    .map((org) => ({
      org,
      resource,
      meter: org?.licensing?.resources?.[resource] || null
    }))
    .filter((row) => row.meter)
    .sort((a, b) =>
      Number(b.meter.used || 0) - Number(a.meter.used || 0) ||
      percentOf(b.meter) - percentOf(a.meter) ||
      organizationName(a.org).localeCompare(organizationName(b.org))
    )
    .slice(0, 5)
}

export function normalizeHistory(snapshots) {
  return (snapshots || [])
    .map((snapshot) => ({
      timestamp: snapshot.timestamp,
      totalOrganizations: Number(snapshot.metrics?.totalOrganizations || 0),
      newOrganizations: Number(snapshot.metrics?.newOrgs || 0),
      deletedOrganizations: Number(snapshot.metrics?.deletedOrgs || 0),
      suspendedOrganizations: Number(snapshot.metrics?.suspendedOrgs || 0),
      activatedOrganizations: Number(snapshot.metrics?.activatedOrgs || 0)
    }))
    .filter((snapshot) => snapshot.timestamp && !Number.isNaN(new Date(snapshot.timestamp).getTime()))
}

