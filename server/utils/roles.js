// Shared role sets for route guards — keep in sync with frontend/src/utils/permissions.js
// Shells: platform (SuperAdmin) | orgAdmin (Admin) | ops (leaders) | workspace (Employee)

const ADMIN_ROLES = ['Admin']
const OPS_ROLES = ['Admin', 'CEO', 'Manager', 'HR', 'VP']
const SUBMITTER_ROLES = ['Admin', 'CEO', 'Manager', 'HR', 'VP', 'Employee']
const AUDIT_ROLES = ['Admin', 'CEO']
const ANALYTICS_ROLES = ['Admin', 'CEO', 'Manager', 'HR', 'VP']

const isOps = (user) => OPS_ROLES.includes(user?.role?.name)

const shellFor = (roleName) => {
  if (roleName === 'SuperAdmin') return 'platform'
  if (roleName === 'Admin') return 'orgAdmin'
  if (OPS_ROLES.includes(roleName)) return 'ops'
  return 'workspace'
}

// Compatibility metadata for older callers. Builder access is deliberately
// absent because User.canBuild, not the person's role, is authoritative.
const CAPABILITIES = [
  {
    key: 'decide_tasks',
    label: 'Decide tasks',
    description: 'Act on approval, review and submission tasks assigned to them.',
    roles: OPS_ROLES
  },
  {
    key: 'manage_users',
    label: 'Manage users',
    description: 'Invite, edit, deactivate people and manage workspace access.',
    roles: ADMIN_ROLES
  },
  {
    key: 'view_audit',
    label: 'View audit',
    description: 'Read the workspace audit trail.',
    roles: AUDIT_ROLES
  },
  {
    key: 'view_analytics',
    label: 'View analytics',
    description: 'View operational reports, KPIs and SLA analytics.',
    roles: ANALYTICS_ROLES
  }
]

// Display order for the roles page: seniority first, workspace roles last, then
// anything a deployment has added on top.
const ROLE_ORDER = ['Admin', 'CEO', 'VP', 'Manager', 'HR', 'Employee']

module.exports = {
  ADMIN_ROLES,
  OPS_ROLES,
  SUBMITTER_ROLES,
  AUDIT_ROLES,
  ANALYTICS_ROLES,
  CAPABILITIES,
  ROLE_ORDER,
  shellFor,
  isOps
}
