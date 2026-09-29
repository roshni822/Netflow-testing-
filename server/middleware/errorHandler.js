// Shared - Phase 2 - middleware/errorHandler.js
// Always the last middleware in the stack. Normalises every thrown error
// into the project-wide { success: false, error, code } shape.

const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const sqlError = /^[0-9A-Z]{5}$/.test(String(err.code || ''))
  if (sqlError) console.error('Database request failed', { code: err.code })
  else console.error(err.stack || err)

  let statusCode = err.statusCode || 500
  let message = sqlError ? 'Database request failed' : err.message || 'Server error'
  let code = err.code || 'SERVER_ERROR'

  // Record identifier / type errors
  if (err.name === 'CastError') {
    statusCode = 400
    message = `Invalid ${err.path}: ${err.value}`
    code = 'INVALID_ID'
  }

  // JSON Schema validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400
    message = err.errors ? Object.values(err.errors).map(e => e.message).join(', ') : err.message
    code = 'VALIDATION_ERROR'
  }

  // Unique constraint conflict (e.g. duplicate email)
  if (err.code === 11000) {
    statusCode = 400
    const field = Object.keys(err.keyValue || {})[0] || 'field'
    message = `Duplicate value for '${field}'`
    code = 'DUPLICATE_KEY'
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    code,
    ...(process.env.NODE_ENV === 'development' && !sqlError && { stack: err.stack })
  })
}

module.exports = errorHandler
