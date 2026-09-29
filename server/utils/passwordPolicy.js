// Keep this pure policy identical in frontend/src/utils/passwordPolicy.js and
// server/utils/passwordPolicy.js; password_policy.test.js checks parity.
// Separate copies keep frontend and server deployments self-contained.
const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_BYTES = 72

// A local common-pattern blocklist, not a breach database or strength estimate.
const COMMON_PASSWORDS = new Set([
  'password', 'passwordpassword', 'passw0rd', 'letmein', 'welcome', 'welcomehome',
  'admin', 'administrator', 'changeme', 'changeit', 'default', 'secret', 'login',
  'qwerty', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'iloveyou', 'iloveyouforever',
  'trustnoone', 'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess',
  'master', 'superman', 'whatever', 'netflow', 'netlink', 'netflowadmin',
  'correcthorsebatterystaple', 'thisisapassword', 'mypassword', 'testpassword'
])
const SEQUENCES = ['0123456789', '1234567890', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm']

function isCommonPassword(value) {
  const compact = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const stem = compact.replace(/^\d+|\d+$/g, '')
  const deLeet = stem.replace(/[013457]/g, (digit) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' })[digit])
  const symbolStem = value.toLowerCase().replace(/[@$]/g, (symbol) => symbol === '@' ? 'a' : 's')
    .replace(/[^\p{L}\p{N}]/gu, '').replace(/^\d+|\d+$/g, '')
  if (!value.trim() || COMMON_PASSWORDS.has(stem) || COMMON_PASSWORDS.has(deLeet) || COMMON_PASSWORDS.has(symbolStem)) return true
  if (/^(.{1,12})\1+$/u.test(value) || (compact && /^(.{1,12})\1+$/u.test(compact))) return true
  return compact.length >= MIN_PASSWORD_LENGTH && SEQUENCES.some((sequence) =>
    sequence.repeat(8).includes(compact) || [...sequence].reverse().join('').repeat(8).includes(compact))
}

function getPasswordPolicy(value) {
  const isString = typeof value === 'string'
  const password = isString ? value : ''
  const length = [...password].length
  const byteLength = new TextEncoder().encode(password).length
  const checks = {
    length: length >= MIN_PASSWORD_LENGTH,
    maxBytes: byteLength <= MAX_PASSWORD_BYTES,
    notCommon: Boolean(password) && byteLength <= MAX_PASSWORD_BYTES && !isCommonPassword(password)
  }
  let code = '', error = ''
  if (!isString || !password) {
    code = 'PASSWORD_REQUIRED'
    error = 'Enter a new password'
  } else if (!checks.maxBytes) {
    code = 'PASSWORD_TOO_LONG'
    error = 'Password is too long. Use up to 72 UTF-8 bytes; some characters use more than one byte.'
  } else if (!checks.length) {
    code = 'PASSWORD_TOO_SHORT'
    error = 'Use at least 12 characters'
  } else if (!checks.notCommon) {
    code = 'PASSWORD_TOO_COMMON'
    error = 'Choose a less predictable password. Avoid common passwords, sequences, and repeated patterns.'
  }
  return { checks, length, byteLength, valid: !error, code, error }
}

module.exports = { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, getPasswordPolicy }

