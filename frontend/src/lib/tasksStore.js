// M3 - Phase 2 - tasksStore.js
// API-backed task inbox. Same hook surface (useTasks, useTask, tasksStore.approve)
// as the Phase-1 mock store so existing pages keep working.

import { useEffect, useSyncExternalStore } from 'react'
import { api, buildQuery } from '../utils/api'
import { adaptTask } from '../utils/adapters'

let cache = []
let cacheById = new Map()
let lastFetchedAt = 0
let inflight = null
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

const indexCache = () => {
  cacheById = new Map(cache.map((t) => [t.id, t]))
}

const fetchMyTasks = async (params = {}) => {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const { tasks } = await api.get(`/api/tasks/my-tasks${buildQuery(params)}`)
      cache = (tasks || []).map(adaptTask).filter(Boolean)
      indexCache()
      lastFetchedAt = Date.now()
      emit()
      return cache
    } finally {
      inflight = null
    }
  })()
  return inflight
}

const fetchOne = async (id) => {
  const { task } = await api.get(`/api/tasks/${id}`)
  const adapted = adaptTask(task)
  if (adapted) {
    const idx = cache.findIndex((t) => t.id === adapted.id)
    if (idx >= 0) cache = cache.map((t, i) => (i === idx ? adapted : t))
    else cache = [adapted, ...cache]
    indexCache()
    emit()
  }
  return adapted
}

export const tasksStore = {
  subscribe(listener) {
    listeners.add(listener)
    if (Date.now() - lastFetchedAt > 30000) fetchMyTasks().catch(() => {})
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return cache
  },
  async refresh(params) {
    return fetchMyTasks(params)
  },
  async loadOne(id) {
    return fetchOne(id)
  },
  async approve(id, comment = '', signature = null) {
    await api.post(`/api/tasks/${id}/approve`, { comment, signature })
    return fetchOne(id)
  },
  async reject(id, comment = '', signature = null) {
    await api.post(`/api/tasks/${id}/reject`, { comment, signature })
    return fetchOne(id)
  },
  async requestChanges(id, comment = '', signature = null) {
    await api.post(`/api/tasks/${id}/request-changes`, { comment, signature })
    return fetchOne(id)
  },
  // Submit-node tasks: send uploaded attachments + an optional comment, which
  // advances the workflow. `attachments` is an array of { name, url, mime, size }.
  async submit(id, { comment = '', formData = {} } = {}) {
    await api.post(`/api/tasks/${id}/submit`, { comment, formData })
    return fetchOne(id)
  },
  // Review-node tasks: reviewer forwards (outcome 'forward') or sends back
  // (outcome 'changes', comment required). Advances the workflow accordingly.
  async review(id, outcome, comment = '') {
    await api.post(`/api/tasks/${id}/review`, { outcome, comment })
    return fetchOne(id)
  },
  // Submitter cancels their whole in-flight request (execution-level). Only
  // works when the workflow enabled advanced.allowCancel (enforced server-side).
  async cancel(executionId) {
    await api.post(`/api/workflows/executions/${executionId}/cancel`)
    return fetchMyTasks()
  },
  // Submitter permanently deletes one of their finished requests. Server removes
  // the whole execution (all stage tasks + form response + notifications).
  async deleteRequest(id) {
    await api.delete(`/api/tasks/${id}`)
    return fetchMyTasks()
  },
  clear() {
    cache = []
    cacheById = new Map()
    lastFetchedAt = 0
    emit()
  }
}

// `enabled` is false in the platform shell, where tenant APIs are forbidden —
// subscribing there would fire a request that always 403s.
export function useTasks(enabled = true) {
  const snapshot = useSyncExternalStore(
    enabled ? tasksStore.subscribe : noopSubscribe,
    enabled ? tasksStore.getSnapshot : getEmpty,
    enabled ? tasksStore.getSnapshot : getEmpty
  )
  useEffect(() => {
    if (!enabled) return
    if (cache.length === 0 && Date.now() - lastFetchedAt > 5000) {
      fetchMyTasks().catch(() => {})
    }
  }, [enabled])
  return snapshot
}

const EMPTY = []
const getEmpty = () => EMPTY
const noopSubscribe = () => () => {}

export function useTask(id) {
  const tasks = useTasks()
  const fromCache = tasks.find((t) => t.id === id) || cacheById.get(id) || null
  useEffect(() => {
    if (id) fetchOne(id).catch(() => {})
  }, [id])
  return fromCache
}

export const TASK_FILTERS = [
  'All tasks',
  'Pending',
  'SLA breached',
  'Approved',
  'Rejected'
]
