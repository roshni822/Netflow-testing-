// Build a single offline Word document (.docx) from the VitePress Markdown.
//
// Pipeline:
//   1. Concatenate all content pages in sidebar order (index.md is replaced by a cover page).
//   2. Preprocess VitePress-specific syntax so Pandoc understands it:
//        - extract ```mermaid``` blocks (rendered to PNG later),
//        - convert ::: tip/info/warning containers into blockquote callouts,
//        - turn internal absolute links (/guide/...) into bold text,
//        - insert real DOCX page breaks between pages.
//   3. Render each mermaid diagram to a PNG with mermaid-cli (mmdc).
//   4. Convert the combined Markdown to .docx with Pandoc (with a clickable TOC).
//
// Requirements: Pandoc on PATH, and @mermaid-js/mermaid-cli installed in this project.
// Usage: npm run docs:docx

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const docsDir = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(docsDir, '..')
const buildDir = path.join(docsDir, '.docx-build')
const outPath = path.join(repoRoot, 'NetFlow-Documentation.docx')

// Content pages in reading order (matches the site sidebar). index.md is intentionally excluded.
const PAGES = [
  'index.md',
  'getting-started/quick-start.md',
  'getting-started/onboarding.md',
  'guide/account-sign-in.md',
  'guide/dashboard.md',
  'guide/forms.md',
  'guide/workflows.md',
  'guide/tasks-approvals.md',
  'guide/notifications.md',
  'guide/analytics.md',
  'guide/audit-log.md',
  'admin/org-admin.md',
  'reference/roles-permissions.md',
  'reference/workflow-nodes.md',
  'reference/glossary.md',
  'troubleshooting.md',
  'release-notes.md'
]

// A hard page break in the DOCX output (raw OpenXML understood by Pandoc's docx writer).
const PAGE_BREAK = '\n\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n\n'

const CALLOUT_LABELS = {
  tip: 'Tip',
  info: 'Note',
  warning: 'Warning',
  danger: 'Caution',
  details: 'Details'
}

// Collected mermaid sources; each is replaced by a placeholder until rendered.
const mermaidBlocks = []

function stripFrontmatter(md) {
  if (!md.startsWith('---')) return md
  const end = md.indexOf('\n---', 3)
  if (end === -1) return md
  const nl = md.indexOf('\n', end + 1)
  return nl === -1 ? '' : md.slice(nl + 1)
}

function extractMermaid(md) {
  return md.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code) => {
    const idx = mermaidBlocks.length
    mermaidBlocks.push(code.replace(/\s+$/, '') + '\n')
    return `@@MERMAID_${idx}@@`
  })
}

// Convert ::: tip/info/warning [Title] ... ::: into a blockquote callout.
function transformContainers(md) {
  const out = []
  let inContainer = false
  for (const line of md.split('\n')) {
    const open = line.match(/^:::\s*(tip|info|warning|danger|details)\s*(.*)$/i)
    const close = /^:::\s*$/.test(line)
    if (!inContainer && open) {
      const label = CALLOUT_LABELS[open[1].toLowerCase()] || 'Note'
      const title = open[2].trim()
      out.push(`> **${title ? `${label} \u2014 ${title}` : label}**`)
      out.push('>')
      inContainer = true
    } else if (inContainer && close) {
      inContainer = false
      out.push('')
    } else if (inContainer) {
      out.push(line.length ? `> ${line}` : '>')
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

// Internal absolute links (/guide/..., /developer/..., /*.pdf) become bold text so the
// offline document has no dead in-app hyperlinks. External http(s) links are left intact.
function transformInternalLinks(md) {
  return md.replace(/(?<!!)\[([^\]]+)\]\((\/[^)]*)\)/g, (_m, text) => `**${text}**`)
}

function processPage(rel) {
  const abs = path.join(docsDir, rel)
  // Normalize CRLF -> LF so the LF-based regexes below work on Windows files.
  let md = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
  md = stripFrontmatter(md)
  md = extractMermaid(md)
  md = transformContainers(md)
  md = transformInternalLinks(md)
  return md.trim()
}

function renderMermaid() {
  const pcfg = path.join(buildDir, 'puppeteer-config.json')
  fs.writeFileSync(pcfg, JSON.stringify({ args: ['--no-sandbox'] }))
  mermaidBlocks.forEach((code, i) => {
    const mmd = path.join(buildDir, `diagram-${i}.mmd`)
    const png = path.join(buildDir, `diagram-${i}.png`)
    fs.writeFileSync(mmd, code)
    console.log(`Rendering diagram ${i + 1}/${mermaidBlocks.length} ...`)
    execSync(
      `npx --no-install mmdc -i "${mmd}" -o "${png}" -w 900 -b white -p "${pcfg}"`,
      { cwd: docsDir, stdio: 'inherit' }
    )
  })
}

function main() {
  fs.rmSync(buildDir, { recursive: true, force: true })
  fs.mkdirSync(buildDir, { recursive: true })

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const metadata =
    '---\n' +
    'title: "NetFlow Product Documentation"\n' +
    'subtitle: "Forms, Workflows, Approvals & Multi-Tenant Administration"\n' +
    `date: "${dateStr}"\n` +
    '---\n'

  let body = PAGES.map(processPage).join(PAGE_BREAK)
  // Page break after the title/TOC so the first section starts on a fresh page.
  body = PAGE_BREAK + body

  renderMermaid()
  body = body.replace(/@@MERMAID_(\d+)@@/g, (_m, i) => `![](diagram-${i}.png){width=5.8in}`)

  const combinedPath = path.join(buildDir, 'combined.md')
  fs.writeFileSync(combinedPath, `${metadata}\n${body}\n`)

  console.log('Converting to DOCX with Pandoc ...')
  execSync(
    `pandoc "combined.md" -o "${outPath}" --toc --toc-depth=2`,
    { cwd: buildDir, stdio: 'inherit' }
  )

  console.log(`\nDone: ${outPath}`)
}

main()
