// Scores inside the document pipeline are percentages. Convert provider scores
// once, at the response boundary; absent/invalid scores are not measured zeroes.
const numericScore = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

const percentScore = (value) => {
  const number = numericScore(value)
  return number !== null && number <= 100 ? number : null
}

function llmScore(value, scale) {
  const number = numericScore(value)
  if (number === null) return null
  if (scale === 'percent') return percentScore(number)
  if (scale === 'fraction') return number <= 1 ? number * 100 : null
  // Older prompts did not state units; accept their common 0..1 convention.
  return percentScore(number <= 1 ? number * 100 : number)
}

const averageScore = (values) => {
  const scores = values.map(percentScore).filter((value) => value !== null)
  return scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 10) / 10 : null
}

const sourceMethod = (line) => ['digital', 'ocr'].includes(line?.source) ? line.source : 'unknown'

function sourceDetails(lines) {
  const ocr = lines.filter((line) => sourceMethod(line) === 'ocr')
  return {
    sourceConfidence: averageScore(lines.map((line) => line.confidence)),
    sourceMethods: [...new Set(lines.map(sourceMethod))],
    ocrConfidence: averageScore(ocr.map((line) => line.confidence))
  }
}

function qualitySummary(lines, candidates) {
  const digital = lines.filter((line) => sourceMethod(line) === 'digital')
  const ocr = lines.filter((line) => sourceMethod(line) === 'ocr')
  const summarize = (values) => ({
    confidence: averageScore(values),
    scoredFields: values.filter((value) => percentScore(value) !== null).length,
    totalFields: candidates.length
  })
  return {
    version: 1,
    digital: { pageCount: new Set(digital.map((line) => line.page)).size, lineCount: digital.length },
    ocr: {
      pageCount: new Set(ocr.map((line) => line.page)).size,
      lineCount: ocr.length,
      confidence: averageScore(ocr.map((line) => line.confidence))
    },
    grounding: summarize(candidates.map((candidate) => candidate.generatorConfidence)),
    validation: {
      ...summarize(candidates.map((candidate) => candidate.criticStatus === 'validated' ? candidate.criticConfidence : null)),
      unavailableFields: candidates.filter((candidate) => candidate.criticStatus !== 'validated').length
    }
  }
}

module.exports = { percentScore, llmScore, averageScore, sourceMethod, sourceDetails, qualitySummary }
