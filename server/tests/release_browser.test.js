'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto')
process.chdir(require('node:path').resolve(__dirname, '../..'))
const {chromium,request}=require('playwright')
const env=require('dotenv').parse(fs.readFileSync('deploy/local/.env.verify'))
const base='https://localhost:18443'
async function main(){
 const http=await request.newContext({baseURL:base,ignoreHTTPSErrors:true})
 let browser, page
 const call=async(method,route,token,data)=>{
  const r=await http.fetch('/api'+route,{method,headers:token?{Authorization:'Bearer '+token}:{},data})
  const body=await r.json();assert.ok(r.ok(),`${method} ${route}: ${r.status()} ${body.code||''}`);return body
 }
 try{
  assert.equal((await http.get('/api/ready')).status(),200)
  assert.equal((await http.post('/api/auth/register',{data:{}})).status(),403)
  const platform=await call('POST','/auth/login',null,{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})
  browser=await chromium.launch({headless:true,channel:'chrome'})
  const errors=[],external=[]
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}})
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==base){external.push(u.hostname);return route.abort()}return route.continue()})
  await context.addInitScript(id=>{if(window!==window.top)return;try{localStorage.setItem('fs.userGuide.completed.'+id,'1')}catch{}},platform.user._id)
  page=await context.newPage()
  await page.goto(base+'/login');await page.locator('#email').fill(env.ADMIN_EMAIL);await page.locator('#password').fill(env.ADMIN_PASSWORD)
  await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.waitForURL('**/dashboard');await page.waitForLoadState('networkidle')
  await page.screenshot({path:'output/release-platform.png',fullPage:true})
  const suffix=Date.now().toString(36)
  const created=await call('POST','/platform/orgs',platform.token,{name:'Isolated release check '+suffix,subdomain:'release-'+suffix,allowedDomains:['qa.test'],adminEmail:'admin-'+suffix+'@qa.test',adminName:'Release Administrator',plan:'basic',adminCanBuild:true,countAdminTowardSeats:true})
  const first=await call('POST','/auth/login',null,{email:'admin-'+suffix+'@qa.test',password:created.admin.tempPassword,subdomain:'release-'+suffix})
  const tenant=await call('POST','/auth/change-password',first.token,{newPassword:crypto.randomBytes(24).toString('hex')+'aA1!'})
  await call('POST','/auth/product-tour/complete',tenant.token,{})
  await context.addInitScript(session=>{if(window!==window.top)return;localStorage.setItem('flowsphere_token',session.token);localStorage.setItem('flowsphere_user',JSON.stringify(session.user));localStorage.setItem('fs.userGuide.completed.'+session.user._id,'1')},tenant)
  await page.goto(base+'/dashboard');await page.locator('#main-content').waitFor();await page.waitForLoadState('networkidle');await page.getByText('No workflows available',{exact:true}).waitFor();await page.screenshot({path:'output/release-tenant.png',fullPage:true})
  for(const route of ['/forms','/workflows','/forms/new?blank=1','/workflows/new']){console.log('Checking route',route);await page.goto(base+route);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>document.body.innerText.length>150);if(route.startsWith('/forms/new'))await page.getByLabel('Form name',{exact:true}).waitFor();assert.ok((await page.locator('body').innerText()).length>100,route)}
  await page.screenshot({path:'output/release-workflow.png',fullPage:true})
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/dashboard');await page.locator('#main-content').waitFor();await page.waitForLoadState('networkidle');await page.getByText('No workflows available',{exact:true}).waitFor();await page.screenshot({path:'output/release-mobile.png',fullPage:true})
  const form=(await call('POST','/forms',tenant.token,{title:'Release signature check',description:'Isolated local fixture',fields:[{id:'requester',type:'text',label:'Requester',required:true},{id:'signature',type:'signature',label:'Signature',required:true}]})).form
  await call('POST',`/forms/${form._id}/publish`,tenant.token,{})
  const shared=(await call('POST',`/forms/${form._id}/public`,tenant.token,{enabled:true})).form
  const publicContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1000,height:900}})
  const pub=await publicContext.newPage();pub.on('pageerror',e=>errors.push(e.message))
  await pub.goto(base+'/f/'+shared.public.token)
  await pub.getByLabel('Requester',{exact:false}).fill('Local Release Check')
  await pub.getByRole('button',{name:'Upload',exact:true}).click()
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1z8AAAAASUVORK5CYII=','base64')
  const uploaded=pub.waitForResponse(r=>r.url().includes('/upload?')&&r.request().method()==='POST')
  await pub.locator('input[type=file]').setInputFiles({name:'signature.png',mimeType:'image/png',buffer:png})
  assert.equal((await uploaded).status(),201)
  await pub.getByRole('button',{name:'Submit',exact:true}).click()
  await pub.getByText('Thanks — your response was recorded',{exact:true}).waitFor()
  await pub.screenshot({path:'output/release-public-submitted.png',fullPage:true})
  const responses=await call('GET',`/forms/${form._id}/responses`,tenant.token)
  const file=responses.responses[0].formData.signature
  assert.ok(file.url.includes('/api/files/'));assert.ok(file.uploadToken);assert.equal(file.kind,'uploaded')
  assert.equal((await http.get(file.url)).status(),200)
  const path=file.url.split('?')[0]
  const revised=await call('POST',path.replace('/api','')+'/link',tenant.token,{revoke:true})
  assert.equal((await http.get(file.url)).status(),403)
  assert.equal((await http.get(revised.url)).status(),200)
  assert.equal((await http.get('/docs/')).status(),200)
  assert.deepEqual(errors,[],'Browser runtime errors')
  assert.deepEqual(external,[],'Hosted runtime requests')
  fs.writeFileSync('output/release-browser-result.json',JSON.stringify({passed:true,checks:['HTTPS readiness','production signup disabled','browser login','platform and tenant dashboards','form and workflow routes','mobile layout','public signature upload and submit','file expiry-capable links and revocation','bundled docs','no browser errors or hosted requests']},null,2))
  console.log('PASS: local production browser and attachment flow')
 }catch(e){if(page){await page.screenshot({path:'output/release-failure.png',fullPage:true});console.log('Failure page',new URL(page.url()).pathname);console.log((await page.locator('body').innerText()).slice(0,900))}throw e}finally{await browser?.close();await http.dispose()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
