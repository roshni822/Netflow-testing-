# Document-to-form generator

The authenticated form builder can generate a draft from one PDF, JPG/JPEG, or
PNG reference document. Availability uses the existing PDF auto-fill plan
entitlement, tenant setting, English OCR policy, and runtime configuration.

## Processing

1. The upload is signature-checked, size-limited, staged through the existing
   local/DMS/S3 storage layer, and scanned for malware.
2. MuPDF extracts digital text and page coordinates. Only scanned or low-text
   pages are rendered and sent to the loopback-bound official PaddleOCR v3.7.0
   Basic Serving API.
3. Extracted lines are kept in page/coordinate order and divided into complete
   pages or vertical page bands without silently skipping source content.
4. An LLM generator decides the document type, title, description, useful
   inputs, normalized labels, types, tables, necessity, and required status.
   A sequential LLM critic audits the same source evidence, adds omissions,
   removes headings/metadata, and corrects the schema. Document content is
   always treated as untrusted data and cannot alter either system prompt.
5. Server-side validation rejects unknown citations and ungrounded choices or
   table columns, derives highlight coordinates only from extracted source
   lines, preserves identifiers as text, computes final confidence, and limits
   the review to 25 fields.

High confidence is 85-100, medium is 60-84, and low is below 60. High and medium
tiers remain visible, but only critic-approved, high-confidence `core` fields
are included by default. Optional, conditional, medium, low, or unvalidated
fields remain Suggestions until a reviewer includes them.

Candidates with a missing or unknown source line ID are rejected. Reviewed
dropdown/radio fields must have at least two source-grounded options, and tables
must have at least one source-grounded named column; completion rejects invalid
structures instead of inventing placeholder business data. A semantically
inferred required field is allowed only when it is core and has an LLM reason,
and the review UI displays an inferred-required warning.

Generator failure after configured-provider failover returns retryable
`LLM_UNAVAILABLE`; document-form generation has no heuristic field fallback. If
only the critic fails, generator candidates are returned as excluded-by-default
suggestions with a visible validation warning. The older deterministic mapping
utilities remain unchanged for existing PDF autofill consumers.

Temporary provider throttling returns retryable `LLM_RATE_LIMITED`. A provider
response that identifies a per-day request quota returns non-retryable
`LLM_QUOTA_EXHAUSTED` instead, preventing identical automatic retries from
consuming worker capacity and showing an accurate recovery message to users.

OCR is currently English-only; historical bilingual/Hindi tenant settings are
normalized to English without rewriting stored records.

## API

All endpoints require an authenticated Admin with a builder seat:

- POST /api/forms/document-drafts
- GET /api/forms/document-drafts/:jobId
- GET /api/forms/document-drafts/:jobId/pages/:page
- POST /api/forms/document-drafts/:jobId/retry
- POST /api/forms/document-drafts/:jobId/complete
- DELETE /api/forms/document-drafts/:jobId

Completion returns a builder-ready draft but never creates a Form. The existing
POST /api/forms endpoint remains the only create path.

## Retention and privacy

Cancel and completion delete the staged source and generation job. Abandoned
jobs expire after 24 hours. Raw document lines, OCR output, prompts, source
images, access credentials, and provider response bodies must not be logged.

The expiry cleanup scheduler starts even when document processing is disabled.
Production processing additionally requires the feature flag, source-code URL,
ClamAV, PaddleOCR, and at least one configured LLM provider described in
`server/.env.example`.

`DOCUMENT_FORM_LLM_MAX_TOKENS` controls the generator response and
`DOCUMENT_FORM_LLM_CRITIC_MAX_TOKENS` independently controls the critic. When a
provider reports that either response reached its output-token limit, that pass
is retried once with twice its initial allowance, capped by
`DOCUMENT_FORM_LLM_RETRY_MAX_TOKENS` (7000 by default). A generator response
that still reaches the cap fails with `LLM_OUTPUT_TRUNCATED`; critic exhaustion
keeps the grounded generator result as suggestions for manual validation. Set
`PDF_AUTOFILL_WORKER_CONCURRENCY=1` for free or tightly rate-limited providers;
increase concurrency only after confirming provider TPM/RPM capacity. Retryable
LLM failures wait 20 seconds and then 40 seconds before the remaining attempts.
When a completed generator result makes the critic payload exceed the safe input
limit, the generator is not run again; its grounded fields remain suggestions for
manual review. Groq GPT-OSS requests use medium reasoning effort and continue to
include provider reasoning in the response.

Run the focused unit suite with:

    npm run test:document-form

Related regressions:

    npm run test:pdf-autofill
    npm run test:llm

Initialize and run the official OCR service using the commands in
`server/ocr/README.md`.
