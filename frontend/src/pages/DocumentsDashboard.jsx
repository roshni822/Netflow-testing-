import React, { useState, useEffect } from 'react'

import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { confirm } from '../lib/confirmStore'
import { toast } from '../lib/toastStore'
import { usageStore } from '../lib/usageStore'

// ── Icons ──────────────────────────────────────────────────────────────

function IconFolder(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M4 4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2H4z" /></svg> }
function IconFolderOpen(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg> }
function IconCloudUpload(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg> }
function IconCloudDownload(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg> }
function IconSearch(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg> }
function IconFilter(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg> }



function IconSync(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> }
function IconSettings(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg> }
function IconClose(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> }
function IconEye(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> }
function IconChevronDown(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg> }
function IconChevronRight(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg> }

function IconInfo(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> }
function IconMaximize(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg> }
function IconMinimize(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 14h6v6m10-10h-6V4m0 10l7 7M10 10L3 3" /></svg> }
function IconTrash(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> }

function DmsMetric({ label, value, meta, icon: Icon, tone = 'blue' }) {
  const tones = {
    blue: 'bg-indigo-50 text-indigo-700',
    green: 'bg-success-subtle text-success-fg',
    gold: 'bg-warning-subtle text-warning-fg',
    purple: 'bg-violet-50 text-violet-700 dark:bg-[#39344a] dark:text-[#b3a9d2]',
  }
  const corners = {
    blue: 'bg-indigo-50', green: 'bg-success-subtle',
    gold: 'bg-warning-subtle', purple: 'bg-violet-50 dark:bg-[#39344a]',
  }
  return <div className="nf-panel relative min-h-[142px] overflow-hidden px-[18px] py-4"><span aria-hidden="true" className={`absolute -right-[25px] -bottom-[48px] h-[98px] w-[98px] rounded-full opacity-60 ${corners[tone]}`} /><div className="relative z-10 flex items-start justify-between gap-3"><p className="text-xs font-semibold text-fg-muted">{label}</p><span className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></span></div><strong className="relative z-10 mt-5 block text-[28px] font-bold leading-none tabular-nums text-fg">{value}</strong><p className="relative z-10 mt-2 text-[11px] text-fg-muted">{meta}</p></div>
}

// ── File Icons ─────────────────────────────────────────────────────────

const FileIcon = ({ type, className = "w-6 h-6" }) => {
  const colors = {
    PDF: 'text-red-500',
    DOCX: 'text-blue-600',
    XLSX: 'text-emerald-600',
    JPG: 'text-amber-500'
  }
  const color = colors[type] || 'text-gray-500'

  if (type === 'PDF') {
    return <svg className={`${className} ${color}`} viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z" /></svg>
  }
  if (type === 'DOCX') {
    return <svg className={`${className} ${color}`} viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1.8 14H10.5l-1-4.2-1 4.2H6.8l-1.5-6h1.7l.8 4.2 1-4.2h1.4l1 4.2.8-4.2h1.6l-1.4 6zM13 9V3.5L18.5 9H13z" /></svg>
  }
  if (type === 'XLSX') {
    return <svg className={`${className} ${color}`} viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-2.8 14h-1.7l-1.2-3.3-1.2 3.3H5.3l2.1-5-2-4.9h1.7l1 3.2 1-3.2h1.6l-2 4.9 2.1 5zM13 9V3.5L18.5 9H13z" /></svg>
  }
  // Generic Image for JPG
  return <svg className={`${className} ${color}`} viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
}

// ── Header Actions ─────────────────────────────────────────────────────

function DmsHeaderActions({ loading, error, needsLogin, onSync }) {
  const isError = !loading && (!!error || needsLogin);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const res = await api.post('/api/uploads', formData);

      if (res && onSync) {
        onSync(); // Refresh dashboard data after upload
      }
    } catch (err) {
      console.error("Upload failed", err);
      toast.error(err.response?.data?.error || err.message || "Failed to upload document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="hidden sm:flex items-center gap-2 border border-line rounded-lg px-3 py-1.5 bg-surface shadow-sm">
        <span className="text-[10px] font-medium text-fg-subtle">DMS Connection</span>
        <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : isError ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]'}`}></div>
        <span className={`text-xs font-bold ml-1 ${loading ? 'text-amber-500' : isError ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {loading ? 'Checking...' : isError ? (needsLogin ? 'Auth Required' : 'Disconnected') : 'Connected'}
        </span>
      </div>

      <button
        onClick={onSync}
        disabled={loading}
        className="flex cursor-pointer items-center gap-2 border border-line hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 rounded-lg px-3 py-1.5 bg-surface shadow-sm text-xs font-semibold text-fg transition disabled:opacity-50"
      >
        <IconSync className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-500' : 'text-fg-muted'}`} />
        {loading ? 'Syncing...' : 'Sync Now'}
      </button>

      <a
        href="https://base-layer.systems/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 border border-line hover:border-amber-200 dark:hover:border-amber-500/30 hover:bg-amber-50/50 dark:hover:bg-amber-500/10 rounded-lg px-3 py-1.5 bg-surface shadow-sm text-xs font-semibold text-fg transition"
      >
        <IconSettings className="w-3.5 h-3.5 text-fg-muted" />
         DMS Login
      </a>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleUpload}
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
      />
      <button
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-2 border border-line hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 rounded-lg px-3 py-1.5 bg-surface shadow-sm text-xs font-semibold text-fg transition disabled:opacity-50 cursor-pointer text-indigo-600 dark:text-indigo-400"
      >
        {uploading ? <IconSync className="w-3.5 h-3.5 animate-spin" /> : <IconCloudUpload className="w-3.5 h-3.5" />}
        {uploading ? 'Uploading...' : 'Upload'}
      </button>
    </div>
  )
}

