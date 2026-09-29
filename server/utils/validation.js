// Advanced per-field validation (length limits, numeric range, format pattern).
// Mirrors frontend/src/components/FormFields.jsx validateField so the client and
// server agree. Reads the canonical nested `field.validation` object, falling
// back to legacy flat props for older data. Empty values are NOT validated here
// (the required-check owns emptiness). Returns an error string or null.
const validateField = (field, value) => {
  if (!field) return null
  const v = field.validation || {}
  const minLength = v.minLength != null ? v.minLength : field.minLength
  const maxLength = v.maxLength != null ? v.maxLength : field.maxLength
  const min = v.min != null ? v.min : field.min
  const max = v.max != null ? v.max : field.max
  const pattern = v.pattern
  const patternLabel = v.patternLabel

  const empty = value === undefined || value === null || value === ''
  if (empty) return null

  if (field.type === 'text' || field.type === 'textarea') {
    const len = String(value).length
    if (minLength != null && len < minLength) return `${field.label} must be at least ${minLength} characters`
    if (maxLength != null && len > maxLength) return `${field.label} must be at most ${maxLength} characters`
  }

  if (field.type === 'number') {
    const n = Number(value)
    if (Number.isNaN(n)) return `${field.label} must be a number`
    if (min != null && n < min) return `${field.label} must be at least ${min}`
    if (max != null && n > max) return `${field.label} must be at most ${max}`
  }

  if (pattern && (field.type === 'text' || field.type === 'textarea')) {
    try {
      if (!new RegExp(pattern).test(String(value))) {
        return patternLabel || `${field.label} is not in the expected format`
      }
    } catch {
      // Malformed stored regex — never block submission on it.
    }
  }

  return null
}

module.exports = { validateField }
