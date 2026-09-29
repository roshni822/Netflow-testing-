# PDF auto-fill operations

The extraction endpoint accepts one PDF, JPG/JPEG, or PNG source per attempt.
Every source is limited to 25 MB; PDFs are limited to 25 pages and images to
40 megapixels. File signatures, declared types, and extensions are checked
before storage. Images are opened by MuPDF as one-page documents, rendered for
PaddleOCR, and retained in their original format after submission.

PDF auto-fill is disabled globally until `PDF_AUTOFILL_ENABLED=true`. Effective access is then controlled by plan entitlement, Tenant Admin settings, and authenticated/public audience policy. It applies tenant-wide rather than per form. In production, the availability check also requires the source-code URL, ClamAV host, PaddleOCR connection settings, and an existing LLM provider key.

## Production requirements

Supported LLM providers are Anthropic, NVIDIA, Groq, Gemini, and OpenAI.
LLM_PROVIDER is attempted first; any other configured providers are automatic
fallbacks, and missing keys are skipped.

Fill-time matching is LLM-first. A generator maps the complete layout-preserved
source to the existing form schema, then an independent critic corrects and
approves mappings. Deterministic code verifies every cited line, normalized
value, choice, date, and table cell. Only critic-approved high- and
medium-confidence mappings auto-fill empty visible fields; unvalidated matches
remain manual-review suggestions.

After a successful authenticated submission, NetFlow records correction memory
for the same organization and form using normalized document type, source label,
target field, and value pattern. This works across document layouts and stores no
document values or raw OCR/PDF text. Public submissions never update learning.

- Initialize the pinned official PaddleOCR submodule and start
  `server/docker-compose.ocr.yml`. The default host binding is loopback-only.
- Keep `PADDLEOCR_SERVICE_URL` private. The official Basic Serving API has no
  bearer-token authentication; use network isolation outside local development.
- Configure a reachable ClamAV daemon. Production rejects uploads when `CLAMAV_HOST` is absent or unavailable.
- Configure one of the existing LLM providers used by `utils/llm.js`.
- Configure DMS, tenant S3, or persistent local storage as already supported by NetFlow.
- Publish the complete corresponding NetFlow source and dependency/build information at `SOURCE_CODE_URL`.
- Complete legal/compliance review before enabling the feature in production.
- Run `npm run migrate:pdf-autofill` once before rollout to backfill plan entitlements and tenant defaults.

Jobs expire after 24 hours when abandoned. The server cleanup worker removes their staged files and reconciles metered local/DMS storage. A submitted source document is retained on the FormResponse and follows existing response/task authorization.

## Environment

```env
PDF_AUTOFILL_ENABLED=false
PDF_AUTOFILL_WORKER_CONCURRENCY=2
PDF_AUTOFILL_MAX_ATTEMPTS=3
PDF_AUTOFILL_RATE_LIMIT=12
PDF_AUTOFILL_MUPDF_TIMEOUT_MS=90000
PDF_AUTOFILL_STALE_CLAIM_MS=1200000
PDF_AUTOFILL_LLM_TIMEOUT_MS=60000
PDF_AUTOFILL_LLM_MAX_TOKENS=5000
PDF_AUTOFILL_LLM_CRITIC_MAX_TOKENS=4000
PDF_AUTOFILL_LLM_RETRY_MAX_TOKENS=8000
PDF_AUTOFILL_LLM_MAX_INPUT_CHARACTERS=60000
PADDLEOCR_SERVICE_URL=http://127.0.0.1:8080
PADDLEOCR_TIMEOUT_MS=300000
CLAMAV_HOST=
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=30000
PDF_AUTOFILL_REQUIRE_MALWARE_SCAN=true
SOURCE_CODE_URL=https://example.com/netflow-source
# LLM routing: anthropic | nvidia | groq | gemini | openai
LLM_PROVIDER=nvidia
NVIDIA_API_KEY=
NVIDIA_MODEL=nvidia/nemotron-3-nano-30b-a3b
# Any of these can be configured as the primary or as fallbacks:
ANTHROPIC_API_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
```

Do not log raw document text, OCR results, LLM prompts, access tokens, or source-page images. Monitor only stage/error code, duration, OCR page count, confidence distribution, and correction rate.

Local OCR startup and troubleshooting commands are documented in
`server/ocr/README.md`. NetFlow currently exposes English as the only OCR
language policy. Historical tenant values are normalized to English at runtime.
