// AI-02 - AssistantWidget.jsx
// Floating AI assistant. A sparkle launcher (bottom-right) opens a chat panel
// that answers questions about the signed-in user's own requests/approvals via
// /api/assistant/ask. Hidden entirely when the server has no LLM configured.

import { useEffect, useRef, useState } from 'react'
import { api } from '../utils/api'

const GREETING = {
  role: 'assistant',
  content:
    'Hi! I can help you track your requests and approvals. Ask me things like "Where is my leave request?" or "Who approved the GRN?"',
}

const SUGGESTIONS = [
  'Where are my requests?',
  'Which of my requests are still pending?',
  'Who approved my latest request?',
]

function Robot({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 6V3.5" />
      <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
      <rect x="4" y="6" width="16" height="12" rx="3" />
      <path d="M2 11v3M22 11v3" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M9.5 15.5h5" />
    </svg>
  )
}

function Bubble({ role, error, children }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-indigo-600 text-white'
            : error
              ? 'rounded-bl-sm bg-danger-subtle text-danger-fg border border-danger-line'
              : 'rounded-bl-sm bg-surface text-fg border border-line'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function Typing() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
    </span>
  )
}

export default function AssistantWidget() {
  const [available, setAvailable] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    api
      .get('/api/assistant/status')
      .then((d) => { if (!cancelled) setAvailable(!!d.aiConfigured) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!open) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    inputRef.current?.focus()
  }, [open, messages, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!available) return null

  const ask = async (text) => {
    const q = String(text || '').trim()
    if (!q || busy) return
    const next = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const history = next.filter((m) => m !== GREETING).slice(-6)
      const d = await api.post('/api/assistant/ask', { message: q, history })
      setMessages((prev) => [...prev, { role: 'assistant', content: d.answer || "I couldn't find an answer." }])
    } catch (err) {
      const msg =
        err?.code === 'AI_NOT_CONFIGURED' || err?.code === 'AI_ERROR'
          ? 'The assistant is unavailable right now. Please try again in a moment.'
          : err?.message || 'Something went wrong. Please try again.'
      setMessages((prev) => [...prev, { role: 'assistant', content: msg, error: true }])
    } finally {
      setBusy(false)
    }
  }

  const onlyGreeting = messages.length === 1

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        aria-controls="assistant-panel"
        // z-30 keeps the launcher under dialogs — at z-40 it floated on top of
        // every modal in the app.
        className="fixed bottom-20 right-5 md:bottom-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:scale-105 hover:bg-indigo-700"
      >
        {open ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <Robot className="h-7 w-7" />
        )}
      </button>

      {open && (
        <div
          id="assistant-panel"
          role="dialog"
          aria-label="NetFlow Assistant"
          className="fixed bottom-24 right-5 z-30 flex h-[32rem] max-h-[calc(100vh-7rem)] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center gap-2 bg-indigo-600 px-4 py-3 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/20">
              <Robot className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">NetFlow Assistant</p>
              <p className="text-[11px] text-indigo-100">Ask about your requests</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-indigo-100 transition hover:bg-surface/15 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-surface-2 px-3 py-3">
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role} error={m.error}>{m.content}</Bubble>
            ))}

            {onlyGreeting && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-full border border-info-line bg-surface px-2.5 py-1 text-[11px] font-medium text-info-fg transition hover:bg-info-subtle"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {busy && <Bubble role="assistant"><Typing /></Bubble>}
          </div>

          <div className="border-t border-line p-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
                placeholder="Ask about your requests…"
                className="max-h-28 flex-1 resize-none rounded-lg border border-line px-3 py-2 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <button
                type="button"
                onClick={() => ask(input)}
                disabled={busy || !input.trim()}
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-fg-subtle">
              Answers are based only on your own requests and approvals.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
