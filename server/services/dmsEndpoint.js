// Outbound transport for tenant-supplied DMS endpoints. DNS is checked inside
// the socket lookup (not in a separate preflight) and redirects are not followed.
const dns = require('node:dns')
const net = require('node:net')
const http = require('node:http')
const https = require('node:https')

const endpointError = (message) => Object.assign(new Error(message), { code: 'DMS_INVALID_ENDPOINT', status: 422 })
const trustedOrigin = (url) => String(process.env.DMS_TRUSTED_ORIGINS || '').split(',').some(value => value.trim() === url.origin)

function normalizeEndpoint(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  let url
  try { url = new URL(text) } catch { throw endpointError('Enter a valid DMS API base URL.') }
  if (url.username || url.password || url.search || url.hash) throw endpointError('DMS URL must not contain credentials, a query or a fragment.')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && trustedOrigin(url))) {
    throw endpointError('Use HTTPS. Private HTTP installations require an administrator-approved DMS_TRUSTED_ORIGINS entry.')
  }
  return url.href.replace(/\/+$/, '')
}

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  // Allow only global unicast IPv6; exclude documentation and transition ranges.
  const v6 = String(address).toLowerCase()
  return net.isIP(v6) === 6 && /^[23]/.test(v6) && !v6.startsWith('2001:') && !v6.startsWith('2002:')
}

async function fetchEndpoint(rawUrl, options = {}) {
  const maxResponseBytes = Math.min(25 * 1024 * 1024, Math.max(1, Number(options.maxResponseBytes) || 8 * 1024 * 1024))
  const url = new URL(rawUrl)
  normalizeEndpoint(url.origin + url.pathname)
  if (url.username || url.password || url.hash) throw endpointError('Invalid DMS request URL.')
  const trusted = trustedOrigin(url)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(hostname) && !trusted && !publicAddress(hostname)) throw endpointError('DMS endpoint must resolve to a public address.')
  // Reuse the platform FormData serializer, including its generated boundary.
  const prepared = new Request(url, { method: options.method || 'GET', headers: options.headers, body: options.body })
  const body = options.body == null ? null : Buffer.from(await prepared.arrayBuffer())
  const headers = Object.fromEntries(prepared.headers)
  if (body) headers['content-length'] = String(body.length)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(url, {
      method: options.method || 'GET', headers, signal: options.signal,
      lookup(host, lookupOptions, callback) {
        dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
          if (error) return callback(error)
          if (!addresses.length || (!trusted && addresses.some(item => !publicAddress(item.address)))) {
            return callback(endpointError('DMS endpoint must resolve to public addresses.'))
          }
          if (lookupOptions.all) return callback(null, addresses)
          callback(null, addresses[0].address, addresses[0].family)
        })
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume()
        return reject(endpointError('DMS redirects are not allowed. Enter the final API base URL.'))
      }
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > maxResponseBytes) {
          reject(endpointError('DMS response exceeds the supported size.'))
          response.destroy()
          request.destroy()
          return
        }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), {
        status: response.statusCode, headers: response.headers
      })))
    })
    request.on('error', reject)
    request.end(body)
  })
}

module.exports = { normalizeEndpoint, fetchEndpoint, publicAddress }
