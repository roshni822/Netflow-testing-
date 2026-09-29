// Rate limiting for sensitive endpoints. Uses Redis when REDIS_URL is set
// (multi-instance cloud); otherwise express-rate-limit's default memory store.

const rateLimit = require('express-rate-limit')
const { ipKeyGenerator } = rateLimit
const { RedisStore } = require('rate-limit-redis')
const { getRedis } = require('../utils/redis')

const skipWhenDisabled = () => process.env.DISABLE_RATE_LIMIT === '1'

const redisStore = (prefix) => {
  const redis = getRedis()
  if (!redis) return undefined
  // ioredis buffers commands until connected, so we can attach before 'ready'.
  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix
  })
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  max: 5,
  skip: skipWhenDisabled,
  skipSuccessfulRequests: true,
  store: redisStore('nf:rl:auth:'),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many attempts. Please wait a few minutes and try again.',
      code: 'RATE_LIMITED'
    })
  }
})

const hooksLimiter = rateLimit({
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  max: 60,
  skip: skipWhenDisabled,
  store: redisStore('nf:rl:hooks:'),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many webhook requests. Please slow down.',
      code: 'RATE_LIMITED'
    })
  }
})

const platformIntegrationLimiter = rateLimit({
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  limit: Number(process.env.PLATFORM_INTEGRATION_TEST_RATE_LIMIT || 10),
  skip: skipWhenDisabled,
  store: redisStore('nf:rl:platform-integration:'),
  keyGenerator: (req) => req.user?._id
    ? `user:${String(req.user._id)}`
    : ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many connection tests. Please wait a minute and try again.',
      code: 'RATE_LIMITED'
    })
  }
})

module.exports = { authLimiter, hooksLimiter, platformIntegrationLimiter }
