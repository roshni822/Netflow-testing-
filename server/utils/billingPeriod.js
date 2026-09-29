// Licensing Phase 1 - utils/billingPeriod.js
// Submission allowances reset on the subscription's anniversary day, not on the
// 1st of the calendar month, so an org that signed up on the 20th gets a full
// month before its first reset.
//
// All arithmetic is in UTC so a period does not shift when the server's local
// timezone changes, and the month-end clamp means an anchor of 31 lands on
// 28/29/30 in shorter months instead of overflowing into the next one.

const MIN_DAY = 1
const MAX_DAY = 31

const normalizeAnchor = (anchorDay) => {
  const n = parseInt(anchorDay, 10)
  if (!Number.isFinite(n)) return MIN_DAY
  return Math.min(Math.max(n, MIN_DAY), MAX_DAY)
}

const lastDayOfMonth = (year, monthIndex) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()

// The anchor day as it actually falls in a given month (31 -> 28 in Feb).
const clampDay = (year, monthIndex, day) =>
  Math.min(day, lastDayOfMonth(year, monthIndex))

// The period containing `now`: [start, end) — end is the next reset instant.
const periodFor = (anchorDay = MIN_DAY, now = new Date()) => {
  const day = normalizeAnchor(anchorDay)
  const ref = new Date(now)
  const year = ref.getUTCFullYear()
  const month = ref.getUTCMonth()

  const anchorThisMonth = Date.UTC(year, month, clampDay(year, month, day))

  let startYear = year
  let startMonth = month
  if (ref.getTime() < anchorThisMonth) {
    startMonth -= 1
    if (startMonth < 0) {
      startMonth = 11
      startYear -= 1
    }
  }

  let endYear = startYear
  let endMonth = startMonth + 1
  if (endMonth > 11) {
    endMonth = 0
    endYear += 1
  }

  return {
    start: new Date(Date.UTC(startYear, startMonth, clampDay(startYear, startMonth, day))),
    end: new Date(Date.UTC(endYear, endMonth, clampDay(endYear, endMonth, day)))
  }
}

// True when the stored window no longer covers `now` (or was never set), i.e.
// the counter has to roll over before it can be trusted.
const isStale = (submissions, anchorDay, now = new Date()) => {
  if (!submissions?.periodStart || !submissions?.periodEnd) return true
  const at = new Date(now).getTime()
  if (at >= new Date(submissions.periodEnd).getTime()) return true
  if (at < new Date(submissions.periodStart).getTime()) return true
  // Anchor changed under our feet (plan re-dated): re-derive.
  const expected = periodFor(anchorDay, now)
  return new Date(submissions.periodStart).getTime() !== expected.start.getTime()
}

module.exports = { periodFor, isStale, normalizeAnchor, clampDay, lastDayOfMonth }
