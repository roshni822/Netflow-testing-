'use strict'
const bcrypt = require('bcryptjs')
const crypto = require('node:crypto')
const User = require('../database/model')('User')
User.hashPassword = password => bcrypt.hash(password, 12)
User.beforeSave = async record => {
  if (record.isModified('password')) record.password = await User.hashPassword(record.password)
}
User.prototype.comparePassword = async function (candidatePassword) {
  // The candidate comes straight off a request body, so it can be an object
  // ({ $ne: '' } from an injection probe) — bcrypt throws on anything that is
  // not a string, which would turn a failed login into a 500.
  if (typeof candidatePassword !== 'string' || !this.password) return false
  return bcrypt.compare(candidatePassword, this.password)
}

// Generates a raw reset token (returned to caller for the email link) and
// stores only its SHA-256 hash + expiry on the document. Does not save.
User.prototype.createPasswordResetToken = function (ttlMinutes = 30) {
  const rawToken = crypto.randomBytes(32).toString('hex')
  this.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex')
  this.resetPasswordExpires = new Date(Date.now() + ttlMinutes * 60 * 1000)
  return rawToken
}

User.hashResetToken = function (rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex')
}

// True while the account is inside an active lock window.
User.prototype.isLocked = function () {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now())
}

// Generates `count` human-friendly one-time backup codes. Returns the raw
// codes (shown to the user once) and stores only their SHA-256 hashes.
User.prototype.generateBackupCodes = function (count = 8) {
  const raw = []
  const hashed = []
  for (let i = 0; i < count; i += 1) {
    // e.g. "3f9a-1c7b" — 8 hex chars split by a dash for readability.
    const code = crypto.randomBytes(4).toString('hex')
    const pretty = `${code.slice(0, 4)}-${code.slice(4)}`
    raw.push(pretty)
    hashed.push(crypto.createHash('sha256').update(pretty).digest('hex'))
  }
  this.mfaBackupCodes = hashed
  return raw
}

// Consumes a backup code if it matches an unused one. Mutates the stored
// list (removing the used code). Caller must save(). Returns true on match.
User.prototype.consumeBackupCode = function (candidate) {
  if (!Array.isArray(this.mfaBackupCodes) || !this.mfaBackupCodes.length) return false
  const normalized = String(candidate || '').trim().toLowerCase().replace(/\s+/g, '')
  const hash = crypto.createHash('sha256').update(normalized).digest('hex')
  const idx = this.mfaBackupCodes.indexOf(hash)
  if (idx === -1) return false
  this.mfaBackupCodes.splice(idx, 1)
  return true
}


User.serialize = value => {
  for (const field of ['password', 'resetPasswordToken', 'resetPasswordExpires', 'mfaSecret', 'mfaBackupCodes', 'failedLoginAttempts', 'lockUntil']) delete value[field]
  return value
}
module.exports = User
