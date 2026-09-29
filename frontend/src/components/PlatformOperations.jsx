import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../utils/api'

const field='mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg'

export function PlatformAnnouncement({ organizations=[] }) {
  const [audience,setAudience]=useState('selected')
  const [selected,setSelected]=useState([])
  const [busy,setBusy]=useState(false)
  const [feedback,setFeedback]=useState('')
  const [error,setError]=useState('')
  const submit=async event=>{
    event.preventDefault()
    const form=event.currentTarget
    const data=new FormData(form)
    setBusy(true);setError('');setFeedback('')
    try {
      await api.post('/api/platform/broadcast',{message:data.get('message'),severity:data.get('severity'),
        expiresAt:new Date(data.get('expiresAt')).toISOString(),orgIds:audience==='all' ? null : selected})
      setFeedback('Announcement published to the selected audience.');form.reset();setSelected([])
    } catch(err) {setError(err.message || 'Announcement could not be published.')} finally {setBusy(false)}
  }
  return <section className="rounded-xl border border-line bg-surface p-5">
    <h2 className="text-sm font-semibold text-fg">Organization announcements</h2>
    <p className="mt-1 text-xs text-fg-muted">Publish an in-app banner until its expiry time.</p>
    <form onSubmit={submit} className="mt-4 space-y-4">
      <label className="block text-sm text-fg">Audience<select className={field} value={audience} onChange={e=>setAudience(e.target.value)} disabled={busy}><option value="selected">Selected organizations</option><option value="all">All organizations</option></select></label>
      {audience==='selected' && <label className="block text-sm text-fg">Organizations<select multiple required className={field+' min-h-28'} value={selected} disabled={busy} onChange={e=>setSelected(Array.from(e.target.selectedOptions,o=>o.value))}>{organizations.filter(o=>!o.provisioningStatus || o.provisioningStatus==='ready').map(o=><option key={o._id} value={o._id}>{o.name}</option>)}</select><span className="mt-1 block text-xs text-fg-muted">Choose one or more organizations. Hold Ctrl or Command for multiple selections.</span></label>}
      <label className="block text-sm text-fg">Message<textarea name="message" required maxLength={500} className={field} rows={3} disabled={busy}/></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-fg">Severity<select name="severity" className={field} disabled={busy}><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
      <label className="text-sm text-fg">Expires at (your local time)<input name="expiresAt" type="datetime-local" required className={field} disabled={busy}/></label></div>
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
      {feedback && <p role="status" className="text-sm text-success-fg">{feedback}</p>}
      <button className="nf-button min-h-11" disabled={busy || (audience==='selected' && !selected.length)}>{busy ? 'Publishing…' : 'Publish announcement'}</button>
    </form>
  </section>
}

export function OrganizationStorage({ orgId }) {
  const [config,setConfig]=useState(null),[connection,setConnection]=useState(''),[result,setResult]=useState(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  const sequence=useRef(0)
  const invalidateRequests=useCallback(()=>{sequence.current++},[])
  useEffect(()=>{
    let live=true
    api.get(`/api/platform/orgs/${orgId}/storage`).then(data=>{if(live) setConfig(data)}).catch(err=>{if(live)setError(err.message)})
    return ()=>{live=false;invalidateRequests()}
  },[orgId,invalidateRequests])
  const load=async(key,cursor='')=>{
    const current=++sequence.current
    setConnection(key);setResult(null);setError('')
    if(!key) return
    setBusy(true)
    const selected=config.connections.find(c=>c.key===key)
    try {
      const query=new URLSearchParams({...(selected.department ? {department:selected.department} : {}),...(cursor ? {cursor} : {})})
      const data=await api.get(`/api/platform/orgs/${orgId}/storage/${selected.provider}?${query}`)
      if(current===sequence.current)setResult(data)
    } catch(err) {if(current===sequence.current)setError(err.message)} finally {if(current===sequence.current)setBusy(false)}
  }
  return <section className="mt-4 rounded-xl border border-line bg-surface p-4">
    <h3 className="text-sm font-semibold text-fg">Organization documents</h3>
    <p className="mt-1 text-xs text-fg-muted">Browse this organization’s connected S3 or DMS storage. DMS lists application-linked documents only.</p>
    {config && <><p className="my-3 text-xs text-fg-muted">Application meter: {config.accountedFiles.toLocaleString()} files · {(config.accountedBytes/1048576).toFixed(2)} MB</p>
      <label className="block text-sm text-fg">Storage connection<select className={field} value={connection} onChange={e=>load(e.target.value)}><option value="">{config.connections.length ? 'Select a connection' : 'No storage provider configured'}</option>{config.connections.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label></>}
    {busy && <p role="status" className="mt-3 text-sm text-fg-muted">Loading documents…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
    {result && <div className="mt-3">
      <p className="mb-2 text-xs text-fg-muted">{result.documents.length} documents on this page. {result.listedBytes===null ? 'Some sizes are unavailable.' : `${(result.listedBytes/1048576).toFixed(2)} MB on this page.`}</p>
      {result.documents.length ? <ul className="divide-y divide-line">{result.documents.map(d=><li key={d.id} className="flex justify-between gap-3 py-2 text-sm"><span className="break-all text-fg">{d.name}</span><span className="shrink-0 text-fg-muted">{d.size===null ? 'Unknown' : `${(d.size/1024).toFixed(1)} KB`}</span></li>)}</ul> : <p className="text-sm text-fg-muted">No linked documents on this page.</p>}
      {result.hasMore && <button type="button" className="nf-button mt-3 min-h-11" onClick={()=>load(connection,result.nextCursor)}>Next page</button>}
    </div>}
  </section>
}

export function ArchiveOrganization({ org,onClose,onArchived,Modal }) {
  const [name,setName]=useState(''),[days,setDays]=useState(''),[reason,setReason]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const valid=name.trim()===org.name && Number.isInteger(Number(days)) && Number(days)>=1 && Number(days)<=3650 && reason.trim()
  const archive=async()=>{
    setBusy(true);setError('')
    try {await api.post(`/api/platform/orgs/${org._id}/archive`,{retentionDays:Number(days),reason:reason.trim()});onArchived()}
    catch(err){setError(err.message)}finally{setBusy(false)}
  }
  return <Modal onClose={onClose} stacked title={`Archive ${org.name}?`} footer={<><button type="button" className="nf-button min-h-11" onClick={onClose}>Cancel</button><button type="button" className="nf-button min-h-11 text-danger-fg" disabled={!valid || busy || org.status!=='suspended'} onClick={archive}>{busy ? 'Archiving…' : 'Archive organization'}</button></>}>
    <div className="space-y-4"><p className="text-sm text-fg-muted">Archiving blocks access and retains all organization data. Permanent removal is an operator action after the retention period and a verified backup restore.</p>
      {org.status!=='suspended' && <p role="alert" className="text-sm text-danger-fg">Suspend the organization before archiving.</p>}
      <label className="block text-sm text-fg">Retention period (days)<input className={field} type="number" min="1" max="3650" value={days} onChange={e=>setDays(e.target.value)}/></label>
      <label className="block text-sm text-fg">Reason<textarea className={field} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <label className="block text-sm text-fg">Type {org.name} to confirm<input className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
    </div>
  </Modal>
}
