import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const report = JSON.parse(fs.readFileSync(path.join(root, 'screenshots-report.json'), 'utf8'))
const captures = new Map(report.screenshots.map(item => [item.name, item]))
const references = new Set()
const problems = []
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.vitepress', 'public'].includes(entry.name)) continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { visit(file); continue }
    if (!entry.name.endsWith('.md')) continue
    const markdown = fs.readFileSync(file, 'utf8')
    for (const match of markdown.matchAll(/!\[[^\]]*\]\(\/screenshots\/guide\/([\w-]+)\.png\)/g)) {
      const name = match[1]
      references.add(name)
      const image = path.join(root, 'public/screenshots/guide', `${name}.png`)
      if (!fs.existsSync(image)) { problems.push(`${name}: missing image`); continue }
      const capture = captures.get(name)
      if (capture?.status !== 'captured') { problems.push(`${name}: referenced image is not verified as current`); continue }
      const bytes = fs.readFileSync(image)
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') problems.push(`${name}: invalid PNG`)
      if (createHash('sha256').update(bytes).digest('hex') !== capture.sha256) problems.push(`${name}: capture checksum differs`)
    }
  }
}
visit(root)
if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else console.log(`Verified ${references.size} current screenshot references: PNG files and capture checksums match.`)
