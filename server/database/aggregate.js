'use strict'
const { SqlQuery } = require('./query')
const { catalog, tableName, q } = require('./catalog')

// Only the pipeline operations actually used by NetFlow are supported. They
// compile to joins, grouping and predicates executed by PostgreSQL. Unsupported
// operations fail closed instead of evaluating database scans in application RAM.
function compileAggregate (spec, stages, initialFilter = {}, sharedValues) {
  const values = sharedValues || []
  let builder = new SqlQuery(spec, 't', values)
  let sql = `SELECT t.* FROM ${tableName(spec)} t WHERE ${stages[0]?.$facet ? 'true' : builder.filter(initialFilter)}`
  let fields = null
  const stateBuilder = () => {
    const query = new SqlQuery(spec, 't', values)
    if (spec.joined) {
      const baseField = query.field.bind(query)
      query.field = path => spec.joined[path] ? { ...spec.joined[path], sql: `t.${q(path)}`, exists: `t.${q(path)} IS NOT NULL` } : baseField(path)
    }
    if (fields) {
      query.field = path => {
        if (fields[path]) return { ...fields[path], sql: `t.${q(path)}`, exists: `t.${q(path)} IS NOT NULL` }
        const base = Object.keys(fields).find(f => path.startsWith(f + '.') && fields[f].type === 'jsonb')
        if (!base || !/^[a-zA-Z_0-9.]+$/.test(path)) throw new Error('Unmapped aggregate output: ' + path)
        const sql = `t.${q(base)} #> ARRAY[${path.slice(base.length + 1).split('.').map(p => "'" + p + "'").join(',')}]::text[]`
        return { sql, type: 'jsonb', exists: `${sql} IS NOT NULL` }
      }
    }
    return query
  }
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index]
    const op = Object.keys(stage)[0]
    builder = stateBuilder()
    if (op === '$match') sql = `SELECT t.* FROM (${sql}) t WHERE ${builder.filter(stage.$match)}`
    else if (op === '$sort') sql = `SELECT t.* FROM (${sql}) t ORDER BY ${builder.order(stage.$sort)}`
    else if (op === '$limit' || op === '$skip') {
      const n = stage[op]
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid aggregate pagination')
      sql = `SELECT t.* FROM (${sql}) t ${op === '$limit' ? 'LIMIT' : 'OFFSET'} ${n}`
    } else if (op === '$group' || op === '$project') {
      const next = {}
      const select = []
      let groupSQL
      for (const [key, value] of Object.entries(stage[op])) {
        if (op === '$project' && value === 0) continue
        let expression
        if (op === '$group' && key !== '_id') {
          const aggregate = Object.keys(value)[0]
          const name = { $sum: 'sum', $avg: 'avg', $max: 'max', $min: 'min' }[aggregate]
          if (!name) throw new Error('Unsupported aggregate accumulator: ' + aggregate)
          const argument = builder.expression(value[aggregate])
          expression = { sql: `${name}(${argument.sql})`, type: ['sum', 'avg'].includes(name) ? 'numeric' : argument.type }
        } else expression = builder.expression(op === '$project' && value === 1 ? '$' + key : value)
        select.push(`${expression.sql} AS ${q(key)}`)
        next[key] = { type: expression.type }
        if (op === '$group' && key === '_id' && value !== null) groupSQL = expression.sql
      }
      // Grouping by a constant on an empty input returns no rows, like Mongo.
      const emptyGuard = op === '$group' && !groupSQL ? ' HAVING count(*) > 0' : ''
      sql = `SELECT ${select.join(',')} FROM (${sql}) t${groupSQL ? ' GROUP BY ' + groupSQL : ''}${emptyGuard}`
      fields = next
    } else if (op === '$lookup') {
      const lookup = stage.$lookup
      const target = Object.values(catalog()).find(s => s.collection === lookup.from)
      const next = stages[index + 1]?.$unwind
      const unwind = typeof next === 'string' ? { path: next } : next
      if (!target || !unwind || unwind.path !== '$' + lookup.as || fields) throw new Error('Unsupported join shape')
      const foreign = new SqlQuery(target, 'j', values).field(lookup.foreignField)
      const local = builder.field(lookup.localField)
      const selections = spec.fields.map(f => `t.${q(f.column)}`)
      selections.push('t.legacy_refs', 't.source_missing', 't.api_version')
      const joinFields = target.fields.map(f => `j.${q(f.column)} AS ${q(lookup.as + '.' + f.path)}`)
      sql = `SELECT ${selections.concat(joinFields).join(',')} FROM (${sql}) t ${unwind.preserveNullAndEmptyArrays ? 'LEFT' : 'INNER'} JOIN ${tableName(target)} j ON ${foreign.sql} = ${local.sql}`
      // Preserve original fields while introducing the joined field resolver.
      const joined = Object.fromEntries(target.fields.map(f => [lookup.as + '.' + f.path, { type: f.type }]))
      spec = { ...spec, joined }
      // stateBuilder below handles these aliases without serializing secret rows.
      index++
    } else if (op === '$facet') {
      if (index !== 0 || stages.length !== 1) throw new Error('Unsupported facet placement')
      const entries = []
      for (const [name, pipeline] of Object.entries(stage.$facet)) {
        const child = compileAggregate(spec, pipeline, initialFilter, values)
        entries.push(`(SELECT COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb) FROM (${child.sql}) f) AS ${q(name)}`)
      }
      sql = 'SELECT ' + entries.join(',')
      fields = Object.fromEntries(Object.keys(stage.$facet).map(k => [k, { type: 'jsonb' }]))
    } else throw new Error('Unsupported aggregate stage: ' + op)
  }
  return { sql, values, fields }
}
module.exports = { compileAggregate }
