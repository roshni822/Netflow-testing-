'use strict'
const { transaction } = require('./postgres')

// Wrap only the final async business handler, after auth/authorization middleware.
// Hold JSON responses until COMMIT so the client cannot observe a success for a
// transaction that subsequently fails. Files/external services are not SQL resources.
function atomicRoutes (router, options = {}) {
  for (const layer of router.stack) {
    if (!layer.route || !Object.keys(layer.route.methods).some(m => ['post', 'put', 'patch', 'delete'].includes(m))) continue
    if (options.paths && !options.paths.includes(layer.route.path)) continue
    // These POST endpoints only compute a preview and may wait on an LLM. They
    // do not need a transaction or an idle database connection during inference.
    if (['/ai-draft', '/ai-suggest', '/:id/approval-preview'].includes(layer.route.path)) continue
    const final = layer.route.stack.at(-1)
    const handler = final.handle
    final.handle = async (req, res, next) => {
      const originalJSON = res.json
      let body
      let responded = false
      res.json = value => { body = value; responded = true; return res }
      try {
        try {
          await transaction(async client => {
            // Serializes decisions on a task and edits of a single business
            // object across API instances. The second caller reads the new state.
            if (req.params.id) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [req.baseUrl + ':' + req.params.id])
            if (options.accountLock && (req.authIdentity || req.user?._id)) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['account:' + (req.authIdentity || req.user._id)])
            await handler(req, res, error => { if (error) throw error })
            if (responded && res.statusCode >= 400 && !options.commitErrorPaths?.includes(layer.route.path)) throw Object.assign(new Error('Business operation declined'), { businessResponse: true })
          })
        } catch (error) { if (!error.businessResponse) throw error }
        res.json = originalJSON
        if (responded) return res.json(body)
      } catch (error) { res.json = originalJSON; next(error) }
    }
  }
  return router
}
module.exports = { atomicRoutes }
