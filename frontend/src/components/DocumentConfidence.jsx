import { FileText, ScanText, ShieldCheck, Sparkles } from 'lucide-react'

const percent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
  ? new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value) + '%'
  : 'Not available'
const pageCount = (count) => count + (count === 1 ? ' page' : ' pages')
const isNotValidated = (candidate) => candidate.criticStatus === 'unavailable' && candidate.validationReason !== 'unresolved'
const validationReasons = {
  request_too_large: 'This field and its source evidence exceeded the validation request limit.',
  provider_timeout: 'The validation request timed out.',
  provider_rate_limited: 'The validation service was temporarily rate limited.',
  provider_error: 'The validation service could not complete this check.',
  invalid_response: 'The validation service returned an unusable response.',
  output_truncated: 'The validation response was incomplete.',
  not_returned: 'The validator did not return a decision for this field.',
  recovery_only: 'Found during the recovery check; independent validation is still required.',
  unresolved: 'The validator could not resolve this field from the source evidence.'
}
const scoreCoverage = (summary) => summary
  ? 'Average across ' + summary.scoredFields + ' of ' + summary.totalFields + ' fields'
  : 'Regenerate to see scores'

export function DocumentQualitySummary({ job }) {
  const quality = job.qualitySummary?.version === 1 ? job.qualitySummary : null
  const pages = job.pageMeta || []
  const digitalPages = quality?.digital?.pageCount ?? pages.filter((page) => page.usedOcr === false).length
  const ocrPages = quality?.ocr?.pageCount ?? pages.filter((page) => page.usedOcr === true).length
  const preparationKnown = pages.length > 0 || Boolean(quality)
  const imageSource = job.sourceType === 'image' || job.mimetype?.startsWith('image/')
  const metrics = [
    {
      label: 'MuPdf', icon: FileText,
      value: digitalPages ? 'Extracted by MuPDF' : preparationKnown ? 'Skipped' : 'Not available',
      detail: digitalPages ? pageCount(digitalPages)  : imageSource ? 'Image uploaded · text read by OCR' : preparationKnown ? 'Text read by OCR' : 'Extraction details unavailable'
    },
    {
      label: 'OCR recognition', icon: ScanText,
      value: ocrPages ? percent(quality?.ocr?.confidence) : pages.length || quality ? 'Skipped' : 'Not available',
      detail: ocrPages ? pageCount(ocrPages) + ' · Average text recognition confidence' : pages.length || quality ? 'No scanned pages required OCR' : 'Extraction details unavailable'
    },
    {
      label: 'LLM grounding', icon: Sparkles,
      value: percent(quality?.grounding?.confidence),
      detail: scoreCoverage(quality?.grounding)
    },
    {
      label: 'LLM validation', icon: ShieldCheck,
      value: percent(quality?.validation?.confidence),
      detail: quality?.validation?.unavailableFields
        ? scoreCoverage(quality.validation) + ' · ' + quality.validation.unavailableFields + ' unvalidated'
        : scoreCoverage(quality?.validation)
    }
  ]
  return (
    <section className="mb-4 rounded-xl border border-line bg-surface p-3 sm:p-4" aria-label="Extraction quality and AI confidence">
      <h3 className="text-sm font-semibold text-fg">Extraction quality &amp; AI confidence</h3>
      <p className="mt-1 text-xs text-fg-muted">LLM scores are estimates of field matching and validation, not a guarantee of accuracy.</p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-fg-muted">
        <p><span className="font-medium text-fg">Document preparation:</span> {preparationKnown ? 'MuPDF — Completed' : 'Not available'}</p>
        {preparationKnown && <p><span className="font-medium text-fg">Processing pipeline:</span> {ocrPages ? 'MuPDF → OCR → LLM' : 'MuPDF → LLM'}</p>}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, icon: Icon, value, detail }) => (
          <div key={label} className="min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-3">
            <p className="flex items-center gap-2 text-xs font-medium text-fg-muted"><Icon aria-hidden="true" className="h-4 w-4 shrink-0" />{label}</p>
            <p className="mt-2 text-base font-semibold tabular-nums text-fg">{value}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{detail}</p>
          </div>
        ))}
      </div>
      {!quality && <p className="mt-3 text-xs text-fg-muted">This result used an older score format. Upload the document again to calculate the confidence breakdown.</p>}
    </section>
  )
}

export function FieldConfidenceDetails({ candidate }) {
  const current = candidate.scoreVersion === 2
  const methods = candidate.sourceMethods || []
  const rows = [
    ['MuPdf', methods.includes('digital') ? 'MuPDF · no measured score' : methods.includes('ocr') ? 'Skipped · text read by OCR' : 'Not available'],
    ['OCR recognition', methods.includes('ocr') ? percent(candidate.ocrConfidence) : 'Skipped'],
    ['Source label match', candidate.labelGroundingMethod === 'document_context' ? 'Derived from document context' : percent(candidate.labelGroundingConfidence)],
    ['LLM grounding estimate', percent(candidate.generatorConfidence)],
    ['LLM validation estimate', candidate.criticStatus === 'unavailable' ? 'Not available' : percent(candidate.criticConfidence)],
    ...(candidate.optionGroundingConfidence != null ? [['Choices / columns matched', percent(candidate.optionGroundingConfidence)]] : [])
  ]
  const scoresKnown = current && typeof candidate.sourceConfidence === 'number' && typeof candidate.generatorConfidence === 'number' && typeof candidate.criticConfidence === 'number' && candidate.criticStatus !== 'unavailable'
  return (
    <details className="mb-3 rounded-lg border border-line bg-surface-2 text-xs">
      <summary className="cursor-pointer rounded-lg px-3 py-2 font-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Confidence details</summary>
      <div className="border-t border-line px-3 py-3">
        {current ? <>
          <dl className="space-y-2">
            {rows.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
              <dt className="text-fg-muted">{label}</dt><dd className="font-medium tabular-nums text-fg">{value}</dd>
            </div>)}
            <div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="font-semibold text-fg">Overall review score</dt><dd className="font-semibold tabular-nums text-fg">{scoresKnown ? percent(candidate.confidence) : isNotValidated(candidate) ? 'Not validated' : 'Needs review'}</dd></div>
          </dl>
          {candidate.criticStatus === 'unavailable' && <p className="mt-2 text-fg-muted">{validationReasons[candidate.validationReason] || 'Independent validation is unavailable for this field.'} Review the highlighted source before including it.</p>}
          {methods.includes('unknown') && <p className="mt-2 text-fg-muted">The extraction method is unavailable for some source lines.</p>}
          <p className="mt-3 leading-relaxed text-fg-muted">Source label match measures text overlap with the cited document. The review score uses the lowest extraction, grounding, and validation score, with further limits for field issues. MuPDF direct text is internally weighted at 100; this is not measured accuracy.</p>
        </> : <p className="leading-relaxed text-fg-muted">The earlier score format cannot be interpreted reliably. Review the source highlights or upload the document again for updated scores.</p>}
      </div>
    </details>
  )
}
