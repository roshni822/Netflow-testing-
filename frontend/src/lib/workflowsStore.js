// M2 - Phase 2 - workflowsStore.js
// API-backed workflows catalogue. Same hook surface as Phase 1.

import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../utils/api'
import { adaptWorkflow } from '../utils/adapters'

let cache = []
let lastFetchedAt = 0
let inflight = null
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

const fetchAll = async () => {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const { workflows } = await api.get('/api/workflows')
      cache = (workflows || []).map(adaptWorkflow)
      lastFetchedAt = Date.now()
      emit()
      return cache
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export const workflowsStore = {
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
    const { workflow } = await api.post('/api/workflows', {
      title: input.name || input.title,
      description: input.description,
      department: input.category || input.department,
      tags: input.tags || [],
      linkedFormId: input.linkedFormId,
      linkedFormIds: input.linkedFormIds,
      access: input.access,
      triggerOn: input.triggerOn,
      preventDuplicates: input.preventDuplicates,
      notifyOnSlaBreach: input.notifyOnSlaBreach,
      inboundWebhook: input.inboundWebhook,
      advanced: input.advanced,
      nodes: input.nodes || [],
      edges: input.edges || []
    })
    const adapted = adaptWorkflow(workflow)
    cache = [adapted, ...cache]
    emit()
    return adapted
  },
  async toggleStatus(id) {
    const target = cache.find((w) => w.id === id)
    if (!target) return
    if (target.status === 'Active') {
      const { workflow } = await api.post(`/api/workflows/${id}/pause`)
      cache = cache.map((w) => (w.id === id ? adaptWorkflow(workflow) : w))
    } else {
      const { workflow } = await api.post(`/api/workflows/${id}/publish`)
      cache = cache.map((w) => (w.id === id ? adaptWorkflow(workflow) : w))
    }
    emit()
  },
  async publish(id) {
    const { workflow } = await api.post(`/api/workflows/${id}/publish`)
    const adapted = adaptWorkflow(workflow)
    cache = cache.map((w) => (w.id === id ? adapted : w))
    emit()
    return adapted
  },
  async pause(id) {
    const { workflow } = await api.post(`/api/workflows/${id}/pause`)
    cache = cache.map((w) => (w.id === id ? adaptWorkflow(workflow) : w))
    emit()
  },
  async update(id, input) {
    const { workflow } = await api.put(`/api/workflows/${id}`, {
      title: input.name || input.title,
      description: input.description,
      department: input.category || input.department,
      tags: input.tags || [],
      linkedFormId: input.linkedFormId,
      linkedFormIds: input.linkedFormIds,
      access: input.access,
      triggerOn: input.triggerOn,
      preventDuplicates: input.preventDuplicates,
      notifyOnSlaBreach: input.notifyOnSlaBreach,
      inboundWebhook: input.inboundWebhook,
      advanced: input.advanced,
      nodes: input.nodes || [],
      edges: input.edges || []
    })
    const adapted = adaptWorkflow(workflow)
    cache = cache.map((w) => (w.id === id ? adapted : w))
    emit()
    return adapted
  },
  // Hard delete — removes the workflow and its runs/tasks from the DB.
  async remove(id) {
    await api.delete(`/api/workflows/${id}`)
    cache = cache.filter((w) => w.id !== id)
    emit()
  },
  clear() {
    cache = []
    lastFetchedAt = 0
    emit()
  }
}

// `enabled` is false in the platform shell, where tenant APIs are forbidden —
// subscribing there would fire a request that always 403s.
export function useWorkflows(enabled = true) {
  const snapshot = useSyncExternalStore(
    enabled ? workflowsStore.subscribe : noopSubscribe,
    enabled ? workflowsStore.getSnapshot : getEmpty,
    enabled ? workflowsStore.getSnapshot : getEmpty
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

// A workflow's category is the department that owns it, so the list comes from
// lib/departmentsStore (per tenant) rather than a constant kept here.
