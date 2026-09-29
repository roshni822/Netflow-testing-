// Shared - datetime.js
// One place for the date strings the UI shows. `toLocaleString()` sprinkled
// around produced a different shape on every page ("1/15/2024, 9:34:21 AM" next
// to "15 Jan 2024"), so everything routes through these instead.

const DATE_TIME_OPTS = { dateStyle: 'medium', timeStyle: 'short' }
const DATE_OPTS = { dateStyle: 'medium' }

const parse = (value) => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export const formatDateTime = (value, fallback = '') => {
  const d = parse(value)
  if (!d) return fallback
  try {
    return d.toLocaleString(undefined, DATE_TIME_OPTS)
  } catch {
    return d.toISOString()
  }
}

export const formatDate = (value, fallback = '') => {
  const d = parse(value)
  if (!d) return fallback
  try {
    return d.toLocaleDateString(undefined, DATE_OPTS)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export const relativeTime = (value) => {
  const d = parse(value)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const future = diff < 0
  const s = Math.floor(Math.abs(diff) / 1000)
  if (s < 60) return future ? 'in a moment' : 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return future ? `in ${m} min` : `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return future ? `in ${h} hr${h === 1 ? '' : 's'}` : `${h} hr${h === 1 ? '' : 's'} ago`
  const days = Math.floor(h / 24)
  if (days < 7) return future ? `in ${days} day${days === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'} ago`
  return formatDate(d)
}

// "15 Jan 2024, 9:34 am · 3 hrs ago" — absolute for the record, relative for
// the reader. Recent items lead with the relative form instead.
export const formatDateTimeWithRelative = (value, fallback = '') => {
  const d = parse(value)
  if (!d) return fallback
  const rel = relativeTime(d)
  const abs = formatDateTime(d)
  return rel && rel !== abs ? `${abs} · ${rel}` : abs
}

// Machine-readable value for a <time dateTime={...}> attribute.
export const isoAttr = (value) => parse(value)?.toISOString() || undefined
