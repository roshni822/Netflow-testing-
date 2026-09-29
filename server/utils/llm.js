// AI - utils/llm.js
// Provider-aware LLM client with configured-primary failover. Call sites use a
// stable interface, so providers and models can change through environment
// variables without changing business logic. API keys are never hard-coded.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1'
const GROQ_BASE = 'https://api.groq.com/openai/v1'
const OPENAI_BASE = 'https://api.openai.com/v1'

// Canonical automatic failover priority. An explicit LLM_PROVIDER is tried
// first when its key is configured.
const PROVIDER_FALLBACK_ORDER = ['openai', 'anthropic', 'groq', 'gemini', 'nvidia']

const normalizeProvider = (value) => {
  const provider = String(value || '').trim().toLowerCase()
  return PROVIDER_FALLBACK_ORDER.includes(provider) ? provider : null
}

const getApiKeyForProvider = (provider) => {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || ''
  if (provider === 'nvidia') return process.env.NVIDIA_API_KEY || ''
  if (provider === 'groq') return process.env.GROQ_API_KEY || ''
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || ''
  if (provider === 'openai') return process.env.OPENAI_API_KEY || ''
  return ''
}

const getModelForProvider = (provider) => {
  if (provider === 'anthropic') return process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'
  if (provider === 'nvidia') return process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-nano-30b-a3b'
  if (provider === 'groq') return process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
  if (provider === 'openai') return process.env.OPENAI_MODEL || 'gpt-5.6-luna'
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
}

const getConfiguredProviders = () => {
  const configured = PROVIDER_FALLBACK_ORDER.filter((provider) => Boolean(getApiKeyForProvider(provider)))
  const preferred = normalizeProvider(process.env.LLM_PROVIDER)
  if (!preferred || !configured.includes(preferred)) return configured
  return [preferred, ...configured.filter((provider) => provider !== preferred)]
}

const getProvider = () => {
  const configured = getConfiguredProviders()
  if (configured.length) return configured[0]
  return normalizeProvider(process.env.LLM_PROVIDER) || 'gemini'
}

const getModel = () => getModelForProvider(getProvider())
const isConfigured = () => getConfiguredProviders().length > 0

const outputTruncated = () => {
  const error = new Error('LLM output reached the configured token limit')
  error.code = 'LLM_OUTPUT_TRUNCATED'
  return error
}

// Fetch JSON with a hard timeout. Provider response bodies remain inside this
// module and are never included in aggregate errors returned to callers.
const httpJson = async (url, options, timeoutMs = 20000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let json
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text }
    }
    if (!response.ok) {
      const error = new Error(json?.error?.message || json?.detail || json?.title || ('LLM HTTP ' + response.status))
      error.status = response.status
      error.providerErrorStatus = String(json?.error?.status || '')
      const details = Array.isArray(json?.error?.details) ? json.error.details : []
      error.quotaViolations = details
        .flatMap((detail) => Array.isArray(detail?.violations) ? detail.violations : [])
        .map((violation) => ({
          quotaMetric: String(violation?.quotaMetric || ''),
          quotaId: String(violation?.quotaId || '')
        }))
      throw error
    }
    return json
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('LLM request timed out after ' + timeoutMs + 'ms')
      timeoutError.status = 504
      timeoutError.code = 'LLM_TIMEOUT'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// ---- provider calls: each returns raw assistant text ----
const callGemini = async ({ prompt, system, temperature, json, timeoutMs, maxTokens }) => {
  const key = getApiKeyForProvider('gemini')
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      ...(json ? { responseMimeType: 'application/json' } : {})
    }
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const model = getModelForProvider('gemini')
  const url = GEMINI_BASE + '/models/' + model + ':generateContent?key=' + encodeURIComponent(key)
  const out = await httpJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, timeoutMs)
  const candidate = out?.candidates?.[0]
  if (candidate?.finishReason === 'MAX_TOKENS') throw outputTruncated()
  const parts = candidate?.content?.parts || []
  return parts.map((part) => part.text || '').join('').trim()
}

