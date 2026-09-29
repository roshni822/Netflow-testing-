// Persisted workspace capabilities. Builder access is intentionally absent:
// Forms and Workflows management is a licensed, per-user entitlement stored on
// User.canBuild rather than a role permission. Baseline employee permissions
// remain internal so a role can still submit forms and act on assigned work.

const CAPABILITIES = [
  { key: 'manage_documents', permission: 'documents:manage', label: 'Manage documents', description: 'Manage workspace document storage and sharing.' },
  {
    key: 'decide_tasks',
    permission: 'tasks:decide',
    label: 'Decide tasks',
    description: 'Approve, reject, review, and request changes on assigned work.'
  },
  {
    key: 'manage_users',
    permission: 'users:manage',
    label: 'Manage users',
    description: 'Create and manage people, departments, roles, and access.'
  },
  {
    key: 'view_audit',
    permission: 'audit:read',
    label: 'View audit',
    description: 'Read the workspace audit trail.'
  },
  {
    key: 'view_analytics',
    permission: 'analytics:read',
    label: 'View analytics',
    description: 'View operational reports, KPIs, and SLA analytics.'
  }
]

const CAPABILITY_BY_KEY = new Map(CAPABILITIES.map((item) => [item.key, item]))
const CAPABILITY_BY_PERMISSION = new Map(CAPABILITIES.map((item) => [item.permission, item.key]))
const PROTECTED_ROLE_NAMES = new Set(['admin', 'ceo'])
const BASELINE_PERMISSIONS = ['forms:read', 'forms:submit', 'tasks:read', 'tasks:act']
const DEPRECATED_BUILDER_CAPABILITIES = new Set([
  'manage_forms',
  'build_flows',
  'forms:manage',
  'workflows:manage',
  'design'
])

const LEGACY_CAPABILITIES = {
  approve: ['decide_tasks'],
  reports: ['view_audit', 'view_analytics'],
  users: ['manage_users'],
  organization: ['manage_users'],
  'tasks:approve': ['decide_tasks']
}

const DEFAULT_ROLES = [
  {
    name: 'Admin',
    description: 'Full workspace administration.',
    permissions: ['*']
  },
  {
    name: 'CEO',
    description: 'Executive decisions, organization-wide reporting, and audit oversight.',
    permissions: [...BASELINE_PERMISSIONS, 'tasks:decide', 'audit:read', 'analytics:read']
  },
  {
    name: 'VP',
    description: 'Senior approvals and organization-wide analytics.',
    permissions: [...BASELINE_PERMISSIONS, 'tasks:decide', 'analytics:read']
  },
  {
    name: 'Manager',
    description: 'Team decisions and operational reporting.',
    permissions: [...BASELINE_PERMISSIONS, 'tasks:decide', 'analytics:read']
  },
  {
    name: 'HR',
    description: 'People-process decisions and operational reporting.',
    permissions: [...BASELINE_PERMISSIONS, 'tasks:decide', 'users:read', 'analytics:read']
  },
  {
    name: 'Employee',
    description: 'Request submission and personal task tracking.',
    permissions: [...BASELINE_PERMISSIONS]
  }
]

const roleNameKey = (value) => String(value || '').trim().toLowerCase()
const isProtectedRoleName = (value) => PROTECTED_ROLE_NAMES.has(roleNameKey(value))

const capabilitiesFromPermissions = (permissions = []) => {
  const values = Array.isArray(permissions) ? permissions.map(String) : []
  if (values.includes('*')) return CAPABILITIES.map((item) => item.key)

  const found = new Set()
  for (const value of values) {
    if (CAPABILITY_BY_KEY.has(value)) found.add(value)
    const direct = CAPABILITY_BY_PERMISSION.get(value)
    if (direct) found.add(direct)
    for (const legacy of LEGACY_CAPABILITIES[value] || []) found.add(legacy)
  }
  return CAPABILITIES.map((item) => item.key).filter((key) => found.has(key))
}

const normaliseCapabilityKeys = (values = []) => {
  const found = new Set()
  for (const value of Array.isArray(values) ? values.map(String) : []) {
    if (CAPABILITY_BY_KEY.has(value)) found.add(value)
    const direct = CAPABILITY_BY_PERMISSION.get(value)
    if (direct) found.add(direct)
    for (const legacy of LEGACY_CAPABILITIES[value] || []) found.add(legacy)
  }
  return CAPABILITIES.map((item) => item.key).filter((key) => found.has(key))
}

const CONTROLLED_VALUES = new Set([
  ...CAPABILITIES.map((item) => item.key),
  ...CAPABILITIES.map((item) => item.permission),
  ...Object.keys(LEGACY_CAPABILITIES),
  ...DEPRECATED_BUILDER_CAPABILITIES
])

const permissionsForCapabilities = (capabilities = [], existingPermissions = []) => {
  const keys = normaliseCapabilityKeys(capabilities)
  const preserved = (Array.isArray(existingPermissions) ? existingPermissions : [])
    .map(String)
    .filter((value) => value !== '*' && !CONTROLLED_VALUES.has(value))
  return [...new Set([
    ...BASELINE_PERMISSIONS,
    ...preserved,
    ...keys.map((key) => CAPABILITY_BY_KEY.get(key).permission)
  ])]
}

const hasCapability = (user, capability) => {
  if (!CAPABILITY_BY_KEY.has(capability)) return false
  const permissions = user?.role?.permissions || []
  if (permissions.includes('*')) return true
  return capabilitiesFromPermissions(permissions).includes(capability)
}

const hasPermission = (user, permission) => {
  const permissions = user?.role?.permissions || []
  return permissions.includes('*') || permissions.includes(permission)
}

const shellForRole = (role) => {
  if (role?.name === 'SuperAdmin') return 'platform'
  if (hasCapability({ role }, 'manage_users')) return 'orgAdmin'
  if (capabilitiesFromPermissions(role?.permissions).length) return 'ops'
  return 'workspace'
}

module.exports = {
  CAPABILITIES,
  DEFAULT_ROLES,
  BASELINE_PERMISSIONS,
  DEPRECATED_BUILDER_CAPABILITIES,
  PROTECTED_ROLE_NAMES,
  roleNameKey,
  isProtectedRoleName,
  capabilitiesFromPermissions,
  normaliseCapabilityKeys,
  permissionsForCapabilities,
  hasCapability,
  hasPermission,
  shellForRole
}
