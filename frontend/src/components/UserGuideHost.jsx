// Auto-starts the application demo once for every user role after password
// setup. Skip/Done never shows it again for that user id in this browser.

import { useEffect } from 'react'
import { authStore, useUser } from '../utils/auth'
import {
  userGuideStore,
  useUserGuide,
  shouldAutoStartTour,
  hasCompletedTour,
} from '../lib/userGuideStore'
import { buildFullTour } from '../lib/tourSteps'
import ProductTour from './ProductTour'

function userKey(user) {
  const id = user?._id || user?.id
  return id == null ? '' : String(id)
}

export default function UserGuideHost() {
  const user = useUser()
  const userId = userKey(user)
  const guide = useUserGuide()
  const mustChange = Boolean(user?.mustChangePassword)

  useEffect(() => {
    if (!userId || mustChange) return
    if (hasCompletedTour(userId)) return
    if (guide.tourOpen) return

    // Do not use a "started" ref: auth refresh / Strict Mode can remount or
    // rewrite the user object and cancel a pending timeout before the demo opens.
    const t = setTimeout(() => {
      const latest = authStore.getSnapshot()
      if (!shouldAutoStartTour(latest)) return
      if (userGuideStore.getSnapshot().tourOpen) return
      userGuideStore.startTour(buildFullTour(latest), 'forced')
    }, 700)

    return () => clearTimeout(t)
  }, [userId, mustChange, guide.tourOpen])

  return <ProductTour />
}