const callNvidia = async ({ prompt, system, temperature, json, timeoutMs, maxTokens }) => {
  const key = getApiKeyForProvider('nvidia')
  if (!key) throw new Error('NVIDIA_API_KEY is not set')
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const body = {
    model: getModelForProvider('nvidia'),
    messages,
    temperature,
    max_tokens: maxTokens || 2048
  }
  if (json) body.response_format = { type: 'json_object' }

  // Hosted NIM endpoints can cold-start and return transient 429/5xx errors.
  const attempts = 3
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const out = await httpJson(NVIDIA_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body)
      }, timeoutMs)
      return (out?.choices?.[0]?.message?.content || '').trim()
    } catch (error) {
      lastError = error
      const transient = !error.status || [429, 500, 502, 503, 504].includes(error.status)
      if (!transient || attempt === attempts - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  throw lastError
}

const callAnthropic = async ({ prompt, system, timeoutMs, maxTokens }) => {
  const key = getApiKeyForProvider('anthropic')
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
  const body = {
    model: getModelForProvider('anthropic'),
    max_tokens: maxTokens || 2048,
    messages: [{ role: 'user', content: prompt }]
  }
  if (system) body.system = system

  const out = await httpJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }, timeoutMs)
  const parts = out?.content || []
  return parts.filter((part) => part.type === 'text').map((part) => part.text || '').join('').trim()
}

const callGroq = async ({ prompt, system, temperature, json, timeoutMs, maxTokens }) => {
  const key = getApiKeyForProvider('groq')
  if (!key) throw new Error('GROQ_API_KEY is not set')
  const model = getModelForProvider('groq')
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const body = {
    model,
    messages,
    temperature,
    max_completion_tokens: maxTokens || 4096
  }
  if (model.startsWith('openai/gpt-oss-')) {
    body.reasoning_effort = 'medium'
    body.include_reasoning = true
  }
  if (json) body.response_format = { type: 'json_object' }

  const out = await httpJson(GROQ_BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body)
  }, timeoutMs)
  const choice = out?.choices?.[0]
  if (choice?.finish_reason === 'length') throw outputTruncated()
  return (choice?.message?.content || '').trim()
}

const callOpenAI = async ({ prompt, system, timeoutMs, maxTokens }) => {
  const key = getApiKeyForProvider('openai')
  if (!key) throw new Error('OPENAI_API_KEY is not set')
  const body = {
    model: getModelForProvider('openai'),
    input: prompt,
    store: false,
    ...(system ? { instructions: system } : {}),
    ...(maxTokens ? { max_output_tokens: maxTokens } : {})
  }
  const out = await httpJson(OPENAI_BASE + '/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body)
  }, timeoutMs)
  if (typeof out?.output_text === 'string') return out.output_text.trim()
  const output = Array.isArray(out?.output) ? out.output : []
  return output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === 'output_text' || item?.type === 'text')
    .map((item) => item?.text || '')
    .join('')
    .trim()
}

const PROVIDER_CALLS = {
  anthropic: callAnthropic,
  nvidia: callNvidia,
  groq: callGroq,
  gemini: callGemini,
  openai: callOpenAI
}

const failureCode = (error) => {
  if (error?.code === 'LLM_OUTPUT_TRUNCATED') return 'OUTPUT_TRUNCATED'
  if (error?.code === 'LLM_INVALID_RESPONSE') return 'INVALID_RESPONSE'
  if (error?.code === 'LLM_TIMEOUT' || error?.status === 408 || error?.status === 504) return 'TIMEOUT'
  if (error?.status === 401 || error?.status === 403) return 'AUTHENTICATION_FAILED'
  if (error?.status === 404 || error?.status === 410) return 'MODEL_UNAVAILABLE'
  if (
    error?.status === 429 &&
    Array.isArray(error?.quotaViolations) &&
    error.quotaViolations.some((violation) =>
      /perday|requestsperday/i.test(violation.quotaId + ' ' + violation.quotaMetric)
    )
  ) return 'QUOTA_EXHAUSTED'
  if (error?.status === 429) return 'RATE_LIMITED'
  if (Number(error?.status) >= 500) return 'PROVIDER_UNAVAILABLE'
  if (Number(error?.status) >= 400) return 'REQUEST_REJECTED'
  return 'NETWORK_ERROR'
}

