// Shared - users.js
// GET /api/users caps `limit` at 100 server-side, so every caller that asked for
// "?limit=100" silently lost the 101st person onwards — pickers just wouldn't
// list them. This walks the pages instead.

import { api, buildQuery } from './api'

const PAGE_LIMIT = 100
// Guard against a runaway loop if the API ever reports a bogus total.
const MAX_PAGES = 50

export async function fetchAllUsers(params = {}) {
  const first = await api.get(`/api/users${buildQuery({ ...params, page: 1, limit: PAGE_LIMIT })}`)
  const users = [...(first.users || [])]
  const totalPages = Math.min(Number(first.totalPages) || 1, MAX_PAGES)

  for (let page = 2; page <= totalPages; page++) {
    const next = await api.get(`/api/users${buildQuery({ ...params, page, limit: PAGE_LIMIT })}`)
    const batch = next.users || []
    if (batch.length === 0) break
    users.push(...batch)
  }

  return {
    users,
    total: Number(first.total) || users.length,
    // True when we stopped early, so callers can say so rather than pretend
    // the list is complete.
    truncated: (Number(first.totalPages) || 1) > totalPages,
  }
}
