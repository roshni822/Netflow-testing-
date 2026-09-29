const path = require('node:path')
const { Worker } = require('node:worker_threads')

const WORKER_PATH = path.join(__dirname, '..', 'workers', 'mupdfWorker.mjs')
const TIMEOUT_MS = Math.max(10000, Number(process.env.PDF_AUTOFILL_MUPDF_TIMEOUT_MS || 90000))

function runMuPdf(operation, buffer, extra = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH)
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {})
      const error = new Error('Document processing timed out')
      error.code = 'PDF_PROCESSING_TIMEOUT'
      reject(error)
    }, TIMEOUT_MS)

    const finish = () => {
      clearTimeout(timer)
      worker.terminate().catch(() => {})
    }

    worker.once('message', (message) => {
      finish()
      if (message?.ok) return resolve(message.result)
      const error = new Error(message?.error?.message || 'Document processing failed')
      error.code = message?.error?.code || 'PDF_PROCESSING_FAILED'
      reject(error)
    })
    worker.once('error', (error) => {
      finish()
      error.code = error.code || 'PDF_WORKER_FAILED'
      reject(error)
    })
    const bytes = new Uint8Array(buffer)
    worker.postMessage({ operation, buffer: bytes, ...extra }, [bytes.buffer])
  })
}

const inspectDocument = (buffer, mimetype = 'application/pdf') =>
  runMuPdf('inspect', buffer, { mimetype })
const renderDocumentPage = (buffer, mimetype = 'application/pdf', pageNumber, scale) =>
  runMuPdf('render', buffer, { mimetype, pageNumber, scale })

module.exports = {
  inspectDocument,
  renderDocumentPage,
  inspectPdf: (buffer) => inspectDocument(buffer, 'application/pdf'),
  renderPdfPage: (buffer, pageNumber, scale) =>
    renderDocumentPage(buffer, 'application/pdf', pageNumber, scale)
}
