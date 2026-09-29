/*
 * One-off asset prep for the NetFlow brand mark.
 *
 * The source file is a JPEG (white background, no alpha). This:
 *   1. Decodes it to RGBA.
 *   2. Flood-fills the white background to transparent starting from the
 *      borders, so the white nodes INSIDE the mark are preserved.
 *   3. Trims the transparent padding so the rounded tile fills its frame.
 *   4. Writes a real PNG with alpha.
 *
 * Deps (dev-only, not part of the app bundle):
 *   npm i pngjs jpeg-js --no-save
 * Usage:
 *   node scripts/process-icon.cjs <input> <output.png>
 */
const fs = require('fs')
const { PNG } = require('pngjs')
const jpeg = require('jpeg-js')

const INPUT = process.argv[2]
const OUTPUT = process.argv[3]
if (!INPUT || !OUTPUT) {
  console.error('Usage: node scripts/process-icon.cjs <input> <output.png>')
  process.exit(1)
}

const buf = fs.readFileSync(INPUT)
let width
let height
let data

if (buf[0] === 0xff && buf[1] === 0xd8) {
  const dec = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 })
  width = dec.width
  height = dec.height
  data = dec.data // RGBA
} else if (buf[0] === 0x89 && buf[1] === 0x50) {
  const png = PNG.sync.read(buf)
  width = png.width
  height = png.height
  data = png.data
} else {
  console.error('Unsupported image format (expected JPEG or PNG).')
  process.exit(1)
}

const idx = (x, y) => (y * width + x) * 4

// "Background" = light + near-neutral. The saturated indigo->purple gradient
// has a wide channel spread, so it is preserved; white/grey (incl. the JPEG
// edge noise and drop shadow) is light with a small spread.
const isBg = (i) => {
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  const min = Math.min(r, g, b)
  const max = Math.max(r, g, b)
  return min >= 205 && max - min <= 30
}

const visited = new Uint8Array(width * height)
const stack = []
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const p = y * width + x
  if (visited[p]) return
  visited[p] = 1
  stack.push(x, y)
}

for (let x = 0; x < width; x++) {
  push(x, 0)
  push(x, height - 1)
}
for (let y = 0; y < height; y++) {
  push(0, y)
  push(width - 1, y)
}

while (stack.length) {
  const y = stack.pop()
  const x = stack.pop()
  const i = idx(x, y)
  if (!isBg(i)) continue // boundary of the connected background region
  data[i + 3] = 0
  push(x + 1, y)
  push(x - 1, y)
  push(x, y + 1)
  push(x, y - 1)
}

// Trim fully-transparent padding.
let minX = width
let minY = height
let maxX = -1
let maxY = -1
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (data[idx(x, y) + 3] > 0) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}

const w = maxX - minX + 1
const h = maxY - minY + 1
const out = new PNG({ width: w, height: h })
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const s = idx(minX + x, minY + y)
    const d = (y * w + x) * 4
    out.data[d] = data[s]
    out.data[d + 1] = data[s + 1]
    out.data[d + 2] = data[s + 2]
    out.data[d + 3] = data[s + 3]
  }
}
fs.writeFileSync(OUTPUT, PNG.sync.write(out))
console.log(`in ${width}x${height} -> trimmed ${w}x${h} -> ${OUTPUT}`)
