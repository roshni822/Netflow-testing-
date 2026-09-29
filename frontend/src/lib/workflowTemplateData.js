export const WORKFLOW_TEMPLATES = [
  {
    id: 'leave',
    title: 'Leave approval',
    subtitle: 'Employee → Manager → HR two-step leave flow',
    icon: 'calendar',
    iconClass: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
    defaults: {
      name: 'Leave Approval Workflow',
      category: 'HR',
      description: 'Two-step leave request flow with manager and HR approval gates.',
      formHint: 'leave',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Manager review', subtitle: 'Approval node · 24h SLA', x: 300, y: 120, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours', onBreach: 'Escalate to admin', sequential: true },
        { id: 'n3', type: 'condition', title: 'Decision', subtitle: 'Approved / Rejected', x: 300, y: 230, branches: ['Approved', 'Rejected'] },
        { id: 'n4', type: 'notify', title: 'Notify reject', subtitle: 'Email + in-app', x: 110, y: 340, channels: ['Email', 'In-app'] },
        { id: 'n5', type: 'approval', title: 'HR approval', subtitle: 'Approval node · 48h SLA', x: 470, y: 340, approverRole: 'hr_admin', slaValue: 48, slaUnit: 'Hours', onBreach: 'Escalate to admin' },
        { id: 'n6', type: 'end', title: 'Approved', subtitle: 'Generate PDF', x: 470, y: 440 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4', dashed: true },
        { from: 'n3', to: 'n5' },
        { from: 'n5', to: 'n6' },
      ],
    },
  },
  {
    id: 'expense',
    title: 'Expense reimbursement',
    subtitle: 'Submit receipts, manager sign-off, finance payout',
    icon: 'receipt',
    iconClass: 'bg-success-subtle text-success-fg',
    defaults: {
      name: 'Expense Reimbursement',
      category: 'Finance',
      description: 'Receipt submission → manager approval → finance payout.',
      formHint: 'expense',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Manager sign-off', subtitle: 'Approval node · 24h SLA', x: 300, y: 130, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n3', type: 'approval', title: 'Finance payout', subtitle: 'Approval node · 48h SLA', x: 300, y: 240, approverRole: 'finance_manager', slaValue: 48, slaUnit: 'Hours' },
        { id: 'n4', type: 'end', title: 'Reimbursed', subtitle: 'Generate PDF', x: 300, y: 350 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
      ],
    },
  },
  {
    id: 'it',
    title: 'IT access request',
    subtitle: 'Software / hardware provisioning approval',
    icon: 'key',
    iconClass: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
    defaults: {
      name: 'IT Access Request',
      category: 'IT',
      description: 'Software / hardware provisioning approval flow.',
      formHint: 'access',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Manager approval', subtitle: 'Approval node · 24h SLA', x: 300, y: 130, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n3', type: 'approval', title: 'IT provisioning', subtitle: 'Approval node · 24h SLA', x: 300, y: 240, approverRole: 'it_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n4', type: 'notify', title: 'Notify requester', subtitle: 'Email + in-app', x: 300, y: 350, channels: ['Email', 'In-app'] },
        { id: 'n5', type: 'end', title: 'Access granted', subtitle: 'Finish', x: 300, y: 450 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
      ],
    },
  },
  {
    id: 'po',
    title: 'Purchase order',
    subtitle: 'Multi-tier PO approval with CFO escalation',
    icon: 'cart',
    iconClass: 'bg-warning-subtle text-warning-fg',
    defaults: {
      name: 'Purchase Order',
      category: 'Finance',
      description: 'Multi-tier PO approval with CFO escalation over $10k.',
      formHint: 'purchase',
      nodes: [
        { id: 'n1', type: 'start', title: 'PO submitted', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'approval', title: 'Dept head approval', subtitle: 'Approval node · 24h SLA', x: 300, y: 130, approverRole: 'direct_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n3', type: 'condition', title: 'Amount > $10k?', subtitle: 'Branch logic', x: 300, y: 240, branches: ['Yes', 'No'] },
        { id: 'n4', type: 'approval', title: 'CFO approval', subtitle: 'Approval node · 48h SLA', x: 470, y: 350, approverRole: 'ceo', slaValue: 48, slaUnit: 'Hours' },
        { id: 'n5', type: 'end', title: 'PO issued', subtitle: 'Generate PDF', x: 300, y: 460 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n3', to: 'n5', dashed: true },
        { from: 'n4', to: 'n5' },
      ],
    },
  },
  {
    id: 'onboarding',
    title: 'Onboarding checklist',
    subtitle: 'New hire document collection and sign-offs',
    icon: 'userPlus',
    iconClass: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300',
    defaults: {
      name: 'Onboarding Checklist',
      category: 'HR',
      description: 'New hire document collection and sign-offs.',
      formHint: 'onboarding',
      nodes: [
        { id: 'n1', type: 'start', title: 'New hire created', subtitle: 'Start trigger', x: 300, y: 20 },
        { id: 'n2', type: 'notify', title: 'Send docs to hire', subtitle: 'Email + in-app', x: 300, y: 130, channels: ['Email', 'In-app'] },
        { id: 'n3', type: 'approval', title: 'HR verification', subtitle: 'Approval node · 24h SLA', x: 300, y: 240, approverRole: 'hr_manager', slaValue: 24, slaUnit: 'Hours' },
        { id: 'n4', type: 'timer', title: 'Wait 24h', subtitle: 'Delay', x: 300, y: 350, waitValue: 24, waitUnit: 'Hours' },
        { id: 'n5', type: 'end', title: 'Onboarded', subtitle: 'Finish', x: 300, y: 450 },
      ],
      connections: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
      ],
    },
  },
  {
    id: 'scratch',
    title: 'Start from scratch',
    subtitle: 'Build a custom workflow from an empty canvas',
    icon: 'plus',
    iconClass: 'bg-surface-3 text-fg-muted',
    defaults: {
      name: '',
      category: 'HR',
      description: '',
      formHint: '',
      nodes: [
        { id: 'n1', type: 'start', title: 'Form submitted', subtitle: 'Start trigger', x: 320, y: 80 },
        { id: 'n2', type: 'end', title: 'Completed', subtitle: 'Finish', x: 320, y: 220 },
      ],
      connections: [{ from: 'n1', to: 'n2' }],
    },
  },
]

export function templateMeta(nodes = []) {
  const steps = nodes.length
  const approvals = nodes.filter((n) => n.type === 'approval' || n.type === 'multiApproval').length
  const branching = nodes.some((n) => n.type === 'condition')
  const parts = [
    `${steps} step${steps === 1 ? '' : 's'}`,
    `${approvals} approval${approvals === 1 ? '' : 's'}`,
  ]
  if (branching) parts.push('branching')
  return parts.join(' · ')
}
