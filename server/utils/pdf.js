// utils/pdf.js
// Generates a "signed" PDF of an approved request: form data + the full approval
// trail, including each approver's captured e-signature (typed in the chosen
// font, or an uploaded image). Written to /uploads so it downloads like any
// other attachment. Hooked from the End node when config.generatePdf is on.

const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const FormResponse = require('../models/FormResponse')
const Form = require('../models/Form')
const Task = require('../models/Task')
const { UPLOAD_ROOT: UPLOAD_DIR, dirForOrg, urlFor } = require('./fileStore')
const { addStorage } = require('./usageMeter')

// pdfkit only ships the 14 standard PDF fonts (none are script faces), and the
// app's e-sign fonts are Adobe Fonts we can't embed. So we bundle one free,
// SIL OFL handwriting font (Great Vibes) as a stand-in and render every typed
// signature in it — it reads as an actual signature instead of plain italic.
const SIGNATURE_FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'GreatVibes-Regular.ttf')
const HAS_SIGNATURE_FONT = fs.existsSync(SIGNATURE_FONT_PATH)

// sig.font stores a CSS font-family stack (e.g. "adobe-handwriting-ernie, 'Ernie',
// cursive"). Pull a friendly name out of it for the caption under the signature.
const signatureFontLabel = (font) => {
  if (!font || typeof font !== 'string') return 'typed'
  const quoted = font.match(/'([^']+)'/)
  if (quoted) return quoted[1]
  const first = font.split(',')[0].trim()
  return first || 'typed'
}

const ACTION_LABEL = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  request_changes: 'Requested changes',
  escalated: 'Escalated',
  reassigned: 'Reassigned',
}

const fmtDate = (d) => {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleString('en-US', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return String(d)
  }
}

// Resolve a stored attachment URL (or a data: URL) to raw image bytes. Handles
// both layouts: "/api/files/<orgId>/<name>?k=..." for anything uploaded since
// per-org storage landed, and the legacy flat "/uploads/<name>".
const signatureBuffer = (url) => {
  try {
    if (!url || typeof url !== 'string') return null
    if (url.startsWith('data:')) {
      const b64 = url.split(',')[1] || ''
      return b64 ? Buffer.from(b64, 'base64') : null
    }
    const clean = url.split('?')[0]
    const orgScoped = /\/api\/files\/([0-9a-fA-F]{24})\/([^/]+)$/.exec(clean)
    const p = orgScoped
      ? path.join(UPLOAD_DIR, orgScoped[1], orgScoped[2])
      : path.join(UPLOAD_DIR, path.basename(clean))
    return fs.existsSync(p) ? fs.readFileSync(p) : null
  } catch {
    return null
  }
}

// Flatten a single form field's value into a human-readable string. Grid and
// file values are handled specially by the caller, so this covers scalars.
const formatScalar = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((v) => formatScalar(v)).join(', ')
  if (typeof value === 'object') {
    // signature-ish object
    if (value.text) return String(value.text)
    if (value.name) return String(value.name)
    if (value.url) return String(value.url)
    try { return JSON.stringify(value) } catch { return '—' }
  }
  return String(value)
}

// Builds the PDF and resolves once the file is fully flushed to disk.
const buildPdf = (outPath, draw) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const stream = fs.createWriteStream(outPath)
    stream.on('finish', resolve)
    stream.on('error', reject)
    doc.on('error', reject)
    doc.pipe(stream)
    try {
      draw(doc)
    } catch (err) {
      return reject(err)
    }
    doc.end()
  })

/**
 * Generate a signed PDF for a completed/approved execution.
 * Returns a document descriptor { name, url, mime, size } (and never throws on
 * content issues — the caller decides whether a hard failure should bubble up).
 */
