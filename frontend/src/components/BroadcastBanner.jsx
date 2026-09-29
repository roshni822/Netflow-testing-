import { AlertTriangle, Info, ShieldAlert, X } from 'lucide-react'
import { broadcastStore, useActiveBroadcast } from '../lib/broadcastStore'

const STYLES = {
  info: { wrap: 'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-100', icon: Info, label: 'Platform update' },
  warning: { wrap: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100', icon: AlertTriangle, label: 'Platform warning' },
  critical: { wrap: 'border-red-200 bg-red-50 text-red-950 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-100', icon: ShieldAlert, label: 'Critical platform alert' }
}
const WRAP = 'mx-4 mt-3 md:mx-6 rounded-lg border p-3 flex items-start gap-3 shadow-sm'
const CLOSE = 'w-7 h-7 -my-1 -mr-1 rounded flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'

export default function BroadcastBanner() {
  const broadcast = useActiveBroadcast()
  if (!broadcast) return null
  const style = STYLES[broadcast.severity] || STYLES.info
  const Icon = style.icon
  return <aside className={`${WRAP} ${style.wrap}`} aria-live='polite'><Icon className='w-4 h-4 shrink-0' /><div className='min-w-0 flex-1'><b className='text-[10px] uppercase tracking-wider'>{style.label}</b><p className='text-sm font-semibold break-words'>{broadcast.message}</p></div><button type='button' onClick={broadcastStore.dismiss} className={CLOSE} aria-label='Dismiss platform broadcast'><X className='w-4 h-4' /></button></aside>
}
