import { parentPort } from 'node:worker_threads'
import * as mupdf from 'mupdf'

const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, Number(n) || 0))

function normalizeBox(box, bounds) {
  const [px0, py0, px1, py1] = bounds
  const [x0, y0, x1, y1] = Array.isArray(box) ? box : [0, 0, 0, 0]
  const width = Math.max(1, px1 - px0)
  const height = Math.max(1, py1 - py0)
  return {
    x: clamp((x0 - px0) / width),
    y: clamp((y0 - py0) / height),
    width: clamp((x1 - x0) / width),
    height: clamp((y1 - y0) / height)
  }
}

function readPage(page, pageNumber) {
  const bounds = page.getBounds()
  const textPage = page.toStructuredText('preserve-whitespace')
  const lines = []
  let active = null
  let imageArea = 0

  try {
    textPage.walk({
      onImageBlock(bbox) {
        const box = normalizeBox(bbox, bounds)
        imageArea += box.width * box.height
      },
      beginLine(bbox) {
        active = { bbox, text: '' }
      },
      onChar(char) {
        if (active) active.text += char
      },
      endLine() {
        const text = String(active?.text || '').replace(/\s+/g, ' ').trim()
        if (text) {
          lines.push({
            page: pageNumber,
            text,
            confidence: 100,
            source: 'digital',
            ...normalizeBox(active.bbox, bounds)
          })
        }
        active = null
      }
    })
  } finally {
    textPage.destroy()
  }

  return { bounds, lines, imageArea: clamp(imageArea, 0, 1) }
}

function renderPage(page, scale = 2) {
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
  try {
    return {
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
      png: pixmap.asPNG()
    }
  } finally {
    pixmap.destroy()
  }
}

function openSource(buffer, mimetype = 'application/pdf') {
  const isPdfSource = mimetype === 'application/pdf'
  const isImageSource = mimetype === 'image/jpeg' || mimetype === 'image/png'
  if (!isPdfSource && !isImageSource) {
    throw Object.assign(new Error('Unsupported document format'), { code: 'INVALID_FILE_TYPE' })
  }

  let doc
  try {
    doc = mupdf.Document.openDocument(new Uint8Array(buffer), mimetype)
  } catch {
    throw Object.assign(
      new Error(isPdfSource ? 'The uploaded PDF is not readable' : 'The uploaded image is not readable'),
      { code: isPdfSource ? 'INVALID_PDF' : 'INVALID_IMAGE' }
    )
  }
  if (isPdfSource && !doc.isPDF()) {
    doc.destroy()
    throw Object.assign(new Error('The uploaded file is not a PDF'), { code: 'INVALID_PDF' })
  }
  if (isImageSource && doc.isPDF()) {
    doc.destroy()
    throw Object.assign(new Error('The uploaded file is not an image'), { code: 'INVALID_IMAGE' })
  }
  if (doc.isPDF() && doc.needsPassword()) {
    doc.destroy()
    throw Object.assign(new Error('Password-protected PDFs are not supported'), { code: 'PDF_ENCRYPTED' })
  }
  return { doc, isPdf: doc.isPDF() }
}

function inspect(buffer, mimetype) {
  const { doc, isPdf } = openSource(buffer, mimetype)
  try {
    const pageCount = doc.countPages()
    if (pageCount < 1) {
      throw Object.assign(new Error('Document does not contain any pages'), {
        code: isPdf ? 'INVALID_PDF' : 'INVALID_IMAGE'
      })
    }
    if (isPdf && pageCount > 25) {
      throw Object.assign(new Error('PDF has more than 25 pages'), { code: 'PAGE_LIMIT_EXCEEDED' })
    }

    const pages = []
    const renderedPages = []
    for (let index = 0; index < pageCount; index += 1) {
      const page = doc.loadPage(index)
      try {
        const pageNumber = index + 1
        const read = readPage(page, pageNumber)
        const textLength = read.lines.reduce((sum, line) => sum + line.text.length, 0)
        const needsOcr = !isPdf || textLength < 40 || (textLength < 120 && read.imageArea > 0.45)
        const meta = {
          page: pageNumber,
          width: Math.max(1, read.bounds[2] - read.bounds[0]),
          height: Math.max(1, read.bounds[3] - read.bounds[1]),
          textLength,
          needsOcr
        }
        pages.push({ ...meta, lines: read.lines })
        // PDF pages benefit from a 2x raster for OCR, while uploaded images
        // already contain their source pixels. Upscaling images here doubles
        // both dimensions, wastes native OCR memory, and can terminate the
        // Paddle process on otherwise valid camera uploads.
        if (needsOcr) renderedPages.push({
          page: pageNumber,
          ...renderPage(page, isPdf ? 2 : 1)
        })
      } finally {
        page.destroy()
      }
    }
    return { pageCount, pages, renderedPages }
  } finally {
    doc.destroy()
  }
}

function render(buffer, mimetype, pageNumber, scale = 1.6) {
  const { doc } = openSource(buffer, mimetype)
  try {
    const count = doc.countPages()
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > count) {
      throw Object.assign(new Error('Page not found'), { code: 'PAGE_NOT_FOUND' })
    }
    const page = doc.loadPage(pageNumber - 1)
    try {
      return renderPage(page, Math.max(0.5, Math.min(Number(scale) || 1.6, 3)))
    } finally {
      page.destroy()
    }
  } finally {
    doc.destroy()
  }
}

parentPort.on('message', ({ operation, buffer, mimetype, pageNumber, scale }) => {
  try {
    const result = operation === 'render'
      ? render(buffer, mimetype, pageNumber, scale)
      : inspect(buffer, mimetype)
    const transfer = []
    if (result?.png?.buffer) transfer.push(result.png.buffer)
    for (const page of result?.renderedPages || []) {
      if (page.png?.buffer) transfer.push(page.png.buffer)
    }
    parentPort.postMessage({ ok: true, result }, transfer)
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        code: error?.code || 'PDF_PROCESSING_FAILED',
        message: error?.message || 'Document processing failed'
      }
    })
  }
})
