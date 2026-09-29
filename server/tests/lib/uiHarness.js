// Browser-side extension of lib/harness.js.
//
// A chunk of the checklist can only be answered in a real browser: sidebar
// visibility, client-side route guards, dialog open/close, validation that
// never reaches the API, downloads generated client-side, clipboard writes.
// Those cases sat at Pending because the API harness cannot reach them.
//
// Fixtures are still seeded over the API — fast and deterministic — and the
// browser is used only for the assertion itself. Sessions are injected into
// localStorage instead of driving the login form, which the auth suites
// already cover end to end.

const os = require('os')
const path = require('path')
const H = require('./harness')

// Vite dev server. CLIENT_URL in server/.env points at 5173. "localhost" (not
// 127.0.0.1) because Vite binds the dev server to ::1 only, so the IPv4
// literal is refused.
const APP_URL = (process.env.TEST_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')

// Desktop width so the md+ sidebar renders; below md the app swaps to a bottom
// tab bar and an overlay drawer, which have their own DOM.
const VIEWPORT = { width: 1440, height: 900 }

// localStorage keys owned by the frontend (utils/api.js, utils/workspace.js,
// AppShell). Injecting these is what makes a context "logged in".
const TOKEN_KEY = 'flowsphere_token'
const USER_KEY = 'flowsphere_user'
const WORKSPACE_KEY = 'netflow_workspace'
const NAV_OPEN_KEY = 'fs.navOpen'

let chromium = null
try { ({ chromium } = require('playwright')) } catch { /* surfaced by frontendUp() */ }

// ── availability ─────────────────────────────────────────────────────────────
// UI suites need the frontend as well as the API. When either the dev server or
// Playwright is missing the cases are marked Pending, not Fail — a CI box that
// only boots the API should not turn the whole run red.
const frontendUp = async () => {
  if (!chromium) return false
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

const unavailableReason = () =>
  chromium
    ? `Frontend not reachable at ${APP_URL} — start the Vite dev server to run the UI suites.`
    : 'playwright is not installed — run npm install in server/.'

// Mark every TC a suite owns as Pending with one shared reason.
const skipAll = (tcIds, reason) => {
  for (const id of tcIds) H.note(id, 'Pending', reason)
}

// ── browser lifecycle ────────────────────────────────────────────────────────
const launch = () => chromium.launch({ headless: process.env.UI_HEADED !== '1' })

// An authenticated browser context. `token` comes from H.getToken(), so the
// session is a real one the API will accept; the canonical user is read back
// from /auth/me so the store matches what the app would have cached itself.
const session = async (browser, { token, workspace = null, permissions = [] } = {}) => {
  const me = await H.api('GET', '/auth/me', token)
  const user = me.body?.user || null
  if (!user) throw new Error('session(): /auth/me did not return a user — is the token valid?')

  const context = await browser.newContext({
    viewport: VIEWPORT,
    acceptDownloads: true,
    permissions
  })

  // Runs before page scripts on every navigation, so the app boots straight
  // into an authenticated state with no login round-trip.
  await context.addInitScript((seed) => {
    try {
      localStorage.setItem(seed.tokenKey, seed.token)
      localStorage.setItem(seed.userKey, JSON.stringify(seed.user))
      localStorage.setItem(seed.navKey, '1')
      const userId = seed.user?._id || seed.user?.id
      if (userId) localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
      if (seed.workspace) localStorage.setItem(seed.wsKey, seed.workspace)
      else localStorage.removeItem(seed.wsKey)
    } catch { /* storage unavailable */ }
  }, {
    token,
    user,
    workspace,
    tokenKey: TOKEN_KEY,
    userKey: USER_KEY,
    wsKey: WORKSPACE_KEY,
    navKey: NAV_OPEN_KEY
  })

  const page = await context.newPage()
  return { context, page, user }
}

// A context with no session, for logged-out guard checks.
const anonSession = async (browser) => {
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true })
  const page = await context.newPage()
  return { context, page }
}

