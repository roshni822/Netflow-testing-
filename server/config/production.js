'use strict'

function validateProduction (env = process.env) {
  if (env.NODE_ENV !== 'production') return
  const errors = []
  for (const key of ['JWT_SECRET', 'FILE_URL_SECRET']) {
    const value = String(env[key] || '')
    if (value.length < 48 || /replace|example|change.?me|netflow-dev/i.test(value)) errors.push(key)
  }
  if (env.JWT_SECRET === env.FILE_URL_SECRET) errors.push('independent signing secrets')
  const origins = String(env.CLIENT_URL || '').split(',').map(value => value.trim()).filter(Boolean)
  if (!origins.length || origins.some(value => {
    try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value || Boolean(url.username || url.password) } catch { return true }
  })) errors.push('HTTPS CLIENT_URL origins')
  if ((env.MS_CLIENT_ID || env.MS_CLIENT_SECRET) && (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET || !/^[a-f\d-]{36}$/i.test(env.MS_TENANT_ID || '') || !String(env.MS_REDIRECT_URI || '').startsWith('https://'))) errors.push('complete, tenant-bound Microsoft SSO configuration')
  if (!env.DATABASE_URL) errors.push('DATABASE_URL')
  if (env.DISABLE_RATE_LIMIT === '1') errors.push('rate limiting enabled')
  if (env.SERVE_LEGACY_UPLOADS === '1') errors.push('legacy public uploads disabled')
  if (String(env.WEBHOOK_ALLOW_PRIVATE).toLowerCase() === 'true') errors.push('private webhooks disabled')
  if (errors.length) throw Object.assign(new Error('Invalid production configuration: ' + errors.join(', ')), { code: 'PRODUCTION_CONFIG_INVALID' })
}

module.exports = { validateProduction }
