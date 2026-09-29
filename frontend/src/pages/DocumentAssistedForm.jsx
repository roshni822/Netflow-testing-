import { useNavigate } from 'react-router-dom'
import { FileSearch } from 'lucide-react'
import AppShell from '../components/AppShell'
import DocumentFormGenerator from '../components/DocumentFormGenerator'

export default function DocumentAssistedForm() {
  const navigate = useNavigate()
  return (
    <AppShell title="Document-assisted form" subtitle="Upload a reference document, review detected fields, then continue in the form builder." mainClass="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 pb-24">
      <section className="nf-panel max-w-6xl mx-auto overflow-hidden">
        <div className="nf-panel-header"><div className="flex items-start gap-3"><span className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 inline-flex items-center justify-center"><FileSearch className="w-5 h-5" /></span><div><h2 className="text-lg font-bold text-fg">Create from a document</h2><p className="mt-0.5 text-xs text-fg-muted">Only source-grounded fields are proposed. You review every field before saving.</p></div></div></div>
        <DocumentFormGenerator onCancel={() => navigate('/forms')} onComplete={(documentDraft) => navigate('/forms/new?document=1', { state: { documentDraft } })} />
      </section>
    </AppShell>
  )
}
