// M3 - Phase 2 - utils/api.js
// Shared fetch wrapper. Injects the JWT, parses { success, error, code }
// envelopes, and on 401 clears the token + bounces to /login.

// Base URL of the NetFlow API. Defaults to the deployed Render backend so the
// production build (Vercel) works without a dashboard env var. Override with
// VITE_API_URL (e.g. http://localhost:5000) for local development.
const BASE = String(import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:5000')).trim()

// Exposed so components can turn a relative attachment URL ("/uploads/x.pdf")
// returned by the API into an absolute, openable link.
export const API_BASE = BASE
export const toAbsoluteUrl = (url) => {
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:')) return url
  return `${BASE}${url.startsWith('/') ? '' : '/'}${url}`
}

/**
 * Resolve a viewable href for an attachment. When `dmsDocId` is present, asks
 * NetFlow for a fresh signed URL (R2 TTL ~5 min). Falls back to stored url.
 */
export const resolveAttachmentHref = async (file, { mode = 'view' } = {}) => {
  if (!file) return ''
  const local = String(file.url || file.path || '').match(/\/api\/files\/([a-f\d]{24}\/[A-Za-z\d._-]+)(?:\?|$)/i)
  if (local && getToken()) {
    const result = await request('POST', `/api/files/${local[1]}/link`, {})
    return toAbsoluteUrl(result.url)
  }
  if (file.dmsDocId) {
    try {
      const q = mode === 'download' ? '?mode=download' : ''
      const res = await request('GET', `/api/uploads/${encodeURIComponent(file.dmsDocId)}/url${q}`)
      if (res?.url) return toAbsoluteUrl(res.url)
    } catch {
      /* fall through */
    }
  }
  return toAbsoluteUrl(file.url || '')
}

const TOKEN_KEY = 'flowsphere_token'
const USER_KEY = 'flowsphere_user'

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export const setToken = (token) => {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* noop */ }
}
export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch { /* noop */ }
}

export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
export const setStoredUser = (user) => {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)) } catch { /* noop */ }
}

export class ApiError extends Error {
  constructor(message, code, status, data) {
    super(message)
    this.code = code
    this.status = status
    this.data = data || {}
    this.name = 'ApiError'
  }
}

const request = async (method, endpoint, body, opts = {}) => {
  const token = getToken()
  const headers = { ...(opts.headers || {}) }
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const fetchOpts = { method, headers }
  if (body !== undefined) {
    fetchOpts.body = body instanceof FormData ? body : JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(`${BASE}${endpoint}`, fetchOpts)
  } catch  {
    throw new ApiError('Network error - is the API server running?', 'NETWORK', 0)
  }

  let data = {}
  const text = await response.text()
  if (text) {
    try { data = JSON.parse(text) } catch { data = { error: text } }
  }

  if (!response.ok) {
    const code = data.code || `HTTP_${response.status}`
    const message = data.error || `Request failed: ${response.status}`

    // Token expired / missing - kick to /login (unless we're already there)
    if (response.status === 401 && code !== 'INVALID_CREDENTIALS' && code !== 'DMS_UNAUTHORIZED' && !opts.skipAuthRedirect) {
      clearToken()
      if (typeof window !== 'undefined') {
        const p = window.location.pathname
        if (p !== '/login' && p !== '/register') {
          window.location.href = '/login'
        }
      }
    }
    throw new ApiError(message, code, response.status, data)
  }

  return data
}

// fetch() can't report upload progress, so multipart uploads go through XHR
// when the caller wants a percentage. `onProgress` receives 0-100, or null when
// the browser can't compute a total (chunked / unknown length).
export const uploadWithProgress = (endpoint, formData, { onProgress, headers = {}, signal } = {}) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abortUpload)
    const succeed = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abortUpload = () => xhr.abort()
    xhr.open('POST', `${BASE}${endpoint}`)
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)

    xhr.upload.onprogress = (e) => {
      if (!onProgress) return
      onProgress(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null)
    }
    xhr.onerror = () => fail(new ApiError('Network error - is the API server running?', 'NETWORK', 0))
    xhr.onabort = () => fail(new ApiError('Upload cancelled', 'ABORTED', 0))
    xhr.onload = () => {
      let data = {}
      if (xhr.responseText) {
        try { data = JSON.parse(xhr.responseText) } catch { data = { error: xhr.responseText } }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        succeed(data)
        return
      }
      fail(new ApiError(
        data.error || `Upload failed: ${xhr.status}`,
        data.code || `HTTP_${xhr.status}`,
        xhr.status,
        data
      ))
    }
    if (signal?.aborted) {
      fail(new ApiError('Upload cancelled', 'ABORTED', 0))
      return
    }
    signal?.addEventListener('abort', abortUpload, { once: true })
    xhr.send(formData)
  })

export const api = {
  get:    (e, opts)      => request('GET', e, undefined, opts),
  post:   (e, body, opts) => request('POST', e, body, opts),
  put:    (e, body, opts) => request('PUT', e, body, opts),
  patch:  (e, body, opts) => request('PATCH', e, body, opts),
  delete: (e, opts)      => request('DELETE', e, undefined, opts),
  // Multipart upload. Returns { file: { name, url, mime, size } }.
  // `maxMb` (optional) is forwarded so the server can enforce the field's
  // per-field size limit (capped server-side at the global ceiling).
  // Pass `onProgress` to get a 0-100 percentage while the bytes go up.
  upload: (file, maxMb, opts = {}) => {
    const fd = new FormData()
    fd.append('file', file)
    const q = maxMb ? `?maxMb=${encodeURIComponent(maxMb)}` : ''
    if (opts.onProgress) {
      return uploadWithProgress(`/api/uploads${q}`, fd, opts)
    }
    return request('POST', `/api/uploads${q}`, fd, opts)
  },
  
  // Scans a payload (object/array) for any pending files (objects with { pending: true, file: File })
  // and uploads them. Returns a deep clone of the payload with pending files replaced by uploaded metadata.
  uploadPendingFiles: async (payload) => {
    if (!payload || typeof payload !== 'object') return payload
    
    if (Array.isArray(payload)) {
      return Promise.all(payload.map(item => api.uploadPendingFiles(item)))
    }
    
    // If it's a pending file marker
    if (payload.pending && payload.file) {
      const { file: saved } = await api.upload(payload.file)
      // For signature pads, preserve the kind
      if (payload.kind) {
        return { ...saved, kind: payload.kind }
      }
      return saved
    }
    
    // Otherwise recurse through object properties
    const result = {}
    for (const [k, v] of Object.entries(payload)) {
      result[k] = await api.uploadPendingFiles(v)
    }
    return result
  }
}

export const buildQuery = (params = {}) => {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}
