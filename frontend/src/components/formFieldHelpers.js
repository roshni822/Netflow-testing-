export const FORM_FIELD_TYPES = [
  { type: 'text', label: 'Text' },
  { type: 'textarea', label: 'Text area' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'dropdown', label: 'Dropdown' },
  { type: 'file', label: 'File upload' },
  { type: 'signature', label: 'E-signature' },
  { type: 'camera', label: 'Camera' },
]

let _fid = 0

export const newFieldId = () => `f${Date.now().toString(36)}${(_fid++).toString(36)}`

export const SIGNATURE_FONTS = [
  { label: 'Lindsey', value: "lindsey, 'Lindsey', cursive" },
  { label: 'Ernie', value: "adobe-handwriting-ernie, 'Ernie', cursive" },
  { label: 'Frank', value: "adobe-handwriting-frank, 'Frank', cursive" },
  { label: 'Tiffany', value: "adobe-handwriting-tiffany, 'Tiffany', cursive" },
  { label: 'Fertigo', value: "fertigo-pro, 'Fertigo', cursive" },
]

export function isSignatureEmpty(value) {
  if (value === undefined || value === null || value === '') return true
  if (typeof value === 'object') return !(value.text || value.url)
  return !String(value).trim()
}

export const fieldDomId = (fieldId) => `ff-${fieldId}`

export function focusFirstError(fields, errors) {
  const first = (fields || []).find((f) => errors?.[f.id])
  if (!first) return
  const row = document.querySelector(`[data-field-row="${first.id}"]`)
  const control = document.getElementById(fieldDomId(first.id))
  const target = control || row
  try {
    ; (row || target)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch {
    row?.scrollIntoView()
  }
  if (control && typeof control.focus === 'function') {
    control.focus({ preventScroll: true })
  }
}

export function isFieldVisible(field, values) {
  const cl = field?.conditionalLogic
  if (!cl || typeof cl !== 'object' || !cl.enabled || !cl.dependsOn) return true

  const actual = values ? values[cl.dependsOn] : undefined
  const expected = cl.showWhen

  switch (cl.operator || 'eq') {
    case 'neq':
      return String(actual ?? '') !== String(expected ?? '')
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase())
    case 'nonempty':
      return !(actual === undefined || actual === null || actual === '' || actual === false)
    case 'eq':
    default:
      return String(actual ?? '') === String(expected ?? '')
  }
}

export function visibleFields(fields, values) {
  return (fields || []).filter((f) => isFieldVisible(f, values))
}

export function stripHiddenValues(fields, values) {
  const out = {}
  for (const f of visibleFields(fields, values)) {
    if (values[f.id] !== undefined) out[f.id] = values[f.id]
  }
  return out
}

export const PATTERN_PRESETS = {
  email: { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', label: 'Please enter a valid email address' },
  phone: { pattern: '^[+]?[0-9\\s()-]{7,15}$', label: 'Please enter a valid phone number' },
  digits: { pattern: '^[0-9]+$', label: 'Only digits are allowed' },
  alnum: { pattern: '^[a-zA-Z0-9]+$', label: 'Only letters and numbers are allowed' },
}

export function validateField(field, value) {
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

export function validateFields(fields, values) {
  const errs = {}
  for (const f of fields || []) {
    const v = values[f.id]
    if (f.required) {
      let empty = v === undefined || v === null || v === ''
      if (!empty && f.type === 'checkbox') {
        if (f.options && f.options.length > 0) {
          empty = Array.isArray(v) ? v.length === 0 : true
        } else {
          empty = v === false
        }
      }
      if (f.type === 'signature') empty = isSignatureEmpty(v)
      if (f.type === 'camera') empty = !(v && typeof v === 'object' && v.url)
      if (empty) {
        errs[f.id] = `${f.label} is required`
        continue
      }
    }
    const advanced = validateField(f, v)
    if (advanced) errs[f.id] = advanced
  }
  return errs
}
