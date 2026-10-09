// Real disposable GoTrue + PostgreSQL + PostgREST. No production URL is accepted.
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes, createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { handleActivity } from '../server/activity-core.js'
import { handleAdmin } from '../server/admin-core.js'
import { handleProfile } from '../server/profile-core.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const prefix = `meteo-gotrue-${process.pid}`
const pg = `${prefix}-pg`, auth = `${prefix}-auth`, rest = `${prefix}-rest`, network = `${prefix}-net`
const environment = { ...process.env }
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete environment[key]
const secret = randomBytes(48).toString('hex'), password = randomBytes(32).toString('base64url')
const results = [], images = { postgres:'postgres:17-bookworm', auth:'supabase/gotrue:v2.177.0', rest:'postgrest/postgrest:v13.0.7' }
let gateway, vite, browser
function docker(args, input, allowFailure=false) {
  const result = spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:environment,input,encoding:'utf8',timeout:60000})
  if (!allowFailure && (result.error || result.status!==0)) throw new Error(`Local Docker ${args[0]} failed: ${result.stderr.trim().replaceAll(password, '[redacted]').replaceAll(secret, '[redacted]')}`)
  return result
}
const sql = input => docker(['exec','-i',pg,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input).stdout.trim()
function key(role) {
  const data = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')].join('.')
  return `${data}.${createHmac('sha256',secret).update(data).digest('base64url')}`
}
function pass(name, details={}) { results.push({name,status:'PASS',...details}); console.log(`PASS: ${name}`) }
async function waitFor(check,label) {
  for(let i=0;i<80;i++){ if(await check())return; await delay(250) }
  throw new Error(`${label} did not become ready${label.startsWith('GoTrue') ? ': '+JSON.stringify(docker(['inspect',auth,'--format','{{json .State}}'],undefined,true).stdout)+' '+docker(['logs',auth],undefined,true).stderr.split('\n').filter(line=>line.includes('fatal')).join(' ').replaceAll(secret,'[redacted]') : ''}`)
}
function port(name,internal) {
  const mapping=docker(['port',name,`${internal}/tcp`],undefined,true)
  if(mapping.status!==0) throw new Error(`Container readiness: ${docker(['logs',name],undefined,true).stderr.replaceAll(secret,'[redacted]')}`)
  const value=mapping.stdout.trim()
  assert.match(value,/^127\.0\.0\.1:\d+$/,'Only loopback ports permitted')
  return `http://${value}`
}
async function json(url,method='GET',token,body,extra={}) {
  const response=await fetch(url,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json',...extra},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)})
  return {status:response.status,body:await response.json().catch(()=>null)}
}
try {
  docker(['network','create',network])
  docker(['run','-d','--name',pg,'--network',network,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust',images.postgres])
  await waitFor(()=>docker(['exec',pg,'pg_isready','-U','postgres'],undefined,true).status===0,'PostgreSQL')
  // Auth tables below are created by actual GoTrue migrations, never by a stub.
  sql(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login noinherit; grant anon,authenticated,service_role to authenticator;
    create schema auth; alter role postgres set search_path = auth,public; create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid; $$;
    grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`)
  docker(['run','-d','--name',auth,'--network',network,'-p','127.0.0.1::9999',
    '-e','GOTRUE_API_HOST=0.0.0.0','-e','GOTRUE_API_PORT=9999','-e','API_EXTERNAL_URL=http://127.0.0.1:9999',
    '-e','GOTRUE_SITE_URL=http://127.0.0.1:4173','-e','GOTRUE_DB_DRIVER=postgres',
    '-e',`GOTRUE_DB_DATABASE_URL=postgres://postgres@${pg}:5432/postgres?sslmode=disable`,
    '-e','GOTRUE_DB_NAMESPACE=auth','-e',`GOTRUE_JWT_SECRET=${secret}`,'-e','GOTRUE_JWT_EXP=3600',
    '-e','GOTRUE_JWT_AUD=authenticated','-e','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
    '-e','GOTRUE_JWT_ADMIN_ROLES=service_role','-e','GOTRUE_DISABLE_SIGNUP=false',
    '-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=true','-e','GOTRUE_MAILER_AUTOCONFIRM=true',images.auth])
  await waitFor(()=>docker(['port',auth,'9999/tcp'],undefined,true).status===0,'GoTrue loopback port')
  const authUrl=port(auth,9999)
  await waitFor(async()=>{try{return (await fetch(`${authUrl}/health`)).ok}catch{return false}},'GoTrue')
  assert.ok(Number(sql('select count(*) from auth.schema_migrations;'))>0,'Real GoTrue migrations must exist')
  assert.ok(Number(sql("select count(*) from information_schema.columns where table_schema='auth' and table_name='users';"))>20,'Real Auth users schema required')
  pass('Real GoTrue health and actual Auth schema migrations')
  for(const file of readdirSync(`${root}/supabase/migrations`).filter(n=>n.endsWith('.sql')).sort())sql(readFileSync(`${root}/supabase/migrations/${file}`,'utf8'))
  docker(['run','-d','--name',rest,'--network',network,'-p','127.0.0.1::3000',
    '-e',`PGRST_DB_URI=postgres://authenticator@${pg}:5432/postgres`,
    '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,images.rest])
  const restUrl=port(rest,3000), anon=key('anon'), service=key('service_role')
  await waitFor(async()=>{try{return (await fetch(restUrl)).ok}catch{return false}},'PostgREST')
  const appEnv={SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service}
  gateway=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1')
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,prefer');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS')
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
    try {
      let data='';for await(const chunk of req)data+=chunk
      if(url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')){
        const target=url.pathname.startsWith('/auth/v1/')?authUrl+url.pathname.slice(8)+url.search:restUrl+url.pathname.slice(8)+url.search
        const response=await fetch(target,{method:req.method,headers:{...req.headers,host:new URL(target).host},...(!['GET','HEAD'].includes(req.method)&&data?{body:data}:{}),signal:AbortSignal.timeout(10000)})
        res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')||'application/json');res.end(await response.text());return
      }
      req.body=data?JSON.parse(data):undefined;req.query=Object.fromEntries(url.searchParams)
      res.status=code=>{res.statusCode=code;return res};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res}
      if(url.pathname==='/api/activity')return await handleActivity(req,res,appEnv)
      if(url.pathname==='/api/admin')return await handleAdmin(req,res,appEnv)
      if(url.pathname==='/api/profile')return await handleProfile(req,res,appEnv)
      res.writeHead(404);res.end()
    } catch {res.writeHead(500);res.end('{"error":"LOCAL_GATEWAY_FAILURE"}')}
  })
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${gateway.address().port}`;appEnv.SUPABASE_URL=base
  const api=(path,session,method='GET',body)=>json(base+path,method,session?.access_token,body)
  const sessions=[]
  for(const label of ['owner','other','admin']){
    const email=`${label}-${randomUUID()}@example.invalid`
    const signup=await json(base+'/auth/v1/signup','POST',undefined,{email,password},{apikey:anon});assert.equal(signup.status,200,'Real local signup')
    const login=await json(base+'/auth/v1/token?grant_type=password','POST',undefined,{email,password},{apikey:anon});assert.equal(login.status,200,'Real GoTrue password grant')
    assert.equal(typeof login.body.access_token,'string');assert.equal(login.body.user.email,email)
    sessions.push({...login.body,email})
  }
  const [owner,other,admin]=sessions
  sql(`insert into public.admin_memberships(user_id) values('${admin.user.id}');`)
  assert.equal((await json(base+'/auth/v1/user','GET',owner.access_token)).body.id,owner.user.id)
  assert.equal((await api('/api/activity',owner)).status,200)
  assert.equal((await api('/api/activity',{access_token:'invalid'})).status,401)
  assert.equal((await api('/api/activity',{access_token:owner.access_token.slice(0,-8)+'tampered'})).status,401)
  assert.equal((await api('/api/activity',null)).status,401)
  pass('Actual signup/password login and GoTrue-issued JWT; invalid, tampered and missing JWT rejected')
  const refreshed=await json(base+'/auth/v1/token?grant_type=refresh_token','POST',undefined,{refresh_token:owner.refresh_token},{apikey:anon})
  assert.equal(refreshed.status,200);Object.assign(owner,refreshed.body)
  pass('Actual GoTrue refresh-token rotation')
  const initial=await api('/api/activity',owner);assert.equal(initial.body.enabled,false)
  const denied=await api('/api/activity',owner,'POST',{action:'favorite_add',operationId:randomUUID(),revision:randomUUID()});assert.equal(denied.body.reason,'NO_CONSENT')
  assert.equal(Number(sql('select count(*) from public.activity_daily;')),0)
  const consent=await api('/api/activity',owner,'PATCH',{enabled:true});assert.equal(consent.status,200);assert.equal(consent.body.enabled,true)
  pass('Default consent off; no recording before explicit consent; consent enabled via real app API')
  // A real feature mutation in the isolated database precedes its analytics event.
  const favorite=await json(base+'/rest/v1/favorite_places','POST',owner.access_token,{name:'Isolated integration city',latitude:42.7,longitude:23.3},{apikey:anon,Prefer:'return=representation'})
  assert.equal(favorite.status,201);assert.equal(favorite.body.length,1)
  const event={action:'favorite_add',operationId:randomUUID(),revision:consent.body.revision}
  const recorded=await api('/api/activity',owner,'POST',event);assert.equal(recorded.status,200);assert.equal(recorded.body.recorded,true)
  assert.equal((await api('/api/activity',owner,'POST',event)).body.reason,'DUPLICATE')
  pass('Actual authenticated favorite insertion followed by real activity recording and duplicate rejection')
  const aggregate=await api('/api/admin?action=activity&period=30',admin)
  assert.equal(aggregate.status,200);assert.equal(aggregate.body.dau,1);assert.equal(aggregate.body.wau,1);assert.equal(aggregate.body.mau,1);assert.equal(aggregate.body.actions.favorite_add,1);assert.equal(aggregate.body.consenting,1)
  assert.equal((await api('/api/admin?action=activity&period=30',other)).status,403)
  assert.equal((await api('/api/activity',other)).body.enabled,false)
  for(const table of ['activity_daily','activity_consent'])for(const session of [owner,other,admin]){
    const response=await json(base+`/rest/v1/${table}?user_id=eq.${owner.user.id}`,'GET',session.access_token)
    assert.equal(response.status,403,'No direct foreign or own analytic table reads')
  }
  const foreignFavorites=await json(base+`/rest/v1/favorite_places?user_id=eq.${owner.user.id}`,'GET',other.access_token)
  assert.equal(foreignFavorites.status,200);assert.equal(foreignFavorites.body.length,0)
  const forged=await api('/api/activity',other,'POST',{...event,userId:owner.user.id});assert.equal(forged.status,400)
  const foreignRpc=await json(base+'/rest/v1/rpc/record_activity','POST',other.access_token,{selected_action:'favorite_add',operation_id:randomUUID(),consent_revision:consent.body.revision})
  assert.equal(foreignRpc.status,200);assert.equal(foreignRpc.body.reason,'NO_CONSENT')
  pass('Actual administrative aggregates; ordinary user denied; table/RPC and favorite RLS account isolation')
  const {createServer:makeVite}=await import('vite')
  vite=await makeVite({root,envDir:false,server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:base}}},define:{
    'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(base),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(anon),
    'import.meta.env.VITE_GOOGLE_AUTH_ENABLED':JSON.stringify('false'),'import.meta.env.VITE_TURNSTILE_SITE_KEY':JSON.stringify('')
  }})
  await vite.listen();const site=`http://127.0.0.1:${vite.httpServer.address().port}`
  const {chromium}=await import('@playwright/test')
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'})
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage()
  // Abort non-local network; never mock or fulfill API/Auth requests.
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  await page.goto(site+'/admin')
  await page.getByRole('button',{name:'Вход',exact:true}).click()
  await page.getByLabel('Имейл',{exact:true}).fill(admin.email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.locator('form').getByRole('button',{name:'Вход',exact:true}).click()
  await page.locator('nav').getByRole('button',{name:'Потребителска активност',exact:true}).click()
  await page.locator('.admin-activity .admin-stats').waitFor()
  assert.equal(await page.locator('.admin-activity .admin-card').filter({hasText:'Добавени любими'}).locator('strong').innerText(),'1')
  assert.equal(await page.locator('.admin-activity .admin-card').filter({hasText:'Активни днес'}).locator('strong').innerText(),'1')
  pass('Chromium: real email/password GoTrue login and actual aggregate values rendered in admin UI (no mocks)')
  const withdrawal=await api('/api/activity',owner,'PATCH',{enabled:false});assert.equal(withdrawal.status,200);assert.equal(withdrawal.body.enabled,false)
  assert.equal(Number(sql(`select count(*) from public.activity_daily where user_id='${owner.user.id}';`)),0)
  assert.equal((await api('/api/activity',owner,'POST',event)).body.reason,'NO_CONSENT')
  const after=await api('/api/admin?action=activity&period=30',admin);assert.equal(after.body.dau,0);assert.equal(after.body.mau,0);assert.equal(after.body.hasData,false);assert.equal(after.body.consenting,0)
  await page.reload();await page.locator('.admin-activity').getByText('Все още няма измерена активност за периода.',{exact:false}).waitFor()
  assert.equal(Number(sql('select count(*) from public.favorite_places;')),1,'Withdrawal must preserve core user feature data')
  pass('Withdrawal deletes stored analytics; stale consent rejected; actual admin UI shows no data; favorite preserved')
  mkdirSync(`${root}/work`,{recursive:true})
  const imageDigests=Object.fromEntries(Object.entries(images).map(([name,image])=>[name,docker(['image','inspect',image,'--format','{{index .RepoDigests 0}}']).stdout.trim()]))
  writeFileSync(`${root}/work/activity-real-integration.json`,JSON.stringify({checkedAt:new Date().toISOString(),status:'PASS',images:imageDigests,isolation:'Disposable dedicated Docker bridge network; ephemeral database; loopback-only HTTP; synthetic .invalid accounts; no production credentials',mocks:false,results,limits:['Local GoTrue password authentication/refresh only; Google provider, SMTP confirmation/recovery and Vercel-hosted API runtime are not exercised','Favorite action is a real database mutation followed by application activity API; public weather providers are not used','Chromium uses actual admin UI and real local Auth/API; external requests are aborted']},null,2)+'\n')
  console.log(`PASS: ${results.length} real integration checks; safe JSON report in work/activity-real-integration.json`)
} catch(error) {
  console.error(`FAIL: ${error.message}`);process.exitCode=1
} finally {
  if(browser)await browser.close()
  if(vite)await vite.close()
  if(gateway)await new Promise(resolve=>gateway.close(resolve))
  for(const name of [rest,auth,pg])docker(['rm','-f',name],undefined,true)
  docker(['network','rm',network],undefined,true)
}
