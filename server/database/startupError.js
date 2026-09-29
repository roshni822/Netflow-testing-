'use strict'

// Use fixed diagnostics: driver messages can contain credentials or row values.
const hints = {
  DATABASE_ROLE_UNSAFE: 'DATABASE_URL uses administrative privileges, ownership, SUPERUSER or BYPASSRLS. Configure a separate restricted LOGIN with membership in netflow_app; keep the administrator connection in SETUP_DATABASE_URL. See database/README.md.',
  DATABASE_LAYOUT_INVALID: 'DATABASE_LAYOUT must be shared or organization-schemas. Use the layout matching the initialized database; see database/fresh/README.md.',
  FRESH_SCHEMA_MISMATCH: 'The fresh database version or checksum does not match this release. Check the selected database and use a reviewed migration; do not overwrite the version records.',
  FRESH_TABLE_MANIFEST_MISMATCH: 'The platform/system table inventory does not match the fresh baseline. Check database/fresh/README.md before changing any tables.',
  PLATFORM_BOOTSTRAP_REQUIRED: 'Initialize the new platform administrator with the guarded db:fresh bootstrap command. See database/fresh/README.md.',
  '42P01': 'Required database tables are missing. Complete the schema setup described in database/README.md.',
  '3F000': 'Required database schemas are missing. Complete the schema setup described in database/README.md.',
  '42501': 'The runtime login lacks database permissions. Provision netflow_app and grant the runtime login membership as described in database/README.md.',
  '28P01': 'Database authentication failed. Check the runtime username and password in DATABASE_URL.',
  ECONNREFUSED: 'The database refused the connection. Check the database host, port, and service availability.',
  ENOTFOUND: 'The database hostname could not be resolved. Check DATABASE_URL and DNS connectivity.'
}

module.exports = function startupError (error) {
  return {
    code: error.code || 'DATABASE_STARTUP_FAILED',
    hint: hints[error.code] || 'Check server/.env and the PostgreSQL setup in database/README.md.'
  }
}
