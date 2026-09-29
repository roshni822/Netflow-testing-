const OCR_TIMEOUT_MS = Math.max(10000, Number(process.env.PADDLEOCR_TIMEOUT_MS || 300000))

const configured = () => Boolean(String(process.env.PADDLEOCR_SERVICE_URL || '').trim())

function endpointFor(rawUrl) {
  const root = String(rawUrl || '').trim().replace(/\/+$/, '')
  return root.endsWith('/ocr') ? root : root + '/ocr'
}

function boxFromPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 2) return null
  const points = Array.isArray(polygon[0])
    ? polygon
    : Array.from({ length: Math.floor(polygon.length / 2) }, (_, index) => [
        polygon[index * 2],
        polygon[index * 2 + 1]
      ])
  const xs = points.map((point) => Number(point?.[0])).filter(Number.isFinite)
  const ys = points.map((point) => Number(point?.[1])).filter(Number.isFinite)
  if (!xs.length || !ys.length) return null
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function normalizedBox(rectangle, polygon, width, height) {
  let box = null
  if (Array.isArray(rectangle) && rectangle.length >= 4) {
    const values = rectangle.slice(0, 4).map(Number)
    if (values.every(Number.isFinite)) box = values
  }
  if (!box) box = boxFromPolygon(polygon)
  if (!box) return null

  const x1 = Math.max(0, Math.min(width, Math.min(box[0], box[2])))
  const y1 = Math.max(0, Math.min(height, Math.min(box[1], box[3])))
  const x2 = Math.max(0, Math.min(width, Math.max(box[0], box[2])))
  const y2 = Math.max(0, Math.min(height, Math.max(box[1], box[3])))
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null
}

function normalizeOfficialResult(payload, page) {
  const firstResult = payload?.result?.ocrResults?.[0]?.prunedResult
  if (!firstResult || typeof firstResult !== 'object') {
    const error = new Error('PaddleOCR returned an invalid response')
    error.code = 'OCR_FAILED'
    throw error
  }

  const texts = Array.isArray(firstResult.rec_texts) ? firstResult.rec_texts : []
  const scores = Array.isArray(firstResult.rec_scores) ? firstResult.rec_scores : []
  const rectangles = Array.isArray(firstResult.rec_boxes) ? firstResult.rec_boxes : []
  const polygons = Array.isArray(firstResult.rec_polys) ? firstResult.rec_polys : []
  const width = Math.max(1, Number(page.width) || 1)
  const height = Math.max(1, Number(page.height) || 1)
  const lines = []

  for (let index = 0; index < texts.length; index += 1) {
    const text = String(texts[index] || '').replace(/\s+/g, ' ').trim()
    const bbox = normalizedBox(rectangles[index], polygons[index], width, height)
    if (!text || !bbox) continue
    const rawConfidence = Number(scores[index])
    lines.push({
      text,
      confidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0,
      bbox
    })
  }

  return { page: Number(page.page), width, height, lines }
}

async function recognizePage(page) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS)
  try {
    const response = await fetch(endpointFor(process.env.PADDLEOCR_SERVICE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: Buffer.from(page.png).toString('base64'),
        fileType: 1,
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useTextlineOrientation: false,
        visualize: false
      }),
      signal: controller.signal
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || Number(payload.errorCode || 0) !== 0) {
      const error = new Error('PaddleOCR request failed (HTTP ' + response.status + ')')
      error.code = 'OCR_FAILED'
      throw error
    }
    return normalizeOfficialResult(payload, page)
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('PaddleOCR request timed out')
      timeoutError.code = 'OCR_TIMEOUT'
      throw timeoutError
    }
    if (error.code) throw error
    const unavailable = new Error('PaddleOCR service is unavailable')
    unavailable.code = 'OCR_UNAVAILABLE'
    throw unavailable
  } finally {
    clearTimeout(timer)
  }
}

async function recognizePages(renderedPages) {
  if (!renderedPages.length) return []
  if (!configured()) {
    const error = new Error('PaddleOCR service is not configured')
    error.code = 'OCR_UNAVAILABLE'
    throw error
  }

  const pages = []
  for (const page of renderedPages) pages.push(await recognizePage(page))
  return pages
}

module.exports = { configured, recognizePages }
