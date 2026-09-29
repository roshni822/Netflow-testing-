// Optional Redis client for multi-instance rate limiting (cloud).
// When REDIS_URL is unset, callers fall back to in-memory stores.

const Redis = require('ioredis')

let client = null
let ready = false

const getRedis = () => {
  const url = String(process.env.REDIS_URL || '').trim()
  if (!url) return null
  if (client) return client

  client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: false
  })
  client.on('ready', () => {
    ready = true
    console.log('Redis connected (rate-limit store)')
  })
  client.on('error', (err) => {
    ready = false
    console.warn('Redis error:', err.message)
  })
  client.on('end', () => { ready = false })
  return client
}

const isRedisReady = () => Boolean(client && ready)

// Eager connect when configured so the first rate-limit hit is not cold.
if (String(process.env.REDIS_URL || '').trim()) {
  getRedis()
}

module.exports = { getRedis, isRedisReady }
