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
import { handleAlerts } from '../server/alerts-core.js'
import { handlePlanner } from '../server/planner-core.js'
import { handleAdminManagement } from '../server/admin-management-core.js'
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
      if(url.pathname==='/api/alerts')return await handleAlerts(req,res,appEnv)
      if(url.pathname==='/api/planner')return await handlePlanner(req,res,appEnv)
      if(url.pathname==='/api/admin-management')return await handleAdminManagement(req,res,appEnv)
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
  // Stage 6B: actual GoTrue JWT, actual entitlement RPC, actual manual grants and audit.
  const plannerBody={activity:'walk',timeZone:'UTC',hours:Array.from({length:72},(_,i)=>({time:new Date(Math.ceil(Date.now()/3600000)*3600000+i*3600000).toISOString().slice(0,16),feelsLike:20,rainProbability:10,rain:0,wind:5,code:1}))}
  assert.equal((await api('/api/planner',null,'POST',plannerBody)).status,401)
  assert.equal((await api('/api/planner',{access_token:'invalid'},'POST',plannerBody)).status,401)
  assert.equal((await api('/api/planner',{access_token:owner.access_token.slice(0,-8)+'tampered'},'POST',plannerBody)).status,401)
  const jwtHeader=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
  const jwtPayload=Buffer.from(JSON.stringify({role:'authenticated',sub:owner.user.id,aud:'authenticated',exp:Math.floor(Date.now()/1000)-120})).toString('base64url')
  const jwtData=jwtHeader+'.'+jwtPayload
  const expired=jwtData+'.'+createHmac('sha256',secret).update(jwtData).digest('base64url')
  assert.equal((await api('/api/planner',{access_token:expired},'POST',plannerBody)).status,401)
  assert.equal((await api('/api/planner',owner,'POST',plannerBody)).status,403)
  // Stage 6C uses actual GoTrue sessions and real persisted settings/history.
  for(const token of [null,{access_token:'invalid'},{access_token:expired}])assert.equal((await api('/api/alerts',token)).status,401)
  assert.deepEqual((await api('/api/alerts',owner)).body.enabled,[])
  assert.equal((await api('/api/alerts',owner,'PATCH',{enabled:['walk']})).status,403)
  assert.equal((await api('/api/alerts',owner,'PATCH',{enabled:['rain'],user_id:other.user.id})).status,400)
  assert.equal((await api('/api/alerts',owner,'PATCH',{enabled:['rain']})).status,200)
  const {activity:_activity,...alertsForecast}=plannerBody
  alertsForecast.hours=alertsForecast.hours.map(h=>({...h,rain:12}))
  const alertInput={city:'Isolated city',locationKey:'432:279',forecast:alertsForecast}
  const alertsAt=(locationKey,zone='UTC')=>'/api/alerts?'+new URLSearchParams({locationKey,zone})
  const alertsA=alertsAt('432:279'),alertsB=alertsAt('427:233')
  const concurrentAlerts=await Promise.all(Array.from({length:4},()=>api('/api/alerts',owner,'POST',alertInput)))
  assert.ok(concurrentAlerts.every(r=>r.status===200));assert.equal(concurrentAlerts[0].body.alerts.length,1)
  const alertEvent=concurrentAlerts[0].body.alerts[0]
  const secondAlertInput={...alertInput,city:'Second isolated city',locationKey:'427:233'}
  const rapid=await Promise.all([api('/api/alerts',owner,'POST',secondAlertInput),api('/api/alerts',owner,'POST',alertInput),api('/api/alerts',owner,'POST',secondAlertInput)])
  assert.ok(rapid.every(r=>r.status===200));assert.ok(rapid.every(r=>r.body.alerts.length===1))
  assert.ok(rapid[0].body.alerts.every(r=>r.locationKey==='427:233'&&r.city==='Second isolated city'))
  assert.equal((await api('/api/alerts',owner)).body.alerts.length,0,'Unscoped settings cannot return any history')
  assert.equal((await api('/api/alerts',owner,'DELETE')).status,400,'Old unscoped clear must fail')
  assert.equal((await api(alertsA,owner,'PATCH',{readKey:rapid[0].body.alerts[0].key})).body.alerts[0].read,false,'Foreign-city key cannot change that row')
  assert.equal((await api(alertsA,owner,'PATCH',{readKey:alertEvent.key})).body.alerts[0].read,true)
  assert.equal((await api(alertsA,other)).body.alerts.length,0)
  assert.equal((await api(alertsB,owner)).body.alerts[0].read,false,'A read cannot change B')
  assert.equal((await json(base+'/rest/v1/weather_alerts','GET',owner.access_token,undefined,{apikey:anon})).status,403)
  assert.equal((await api(alertsA,owner,'DELETE')).body.alerts.length,0)
  const bHistory=await api(alertsB,owner);assert.equal(bHistory.body.alerts.length,1,'A clear must keep B')
  assert.equal((await api(alertsB,owner,'PATCH',{hideKey:bHistory.body.alerts[0].key})).body.alerts.length,0)
  sql(`update public.alert_generation_state set last_generated=now()-interval '31 seconds' where user_id='${owner.user.id}';`)
  const refreshBoth=await Promise.all([api('/api/alerts',owner,'POST',alertInput),api('/api/alerts',owner,'POST',secondAlertInput)])
  assert.ok(refreshBoth.every(r=>r.status===200&&r.body.alerts.length===0),'Hidden and cleared events must not reappear after cooldown')
  assert.equal(Number(sql(`select count(*) from public.weather_alerts where user_id='${owner.user.id}';`)),2)
  const zoneInput={...alertInput,forecast:{...alertsForecast,timeZone:'Europe/Sofia'}}
  const zoneHistory=await api('/api/alerts',owner,'POST',zoneInput);assert.equal(zoneHistory.body.alerts.length,1)
  assert.equal((await api(alertsA,owner)).body.alerts.length,0,'UTC history cannot mix the same place in another zone')
  await api(alertsA,owner,'DELETE');assert.equal((await api(alertsAt('432:279','Europe/Sofia'),owner)).body.alerts.length,1)
  await api(alertsAt('432:279','Europe/Sofia'),other,'DELETE');assert.equal((await api(alertsAt('432:279','Europe/Sofia'),owner)).body.alerts.length,1)
  const relogin=await json(base+'/auth/v1/token?grant_type=password','POST',undefined,{email:owner.email,password},{apikey:anon})
  assert.deepEqual((await api('/api/alerts',relogin.body)).body.enabled,['rain'])
  assert.equal((await api(alertsAt('432:279','Europe/Sofia'),relogin.body)).body.alerts.length,1)
  pass('Stage 6C review: immediate A/B switch, concurrent generations, separate location+zone histories, read/hide/clear, replay tombstones, relogin settings and account isolation')
  assert.equal((await api('/api/alerts',owner,'POST',alertInput)).body.alerts.length,0)
  assert.deepEqual((await api('/api/alerts',owner)).body.enabled,['rain'])
  pass('Stage 6C: real JWT denial, Free settings, concurrent deduplication, read/clear tombstones, durable settings and account isolation')
  // Exhaust only a disposable account's generation budget; cached scope still works.
  const abuseInput={...alertInput,locationKey:'500:300',city:'Budget cached'}
  assert.equal((await api('/api/alerts',other,'POST',abuseInput)).status,200)
  sql(`update public.alert_settings set generation_tokens=0,generation_refilled_at=now()+interval '1 minute' where user_id='${other.user.id}';`)
  assert.equal((await api('/api/alerts',other,'POST',{...abuseInput,locationKey:'501:300'})).status,429)
  assert.equal((await api('/api/alerts',other,'POST',abuseInput)).status,200)
  assert.equal(Number(sql(`select count(*) from public.alert_generation_state where user_id='${other.user.id}' and location_key='501:300';`)),0)
  sql(`update public.alert_settings set generation_refilled_at=now()-interval '4 seconds' where user_id='${other.user.id}';`)
  assert.equal((await api('/api/alerts',other,'POST',{...abuseInput,locationKey:'501:300'})).status,200)
  pass('Stage 6C review: actual GoTrue/API HTTP 429 budget denial, no rejected scope persistence, cached scope and refill')
  const grant=await api('/api/admin-management',admin,'POST',{action:'plan',targetId:owner.user.id,plan:'pro',expectedPlan:'free',requestId:randomUUID(),confirmed:true})
  assert.equal(grant.status,200)
  const proProfile=await api('/api/profile',owner)
  assert.ok(proProfile.body.permissions.includes('planner:advanced'))
  assert.equal((await api('/api/alerts',owner,'PATCH',{enabled:['walk']})).status,200)
    sql(`update public.alert_generation_state set last_generated=now()-interval '31 seconds' where user_id='${owner.user.id}' and location_key='427:233';`)
  const proAlerts=await api('/api/alerts',owner,'POST',{city:'Isolated Pro city',locationKey:'427:233',forecast:{timeZone:plannerBody.timeZone,hours:plannerBody.hours}})
  assert.equal(proAlerts.status,200);assert.equal(proAlerts.body.alerts.length,3)
  const recommendations=await api('/api/planner',owner,'POST',plannerBody)
  assert.equal(recommendations.status,200);assert.equal(recommendations.body.windows.length,3)
  assert.equal((await api('/api/planner',other,'POST',{...plannerBody,plan:'pro'})).status,403)
  assert.equal((await api('/api/planner',owner,'POST',{...plannerBody,activity:'swim'})).status,400)
  // Missing new entitlement (old migration function) safely denies even a Pro account.
  sql(readFileSync(`${root}/supabase/migrations/20260930000000_auth_profiles.sql`,'utf8').split('create or replace function public.get_my_entitlements()')[1].split('revoke all on function public.get_my_entitlements()')[0].replace(/^/, 'create or replace function public.get_my_entitlements()'))
  assert.equal((await api('/api/planner',owner,'POST',plannerBody)).status,403)
  sql(readFileSync(`${root}/supabase/migrations/20261009000000_planner_entitlement.sql`,'utf8'))
  const revoke=await api('/api/admin-management',admin,'POST',{action:'plan',targetId:owner.user.id,plan:'free',expectedPlan:'pro',requestId:randomUUID(),confirmed:true})
  assert.equal(revoke.status,200)
  assert.equal((await api('/api/planner',owner,'POST',plannerBody)).status,403)
  assert.equal((await api(alertsB,owner)).body.alerts.length,0)
  assert.equal((await api('/api/alerts',owner,'PATCH',{enabled:['walk']})).status,403)
  sql(`update public.subscriptions set plan='pro',status='active' where user_id='${owner.user.id}';`)
  assert.equal((await api(alertsB,owner)).body.alerts.length,3)
  sql(`update public.subscriptions set plan='free' where user_id='${owner.user.id}';`)
  pass('Stage 6C: same active GoTrue JWT Pro generation, revocation and restoration without relogin')
  assert.equal(Number(sql(`select count(*) from public.admin_audit_log where object_id='${owner.user.id}' and action in ('manual_pro_grant','free_restore');`)),2)
  assert.equal(Number(sql('select count(*) from public.activity_daily;')),0)
  pass('Stage 6B: real Free/Pro/guest authorization, missing migration, invalid/expired/tampered JWT, manual grant/revoke with same JWT and two audit entries; no analytics')
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
  // Real main-page profile and notification panel with persisted isolated history.
  sql(`update public.subscriptions set plan='pro',status='active' where user_id='${owner.user.id}';`)
  const ownerContext=await browser.newContext({viewport:{width:390,height:1000}}),ownerPage=await ownerContext.newPage()
  await ownerContext.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  const daily={time:[plannerBody.hours[0].time.slice(0,10)],sunrise:[plannerBody.hours[0].time],sunset:[plannerBody.hours[0].time]}
  for(const key of ['temperature_2m_min','temperature_2m_max','weather_code','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','uv_index_max','apparent_temperature_max'])daily[key]=[key==='weather_code'?0:20]
  const hourly={time:plannerBody.hours.map(h=>h.time)}
  for(const key of ['temperature_2m','apparent_temperature','weather_code','precipitation','precipitation_probability','wind_speed_10m','surface_pressure','relative_humidity_2m','visibility','dew_point_2m','cloud_cover'])hourly[key]=plannerBody.hours.map(()=>key==='weather_code'||key==='precipitation'?0:key==='wind_speed_10m'?5:key==='precipitation_probability'?10:20)
  await ownerContext.route('https://api.open-meteo.com/**',route=>route.fulfill({json:{timezone:'UTC',current:{time:plannerBody.hours[0].time,temperature_2m:20,weather_code:0,wind_speed_10m:5,relative_humidity_2m:50,apparent_temperature:20,surface_pressure:1010,uv_index:2},hourly,daily}}))
  sql(`update public.alert_generation_state set last_generated=now()-interval '31 seconds' where user_id='${owner.user.id}' and location_key='432:279' and zone='UTC';`)
  await ownerPage.goto(site+'/');await ownerPage.locator('.auth-nav').getByRole('button',{name:'Вход',exact:true}).click()
  await ownerPage.getByLabel('Имейл',{exact:true}).fill(owner.email)
  await ownerPage.locator('input[autocomplete="current-password"]').fill(password)
  await ownerPage.locator('form').getByRole('button',{name:'Вход',exact:true}).click()
  await ownerPage.locator('.auth-nav').getByRole('button',{name:'Моят профил',exact:true}).click()
  await ownerPage.locator('.notification-settings input').nth(7).waitFor()
  await ownerPage.locator('.notification-settings').getByText('Време за градинарство',{exact:false}).click()
  await ownerPage.waitForFunction(()=>document.querySelector('.notification-settings input:nth-of-type(1)')!==null)
  assert.ok((await api('/api/alerts',owner)).body.enabled.includes('garden'))
  assert.equal((await api('/api/activity',owner)).body.enabled,false,'Notification preferences must not enable analytics')
  mkdirSync(`${root}/docs/alerts-screenshots`,{recursive:true})
  await ownerPage.locator('.notification-settings').screenshot({path:`${root}/docs/alerts-screenshots/real-gotrue-pro-settings-390-bg.png`})
  await ownerPage.getByRole('button',{name:'Затвори',exact:true}).click()
  await ownerPage.getByRole('button',{name:'Известия',exact:true}).click()
  await ownerPage.locator('.notification-panel li').nth(2).waitFor()
  await ownerPage.locator('.notification-panel').screenshot({path:`${root}/docs/alerts-screenshots/real-gotrue-pro-history-390-bg.png`})
  sql(`update public.subscriptions set plan='free' where user_id='${owner.user.id}';`)
  await ownerPage.locator('.notification-panel').getByRole('button',{name:'Скрий',exact:true}).first().click()
  await ownerPage.locator('.notification-panel').getByText('Няма нови известия.',{exact:true}).waitFor()
  sql(`update public.subscriptions set plan='pro',status='active' where user_id='${owner.user.id}';`)
  await ownerPage.reload();await ownerPage.getByRole('button',{name:'Известия',exact:true}).click();await ownerPage.locator('.notification-panel li').nth(2).waitFor()
  await ownerContext.close()
  pass('Stage 6C Chromium: real password login, persisted Pro settings without analytics consent, real history screenshots and live-session revoke/restore; weather fixture, real Auth/API and current Varna/UTC scope')
  sql('alter function public.my_alerts(jsonb) rename to my_alerts_temporarily_missing;')
  assert.equal((await api('/api/alerts',owner)).status,503)
  sql('alter function public.my_alerts_temporarily_missing(jsonb) rename to my_alerts;')
  pass('Stage 6C: absent migration/RPC safely fails without altering core forecast or profile APIs')
  mkdirSync(`${root}/work`,{recursive:true})
  const imageDigests=Object.fromEntries(Object.entries(images).map(([name,image])=>[name,docker(['image','inspect',image,'--format','{{index .RepoDigests 0}}']).stdout.trim()]))
  writeFileSync(`${root}/work/stage6c-real-integration.json`,JSON.stringify({checkedAt:new Date().toISOString(),status:'PASS',images:imageDigests,isolation:'Disposable dedicated Docker bridge network; ephemeral database; loopback-only HTTP; synthetic .invalid accounts; no production credentials',mocks:false,results,limits:['Local GoTrue password authentication/refresh only; Google provider, SMTP confirmation/recovery and Vercel-hosted API runtime are not exercised','Favorite action is a real database mutation followed by application activity API; public weather providers are not used','Chromium uses real local Auth/API for admin and notifications; notification weather is an isolated Open-Meteo fixture; other external requests are aborted']},null,2)+'\n')
  console.log(`PASS: ${results.length} real integration checks; safe JSON report in work/stage6c-real-integration.json`)
} catch(error) {
  console.error(`FAIL: ${error.message}`);process.exitCode=1
} finally {
  if(browser)await browser.close()
  if(vite)await vite.close()
  if(gateway)await new Promise(resolve=>gateway.close(resolve))
  for(const name of [rest,auth,pg])docker(['rm','-f',name],undefined,true)
  docker(['network','rm',network],undefined,true)
}
