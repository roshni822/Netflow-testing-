const assert = require('node:assert/strict')
const {
  isConfigured,
  getModel,
  generateText,
  generateJSON
} = require('../utils/llm')

const ENV_KEYS = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_MODEL',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL'
]

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body)
})

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  const originalFetch = global.fetch
  try {
    for (const key of ENV_KEYS) delete process.env[key]
    for (const [key, value] of Object.entries(values)) process.env[key] = value
    await run()
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    global.fetch = originalFetch
  }
}

async function main() {
  await withEnvironment({}, async () => {
    assert.equal(isConfigured(), false)
    await assert.rejects(
      generateText('test'),
      (error) => error.code === 'LLM_NOT_CONFIGURED'
    )
  })

  await withEnvironment({
    LLM_PROVIDER: 'groq',
    GROQ_API_KEY: 'groq-test-key',
    GROQ_MODEL: 'openai/gpt-oss-120b',
    ANTHROPIC_API_KEY: 'anthropic-test-key'
  }, async () => {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) })
      return response(200, { choices: [{ message: { content: JSON.stringify({ fields: [] }) } }] })
    }

    assert.equal(isConfigured(), true)
    assert.equal(getModel(), 'openai/gpt-oss-120b')
    assert.deepEqual(await generateJSON('return JSON', { maxTokens: 8192 }), { fields: [] })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(calls[0].body.max_completion_tokens, 8192)
    assert.equal(calls[0].body.reasoning_effort, 'medium')
    assert.equal(calls[0].body.include_reasoning, true)
    assert.deepEqual(calls[0].body.response_format, { type: 'json_object' })
  })

  await withEnvironment({
    LLM_PROVIDER: 'groq',
    GROQ_API_KEY: 'groq-test-key',
    GROQ_MODEL: 'openai/gpt-oss-120b'
  }, async () => {
    global.fetch = async () => response(200, {
      choices: [{
        finish_reason: 'length',
        message: { content: '{fields:[' }
      }]
    })

    await assert.rejects(generateJSON('return JSON'), (error) => {
      assert.deepEqual(error.failures, [
        { provider: 'groq', code: 'OUTPUT_TRUNCATED' }
      ])
      return true
    })
  })

  await withEnvironment({
    LLM_PROVIDER: 'groq',
    GROQ_API_KEY: 'groq-test-key',
    ANTHROPIC_API_KEY: 'anthropic-test-key',
    ANTHROPIC_MODEL: 'anthropic-fallback-model'
  }, async () => {
    const calls = []
    global.fetch = async (url) => {
      calls.push(String(url))
      if (String(url).includes('groq.com')) {
        return response(503, { error: { message: 'temporary Groq outage' } })
      }
      return response(200, { content: [{ type: 'text', text: 'anthropic fallback' }] })
    }

    assert.equal(await generateText('hello'), 'anthropic fallback')
    assert.deepEqual(calls, [
      'https://api.groq.com/openai/v1/chat/completions',
      'https://api.anthropic.com/v1/messages'
    ])
  })

  await withEnvironment({
    LLM_PROVIDER: 'openai',
    OPENAI_API_KEY: 'openai-test-key',
    OPENAI_MODEL: 'openai-test-model',
    GEMINI_API_KEY: 'gemini-test-key'
  }, async () => {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) })
      return response(200, {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'openai primary' }] }]
      })
    }

    assert.equal(isConfigured(), true)
    assert.equal(getModel(), 'openai-test-model')
    assert.equal(await generateText('hello', { system: 'be concise' }), 'openai primary')
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /api\.openai\.com\/v1\/responses$/)
    assert.equal(calls[0].body.store, false)
    assert.equal(calls[0].body.instructions, 'be concise')
  })

  await withEnvironment({
    LLM_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: 'anthropic-test-key',
    ANTHROPIC_MODEL: 'claude-sonnet-5'
  }, async () => {
    let requestBody
    global.fetch = async (url, options) => {
      assert.match(String(url), /api\.anthropic\.com\/v1\/messages$/)
      requestBody = JSON.parse(options.body)
      return response(200, { content: [{ type: 'text', text: 'anthropic ready' }] })
    }

    assert.equal(await generateText('hello', { temperature: 0.2 }), 'anthropic ready')
    assert.equal(requestBody.model, 'claude-sonnet-5')
    assert.equal(Object.hasOwn(requestBody, 'temperature'), false)
  })

  await withEnvironment({
    LLM_PROVIDER: 'nvidia',
    NVIDIA_API_KEY: 'nvidia-test-key',
    NVIDIA_MODEL: 'retired-test-model',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: 'gemini-test-model'
  }, async () => {
    const calls = []
    global.fetch = async (url) => {
      calls.push(String(url))
      if (String(url).includes('nvidia.com')) {
        return response(200, { choices: [{ message: { content: 'not valid json' } }] })
      }
      return response(200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ mappings: [] }) }] } }]
      })
    }

    assert.deepEqual(await generateJSON('return JSON'), { mappings: [] })
    assert.equal(calls.length, 2)
    assert.match(calls[0], /nvidia\.com/)
    assert.match(calls[1], /googleapis\.com/)
  })

  await withEnvironment({
    LLM_PROVIDER: 'nvidia',
    NVIDIA_API_KEY: 'nvidia-test-key',
    NVIDIA_MODEL: 'retired-test-model',
    OPENAI_API_KEY: 'openai-test-key'
  }, async () => {
    const calls = []
    global.fetch = async (url) => {
      calls.push(String(url))
      if (String(url).includes('nvidia.com')) {
        return response(410, { error: { message: 'retired provider detail' } })
      }
      return response(200, {
        output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ok: true }) }] }]
      })
    }

    assert.deepEqual(await generateJSON('return JSON'), { ok: true })
    assert.equal(calls.length, 2)
    assert.match(calls[0], /nvidia\.com/)
    assert.match(calls[1], /api\.openai\.com/)
  })

  await withEnvironment({
    LLM_PROVIDER: 'nvidia',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: 'available-gemini-model'
  }, async () => {
    const calls = []
    global.fetch = async (url) => {
      calls.push(String(url))
      return response(200, {
        candidates: [{ content: { parts: [{ text: 'fallback configured' }] } }]
      })
    }

    assert.equal(isConfigured(), true)
    assert.equal(getModel(), 'available-gemini-model')
    assert.equal(await generateText('hello'), 'fallback configured')
    assert.equal(calls.length, 1)
    assert.match(calls[0], /googleapis\.com/)
  })

  await withEnvironment({
    LLM_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: 'gemini-test-model'
  }, async () => {
    global.fetch = async () => response(200, {
      candidates: [{
        finishReason: 'MAX_TOKENS',
        content: { parts: [{ text: '{fields:[' }] }
      }]
    })

    await assert.rejects(generateJSON('return JSON', { maxTokens: 3500 }), (error) => {
      assert.equal(error.code, 'LLM_ALL_PROVIDERS_FAILED')
      assert.deepEqual(error.failures, [
        { provider: 'gemini', code: 'OUTPUT_TRUNCATED' }
      ])
      assert.doesNotMatch(error.message, /fields|max.tokens/i)
      return true
    })
  })

  await withEnvironment({
    LLM_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: 'gemini-test-model'
  }, async () => {
    global.fetch = async () => response(429, {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'provider detail must remain private',
        details: [{
          violations: [{
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
          }]
        }]
      }
    })

    await assert.rejects(generateJSON('return JSON'), (error) => {
      assert.equal(error.code, 'LLM_ALL_PROVIDERS_FAILED')
      assert.deepEqual(error.failures, [
        { provider: 'gemini', code: 'QUOTA_EXHAUSTED' }
      ])
      assert.doesNotMatch(error.message, /provider detail|quotaMetric|FreeTier/i)
      return true
    })
  })

  await withEnvironment({
    LLM_PROVIDER: 'nvidia',
    NVIDIA_API_KEY: 'nvidia-secret-value',
    OPENAI_API_KEY: 'openai-secret-value'
  }, async () => {
    global.fetch = async (url) => {
      if (String(url).includes('nvidia.com')) {
        return response(410, { error: { message: 'sensitive retired-model response' } })
      }
      return response(401, { error: { message: 'sensitive authentication response' } })
    }

    await assert.rejects(generateJSON('return JSON'), (error) => {
      assert.equal(error.code, 'LLM_ALL_PROVIDERS_FAILED')
      assert.deepEqual(error.failures, [
        { provider: 'nvidia', code: 'MODEL_UNAVAILABLE' },
        { provider: 'openai', code: 'AUTHENTICATION_FAILED' }
      ])
      assert.doesNotMatch(error.message, /secret|sensitive|retired-model|authentication response/i)
      return true
    })
  })

  console.log('LLM failover tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
