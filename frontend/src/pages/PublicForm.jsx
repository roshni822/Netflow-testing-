// Standalone, unauthenticated public form page (like a Google Form).
// Reached at /f/:token — renders a published+public form, lets anyone fill and
// submit it. No AppShell, no auth, no workflow. Self-contained renderers so it
// never depends on the authenticated `api` wrapper (which redirects on 401).

import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE, toAbsoluteUrl } from '../utils/api'
import { fieldMaxMb } from '../utils/uploads'
import { SignaturePad, UploadProgress, ReferenceUserSelect } from '../components/FormFields'
import { fieldDomId, focusFirstError, isFieldVisible, isSignatureEmpty, stripHiddenValues, validateField } from '../components/formFieldHelpers'
import { MAX_UPLOAD_MB } from '../utils/uploads'
import { FilePreviewPane } from '../components/FilePreviewPane'
import PdfUploadAutoFill from '../components/PdfUploadAutoFill'

const inputCls =
  'w-full px-3 py-2 text-sm rounded-md border border-line bg-surface text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition'
const inputErrorCls = 'border-red-400 focus:ring-red-200 focus:border-red-400'

// --- tiny fetch helpers (no auth headers, no redirect-on-401) ---------------
async function readJson(res) {
  const text = await res.text()
  let data = {}
  if (text) { try { data = JSON.parse(text) } catch { data = { error: text } } }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// XHR rather than fetch so the field can show a real percentage.
function publicUpload(token, file, maxMb, onProgress) {
  const fd = new FormData()
  fd.append('file', file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/public/forms/${token}/upload?maxMb=${maxMb}`)
    xhr.upload.onprogress = (e) => {
      onProgress?.(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null)
    }
    xhr.onerror = () => reject(new Error('Network error — please try again'))
    xhr.onload = () => {
      let data = {}
      if (xhr.responseText) {
        try { data = JSON.parse(xhr.responseText) } catch { data = { error: xhr.responseText } }
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data.file)
      else reject(new Error(data.error || `Upload failed (${xhr.status})`))
    }
    xhr.send(fd)
  })
}

// --- field renderers (mirrors FillForm, but uploads via the public route) ---
function FileField({ token, value, onChange, maxMb, onRequestPreview }) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [useCamera, setUseCamera] = useState(false)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > maxMb * 1024 * 1024) {
      setUploadError(`File is too large. Max ${maxMb} MB.`)
      onChange('')
      e.target.value = ''
      return
    }
    setUploading(true)
    setProgress(0)
    setUploadError('')
    try {
      const saved = await publicUpload(token, file, maxMb, setProgress)
      onChange(saved)
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
      onChange('')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  const current = value && typeof value === 'object' && value.url ? value : null

  if (useCamera) {
    return (
      <div className="space-y-2">
        <PublicCameraCapture
          token={token}
          value={value}
          onChange={(val) => {
            onChange(val)
            if (val) setUseCamera(false)
          }}
          autoStart={true}
          inlineMode={true}
          onCancel={() => setUseCamera(false)}
        />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="file"
          onChange={handleFile}
          disabled={uploading}
          className="block w-full text-sm text-fg-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-info-subtle file:text-info-fg hover:file:brightness-95 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setUseCamera(true)}
          disabled={uploading}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-surface-2 text-fg hover:bg-surface-3 transition border border-line disabled:opacity-60"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
          </svg>
          Camera
        </button>
      </div>
      {!uploading && !uploadError && <p className="mt-1 text-xs text-fg-subtle">Max {maxMb} MB</p>}
      {uploading && <UploadProgress percent={progress} />}
      {uploadError && <p className="mt-1 text-xs text-danger-fg">{uploadError}</p>}
      {current && !uploading && (
        <p className="mt-1 text-xs flex flex-wrap items-center gap-x-2 gap-y-1 text-success-fg">
          <span>
            Uploaded:{' '}
            <a href={toAbsoluteUrl(current.url)} target="_blank" rel="noreferrer" className="underline hover:brightness-110">
              {current.name}
            </a>
          </span>
          {onRequestPreview && (current.mime?.startsWith('image/') || current.mime === 'application/pdf' || current.name?.match(/\.(pdf|jpe?g|png|webp|gif)$/i)) && (
            <button
              type="button"
              onClick={() => onRequestPreview(current)}
              className="text-fg-muted hover:text-indigo-600 transition flex items-center gap-1 bg-surface-2 px-2 py-0.5 rounded border border-line"
              title="Preview file"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Preview
            </button>
          )}
        </p>
      )}
    </div>
  )
}

function GridCell({ col, value, onChange }) {
  const cls =
    'w-full px-2 py-1 text-sm rounded border border-line bg-surface focus:outline-none focus:ring-1 focus:ring-indigo-300'
  switch (col.type) {
    case 'number':
      return <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
    case 'date':
      return <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
    case 'dropdown':
      return (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">—</option>
          {(col.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )
    default:
      return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
  }
}

function GridField({ field, value, onChange }) {
  const cols = field.columns || []
  const rows = Array.isArray(value) ? value : []

  const addRow = () => onChange([...rows, {}])
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i))
  const setCell = (i, colId, v) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [colId]: v } : r)))

  return (
    <div>
      <div className="overflow-x-auto border border-line rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2">
              {cols.map((c) => (
                <th scope="col" key={c.id} className="px-2 py-1.5 text-left font-medium text-fg-muted border-b border-line whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="w-8 border-b border-line"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-2 py-3 text-center text-xs text-fg-subtle">
                  No rows yet — click “Add row”.
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.id} className="px-2 py-1 border-b border-line align-top">
                    <GridCell col={c} value={row[c.id]} onChange={(v) => setCell(i, c.id, v)} />
                  </td>
                ))}
                <td className="px-1 py-1 border-b border-line text-center align-top">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    title="Remove row"
                    aria-label={`Remove row ${i + 1}`}
                    className="text-fg-subtle hover:text-danger-fg transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-2 px-3 py-1.5 rounded-md border border-dashed border-line text-sm text-fg-muted hover:border-info-line hover:text-info-fg transition"
      >
        + Add row
      </button>
    </div>
  )
}

// Camera field for public forms: uses publicUpload // Similar to CameraCapture in FormFields, but wired to use the public API
function PublicCameraCapture({ token, value, onChange, autoStart, inlineMode = false, onCancel }) {
  const videoRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const [streaming, setStreaming] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [facingMode, setFacingMode] = useState('environment')
  const streamRef = React.useRef(null)
  const isMounted = React.useRef(true)

  useEffect(() => {
    if (streaming && isMounted.current) {
      startCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const current = value && typeof value === 'object' && value.url ? value : null

  async function startCamera() {
    setCameraError('')
    setIsStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } })
      if (!isMounted.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
      streamRef.current = stream
      setStreaming(true)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(console.error)
      }
    } catch {
      if (isMounted.current) {
        setCameraError('Could not access camera. Please allow camera permission or use the file fallback.')
      }
    } finally {
      if (isMounted.current) {
        setIsStarting(false)
      }
    }
  }

  useEffect(() => {
    if (streaming && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(console.error)
    }
  }, [streaming])

  useEffect(() => {
    if (autoStart && !current) {
      startCamera()
    }
    
    // Cleanup camera stream on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setStreaming(false)
  }

  const handleCapture = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d').drawImage(video, 0, 0)
    stopCamera()
    canvas.toBlob(async (blob) => {
      if (!blob) { setUploadError('Failed to capture image'); return }
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      setUploading(true)
      setUploadError('')
      try {
        const saved = await publicUpload(token, file, MAX_UPLOAD_MB)
        onChange(saved)
      } catch (err) {
        setUploadError(err.message || 'Upload failed')
      } finally {
        setUploading(false)
      }
    }, 'image/jpeg', 0.92)
  }

  const handleRetake = () => { onChange(null); startCamera() }

  const handleFallbackFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const saved = await publicUpload(token, file, MAX_UPLOAD_MB)
      onChange(saved)
    } catch (err) {
      setUploadError(err.message || 'Upload failed')
    } finally { setUploading(false) }
  }

  const supportsCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} className="hidden" />
      {current && !streaming ? (
        <div>
          <img src={toAbsoluteUrl(current.url)} alt="Captured" className="w-full max-h-60 object-cover rounded-lg border border-line shadow-sm" />
          <button type="button" onClick={handleRetake} className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 underline">Retake Photo</button>
        </div>
      ) : streaming ? (
        <div className="relative">
          <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-60 object-cover rounded-lg border border-line shadow-sm bg-black" />
          <button
            type="button"
            onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
            className="absolute top-2 right-2 bg-gray-900/50 hover:bg-gray-900/80 text-white p-2 rounded-full backdrop-blur-sm transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 512 512">
              <path d="M350.54,148,318.22,100.86A32,32,0,0,0,291.83,88H220.17a32,32,0,0,0-26.39,12.86L161.46,148H88a40,40,0,0,0-40,40V384a40,40,0,0,0,40,40H424a40,40,0,0,0,40-40V188A40,40,0,0,0,424,148Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32"/>
              <polyline points="124 256 160 220 196 256" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32"/>
              <path d="M160,220V296a64,64,0,0,0,64,64h60" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32"/>
              <polyline points="388 336 352 372 316 336" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32"/>
              <path d="M352,372V296a64,64,0,0,0-64-64H228" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="32"/>
            </svg>
          </button>
          <button type="button" onClick={handleCapture} disabled={uploading} className="mt-2 w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow transition disabled:opacity-50">
            {uploading ? 'Uploading…' : ' Capture Photo'}
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              if (onCancel) onCancel()
            }}
            className="mt-1 w-full py-1.5 text-xs text-fg-muted hover:text-fg border border-line rounded-lg transition"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {isStarting ? (
            <div className="w-full py-8 border-2 border-dashed border-line rounded-xl text-fg-muted flex flex-col items-center justify-center gap-3">
              <svg className="w-6 h-6 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-sm font-medium animate-pulse">Requesting camera access...</span>
              {inlineMode && onCancel && (
                <button type="button" onClick={onCancel} className="mt-2 px-3 py-1 text-xs font-medium text-fg-muted hover:text-fg border border-line rounded-lg transition">
                  Cancel
                </button>
              )}
            </div>
          ) : supportsCamera ? (
            <button
              type="button"
              onClick={startCamera}
              disabled={uploading}
              className="w-full py-8 border-2 border-dashed border-line rounded-xl text-fg-muted hover:border-indigo-400 hover:text-indigo-600 transition flex flex-col items-center justify-center gap-2 group"
            >
              <svg className="w-8 h-8 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
              </svg>
              <span className="text-sm font-medium">{cameraError ? 'Retry Camera' : 'Open Camera'}</span>
            </button>
          ) : null}
          {inlineMode && onCancel && !isStarting && (
            <button type="button" onClick={onCancel} className="w-full py-2 text-xs font-medium text-fg-muted hover:text-fg border border-line rounded-lg transition">
              Cancel Camera
            </button>
          )}
          {!inlineMode && (
            <label className="block text-xs text-fg-muted text-center cursor-pointer">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFallbackFile}
                disabled={uploading}
                className="hidden"
              />
              <span className="underline hover:text-fg transition">
                {supportsCamera ? 'Or upload from device' : 'Upload a photo'}
              </span>
            </label>
          )}
        </div>
      )}
      {cameraError && <p className="text-xs text-danger-fg">{cameraError}</p>}
      {uploadError && <p className="text-xs text-danger-fg">{uploadError}</p>}
      {uploading && <p className="text-xs text-fg-muted animate-pulse">Uploading photo…</p>}
    </div>
  )
}

function FieldRow({ token, field, value, onChange, error, onRequestPreview, confidence }) {
  const cls = `${inputCls} ${error ? inputErrorCls : ''}`
  const inputId = fieldDomId(field.id)
  const labelId = `${inputId}-label`
  const errorId = error ? `${inputId}-error` : undefined
  const a11y = {
    id: inputId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': errorId,
  }

  const renderInput = () => {
    switch (field.type) {
      case 'textarea':
        return <textarea {...a11y} rows={4} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || ''} className={`${cls} resize-y`} />
      case 'number':
        return <input {...a11y} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || ''} className={cls} />
      case 'date':
        return <input {...a11y} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls} />
      case 'dropdown':
        return (
          <select {...a11y} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cls}>
            <option value="">— Select —</option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 text-sm text-fg">
            <input {...a11y} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400" />
            <span>{field.placeholder || 'Yes'}</span>
          </label>
        )
      case 'signature':
        return (
          <SignaturePad
            id={inputId}
            onChange={onChange}
            uploadFile={(file) => publicUpload(token, file, MAX_UPLOAD_MB)}
          />
        )
      case 'file':
        return <FileField token={token} value={value} onChange={onChange} maxMb={fieldMaxMb(field)} onRequestPreview={onRequestPreview} />
      case 'radio':
        return (
          <div className="space-y-1.5" role="radiogroup" aria-labelledby={labelId} aria-describedby={errorId}>
            {(field.options || []).map((opt, i) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-fg">
                <input id={i === 0 ? inputId : undefined} type="radio" name={field.id} value={opt} checked={value === opt} onChange={(e) => onChange(e.target.value)} className="w-4 h-4 border-line text-indigo-600 focus:ring-indigo-400" />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        )
      case 'camera':
        return <PublicCameraCapture token={token} value={value} onChange={onChange} />
      case 'grid':
        return <GridField field={field} value={value} onChange={onChange} />
      case 'repeater':
        return <div className="text-xs text-fg-muted italic">This field type isn&apos;t supported here.</div>
      case 'text':
      default:
        if (field.referenceUser) {
          return (
            <ReferenceUserSelect
              a11y={a11y}
              value={value ?? ''}
              onChange={(val) => onChange(val)}
              placeholder={field.placeholder || 'Search users...'}
              className={cls}
            />
          )
        }
        return <input {...a11y} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || ''} className={cls} />
    }
  }

  return (
    <div data-field-row={field.id}>
      <label id={labelId} htmlFor={inputId} className="block text-sm font-medium text-fg mb-1">
        {field.label}
        {field.required && <span className="text-danger-fg ml-0.5" aria-hidden="true">*</span>}
        {confidence && (
          <span className="ml-2 inline-flex rounded-full border border-line bg-surface-2 px-2 py-0.5 align-middle text-[10px] font-semibold text-fg-muted" aria-label={'Auto-fill confidence ' + confidence.confidence + ' percent'}>
            {confidence.confidence}% {confidence.tier}
          </span>
        )}
        {field.required && <span className="sr-only"> (required)</span>}
      </label>
      {renderInput()}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-danger-fg">
          {error}
        </p>
      )}
    </div>
  )
}

// Module scope on purpose: defining this inside PublicForm gives it a new
// component identity on every render, which remounts the whole form and drops
// input focus on each keystroke.
function Page({ children, wide = false }) {
  return (
    <div className="nf-public-form-page min-h-screen bg-[#f5f7fb]">
      <header className="bg-surface/95 backdrop-blur-md border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-2.5">
          <img src="/netflow-icon.png" alt="" className="w-8 h-8 rounded-[10px] shadow-sm" />
          <span><strong className="block font-extrabold text-fg leading-none">NetFlow</strong><small className="block mt-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-warning-fg">Secure form</small></span>
        </div>
      </header>
      <main className={(wide ? 'max-w-6xl' : 'max-w-2xl') + ' mx-auto px-4 sm:px-6 py-8 sm:py-12'}>{children}</main>
      <footer className="max-w-2xl mx-auto px-4 pb-10 text-center text-xs text-fg-subtle">
        Powered by NetFlow · Never submit passwords through this form.
      </footer>
    </div>
  )
}

function PublicForm() {
  const { token } = useParams()

  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [values, setValues] = useState({})
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Start the external request with its pending UI state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch(`${API_BASE}/api/public/forms/${token}`)
      .then(readJson)
      .then((data) => { if (!cancelled) setForm(data.form) })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Failed to load form') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  // Recomputes on value change so conditional show/hide rules resolve live.
  const visibleFields = useMemo(
    () => (form?.fields || []).filter((f) => f.type !== 'repeater' && isFieldVisible(f, values)),
    [form, values]
  )

  const pages = useMemo(() => {
    const maxPage = visibleFields.reduce((max, f) => Math.max(max, f.page || 1), 1)
    const p = []
    for (let i = 1; i <= maxPage; i++) {
      const pageFields = visibleFields.filter(f => (f.page || 1) === i)
      if (pageFields.length > 0) p.push(pageFields)
    }
    if (p.length === 0) p.push([])
    return p
  }, [visibleFields])

  const [currentPage, setCurrentPage] = useState(0)
  const [previewFile, setPreviewFile] = useState(null)
  
  const [pdfExtraction, setPdfExtraction] = useState(null)
  const [confidenceScores, setConfidenceScores] = useState({})
  const availableDocs = useMemo(() => {
    const docs = []
    if (!form?.fields) return docs
    for (const f of form.fields) {
      const v = values[f.id]
      if (v && typeof v === 'object' && v.url && (v.mime?.startsWith('image/') || v.mime === 'application/pdf' || v.name?.match(/\.(pdf|jpe?g|png|webp|gif)$/i))) {
        docs.push({ ...v, fieldLabel: f.label })
      }
    }
    return docs
  }, [form, values])

  if (currentPage >= pages.length && currentPage !== Math.max(0, pages.length - 1)) {
    setCurrentPage(Math.max(0, pages.length - 1))
  }

  const setFieldValue = (fieldId, v) => {
    setValues((prev) => ({ ...prev, [fieldId]: v }))
    setConfidenceScores((previous) => {
      if (!previous[fieldId]) return previous
      const next = { ...previous }
      delete next[fieldId]
      return next
    })
    setFieldErrors((prev) => (prev[fieldId] ? { ...prev, [fieldId]: '' } : prev))
    setSubmitError('')

    // Feature: File Preview Split Screen
    if (v && typeof v === 'object' && v.url && (v.mime?.startsWith('image/') || v.mime === 'application/pdf')) {
      setPreviewFile(v)
    }
  }

  const applyPdfSuggestion = (suggestion) => {
    const field = form?.fields?.find((candidate) => candidate.id === suggestion.fieldId)
    if (!field) return
    setValues((previous) => {
      const current = previous[suggestion.fieldId]
      const occupied = current !== undefined && current !== null && current !== '' && (!Array.isArray(current) || current.length > 0)
      if (occupied || !isFieldVisible(field, previous)) return previous
      setConfidenceScores((scores) => ({ ...scores, [suggestion.fieldId]: suggestion }))
      return { ...previous, [suggestion.fieldId]: suggestion.value }
    })
  }


  const validate = (fieldsToValidate) => {
    const errs = {}
    for (const f of fieldsToValidate) {
      const v = values[f.id]
      if (f.required) {
        if (f.type === 'grid') {
          const rows = Array.isArray(v) ? v : []
          const cols = f.columns || []
          const cellEmpty = (cell) => cell === undefined || cell === null || String(cell).trim() === ''
          if (rows.length === 0) errs[f.id] = `${f.label} needs at least one row`
          else if (rows.some((r) => cols.some((c) => cellEmpty(r[c.id])))) errs[f.id] = `Fill every cell in ${f.label}`
          continue
        }
        const isEmpty = f.type === 'signature'
          ? isSignatureEmpty(v)
          : (v === undefined || v === null || v === '' || (f.type === 'checkbox' && v === false))
        if (isEmpty) {
          errs[f.id] = `${f.label} is required`
          continue
        }
      }
      // Advanced rules (length/range/pattern) apply to filled fields, required or not.
      const adv = validateField(f, v)
      if (adv) errs[f.id] = adv
    }
    return errs
  }

  const handleNext = () => {
    setSubmitError('')
    const errs = validate(pages[currentPage])
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      focusFirstError(pages[currentPage], errs)
      return
    }
    setCurrentPage((p) => p + 1)
  }

  const handlePrev = () => {
    setSubmitError('')
    setCurrentPage((p) => Math.max(0, p - 1))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError('')

    if (currentPage < pages.length - 1) {
      handleNext()
      return
    }

    const errs = validate(visibleFields.filter(f => f.type !== 'page_break'))
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      const errPageIdx = pages.findIndex(p => p.some(f => errs[f.id]))
      if (errPageIdx !== -1 && errPageIdx !== currentPage) {
        setCurrentPage(errPageIdx)
        setTimeout(() => focusFirstError(pages[errPageIdx], errs), 0)
      } else {
        focusFirstError(pages[currentPage], errs)
      }
      return
    }

    if (pdfExtraction?.jobId && pdfExtraction.reviewConfirmed !== true) {
      setSubmitError('Review and confirm the PDF auto-filled information before submitting.')
      return
    }

    setSubmitting(true)
    try {
      // Only send currently-visible fields (a value entered then hidden by a
      // rule change must not leak into the response).
      const payload = stripHiddenValues(visibleFields, values)
      const uploadedPayload = payload
      const res = await fetch(`${API_BASE}/api/public/forms/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formData: uploadedPayload, submitter: { name, email }, ...(pdfExtraction ? { extraction: pdfExtraction } : {}) })
      })
      await readJson(res)
      setDone(true)
    } catch (err) {
      setSubmitError(err.message || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const resetForAnother = () => {
    setValues({})
    setName('')
    setEmail('')
    setFieldErrors({})
    setSubmitError('')
    setPdfExtraction(null)
    setConfidenceScores({})
    setDone(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) {
    return <Page><div className="bg-surface border border-line rounded-lg p-8 text-center text-sm text-fg-muted">Loading form…</div></Page>
  }

  if (loadError || !form) {
    return (
      <Page>
        <div className="nf-panel p-8 text-center">
          <h1 className="text-lg font-semibold text-fg">Form unavailable</h1>
          <p className="text-sm text-fg-muted mt-1">{loadError || 'This form is not available.'}</p>
        </div>
      </Page>
    )
  }

  if (done) {
    return (
      <Page>
        <div className="nf-panel p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-success-subtle flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-success-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-fg">Thanks — your response was recorded</h1>
          <p className="text-sm text-fg-muted mt-1">You can safely close this page.</p>
          <button
            type="button"
            onClick={resetForAnother}
            className="mt-5 px-4 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition"
          >
            Submit another response
          </button>
        </div>
      </Page>
    )
  }

  return (
    <Page wide={form.autoFill?.enabled === true}>
      <div className="flex flex-col lg:flex-row gap-6 relative">
        
        {/* Form Container */}
        <div className="flex-1 transition-all duration-300">
          <div className="nf-panel overflow-hidden">
            <div className="border-t-4 border-indigo-600 px-5 sm:px-6 pt-5 pb-4 border-b border-line">
              <h1 className="text-xl font-semibold text-fg">{form.title}</h1>
              {form.description && <p className="text-sm text-fg-muted mt-1 whitespace-pre-wrap">{form.description}</p>}
            </div>

            <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5">
          {visibleFields.length === 0 ? (
            <p className="text-sm text-fg-muted text-center py-4">This form has no fields to fill.</p>
          ) : (
            <>
              {currentPage === 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2 border-b border-line">
                  <div>
                    <label htmlFor="public-submitter-name" className="block text-sm font-medium text-fg mb-1">Your name <span className="text-fg-subtle font-normal">(optional)</span></label>
                    <input id="public-submitter-name" name="name" autoComplete="name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Acme Supplies Ltd." />
                  </div>
                  <div>
                    <label htmlFor="public-submitter-email" className="block text-sm font-medium text-fg mb-1">Your email <span className="text-fg-subtle font-normal">(optional)</span></label>
                    <input id="public-submitter-email" name="email" autoComplete="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@company.com" />
                  </div>
                </div>
              )}

              {currentPage === 0 && form.autoFill?.enabled === true && (
                <PdfUploadAutoFill
                  publicToken={token}
                  languageMode={form.autoFill?.languageMode}
                  fields={form.fields || []}
                  values={values}
                  onApply={applyPdfSuggestion}
                  onExtractionChange={setPdfExtraction}
                />
              )}


              {pages.length > 1 && (
                <div className="mb-4 flex items-center justify-between text-xs font-medium text-fg-subtle uppercase tracking-wider">
                  <span>Page {currentPage + 1} of {pages.length}</span>
                  <div className="flex gap-1">
                    {pages.map((_, i) => (
                      <span key={i} className={`h-1.5 w-6 rounded-full transition-colors ${i === currentPage ? 'bg-indigo-500' : i < currentPage ? 'bg-indigo-200 dark:bg-indigo-900/30' : 'bg-line'}`} />
                    ))}
                  </div>
                </div>
              )}

              {pages[currentPage]?.map((f) => (
                <FieldRow
                  key={f.id}
                  token={token}
                  confidence={confidenceScores[f.id]}
                  field={f}
                  value={values[f.id]}
                  onChange={(v) => setFieldValue(f.id, v)}
                  error={fieldErrors[f.id]}
                  onRequestPreview={(file) => setPreviewFile(file)}
                />
              ))}
            </>
          )}

          {submitError && (
            <div className="p-3 rounded-md bg-danger-subtle border border-danger-line text-sm text-danger-fg">{submitError}</div>
          )}

          {visibleFields.length > 0 && (
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              {currentPage > 0 && (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="px-5 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition mr-auto"
                >
                  Previous
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium shadow-sm transition"
              >
                {currentPage < pages.length - 1 ? 'Next' : (submitting ? 'Submitting…' : 'Submit')}
              </button>
            </div>
          )}
        </form>
      </div>
      </div>

      {/* File Preview Sidebar (Option B) */}
        {previewFile && (
          <div className="hidden lg:block w-[40%] xl:w-[45%] shrink-0 self-stretch">
            <FilePreviewPane 
              file={previewFile} 
              onClose={() => setPreviewFile(null)}
              availableDocs={availableDocs}
              onSelect={(file) => setPreviewFile(file)}
            />
          </div>
        )}
      </div>
    </Page>
  )
}

export default PublicForm