const invalidResponse = (message) => {
  const error = new Error(message)
  error.code = 'LLM_INVALID_RESPONSE'
  return error
}

const callWithFailover = async (args, transform) => {
  const providers = getConfiguredProviders()
  if (!providers.length) {
    const error = new Error('No LLM provider is configured')
    error.code = 'LLM_NOT_CONFIGURED'
    throw error
  }

  const failures = []
  for (const provider of providers) {
    try {
      const raw = await PROVIDER_CALLS[provider](args)
      if (!raw) throw invalidResponse('LLM returned an empty response')
      return transform ? transform(raw) : raw
    } catch (error) {
      failures.push({ provider, code: failureCode(error) })
    }
  }

  const summary = failures.map(({ provider, code }) => provider + ': ' + code).join(', ')
  const error = new Error('All configured LLM providers failed (' + summary + ')')
  error.code = 'LLM_ALL_PROVIDERS_FAILED'
  error.failures = failures
  throw error
}

const listModels = async () => {
  const provider = getProvider()
  const key = getApiKeyForProvider(provider)
  if (!key) throw new Error('No API key is configured for ' + provider)

  if (provider === 'anthropic') {
    const model = getModelForProvider(provider)
    return [{ name: model, displayName: model, methods: ['chat'] }]
  }
  if (provider === 'nvidia') {
    const out = await httpJson(NVIDIA_BASE + '/models', {
      headers: { Authorization: 'Bearer ' + key }
    }, 15000)
    return (out.data || []).map((model) => ({ name: model.id, displayName: model.id, methods: ['chat'] }))
  }
  if (provider === 'groq') {
    const out = await httpJson(GROQ_BASE + '/models', {
      headers: { Authorization: 'Bearer ' + key }
    }, 15000)
    return (out.data || []).map((model) => ({ name: model.id, displayName: model.id, methods: ['chat'] }))
  }
  if (provider === 'openai') {
    const out = await httpJson(OPENAI_BASE + '/models', {
      headers: { Authorization: 'Bearer ' + key }
    }, 15000)
    return (out.data || []).map((model) => ({ name: model.id, displayName: model.id, methods: ['responses'] }))
  }
  const out = await httpJson(GEMINI_BASE + '/models?key=' + encodeURIComponent(key), {}, 15000)
  return (out.models || []).map((model) => ({
    name: model.name,
    displayName: model.displayName,
    methods: model.supportedGenerationMethods || []
  }))
}

const generateText = async (prompt, { system, temperature = 0.2, timeoutMs, maxTokens } = {}) =>
  callWithFailover({ prompt, system, temperature, json: false, timeoutMs, maxTokens })

// Handles clean JSON, fenced JSON, and prose-wrapped JSON from every provider.
const parseJsonLoose = (raw) => {
  if (!raw) throw invalidResponse('LLM returned an empty response')
  const stripped = raw.replace(/^\x60{3}(?:json)?/i, '').replace(/\x60{3}$/i, '').trim()
  try {
    return JSON.parse(stripped)
  } catch {
    // Fall through to substring extraction.
  }
  const start = stripped.search(/[[{]/)
  const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'))
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(stripped.slice(start, end + 1))
    } catch {
      // Convert parsing details into a provider-neutral safe error.
    }
  }
  throw invalidResponse('LLM did not return valid JSON')
}

const generateJSON = async (prompt, { system, temperature = 0.1, timeoutMs, maxTokens } = {}) =>
  callWithFailover(
    { prompt, system, temperature, json: true, timeoutMs, maxTokens },
    parseJsonLoose
  )

module.exports = { isConfigured, getModel, listModels, generateText, generateJSON }
