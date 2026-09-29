import { SIGNATURE_FONTS, fieldDomId } from './formFieldHelpers'
// Shared form-field primitives used by both the standalone form filler
// (FillForm) and Submit-node task forms (TaskDetail). Keeps a single source of
// truth for field rendering, file upload, e-signature capture, and validation.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, toAbsoluteUrl, resolveAttachmentHref } from '../utils/api'
import { fieldMaxMb, MAX_UPLOAD_MB } from '../utils/uploads'

const inputCls =
  'w-full px-3 py-2 text-sm rounded-md border border-line bg-surface text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition'
const inputErrorCls = 'border-red-400 focus:ring-red-200 focus:border-red-400'

// Field types a designer can drop into a Submit-node form.





// Handwriting/signature fonts. These live on Adobe Fonts (Typekit), so they only
// render when an Adobe Fonts kit exposing these families is loaded (see
// index.html). Each falls back to the generic `cursive` so a script-like style
// still shows if the kit isn't present.


// Renders a stored signature: typed text, uploaded image, or drawn pad PNG.
export function SignatureMark({ signature, className = '' }) {
  if (!signature) return null
  if ((signature.kind === 'uploaded' || signature.kind === 'drawn') && signature.url) {
    return (
      <img
        src={toAbsoluteUrl(signature.url)}
        alt="e-signature"
        className={`max-h-12 rounded border border-line bg-surface p-0.5 ${className}`}
      />
    )
  }
  // Legacy uploads without kind still have a url.
  if (signature.url && !signature.text) {
    return (
      <img
        src={toAbsoluteUrl(signature.url)}
        alt="e-signature"
        className={`max-h-12 rounded border border-line bg-surface p-0.5 ${className}`}
      />
    )
  }
  if (signature.kind === 'typed' && signature.text) {
    return (
      <span
        className={`block text-fg ${className}`}
        style={{ fontFamily: signature.font || 'cursive', fontSize: '20px', lineHeight: 1.3 }}
      >
        {signature.text}
      </span>
    )
  }
  return null
}

// True when a signature field value is missing or incomplete.
// Accepts structured pads ({ text } / { url }) and legacy plain strings.


const DRAW_H = 140

