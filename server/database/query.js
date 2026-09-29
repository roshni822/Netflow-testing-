'use strict'
const { q, tableName } = require('./catalog')
const { plain } = require('./value')
const literal = value => "'" + String(value).replace(/'/g, "''") + "'"
const safePath = path => {
  if (typeof path !== 'string' || !/^[a-zA-Z_][a-zA-Z_0-9]*(\.[a-zA-Z_0-9]+)*$/.test(path)) throw new Error('Unsupported database field path')
  return path
}

class SqlQuery {
  constructor (spec, alias = 't', values = []) { this.spec = spec; this.alias = alias; this.values = values }
  param (value, type) {
    this.values.push(type === 'jsonb' ? JSON.stringify(plain(value)) : value)
    return `$${this.values.length}${type ? '::' + type : ''}`
  }
  field (path) {
    safePath(path)
    if (path === '__v') return { sql: `${this.alias}.api_version`, type: 'numeric', exists: 'true' }
    const direct = this.spec.fields.find(f => f.path === path)
    const expression = (part, field, alias) => {
      let sql = `${alias}.${q(field.column)}`
      if (field.ref) sql = `COALESCE(${sql}, ${alias}.legacy_refs ->> ${literal(field.path)})`
      return { sql, type: field.type, exists: `NOT (${alias}.source_missing @> ARRAY[${literal(field.path)}]::text[])`, field, part }
    }
    if (direct) return expression(this.spec, direct, this.alias)
    const json = this.spec.fields.find(f => f.type === 'jsonb' && path.startsWith(f.path + '.'))
    if (json) {
      const rest = path.slice(json.path.length + 1).split('.')
      const sql = `${this.alias}.${q(json.column)} #> ARRAY[${rest.map(literal).join(',')}]::text[]`
      const jsonPath = '$.' + rest.map(p => /^\d+$/.test(p) ? `[${p}]` : JSON.stringify(p)).join('.').replace(/\.\[/g, '[')
      return { sql, type: 'jsonb', exists: `${sql} IS NOT NULL`, many: `jsonb_path_query(${this.alias}.${q(json.column)}, ${literal(jsonPath)}::jsonpath)` }
    }
    for (const child of this.spec.children) {
      const f = child.fields.find(f => f.path === path)
      if (child.one && f) {
        const e = expression(child, f, 'c')
        return { ...e, sql: `(SELECT ${e.sql} FROM ${tableName(child)} c WHERE c.owner_id = ${this.alias}.id)`, exists: `(SELECT ${e.exists} FROM ${tableName(child)} c WHERE c.owner_id = ${this.alias}.id)` }
      }
      if (!child.one && (path === child.path || path.startsWith(child.path + '.'))) {
        if (child.primitive) {
          const e = expression(child, child.fields[0], 'c')
          return { sql: `(SELECT COALESCE(jsonb_agg(${e.sql} ORDER BY position),'[]'::jsonb) FROM ${tableName(child)} c WHERE c.owner_id=${this.alias}.id)`, type: 'jsonb', array: true,
            exists: `NOT (${this.alias}.source_missing @> ARRAY[${literal(child.path)}]::text[])` }
        }
        const relative = path.slice(child.path.length + 1)
        const cf = child.fields.find(f => f.localPath === relative)
        if (cf) {
          const e = expression(child, cf, 'c')
          return { sql: `(SELECT COALESCE(jsonb_agg(${e.sql} ORDER BY position),'[]'::jsonb) FROM ${tableName(child)} c WHERE c.owner_id=${this.alias}.id)`, type: 'jsonb', array: true, exists: 'true' }
        }
      }
    }
    // Unknown application paths must fail explicitly, not become unfiltered scans.
    throw new Error(`Unmapped query field: ${this.spec.name}.${path}`)
  }
  compare (field, operator, value) {
    const sql = field.sql
    if (operator === '$exists') return value ? `COALESCE(${field.exists},false)` : `NOT COALESCE(${field.exists},false)`
    if (operator === '$eq' && value === null) return `(${sql} IS NULL${field.type === 'jsonb' ? ` OR ${sql} = 'null'::jsonb` : ''})`
    if (operator === '$ne') return `NOT COALESCE((${this.compare(field, '$eq', value)}), false)`
    if (['$in', '$nin'].includes(operator)) {
      if (!Array.isArray(value)) throw new Error('Membership filter requires an array')
      const any = value.length ? '(' + value.map(v => this.compare(field, '$eq', v)).join(' OR ') + ')' : 'false'
      return operator === '$nin' ? `NOT COALESCE(${any},false)` : any
    }
    if (operator === '$regex') {
      const regex = value instanceof RegExp ? value : new RegExp(String(value))
      if (regex.flags.replace(/[iu]/g, '')) throw new Error('Unsupported search regex flags')
      const pattern = regex.source
      const op = regex.ignoreCase ? '~*' : '~'
      if (field.type === 'text[]') return `EXISTS (SELECT 1 FROM unnest(${sql}) v WHERE v ${op} ${this.param(pattern)})`
      if (field.many) return `EXISTS (SELECT 1 FROM ${field.many} v WHERE (v #>> '{}') ${op} ${this.param(pattern)})`
      return `${field.type === 'jsonb' ? `(${sql} #>> '{}')` : sql} ${op} ${this.param(pattern)}`
    }
    if (operator === '$not') return `NOT COALESCE((${this.condition(field, value)}),false)`
    if (operator === '$size') return `jsonb_array_length(${sql}) = ${this.param(Number(value))}`
    const op = { $eq: '=', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[operator]
    if (!op) throw new Error(`Unsupported database filter operator: ${operator}`)
    if ((field.field?.ref || field.field?.path === '_id') && value != null && !/^[a-f0-9]{24}$/i.test(String(value?._id || value))) {
      throw Object.assign(new Error('Invalid record identifier'), { name: 'CastError', path: field.field.path, value: '[invalid identifier]' })
    }
    if (field.type === 'jsonb') {
      const parameter = this.param(value, 'jsonb')
      if (field.many) return `EXISTS (SELECT 1 FROM ${field.many} v WHERE v ${op} ${parameter}${operator === '$eq' && !Array.isArray(value) ? ` OR (jsonb_typeof(v)='array' AND v @> jsonb_build_array(${parameter}))` : ''})`
      if (field.array && !Array.isArray(value) && operator === '$eq') return `${sql} @> jsonb_build_array(${parameter})`
      if (operator === '$eq' && !Array.isArray(value)) return `(${sql} = ${parameter} OR (jsonb_typeof(${sql}) = 'array' AND ${sql} @> jsonb_build_array(${parameter})))`
      return `${sql} ${op} ${parameter}`
    }
    if (field.type === 'text[]' && !Array.isArray(value)) return `${this.param(String(value))} ${op} ANY(${sql})`
    return `${sql} ${op} ${this.param(value, field.type)}`
  }
  condition (field, value) {
    if (value instanceof RegExp) return this.compare(field, '$regex', value)
    if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && Object.keys(value).some(k => k.startsWith('$'))) {
      return Object.entries(value).filter(([k]) => k !== '$options').map(([op, v]) => this.compare(field, op, op === '$regex' && value.$options ? new RegExp(v, value.$options) : v)).join(' AND ')
    }
    return this.compare(field, '$eq', value)
  }
  filter (filter = {}) {
    const terms = []
    for (const [key, value] of Object.entries(filter || {})) {
      if (key === '$and' || key === '$or' || key === '$nor') {
        if (!Array.isArray(value)) throw new Error('Logical filter must be an array')
        const expression = value.length ? value.map(v => '(' + this.filter(v) + ')').join(key === '$and' ? ' AND ' : ' OR ') : key === '$and' ? 'true' : 'false'
        terms.push(key === '$nor' ? `NOT (${expression})` : `(${expression})`)
      } else if (key === '$expr') terms.push(this.expression(value).sql)
      else terms.push('(' + this.condition(this.field(key), value) + ')')
    }
    return terms.join(' AND ') || 'true'
  }
  expression (value) {
    if (typeof value === 'string' && value.startsWith('$')) return this.field(value.slice(1))
    if (value === null) return { sql: 'NULL', type: 'unknown' }
    if (value instanceof Date) return { sql: this.param(value, 'timestamptz'), type: 'timestamptz' }
    if (Array.isArray(value)) return { sql: `jsonb_build_array(${value.map(v => this.expression(v).sql).join(',')})`, type: 'jsonb' }
    if (typeof value !== 'object') return { sql: this.param(value, typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'numeric' : 'text'), type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'numeric' : 'text' }
    const op = Object.keys(value)[0]
    if (!op.startsWith('$')) return { sql: `jsonb_build_object(${Object.entries(value).flatMap(([k, v]) => [this.param(k, 'text'), this.expression(v).sql]).join(',')})`, type: 'jsonb' }
    const operand = value[op]
    if (op === '$cond') {
      const [condition, yes, no] = Array.isArray(operand) ? operand : [operand.if, operand.then, operand.else]
      const a = this.expression(yes); const b = this.expression(no)
      return { sql: `(CASE WHEN ${this.truth(this.expression(condition))} THEN ${a.sql} ELSE ${b.sql} END)`, type: a.type === 'unknown' ? b.type : a.type }
    }
    if (op === '$and' || op === '$or') return { sql: '(' + operand.map(v => this.truth(this.expression(v))).join(op === '$and' ? ' AND ' : ' OR ') + ')', type: 'boolean' }
    if (op === '$in') {
      const left = this.expression(operand[0])
      return { sql: `(${left.sql} IN (${operand[1].map(v => this.expression(v).sql).join(',')}))`, type: 'boolean' }
    }
    if (op === '$ifNull') {
      const a = this.expression(operand[0]); const b = this.expression(operand[1])
      if (a.type !== b.type && b.type === 'boolean') return { sql: `(${a.sql} IS NOT NULL OR ${b.sql})`, type: 'boolean' }
      return { sql: `COALESCE(${a.sql}, ${b.sql})`, type: a.type }
    }
    const comparisons = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=', $eq: 'IS NOT DISTINCT FROM', $ne: 'IS DISTINCT FROM' }
    if (comparisons[op]) return { sql: `(${this.expression(operand[0]).sql} ${comparisons[op]} ${this.expression(operand[1]).sql})`, type: 'boolean' }
    if (op === '$subtract') {
      const a = this.expression(operand[0]); const b = this.expression(operand[1])
      return { sql: a.type === 'timestamptz' && b.type === 'timestamptz' ? `(extract(epoch FROM (${a.sql} - ${b.sql})) * 1000)` : `(${a.sql} - ${b.sql})`, type: 'numeric' }
    }
    if (op === '$divide' || op === '$multiply' || op === '$add') {
      const operands = operand.map(v => this.expression(v).sql)
      return { sql: '(' + operands.join(op === '$divide' ? ' / ' : op === '$multiply' ? ' * ' : ' + ') + ')', type: 'numeric' }
    }
    if (op === '$round') {
      const number = this.expression(operand[0]).sql
      const places = Number(operand[1] || 0)
      if (!Number.isInteger(places) || Math.abs(places) > 20) throw new Error('Unsupported rounding precision')
      const scale = `power(10::numeric, ${places})`
      const scaled = `(${number} * ${scale})`
      return { sql: `(CASE WHEN abs(${scaled} - trunc(${scaled})) = 0.5 THEN round(${scaled} / 2) * 2 / ${scale} ELSE round(${number}, ${places}) END)`, type: 'numeric' }
    }
    const dateParts = { $year: 'year', $month: 'month', $dayOfMonth: 'day', $isoWeekYear: 'isoyear', $isoWeek: 'week' }
    if (dateParts[op]) return { sql: `extract(${dateParts[op]} FROM ${this.expression(operand).sql} AT TIME ZONE 'UTC')`, type: 'numeric' }
    if (op === '$dateToString') {
      const formats = { '%Y-%m-%d': 'YYYY-MM-DD', '%Y-%m': 'YYYY-MM' }
      if (!formats[operand.format]) throw new Error('Unsupported date bucket format')
      return { sql: `to_char(${this.expression(operand.date).sql} AT TIME ZONE ${this.param(operand.timezone || 'UTC')}, ${this.param(formats[operand.format])})`, type: 'text' }
    }
    throw new Error(`Unsupported database expression: ${op}`)
  }
  truth (expression) { return expression.type === 'boolean' ? expression.sql : expression.type === 'numeric' ? `COALESCE(${expression.sql} <> 0,false)` : `${expression.sql} IS NOT NULL` }
  order (sort = {}) {
    if (typeof sort === 'string') sort = Object.fromEntries(sort.split(/\s+/).filter(Boolean).map(k => [k.replace(/^-/, ''), k.startsWith('-') ? -1 : 1]))
    return Object.entries(sort).map(([key, direction]) => `${this.field(key).sql} ${direction === -1 ? 'DESC NULLS LAST' : 'ASC NULLS FIRST'}`).join(', ')
  }
}
module.exports = { SqlQuery, safePath }
