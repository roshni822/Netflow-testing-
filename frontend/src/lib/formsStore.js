// M1 - Phase 2 - formsStore.js
// API-backed forms catalogue. Same hook surface as Phase 1.

import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../utils/api'
import { adaptForm } from '../utils/adapters'

let cache = []
let lastFetchedAt = 0
let inflight = null
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

const fetchAll = async () => {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const { forms } = await api.get('/api/forms')
      cache = (forms || []).map(adaptForm)
      lastFetchedAt = Date.now()
      emit()
      return cache
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export const formsStore = {
  subscribe(listener) {
    listeners.add(listener)
    if (Date.now() - lastFetchedAt > 30000) fetchAll().catch(() => {})
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return cache
  },
  async refresh() {
    return fetchAll()
  },
  async add(input) {
    const { form } = await api.post('/api/forms', {
      title: input.name || input.title,
      description: input.description,
      department: input.category || input.department,
      fields: input.fields || []
    })
    const adapted = adaptForm(form)
    cache = [adapted, ...cache]
    emit()
    return adapted
  },
  async publish(id) {
    const { form } = await api.post(`/api/forms/${id}/publish`)
    const adapted = adaptForm(form)
    cache = cache.map((f) => (f.id === id ? adapted : f))
    emit()
    return adapted
  },
  async update(id, input) {
    const { form } = await api.put(`/api/forms/${id}`, {
      title: input.name || input.title,
      description: input.description,
      department: input.category || input.department,
      fields: input.fields || []
    })
    const adapted = adaptForm(form)
    cache = cache.map((f) => (f.id === id ? adapted : f))
    emit()
    return adapted
  },
  async remove(id) {
    await api.delete(`/api/forms/${id}`)
    cache = cache.filter((f) => f.id !== id)
    emit()
  },
  async togglePublished(id) {
    const target = cache.find((f) => f.id === id)
    if (!target) return
    if (target.status === 'Published') {
      // Unpublish = archive (keeps the form). Delete is a separate hard-delete.
      await api.post(`/api/forms/${id}/archive`)
      cache = cache.map((f) => (f.id === id ? { ...f, status: 'Archived' } : f))
    } else {
      const { form } = await api.post(`/api/forms/${id}/publish`)
      cache = cache.map((f) => (f.id === id ? adaptForm(form) : f))
    }
    emit()
  },
  async submit(id, formData, extraction = null) {
    return api.post(`/api/forms/${id}/submit`, { formData, ...(extraction ? { extraction } : {}) })
  },
  async getDraft(id) {
    return api.get(`/api/forms/${id}/draft`)
  },
  async saveDraft(id, formData) {
    return api.put(`/api/forms/${id}/draft`, { formData })
  },
  async discardDraft(id) {
    return api.delete(`/api/forms/${id}/draft`)
  },
  async previewApprovalRoute(id, formData = {}) {
    return api.post(`/api/forms/${id}/approval-preview`, { formData })
  },
  async setPublic(id, enabled) {
    const { form } = await api.post(`/api/forms/${id}/public`, { enabled })
    const adapted = adaptForm(form)
    cache = cache.map((f) => (f.id === id ? adapted : f))
    emit()
    return adapted
  },
  async responses(id) {
    return api.get(`/api/forms/${id}/responses`)
  },
  clear() {
    cache = []
    lastFetchedAt = 0
    emit()
  }
}

// `enabled` is false in the platform shell, where tenant APIs are forbidden —
// subscribing there would fire a request that always 403s.
export function useForms(enabled = true) {
  const snapshot = useSyncExternalStore(
    enabled ? formsStore.subscribe : noopSubscribe,
    enabled ? formsStore.getSnapshot : getEmpty,
    enabled ? formsStore.getSnapshot : getEmpty
  )
  useEffect(() => {
    if (!enabled) return
    if (cache.length === 0 && Date.now() - lastFetchedAt > 5000) {
      fetchAll().catch(() => {})
    }
  }, [enabled])
  return snapshot
}

const EMPTY = []
const getEmpty = () => EMPTY
const noopSubscribe = () => () => {}

// Category is an organisational label only — it does NOT restrict who can see
// or submit a form, nor does it affect approval routing (that uses each
// submitter's own manager/HR). "Company-wide" is the default for forms everyone
// uses (e.g. Leave Request); the rest just tag the owning team.
export const FORM_CATEGORIES = ['Company-wide', 'HR', 'Finance', 'IT', 'Operations', 'Sales', 'Legal']
