// New-user application demo steps. Each step highlights a real UI control
// (data-tour). Paths navigate in-app only — never an external URL.

import { getShell, SHELL } from '../utils/permissions'

/** Normalize pathname → stable page key. */
export function pageKeyFromPath(pathname) {
  if (!pathname) return 'dashboard'
  const base = pathname.split('?')[0]
  if (base === '/' || base === '/dashboard') return 'dashboard'
  const seg = base.split('/').filter(Boolean)[0]
  return seg || 'dashboard'
}

const SHELL_LABEL = {
  [SHELL.PLATFORM]: 'platform console',
  [SHELL.ORG_ADMIN]: 'organization admin workspace',
  [SHELL.OPS]: 'operations workspace',
  [SHELL.WORKSPACE]: 'workspace',
}

function shellChromeSteps(shell) {
  return [
    {
      target: 'nav-dashboard',
      path: '/dashboard',
      title: 'Left navigation',
      body: `This menu is your map of the ${SHELL_LABEL[shell] || 'workspace'}. Click any item to open that area. Next highlights search.`,
      placement: 'right',
    },
    {
      target: 'search',
      path: '/dashboard',
      title: 'Global search',
      body: 'Type here to jump to forms, workflows, tasks, or pages without browsing the menu. Next: notifications.',
      placement: 'bottom',
    },
    {
      target: 'notifications',
      path: '/dashboard',
      title: 'Notifications bell',
      body: 'Click the bell for a dropdown of updates. New items also appear as top-right alerts. Next: theme toggle.',
      placement: 'bottom',
    },
    {
      target: 'theme',
      path: '/dashboard',
      title: 'Light and dark mode',
      body: 'Switch appearance anytime. Your choice is saved. Next we open the main areas for your role.',
      placement: 'bottom',
    },
  ]
}

function platformPages() {
  return [
    {
      target: 'page-title',
      path: '/dashboard',
      title: 'Platform dashboard',
      body: 'Fleet health, licence pressure, and tenants that need attention. Next: Organizations.',
      placement: 'bottom',
    },
    {
      target: 'nav-platform',
      path: '/platform',
      title: 'Organizations',
      body: 'Create and manage tenant workspaces — plans, limits, and org admins. Next: the tenant list.',
      placement: 'right',
    },
    {
      target: 'page-title',
      path: '/platform',
      title: 'Tenant list',
      body: 'Open any organization to adjust limits, storage, or billing contacts. Next: Usage.',
      placement: 'bottom',
    },
    {
      target: 'nav-usage',
      path: '/usage',
      title: 'Usage',
      body: 'Compare seats, builders, runs, and storage across every tenant. Next: Activity logs.',
      placement: 'right',
    },
    {
      target: 'nav-activity',
      path: '/activity',
      title: 'Activity logs',
      body: 'Platform-level audit trail — who changed what. Next: System health.',
      placement: 'right',
    },
    {
      target: 'nav-health',
      path: '/health',
      title: 'System health',
      body: 'Jobs, integrations, and service status before tenants feel an outage. Next: Plans.',
      placement: 'right',
    },
    {
      target: 'nav-plans',
      path: '/plans',
      title: 'Plans',
      body: 'Plan templates and default quotas used when provisioning organizations. Next: Admins.',
      placement: 'right',
    },
    {
      target: 'nav-admins',
      path: '/admins',
      title: 'Platform admins',
      body: 'Invite other Super Admins and manage console access.',
      placement: 'right',
    },
  ]
}