// E-signature capture: Type (font), Draw (canvas pen), or Upload image.
// Lifts via onChange —
// { kind:'typed', text, font } | { kind:'uploaded'|'drawn', url, name } | null.
// Public forms upload immediately through uploadFile; signed-in forms defer upload until submission.
export function SignaturePad({ onChange, disabled, label, id, uploadFile }) {
  const [mode, setMode] = useState('type')
  const [text, setText] = useState('')
  const [font, setFont] = useState(SIGNATURE_FONTS[0].value)
  const [uploaded, setUploaded] = useState(null)
  const [drawn, setDrawn] = useState(null)
  const [hasInk, setHasInk] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const drawingRef = useRef(false)
  const lastRef = useRef(null)
  const hasInkRef = useRef(false)
  const exportTimer = useRef(null)
  const exportGen = useRef(0)

  const clearExportTimer = () => {
    if (exportTimer.current) {
      clearTimeout(exportTimer.current)
      exportTimer.current = null
    }
  }

  const paintBlank = useCallback((ctx, w, h) => {
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.restore()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2.2
  }, [])

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(wrap.clientWidth, 1)
    const h = DRAW_H
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintBlank(ctx, w, h)
    hasInkRef.current = false
    setHasInk(false)
  }, [paintBlank])

  useEffect(() => {
    if (mode !== 'draw') return undefined
    setupCanvas()
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      // Resizing wipes ink; avoid fighting an in-progress stroke.
      if (drawingRef.current) return
      const had = hasInkRef.current
      setupCanvas()
      if (had) {
        setDrawn(null)
        clearExportTimer()
      }
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [mode, setupCanvas])

  useEffect(() => () => clearExportTimer(), [])

  useEffect(() => {
    let sig = null
    if (mode === 'type' && text.trim()) sig = { kind: 'typed', text: text.trim(), font }
    else if (mode === 'upload' && uploaded) {
      sig = {
        ...uploaded, kind: 'uploaded',
      }
    } else if (mode === 'draw' && drawn) {
      sig = {
        ...drawn, kind: 'drawn',
      }
    }
    onChange(sig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, text, font, uploaded, drawn])

  const switchMode = (next) => {
    if (disabled || next === mode) return
    clearExportTimer()
    setErr('')
    if (mode === 'draw' || next === 'draw') {
      setDrawn(null)
      hasInkRef.current = false
      setHasInk(false)
    }
    setMode(next)
  }

  const persistDrawnBlob = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !hasInkRef.current || disabled) return
    const gen = ++exportGen.current
    setUploading(true)
    setErr('')
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob || gen !== exportGen.current) return
      const file = new File([blob], `signature-${Date.now()}.png`, { type: 'image/png' })
      const saved = uploadFile ? await uploadFile(file) : { pending: true, file, url: URL.createObjectURL(blob), name: file.name }
      if (gen !== exportGen.current) return
      setDrawn(saved)
    } catch (e2) {
      if (gen === exportGen.current) setErr(e2.message || 'Could not save signature')
    } finally {
      if (gen === exportGen.current) setUploading(false)
    }
  }, [disabled, uploadFile])

  const scheduleExport = useCallback(() => {
    clearExportTimer()
    exportTimer.current = setTimeout(() => {
      exportTimer.current = null
      persistDrawnBlob()
    }, 400)
  }, [persistDrawnBlob])

  const pointFromEvent = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e) => {
    if (disabled) return
    const canvas = canvasRef.current
    const pt = pointFromEvent(e)
    if (!canvas || !pt) return
    e.preventDefault()
    canvas.setPointerCapture?.(e.pointerId)
    drawingRef.current = true
    lastRef.current = pt
    const ctx = canvas.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(pt.x, pt.y)
    ctx.lineTo(pt.x + 0.01, pt.y + 0.01)
    ctx.stroke()
    hasInkRef.current = true
    setHasInk(true)
    setDrawn(null)
    clearExportTimer()
  }

  const onPointerMove = (e) => {
    if (!drawingRef.current || disabled) return
    const canvas = canvasRef.current
    const pt = pointFromEvent(e)
    const last = lastRef.current
    if (!canvas || !pt || !last) return
    e.preventDefault()
    const ctx = canvas.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    lastRef.current = pt
  }

  const endStroke = (e) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastRef.current = null
    try { canvasRef.current?.releasePointerCapture?.(e.pointerId) } catch { /* noop */ }
    if (hasInkRef.current) scheduleExport()
  }

  const clearDraw = () => {
    if (disabled) return
    clearExportTimer()
    exportGen.current += 1
    setupCanvas()
    setDrawn(null)
    setErr('')
    setUploading(false)
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setErr('')
    if (!file.type.startsWith('image/')) {
      setErr('Please upload an image file.')
      e.target.value = ''
      return
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setErr(`File too large. Max ${MAX_UPLOAD_MB} MB.`)
      e.target.value = ''
      return
    }
    setUploading(true)
    try {
      const saved = uploadFile ? await uploadFile(file) : { pending: true, file, url: URL.createObjectURL(file), name: file.name }
      setUploaded(saved)
    } catch (e2) {
      setErr(e2.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const tabCls = (m) =>
    `px-2.5 py-1 transition ${mode === m ? 'bg-indigo-600 text-white' : 'bg-surface text-fg-muted hover:bg-surface-2'}`

  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="border border-line rounded-md p-3 bg-surface-2/60 focus:outline-none"
    >
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        {label ? <span className="text-xs font-semibold text-fg">{label}</span> : <span />}
        <div className="flex rounded-md border border-line overflow-hidden text-xs">
          <button type="button" onClick={() => switchMode('type')} disabled={disabled} className={tabCls('type')}>
            Type
          </button>
          <button type="button" onClick={() => switchMode('draw')} disabled={disabled} className={tabCls('draw')}>
            Draw
          </button>
          <button type="button" onClick={() => switchMode('upload')} disabled={disabled} className={tabCls('upload')}>
            Upload
          </button>
        </div>
      </div>

      {mode === 'type' && (
        <>
          <input
            type="text"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your full name"
            className={inputCls}
          />
          <select
            value={font}
            disabled={disabled}
            onChange={(e) => setFont(e.target.value)}
            className={`${inputCls} mt-2`}
          >
            {SIGNATURE_FONTS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          {text.trim() && (
            <div className="mt-2 px-3 py-2 bg-surface border border-dashed border-line rounded-md">
              <span style={{ fontFamily: font, fontSize: '26px', lineHeight: 1.2 }} className="text-fg">
                {text}
              </span>
            </div>
          )}
        </>
      )}

      {mode === 'draw' && (
        <div>
          <div
            ref={wrapRef}
            className={`relative w-full rounded-md border-2 border-dashed border-line bg-white overflow-hidden ${disabled ? 'opacity-60' : ''}`}
          >
            <canvas
              ref={canvasRef}
              className={`block w-full ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
              style={{ height: DRAW_H, touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-fg-subtle">
              {uploading
                ? 'Saving signature…'
                : hasInk
                  ? (drawn ? 'Signature saved' : 'Sign with mouse, finger, or stylus')
                  : 'Sign with mouse, finger, or stylus'}
            </p>
            <button
              type="button"
              onClick={clearDraw}
              disabled={disabled || (!hasInk && !drawn)}
              className="px-2.5 py-1 text-xs font-medium rounded-md border border-line text-fg-muted hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {mode === 'upload' && (
        <>
          <label className="flex items-center gap-3">
            <span className={`px-3 py-2 rounded-md border border-line bg-surface text-sm font-medium text-fg ${disabled ? 'opacity-60' : 'hover:bg-surface-2 cursor-pointer'}`}>
              {uploading ? 'Uploading…' : uploaded ? 'Replace image' : 'Choose image'}
            </span>
            <input type="file" accept="image/*" onChange={handleFile} disabled={disabled || uploading} className="hidden" />
            <span className="text-[11px] text-fg-subtle">Max {MAX_UPLOAD_MB} MB</span>
          </label>
          {uploaded && <SignatureMark signature={{ kind: 'uploaded', url: uploaded.url }} className="mt-2" />}
        </>
      )}
      {err && <p className="mt-2 text-xs text-danger-fg">{err}</p>}
    </div>
  )
}

// Uploads the chosen file to /api/uploads and stores { name, url, mime, size }
// as the field value, so it can later be opened as a real attachment.
// Shared progress readout: a determinate bar when the browser reports totals,
// an indeterminate shimmer otherwise. Big attachments used to show nothing but
// the word "Uploading…" for a minute.
export function UploadProgress({ percent }) {
  const known = typeof percent === 'number'
  return (
    <div className="mt-1.5">
      <div
        className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? percent : undefined}
      >
        <div
          className={`h-full rounded-full bg-info-solid transition-[width] duration-150 ${known ? '' : 'animate-pulse w-1/3'}`}
          style={known ? { width: `${percent}%` } : undefined}
        />
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {known ? `Uploading… ${percent}%` : 'Uploading…'}
      </p>
    </div>
  )
}

export function FileField({ value, onChange, maxMb = MAX_UPLOAD_MB, disabled, onRequestPreview }) {
  const [uploading, ] = useState(false)
  const [progress, ] = useState(null)
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
    setUploadError('')
    const url = URL.createObjectURL(file)
    onChange({ pending: true, file, url, name: file.name, size: file.size, mime: file.type })
    e.target.value = ''
  }

  const current = value && typeof value === 'object' && (value.url || value.dmsDocId || value.pending) ? value : null

  const openCurrent = async (e) => {
    e.preventDefault()
    if (!current) return
    const href = await resolveAttachmentHref(current)
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
  }

  if (useCamera) {
    return (
      <div className="space-y-2">
        <CameraCapture
          value={value}
          onChange={(val) => {
            onChange(val)
            if (val) setUseCamera(false)
          }}
          disabled={disabled}
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
          disabled={uploading || disabled}
          className="block w-full text-sm text-fg-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-info-subtle file:text-info-fg hover:file:brightness-95 disabled:opacity-60"
        />
        {!disabled && (
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
        )}
      </div>
      {!uploading && !uploadError && <p className="mt-1 text-xs text-fg-subtle">Max {maxMb} MB</p>}
      {uploading && <UploadProgress percent={progress} />}
      {uploadError && <p className="mt-1 text-xs text-danger-fg">{uploadError}</p>}
      {current && !uploading && (
        <p className="mt-1 text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={current.pending ? "text-fg" : "text-success-fg"}>
            {current.pending ? 'Ready to submit:' : 'Uploaded:'}{' '}
            <a href={toAbsoluteUrl(current.url) || '#'} onClick={openCurrent} target="_blank" rel="noreferrer" className="underline hover:brightness-110">
              {current.name || 'file'}
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
          {current.dmsDocId ? (
            <a href={toAbsoluteUrl(current.url) || '#'} onClick={openCurrent} target="_blank" rel="noreferrer" className="underline text-fg-muted hover:text-fg">
              Open in DMS
            </a>
          ) : null}
        </p>
      )}
    </div>
  )
}

// Camera capture field: opens a live video stream, lets the user snap a photo,
// previews it locally, uploads it upon confirmation, and stores { name, url, mime, size }.
export function CameraCapture({ value, onChange, disabled, autoStart, inlineMode = false, onCancel }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [streaming, setStreaming] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [uploading, ] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [facingMode, setFacingMode] = useState('environment')
  
  // Preview state
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  const streamRef = useRef(null)
  const isMounted = useRef(true)

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
    } catch  {
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
    if (autoStart && !disabled && !current && !previewUrl) {
      startCamera()
    }

    // Cleanup camera stream and object URLs on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
    // We only want to auto-start once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setStreaming(false)
  }

  const handleCapture = async () => {
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
      const url = URL.createObjectURL(blob)
      setPreviewFile(file)
      setPreviewUrl(url)
    }, 'image/jpeg', 0.92)
  }

  const handleConfirmPreview = () => {
    if (!previewFile) return
    onChange({ pending: true, file: previewFile, url: previewUrl, name: previewFile.name, size: previewFile.size, mime: previewFile.type })
    setPreviewFile(null)
    setPreviewUrl(null)
  }

  const handleDiscardPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewFile(null)
    setPreviewUrl(null)
    setUploadError('')
    startCamera()
  }

  const handleRetake = () => {
    onChange(null)
    startCamera()
  }

  // Fallback: native file input accepting images
  const handleFallbackFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError('')
    const url = URL.createObjectURL(file)
    onChange({ pending: true, file, url, name: file.name, size: file.size, mime: file.type })
  }

  const supportsCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} className="hidden" />

      {current && !streaming && !previewUrl ? (
        <div className="relative">
          <img
            src={toAbsoluteUrl(current.url)}
            alt="Captured photo"
            className="w-full max-h-60 object-cover rounded-lg border border-line shadow-sm"
          />
          {!disabled && (
            <button
              type="button"
              onClick={handleRetake}
              className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 underline"
            >
              Retake Photo
            </button>
          )}
        </div>
      ) : previewUrl ? (
        <div className="relative">
          <img
            src={previewUrl}
            alt="Preview photo"
            className="w-full max-h-60 object-cover rounded-lg border border-line shadow-sm"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={handleConfirmPreview}
              disabled={uploading}
              className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow transition disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Confirm & Upload'}
            </button>
            <button
              type="button"
              onClick={handleDiscardPreview}
              disabled={uploading}
              className="py-2 px-4 bg-surface hover:bg-surface-2 text-fg border border-line text-sm font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
            >
              Discard
            </button>
          </div>
          {uploadError && <p className="mt-2 text-xs text-danger-fg">{uploadError}</p>}
        </div>
      ) : streaming ? (
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label="Live camera preview"
            className="w-full max-h-60 object-cover rounded-lg border border-line shadow-sm bg-black"
          />
          <button
            type="button"
            aria-label="Switch camera"
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
          <button
            type="button"
            onClick={handleCapture}
            className="mt-2 w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow transition"
          >
            Capture Photo
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
              disabled={disabled || uploading}
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
                disabled={disabled || uploading}
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

export function ReferenceUserSelect({ value, onChange, disabled, placeholder, className, a11y }) {
  const [query, setQuery] = useState(value || '')
  const [matches, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const results = open && query.length >= 2 ? matches : []
  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef(null)

  if (!open && query !== (value || '')) setQuery(value || '')

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
        setQuery(value || '')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [value])

  useEffect(() => {
    if (!open || query.length < 2) {
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.get(`/api/users?search=${encodeURIComponent(query)}&limit=10`)
        setResults(res.users || [])
      } catch (err) {
        console.error('Failed to fetch reference users:', err)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, open])

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <input
        {...a11y}
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange('') // Clear value while typing to enforce strict match
          setOpen(true)
        }}
        onFocus={() => {
          if (query.length >= 2) setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && open) e.preventDefault()
        }}
        placeholder={placeholder || 'Search users...'}
        className={className}
        autoComplete="off"
      />
      {open && (loading || results.length > 0 || query.length >= 2) && (
        <ul className="absolute z-50 w-full mt-1 bg-surface border border-line rounded-md shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <li className="px-3 py-2 text-sm text-fg-subtle">Searching...</li>
          ) : results.length > 0 ? (
            results.map((user) => (
              <li
                key={user._id}
                className="px-3 py-2 cursor-pointer hover:bg-surface-2 text-sm flex flex-col"
                onClick={() => {
                  const name = user.name || user.email
                  setQuery(name)
                  onChange(name)
                  setOpen(false)
                }}
              >
                <span className="font-medium text-fg">{user.name}</span>
                <span className="text-xs text-fg-muted">{user.email}</span>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-fg-subtle">No users found</li>
          )}
        </ul>
      )}
    </div>
  )
}

// Renders a single labelled field. `richSignature` swaps the plain typed-name
// signature input for the full SignaturePad (typed-font / image upload).
// `fieldDomId` keeps the label/input/error wiring and the scroll-to-first-error
// lookup in one place — callers only need the field id.


export function FieldRow({ field, value, onChange, error, disabled = false }) {
  if (field.type === 'heading') {
    return (
      <div data-field-row={field.id} className="pt-4 pb-2 border-b border-line mb-4">
        <h3 className="text-lg font-semibold text-fg">{field.label}</h3>
        {field.placeholder && <p className="text-sm text-fg-muted mt-1">{field.placeholder}</p>}
      </div>
    )
  }

  const cls = `${inputCls} ${error ? inputErrorCls : ''}`
  const inputId = fieldDomId(field.id)
  const labelId = `${inputId}-label`
  const errorId = error ? `${inputId}-error` : undefined
  // Inputs that carry the label/error wiring. Checkbox has its own inline
  // label, and the composite fields (file, grid, repeater, signature pad)
  // render their own controls.
  const a11y = {
    id: inputId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': errorId,
  }

  const renderInput = () => {
    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            {...a11y}
            rows={4}
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            className={`${cls} resize-y`}
          />
        )
      case 'number':
        return (
          <input
            {...a11y}
            type="number"
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            className={cls}
          />
        )
      case 'date':
        return (
          <input {...a11y} type={field.includeTime ? "datetime-local" : "date"} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cls} />
        )
      case 'dropdown':
        return (
          <select {...a11y} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cls}>
            <option value="">— Select —</option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )
      case 'checkbox':
        if (field.options && field.options.length > 0) {
          const selectedValues = Array.isArray(value) ? value : []
          return (
            <div className={field.layout === 'horizontal' ? "flex flex-wrap gap-x-6 gap-y-2" : "space-y-1.5"} role="group" aria-labelledby={labelId}>
              {field.options.map((opt, i) => (
                <label key={opt} className="flex items-center gap-2 text-sm text-fg">
                  <input
                    id={i === 0 ? inputId : undefined}
                    type="checkbox"
                    value={opt}
                    checked={selectedValues.includes(opt)}
                    disabled={disabled}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange([...selectedValues, opt])
                      } else {
                        onChange(selectedValues.filter((v) => v !== opt))
                      }
                    }}
                    className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          )
        }
        return (
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              {...a11y}
              type="checkbox"
              checked={!!value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
              className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
            />
            <span>{field.placeholder || 'Yes'}</span>
          </label>
        )
      case 'radio':
        return (
          <div className={field.layout === 'horizontal' ? "flex flex-wrap gap-x-6 gap-y-2" : "space-y-1.5"} role="radiogroup" aria-labelledby={labelId} aria-describedby={errorId}>
            {(field.options || []).map((opt, i) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-fg">
                <input
                  id={i === 0 ? inputId : undefined}
                  type="radio"
                  name={inputId}
                  value={opt}
                  checked={value === opt}
                  disabled={disabled}
                  onChange={(e) => onChange(e.target.value)}
                  className="w-4 h-4 border-line text-indigo-600 focus:ring-indigo-400"
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        )
      case 'signature':
        // Always use the rich pad (typed font / image). `richSignature` is kept
        // for call-site compatibility; plain text is no longer offered.
        return (
          <SignaturePad
            id={inputId}
            onChange={onChange}
            disabled={disabled}
          />
        )
      case 'camera':
        return <CameraCapture value={value} onChange={onChange} disabled={disabled} />
      case 'file':
        return <FileField value={value} onChange={onChange} maxMb={fieldMaxMb(field)} disabled={disabled} />
      case 'repeater':
        return <div className="text-xs text-fg-muted italic">Repeater fields aren&apos;t supported in this view.</div>
      case 'text':
      default:
        if (field.referenceUser) {
          return (
            <ReferenceUserSelect
              a11y={a11y}
              value={value ?? ''}
              disabled={disabled}
              onChange={(val) => onChange(val)}
              placeholder={field.placeholder || 'Search users...'}
              className={cls}
            />
          )
        }
        return (
          <input
            {...a11y}
            type="text"
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            className={cls}
          />
        )
    }
  }

  return (
    <div data-field-row={field.id}>
      <label id={labelId} htmlFor={inputId} className="block text-sm font-medium text-fg mb-1">
        {field.label}
        {field.required && <span className="text-danger-fg ml-0.5" aria-hidden="true">*</span>}
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

// After a failed submit, bring the first offending field into view and focus it
// — otherwise the errors can be several screens below the button.


// Conditional field logic: should a field be shown given the current answers?
// A field carries `conditionalLogic: { enabled, dependsOn, operator, showWhen }`.
// `dependsOn` is the id of an EARLIER field; when the rule doesn't match, the
// field is hidden. Legacy data may store `conditionalLogic` as a bare boolean
// (from the old builder) — that has no rule, so we treat it as always visible.


// Filter a field list down to the ones currently visible (conditional logic
// applied). Recomputes from scratch on every call so chained rules resolve.


// Build a submit payload containing ONLY visible fields, so a value that was
// entered and then hidden by a rule change doesn't leak into the response.


// Ready-made format patterns exposed in the builder (plus a Custom option). The
// key is stored on the field via `validation.pattern` + `validation.patternLabel`.


// Advanced per-field validation (length limits, numeric range, format pattern).
// Reads the canonical nested `field.validation` object, falling back to legacy
// flat props (maxLength/min/max) written by older builder versions. Empty values
// are intentionally NOT validated here — the required-check owns emptiness — so
// optional fields with a rule stay optional. Returns an error string or null.


// Required-field validation shared by FillForm + Submit-node tasks. Returns a
// map of { [fieldId]: errorMessage } for any empty required field, then layers
// advanced validation (length/range/pattern) on top for filled fields.


// Read-only renderer for one submitted form value (shown to downstream viewers).
export function FieldValueView({ field, value }) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-fg-subtle">—</span>
  }
  if ((field.type === 'file' || field.type === 'camera') && typeof value === 'object' && value.url) {
    if (field.type === 'camera') {
      return (
        <img
          src={toAbsoluteUrl(value.url)}
          alt="Captured photo"
          className="max-h-48 rounded-lg border border-line shadow-sm object-contain"
        />
      )
    }
    return (
      <a href={toAbsoluteUrl(value.url)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700 underline">
        {value.name || 'Attachment'}
      </a>
    )
  }
  if (field.type === 'signature') {
    if (typeof value === 'object') return <SignatureMark signature={value} />
    return <span style={{ fontFamily: 'cursive' }}>{value}</span>
  }
  return <span className="text-fg whitespace-pre-wrap">{Array.isArray(value) ? value.join(', ') : String(value)}</span>
}
