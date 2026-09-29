// Microsoft "Sign in with Microsoft" (OAuth2 authorization-code flow via MSAL).
// Built lazily and only when configured, so the server runs fine in dev without
// any MS_* credentials. Stateless: we sign the OAuth `state` as a short-lived
// JWT (no server sessions), and use a confidential client (client secret) so no
// PKCE/code-verifier needs to be persisted between the two round-trips.

const jwt = require('jsonwebtoken')

let msalModule = null
let cachedClient = null

const SCOPES = ['openid', 'profile', 'email', 'User.Read']
const STATE_TTL_SECONDS = 60

// SSO is only usable when the app registration credentials are present.
const isConfigured = () => Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET)

const redirectUri = () =>
  process.env.MS_REDIRECT_URI ||
  `http://localhost:${process.env.PORT || 5000}/api/auth/oauth/microsoft/callback`

// Lazily construct (and cache) the MSAL confidential client. `common` authority
// = multi-tenant; a specific tenant id can be set for single-tenant.
const getClient = () => {
  if (!isConfigured()) return null
  if (cachedClient) return cachedClient
  if (!msalModule) msalModule = require('@azure/msal-node')
  const tenant = process.env.MS_TENANT_ID || 'common'
  cachedClient = new msalModule.ConfidentialClientApplication({
    auth: {
      clientId: process.env.MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${tenant}`,
      clientSecret: process.env.MS_CLIENT_SECRET
    }
  })
  return cachedClient
}

// CSRF: the OAuth `state` is a short-lived signed token we can verify on the
// callback without any server-side storage.
const signState = (nonce) =>
  jwt.sign({ sso: 'ms', nonce }, process.env.JWT_SECRET, { expiresIn: STATE_TTL_SECONDS })

const verifyState = (state, nonce) => {
  try {
    const decoded = jwt.verify(String(state || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] })
    return decoded && decoded.sso === 'ms' && typeof nonce === 'string' && nonce.length >= 32 && decoded.nonce === nonce
  } catch {
    return false
  }
}

// Build the Microsoft consent/login URL to redirect the browser to.
const getAuthCodeUrl = (state) => {
  const client = getClient()
  if (!client) throw new Error('Microsoft SSO is not configured')
  return client.getAuthCodeUrl({ scopes: SCOPES, redirectUri: redirectUri(), state })
}

// Exchange the authorization code for tokens. Returns the MSAL auth result
// (contains `account` + `idTokenClaims`).
const acquireTokenByCode = (code) => {
  const client = getClient()
  if (!client) throw new Error('Microsoft SSO is not configured')
  return client.acquireTokenByCode({ code, scopes: SCOPES, redirectUri: redirectUri() })
}

// Pull the verified email out of an MSAL auth result, trying the usual claims.
const emailFromResult = (result) => {
  const claims = (result && result.idTokenClaims) || {}
  const raw =
    (result && result.account && result.account.username) ||
    claims.preferred_username ||
    claims.email ||
    (Array.isArray(claims.emails) ? claims.emails[0] : null)
  return raw ? String(raw).toLowerCase().trim() : null
}

module.exports = {
  isConfigured,
  signState,
  verifyState,
  getAuthCodeUrl,
  acquireTokenByCode,
  emailFromResult
}