function orgAdminPages() {
  return [
    {
      target: 'page-title',
      path: '/dashboard',
      title: 'Dashboard',
      body: 'Your home for workload, activity, and org signals. Next: Forms.',
      placement: 'bottom',
    },
    {
      target: 'nav-forms',
      path: '/forms',
      title: 'Forms',
      body: 'Forms collect the data that starts work. Next: the form library.',
      placement: 'right',
    },
    {
      target: 'page-title',
      path: '/forms',
      title: 'Form library',
      body: 'Every form in your org — drafts and published. Next: how to create one.',
      placement: 'bottom',
    },
    {
      target: 'forms-create',
      path: '/forms',
      title: 'Create a form',
      body: 'Use New form to start blank, from a template, or with AI. Next: the field palette.',
      placement: 'bottom',
    },
    {
      target: 'form-builder-fields',
      path: '/forms/new?blank=1',
      title: 'Add fields',
      body: 'Click or drag field types onto the canvas (text, date, dropdown, file, signature…). Next: Publish.',
      placement: 'right',
    },
    {
      target: 'form-builder-publish',
      path: '/forms/new?blank=1',
      title: 'Publish the form',
      body: 'Save draft anytime. Publish makes it fillable and attachable to workflows. Next: how forms are used.',
      placement: 'bottom',
    },
    {
      target: 'forms-list',
      path: '/forms',
      title: 'How forms are used',
      body: 'Staff fill published forms, or share a public link. Submissions can start a workflow. Next: Workflows.',
      placement: 'top',
    },
    {
      target: 'nav-workflows',
      path: '/workflows',
      title: 'Workflow Builder',
      body: 'Turn a form submission into approvals, decisions, and outcomes. Next: the workflow list.',
      placement: 'right',
    },
    {
      target: 'page-title',
      path: '/workflows',
      title: 'Workflow list',
      body: 'Drafts stay off until you publish. Active workflows run for new submissions. Next: create.',
      placement: 'bottom',
    },
    {
      target: 'workflows-create',
      path: '/workflows',
      title: 'Create a workflow',
      body: 'Click New workflow, pick a template or blank, then build the path. Next: the builder.',
      placement: 'bottom',
    },
    {
      target: 'workflow-builder-main',
      path: '/workflows/new',
      title: 'Build the path',
      body: 'Add nodes (Submit, Approval, Decision, Integration, End), connect them, then link a published form in Settings. Next: publish.',
      placement: 'center',
    },
    {
      target: 'workflow-builder-actions',
      path: '/workflows/new',
      title: 'Publish the workflow',
      body: 'Save draft while designing. On Review, Publish goes live so new submissions create tasks. Next: how runs work.',
      placement: 'top',
    },
    {
      target: 'workflows-list',
      path: '/workflows',
      title: 'How workflows run',
      body: 'Form submit → execution → approvers act in Tasks → track status on Dashboard and Reports. Next: Reports.',
      placement: 'top',
    },
    {
      target: 'nav-analytics',
      path: '/analytics',
      title: 'Reports',
      body: 'Volume, cycle time, and bottlenecks across your processes. Next: Audit logs.',
      placement: 'right',
    },
    {
      target: 'nav-audit',
      path: '/audit-log',
      title: 'Audit logs',
      body: 'Durable trail of sensitive actions for compliance. Next: Users.',
      placement: 'right',
    },
    {
      target: 'nav-admin',
      path: '/admin',
      title: 'Users',
      body: 'Invite people, assign roles, and grant builder seats. Next: Departments.',
      placement: 'right',
    },
    {
      target: 'nav-departments',
      path: '/departments',
      title: 'Departments',
      body: 'Group users so routing and visibility match your org. Next: Roles.',
      placement: 'right',
    },
    {
      target: 'nav-roles',
      path: '/roles',
      title: 'Roles & permissions',
      body: 'Control what each role can see and do. Next: Organization settings.',
      placement: 'right',
    },
    {
      target: 'nav-org-settings',
      path: '/settings',
      title: 'Organization',
      body: 'Workspace settings and org-level preferences.',
      placement: 'right',
    },
  ]
}

