'use strict'
const dns = require('node:dns').promises
const net = require('node:net')
const https = require('node:https')
const http = require('node:http')
const blocked = new net.BlockList()
for (const [address, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address,bits)
const publicV6 = new net.BlockList()
publicV6.addSubnet('2000::',3,'ipv6')
const excludedV6 = new net.BlockList()
excludedV6.addSubnet('2001::',23,'ipv6')
excludedV6.addSubnet('2001:db8::',32,'ipv6')
excludedV6.addSubnet('2002::',16,'ipv6')
function isPublicAddress (address) {
  const family = net.isIP(address)
  return family === 4 ? !blocked.check(address) : family === 6 && publicV6.check(address,'ipv6') && !excludedV6.check(address,'ipv6')
}
async function safeRequest ({ url, method, headers, body, timeoutMs = 10000 }) {
  const target = new URL(url)
  const privateAllowed = process.env.NODE_ENV !== 'production' && process.env.WEBHOOK_ALLOW_PRIVATE === 'true'
  if (target.username || target.password || !['https:', ...(privateAllowed ? ['http:'] : [])].includes(target.protocol)) throw new Error('Unsafe webhook URL')
  const host = target.hostname.replace(/^\[|\]$/g, '')
  let dnsTimer
  const addresses = net.isIP(host) ? [{address:host,family:net.isIP(host)}] : await Promise.race([
    dns.lookup(host,{all:true}),
    new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('Webhook DNS timed out')), 5000) })
  ]).finally(() => clearTimeout(dnsTimer))
  if (!addresses.length || (!privateAllowed && addresses.some(entry=>!isPublicAddress(entry.address)))) throw new Error('Webhook target is not a public address')
  // Pin the validated address to the connection: no second DNS lookup or redirect.
  const selected = addresses[0]
  return new Promise((resolve,reject)=>{
    const transport = target.protocol === 'https:' ? https : http
    const request = transport.request(target,{method,headers,
      lookup: (_host,options,callback)=> options?.all ? callback(null,[selected]) : callback(null,selected.address,selected.family)
    }, response=>{
      if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); reject(new Error('Webhook redirects are not allowed')); return }
      const chunks=[];let bytes=0
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)request.destroy(new Error('Webhook response exceeds 1 MB'));else chunks.push(chunk)})
      response.on('error',reject)
      response.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let data=text;try{data=JSON.parse(text)}catch{};resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,data})})
    })
    const deadline=setTimeout(()=>request.destroy(new Error('Webhook request timed out')),Math.min(60000,Math.max(1000,Number(timeoutMs)||10000)))
    request.on('close',()=>clearTimeout(deadline));request.on('error',reject)
    if(body!==undefined)request.write(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body))
    request.end()
  })
}
module.exports = { isPublicAddress, safeRequest }
