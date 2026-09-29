'use strict'
// PostgreSQL is the only persistence provider; JSON Schema supplies validation.
module.exports = async function connectDB () {
  if (process.env.DATABASE_PROVIDER && process.env.DATABASE_PROVIDER !== 'postgres') {
    throw new Error('Only PostgreSQL is supported. Configure DATABASE_URL for the fresh database.')
  }
  await require('../database/postgres').connect()
  console.log('PostgreSQL connected')
}