function opsPages() {
  return [
    {
      target: 'page-title',
      path: '/dashboard',
      title: 'Dashboard',
      body: 'Pending approvals, team load, and recent activity. Next: Approvals inbox.',
      placement: 'bottom',
    },
    {
      target: 'nav-tasks',
      path: '/tasks',
      title: 'Approvals',
      body: 'Requests waiting on you. Open one to approve, reject, or comment. Next: the inbox.',
      placement: 'right',
    },
    {
      target: 'page-title',
      path: '/tasks',
      title: 'Task inbox',
      body: 'Filter by status and act. Menu badges show waiting count. Next: Forms.',
      placement: 'bottom',
    },
    {
      target: 'nav-forms',
      path: '/forms',
      title: 'Forms',
      body: 'Start a request or browse what your org collects. Next: how to fill one.',
      placement: 'right',
    },
    {
      target: 'page-title',
      path: '/forms',
      title: 'Using forms',
      body: 'Pick a form → fill fields → submit. That starts the linked workflow. Next: after submit.',
      placement: 'bottom',
    },
    {
      target: 'forms-list',
      path: '/forms',
      title: 'After you submit',
      body: 'Track under Approvals. You’ll get notifications when someone acts. Next: My Team.',
      placement: 'top',
    },
    {
      target: 'nav-team',
      path: '/team',
      title: 'My Team',
      body: 'People you lead and how work is distributed. Next: Analytics.',
      placement: 'right',
    },
    {
      target: 'nav-analytics',
      path: '/analytics',
      title: 'Analytics',
      body: 'Throughput and aging so you can unblock stuck processes. Next: Audit logs.',
      placement: 'right',
    },
    {
      target: 'nav-audit',
      path: '/audit-log',
      title: 'Audit logs',
      body: 'Official trail of who took action.',
      placement: 'right',
    },
  ]
}

function workspacePages() {
  return [
    {
      target: 'page-title',
      path: '/dashboard',
      title: 'Dashboard',
      body: 'Your requests, progress, and what to do next. Next: My Requests.',
      placement: 'bottom',
    },
    {
      target: 'nav-tasks',
      path: '/tasks',
      title: 'My Requests',
      body: 'Everything you submitted — pending, approved, or needing follow-up. Next: the list.',
      placement: 'right',
    },
    {
      target: 'page-title',
      path: '/tasks',
      title: 'Your requests',
      body: 'Open any row for status, comments, and history. Next: Forms.',
      placement: 'bottom',
    },
    {
      target: 'nav-forms',
      path: '/forms',
      title: 'Forms',
      body: 'Start work by opening a published form. Next: how to fill one.',
      placement: 'right',
    },
    {
      target: 'page-title',
      path: '/forms',
      title: 'Fill a form',
      body: 'Choose a form, complete the fields, and submit. Next: tracking.',
      placement: 'bottom',
    },
    {
      target: 'forms-list',
      path: '/forms',
      title: 'Track your request',
      body: 'After submit, watch status under My Requests. You’ll get notified when approvers act. Next: Profile.',
      placement: 'top',
    },
    {
      target: 'nav-profile',
      path: '/profile',
      title: 'Profile',
      body: 'Update your name, password, and notification preferences.',
      placement: 'right',
    },
  ]
}

/** Full application demo for the signed-in user’s shell. */
export function buildFullTour(user) {
  const shell = getShell(user)
  const chrome = shellChromeSteps(shell)
  let pages = workspacePages()
  if (shell === SHELL.PLATFORM) pages = platformPages()
  else if (shell === SHELL.ORG_ADMIN) pages = orgAdminPages()
  else if (shell === SHELL.OPS) pages = opsPages()

  return [
    {
      target: 'main-content',
      path: '/dashboard',
      title: 'NetFlow demo',
      body: 'Here’s how the app works for your role. We’ll highlight each main area. Use Next to continue — Skip is the only way to exit early.',
      placement: 'center',
    },
    ...chrome,
    ...pages,
    {
      target: 'user-menu',
      path: '/dashboard',
      title: 'You’re ready',
      body: 'That’s the demo. Open your profile from this menu anytime, or sign out when you’re done.',
      placement: 'bottom',
    },
  ]
}

/** Steps for a single page (subset of the full demo). */
export function buildPageTour(user, pathname) {
  const key = pageKeyFromPath(pathname)
  const all = buildFullTour(user)
  const pageSteps = all.filter((s) => pageKeyFromPath(s.path || '/dashboard') === key)
  if (pageSteps.length) return pageSteps

  return [
    {
      target: 'page-title',
      path: pathname,
      title: 'This page',
      body: 'Use the left menu to move between areas of NetFlow.',
      placement: 'bottom',
    },
  ]
}
