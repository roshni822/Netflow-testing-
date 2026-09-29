const path = require('node:path')

const MAX_SOURCE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40 * 1000 * 1000
const SOURCE_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

const extensionFor = (mimetype) => {
  if (mimetype === 'image/jpeg') return '.jpg'
  if (mimetype === 'image/png') return '.png'
  return '.pdf'
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return width && height ? { width, height } : null
}

function jpegDimensions(buffer) {
  let offset = 2
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xda || offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) return null
    if (startOfFrame.has(marker)) {
      if (length < 7) return null
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      return width && height ? { width, height } : null
    }
    offset += length
  }
  return null
}

function detectSource(buffer) {
  if (!Buffer.isBuffer(buffer)) return null
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { kind: 'pdf', mimetype: 'application/pdf', extension: '.pdf', width: null, height: null }
  }
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const dimensions = pngDimensions(buffer)
    return dimensions
      ? { kind: 'image', mimetype: 'image/png', extension: '.png', ...dimensions }
      : null
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const dimensions = jpegDimensions(buffer)
    return dimensions
      ? { kind: 'image', mimetype: 'image/jpeg', extension: '.jpg', ...dimensions }
      : null
  }
  return null
}

function validateSourceFile(file) {
  if (!file) return { error: { code: 'NO_FILE', message: 'Choose a PDF, JPG, JPEG, or PNG file to continue.' } }
  if (file.size > MAX_SOURCE_BYTES || file.buffer?.length > MAX_SOURCE_BYTES) {
    return { error: { code: 'FILE_TOO_LARGE', message: 'Document must be 25 MB or smaller.' } }
  }

  const source = detectSource(file.buffer)
  if (!source) {
    return { error: { code: 'INVALID_DOCUMENT', message: 'The file is not a readable PDF, JPG, JPEG, or PNG document.' } }
  }

  const rawClaimedMime = String(file.mimetype || '').trim().toLowerCase()
  const claimedMime = rawClaimedMime === 'image/jpg'
    ? 'image/jpeg'
    : rawClaimedMime === 'application/x-pdf'
      ? 'application/pdf'
      : rawClaimedMime
  if (
    claimedMime &&
    claimedMime !== 'application/octet-stream' &&
    SOURCE_MIMES.has(claimedMime) &&
    claimedMime !== source.mimetype
  ) {
    return { error: { code: 'FILE_TYPE_MISMATCH', message: 'The file content does not match its declared format.' } }
  }
  if (claimedMime && claimedMime !== 'application/octet-stream' && !SOURCE_MIMES.has(claimedMime)) {
    return { error: { code: 'INVALID_FILE_TYPE', message: 'Only PDF, JPG, JPEG, and PNG files are supported.' } }
  }

  const originalExtension = path.extname(String(file.originalname || '')).toLowerCase()
  const acceptedExtensions = source.mimetype === 'image/jpeg'
    ? new Set(['.jpg', '.jpeg'])
    : new Set([source.extension])
  if (originalExtension && !acceptedExtensions.has(originalExtension)) {
    return { error: { code: 'FILE_TYPE_MISMATCH', message: 'The file extension does not match its content.' } }
  }

  if (source.kind === 'image' && source.width * source.height > MAX_IMAGE_PIXELS) {
    return {
      error: {
        code: 'IMAGE_DIMENSIONS_EXCEEDED',
        message: 'Image dimensions must not exceed 40 megapixels.'
      }
    }
  }
  return { source }
}

function safeSourceFilename(value, mimetype) {
  const extension = extensionFor(mimetype)
  const fallback = 'source' + extension
  const name = String(value || fallback).replace(/[\r\n]/g, '').split(/[\\/]/).pop()
  const stem = path.basename(name, path.extname(name)).slice(0, 170) || 'source'
  if (mimetype === 'image/jpeg' && path.extname(name).toLowerCase() === '.jpeg') return stem + '.jpeg'
  return stem + extension
}

module.exports = {
  MAX_SOURCE_BYTES,
  MAX_IMAGE_PIXELS,
  SOURCE_MIMES,
  detectSource,
  validateSourceFile,
  safeSourceFilename
}
