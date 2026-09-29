// UI capability helpers. The backend remains authoritative; these functions
// keep routes, navigation, and controls aligned with role.permissions returned
// by the authenticated API.

const roleName = (user) => user?.role?.name || null
const rolePermissions = (user) => Array.isArray(user?.role?.permissions)
  ? user.role.permissions.map(String)
  : []

export const SHELL = {
  PLATFORM: 'platform',
  ORG_ADMIN: 'orgAdmin',
  OPS: 'ops',
  WORKSPACE: 'workspace'
}

const CAPABILITY_PERMISSION = {
  manage_documents: 'documents:manage',
  decide_tasks: 'tasks:decide',
  manage_users: 'users:manage',
  view_audit: 'audit:read',
  view_analytics: 'analytics:read'
}

const LEGACY = {
  decide_tasks: ['approve', 'tasks:approve'],
  manage_users: ['users', 'organization'],
  view_audit: ['reports'],
  view_analytics: ['reports']
}

export const hasCapability = (user, capability) => {
  const permissions = rolePermissions(user)
  if (permissions.includes('*')) return true
  const permission = CAPABILITY_PERMISSION[capability]
  return permissions.includes(capability)
    || (permission && permissions.includes(permission))
    || (LEGACY[capability] || []).some((legacy) => permissions.includes(legacy))
}

export const hasPermission = (user, permission) => {
  const permissions = rolePermissions(user)
  return permissions.includes('*') || permissions.includes(permission)
}

export const hasBuilderAccess = (user) =>
  roleName(user) === 'SuperAdmin' || user?.canBuild === true

export const getShell = (user) => {
  if (roleName(user) === 'SuperAdmin') return SHELL.PLATFORM
  if (hasCapability(user, 'manage_users')) return SHELL.ORG_ADMIN
  if ([
    'decide_tasks',
    'view_audit',
    'view_analytics'
  ].some((capability) => hasCapability(user, capability))) return SHELL.OPS
  return SHELL.WORKSPACE
}

export const canCreateForm = hasBuilderAccess
export const canCreateWorkflow = hasBuilderAccess
export const canEditWorkflow = canCreateWorkflow
export const canEditForm = canCreateForm
export const canManageDocuments = (user) => hasCapability(user, 'manage_documents')
export const canManageUsers = (user) => hasCapability(user, 'manage_users')
export const canViewReports = (user) => hasCapability(user, 'view_analytics')
export const canViewAudit = (user) => hasCapability(user, 'view_audit')
export const canSubmitForms = (user) => hasPermission(user, 'forms:submit')
export const isApprover = (user) => hasCapability(user, 'decide_tasks')
export const canViewTeam = isApprover
export const isSuperAdmin = (user) => roleName(user) === 'SuperAdmin'
export const isOrgAdmin = (user) => roleName(user) === 'Admin'
export const isOpsLeader = (user) => [
  'decide_tasks',
  'view_audit',
  'view_analytics'
].some((capability) => hasCapability(user, capability))
export const isPlatformShell = (user) => getShell(user) === SHELL.PLATFORM
export const isTenantShell = (user) => getShell(user) !== SHELL.PLATFORM
