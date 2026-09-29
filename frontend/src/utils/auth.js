// M1 - Phase 2 - utils/auth.js
// Auth state: who's logged in. Subscribed by Sidebar + route guards.

import { useSyncExternalStore } from 'react'
import {
  api,
  setToken,
  clearToken,
  getStoredUser,
  setStoredUser
} from './api'

let currentUser = getStoredUser()
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

export const authStore = {
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return currentUser
  },
  _setSession(data) {
    setToken(data.token)
    setStoredUser(data.user)
    currentUser = data.user
    emit()
    return data.user
  },
  // Patch the cached profile without re-issuing a token (e.g. tour completed).
  updateUser(patch) {
    if (!currentUser || !patch) return currentUser
    const next = { ...currentUser, ...patch }
    setStoredUser(next)
    currentUser = next
    emit()
    return next
  },
  // Returns a status object so the UI can branch:
  //   { status: 'ok', user }        → logged in
  //   { status: 'mfa', challenge }  → needs a 6-digit code (already enrolled)
  //   { status: 'setup', challenge }→ enrol MFA mid-login (legacy; unused when MFA is opt-in)
  async login(email, password, subdomain, accountScope) {
    const body = { email, password }
    if (accountScope) body.accountScope = accountScope
    if (subdomain) body.subdomain = subdomain // step 9: org-scoped login by workspace
    const data = await api.post('/api/auth/login', body, { skipAuthRedirect: true })
    if (data.mfaRequired) return { status: 'mfa', challenge: data.challenge }
    if (data.mfaSetupRequired) return { status: 'setup', challenge: data.challenge }
    this._setSession(data)
    return { status: 'ok', user: data.user }
  },
  // Second login step for enrolled users (TOTP or backup code).
  async completeMfa(challenge, code) {
    const data = await api.post('/api/auth/mfa/verify', { challenge, code }, { skipAuthRedirect: true })
    return this._setSession(data)
  },
  // Forced-enrolment (admin) helpers — use the setup challenge, no session yet.
  async mfaSetupWithChallenge(challenge) {
    return api.post('/api/auth/mfa/setup', { challenge }, { skipAuthRedirect: true })
  },
  async mfaEnableWithChallenge(challenge, code) {
    const data = await api.post('/api/auth/mfa/enable', { challenge, code }, { skipAuthRedirect: true })
    this._setSession(data) // enable-via-challenge returns { token, user, backupCodes }
    return data
  },
  // Change the signed-in user's password. For a forced first-login change
  // (mustChangePassword) currentPassword may be omitted. Returns the fresh user
  // (a new token is issued server-side and stored here).
  async changePassword(currentPassword, newPassword) {
    const data = await api.post(
      '/api/auth/change-password',
      { currentPassword, newPassword },
      { skipAuthRedirect: true }
    )
    return this._setSession(data)
  },
  async register(payload) {
    const data = await api.post('/api/auth/register', payload, { skipAuthRedirect: true })
    setToken(data.token)
    setStoredUser(data.user)
    currentUser = data.user
    emit()
    return data.user
  },
  async logout(allDevices = false) {
    try { await api.post('/api/auth/logout', { allDevices }) } catch { /* ignore */ }
    clearToken()
    currentUser = null
    emit()
  },
  async refresh({ preserveOnError = false } = {}) {
    try {
      const data = await api.get('/api/auth/me', { skipAuthRedirect: true })
      setStoredUser(data.user)
      currentUser = data.user
      emit()
      return data.user
    } catch {
      if (preserveOnError) return currentUser
      clearToken()
      currentUser = null
      emit()
      return null
    }
  }
}

export function useUser() {
  return useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getSnapshot
  )
}

export const initials = (name) => {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const ROLE_LABELS = {
  SuperAdmin: 'SuperAdmin',
  Admin: 'Organization Admin',
  Manager: 'Manager',
  HR: 'HR',
  VP: 'VP',
  CEO: 'CEO',
  Employee: 'Employee'
}

// Fallback list for the self-registration screen only. That page runs without a
// session, so it cannot read the tenant's real list — everywhere inside the app
// uses lib/departmentsStore, which does. Self-registration is currently off.
export const DEPARTMENTS = ['HR', 'Finance', 'IT', 'Operations', 'Sales', 'Legal', 'Warehouse', 'Accounts']
