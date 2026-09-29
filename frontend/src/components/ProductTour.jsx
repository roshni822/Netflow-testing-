// New-user application demo — spotlight coach marks. Exit only via Skip
// (or Done on the last step). No Esc / backdrop / × dismiss.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUserGuide, userGuideStore, markTourCompleted } from '../lib/userGuideStore'
import { authStore, useUser } from '../utils/auth'
import { api } from '../utils/api'

function pathParts(raw) {
  const [path = '/', search = ''] = String(raw || '/').split('?')
  return { path, search: search ? `?${search}` : '' }
}

function needsNavigate(currentPathname, currentSearch, targetRaw) {
  if (!targetRaw) return false
  const { path, search } = pathParts(targetRaw)
  if (currentPathname === path || currentPathname.startsWith(`${path}/`)) {
    // Same page — still navigate if the step needs a specific query (e.g. blank form).
    if (!search) return false
    return currentSearch !== search
  }
  return true
}

const PAD = 8

function isVisible(el) {
  if (!el) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function findTarget(selectorKey) {
  if (!selectorKey) return null
  const nodes = document.querySelectorAll(`[data-tour="${selectorKey}"]`)
  for (const el of nodes) {
    if (isVisible(el)) return el
  }
  return nodes[0] || null
}

function waitForTarget(selectorKey, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const existing = findTarget(selectorKey)
    if (existing) {
      resolve(existing)
      return
    }
    const started = Date.now()
    const tick = () => {
      const el = findTarget(selectorKey)
      if (el) {
        resolve(el)
        return
      }
      if (Date.now() - started > timeoutMs) {
        resolve(null)
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

export default function ProductTour() {
  const guide = useUserGuide()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const user = useUser()
  const userId = user?._id != null ? String(user._id) : (user?.id != null ? String(user.id) : '')
  const panelRef = useRef(null)
  const [rect, setRect] = useState(null)
  const [ready, setReady] = useState(null)

  const step = guide.tourOpen ? guide.steps[guide.stepIndex] : null
  if (!guide.tourOpen && ready !== null) setReady(null)
  const total = guide.steps.length
  const index = guide.stepIndex

  useEffect(() => {
    if (!guide.tourOpen || !step) {
      return undefined
    }

    let cancelled = false

    const run = async () => {
      const targetPath = step.path || pathname
      if (needsNavigate(pathname, search, targetPath)) {
        navigate(targetPath)
      }

      try {
        if (String(step.target || '').startsWith('nav-')) {
          localStorage.setItem('fs.navOpen', '1')
          window.dispatchEvent(new Event('fs:nav-open'))
        }
      } catch { /* ignore */ }

      const el = await waitForTarget(step.target)
      if (cancelled) return

      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
        await new Promise((r) => setTimeout(r, 120))
        if (cancelled) return
        const r = el.getBoundingClientRect()
        setRect({
          top: r.top - PAD,
          left: r.left - PAD,
          width: r.width + PAD * 2,
          height: r.height + PAD * 2,
        })
      } else {
        setRect(null)
      }
      setReady(step)
    }

    run()
    return () => { cancelled = true }
  }, [guide.tourOpen, guide.stepIndex, step, pathname, search, navigate])

  useLayoutEffect(() => {
    if (!guide.tourOpen || !step?.target) return undefined
    const update = () => {
      const el = findTarget(step.target)
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      })
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [guide.tourOpen, step?.target, guide.stepIndex])

  // Keyboard: next/back only — Escape does NOT dismiss.
  useEffect(() => {
    if (!guide.tourOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        if (index >= total - 1) finish()
        else userGuideStore.next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        userGuideStore.prev()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.tourOpen, index, total, userId])

  function finish() {
    // Always persist locally so any role never auto-sees the demo again.
    markTourCompleted(userId)
    userGuideStore.stopTour()
    // Clear server flag when present (provisioned users); local key is the real gate.
    if (user?.needsProductTour) {
      authStore.updateUser({ needsProductTour: false })
      api.post('/api/auth/product-tour/complete')
        .then((data) => {
          if (data?.user) authStore.updateUser(data.user)
        })
        .catch(() => { /* local clear already applied */ })
    }
  }

  if (!guide.tourOpen || !step || ready !== step) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const hole = rect && rect.width > 0 && rect.height > 0 ? rect : null

  let tipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  if (hole) {
    const tipW = Math.min(360, vw - 32)
    const tipH = 220
    const place = step.placement || 'bottom'
    if (place === 'right') {
      tipStyle = {
        top: clamp(hole.top, 16, vh - tipH - 16),
        left: clamp(hole.left + hole.width + 16, 16, vw - tipW - 16),
      }
    } else if (place === 'left') {
      tipStyle = {
        top: clamp(hole.top, 16, vh - tipH - 16),
        left: clamp(hole.left - tipW - 16, 16, vw - tipW - 16),
      }
    } else if (place === 'top') {
      tipStyle = {
        top: clamp(hole.top - tipH - 16, 16, vh - tipH - 16),
        left: clamp(hole.left + hole.width / 2 - tipW / 2, 16, vw - tipW - 16),
      }
    } else if (place === 'center') {
      tipStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    } else {
      tipStyle = {
        top: clamp(hole.top + hole.height + 16, 16, vh - tipH - 16),
        left: clamp(hole.left + hole.width / 2 - tipW / 2, 16, vw - tipW - 16),
      }
    }
  }

  const isLast = index >= total - 1

  return (
    <div className="fixed inset-0 z-[95]" aria-live="polite">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {hole && (
              <rect
                x={hole.left}
                y={hole.top}
                width={hole.width}
                height={hole.height}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        {/* Backdrop blocks clicks; does not dismiss the tour */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.55)"
          mask="url(#tour-mask)"
          className="pointer-events-auto"
        />
      </svg>

      {hole && (
        <div
          aria-hidden="true"
          className="absolute rounded-xl ring-2 ring-indigo-400 pointer-events-none"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
        />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="absolute w-[min(22.5rem,calc(100vw-2rem))] bg-surface border border-line rounded-xl shadow-xl p-4 pointer-events-auto"
        style={tipStyle}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300 mb-2">
          Demo · step {index + 1} of {total}
        </p>
        <h2 id="tour-title" className="text-sm font-semibold text-fg">
          {step.title}
        </h2>
        <p className="mt-1.5 text-sm text-fg-muted leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-xs font-medium text-fg-muted hover:text-fg px-2 py-1.5 rounded-md underline-offset-2 hover:underline"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => userGuideStore.prev()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-line text-fg hover:bg-surface-2 disabled:opacity-40 transition"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => (isLast ? finish() : userGuideStore.next())}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
