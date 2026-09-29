const asStr = (value, max = 200) => String(value ?? '').trim().slice(0, max)

const num = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const cleanOptions = (values) => {
  const options = []
  if (!Array.isArray(values)) return options
  for (const value of values) {
    const option = asStr(value, 80)
    if (option && !options.includes(option)) options.push(option)
    if (options.length >= 20) break
  }
  return options
}

const AI_TYPES = new Set([
  'text', 'dropdown', 'date', 'file', 'checkbox', 'signature',
  'number', 'radio', 'grid', 'heading'
])
const GRID_CELL_TYPES = new Set(['text', 'number', 'date', 'dropdown'])

const identifierLabel = (label) => {
  const value = asStr(label, 120)
  const hasIdentifierKind = /\b(?:grn|po|purchase\s+order|invoice|tax|vat|gst|aadhaar|aadhar|ssn|account|employee|vendor|supplier|reference|tracking|serial)\b/i.test(value)
  if (!hasIdentifierKind) return false
  if (/\b(?:id|number|no\.?|code|ref(?:erence)?|#)\b/i.test(value)) return true
  // These labels commonly name the identifier itself without a trailing
  // "number" token. Keep them lossless in document-generated forms.
  return /^\s*(?:grn|po|purchase\s+order|invoice|aadhaar|aadhar|ssn|account)\s*$/i.test(value)
}

// Coerce untrusted AI JSON into the exact field shape the form builder accepts.
// Document generation opts into lossless identifier handling; the existing
// prompt-builder contract keeps its historical type behavior by default.
function sanitizeAiFields(raw, { maxFields = 25, identifiersAsText = false } = {}) {
  if (!Array.isArray(raw)) return []
  const fields = []
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object') continue
    const label = asStr(candidate.label, 120)
    if (!label) continue
    // Preserve the historical prompt-builder contract by retaining its truthy
    // coercion. Document generation opts into stricter identifier handling via
    // `identifiersAsText` without silently changing the existing AI builder.
    const required = Boolean(candidate.required)
    let type = asStr(candidate.type, 20).toLowerCase()

    if (type === 'email' || type === 'tel' || type === 'phone' || type === 'url' || type === 'string') {
      type = 'text'
    } else if (type === 'select' || type === 'choice' || type === 'options') {
      type = 'dropdown'
    } else if (type === 'datetime' || type === 'time') {
      type = 'date'
    } else if (type === 'upload' || type === 'attachment') {
      type = 'file'
    } else if (type === 'integer' || type === 'float' || type === 'decimal' || type === 'currency') {
      type = 'number'
    } else if (type === 'boolean' || type === 'toggle' || type === 'switch') {
      type = 'checkbox'
    }

    if (identifiersAsText && identifierLabel(label)) type = 'text'

    let field
    if (['textarea', 'paragraph', 'longtext', 'long_text'].includes(type)) {
      field = {
        type: 'text', label, required, multiline: true, maxLength: null,
        placeholder: asStr(candidate.placeholder, 120)
      }
    } else if (!AI_TYPES.has(type)) {
      field = {
        type: 'text', label, required, multiline: false, maxLength: null,
        placeholder: asStr(candidate.placeholder, 120)
      }
    } else if (type === 'text') {
      field = {
        type, label, required, multiline: candidate.multiline === true,
        maxLength: num(candidate.maxLength), placeholder: asStr(candidate.placeholder, 120)
      }
    } else if (type === 'number') {
      field = {
        type, label, required, min: num(candidate.min), max: num(candidate.max),
        placeholder: asStr(candidate.placeholder, 120)
      }
    } else if (type === 'dropdown' || type === 'radio') {
      const options = cleanOptions(candidate.options)
      if (options.length === 0) options.push('Option 1', 'Option 2')
      field = {
        type, label, required, options,
        layout: candidate.layout === 'horizontal' ? 'horizontal' : 'vertical'
      }
      if (type === 'dropdown') field.placeholder = asStr(candidate.placeholder, 120) || 'Choose...'
    } else if (type === 'file') {
      const maxSize = num(candidate.maxSize)
      field = {
        type, label, required,
        fileTypes: asStr(candidate.fileTypes, 60) || 'PDF / DOCX',
        maxSize: maxSize ? Math.min(Math.max(maxSize, 1), 50) : 5
      }
    } else if (type === 'grid') {
      const columns = []
      for (const rawColumn of (Array.isArray(candidate.columns) ? candidate.columns : [])) {
        const columnLabel = asStr(rawColumn?.label, 60)
        if (!columnLabel) continue
        let columnType = asStr(rawColumn?.type, 20).toLowerCase()
        if (!GRID_CELL_TYPES.has(columnType)) columnType = 'text'
        const column = { id: 'c' + (columns.length + 1), label: columnLabel, type: columnType }
        if (columnType === 'dropdown') column.options = cleanOptions(rawColumn?.options)
        columns.push(column)
        if (columns.length >= 12) break
      }
      if (columns.length === 0) columns.push({ id: 'c1', label: 'Column 1', type: 'text' })
      field = { type, label, required, columns }
    } else if (type === 'checkbox') {
      field = {
        type, label, required,
        layout: candidate.layout === 'horizontal' ? 'horizontal' : 'vertical'
      }
      const options = cleanOptions(candidate.options)
      if (options.length) field.options = options
    } else if (type === 'heading') {
      field = { type, label, placeholder: asStr(candidate.placeholder, 1000) }
    } else if (type === 'date') {
      field = { type, label, required, includeTime: candidate.includeTime === true }
    } else {
      field = { type, label, required }
    }

    field.page = Math.max(1, num(candidate.page) || 1)
    fields.push(field)
    if (fields.length >= Math.max(1, Number(maxFields) || 25)) break
  }
  return fields
}

function documentFieldValidationError(candidate) {
  const label = asStr(candidate?.label, 120)
  if (!label) return 'Every included field needs a label.'

  const type = asStr(candidate?.type, 20).toLowerCase()
  if (['dropdown', 'radio', 'select', 'choice', 'options'].includes(type)) {
    if (cleanOptions(candidate?.options).length < 2) {
      return 'Dropdown and radio fields need at least two distinct options.'
    }
  }
  if (type === 'grid') {
    const columns = Array.isArray(candidate?.columns)
      ? candidate.columns.filter((column) => asStr(column?.label, 60))
      : []
    if (!columns.length) return 'Table fields need at least one named column.'
  }
  return null
}

module.exports = {
  asStr,
  sanitizeAiFields,
  identifierLabel,
  documentFieldValidationError
}
