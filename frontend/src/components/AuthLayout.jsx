import { Link } from 'react-router-dom'
import { CheckCircle2, FileText, LockKeyhole, ShieldCheck, Workflow } from 'lucide-react'

function Assurance({ icon: Icon, title, children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-3.5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.07] text-[#d7b66c]">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-[#fffdf8]">{title}</strong>
        <small className="mt-0.5 block text-[11px] leading-5 text-[#c9c2b8]">{children}</small>
      </span>
    </div>
  )
}

function WorkflowPreview() {
  return (
    <div className="mt-7 rounded-[18px] border border-white/10 bg-[#20252c]/90 p-5 shadow-[0_24px_64px_rgb(0_0_0/0.24)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-wide text-[#d8d1c7]">Protected workflow</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#203d2e] px-2.5 py-1 text-[10px] font-semibold text-[#79d09d]">
          <i className="h-1.5 w-1.5 rounded-full bg-current" />Ready
        </span>
      </div>
      <div className="grid grid-cols-[1fr_28px_1fr_28px_1fr] items-center gap-1 text-center">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><FileText className="mx-auto h-4 w-4 text-[#8eb8e1]" /><strong className="mt-2 block text-[11px] text-white">Request</strong></div>
        <span className="h-px bg-[#b8892d]/55" />
        <div className="rounded-xl border border-[#b8892d]/35 bg-[#b8892d]/10 p-3"><LockKeyhole className="mx-auto h-4 w-4 text-[#e3bb6f]" /><strong className="mt-2 block text-[11px] text-white">Access</strong></div>
        <span className="h-px bg-[#b8892d]/55" />
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><CheckCircle2 className="mx-auto h-4 w-4 text-[#79d09d]" /><strong className="mt-2 block text-[11px] text-white">Workspace</strong></div>
      </div>
    </div>
  )
}

export default function AuthLayout({ eyebrow, title, description, children, compact = false }) {
  return (
    <div className="nf-auth-page min-h-screen bg-[#f5f7fb] lg:grid lg:grid-cols-[minmax(440px,1.05fr)_minmax(420px,.95fr)]">
      <aside className="nf-auth-visual relative hidden min-h-screen overflow-hidden bg-[#24272c] px-10 py-9 text-white lg:flex lg:flex-col xl:px-16 xl:py-12" aria-label="NetFlow security and workflow overview">
        <div aria-hidden="true" className="absolute -left-36 -top-32 h-[420px] w-[420px] rounded-full bg-[#245a9a]/25 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-44 right-[-100px] h-[420px] w-[420px] rounded-full bg-[#b8892d]/10 blur-3xl" />
        <Link to="/login" className="relative z-10 flex w-fit items-center gap-3 rounded-xl focus-visible:outline-white">
          <img src="/netflow-icon.png" alt="" className="h-10 w-10 rounded-xl shadow-lg ring-1 ring-white/10" />
          <span><strong className="block text-lg font-extrabold tracking-[-0.02em] text-[#fffdf8]">NetFlow</strong><small className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-[#d4bc8d]">Work made visible</small></span>
        </Link>

        <div className="relative z-10 my-auto w-full max-w-[590px] py-10">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#d7b66c]"><LockKeyhole className="h-4 w-4" />Enterprise workspace access</span>
          <h2 className="mt-5 max-w-[530px] text-[clamp(34px,4vw,52px)] font-extrabold leading-[1.08] tracking-[-0.045em] text-[#fffdf8]">Secure access to work that matters.</h2>
          <p className="mt-4 max-w-[535px] text-sm leading-7 text-[#cec7bc]">Move from request to approval with clear ownership, governed access, and a complete operational record.</p>
          {!compact && (
            <div className="mt-7 grid gap-2.5 xl:grid-cols-3">
              <Assurance icon={ShieldCheck} title="Role-aware access">Permissions follow the assigned workspace role.</Assurance>
              <Assurance icon={Workflow} title="Visible handoffs">Requests and approvals stay connected.</Assurance>
              <Assurance icon={CheckCircle2} title="Accountable activity">Important actions remain traceable.</Assurance>
            </div>
          )}
          <WorkflowPreview />
        </div>
        <p className="relative z-10 text-[11px] text-[#a9a197]">Authentication and access remain managed by your organization.</p>
      </aside>

      <main className="nf-auth-panel flex min-h-screen items-center justify-center bg-white px-5 py-10 sm:px-10 lg:px-12">
        <div className="w-full max-w-[420px]">
          <Link to="/login" className="mb-8 flex w-fit items-center gap-2.5 lg:hidden">
            <img src="/netflow-icon.png" alt="" className="h-9 w-9 rounded-[10px] shadow-sm" />
            <span><strong className="block text-base font-extrabold text-fg">NetFlow</strong><small className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-warning-fg">Work made visible</small></span>
          </Link>
          {eyebrow && <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.13em] text-indigo-700">{eyebrow}</p>}
          {title && <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.035em] text-fg">{title}</h1>}
          {description && <p className="mb-7 mt-2 text-sm leading-6 text-fg-muted">{description}</p>}
          {children}
        </div>
      </main>
    </div>
  )
}
