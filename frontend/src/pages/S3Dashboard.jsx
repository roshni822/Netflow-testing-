import { useState, useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { useUser } from '../utils/auth'
import { toast } from '../lib/toastStore'

function IconFolder(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M4 4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2H4z" /></svg> }
function IconCloudUpload(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg> }
function IconTrash(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> }
function IconDownload(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg> }
function IconArrowLeft(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg> }
function IconEye(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> }

function S3Metric({ label, value, meta, icon, tone = 'blue' }) {
  const tones = {
    blue: 'bg-indigo-50 text-indigo-700',
    green: 'bg-success-subtle text-success-fg',
    gold: 'bg-warning-subtle text-warning-fg',
    purple: 'bg-violet-50 text-violet-700 dark:bg-[#39344a] dark:text-[#b3a9d2]',
  }
  const corners = { blue: 'bg-indigo-50', green: 'bg-success-subtle', gold: 'bg-warning-subtle', purple: 'bg-violet-50 dark:bg-[#39344a]' }
  return <div className="nf-panel relative min-h-[142px] overflow-hidden px-[18px] py-4"><span aria-hidden="true" className={`absolute -right-[25px] -bottom-[48px] h-[98px] w-[98px] rounded-full opacity-60 ${corners[tone]}`} /><div className="relative z-10 flex items-start justify-between gap-3"><p className="text-xs font-semibold text-fg-muted">{label}</p><span className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] ${tones[tone]}`}>{icon}</span></div><strong className="relative z-10 mt-5 block text-[28px] font-bold leading-none tabular-nums text-fg">{value}</strong><p className="relative z-10 mt-2 text-[11px] text-fg-muted">{meta}</p></div>
}

// Helper to format bytes
const formatBytes = (bytes) => {
  const n = Number(bytes || 0)
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// Helper to get file icon based on mime/extension
const getFileIcon = (filename) => {
  const ext = String(filename).split('.').pop().toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )
  }
  if (['pdf'].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    )
  }
  if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    )
  }
  if (['txt', 'md', 'html', 'css', 'js', 'json', 'jsx'].includes(ext)) {
    return (
      <svg className="w-5 h-5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  }
  return (
    <svg className="w-5 h-5 text-fg-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  )
}

export default function S3Dashboard() {
  const currentUser = useUser()
  const [folders, setFolders] = useState([])
  const [files, setFiles] = useState([])
  const [currentPrefix, setCurrentPrefix] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [snapshotAt, setSnapshotAt] = useState(() => Date.now())
  const fileInputRef = useRef(null)

  const fetchContents = async (prefix = '') => {
    setLoading(true)
    try {
      const res = await api.get(`/api/s3/list?prefix=${encodeURIComponent(prefix)}&t=${Date.now()}`)
      if (res) {
        setFolders(res.folders || [])
        setFiles(res.files || [])
        setSnapshotAt(Date.now())
        setConnectionError(false)
      }
    } catch (err) {
      console.error(err)
      setConnectionError(true)
      setFolders([])
      setFiles([])
      toast.error(err.message || 'Failed to connect to S3. Check credentials.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Start the external request with its pending UI state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContents(currentPrefix)
  }, [currentPrefix])

  const handleUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return
    const file = fileList[0]

    try {
      setUploading(true)
      const key = `${currentPrefix || String(currentUser?.orgId?._id || currentUser?.orgId) + '/'}${file.name}`
      
      const formData = new FormData()
      formData.append('key', key)
      formData.append('file', file)
      
      await api.post('/api/s3/upload', formData)

      const folderName = currentPrefix ? currentPrefix.slice(0, -1) : 'Root'
      toast.success(`File "${file.name}" uploaded to ${folderName}`)
      
      // Wait 1.5 seconds for Cloudflare R2 / S3 eventual consistency to catch up
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      fetchContents(currentPrefix)
    } catch (err) {
      console.error("Upload failed", err)
      toast.error('Failed to upload document')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleView = async (key) => {
    try {
      const res = await api.get(`/api/s3/download?key=${encodeURIComponent(key)}`)
      window.open(res.url, '_blank')
    } catch  {
      toast.error('Failed to open file')
    }
  }

  const handleDownload = async (key, name) => {
    try {
      const res = await api.get(`/api/s3/download?key=${encodeURIComponent(key)}`)
      const a = document.createElement('a')
      a.href = res.url
      a.download = name
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch  {
      toast.error('Failed to download file')
    }
  }

  const handleDelete = async (key) => {
    if (!window.confirm('Are you sure you want to delete this file?')) return
    try {
      await api.post('/api/s3/delete', { key })
      toast.success('File deleted')
      
      // Wait for eventual consistency
      await new Promise(resolve => setTimeout(resolve, 1000))
      fetchContents(currentPrefix)
    } catch  {
      toast.error('Failed to delete file')
    }
  }

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }
 
  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files)
    }
  }

  const goUp = () => {
    const parts = currentPrefix.split('/').filter(Boolean)
    parts.pop()
    setCurrentPrefix(parts.length ? parts.join('/') + '/' : '')
  }

  // Calculate local stats based on the current loaded folder
  const totalFiles = files.length
  const totalBytes = files.reduce((acc, file) => acc + (file.size || 0), 0)
  const recentlyModified = files.filter((file) => file.lastModified && (snapshotAt - new Date(file.lastModified).getTime()) <= 30 * 86400000).length

  return (
    <AppShell
      title="S3 storage"
      subtitle="Browse connected bucket content and object metadata without exposing provider credentials."
      actions={<button type="button" onClick={() => fetchContents(currentPrefix)} disabled={loading} className="nf-button nf-button-primary"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>}
      mainClass="flex-1 min-h-0 flex flex-col p-4 md:p-6 pb-24 md:pb-6 overflow-hidden"
    >
      <div className="flex-1 min-h-0 flex flex-col gap-6 overflow-hidden max-w-7xl mx-auto w-full">
        
        {/* Connection status header */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-surface border border-line rounded-xl shadow-sm">
          <div className="flex items-center gap-3">
            {connectionError ? (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
            ) : (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
            <div>
              <h2 className="text-sm font-semibold text-fg">S3 Storage Status: {connectionError ? 'Disconnected' : 'Connected'}</h2>
              <p className="text-xs text-fg-subtle mt-0.5 font-mono">
                Bucket: {currentUser?.s3Bucket || 'N/A'} · 
                Region: {currentUser?.s3Region || 'N/A'} 
              </p>
            </div>
          </div>
        </div>

        {/* Storage Metrics */}
        <div className="shrink-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <S3Metric label="Objects" value={totalFiles.toLocaleString()} meta="Current folder" icon={<svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>} />
          <S3Metric label="Folders" value={folders.length.toLocaleString()} meta="Current path" tone="purple" icon={<IconFolder className="h-[18px] w-[18px]" />} />
          <S3Metric label="Storage used" value={formatBytes(totalBytes)} meta="Current folder" tone="green" icon={<svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.58 4 8 4s8-1.79 8-4M4 7c0-2.21 3.58-4 8-4s8 1.79 8 4" /></svg>} />
          <S3Metric label="Modified recently" value={recentlyModified.toLocaleString()} meta="Last 30 days" tone="gold" icon={<svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" /></svg>} />
        </div>

        {/* Explorer interface */}
        {connectionError ? (
          <div className="flex-1 bg-surface border border-line rounded-xl flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-xl bg-danger-subtle/50 text-danger-fg flex items-center justify-center mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="font-semibold text-fg text-base">S3 Storage Connection Error</h3>
            <p className="text-sm text-fg-subtle mt-2 max-w-md">Failed to connect to AWS S3 bucket. Ensure your S3 integration configurations are correct.</p>
            <button
              onClick={() => fetchContents(currentPrefix)}
              className="mt-6 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow text-sm font-semibold transition"
            >
              Retry Connection
            </button>
          </div>
        ) : loading ? (
          <div className="flex-1 bg-surface border border-line rounded-xl p-6 space-y-4 animate-pulse">
            <div className="h-6 bg-surface-3 rounded w-1/4"></div>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="space-y-2">
                <div className="h-10 bg-surface-3 rounded"></div>
                <div className="h-10 bg-surface-3 rounded"></div>
                <div className="h-10 bg-surface-3 rounded"></div>
              </div>
              <div className="lg:col-span-3 space-y-3">
                <div className="h-10 bg-surface-3 rounded"></div>
                <div className="h-20 bg-surface-3 rounded"></div>
                <div className="h-20 bg-surface-3 rounded"></div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-4 gap-6 overflow-hidden">
            {/* Sidebar Folder Navigation */}
            <div className="bg-surface border border-line rounded-xl p-4 flex flex-col overflow-y-auto">
              <h3 className="text-xs font-bold text-fg-subtle uppercase tracking-wider mb-3">Folders</h3>
              
              <div className="space-y-1">
                {currentPrefix !== '' && (
                  <button
                    onClick={goUp}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition text-fg-muted hover:bg-surface-2"
                  >
                    <IconArrowLeft className="w-4 h-4 text-indigo-500" />
                    <span className="truncate">Go Up</span>
                  </button>
                )}
                
                <button
                    onClick={() => setCurrentPrefix('')}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition ${
                      currentPrefix === ''
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-fg-muted hover:bg-surface-2'
                    }`}
                  >
                    <IconFolder className={`w-4 h-4 ${currentPrefix === '' ? 'text-white' : 'text-indigo-500'}`} />
                    <span className="truncate">Root Directory</span>
                </button>

                {folders.map(folder => (
                  <button
                    key={folder.path}
                    onClick={() => setCurrentPrefix(folder.path)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition ${
                      currentPrefix === folder.path
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-fg-muted hover:bg-surface-2'
                    }`}
                  >
                    <IconFolder className={`w-4 h-4 ${currentPrefix === folder.path ? 'text-white' : 'text-indigo-500'}`} />
                    <span className="truncate">{folder.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* File explorer core */}
            <div className="lg:col-span-3 flex flex-col gap-4 min-h-0">
              {/* Breadcrumb Info */}
              {currentPrefix !== '' && (
                <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-surface border border-line rounded-xl text-sm font-medium text-fg shadow-sm">
                  <IconFolder className="w-4 h-4 text-amber-500" />
                  <span>{currentPrefix.slice(0, -1)}</span>
                </div>
              )}

              {/* Uploader drag and drop */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`shrink-0 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center ${
                  dragActive
                    ? 'border-indigo-500 bg-indigo-500/5'
                    : 'border-line hover:border-indigo-500/50 hover:bg-surface-2/30'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => handleUpload(e.target.files)}
                  className="hidden"
                />
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-2">
                  <IconCloudUpload className="w-5 h-5" />
                </div>
                {uploading ? (
                  <p className="text-xs text-fg-subtle animate-pulse font-medium">Uploading file directly to S3 Cloud...</p>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-fg">Drag and drop file here or click to browse</p>
                    <p className="text-[10px] text-fg-subtle mt-1">Upload files to <span className="font-bold">{currentPrefix ? currentPrefix.slice(0, -1) : 'Root'}</span></p>
                  </>
                )}
              </div>

              {/* Files Table / Empty state */}
              <div className="flex-1 bg-surface border border-line rounded-xl overflow-hidden flex flex-col min-h-0 shadow-sm">
                <div className="overflow-x-auto flex-1 min-h-0">
                  {files.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center min-h-[250px]">
                      <div className="w-12 h-12 rounded-full bg-surface-3 text-fg-subtle flex items-center justify-center mb-3">
                        <IconFolder className="w-6 h-6" />
                      </div>
                      <h4 className="font-semibold text-fg text-sm">No files in this folder</h4>
                      <p className="text-xs text-fg-subtle mt-1">Files uploaded to S3 in this virtual folder will show up here.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-surface-2 border-b border-line z-10">
                        <tr>
                          <th className="p-3.5 font-bold text-fg-subtle uppercase tracking-wider w-1/2">Name</th>
                          <th className="p-3.5 font-bold text-fg-subtle uppercase tracking-wider">Size</th>
                          <th className="p-3.5 font-bold text-fg-subtle uppercase tracking-wider">Modified</th>
                          <th className="p-3.5 font-bold text-fg-subtle uppercase tracking-wider text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {files.map(file => (
                          <tr key={file.path} className="hover:bg-surface-2/40 transition">
                            <td className="p-3.5 font-medium text-fg flex items-center gap-3 min-w-0">
                              <span className="shrink-0">{getFileIcon(file.name)}</span>
                              <span className="truncate" title={file.name}>{file.name}</span>
                            </td>
                            <td className="p-3.5 text-fg-subtle font-mono">{formatBytes(file.size)}</td>
                            <td className="p-3.5 text-fg-subtle">
                              {file.lastModified ? new Date(file.lastModified).toLocaleString() : '—'}
                            </td>
                            <td className="p-3.5 text-right space-x-1 whitespace-nowrap">
                              <button
                                onClick={() => handleView(file.path)}
                                className="inline-flex items-center justify-center p-2 text-indigo-600 hover:bg-indigo-500/10 rounded-xl transition"
                                title="View File"
                              >
                                <IconEye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDownload(file.path, file.name)}
                                className="inline-flex items-center justify-center p-2 text-indigo-600 hover:bg-indigo-500/10 rounded-xl transition"
                                title="Download File"
                              >
                                <IconDownload className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(file.path)}
                                className="inline-flex items-center justify-center p-2 text-danger-fg hover:bg-danger-subtle/20 rounded-xl transition"
                                title="Delete File"
                              >
                                <IconTrash className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
