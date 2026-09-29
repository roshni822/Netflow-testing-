// NTF (UI) — the notification bell's polling cadence.
//
// Delivery, read/unread and the API are covered by notifications.test.js. The
// open question here is purely a browser one: the bell, the badge and the
// notifications page all subscribe to one shared store, and each used to run its
// own 30s interval — so the app really polled roughly every 10s. This pins the
// single shared 30s cadence.
//
// Time is faked with Playwright's clock so the check is instant and exact
// instead of a two-minute wall-clock wait.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')
const { runWithOrgId, Task, Notification } = h

const TCS = ['NTF-012', 'NTF-013']
const POLL_MS = 30000

h.runSuite('ui_notifications', async () => {
  h.note('NTF-012', 'Pending', 'External: needs a mail catcher (MailHog/Mailpit) to inspect a delivered email')

  if (!(await u.frontendUp())) return u.skipAll(['NTF-013'], u.unavailableReason())

  const org = await h.createOrg('uintf')
  const user = await h.createUser(org, {
    name: 'UI Ntf User', email: h.emailIn(org, 'uintf-user'), roleName: 'Manager'
  })
  const token = await h.getToken({ email: user.email })

  const task = await runWithOrgId(org._id, () => Task.create({
    title: 'Bell task', type: 'IT', status: 'pending',
    assignedTo: user._id, submittedBy: user._id
  }))
  await runWithOrgId(org._id, () => Notification.create({
    userId: user._id, taskId: task._id, type: 'assignment',
    title: 'Bell task', message: 'A request is waiting for you', read: false
  }))

  const browser = await u.launch()
  try {
    const { context, page } = await u.session(browser, { token, workspace: org.subdomain })

    let polls = 0
    page.on('request', (req) => {
      if (/\/api\/notifications(\?|$)/.test(req.url())) polls++
    })

    // Must be installed before any page script runs so the store's interval is
    // created against the fake clock.
    await page.clock.install()
    await u.goto(page, '/dashboard')
    await page.waitForTimeout(1500)

    const initial = polls
    h.check('NTF-013', 'Subscribing to the bell fetches notifications once up front',
      initial >= 1, `${initial} requests on load`)

    // Nothing should fire before the interval elapses.
    await page.clock.runFor(POLL_MS - 5000)
    await page.waitForTimeout(600)
    const early = polls
    h.check('NTF-013', 'The bell does not poll again before its interval is up',
      early === initial, `${early - initial} extra requests after ${(POLL_MS - 5000) / 1000}s`)

    await page.clock.runFor(6000)
    await page.waitForTimeout(600)
    const first = polls
    h.check('NTF-013', 'The bell polls once the 30s interval elapses',
      first === initial + 1, `${first - initial} requests after 30s (expected 1)`)

    // A second period must add exactly one more — one shared interval, not one
    // per subscribed component.
    await page.clock.runFor(POLL_MS)
    await page.waitForTimeout(600)
    const second = polls
    h.check('NTF-013', 'Each further period adds exactly one poll, not one per subscriber',
      second === first + 1, `${second - first} requests in the second period (expected 1)`)

    // Opening the notifications page adds another subscriber; the cadence must
    // not change, which is the regression this case exists for.
    await u.goto(page, '/notifications')
    await page.waitForTimeout(1200)
    const afterNav = polls
    await page.clock.runFor(POLL_MS)
    await page.waitForTimeout(600)
    h.check('NTF-013', 'A second subscriber does not double the polling rate',
      polls === afterNav + 1, `${polls - afterNav} requests in one period with the bell and list both open`)

    await context.close()
  } finally {
    await browser.close()
  }
})
