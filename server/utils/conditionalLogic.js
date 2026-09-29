// Conditional field logic — server mirror of the frontend helper
// (frontend/src/components/FormFields.jsx). Used to skip required-field checks
// for fields that are hidden by their rule, so a hidden required field never
// blocks an otherwise-valid submission.
//
// A field carries: conditionalLogic: { enabled, dependsOn, operator, showWhen }
//   dependsOn — id of another (earlier) field
//   operator  — 'eq' | 'neq' | 'contains' | 'nonempty' (default 'eq')
//   showWhen  — the value to compare against
// Legacy data may store conditionalLogic as a bare boolean (old builder); that
// has no rule, so the field is always visible.

const isFieldVisible = (field, data) => {
  const cl = field && field.conditionalLogic
  if (!cl || typeof cl !== 'object' || !cl.enabled || !cl.dependsOn) return true

  const actual = data ? data[cl.dependsOn] : undefined
  const expected = cl.showWhen
  const a = actual === undefined || actual === null ? '' : String(actual)
  const e = expected === undefined || expected === null ? '' : String(expected)

  switch (cl.operator || 'eq') {
    case 'neq':
      return a !== e
    case 'contains':
      return a.toLowerCase().includes(e.toLowerCase())
    case 'nonempty':
      return !(actual === undefined || actual === null || actual === '' || actual === false)
    case 'eq':
    default:
      return a === e
  }
}

module.exports = { isFieldVisible }
