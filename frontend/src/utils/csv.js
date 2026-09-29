// Minimal, dependency-free CSV parsing for the bulk user import. Handles quoted
// fields, embedded commas/newlines inside quotes, escaped quotes (""), and both
// LF and CRLF line endings. Good enough for admin-authored CSVs; not a full
// RFC-4180 library.

// Parse raw CSV text into { headers, rows }. `headers` are lowercased+trimmed
// (so column mapping is case-insensitive); each row is an object keyed by header.
export function parseCsv(text) {
  const records = splitRecords(String(text || ''))
  if (records.length === 0) return { headers: [], rows: [] }

  const headers = records[0].map((h) => h.trim().toLowerCase())
  const rows = []
  for (let i = 1; i < records.length; i++) {
    const cells = records[i]
    // Skip fully blank lines.
    if (cells.length === 1 && cells[0].trim() === '') continue
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim() })
    rows.push(obj)
  }
  return { headers, rows }
}

// Tokenise the whole text into an array of records, each an array of field
// strings. A single pass state machine that respects quotes.
function splitRecords(text) {
  const records = []
  let field = ''
  let record = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }  // escaped quote
        else inQuotes = false
      } else {
        field += c
      }
      continue
    }

    if (c === '"') { inQuotes = true; continue }
    if (c === ',') { record.push(field); field = ''; continue }
    if (c === '\r') { continue }  // ignore CR; handle on LF
    if (c === '\n') { record.push(field); records.push(record); field = ''; record = []; continue }
    field += c
  }
  // Flush the last field/record if the file didn't end with a newline.
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}

// A ready-to-download sample the admin can fill in. The sample rows name real
// departments from this workspace, because the import rejects anything else.
export function buildTemplate(departments = []) {
  const first = departments[0] || 'Finance'
  const second = departments[1] || first
  return [
    'name,email,department,role,manager,hr',
    `Jane Doe,jane@example.com,${first},Employee,manager@example.com,hr@example.com`,
    `John Smith,john@example.com,${second},Manager,,`,
  ].join('\n')
}
