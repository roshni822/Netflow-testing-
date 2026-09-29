// Departments — utils/departments.js
// A department is a per-tenant label, not a platform constant: one org runs on
// HR/Finance/IT, the next on Studio/Post/Delivery. The list lives on the
// Organization document and this module is the single place that reads it, so
// every validator, picker and importer agrees on what "a department" is here.
//
// Orgs created before departments were configurable have no list stored; they
// fall back to the six names that used to be hard-coded on the User model, so
// nothing has to be migrated before an admin opens the Departments page.

const DEFAULT_DEPARTMENTS = ['HR', 'Finance', 'IT', 'Operations', 'Sales', 'Legal']

const MAX_DEPARTMENTS = 100
const MAX_NAME_LENGTH = 40

const listFor = (org) => {
  const stored = org?.departments
  return Array.isArray(stored) && stored.length ? [...stored] : [...DEFAULT_DEPARTMENTS]
}

// Case-insensitive match that returns the stored spelling, so "hr" resolves to
// "HR" instead of creating a second department that only differs in case.
const canonical = (org, name) => {
  const wanted = String(name || '').trim().toLowerCase()
  if (!wanted) return null
  return listFor(org).find((d) => d.toLowerCase() === wanted) || null
}

const isAllowed = (org, name) => canonical(org, name) !== null

// Returns { ok: true, name } with the cleaned name, or { ok: false, error, code }.
const validateName = (name) => {
  const clean = String(name || '').trim().replace(/\s+/g, ' ')
  if (!clean) {
    return { ok: false, error: 'Department name is required', code: 'MISSING_NAME' }
  }
  if (clean.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Department name must be ${MAX_NAME_LENGTH} characters or fewer`, code: 'NAME_TOO_LONG' }
  }
  if (!/^[\w&().,'\- /]+$/.test(clean)) {
    return { ok: false, error: 'Department name may only contain letters, numbers, spaces and & ( ) . , \' - /', code: 'INVALID_NAME' }
  }
  return { ok: true, name: clean }
}

module.exports = {
  DEFAULT_DEPARTMENTS,
  MAX_DEPARTMENTS,
  MAX_NAME_LENGTH,
  listFor,
  canonical,
  isAllowed,
  validateName
}