// ── FolderNode Component ─────────────────────────────────────────────────
const FolderNode = ({ node, activeFolderId, setActiveFolderId, depth = 0 }) => {
  const [isOpen, setIsOpen] = useState(depth < 1) // Auto open first level
  const hasChildren = node.children && node.children.length > 0

  const handleClick = (e) => {
    e.stopPropagation()
    setActiveFolderId(node._id)
    if (hasChildren) {
      setIsOpen(!isOpen)
    }
  }

  const handleChevronClick = (e) => {
    e.stopPropagation()
    setIsOpen(!isOpen)
  }

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 text-xs font-medium cursor-pointer rounded-md transition ${activeFolderId === node._id ? 'bg-indigo-50 text-indigo-700' : 'text-fg hover:bg-surface-2'}`}
        onClick={handleClick}
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
      >
        {hasChildren ? (
          <div onClick={handleChevronClick} className="hover:bg-black/5 dark:hover:bg-white/10 rounded p-0.5 -ml-1 flex items-center justify-center">
            {isOpen ? <IconChevronDown className="w-3 h-3 text-fg-muted" /> : <IconChevronRight className="w-3 h-3 text-fg-muted" />}
          </div>
        ) : (
          <div className="w-4 h-4 shrink-0" />
        )}
        <IconFolder className={`w-3.5 h-3.5 shrink-0 ${activeFolderId === node._id ? 'text-indigo-700' : 'text-warning-solid'}`} />
        <span className="truncate">{node.name}</span>
      </div>

      {isOpen && hasChildren && (
        <div className="flex flex-col gap-0.5 mt-0.5">
          {node.children.map(child => (
            <FolderNode key={child._id} node={child} activeFolderId={activeFolderId} setActiveFolderId={setActiveFolderId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Dashboard Component ────────────────────────────────────────────────

export default function DocumentsDashboard() {

  const [folders, setFolders] = useState([])
  const [documents, setDocuments] = useState([])
  const [activeDoc, setActiveDoc] = useState(null)
  const [activeDocUrl, setActiveDocUrl] = useState(null)
  const [activeDocUrlLoading, setActiveDocUrlLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState(null)
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false)
  const [isTableMaximized, setIsTableMaximized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ type: 'All', dateRange: 'Anytime' })
  const [tempFilters, setTempFilters] = useState({ type: 'All', dateRange: 'Anytime' })
  const [sortBy, setSortBy] = useState('newest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [realStats, setRealStats] = useState(null)
  const [activeFolderId, setActiveFolderId] = useState(null)

  const now = new Date();
  const uploadedThisMonth = documents.filter(d => {
    const dDate = new Date(d.createdAt);
    return dDate.getMonth() === now.getMonth() && dDate.getFullYear() === now.getFullYear();
  }).length;

  // Top level stats (dynamically generated from docs or real stats if provided)
  const stats = {
    totalDocs: realStats?.documentCount ?? documents.length,
    docsTrend: 'Synced',
    totalFolders: folders.length,
    foldersTrend: 'Synced',
    orgName: realStats?.orgName,
    uploadedMonth: uploadedThisMonth,
    downloadedMonth: realStats?.downloadedMonth ?? null,
  }

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const [folderRes, docRes, statsRes] = await Promise.all([
        api.get('/api/dms/folders'),
        api.get('/api/dms/documents'),
        api.get('/api/dms/stats')
      ])

      let fetchedFolders = folderRes.folders || folderRes.data?.folders || []
      let fetchedDocs = docRes.documents || docRes.data?.documents || []
      let fetchedStats = statsRes.stats || statsRes.data?.stats || null

      setFolders(fetchedFolders)
      setDocuments(fetchedDocs)

      if (fetchedStats) {
        setRealStats(fetchedStats)
        usageStore.invalidate()
      }

    } catch (err) {
      console.error('Failed to load DMS data', err)
      if (err?.code === 'DMS_UNAUTHORIZED' || err.response?.data?.code === 'DMS_UNAUTHORIZED') {
        setNeedsLogin(true)
      } else {
        const msg = err.response?.data?.error || err.message || 'Failed to connect to DMS API. Please check your API key.'
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDmsLogin = async (e) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError(null)
    try {
      await api.post('/api/organization/dms-login', { email: loginEmail, password: loginPassword })
      setNeedsLogin(false)
      loadData()
    } catch (err) {
      setLoginError(err?.data?.message || err?.message || 'Login failed')
    } finally {
      setLoginLoading(false)
    }
  }

  useEffect(() => {
    // Start the external request with its pending UI state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [])

  useEffect(() => {
    if (activeDoc) {
      // Invalidate the previous preview while fetching the selected remote document.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveDocUrl(null)
      setActiveDocUrlLoading(true)
      api.get(`/api/dms/documents/${activeDoc._id}/url?mode=view`)
        .then(data => {
          if (data && data.url) {
            setActiveDocUrl(data.url)
          } else {
            console.error("DMS URL fetch failed:", data)
          }
        })
        .catch(err => console.error("Network error fetching DMS URL:", err))
        .finally(() => setActiveDocUrlLoading(false))
    } else {
      setActiveDocUrl(null)
      setActiveDocUrlLoading(false)
    }
  }, [activeDoc])

  const buildFolderTree = (flatFolders) => {
    const rootFolders = flatFolders.filter(f => !f.parentId)
    const mapChildren = (parent) => {
      const children = flatFolders.filter(f => f.parentId === parent._id)
      return {
        ...parent,
        isOpen: true,
        children: children.map(mapChildren)
      }
    }
    return rootFolders.map(mapChildren)
  }
  const folderTree = buildFolderTree(folders)

  const getDisplayType = (doc) => {
    if (!doc) return 'UNKNOWN';
    const nameExt = doc.name?.split('.').pop()?.toUpperCase();
    if (['PDF', 'DOCX', 'XLSX', 'JPG', 'PNG', 'JPEG'].includes(nameExt)) {
      return nameExt === 'JPEG' || nameExt === 'PNG' ? 'JPG' : nameExt;
    }
    const typeStr = doc.type?.toUpperCase() || '';
    if (typeStr.includes('PDF')) return 'PDF';
    if (typeStr.includes('WORD') || typeStr.includes('DOCX')) return 'DOCX';
    if (typeStr.includes('EXCEL') || typeStr.includes('XLSX')) return 'XLSX';
    if (typeStr.includes('IMAGE') || typeStr.includes('JPG') || typeStr.includes('PNG')) return 'JPG';
    return typeStr;
  }

   const handleDeleteDoc = async (doc, e) => {
    e.stopPropagation()
    const ok = await confirm({
      title: 'Delete Document',
      message: `Are you sure you want to delete "${doc.name}"?\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    
    try {
      // 1. Optimistic Update: UI se document turant hata dein bina reload kiye
      setDocuments(prevDocs => prevDocs.filter(d => d._id !== doc._id))
      
      if (activeDoc?._id === doc._id) {
        setActiveDoc(null)
        setActiveDocUrl(null)
      }

      // 2. Background me API delete call karein bina Loading spinner dikhaye
      await api.delete(`/api/dms/documents/${doc._id}`)

    } catch (err) {
      console.error("Delete failed", err)
      // Agar delete fail ho jata hai, to original data wapas laane ke liye reload kar lein
      loadData() 
      
      if (err?.code === 'DMS_UNAUTHORIZED' || err.response?.data?.code === 'DMS_UNAUTHORIZED') {
        setNeedsLogin(true)
      } else {
        toast.error(err.response?.data?.error || err.message || "Failed to delete document")
      }
    }
  }


  if (loading) {
    return (
      <AppShell title="Documents" subtitle="Browse folders and workflow files using the existing document access rules." mainClass="flex-1 flex flex-col p-4 bg-surface-2">
        <div className="flex-1 flex items-center justify-center text-fg-muted font-medium">Loading documents...</div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Documents"
      subtitle="Browse folders and workflow files using the existing document access rules."
      actions={<DmsHeaderActions loading={loading} error={error} needsLogin={needsLogin} onSync={loadData} />}
      // Provide a rigid flex container that fills the viewport minus the AppShell padding.
      mainClass="flex-1 flex flex-col p-4 md:p-6 pb-24 md:pb-6 h-[calc(100dvh-68px)] min-h-0 overflow-hidden bg-surface-2"
    >
      <div className="flex-1 flex flex-col min-h-0 gap-5">

        {/* Top Metrics Row */}
        {!isTableMaximized && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 shrink-0">
            <DmsMetric label="Documents" value={stats.totalDocs.toLocaleString()} meta={stats.docsTrend} icon={IconFolder} />
            <DmsMetric label="Folders" value={stats.totalFolders.toLocaleString()} meta={stats.foldersTrend} icon={IconFolderOpen} tone="purple" />
            <DmsMetric label="Uploaded" value={stats.uploadedMonth.toLocaleString()} meta="This month" icon={IconCloudUpload} tone="green" />
            <DmsMetric label="Downloaded" value={stats.downloadedMonth == null ? '—' : stats.downloadedMonth.toLocaleString()} meta={stats.downloadedMonth == null ? 'Metric unavailable' : 'This month'} icon={IconCloudDownload} tone="gold" />
          </div>
        )}

        {/* Three Panel Main Layout */}
        <div className="flex-1 min-h-0 flex gap-4">

          {/* Left Panel: Folder Tree */}
          {!isTableMaximized && (
            <div className="w-64 bg-white dark:bg-surface border border-line rounded-xl shadow-sm flex flex-col min-h-0 shrink-0">
              <div className="p-4 border-b border-line flex items-center justify-between shrink-0">
                <h3 className="text-xs font-bold text-fg">Folder Structure</h3>
                <div className="flex items-center gap-2">
                  <button className="text-fg-muted hover:text-fg transition"><IconSync className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-col gap-0.5 mt-2">
                    {folderTree.map(f => (
                      <FolderNode
                        key={f._id}
                        node={f}
                        activeFolderId={activeFolderId}
                        setActiveFolderId={setActiveFolderId}
                        depth={0}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Center Panel: Document List */}
          <div className="flex-1 bg-white dark:bg-surface border border-line rounded-xl shadow-sm flex flex-col min-h-0 min-w-0">
            {/* Breadcrumb & Toolbar */}
            <div className="p-4 border-b border-line shrink-0">
              <div className="text-[11px] font-semibold text-fg-muted mb-3 flex items-center gap-1.5">
                <span
                  className="hover:text-fg cursor-pointer transition"
                  onClick={() => setActiveFolderId(null)}
                >
                  {stats.orgName || 'Organization'}
                </span>
                <span>›</span>
                {activeFolderId ? (
                  <>
                    {/* Render intermediate breadcrumbs if it's a child folder */}
                    {(() => {
                      const activeF = folders.find(f => f._id === activeFolderId)
                      if (!activeF) return null
                      if (activeF.parentId) {
                        const parent = folders.find(f => f._id === activeF.parentId)
                        if (parent) {
                          return (
                            <>
                              <span
                                className="hover:text-fg cursor-pointer transition"
                                onClick={() => setActiveFolderId(parent._id)}
                              >
                                {parent.name}
                              </span>
                              <span>›</span>
                            </>
                          )
                        }
                      }
                      return null
                    })()}
                    <span className="text-fg">{folders.find(f => f._id === activeFolderId)?.name || 'Folder'}</span>
                  </>
                ) : (
                  <span className="text-fg">All Documents</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                  <IconSearch className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search documents by name, type or tags..."
                    className="w-full pl-9 pr-4 py-1.5 text-xs bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <button
                    onClick={() => {
                      if (!showFilters) setTempFilters(filters)
                      setShowFilters(!showFilters)
                    }}
                    className={`flex items-center gap-2 border border-line hover:bg-surface-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition shrink-0 ${showFilters ? 'bg-surface-2 text-fg' : 'text-fg-muted'}`}
                  >
                    <IconFilter className="w-3.5 h-3.5" /> Filters
                  </button>

                  {/* Filters Dropdown */}
                  {showFilters && (
                    <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-surface border border-line rounded-xl shadow-lg z-50 p-4 animate-in fade-in slide-in-from-top-2">
                      <h4 className="text-xs font-bold text-fg mb-3">Filter Documents</h4>

                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] font-bold text-fg-muted uppercase tracking-wider mb-1.5 block">Document Type</label>
                          <select
                            className="w-full text-xs bg-surface border border-line rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            value={tempFilters.type}
                            onChange={(e) => setTempFilters({ ...tempFilters, type: e.target.value })}
                          >
                            <option value="All">All Types</option>
                            {[...new Set(documents.map(d => d.type).filter(Boolean))].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-fg-muted uppercase tracking-wider mb-1.5 block">Date Added</label>
                          <select
                            className="w-full text-xs bg-surface border border-line rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            value={tempFilters.dateRange}
                            onChange={(e) => setTempFilters({ ...tempFilters, dateRange: e.target.value })}
                          >
                            <option value="Anytime">Anytime</option>
                            <option value="Last 7 Days">Last 7 Days</option>
                            <option value="Last 30 Days">Last 30 Days</option>
                            <option value="This Year">This Year</option>
                          </select>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-line flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setFilters({ type: 'All', dateRange: 'Anytime' })
                            setTempFilters({ type: 'All', dateRange: 'Anytime' })
                            setShowFilters(false)
                          }}
                          className="text-xs font-medium text-fg-muted hover:text-fg transition px-3 py-1.5"
                        >
                          Reset
                        </button>
                        <button
                          onClick={() => {
                            setFilters(tempFilters)
                            setShowFilters(false)
                          }}
                          className="nf-button nf-button-primary min-h-8 px-3 text-xs"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <div
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    className="flex items-center gap-2 shrink-0 cursor-pointer hover:bg-surface-2 px-2 py-1.5 rounded-lg transition"
                  >
                    <span className="text-xs text-fg-muted font-medium hidden md:inline">Sort: <strong className="text-fg">{
                      sortBy === 'newest' ? 'Newest First' :
                        sortBy === 'oldest' ? 'Oldest First' :
                          sortBy === 'nameAsc' ? 'Name (A-Z)' :
                            sortBy === 'nameDesc' ? 'Name (Z-A)' :
                              sortBy === 'sizeDesc' ? 'Size (Largest)' :
                                'Size (Smallest)'
                    }</strong></span>
                    <IconChevronDown className="w-3 h-3 text-fg-muted hidden md:inline" />
                  </div>

                  {showSortMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-surface border border-line rounded-xl shadow-lg z-50 p-2 animate-in fade-in slide-in-from-top-2">
                      {[
                        { id: 'newest', label: 'Newest First' },
                        { id: 'oldest', label: 'Oldest First' },
                        { id: 'nameAsc', label: 'Name (A-Z)' },
                        { id: 'nameDesc', label: 'Name (Z-A)' },
                        { id: 'sizeDesc', label: 'Size (Largest)' },
                        { id: 'sizeAsc', label: 'Size (Smallest)' }
                      ].map(option => (
                        <button
                          key={option.id}
                          onClick={() => {
                            setSortBy(option.id)
                            setShowSortMenu(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-xs rounded-lg transition ${sortBy === option.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-fg-muted hover:bg-surface-2 hover:text-fg font-medium'}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setIsTableMaximized(!isTableMaximized)}
                  className="p-1.5 border border-line rounded-lg bg-surface hover:bg-surface-2 transition text-fg-muted shrink-0"
                  title={isTableMaximized ? "Restore Table View" : "Maximize Table View"}
                >
                  {isTableMaximized ? <IconMinimize className="w-4 h-4" /> : <IconMaximize className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Document Table */}
            <div className="flex-1 overflow-auto">
              {needsLogin ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 bg-surface-1 h-full">
                  <div className="w-full max-w-sm bg-surface-1 rounded-2xl p-8 shadow-[0px_9px_16px_rgba(0,0,0,0.20),-8px_-8px_16px_rgba(255,255,255,0.8)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.3),-8px_-8px_16px_rgba(255,255,255,0.05)] border-none">
                  <h3 className="text-xl font-bold text-fg mb-2">DMS Authentication Required</h3>
                    <form onSubmit={handleDmsLogin} className="flex flex-col gap-6">
                      <div>
                        <label className="block text-xs font-semibold text-fg-subtle mb-2 px-1">Email Address</label>
                        <input
                          type="email"
                          placeholder="you@organization.com"
                          className="nf-field"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-fg-subtle mb-2 px-1">Password</label>
                        <input
                          type="password"
                          placeholder="••••••••"
                          className="nf-field"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          required
                        />
                      </div>

                      {loginError && (
                        <div className="p-3 bg-red-50/50 text-red-600 rounded-xl text-xs font-medium shadow-[inset_2px_2px_4px_rgba(239,68,68,0.1),inset_-2px_-2px_4px_rgba(255,255,255,0.5)] border-none">
                          {loginError}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={loginLoading}
                        className="mt-4 w-full bg-blue-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-[0px_9px_30px_rgba(0,0,0,0.20),-6px_-6px_12px_rgba(255,255,255,0.8)] dark:shadow-[6px_6px_12px_rgba(0,0,0,0.3),-6px_-6px_12px_rgba(255,255,255,0.05)] hover:shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.8)] dark:hover:shadow-[4px_4px_8px_rgba(0,0,0,0.3),-4px_-4px_8px_rgba(255,255,255,0.05)] active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.1),inset_-4px_-4px_8px_rgba(255,255,255,0.8)] dark:active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.3),inset_-4px_-4px_8px_rgba(255,255,255,0.05)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border-none"
                      >
                        {loginLoading ? 'Connecting...' : 'Connect to DMS'}
                      </button>
                    </form>
                  </div>
                </div>
              ) : error ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 bg-surface-1 h-full">
                  <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4 text-red-500">
                    <IconInfo className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-fg mb-2">DMS Connection Error</h3>
                  <p className="text-fg-muted text-center max-w-md">{error}</p>
                </div>
              ) : (() => {
                // Filter documents by activeFolderId and searchQuery
                let displayedDocs = documents

                if (activeFolderId) {
                  displayedDocs = displayedDocs.filter(doc => {
                    const folder = folders.find(f => f._id === activeFolderId)
                    if (!folder) return false
                    if (doc.folderPath && doc.folderPath.startsWith(folder._id)) return true
                    return doc.folderPath === folder.name || doc.department === folder.name
                  })
                }

                if (searchQuery.trim()) {
                  const q = searchQuery.toLowerCase()
                  displayedDocs = displayedDocs.filter(doc => {
                    const matchName = doc.name?.toLowerCase().includes(q)
                    const matchType = doc.type?.toLowerCase().includes(q)
                    const matchTags = doc.tags?.some(t => {
                      const tagText = typeof t === 'string' ? t : (t.v || t.k || JSON.stringify(t))
                      return tagText.toLowerCase().includes(q)
                    })
                    return matchName || matchType || matchTags
                  })
                }

                // Apply selected Filters (Type, Date Range)
                if (filters.type !== 'All') {
                  displayedDocs = displayedDocs.filter(doc => doc.type === filters.type)
                }

                if (filters.dateRange !== 'Anytime') {
                  const now = new Date()
                  displayedDocs = displayedDocs.filter(doc => {
                    if (!doc.createdAt) return false
                    const docDate = new Date(doc.createdAt)
                    if (filters.dateRange === 'Last 7 Days') {
                      return (now - docDate) <= (7 * 24 * 60 * 60 * 1000)
                    }
                    if (filters.dateRange === 'Last 30 Days') {
                      return (now - docDate) <= (30 * 24 * 60 * 60 * 1000)
                    }
                    if (filters.dateRange === 'This Year') {
                      return docDate.getFullYear() === now.getFullYear()
                    }
                    return true
                  })
                }

                // Apply Sorting
                if (sortBy === 'newest') displayedDocs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
                else if (sortBy === 'oldest') displayedDocs.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
                else if (sortBy === 'nameAsc') displayedDocs.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                else if (sortBy === 'nameDesc') displayedDocs.sort((a, b) => (b.name || '').localeCompare(a.name || ''))
                else if (sortBy === 'sizeDesc') displayedDocs.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
                else if (sortBy === 'sizeAsc') displayedDocs.sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0))

                if (displayedDocs.length === 0) {
                  return (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-surface-1 h-full text-fg-muted">
                      No documents found in this folder.
                    </div>
                  )
                }

                return (
                  <table className="w-full text-left text-xs whitespace-nowrap min-w-[700px]">
                    <thead className="sticky top-0 bg-white dark:bg-surface z-10 border-b border-line shadow-sm">
                      <tr className="text-[10px] text-fg-muted uppercase tracking-wider">
                        <th className="px-4 py-3 font-bold w-1/3">Name</th>
                        <th className="px-4 py-3 font-bold">Type</th>
                        <th className="px-4 py-3 font-bold">Uploaded By</th>
                        <th className="px-4 py-3 font-bold">Size</th>
                        <th className="px-4 py-3 font-bold">Uploaded On</th>
                        <th className="px-4 py-3 font-bold text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {displayedDocs.map(doc => {
                        const isSelected = activeDoc?._id === doc._id
                        let uploadedByObj = doc.uploadedBy || {}
                        if (typeof doc.uploadedBy === 'string') {
                          uploadedByObj = { name: doc.uploadedBy }
                        }
                        const avatarStr = uploadedByObj.avatar || uploadedByObj.name?.substring(0, 2).toUpperCase() || 'U'

                        let displaySize = '0 B'
                        if (doc.sizeBytes) {
                          const size = doc.sizeBytes
                          if (size < 1024) displaySize = `${size} B`
                          else if (size < 1024 * 1024) displaySize = `${(size / 1024).toFixed(1)} KB`
                          else displaySize = `${(size / (1024 * 1024)).toFixed(2)} MB`
                        }

                        const displayDate = new Date(doc.createdAt).toLocaleDateString('en-GB')

                        return (
                          <tr
                            key={doc._id}
                          className={`group hover:bg-indigo-50/50 transition cursor-pointer ${isSelected ? 'bg-indigo-50/50' : ''}`}
                            onClick={() => setActiveDoc(doc)}
                          >
                            <td className="px-4 py-3 flex items-center gap-3">
                              <FileIcon type={getDisplayType(doc)} className="w-6 h-6 shrink-0" />
                              <div className="min-w-0">
                                <p className={`font-semibold truncate max-w-[200px] xl:max-w-[250px] ${isSelected ? 'text-indigo-700' : 'text-fg'}`}>{doc.name}</p>
                                <div className="flex gap-1.5 mt-1">
                                  {doc.tags?.slice(0, 1).map((t, idx) => {
                                    const tagText = typeof t === 'string' ? t : (t.v || t.k || JSON.stringify(t))
                                    return (
                                      <span key={idx} className={`text-[9px] px-1.5 rounded font-bold uppercase bg-blue-50 text-blue-600 border border-blue-100`}>{tagText}</span>
                                    )
                                  })}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium text-fg">{doc.type}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center text-[9px] font-bold text-fg-subtle">
                                  {avatarStr}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-fg truncate text-[11px]">{uploadedByObj.name || 'Unknown'}</p>
                                  <p className="text-[10px] text-fg-muted truncate">{uploadedByObj.role || 'Member'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium text-fg tabular-nums">{displaySize}</td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-fg text-[11px]">{displayDate}</p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={(e) => handleDeleteDoc(doc, e)}
                                title="Delete Document"
                                className="p-1.5 text-fg-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition "
                              >
                                <IconTrash className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              })()}
            </div>

            {/* Table Footer */}
            <div className="p-4 border-t border-line flex items-center justify-between shrink-0 bg-surface-1">
              <p className="text-xs text-fg-muted font-medium">
                {documents.length > 0
                  ? `Showing 1 to ${documents.length} of ${stats.totalDocs} documents`
                  : `Showing 0 documents`}
              </p>
              <div className="flex items-center gap-1 text-xs">
                <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-fg-muted">&lt;</button>
                <button className="w-8 h-8 flex items-center justify-center rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 font-bold shadow-sm">1</button>
                {documents.length > 0 && <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 font-medium text-fg">2</button>}
                {documents.length > 0 && <button className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-fg-muted">&gt;</button>}
              </div>
            </div>
          </div>

          {/* Right Panel: Details Preview */}
          {activeDoc && !isTableMaximized && (() => {
            let uploadedByObj = activeDoc.uploadedBy || {}
            if (typeof activeDoc.uploadedBy === 'string') {
              uploadedByObj = { name: activeDoc.uploadedBy }
            }
            const avatarStr = uploadedByObj.avatar || uploadedByObj.name?.substring(0, 2).toUpperCase() || 'U'

            let displaySize = '0 B'
            if (activeDoc.sizeBytes) {
              const size = activeDoc.sizeBytes
              if (size < 1024) displaySize = `${size} B`
              else if (size < 1024 * 1024) displaySize = `${(size / 1024).toFixed(1)} KB`
              else displaySize = `${(size / (1024 * 1024)).toFixed(2)} MB`
            }
            const displayDate = new Date(activeDoc.createdAt).toLocaleDateString('en-GB')

            return (
              <div className="w-72 xl:w-80 bg-white dark:bg-surface border border-line rounded-xl shadow-sm flex flex-col min-h-0 shrink-0 relative overflow-hidden">
                <div className="p-3 flex items-center justify-between border-b border-line shrink-0">
                  <p className="font-bold text-xs text-fg truncate flex-1 pr-2" title={activeDoc.name}>{activeDoc.name}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setIsFullscreenPreview(true)} className="text-fg-muted hover:text-fg hover:bg-surface-2 rounded transition p-1" title="Maximize">
                      <IconMaximize className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setActiveDoc(null)} className="text-fg-muted hover:text-fg hover:bg-red-50 hover:text-red-500 rounded transition p-1" title="Close">
                      <IconClose className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pb-4">
                  {/* Preview Thumbnail */}
                  <div className="p-4 bg-surface-2/50 flex flex-col items-center justify-center min-h-[140px] border-b border-line">
                    <FileIcon type={getDisplayType(activeDoc)} className="w-16 h-16 drop-shadow-sm mb-3" />
                    <div className="flex gap-2">
                      <button onClick={() => setIsFullscreenPreview(true)} className="px-3 py-1 bg-white dark:bg-surface border border-line rounded-md text-[10px] font-bold text-fg hover:bg-surface-2 shadow-sm transition flex items-center gap-1.5"><IconEye className="w-3.5 h-3.5" /> Preview</button>
                      <button
                        onClick={() => window.open(activeDocUrl || '#', '_blank')}
                        disabled={activeDocUrlLoading || !activeDocUrl}
                        className="px-3 py-1 bg-white dark:bg-surface border border-line rounded-md text-[10px] font-bold text-fg hover:bg-surface-2 shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <IconCloudDownload className="w-3.5 h-3.5" /> {activeDocUrlLoading ? '...' : 'Download'}
                      </button>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-line text-[11px] font-bold uppercase tracking-wide px-4">
                    <div className="py-2.5 text-indigo-700 border-b-2 border-indigo-600">Details</div>
                  </div>

                  {/* Details List */}
                  <div className="p-4 space-y-4 text-xs">
                    <div className="grid grid-cols-3 gap-2">
                      <span className="text-fg-muted font-medium">File Name</span>
                      <span className="col-span-2 font-semibold text-fg break-words">{activeDoc.name}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <span className="text-fg-muted font-medium">File Type</span>
                      <span className="col-span-2 font-semibold text-fg">{activeDoc.type}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <span className="text-fg-muted font-medium">Size</span>
                      <span className="col-span-2 font-semibold text-fg tabular-nums">{displaySize}</span>
                    </div>

                    <div className="pt-2 border-t border-line grid grid-cols-3 gap-2 items-center">
                      <span className="text-fg-muted font-medium">Uploaded By</span>
                      <div className="col-span-2 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-surface-3 flex items-center justify-center text-[9px] font-bold text-fg-subtle">
                          {avatarStr}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-fg truncate text-[11px]">{uploadedByObj.name || 'Unknown'}</p>
                          <p className="text-[10px] text-fg-muted truncate leading-none mt-0.5">{uploadedByObj.role || 'Member'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <span className="text-fg-muted font-medium">Uploaded On</span>
                      <span className="col-span-2 font-semibold text-fg tabular-nums">{displayDate}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 items-start">
                      <span className="text-fg-muted font-medium mt-1">Tags</span>
                      <div className="col-span-2 flex flex-wrap gap-1.5">
                        {activeDoc.tags?.map((t, idx) => {
                          const tagText = typeof t === 'string' ? t : (t.v || t.k || JSON.stringify(t))
                          return (
                            <span key={idx} className="text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-blue-50 text-blue-600 border border-blue-100">{tagText}</span>
                          )
                        })}
                        <button className="text-[9px] px-2 py-0.5 rounded font-bold uppercase border border-dashed border-line text-fg-muted hover:text-fg hover:border-fg-subtle transition flex items-center gap-0.5">
                          + Add Tag
                        </button>
                      </div>
                    </div>

                    {activeDoc.description && (
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-fg-muted font-medium">Description</span>
                        <span className="col-span-2 text-fg text-[11px] leading-relaxed">{activeDoc.description}</span>
                      </div>
                    )}



                  </div>
                </div>
              </div>
            )
          })()}

        </div>
      </div>

      {/* Fullscreen Preview Modal */}
      {isFullscreenPreview && activeDoc && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 md:p-12 animate-in fade-in duration-200">
          <div className="bg-surface w-full h-full rounded-2xl shadow-2xl flex flex-col overflow-hidden relative">
            <div className="p-4 border-b border-line flex items-center justify-between bg-surface-1">
              <div className="flex items-center gap-3">
                <FileIcon type={getDisplayType(activeDoc)} className="w-6 h-6" />
                <h3 className="font-bold text-fg truncate max-w-lg">{activeDoc.name}</h3>
              </div>
              <button
                onClick={() => setIsFullscreenPreview(false)}
                className="p-2 bg-surface hover:bg-surface-2 rounded-lg text-fg-muted hover:text-fg transition shadow-sm border border-line"
              >
                <IconClose className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 bg-surface-2/50 flex flex-col items-center justify-center p-8 overflow-auto">
              {activeDocUrl && !activeDocUrlLoading && (getDisplayType(activeDoc) === 'PDF' || getDisplayType(activeDoc) === 'JPG') ? (
                <iframe src={activeDocUrl} className="w-full h-full rounded-xl border border-line shadow-sm bg-white" title="Document Preview" />
              ) : (
                <>
                  <FileIcon type={getDisplayType(activeDoc)} className="w-40 h-40 drop-shadow-md mb-6" />
                  <p className="text-fg-muted font-bold text-lg mb-2">Previewing {getDisplayType(activeDoc)} Document</p>
                  <p className="text-fg-subtle text-sm mb-6">{activeDoc.sizeBytes ? `${(activeDoc.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : '0 MB'} • Uploaded by {activeDoc.uploadedBy?.name || 'Unknown'}</p>

                  <div className="flex gap-4">
                    <button
                      onClick={() => window.open(activeDocUrl || '#', '_blank')}
                      disabled={activeDocUrlLoading || !activeDocUrl}
                      className="nf-button nf-button-primary px-6 py-3 font-bold"
                    >
                      <IconCloudDownload className="w-5 h-5" /> {activeDocUrlLoading ? 'Loading...' : 'Download Document'}
                    </button>
                    <button
                      onClick={() => window.open(activeDocUrl || '#', '_blank')}
                      disabled={activeDocUrlLoading || !activeDocUrl}
                      className="px-6 py-3 bg-white dark:bg-surface border border-line text-fg rounded-xl font-bold shadow-sm transition hover:bg-surface-2 flex items-center gap-2 disabled:opacity-50"
                    >
                      <IconEye className="w-5 h-5" /> {activeDocUrlLoading ? 'Loading...' : 'Open in Browser'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </AppShell>
  )
}
