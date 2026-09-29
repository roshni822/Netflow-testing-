// Lightweight "vault": resolve env:VAR_NAME references from process.env.
// Example: apiAuth.token = "env:ERP_API_TOKEN" → process.env.ERP_API_TOKEN

const ENV_PREFIX = 'env:'

const resolveSecret = (value) => {
  if (value === null || value === undefined) return value
  const s = String(value)
  if (!s.startsWith(ENV_PREFIX)) return s
  const name = s.slice(ENV_PREFIX.length).trim()
  if (!name) return ''
  const fromEnv = process.env[name]
  if (fromEnv === undefined || fromEnv === null) {
    console.warn(`Secret env var "${name}" is not set`)
    return ''
  }
  return String(fromEnv)
}

const resolveHeadersSecrets = (headers) => {
  const out = { ...(headers || {}) }
  for (const [k, v] of Object.entries(out)) {
    out[k] = resolveSecret(v)
  }
  return out
}

module.exports = { resolveSecret, resolveHeadersSecrets, ENV_PREFIX }
