// Shared password helper.
// generatePassword — a strong but human-transcribable temporary password.
// Excludes ambiguous characters (0/O, 1/l/I) so it can be read aloud or copied
// without confusion. Used for Super-Admin-provisioned org admins, whose first
// login forces a password change anyway.

const crypto = require('crypto')

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGITS = '23456789'
const SYMBOLS = '@#$%*?'
const ALL = UPPER + LOWER + DIGITS + SYMBOLS

const pick = (set) => set[crypto.randomInt(set.length)]

const generatePassword = (length = 14) => {
  const len = Math.max(8, length)
  // Guarantee at least one of each class so it passes common strength checks.
  const out = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)]
  while (out.length < len) out.push(pick(ALL))
  // Fisher-Yates shuffle so the guaranteed chars aren't always up front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

module.exports = { generatePassword }
