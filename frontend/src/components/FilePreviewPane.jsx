import { toAbsoluteUrl } from '../utils/api'

export function FilePreviewPane({ file, onClose, availableDocs = [], onSelect }) {
  if (!file || !file.url) return null

  const isImage = file.mime?.startsWith('image/')
  const isPdf = file.mime === 'application/pdf'
  const isSupported = isImage || isPdf

  // Use the absolute URL utility to ensure local dev paths resolve to the backend
  const fileUrl = toAbsoluteUrl(file.url)

  return (
    <div className="w-full h-full flex flex-col bg-surface border border-line rounded-lg shadow-sm overflow-hidden animate-in slide-in-from-right-8 fade-in duration-300">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-line bg-surface-2/50">
        <div className="flex items-center gap-2 min-w-0 flex-1 pr-4">
          <svg className="w-4 h-4 text-fg-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {availableDocs.length > 1 ? (
            <select
              className="text-sm font-semibold text-fg bg-transparent border-0 focus:ring-0 p-0 cursor-pointer truncate w-full"
              value={file.url}
              onChange={(e) => {
                const selected = availableDocs.find(d => d.url === e.target.value)
                if (selected && onSelect) onSelect(selected)
              }}
            >
              {availableDocs.map(doc => (
                <option key={doc.url} value={doc.url}>
                  {doc.fieldLabel ? `${doc.fieldLabel}: ` : ''}{doc.name}
                </option>
              ))}
            </select>
          ) : (
            <h3 className="text-sm font-semibold text-fg truncate" title={file.name}>
              {file.name || 'File Preview'}
            </h3>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 transition"
          aria-label="Close preview"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Viewer */}
      <div className="flex-1 bg-surface-2 relative overflow-hidden flex items-center justify-center">
        {isSupported ? (
          isImage ? (
            <div className="w-full h-full overflow-auto p-4 flex items-center justify-center">
              <img src={fileUrl} alt={file.name} className="max-w-full max-h-full object-contain shadow-sm rounded border border-line" />
            </div>
          ) : (
            <iframe
              src={`${fileUrl}#toolbar=0&navpanes=0`}
              title={file.name}
              className="w-full h-full border-0"
              style={{ backgroundColor: 'transparent' }}
            />
          )
        ) : (
          <div className="text-center px-6">
            <svg className="w-12 h-12 text-fg-subtle mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <p className="text-sm font-medium text-fg">Preview not available</p>
            <p className="mt-1 text-xs text-fg-muted">
              Only PDFs and images can be previewed directly in the browser.
            </p>
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block text-sm text-indigo-600 hover:text-indigo-700 font-medium bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg transition"
            >
              Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