const generateApprovalPdf = async (execution, workflow) => {
  const formResponse = execution.formResponseId
    ? await FormResponse.findById(execution.formResponseId).lean()
    : null
  const form = formResponse?.formId
    ? await Form.findById(formResponse.formId).lean()
    : null

  const tasks = await Task.find({ workflowExecutionId: execution._id })
    .populate('assignedTo', 'name email')
    .populate({ path: 'approvalHistory.performedBy', select: 'name email' })
    .sort({ createdAt: 1 })
    .lean()

  const submitter = execution.variables?.submitter || {}
  const submitterName =
    submitter.name ||
    formResponse?.submittedByExternal?.name ||
    'Unknown'

  const formData = formResponse?.formData || execution.variables?.formData || {}
  const fields = Array.isArray(form?.fields) ? form.fields : []

  // Generated documents are the tenant's data like any attachment: same per-org
  // folder, same access check when opened, same storage meter.
  const orgId = execution.orgId || formResponse?.orgId || workflow?.orgId
  const filename = `approval-${execution._id}-${Date.now()}.pdf`
  const outPath = path.join(dirForOrg(orgId), filename)

  const Organization = require('../models/Organization')
  const s3Client = require('../services/s3Client')
  const org = await Organization.findById(orgId).lean()
  const s3Buffers = {}

  if (org && s3Client.isEnabled(org)) {
    const fetchS3 = async (s3Key) => {
      if (!s3Key || s3Buffers[s3Key]) return
      try {
        const url = await s3Client.getPresignedDownloadUrl(org, s3Key)
        const resp = await fetch(url)
        const arr = await resp.arrayBuffer()
        s3Buffers[s3Key] = Buffer.from(arr)
      } catch (err) {
        console.warn('[pdf] S3 fetch failed for', s3Key, err.message)
      }
    }

    for (const f of fields) {
      if (f.type === 'camera' || f.type === 'signature') {
        const value = formData[f.id]
        if (value && value.s3Key) await fetchS3(value.s3Key)
      }
    }

    for (const t of tasks) {
      for (const h of t.approvalHistory || []) {
        if (h.signature && h.signature.s3Key) await fetchS3(h.signature.s3Key)
      }
    }
  }

  await buildPdf(outPath, (doc) => {
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

    // Register the embedded handwriting font once for this document. If it can't
    // be loaded for any reason, typed signatures fall back to an italic style.
    let sigFontReady = false
    if (HAS_SIGNATURE_FONT) {
      try {
        doc.registerFont('Signature', SIGNATURE_FONT_PATH)
        sigFontReady = true
      } catch {
        sigFontReady = false
      }
    }

    const heading = (text) => {
      doc.moveDown(0.6)
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(text)
      doc.moveTo(doc.x, doc.y + 2)
        .lineTo(doc.x + pageWidth, doc.y + 2)
        .strokeColor('#d1d5db').lineWidth(1).stroke()
      doc.moveDown(0.5)
      doc.fillColor('#000')
    }

    const labelValue = (label, value) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151')
        .text(`${label}: `, { continued: true })
      doc.font('Helvetica').fillColor('#111').text(value)
    }

    // ---- Title ----
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111')
      .text(workflow?.title || 'Approved Request', { align: 'left' })
    doc.font('Helvetica').fontSize(11).fillColor('#16a34a')
      .text('APPROVED', { align: 'left' })
    doc.fillColor('#000').moveDown(0.5)

    labelValue('Request ID', String(execution._id))
    labelValue('Submitted by', submitterName)
    if (submitter.department) labelValue('Department', submitter.department)
    labelValue('Submitted', fmtDate(execution.startedAt || execution.createdAt))
    labelValue('Completed', fmtDate(execution.completedAt || new Date()))

    // ---- Request details ----
    heading('Request Details')
    if (fields.length === 0 && Object.keys(formData).length === 0) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6b7280')
        .text('No form data attached.').fillColor('#000')
    } else if (fields.length > 0) {
      for (const f of fields) {
        const value = formData[f.id]
        if (f.type === 'grid' && value && Array.isArray(value.rows)) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151').text(f.label)
          doc.fillColor('#000')
          const cols = value.columns || []
          const rows = value.rows || []
          if (cols.length) {
            const line = (cells, bold) => {
              doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
                .fillColor(bold ? '#374151' : '#111')
                .text(cells.map((c) => (c === undefined || c === '' ? '—' : String(c))).join('   |   '))
              doc.fillColor('#000')
            }
            line(cols.map((c) => c.label), true)
            if (rows.length === 0) {
              doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6b7280').text('No rows').fillColor('#000')
            } else {
              for (const r of rows) line(cols.map((c) => r?.[c.id]), false)
            }
          }
          doc.moveDown(0.4)
        } else if (f.type === 'file') {
          labelValue(f.label, formatScalar(value))
        } else if (f.type === 'camera' && value && (value.url || value.s3Key)) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151').text(f.label)
          doc.fillColor('#000')
          const buf = value.s3Key ? s3Buffers[value.s3Key] : signatureBuffer(value.url)
          if (buf) {
            try {
              doc.moveDown(0.2)
              doc.image(buf, { fit: [250, 250] })
              doc.moveDown(0.5)
            } catch {
              doc.font('Helvetica-Oblique').fontSize(10).fillColor('#9ca3af')
                .text('[photo attached]', { indent: 4 }).fillColor('#000')
            }
          } else {
            doc.font('Helvetica-Oblique').fontSize(10).fillColor('#9ca3af')
              .text('[photo attached]', { indent: 4 }).fillColor('#000')
          }
          doc.moveDown(0.4)
        } else if (f.type === 'signature' && value && (value.text || value.url || typeof value === 'string')) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151').text(f.label)
          doc.fillColor('#000')
          const sig = typeof value === 'string'
            ? { kind: 'typed', text: value }
            : value
          if (sig.kind === 'typed' && sig.text) {
            if (sigFontReady) {
              doc.font('Signature').fontSize(22).fillColor('#111').text(sig.text, { indent: 4 })
            } else {
              doc.font('Helvetica-Oblique').fontSize(14).fillColor('#111').text(sig.text, { indent: 4 })
            }
            doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
              .text(`e-signature · ${signatureFontLabel(sig.font)}`, { indent: 4 })
            doc.fillColor('#000')
          } else if (sig.url || sig.s3Key) {
            const buf = sig.s3Key ? s3Buffers[sig.s3Key] : signatureBuffer(sig.url)
            if (buf) {
              try {
                doc.image(buf, doc.x + 4, doc.y + 2, { fit: [160, 50] })
                doc.moveDown(3)
              } catch {
                doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9ca3af')
                  .text('[signature image attached]', { indent: 4 }).fillColor('#000')
              }
            } else {
              doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9ca3af')
                .text('[signature image attached]', { indent: 4 }).fillColor('#000')
            }
          }
          doc.moveDown(0.4)
        } else {
          labelValue(f.label, formatScalar(value))
        }
      }
    } else {
      for (const [k, v] of Object.entries(formData)) labelValue(k, formatScalar(v))
    }

    // ---- Approval trail (with e-signatures) ----
    heading('Approval Trail')
    const entries = []
    for (const t of tasks) {
      for (const h of t.approvalHistory || []) {
        entries.push({ ...h, stage: t.title })
      }
    }
    entries.sort((a, b) => new Date(a.performedAt || 0) - new Date(b.performedAt || 0))

    if (entries.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6b7280')
        .text('No approval activity recorded.').fillColor('#000')
    } else {
      for (const e of entries) {
        const who = e.performedBy?.name || 'User'
        const what = ACTION_LABEL[e.action] || e.action || 'Action'
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111')
          .text(`${what} by ${who}`, { continued: true })
        doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
          .text(`   ·   ${fmtDate(e.performedAt)}${e.stage ? `   ·   ${e.stage}` : ''}`)
        doc.fillColor('#000')
        if (e.comment) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#374151')
            .text(`"${e.comment}"`, { indent: 12 })
          doc.fillColor('#000')
        }
        const sig = e.signature
        if (sig && (sig.text || sig.url)) {
          if (sig.kind === 'typed' && sig.text) {
            if (sigFontReady) {
              doc.font('Signature').fontSize(24).fillColor('#111').text(sig.text, { indent: 12 })
            } else {
              doc.font('Helvetica-Oblique').fontSize(16).fillColor('#111').text(sig.text, { indent: 12 })
            }
            doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
              .text(`e-signature · ${signatureFontLabel(sig.font)}`, { indent: 12 })
            doc.fillColor('#000')
          } else if (sig.url || sig.s3Key) {
            const buf = sig.s3Key ? s3Buffers[sig.s3Key] : signatureBuffer(sig.url)
            if (buf) {
              try {
                doc.image(buf, doc.x + 12, doc.y + 2, { fit: [160, 50] })
                doc.moveDown(3)
              } catch {
                doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9ca3af')
                  .text('[signature image attached]', { indent: 12 }).fillColor('#000')
              }
            } else {
              doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9ca3af')
                .text('[signature image attached]', { indent: 12 }).fillColor('#000')
            }
          }
        }
        doc.moveDown(0.5)
      }
    }

    // ---- Footer / certification line ----
    doc.moveDown(1)
    doc.moveTo(doc.x, doc.y).lineTo(doc.x + pageWidth, doc.y)
      .strokeColor('#d1d5db').lineWidth(1).stroke()
    doc.moveDown(0.4)
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
      .text(
        `Digitally approved via NetFlow · Generated ${fmtDate(new Date())} · Document ID ${execution._id}`,
        { align: 'center' }
      )
    doc.fillColor('#000')
  })

  let size = 0
  try { size = fs.statSync(outPath).size } catch { /* noop */ }

  // Counted against the tenant's storage but never blocked: this runs at the end
  // of an approval that has already happened, and refusing to write the record of
  // it would lose the audit document, not save meaningful space.
  if (orgId && size) await addStorage(orgId, size)

  return {
    name: `${(workflow?.title || 'Approved Request').replace(/[^\w\- ]+/g, '').trim() || 'Approved Request'} (signed).pdf`,
    url: await urlFor(orgId, filename),
    mime: 'application/pdf',
    size,
  }
}

module.exports = { generateApprovalPdf }