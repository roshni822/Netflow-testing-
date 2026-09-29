// Shared - a11y.js
// Every overlay in the app had grown its own half-implementation: some closed on
// Escape, none trapped focus, and the page behind kept scrolling. These are the
// three behaviours a dialog or drawer needs, in one place.

import { useEffect, useRef } from 'react'

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// `offsetParent` is null for anything display:none — good enough to skip the
// hidden controls a trap would otherwise stop on.
const focusableIn = (root) =>
  root
    ? Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )
    : []

// Keeps the page behind an overlay still, and compensates for the scrollbar
// disappearing so the layout doesn't jump sideways.
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined
    const { body } = document
    const prevOverflow = body.style.overflow
    const prevPadding = body.style.paddingRight
    const gap = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gap > 0) body.style.paddingRight = `${gap}px`
    return () => {
      body.style.overflow = prevOverflow
      body.style.paddingRight = prevPadding
    }
  }, [active])
}

// Moves focus into the overlay, cycles Tab inside it, and hands focus back to
// whatever opened it on close.
// Dialogs should land on the first thing you'd type into, not the close button
// that happens to come first in the markup.
export const preferFormControl = (container) => {
  if (!container) return null
  const controls = Array.from(
    container.querySelectorAll('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])')
  ).filter((el) => el.offsetParent !== null)
  return controls[0] || null
}

export function useFocusTrap(active, ref, { onEscape, autoFocus = true, initialFocus } = {}) {
  const restoreRef = useRef(null)
  // Held in a ref so an inline arrow from the caller doesn't re-run the effect
  // and yank focus back to the top of the dialog on every render.
  const escapeRef = useRef(onEscape)
  useEffect(() => { escapeRef.current = onEscape }, [onEscape])

  useEffect(() => {
    if (!active) return undefined
    const node = ref.current
    restoreRef.current = document.activeElement

    if (autoFocus) {
      const target = initialFocus?.(node) || focusableIn(node)[0] || node
      target?.focus?.()
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        escapeRef.current?.(e)
        return
      }
      if (e.key !== 'Tab') return
      const container = ref.current
      if (!container) return
      const items = focusableIn(container)
      if (items.length === 0) {
        e.preventDefault()
        container.focus?.()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const outside = !container.contains(current)
      if (e.shiftKey && (outside || current === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (outside || current === last)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const el = restoreRef.current
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
  }, [active, ref, autoFocus, initialFocus])
}

// Dismiss-on-outside-press for popovers. Uses pointerdown so it fires for touch
// as well; the old menus only closed on mouseleave, which never happens on a
// phone.
export function useOutsideDismiss(active, ref, onDismiss) {
  const handlerRef = useRef(onDismiss)
  useEffect(() => { handlerRef.current = onDismiss }, [onDismiss])

  useEffect(() => {
    if (!active) return undefined
    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) handlerRef.current?.(e)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [active, ref])
}

// Cmd on Apple hardware, Ctrl everywhere else — the hint used to read "Ctrl K"
// on Macs where the shortcut listener actually accepts ⌘K.
export const isApplePlatform = () => {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.userAgentData?.platform || navigator.platform || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export const modifierKeyLabel = () => (isApplePlatform() ? '⌘' : 'Ctrl')
