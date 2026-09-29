const GB = 1024

const RESOURCES = [
  'users',
  'builders',
  'forms',
  'workflows',
  'submissions',
  'storage',
  'files',
]

const LIMIT_FIELD = {
  users: 'maxUsers',
  builders: 'maxBuilders',
  forms: 'maxForms',
  workflows: 'maxWorkflows',
  submissions: 'maxSubmissionsPerPeriod',
  storage: 'maxStorageMb',
  files: 'maxFiles',
}

// Initial defaults to boot with before DB loads
const PLAN_PRESETS = {
  trial: {
    label: 'Trial',
    trialDays: 14,
    features: { pdfAutoFill: true },
    limits: { maxUsers: 3, maxBuilders: 1, maxForms: 5, maxWorkflows: 2, maxSubmissionsPerPeriod: 100, maxStorageMb: 1 * GB, maxFiles: 0 },
  },
  basic: {
    label: 'Basic',
    features: { pdfAutoFill: true },
    limits: { maxUsers: 10, maxBuilders: 1, maxForms: 25, maxWorkflows: 10, maxSubmissionsPerPeriod: 1000, maxStorageMb: 5 * GB, maxFiles: 0 },
  },
  professional: {
    label: 'Professional',
    features: { pdfAutoFill: true },
    limits: { maxUsers: 50, maxBuilders: 3, maxForms: 100, maxWorkflows: 50, maxSubmissionsPerPeriod: 5000, maxStorageMb: 10 * GB, maxFiles: 0 },
  },
  enterprise: {
    label: 'Enterprise',
    features: { pdfAutoFill: true },
    limits: { maxUsers: 0, maxBuilders: 0, maxForms: 0, maxWorkflows: 0, maxSubmissionsPerPeriod: 0, maxStorageMb: 0, maxFiles: 0 },
  },
  custom: {
    label: 'Custom',
    limits: null,
    features: { pdfAutoFill: false },
  },
}

const PLAN_KEYS = Object.keys(PLAN_PRESETS)
const SELLABLE_PLANS = PLAN_KEYS.filter((p) => p !== 'custom')

const DEFAULT_PLAN = 'custom'

const WARN_THRESHOLDS = {
  submissions: [80, 90, 100],
  storage: [80, 90, 95, 100],
  default: [80, 90, 100],
}

const BUFFER_PERCENT = 5
const BUFFER_CAP_MB = 500

async function reloadPlans() {
  const Plan = require('../models/Plan')
  const plans = await Plan.find({}).lean()
  
  if (plans.length === 0) {
    if (require('../database/layout').organizationSchemas()) throw Object.assign(new Error('Platform plans must be initialized using database setup.'), {code:'PLAN_CATALOGUE_MISSING'})
    // Seed initial plans
    const seedPlans = Object.keys(PLAN_PRESETS).map(key => ({
      key,
      label: PLAN_PRESETS[key].label,
      trialDays: PLAN_PRESETS[key].trialDays || null,
      limits: PLAN_PRESETS[key].limits || {
        maxUsers: 0, maxBuilders: 0, maxForms: 0, maxWorkflows: 0, maxSubmissionsPerPeriod: 0, maxStorageMb: 0, maxFiles: 0
      },
      features: PLAN_PRESETS[key].features || { pdfAutoFill: key !== 'custom' },
      isCustom: key === 'custom'
    }))
    await Plan.insertMany(seedPlans)
    return // Seed is complete, PLAN_PRESETS remains as is
  }

  // Clear existing object properties
  Object.keys(PLAN_PRESETS).forEach(k => delete PLAN_PRESETS[k])
  
  plans.forEach(p => {
    PLAN_PRESETS[p.key] = {
      label: p.label,
      trialDays: p.trialDays,
      limits: p.isCustom ? null : p.limits,
      features: {
        // Missing means a pre-feature plan. The approved migration policy is
        // entitlement-on for every sellable plan.
        pdfAutoFill: p.isCustom ? false : p.features?.pdfAutoFill !== false
      }
    }
  })

  if (!PLAN_PRESETS.custom) {
    PLAN_PRESETS.custom = { label: 'Custom', limits: null, features: { pdfAutoFill: false } }
  }

  // Mutate exported arrays in-place to update consumers
  PLAN_KEYS.length = 0
  PLAN_KEYS.push(...Object.keys(PLAN_PRESETS))

  SELLABLE_PLANS.length = 0
  SELLABLE_PLANS.push(...PLAN_KEYS.filter(p => p !== 'custom'))
}

const presetFor = (plan) => {
  const placement=require('../tenancy/tenantContext').getPlacement()
  if(placement?.planKey===plan && placement.planPreset) return placement.planPreset
  return PLAN_PRESETS[plan] || null
}

const isUnlimited = (limit) => !limit || Number(limit) <= 0

const limitsForPlan = (plan) => {
  const preset = presetFor(plan)
  if (!preset || !preset.limits) return null
  return { ...preset.limits }
}

const bufferMbFor = (maxStorageMb) => {
  if (isUnlimited(maxStorageMb)) return 0
  return Math.min(Math.round((Number(maxStorageMb) * BUFFER_PERCENT) / 100), BUFFER_CAP_MB)
}

const matchesPreset = (plan, limits = {}) => {
  const preset = limitsForPlan(plan)
  if (!preset) return false
  return Object.keys(preset).every((k) => Number(limits[k] || 0) === Number(preset[k] || 0))
}

module.exports = {
  GB,
  RESOURCES,
  LIMIT_FIELD,
  PLAN_PRESETS,
  PLAN_KEYS,
  SELLABLE_PLANS,
  DEFAULT_PLAN,
  WARN_THRESHOLDS,
  BUFFER_PERCENT,
  BUFFER_CAP_MB,
  presetFor,
  limitsForPlan,
  isUnlimited,
  bufferMbFor,
  matchesPreset,
  reloadPlans
}
