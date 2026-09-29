// Route boundary test with in-process service doubles. No DB or stored files.
const assert = require('node:assert/strict')
const FormGenerationJob = require('../models/FormGenerationJob')
const storage = require('../services/extractionStorage')
const originals = { findOne: FormGenerationJob.findOne, deleteOne: FormGenerationJob.deleteOne, deleteSource: storage.deleteSource }
let removed = 0
let query
const job = { _id: 'owned-job', status: 'ready', processingVersion: 2, maxFields: 100,
  generatedTitle: 'Fixture intake', sourceFile: { filename: 'fixture.pdf', mimetype: 'application/pdf' },
  candidates: Array.from({ length: 100 }, (_, index) => ({ candidateId: 'c' + index,
    includedByDefault: true, field: { label: 'Field ' + index, type: 'text', page: 1 } })),
  coverage: { status: 'partial', unresolvedCount: 2 }, limitReached: false }
FormGenerationJob.findOne = (filter) => { query = filter; return Object.assign(Promise.resolve(job), { lean: async () => job }) }
FormGenerationJob.deleteOne = async () => { removed += 1 }
storage.deleteSource = async () => { removed += 1 }
const router = require('../routes/formGeneration')
const invoke = async (path, method, body) => {
  const handler = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
  await handler({ params: { jobId: job._id }, user: { _id: 'requester' }, organization: { _id: 'tenant' }, body }, response, (error) => { throw error })
  assert.deepEqual(query, { _id: job._id, requesterId: 'requester', orgId: 'tenant' })
  return response
}

async function main() {
  const status = await invoke('/:jobId', 'get')
  assert.equal(status.body.job.candidates.length, 100)
  assert.equal(status.body.job.maxFields, 100)
  assert.equal(status.body.job.coverage.status, 'partial')
  assert.equal(status.body.job.lines, undefined)
  const candidates = job.candidates.map((candidate) => ({ ...candidate, included: true }))
  for (const selection of [[...candidates, candidates[0]], [candidates[0], candidates[0]], [{ candidateId: 'forged', included: true }]]) {
    const rejected = await invoke('/:jobId/complete', 'post', { candidates: selection })
    assert.equal(rejected.statusCode, 400)
    assert.equal(removed, 0, 'Invalid review must preserve the job and source')
  }
  const completed = await invoke('/:jobId/complete', 'post', { title: 'Reviewed', candidates })
  assert.equal(completed.statusCode, 200)
  assert.equal(completed.body.draft.fields.length, 100)
  assert.equal(completed.body.draft.fields[99].label, 'Field 99')
  assert.equal(removed, 2)
  job.processingVersion = 1
  delete job.maxFields
  delete job.coverage
  const legacy = await invoke('/:jobId', 'get')
  assert.equal(legacy.body.job.maxFields, 25)
  assert.equal(legacy.body.job.coverage, null)
  console.log('Document review route tests passed: owned-job scoping, status metadata, 100-field completion, invalid-selection preservation, legacy compatibility. Storage/DB are test doubles.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  FormGenerationJob.findOne = originals.findOne
  FormGenerationJob.deleteOne = originals.deleteOne
  storage.deleteSource = originals.deleteSource
})
