// Shared - ConfirmDialog.jsx
// Branded replacement for window.confirm(). Mount once near the app root
// (App.jsx). Reads confirmStore; renders nothing when idle. Backdrop click and
// Esc cancel; Enter accepts; the confirm button turns rose for destructive
// (danger) actions.

import { useEffect } from 'react'
import { useConfirmState, confirmController } from '../lib/confirmStore'

export default function ConfirmDialog() {
  const state = useConfirmState()

  useEffect(() => {
    if (!state) return
    // Escape only. Enter is deliberately left to the focused button so a stray
    // keypress can't confirm a destructive action the user hasn't chosen.
    const onKey = (e) => {
      if (e.key === 'Escape') confirmController.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])

  if (!state) return null
  const { title, message, confirmLabel, cancelLabel, danger } = state

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
      onClick={confirmController.cancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-surface border border-line shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={message ? 'confirm-dialog-message' : undefined}
      >
        <div className="px-6 pt-5 pb-4">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-fg">{title}</h2>
          {message && (
            <p id="confirm-dialog-message" className="mt-2 text-sm text-fg-muted whitespace-pre-line">
              {message}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-3">
          {/* Destructive dialogs open with Cancel focused so Enter is a safe default. */}
          <button
            onClick={confirmController.cancel}
            autoFocus={danger}
            className="px-4 py-2 rounded-lg text-sm font-medium text-fg-muted hover:bg-surface-3 transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={confirmController.accept}
            autoFocus={!danger}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
