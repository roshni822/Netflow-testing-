// Shared - Alert.jsx
// Two building blocks for failure/notice UI, so pages stop hand-rolling
// `bg-red-50 border-red-200 text-red-700` (which has no dark-mode answer):
//   <AlertBanner>  inline strip above content, optional Retry
//   <ErrorState>   centered block when a whole panel failed to load


const TONES = {
  error:   'bg-danger-subtle border-danger-line text-danger-fg',
  warning: 'bg-warning-subtle border-warning-line text-warning-fg',
  success: 'bg-success-subtle border-success-line text-success-fg',
  info:    'bg-info-subtle border-info-line text-info-fg',
}

export function AlertBanner({ tone = 'error', children, onRetry, retryLabel = 'Try again', className = '' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 p-3 rounded-md border text-sm ${TONES[tone] || TONES.info} ${className}`}
    >
      <span className="flex-1">{children}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 px-2 py-0.5 rounded border border-current/30 text-xs font-semibold hover:bg-current/10 transition"
        >
          {retryLabel}
        </button>
      )}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, retryLabel = 'Try again' }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="mb-3 w-11 h-11 rounded-full bg-danger-subtle text-danger-fg flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      {message && <p className="mt-1 text-xs text-fg-muted max-w-sm">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm transition"
        >
          {retryLabel}
        </button>
      )}
    </div>
  )
}
