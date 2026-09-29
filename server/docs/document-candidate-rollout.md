# Document candidate review v3

## Behavior

- New document uploads use source-accounted generator/critic passes. The critic classifies source text internally as field evidence, supporting text or unresolved. This is not a guarantee of field accuracy.
- Validators are batched by the exact serialized user prompt plus system text under the configured input-character budget (12,000 by default). Each batch contains candidate citations and nearby same-page context where space permits. Required evidence is never truncated; an oversized atomic candidate remains unvalidated without blocking other candidates. A larger validator result does not rerun the generator.
- Recovery batches contain unresolved candidates/source targets and nearby context, with already represented inputs listed to avoid recreating them. There is at most one `generate` invocation per planned recovery batch, no recursion or recovery output retry. Existing provider failover can make more than one underlying HTTP request. Successful validation batches survive failures in other batches.
- Printed totals, subtotals, taxes and discounts are requested as numeric candidates even when they could be computed from the table. This is a semantic instruction, not a document-specific field allowlist or a guarantee of recall.
- Source-backed generator candidates omitted by the critic remain unvalidated suggestions unless explicitly excluded as non-inputs. Recovery-only discoveries require human review. Already approved candidates are preserved if recovery fails.
- Weak source-label matches remain suggestions, never auto-included. Unknown citations, empty evidence and invalid locations are rejected. Same-label candidates merge only when type/context agree and source IDs overlap.
- Document candidates and final selected fields are capped at 100. Limit flags are exposed; completion rejects oversize/duplicate/unknown selections rather than slicing silently. Existing describe-with-AI defaults and its 25-field limit are unchanged.
- Included and Suggestions show 20 cards per page. Source highlighting still uses retained candidates only; there is no all-extracted-text UI or API.
- Job payload additions: `processingVersion`, `maxFields`, `limitReached`, `coverage` (status, totalSourceLines, unresolvedCount, validationAttempts, validationFailures, validationSkipped, recoveryAttempts, recoveryFailures, recoverySkipped, maxRequestCharacters, failureReasons, unreadablePageCount, lowConfidenceOcrPageCount). Candidate `context` and `validationReason` are optional. Reasons are safe codes, not provider errors or source text.
- Technical failures/missing independent checks show **Not validated**, with a reason in confidence details. Explicit ambiguity remains **Needs review**. Neither is converted into a fabricated confidence score or automatic inclusion.
- Version 1 jobs retain their existing 25-field contract and no coverage claim. No data migration/deletion is needed. Existing v2 results are not changed; re-upload to use v3.
- Existing source limits (25 pages/25 MB), field types, choice/table-column limits, authentication, organization scoping, provider order and confidence interpretation remain unchanged.

## Verification commands

From `server`: `npm run test:document-form` and `npm run test:llm`.

From `frontend`: `node tests/document_candidate_review.test.mjs`, `node tests/document_confidence.test.mjs`, targeted ESLint on DocumentFormGenerator/DocumentFormReview/DocumentSourcePreview, and `npx vite build`.

Tests use controlled source-line/model fixtures, in-process route/storage doubles, form-schema validation, and isolated browser API fixtures. They do not measure live model recall, authenticate a real tenant, run real OCR, or write company forms to a database. No production accuracy claim follows from these tests alone.

The v3 regression uses a controlled 43-line purchase order fixture with 12 verbose candidates at the real 12,000-character limit: multiple validation batches, PO TOTAL label/amount recovery, included core fields, preserved success after a timeout, and persisted reason codes. This is not the user's original PO-2009 PDF. On 2026-09-16, that filename's saved job was no longer present and no matching PDF was found in the project; live verification of that exact document is pending reattachment or an exact local path.

## Pilot / release gate

1. Deploy backend and frontend together to a pilot environment; use existing organization document-generation entitlement/settings to restrict access. Do not run seed/reset scripts or migrate existing jobs.
2. Confirm actual OCR model/language support. The repository OCR Dockerfile serves the default PaddleX OCR pipeline; the Node request does not select a Hindi model. Local Hindi source-line tests validate Unicode handling only. Hindi/mixed-language scan recognition is **unverified** until the deployed service passes real raster fixtures. Do not advertise handwriting support.
3. Use redacted, consented company examples as available, plus controlled English/Hindi printed forms: invoices, receipts, application forms, multi-page tables, duplicate Bill-to/Ship-to labels, 26/100/101 inputs, rotated/blurred scans, PDFs with embedded text, scanned PDFs, JPG and PNG. A line fixture is not a substitute for these upload/extraction tests.
4. For each example, a reviewer lists expected editable fields and table columns. Measure field recall (expected fields present in Included + Suggestions), candidate precision (useful retained fields), extraction omissions separately from AI omissions, human corrections, processing duration and provider usage/cost. Set pilot targets with the product owner from this baseline before wider release; no universal numerical accuracy threshold is claimed.
5. Gate wider release on zero invented-citation acceptance, no silent overflow, preserved 100-field builder save, verified cross-tenant denial, and acceptable reviewer-measured recall/precision for each supported document/language category. Validate upload → real extraction → real AI → review → actual form save in the pilot; isolated tests cannot certify this chain.

## Monitoring and limitations

`[document-form-generator] review` logs counts, reason-code totals and generation duration, not source text/model responses. `review-completed` logs selection changes. Recovery counters are model-call counts, not billing token counts; reconcile cost with provider dashboards.

`complete` means the supplied extracted lines were accounted for. It cannot detect text the extractor never saw, nor guarantee the AI classified supporting text correctly. No-text pages (including possibly blank pages) and average OCR confidence below 60 flag a partial result for comparison/re-upload. Oversized audit prompts stay partial rather than bypassing the request budget. Zero retained candidates returns the existing no-fields error so a user can retry with a clearer document or build manually.

Do not store company documents for training/evaluation without permission and redaction. Existing job/source expiry behavior is unchanged. No live deployment, production restart or data collection is performed by the test commands above.
