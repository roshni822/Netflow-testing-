// Licensing Phase 4 - lib/limitFeedback.js
// One way to report "the plan said no".
//
// A quota refusal is not a bug and should not read like one: the server already
// sends a sentence naming the limit and what the admin can do about it, so the
// only thing missing is a heading and the guarantee that every page says it the
// same way. This also refreshes the shared meters, because the refusal is proof
// that whatever the banner is showing is now out of date.

import { toast } from './toastStore'
import { usageStore } from './usageStore'
import { explainLimitError, isLicensingError } from './licensing'

// Shows the right message for `err` and returns true when it handled it, so a
// caller can fall through to its own error handling for real failures:
//
//   catch (err) { if (!reportLimit(err)) toast.error(err.message) }
export const reportLimit = (err) => {
  if (!isLicensingError(err)) return false
  const info = explainLimitError(err)
  if (!info) return false
  toast.error(`${info.title} — ${info.message}`, 9000)
  // The numbers behind the banner just changed; pull them again.
  usageStore.refresh().catch(() => {})
  return true
}

// For inline (non-toast) placements: the banner copy without the side effects.
export const limitBanner = (err) => (isLicensingError(err) ? explainLimitError(err) : null)
