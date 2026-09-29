'use strict'
const assert = require('node:assert/strict')
const { newId } = require('../../database/ids')
const User = require('../../models/User')
const Form = require('../../models/Form')
const Organization = require('../../models/Organization')

async function modelContractChecks () {
  const user = new User({ name: '  Test Account  ', email: '  PERSON@QA.TEST ', password: 'isolated-validation-only', department: 'IT', role: newId() })
  await user.validate()
  assert.equal(user.name, 'Test Account')
  assert.equal(user.email, 'person@qa.test')
  const reset = user.createPasswordResetToken()
  assert.equal(user.resetPasswordToken, User.hashResetToken(reset))
  assert.ok(user.resetPasswordExpires > new Date())
  const codes = user.generateBackupCodes()
  assert.equal(user.mfaBackupCodes.length, 8)
  assert.ok(!user.mfaBackupCodes.includes(codes[0]), 'Only hashes are stored')
  assert.equal(user.consumeBackupCode(codes[0].toUpperCase()), true)
  assert.equal(user.consumeBackupCode(codes[0]), false)
  user.lockUntil = new Date(Date.now() + 60000)
  assert.equal(user.isLocked(), true)
  user.lockUntil = new Date(Date.now() - 1000)
  assert.equal(user.isLocked(), false)
  for (const field of ['password', 'resetPasswordToken', 'resetPasswordExpires', 'mfaSecret', 'mfaBackupCodes', 'failedLoginAttempts', 'lockUntil']) assert.equal(user.toJSON()[field], undefined)

  const form = new Form({ title: 'Nested validation', createdBy: newId(), fields: [{ id: 'name', type: 'text', label: 'Name' }] })
  await form.validate()
  assert.match(form.fields[0]._id, /^[a-f0-9]{24}$/)
  assert.equal(form.fields[0].required, false)
  form.fields[0].type = 'unsupported'
  await assert.rejects(form.validate(), error => error.name === 'ValidationError' && !!error.errors['fields.0.type'])
  form.fields[0].type = 'text'
  delete form.fields[0].label
  await assert.rejects(form.validate(), error => error.name === 'ValidationError' && !!error.errors['fields.0.label'])
  const org = new Organization({ name: 'Isolated validation', subdomain: 'isolated-validation' })
  const bounded = Object.entries(Organization.definition.fields).find(([, field]) => field.min !== undefined && field.max !== undefined)
  assert.ok(bounded, 'Organization declares billing bounds')
  for (const value of [bounded[1].min - 1, bounded[1].max + 1]) {
    org.set(bounded[0], value)
    await assert.rejects(org.validate(), error => error.name === 'ValidationError' && !!error.errors[bounded[0]])
  }
  console.log('PASS: nested model validation, defaults, password-reset hashes, account locks and one-use MFA backup codes without Mongoose')
}
module.exports = { modelContractChecks }