// ── navigation ───────────────────────────────────────────────────────────────
// App.jsx holds a "Loading NetFlow..." splash while it refreshes the session,
// and route guards redirect with <Navigate replace> during that first render.
// Waiting for the splash to clear is what makes the landing path trustworthy.
const goto = async (page, route, { timeout = 30000 } = {}) => {
  await page.goto(`${APP_URL}${route}`, { waitUntil: 'domcontentloaded', timeout })
  await page
    .waitForFunction(() => !document.body.innerText.includes('Loading NetFlow'), null, { timeout: 20000 })
    .catch(() => { /* fall through to the pathname read */ })
  await page.waitForTimeout(400)
  return page.evaluate(() => location.pathname)
}

// Poll for the client-side guard to settle on its final path.
const landsOn = async (page, expected, { timeout = 8000 } = {}) => {
  const deadline = Date.now() + timeout
  let seen = await page.evaluate(() => location.pathname)
  while (Date.now() < deadline) {
    if (seen === expected) return true
    await page.waitForTimeout(150)
    seen = await page.evaluate(() => location.pathname)
  }
  return seen === expected
}

const pathOf = (page) => page.evaluate(() => location.pathname)

// ── sidebar ──────────────────────────────────────────────────────────────────
// Scoped to #app-sidebar: NavSections is rendered by both the desktop rail and
// the mobile drawer, so an unscoped query would match every item twice.
const sidebarLinks = async (page) => {
  await page.waitForSelector('#app-sidebar nav[aria-label="Main"]', { timeout: 20000 })
  await page.waitForTimeout(200)
  return page.$$eval('#app-sidebar a[href]', (els) =>
    els.map((el) => ({
      href: el.getAttribute('href'),
      label: (el.textContent || '').replace(/\s+/g, ' ').trim()
    }))
  )
}

const hasLink = (links, href) => links.some((l) => l.href === href)
const linkHrefs = (links) => links.map((l) => l.href).join(', ')

// ── downloads ────────────────────────────────────────────────────────────────
// Both exports build a Blob client-side and click a synthetic <a download>, so
// the download event is the only observable signal.
const captureDownload = async (page, trigger, { timeout = 30000 } = {}) => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout }),
    trigger()
  ])
  const name = dl.suggestedFilename()
  const file = path.join(os.tmpdir(), `nf-ui-${Date.now()}-${name}`)
  await dl.saveAs(file)
  return { name, path: file }
}

// Pushes a real file through POST /api/uploads and returns { name, url, ... }.
// Seeding a made-up URL would render a link that 404s, which proves nothing
// about whether an attachment can actually be opened.
const uploadFile = async (token, { name, buf, type = 'image/png' }) => {
  const body = new FormData()
  body.append('file', new Blob([buf], { type }), name)
  const res = await fetch(`${H.API}/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body
  })
  const json = await res.json().catch(() => null)
  if (!json?.file) throw new Error(`upload failed (${res.status}): ${JSON.stringify(json)}`)
  return json.file
}

// ── misc ─────────────────────────────────────────────────────────────────────
// Smallest valid PNG (1x1, transparent) for avatar/file upload cases.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const tmpFile = (name, buf) => {
  const file = path.join(os.tmpdir(), `nf-ui-${Date.now()}-${name}`)
  require('fs').writeFileSync(file, buf)
  return file
}

// First locator in the list that is actually present and visible.
const firstVisible = async (page, selectors) => {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) > 0 && await loc.isVisible().catch(() => false)) return loc
  }
  return null
}

const isVisible = async (page, selector) => {
  const loc = page.locator(selector).first()
  return (await loc.count()) > 0 && await loc.isVisible().catch(() => false)
}

module.exports = {
  APP_URL, VIEWPORT,
  TOKEN_KEY, USER_KEY, WORKSPACE_KEY, NAV_OPEN_KEY,
  frontendUp, unavailableReason, skipAll,
  launch, session, anonSession,
  goto, landsOn, pathOf,
  sidebarLinks, hasLink, linkHrefs,
  captureDownload, uploadFile,
  PNG_1PX, tmpFile, firstVisible, isVisible
}
