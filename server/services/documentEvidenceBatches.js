// Plan requests using the exact serialized prompt, including the system text.
// Required citations are never truncated to squeeze a request into the budget.
function planEvidenceBatches(items, chunk, { system, inputLimit, promptFor, evidenceFor }) {
  const available = new Set(chunk.lines.map((line) => String(line.id)))
  const make = (members) => {
    const required = new Set(members.flatMap(evidenceFor).map(String).filter((id) => available.has(id)))
    const nearby = new Set(required)
    chunk.lines.forEach((line, index) => {
      if (!required.has(String(line.id))) return
      for (const offset of [-2, -1, 1, 2]) {
        const context = chunk.lines[index + offset]
        if (context && Number(context.page) === Number(line.page)) nearby.add(String(context.id))
      }
    })
    const build = (ids) => {
      const lines = chunk.lines.filter((line) => ids.has(String(line.id)))
      const source = { ...chunk, lines,
        pageStart: Math.min(...lines.map((line) => Number(line.page))),
        pageEnd: Math.max(...lines.map((line) => Number(line.page))) }
      const targetLineIds = [...required]
      const prompt = promptFor(members, source, targetLineIds)
      return { items: members, source, targetLineIds, prompt, characters: system.length + prompt.length }
    }
    const contextual = build(nearby)
    return contextual.characters <= inputLimit ? contextual : build(required)
  }
  const batches = []
  const oversized = []
  let current = []
  for (const item of items) {
    const trial = make([...current, item])
    if (trial.characters <= inputLimit) { current.push(item); continue }
    if (current.length) { batches.push(make(current)); current = [] }
    const single = make([item])
    if (single.characters <= inputLimit) current.push(item)
    else oversized.push(item)
  }
  if (current.length) batches.push(make(current))
  return { batches, oversized }
}

module.exports = { planEvidenceBatches }
