const MAX_MANUAL_SUGGESTIONS = 12

const normalizeText = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0))

const TITLE_PATTERNS = [
  /^goods (?:received|receipt) (?:note|notice)(?: grn)?$/i,
  /^(?:tax |commercial )?invoice$/i,
  /^purchase order$/i
]

const TABLE_LABEL_PATTERN = /\b(?:received items?|line items?|item details?|goods details?|product details?|material details?|service details?)\b/i

const DERIVED_TABLE_LABELS = {
  goods_receipt: 'Received Items',
  invoice: 'Line Items',
  purchase_order: 'Line Items'
}

const TABLE_COLUMNS = [
  { key: 'item', pattern: /\b(?:item|item no\.?|line no\.?)\b/i, type: 'text' },
  { key: 'invoice', pattern: /\binvoice(?:\s*(?:no\.?|number|#))?\b/i, type: 'text' },
  { key: 'purchase_order', pattern: /\b(?:purchase order|po)(?:\s*(?:no\.?|number|#))?\b/i, type: 'text' },
  { key: 'product', pattern: /\b(?:product|material|sku)\b/i, type: 'text' },
  { key: 'description', pattern: /\bdescription\b/i, type: 'text' },
  { key: 'lot', pattern: /\b(?:lot|batch)(?:\s*(?:no\.?|number|#))?\b/i, type: 'text' },
  { key: 'expiry', pattern: /\b(?:expiry|expiration)(?:\s+date)?\b/i, type: 'date' },
  { key: 'bin', pattern: /\bbin(?:\s*(?:no\.?|number|#))?\b/i, type: 'text' },
  { key: 'quantity', pattern: /\b(?:quantity|qty)\b/i, type: 'number' },
  { key: 'unit', pattern: /\b(?:unit|uom)\b/i, type: 'text' },
  { key: 'rate', pattern: /\b(?:rate|unit price)\b/i, type: 'number' },
  { key: 'amount', pattern: /\b(?:amount|line total)\b/i, type: 'number' },
  { key: 'container', pattern: /\bcontainer(?:\s*(?:no\.?|number|#))?\b/i, type: 'text' },
  { key: 'seal', pattern: /\bseal(?:\s*(?:no\.?|number|#))?\b/i, type: 'text' }
]

const COMMON_RULES = [
  { key: 'remarks', pattern: /\b(?:remarks?|comments?|notes?)\b/i, type: 'text', multiline: true },
  { key: 'prepared_by', pattern: /\bprepared by\b/i, type: 'text' },
  { key: 'checked_by', pattern: /\bchecked by\b/i, type: 'text' },
  { key: 'approved_by', pattern: /\bapproved by\b/i, type: 'text' },
  { key: 'authorized_by', pattern: /\bauthori[sz]ed by\b/i, type: 'text' },
  { key: 'approval_date', pattern: /\b(?:approval|approved) date\b/i, type: 'date' },
  { key: 'signature', pattern: /\b(?:signature|signed by)\b/i, type: 'signature' }
]

const PROFILE_RULES = {
  goods_receipt: [
    {
      key: 'grn_number',
      pattern: /\b(?:grn(?:\s*(?:no\.?|number|#))?|goods (?:received|receipt) (?:note )?(?:no\.?|number|#))\b/i,
      type: 'text'
    },
    { key: 'po_number', pattern: /\b(?:purchase order|po)(?:\s*(?:no\.?|number|#))\b/i, type: 'text' },
    { key: 'invoice_number', pattern: /\binvoice(?:\s*(?:no\.?|number|#))\b/i, type: 'text' },
    { key: 'vendor_code', pattern: /\b(?:vendor|supplier) code\b/i, type: 'text' },
    { key: 'vendor_name', pattern: /\b(?:vendor|supplier) name\b/i, type: 'text' },
    { key: 'received_date', pattern: /\b(?:receiving|received|receipt|grn) date\b/i, type: 'date' },
    { key: 'received_by', pattern: /\b(?:received|receiving|accepted) by\b/i, type: 'text' },
    { key: 'total_quantity', pattern: /^\s*(?:grand\s+)?total(?:\s+(?:quantity|qty|received))?\s*:?\s*$/i, type: 'number' },
    { key: 'destuffed_by', pattern: /\bdestuffed by\b/i, type: 'text' },
    { key: 'destuffed_date', pattern: /\bdestuff(?:ed)? date\b/i, type: 'date' }
  ],
  invoice: [
    { key: 'invoice_number', pattern: /\binvoice(?:\s*(?:no\.?|number|#))\b/i, type: 'text' },
    { key: 'invoice_date', pattern: /\binvoice date\b/i, type: 'date' },
    { key: 'due_date', pattern: /\bdue date\b/i, type: 'date' },
    { key: 'po_number', pattern: /\b(?:purchase order|po)(?:\s*(?:no\.?|number|#))\b/i, type: 'text' },
    { key: 'vendor_name', pattern: /\b(?:vendor|supplier) name\b/i, type: 'text' },
    { key: 'customer_name', pattern: /\b(?:customer|client) name\b/i, type: 'text' },
    { key: 'billing_address', pattern: /\b(?:billing|bill to) address\b/i, type: 'text', multiline: true },
    { key: 'shipping_address', pattern: /\b(?:shipping|ship to) address\b/i, type: 'text', multiline: true },
    { key: 'payment_terms', pattern: /\bpayment terms?\b/i, type: 'text' },
    { key: 'subtotal', pattern: /\bsub ?total\b/i, type: 'number' },
    { key: 'tax', pattern: /\b(?:tax|vat|gst)\b/i, type: 'number' },
    { key: 'total_amount', pattern: /\b(?:grand total|total amount|amount due)\b/i, type: 'number' }
  ],
  purchase_order: [
    { key: 'po_number', pattern: /\b(?:purchase order|po)(?:\s*(?:no\.?|number|#))\b/i, type: 'text' },
    { key: 'po_date', pattern: /\b(?:purchase order|po) date\b/i, type: 'date' },
    { key: 'vendor_code', pattern: /\b(?:vendor|supplier) code\b/i, type: 'text' },
    { key: 'vendor_name', pattern: /\b(?:vendor|supplier) name\b/i, type: 'text' },
    { key: 'delivery_date', pattern: /\b(?:delivery|required by) date\b/i, type: 'date' },
    { key: 'delivery_address', pattern: /\b(?:delivery|ship to) address\b/i, type: 'text', multiline: true },
    { key: 'requested_by', pattern: /\brequested by\b/i, type: 'text' },
    { key: 'payment_terms', pattern: /\bpayment terms?\b/i, type: 'text' },
    { key: 'subtotal', pattern: /\bsub ?total\b/i, type: 'number' },
    { key: 'tax', pattern: /\b(?:tax|vat|gst)\b/i, type: 'number' },
    { key: 'total_amount', pattern: /\b(?:grand total|total amount)\b/i, type: 'number' }
  ]
}

const lineOrder = (left, right) =>
  Number(left?.page) - Number(right?.page) ||
  Number(left?.y) - Number(right?.y) ||
  Number(left?.x) - Number(right?.x)

const compactLineArray = (line) => [
  String(line?.id || ''),
  Number(line?.page) || 1,
  String(line?.text || ''),
  Number(Number(line?.x || 0).toFixed(3)),
  Number(Number(line?.y || 0).toFixed(3)),
  Number(Number(line?.width || 0).toFixed(3)),
  Number(Number(line?.height || 0).toFixed(3))
]

const exactVisibleMatch = (text, pattern) => {
  const match = String(text || '').match(pattern)
  return match ? match[0].trim().replace(/\s*[:=-]\s*$/, '') : ''
}

const isTitleLine = (line) => {
  const text = String(line?.text || '').trim()
  if (TITLE_PATTERNS.some((pattern) => pattern.test(text))) return true
  return Number(line?.y) < 0.12 && /\b(?:goods received (?:note|notice)|goods receipt (?:note|notice)|invoice|purchase order)\b/i.test(text)
}

const evidenceConfidence = (lines) => {
  if (!lines.length) return 0
  const source = lines.reduce((sum, line) => sum + clamp(line?.confidence), 0) / lines.length
  return Math.round(Math.min(99, source * 0.85 + 14))
}

const requiredFrom = (lines) => lines.some((line) =>
  /(?:\*|\brequired\b|\bmandatory\b)/i.test(String(line?.text || ''))
)

const horizontalOverlapRatio = (left, right) => {
  const leftStart = Number(left?.x) || 0
  const leftWidth = Math.max(0, Number(left?.width) || 0)
  const rightStart = Number(right?.x) || 0
  const rightWidth = Math.max(0, Number(right?.width) || 0)
  const overlap = Math.max(
    0,
    Math.min(leftStart + leftWidth, rightStart + rightWidth) - Math.max(leftStart, rightStart)
  )
  const smallerWidth = Math.min(leftWidth, rightWidth)
  return smallerWidth > 0 ? overlap / smallerWidth : 0
}

const cleanHeaderLabel = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\s*[:=-]\s*$/, '')

function headerGroupsFor(lines) {
  const groups = []
  const ordered = [...(lines || [])]
    .filter((line) => line?.id && cleanHeaderLabel(line.text))
    .sort((left, right) => Number(left.x) - Number(right.x) || Number(left.y) - Number(right.y))

  for (const line of ordered) {
    const matching = groups.find((group) => group.lines.some((existing) =>
      horizontalOverlapRatio(existing, line) >= 0.55
    ))
    if (matching) matching.lines.push(line)
    else groups.push({ lines: [line] })
  }

  return groups.map((group) => {
    const groupLines = [...group.lines].sort((left, right) =>
      Number(left.y) - Number(right.y) || Number(left.x) - Number(right.x)
    )
    const x = Math.min(...groupLines.map((line) => Number(line.x) || 0))
    const right = Math.max(...groupLines.map((line) =>
      (Number(line.x) || 0) + Math.max(0, Number(line.width) || 0)
    ))
    return {
      lines: groupLines,
      text: cleanHeaderLabel(groupLines.map((line) => line.text).join(' ')),
      x,
      width: Math.max(0, right - x)
    }
  })
}

function tableColumnsFor(lines) {
  const columns = []
  const seen = new Set()
  for (const group of headerGroupsFor(lines)) {
    const matches = TABLE_COLUMNS
      .map((column) => ({ column, label: exactVisibleMatch(group.text, column.pattern) }))
      .filter(({ label }) => label)

    for (const { column, label: matchedLabel } of matches) {
      if (seen.has(column.key)) continue
      seen.add(column.key)
      columns.push({
        key: column.key,
        label: matches.length === 1 ? group.text : matchedLabel,
        type: column.type,
        line: group.lines[0],
        lines: group.lines,
        x: group.x,
        width: group.width
      })
    }
  }
  return columns.sort((left, right) => left.x - right.x)
}

const tableColumnKeyForLabel = (value) => {
  const label = normalizeText(value)
  const match = TABLE_COLUMNS.find((column) => column.pattern.test(label))
  return match?.key || label
}

function detectedTableHeaderIds(lines) {
  const ordered = [...(lines || [])].sort(lineOrder)
  const ids = new Set()
  const seen = new Set()
  for (const anchor of ordered) {
    const band = ordered.filter((line) =>
      Number(line.page) === Number(anchor.page) &&
      Math.abs(Number(line.y) - Number(anchor.y)) <= 0.026
    )
    const columns = tableColumnsFor(band)
    if (columns.length < 3) continue
    const headerLines = [...new Map(
      columns.flatMap((column) => column.lines || [column.line])
        .map((line) => [String(line.id), line])
    ).values()]
    const key = headerLines.map((line) => String(line.id)).sort().join('|')
    if (!key || seen.has(key)) continue
    seen.add(key)
    headerLines.forEach((line) => ids.add(String(line.id)))
  }
  return ids
}

function tableRowsFor(lines, columns, headerLines) {
  const headerIds = new Set(headerLines.map((line) => String(line.id)))
  const page = Number(headerLines[0]?.page)
  const headerBottom = Math.max(...headerLines.map((line) =>
    Number(line.y) + Math.max(0, Number(line.height) || 0)
  ))
  const orderedColumns = [...columns].sort((left, right) => left.x - right.x)
  const centers = orderedColumns.map((column) =>
    Number(column.x) + Math.max(0, Number(column.width) || 0) / 2
  )
  const boundaries = centers.slice(0, -1).map((center, index) =>
    (center + centers[index + 1]) / 2
  )
  const candidates = [...(lines || [])]
    .filter((line) =>
      Number(line?.page) === page &&
      !headerIds.has(String(line?.id)) &&
      cleanHeaderLabel(line?.text) &&
      Number(line.y) >= headerBottom + 0.002 &&
      Number(line.y) <= Math.min(0.9, headerBottom + 0.65)
    )
    .sort(lineOrder)

  const rowBands = []
  for (const line of candidates) {
    const tolerance = Math.max(0.006, Math.min(0.012, Number(line.height || 0) * 0.7))
    const existing = rowBands.find((row) => Math.abs(row.y - centerYForTable(line)) <= tolerance)
    if (existing) {
      existing.lines.push(line)
      existing.y = existing.lines.reduce((sum, item) => sum + centerYForTable(item), 0) / existing.lines.length
    } else {
      rowBands.push({ y: centerYForTable(line), lines: [line] })
    }
  }

  const minimumCells = Math.max(3, Math.ceil(orderedColumns.length * 0.5))
  const supported = []
  for (const row of rowBands.sort((left, right) => left.y - right.y)) {
    const cells = orderedColumns.map(() => [])
    for (const line of row.lines.sort((left, right) => Number(left.x) - Number(right.x))) {
      const center = Number(line.x) + Math.max(0, Number(line.width) || 0) / 2
      const index = boundaries.findIndex((boundary) => center < boundary)
      cells[index === -1 ? orderedColumns.length - 1 : index].push(line)
    }
    const coveredCells = cells.filter((cell) => cell.length).length
    if (coveredCells < minimumCells) continue
    supported.push({ y: row.y, cells, coveredCells })
  }

  if (!supported.length) return []
  const contiguous = [supported[0]]
  for (const row of supported.slice(1)) {
    if (row.y - contiguous[contiguous.length - 1].y > 0.055) break
    contiguous.push(row)
  }
  return contiguous
}

const centerYForTable = (line) =>
  Number(line?.y || 0) + Math.max(0, Number(line?.height) || 0) / 2

function extractGridMappingHints(fields, lines) {
  const grids = (fields || []).filter((field) =>
    field?.type === 'grid' && Array.isArray(field.columns) && field.columns.length >= 3
  )
  if (!grids.length) return []

  const ordered = [...(lines || [])].sort(lineOrder)
  const tableCandidates = []
  const seenHeaders = new Set()
  for (const anchor of ordered) {
    const band = ordered.filter((line) =>
      Number(line.page) === Number(anchor.page) &&
      Math.abs(Number(line.y) - Number(anchor.y)) <= 0.026
    )
    const columns = tableColumnsFor(band)
    if (columns.length < 3) continue
    const headerLines = [...new Map(
      columns.flatMap((column) => column.lines || [column.line])
        .map((line) => [String(line.id), line])
    ).values()].sort(lineOrder)
    const headerKey = headerLines.map((line) => String(line.id)).sort().join('|')
    if (!headerKey || seenHeaders.has(headerKey)) continue
    seenHeaders.add(headerKey)
    const rows = tableRowsFor(ordered, columns, headerLines)
    if (rows.length < 2) continue
    tableCandidates.push({ columns, headerLines, rows })
  }

  const hints = []
  for (const field of grids) {
    const candidates = []
    for (const table of tableCandidates) {
      const detectedByKey = new Map(table.columns.map((column, index) => [column.key, { column, index }]))
      const mappedColumns = field.columns
        .map((column) => ({
          fieldColumn: column,
          detected: detectedByKey.get(tableColumnKeyForLabel(column.label))
        }))
        .filter((entry) => entry.detected)
      const mappingRatio = mappedColumns.length / field.columns.length
      if (mappedColumns.length < 3 || mappingRatio < 0.6) continue

      const minimumMappedCells = Math.max(3, Math.ceil(mappedColumns.length * 0.6))
      const values = []
      const sourceLineIds = new Set(table.headerLines.map((line) => String(line.id)))
      const rowKeys = new Set()
      let totalCoverage = 0
      for (const row of table.rows) {
        const value = {}
        let covered = 0
        for (const { fieldColumn, detected } of mappedColumns) {
          const sourceLines = row.cells[detected.index] || []
          const text = sourceLines
            .sort((left, right) => Number(left.x) - Number(right.x))
            .map((line) => cleanHeaderLabel(line.text))
            .filter(Boolean)
            .join(' ')
          if (!text) continue
          value[fieldColumn.id] = text
          covered += 1
          sourceLines.forEach((line) => sourceLineIds.add(String(line.id)))
        }
        if (covered < minimumMappedCells) continue
        const rowKey = JSON.stringify(value)
        if (rowKeys.has(rowKey)) continue
        rowKeys.add(rowKey)
        values.push(value)
        totalCoverage += covered / mappedColumns.length
      }
      if (values.length < 2) continue

      const averageCoverage = totalCoverage / values.length
      const confidence = Math.round(Math.min(
        97,
        evidenceConfidence([
          ...table.headerLines,
          ...table.rows.flatMap((row) => row.cells.flat())
        ]),
        90 + mappingRatio * 4 + averageCoverage * 3
      ))
      candidates.push({
        fieldId: String(field.id),
        fieldLabel: field.label,
        strategy: 'table_grid',
        matchedAlias: normalizeText(field.label),
        proposedValue: values,
        sourceLineIds: [...sourceLineIds],
        mappingConfidence: confidence,
        autoApplyEligible: confidence >= 90,
        rowCount: values.length,
        columnCount: mappedColumns.length,
        score: mappingRatio * 1000 + averageCoverage * 100 + values.length
      })
    }
    const best = candidates.sort((left, right) => right.score - left.score)[0]
    if (best) {
      const { score, ...hint } = best
      hints.push(hint)
    }
  }
  return hints
}

function repeatedTableRows(lines, columns, headerLines) {
  const headerIds = new Set(headerLines.map((line) => String(line.id)))
  const page = Number(headerLines[0]?.page)
  const headerBottom = Math.max(...headerLines.map((line) =>
    Number(line.y) + Math.max(0, Number(line.height) || 0)
  ))
  const centers = columns
    .map((column) => Number(column.x) + Math.max(0, Number(column.width) || 0) / 2)
    .sort((left, right) => left - right)
  const distinctCenters = centers.filter((center, index) =>
    index === 0 || Math.abs(center - centers[index - 1]) >= 0.015
  )
  if (distinctCenters.length < 3) return { rowCount: 0, coveredColumns: 0 }

  const boundaries = distinctCenters.slice(0, -1).map((center, index) =>
    (center + distinctCenters[index + 1]) / 2
  )
  const candidates = [...(lines || [])]
    .filter((line) =>
      Number(line?.page) === page &&
      !headerIds.has(String(line?.id)) &&
      cleanHeaderLabel(line?.text) &&
      Number(line.y) >= headerBottom + 0.002 &&
      Number(line.y) <= Math.min(0.9, headerBottom + 0.65)
    )
    .sort(lineOrder)

  const rows = []
  for (const line of candidates) {
    const existing = rows.find((row) => Math.abs(row.y - Number(line.y)) <= 0.009)
    if (existing) {
      existing.lines.push(line)
      existing.y = existing.lines.reduce((sum, item) => sum + Number(item.y), 0) / existing.lines.length
    } else {
      rows.push({ y: Number(line.y), lines: [line] })
    }
  }

  const minimumCells = Math.max(3, Math.ceil(distinctCenters.length * 0.4))
  const supportedRows = []
  const covered = new Set()
  for (const row of rows) {
    const rowColumns = new Set()
    for (const line of row.lines) {
      const center = Number(line.x) + Math.max(0, Number(line.width) || 0) / 2
      const columnIndex = boundaries.findIndex((boundary) => center < boundary)
      rowColumns.add(columnIndex === -1 ? distinctCenters.length - 1 : columnIndex)
    }
    if (rowColumns.size < minimumCells) continue
    supportedRows.push(row)
    rowColumns.forEach((columnIndex) => covered.add(columnIndex))
  }

  return { rowCount: supportedRows.length, coveredColumns: covered.size }
}

function detectTables(lines, { documentType } = {}) {
  const ordered = [...(lines || [])].sort(lineOrder)
  const results = []
  const claimedHeaders = new Set()
  const seenHeaders = new Set()

  for (const anchor of ordered) {
    if (claimedHeaders.has(String(anchor?.id))) continue
    const band = ordered.filter((line) =>
      Number(line.page) === Number(anchor.page) &&
      Math.abs(Number(line.y) - Number(anchor.y)) <= 0.026
    )
    const columns = tableColumnsFor(band)
    if (columns.length < 3) continue

    const headerLines = [...new Map(
      columns.flatMap((column) => column.lines || [column.line])
        .map((line) => [String(line.id), line])
    ).values()].sort(lineOrder)
    const headerKey = headerLines.map((line) => String(line.id)).sort().join('|')
    if (!headerKey || seenHeaders.has(headerKey)) continue

    const labelLine = [...ordered]
      .filter((line) =>
        Number(line.page) === Number(anchor.page) &&
        Number(line.y) <= Number(anchor.y) &&
        Number(anchor.y) - Number(line.y) <= 0.16 &&
        TABLE_LABEL_PATTERN.test(String(line.text || ''))
      )
      .sort((left, right) => Number(right.y) - Number(left.y))[0]

    const derivedLabel = DERIVED_TABLE_LABELS[documentType] || ''
    const structuralEvidence = repeatedTableRows(ordered, columns, headerLines)
    if (!labelLine && (
      !derivedLabel ||
      structuralEvidence.rowCount < 2 ||
      structuralEvidence.coveredColumns < Math.min(3, columns.length)
    )) continue

    seenHeaders.add(headerKey)
    headerLines.forEach((line) => claimedHeaders.add(String(line.id)))
    const sourceLines = labelLine ? [labelLine, ...headerLines] : headerLines
    const confidence = evidenceConfidence(sourceLines)
    if (confidence < 85) continue

    results.push({
      role: 'table',
      type: 'grid',
      label: labelLine ? exactVisibleMatch(labelLine.text, TABLE_LABEL_PATTERN) : derivedLabel,
      _labelDerivedFromDocumentType: !labelLine,
      required: requiredFrom(sourceLines),
      columns: columns.map((column) => ({ label: column.label, type: column.type })),
      mappingConfidence: confidence,
      sourceLineIds: [...new Set(sourceLines.map((line) => String(line.id)))],
      includedByDefault: true
    })
  }

  return { fields: results, claimedHeaders }
}

function extractDeterministicFields(lines, { documentType } = {}) {
  const rules = PROFILE_RULES[documentType]
  if (!rules) return []
  const ordered = [...(lines || [])].sort(lineOrder)
  const tableResult = detectTables(ordered, { documentType })
  const fields = [...tableResult.fields]
  const seenRules = new Set()
  const seenLabels = new Set(fields.map((field) => normalizeText(field.label)))

  for (const line of ordered) {
    if (!line?.id || isTitleLine(line) || tableResult.claimedHeaders.has(String(line.id))) continue
    for (const rule of [...rules, ...COMMON_RULES]) {
      if (seenRules.has(rule.key)) continue
      const label = exactVisibleMatch(line.text, rule.pattern)
      const labelKey = normalizeText(label)
      if (!label || !labelKey || seenLabels.has(labelKey)) continue
      const confidence = evidenceConfidence([line])
      if (confidence < 85) continue
      fields.push({
        role: 'input',
        type: rule.type,
        label,
        required: requiredFrom([line]),
        multiline: rule.multiline === true,
        mappingConfidence: confidence,
        sourceLineIds: [String(line.id)],
        includedByDefault: true
      })
      seenRules.add(rule.key)
      seenLabels.add(labelKey)
      break
    }
  }

  return fields.slice(0, 25)
}

const isStandaloneValue = (text) => {
  const value = String(text || '').trim()
  if (!value) return true
  if (/^[\d\s,./:#$€£₹()%+-]+$/.test(value)) return true
  if (/^(?:https?:\/\/|www\.|\S+@\S+\.\S+)/i.test(value)) return true
  return false
}

const fieldSignalScore = (line) => {
  const text = String(line?.text || '').trim()
  if (!text || isStandaloneValue(text)) return -10
  let score = 0
  const words = text.split(/\s+/).filter(Boolean)
  if (/[\p{L}]/u.test(text)) score += 1
  if (text.length <= 90 && words.length <= 10) score += 1
  if (/[:=]\s*$/.test(text) || /_{2,}/.test(text)) score += 3
  if (/\b(?:no\.?|number|date|name|code|address|quantity|qty|amount|total|remarks?|comments?|notes?|signature|approved|received|vendor|supplier|customer|invoice|order|grn|item|product|description|terms?)\b/i.test(text)) score += 3
  if (TABLE_LABEL_PATTERN.test(text) || tableColumnsFor([line]).length >= 2) score += 3
  if (isTitleLine(line)) score -= 4
  if (text.length > 140 || words.length > 16) score -= 3
  return score
}

function selectRelevantLines(lines, { excludeLineIds = [], maxCharacters = 8500 } = {}) {
  const excluded = new Set([...excludeLineIds].map(String))
  const ordered = [...(lines || [])].filter((line) => line?.id).sort(lineOrder)
  const scoreById = new Map(ordered.map((line) => [String(line.id), fieldSignalScore(line)]))
  const primary = ordered
    .filter((line) => !excluded.has(String(line.id)) && scoreById.get(String(line.id)) >= 3)
    .sort((left, right) =>
      scoreById.get(String(right.id)) - scoreById.get(String(left.id)) ||
      lineOrder(left, right)
    )

  const selected = new Map()
  let characters = 2
  const add = (line) => {
    const id = String(line?.id || '')
    if (!id || excluded.has(id) || selected.has(id)) return
    const length = JSON.stringify(compactLineArray(line)).length + 1
    if (characters + length > maxCharacters) return
    selected.set(id, line)
    characters += length
  }

  for (const candidate of primary) {
    add(candidate)
    const sameRow = ordered.filter((line) =>
      Number(line.page) === Number(candidate.page) &&
      Math.abs(Number(line.y) - Number(candidate.y)) <= 0.035
    )
    sameRow.forEach(add)
    const index = ordered.indexOf(candidate)
    if (index > 0 && Number(ordered[index - 1].page) === Number(candidate.page)) add(ordered[index - 1])
    if (index + 1 < ordered.length && Number(ordered[index + 1].page) === Number(candidate.page)) add(ordered[index + 1])
  }

  return [...selected.values()].sort(lineOrder)
}

const labelFromCandidate = (line) => {
  const text = String(line?.text || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > 90) return ''
  const prefix = text.match(/^(.{2,60}?)(?::|={1,2}|_{2,})/)
  const label = (prefix?.[1] || text).trim().replace(/\s*[*:=-]\s*$/, '')
  if (!label || label.split(/\s+/).length > 10 || isStandaloneValue(label) || isTitleLine(line)) return ''
  if (tableColumnsFor([line]).length >= 2) return ''
  return label
}

const typeForLabel = (label) => {
  if (/\b(?:date|dated|deadline|valid until)\b/i.test(label)) return 'date'
  if (/\b(?:quantity|qty|amount|price|cost|rate|total|tax|percent|percentage)\b/i.test(label)) return 'number'
  if (/\b(?:signature|signed by)\b/i.test(label)) return 'signature'
  return 'text'
}

function buildManualSuggestions(lines, { excludeLabels = [], limit = MAX_MANUAL_SUGGESTIONS } = {}) {
  const seen = new Set([...excludeLabels].map(normalizeText))
  const suggestions = []
  for (const line of lines || []) {
    if (fieldSignalScore(line) < 4) continue
    const label = labelFromCandidate(line)
    const key = normalizeText(label)
    if (!key || seen.has(key)) continue
    seen.add(key)
    suggestions.push({
      role: 'input',
      type: typeForLabel(label),
      label,
      required: false,
      mappingConfidence: 25,
      sourceLineIds: [String(line.id)],
      includedByDefault: false,
      reviewWarnings: ['AI review was unavailable; verify this suggested field against the source.']
    })
    if (suggestions.length >= limit) break
  }
  return suggestions
}

module.exports = {
  MAX_MANUAL_SUGGESTIONS,
  compactLineArray,
  extractDeterministicFields,
  extractGridMappingHints,
  detectedTableHeaderIds,
  selectRelevantLines,
  buildManualSuggestions
}
