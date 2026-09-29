// Single source of truth for file-upload size limits, shared by the form
// builder (NewForm) and the form filler (FillForm). The server enforces the
// same ceiling in server/routes/uploads.js.
export const MAX_UPLOAD_MB = 50

// Resolves a form field's "Max size" into a number of MB. Accepts a numeric
// value (current format), a legacy string like "5MB" (parses the leading
// digits), or falls back. Always clamped to MAX_UPLOAD_MB so a single field can
// never request more than the server ceiling allows.
export function fieldMaxMb(field, fallback = 5) {
  const raw = field?.maxSize
  let mb
  if (typeof raw === 'number') {
    mb = raw
  } else {
    const n = parseInt(String(raw ?? ''), 10)
    mb = Number.isFinite(n) ? n : fallback
  }
  if (!Number.isFinite(mb) || mb <= 0) mb = fallback
  return Math.min(mb, MAX_UPLOAD_MB)
}
