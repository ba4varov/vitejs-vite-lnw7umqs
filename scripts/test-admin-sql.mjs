// Runs only disposable, network-isolated Docker containers. Never accepts a DB URL.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomBytes, createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
const root = new URL('../', import.meta.url)
const prefix = `meteo-admin-test-${process.pid}`
const pg = `${prefix}-pg`, rest = `${prefix}-rest`
const environment = { ...process.env }
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete environment[key]
function docker(args, input, allowFailure = false) {
  const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env: environment, input, encoding:'utf8',timeout:60000 })
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`Docker ${args[0]} failed: ${result.error?.message || result.stderr}`)
  return result
}
const sql = text => docker(['exec','-i',pg,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],text).stdout
const secret = randomBytes(48).toString('hex') // Ephemeral test-only secret, never printed or persisted.
function jwt(sub, expires = Math.floor(Date.now()/1000)+600, signingKey = secret) {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
  const payload = Buffer.from(JSON.stringify({role:'authenticated',sub,exp:expires})).toString('base64url')
  const data = `${header}.${payload}`
  return `${data}.${createHmac('sha256',signingKey).update(data).digest('base64url')}`
}
function request(path, token, body = '{}') {
  const message = `POST ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\n${token ? `Authorization: Bearer ${token}\r\n` : ''}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  const raw = docker(['exec','-i',pg,'bash','-c','exec 3<>/dev/tcp/127.0.0.1/3000; cat >&3; cat <&3'],message).stdout
  const split = raw.indexOf('\r\n\r\n')
  assert.ok(split>=0,'HTTP response headers missing')
  return {status:Number(raw.split(' ')[1]),body:JSON.parse(raw.slice(split+4))}
}
try {
  docker(['run','-d','--name',pg,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-bookworm'])
  let ready=false
  for(let i=0;i<60;i++) { if(docker(['exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres'],undefined,true).status===0){ready=true;break} await delay(500) }
  assert.ok(ready,'PostgreSQL startup timed out')
  console.log(sql(readFileSync(new URL('tests/sql/admin-bootstrap.sql',root),'utf8')))
  for(const file of ['20260930000000_auth_profiles.sql','20260930010000_favorite_places.sql','20260930020000_place_geoname_identity.sql','20261008000000_admin_readonly.sql','20261008010000_admin_user_favorites.sql','20261008020000_admin_statistics_audit.sql','20261008030000_admin_management.sql','20261008040000_user_activity.sql','20261009000000_planner_entitlement.sql','20261009010000_weather_alerts.sql','20261009020000_alert_location_scope.sql']) {
    sql(readFileSync(new URL(`supabase/migrations/${file}`,root),'utf8')); console.log(`Applied actual migration: ${file}`)
  }
  sql(readFileSync(new URL('tests/sql/daily-pro-migration-before.sql',root),'utf8'))
  sql(readFileSync(new URL('supabase/migrations/20261009030000_daily_pro_recommendations.sql',root),'utf8'))
  console.log(sql(readFileSync(new URL('tests/sql/daily-pro-migration-after.sql',root),'utf8')))
  sql(readFileSync(new URL('supabase/migrations/20261009040000_web_push_preparation.sql',root),'utf8'))
  console.log(sql(readFileSync(new URL('tests/sql/web-push.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/admin-security.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/admin-favorites.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/admin-stage3.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/admin-stage4.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/admin-profile-audit.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/user-activity.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/planner-entitlement.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/weather-alerts.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/alert-location-scope.sql',root),'utf8')))
  console.log(sql(readFileSync(new URL('tests/sql/daily-pro-recommendations.sql',root),'utf8')))
  // Clear SQL test subject so PostgREST uses JWT claims, just as Supabase does.
  docker(['run','-d','--name',rest,'--network',`container:${pg}`,'-e','PGRST_DB_URI=postgres://authenticator@127.0.0.1:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,'postgrest/postgrest:v13.0.7'])
  ready=false
  for(let i=0;i<60;i++) { if(docker(['exec',pg,'bash','-c','exec 3<>/dev/tcp/127.0.0.1/3000'],undefined,true).status===0){ready=true;break} await delay(500) }
  assert.ok(ready,'PostgREST startup timed out')
  const admin='00000000-0000-0000-0000-000000000001', ordinary='00000000-0000-0000-0000-000000000002'
  for(const endpoint of ['/rpc/admin_statistics','/rpc/admin_users','/rpc/admin_advanced_statistics','/rpc/admin_audit_entries','/rpc/admin_management_users','/rpc/admin_management_summary','/rpc/admin_user_activity']) {
    assert.equal(request(endpoint,jwt(ordinary)).status,403,'Ordinary direct RPC must fail')
    assert.equal(request(endpoint,null).status,401,'Anonymous direct RPC must fail')
    assert.equal(request(endpoint,'invalid-token').status,401,'Malformed JWT must fail')
    assert.equal(request(endpoint,jwt(admin,Math.floor(Date.now()/1000)-120)).status,401,'Expired admin JWT must fail')
    assert.equal(request(endpoint,jwt(admin,undefined,'wrong-test-key')).status,401,'Forged admin JWT must fail')
    assert.equal(request(endpoint,jwt(undefined)).status,403,'Valid signed JWT without subject must fail')
  }
  const consent=request('/rpc/set_activity_consent',jwt(ordinary),JSON.stringify({desired:true}));assert.equal(consent.status,200)
  const revision=consent.body.revision
  const event=JSON.stringify({selected_action:'forecast_view',operation_id:'60000000-0000-0000-0000-000000000001',consent_revision:revision})
  for(const token of [null,'invalid-token',jwt(ordinary,Math.floor(Date.now()/1000)-120),jwt(ordinary,undefined,'wrong-key')]) assert.equal(request('/rpc/record_activity',token,event).status,401)
  assert.equal(request('/rpc/record_activity',jwt(ordinary),event).body.recorded,true)
  assert.equal(request('/rpc/record_activity',jwt(ordinary),event).body.reason,'DUPLICATE')
  assert.ok(request('/rpc/record_activity',jwt(ordinary),JSON.stringify({...JSON.parse(event),user_id:admin})).status>=400)
  for(const table of ['activity_daily','activity_consent']) for(const token of [jwt(ordinary),jwt(admin),null]) assert.ok(request('/'+table,token,'{}').status>=400)
  assert.equal(request('/rpc/set_activity_consent',jwt(ordinary),JSON.stringify({desired:false})).status,200)
  assert.equal(request('/rpc/record_activity',jwt(ordinary),event).body.reason,'NO_CONSENT')
  assert.match(sql("select count(*) from public.activity_daily;"), /\n\s+0\s*\n/)
  // Concurrent duplicate action: two separate PostgreSQL connections, one accepted count.
  const newConsent=request('/rpc/set_activity_consent',jwt(ordinary),JSON.stringify({desired:true})).body
  const activitySQL=`begin; set local role authenticated; set local request.jwt.claim.sub='${ordinary}'; select public.record_activity('forecast_view','60000000-0000-0000-0000-000000000002','${newConsent.revision}'); select pg_sleep(0.2); commit;`
  const activityCall=(query=activitySQL)=>new Promise((resolve,reject)=>{
    const child=spawn('docker',['--host=unix:///var/run/docker.sock','exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{env:environment})
    let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(Error(errors)));child.stdin.end(query)
  })
  const activityResults=await Promise.all([activityCall(),activityCall()]);assert.equal(activityResults.filter(s=>s.includes('"recorded": true')).length,1)
  assert.equal(request('/rpc/admin_user_activity',jwt(admin)).body.dau,1)
  assert.equal(request('/rpc/admin_user_activity',jwt(admin)).body.actions.forecast_view,1)
  // Withdrawal and recording contend for the same account lock, using separate connections.
  const withdrawalCall=()=>new Promise((resolve,reject)=>{
    const child=spawn('docker',['--host=unix:///var/run/docker.sock','exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{env:environment})
    let errors='';child.stdout.resume();child.stderr.on('data',c=>errors+=c);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(errors)))
    child.stdin.end(`begin; set local role authenticated; set local request.jwt.claim.sub='${ordinary}'; select public.set_activity_consent(false); commit;`)
  })
  await Promise.all([activityCall(activitySQL.replace("'forecast_view'", "'chat_use'").replace("60000000-0000-0000-0000-000000000002", "60000000-0000-0000-0000-000000000003")),withdrawalCall()])
  assert.match(sql("select count(*) from public.activity_daily;"), /\n\s+0\s*\n/)
  console.log('PASS: activity opt-in, deletion, forged subject rejection, JWT validation, table isolation and concurrent duplicate writes')
  console.log('PASS: real PostgREST direct RPC returns 403 for ordinary users; 401 for missing, malformed, expired and forged JWTs')
  const favoritesBody=JSON.stringify({selected_id:ordinary})
  for (const token of [jwt(ordinary),jwt(undefined)]) assert.equal(request('/rpc/admin_user_favorites',token,favoritesBody).status,403)
  for (const token of [null,'invalid-token',jwt(admin,Math.floor(Date.now()/1000)-120),jwt(admin,undefined,'wrong-test-key')]) assert.equal(request('/rpc/admin_user_favorites',token,favoritesBody).status,401)
  const favorites=request('/rpc/admin_user_favorites',jwt(admin),favoritesBody); assert.equal(favorites.status,200); assert.equal(favorites.body[0].name,'Test city'); assert.equal(favorites.body.length,1)
  assert.deepEqual(request('/rpc/admin_user_favorites',jwt(admin),JSON.stringify({selected_id:admin})).body,[])
  console.log('PASS: real JWT favorites RPC authorization and selected-user isolation')
  const stats=request('/rpc/admin_statistics',jwt(admin)); assert.equal(stats.status,200)
  assert.deepEqual(['total','last7','last30','favorites','free','pro'].map(key=>stats.body[key]),[3,1,2,1,2,1])
  assert.equal(stats.body.registrations.length,30)
  const users=request('/rpc/admin_users',jwt(admin),JSON.stringify({search_email:'ORDINARY',page_number:1})); assert.equal(users.status,200); assert.equal(users.body.total,1)
  console.log('PASS: explicit administrator receives real database statistics and filtered users via HTTP RPC')
  const advanced=request('/rpc/admin_advanced_statistics',jwt(admin)); assert.equal(advanced.status,200); assert.equal(advanced.body.buckets.length,30)
  const details=request('/rpc/admin_users',jwt(admin),JSON.stringify({selected_id:ordinary})); assert.equal(details.status,200)
  const audit=request('/rpc/admin_audit_entries',jwt(admin)); assert.equal(audit.status,200)
  assert.ok(audit.body.entries.some(e=>e.action==='user_details_view' && e.admin_id===admin))
  assert.ok(audit.body.entries.some(e=>e.action==='user_favorites_view' && e.admin_id===admin))
  assert.ok(request('/rpc/admin_users_internal',jwt(admin),JSON.stringify({selected_id:ordinary})).status>=400)
  assert.ok(request('/admin_audit_log',jwt(admin),JSON.stringify({admin_id:ordinary})).status>=400)
  assert.ok(request('/rpc/admin_audit_entries',jwt(admin),JSON.stringify({admin_id:ordinary})).status>=400)
  console.log('PASS: SQL-coupled audit actor attribution; direct table writes, private bypass and actor parameters rejected over real JWT HTTP')
  // Exercise precisely the three UI reads through real signed JWT HTTP RPCs.
  const beforeProfile = request('/rpc/admin_audit_entries',jwt(admin)).body
  const baseline = Math.max(0,...beforeProfile.entries.map(e=>Number(e.id)))
  assert.equal(request('/rpc/admin_users',jwt(admin),JSON.stringify({selected_id:ordinary})).status,200)
  assert.equal(request('/rpc/admin_management_account',jwt(admin),JSON.stringify({selected_id:ordinary})).status,200)
  assert.equal(request('/rpc/admin_user_favorites',jwt(admin),JSON.stringify({selected_id:ordinary})).status,200)
  const profileLog=request('/rpc/admin_audit_entries',jwt(admin)).body
  assert.equal(profileLog.total-beforeProfile.total,3)
  const profileEntries=profileLog.entries.filter(e=>Number(e.id)>baseline)
  assert.deepEqual(profileEntries.map(e=>e.action).sort(),['user_details_view','user_favorites_view','user_management_view'])
  assert.ok(profileEntries.every(e=>e.admin_id===admin && e.object_id===ordinary && e.outcome==='success'))
  const filteredManagement=request('/rpc/admin_audit_entries',jwt(admin),JSON.stringify({selected_action:'user_management_view'}))
  assert.equal(filteredManagement.status,200);assert.ok(filteredManagement.body.entries.every(e=>e.action==='user_management_view'))
  console.log('PASS: real JWT profile open adds exactly 3 records: 1 details, 1 management, 1 favorites; direct RPC remains audited')
  // Two independent database connections retry the same operation concurrently.
  const concurrentSQL = `begin; set local role authenticated; set local request.jwt.claim.sub='${admin}'; select public.admin_set_manual_plan('${ordinary}','pro','free','10000000-0000-0000-0000-000000000010'); select pg_sleep(0.2); commit;`
  const concurrentCall = () => new Promise((resolve,reject) => {
    const child=spawn('docker',['--host=unix:///var/run/docker.sock','exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{env:environment})
    let output='', errors=''; child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk)
    child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(errors)))
    child.stdin.end(concurrentSQL)
  })
  const concurrentResults=await Promise.all([concurrentCall(),concurrentCall()])
  assert.equal(concurrentResults.filter(output=>output.includes('"replayed": true')).length,1)
  assert.match(sql("select count(*) from public.admin_audit_log where request_id='10000000-0000-0000-0000-000000000010';"), /\n\s+1\s*\n/)
  assert.equal(request('/rpc/admin_set_manual_plan',jwt(admin),JSON.stringify({target_id:ordinary,desired_plan:'free',expected_plan:'pro',operation_id:'10000000-0000-0000-0000-000000000011'})).status,200)
  console.log('PASS: concurrent retries over independent PostgreSQL connections produce one write and one replay')
  const planBody=JSON.stringify({target_id:ordinary,desired_plan:'pro',expected_plan:'free',operation_id:'10000000-0000-0000-0000-000000000001'})
  assert.equal(request('/rpc/admin_set_manual_plan',jwt(ordinary),planBody).status,403)
  assert.equal(request('/rpc/admin_set_manual_plan',jwt(admin,Math.floor(Date.now()/1000)-120),planBody).status,401)
  const changed=request('/rpc/admin_set_manual_plan',jwt(admin),planBody); assert.equal(changed.status,200); assert.equal(changed.body.confirmed,true)
  const replay=request('/rpc/admin_set_manual_plan',jwt(admin),planBody); assert.equal(replay.body.replayed,true); assert.equal(replay.body.changedAt,changed.body.changedAt)
  assert.equal(request('/rpc/get_my_entitlements',jwt(ordinary)).body[0].plan,'pro')
  assert.deepEqual(request('/rpc/get_my_entitlements',jwt(ordinary)).body[0].permissions,['future:premium','planner:advanced'])
  const restored=request('/rpc/admin_set_manual_plan',jwt(admin),JSON.stringify({target_id:ordinary,desired_plan:'free',expected_plan:'pro',operation_id:'10000000-0000-0000-0000-000000000002'}));assert.equal(restored.status,200)
  assert.equal(request('/rpc/get_my_entitlements',jwt(ordinary)).body[0].plan,'free')
  assert.deepEqual(request('/rpc/get_my_entitlements',jwt(ordinary)).body[0].permissions,[])
  assert.equal(request('/rpc/admin_management_account',jwt(ordinary),JSON.stringify({selected_id:admin})).status,403)
  assert.equal(request('/rpc/admin_management_account',jwt(admin),JSON.stringify({selected_id:ordinary})).body.canManagePlan,true)
  for(const token of [undefined,'malformed',jwt(ordinary,Math.floor(Date.now()/1000)-120),jwt(ordinary,Math.floor(Date.now()/1000)+600,'wrong-signing-key')])assert.equal(request('/rpc/my_alerts',token,JSON.stringify({payload:{operation:'load'}})).status,401)
  assert.equal(request('/rpc/my_alerts',jwt(ordinary),JSON.stringify({payload:{operation:'load'}})).status,200)
  assert.equal(request('/rpc/my_alerts',jwt(ordinary),JSON.stringify({payload:{operation:'settings',enabled:['walk']}})).status,403)
  const alertRpc=p=>request('/rpc/my_alerts',jwt(ordinary),JSON.stringify({payload:p}))
  assert.equal(alertRpc({operation:'settings',enabled:['rain']}).status,200)
  const alertEvents=[{kind:'rain',start:Date.now()+3600000,end:Date.now()+7200000,min:12,max:12}]
  const cityA={operation:'generate',locationKey:'432:279',zone:'UTC',city:'JWT city A',events:alertEvents},cityB={...cityA,locationKey:'427:233',city:'JWT city B'}
  const generatedA=alertRpc(cityA),generatedB=alertRpc(cityB)
  assert.equal(generatedA.status,200);assert.equal(generatedB.status,200)
  assert.equal(generatedA.body.alerts.length,1);assert.equal(generatedB.body.alerts.length,1)
  assert.ok(generatedB.body.alerts.every(row=>row.locationKey==='427:233'))
  assert.equal(alertRpc({operation:'read',locationKey:'432:279',zone:'UTC',key:generatedA.body.alerts[0].key}).body.alerts[0].read,true)
  assert.equal(alertRpc({operation:'load',locationKey:'427:233',zone:'UTC'}).body.alerts[0].read,false)
  assert.equal(alertRpc({operation:'clear',locationKey:'432:279',zone:'UTC'}).body.alerts.length,0)
  assert.equal(alertRpc(cityA).body.alerts.length,0)
  assert.equal(alertRpc({operation:'load',locationKey:'427:233',zone:'UTC'}).body.alerts.length,1)
  assert.equal(alertRpc({operation:'clear'}).status,400)
  assert.equal(request('/rpc/my_alerts',jwt(admin),JSON.stringify({payload:{operation:'load',locationKey:'427:233',zone:'UTC'}})).body.alerts.length,0)
  console.log('PASS: real JWT HTTP immediate A/B generation, scoped read/clear/history, tombstone replay and account isolation')
  console.log('PASS: alerts RPC rejects missing/invalid/expired/forged JWT; Free cannot enable Pro activity')
  // Independent PostgreSQL connections contend for the same account lock.
  // All subjects below are synthetic rows inside this script's disposable DB.
  sql(`update public.subscriptions set plan='pro',status='active' where user_id='${ordinary}';`)
  assert.equal(alertRpc({operation:'settings',enabled:['garden']}).status,200)
  const tomorrow=Date.parse(new Date(Date.now()+86400000).toISOString().slice(0,10)+'T00:00Z')
  const dailyWindow=hour=>({kind:'garden',start:tomorrow+hour*3600000,end:tomorrow+(hour+2)*3600000,feelsLikeMin:18,feelsLikeMax:20,rainProbability:10,rain:0,wind:5})
  const dailyScope={locationKey:'700:300',zone:'UTC'}
  const dailyPayload={operation:'generate',...dailyScope,city:'Concurrent synthetic day',events:[dailyWindow(7),dailyWindow(11)]}
  const firstDaily=alertRpc(dailyPayload);assert.equal(firstDaily.status,200);assert.equal(firstDaily.body.alerts.length,1)
  const dailyKey=firstDaily.body.alerts[0].key
  assert.equal(firstDaily.body.alerts[0].event.windows.length,2)
  sql(`update public.alert_generation_state set last_generated=now()-interval '31 seconds' where user_id='${ordinary}' and location_key='700:300';`)
  const parallelDaily={...dailyPayload,events:[dailyWindow(17)]}
  const concurrentGeneration=`begin;set local role authenticated;set local request.jwt.claim.sub='${ordinary}';select public.my_alerts('${JSON.stringify(parallelDaily)}');select pg_sleep(0.2);commit;`
  const concurrentHide=`begin;set local role authenticated;set local request.jwt.claim.sub='${ordinary}';select public.my_alerts('${JSON.stringify({operation:'hide',...dailyScope,key:dailyKey})}');commit;`
  await Promise.all([activityCall(concurrentGeneration),activityCall(concurrentGeneration),activityCall(concurrentHide)])
  assert.equal(alertRpc({operation:'load',...dailyScope}).body.alerts.length,0)
  assert.match(sql(`select count(*) from public.weather_alerts where user_id='${ordinary}' and location_key='700:300' and not superseded;`), /\n\s+1\s*\n/)
  assert.match(sql(`select count(*) from public.weather_alerts where user_id='${ordinary}' and event_key='${dailyKey}' and hidden;`), /\n\s+1\s*\n/)
  sql(`update public.alert_generation_state set last_generated=now()-interval '31 seconds' where user_id='${ordinary}' and location_key='700:300';`)
  assert.equal(alertRpc({...dailyPayload,events:[dailyWindow(9)]}).body.alerts.length,0)
  assert.equal(request('/rpc/my_alerts',jwt(admin),JSON.stringify({payload:{operation:'load',...dailyScope}})).body.alerts.length,0)
  sql(`update public.subscriptions set plan='free' where user_id='${ordinary}';`)
  assert.equal(alertRpc(parallelDaily).status,403)
  sql(`update public.subscriptions set plan='pro' where user_id='${ordinary}';`)
  assert.equal(alertRpc({operation:'load',...dailyScope}).body.alerts.length,0)
  sql(`update public.subscriptions set plan='free' where user_id='${ordinary}';`)
  console.log('PASS: real JWT daily identity and disjoint updates, concurrent generation/hide, retained tombstones, account isolation and Free/Pro restoration')

  console.log('PASS: real JWT HTTP Free → Pro → Free, entitlement refresh, replay and account isolation')
  sql(`delete from public.admin_memberships where user_id='${admin}';`)
  assert.equal(request('/rpc/admin_statistics',jwt(admin)).status,403)
  assert.equal(request('/rpc/admin_user_favorites',jwt(admin),favoritesBody).status,403)
  assert.equal(request('/rpc/admin_advanced_statistics',jwt(admin)).status,403)
  assert.equal(request('/rpc/admin_audit_entries',jwt(admin)).status,403)
  assert.equal(request('/rpc/admin_set_manual_plan',jwt(admin),planBody).status,403)
  assert.equal(request('/rpc/admin_management_account',jwt(admin),JSON.stringify({selected_id:ordinary})).status,403)
  console.log('PASS: revoked membership rejects previously valid administrator JWT')
  console.log('LIMIT: minimal Auth schema + real PostgreSQL/PostgREST; full Supabase GoTrue and deployed Vercel API are not exercised.')
} finally {
  docker(['rm','-f',rest],undefined,true)
  docker(['rm','-f',pg],undefined,true)
}
