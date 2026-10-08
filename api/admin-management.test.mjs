import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleAdminManagement } from './admin-management-core.js'
const admin='00000000-0000-0000-0000-000000000001',target='00000000-0000-0000-0000-000000000002'
const body={action:'plan',targetId:target,plan:'pro',expectedPlan:'free',requestId:'30000000-0000-0000-0000-000000000001',confirmed:true}
const env={SUPABASE_URL:'https://supabase.example.invalid',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-server-only'}
async function run({payload=body,auth=true,member=true,sqlStatus=200,sql={confirmed:true,plan:'pro',changedAt:'2026-10-08T12:00:00Z'},method='POST',throws=false}={}) {
 const calls=[];const res={setHeader(){},status(code){this.code=code;return this},json(value){this.value=value;return this}}
 const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/auth/v1/user')) return {ok:auth,json:async()=>({id:admin})};if(url.endsWith('/is_meteo_admin'))return {ok:true,json:async()=>member};if(throws)throw Error('connection lost');return {ok:sqlStatus===200,status:sqlStatus,json:async()=>sql}}
 await handleAdminManagement({method,headers:{authorization:'Bearer test-jwt'},body:payload},res,env,fetcher)
 return {res,calls}
}
test('confirmed plan write attributes actor only through JWT and never exposes service key',async()=>{const {res,calls}=await run();assert.equal(res.code,200);const rpc=JSON.parse(calls.at(-1).options.body);assert.deepEqual(rpc,{target_id:target,desired_plan:'pro',expected_plan:'free',operation_id:body.requestId});assert.ok(calls.every(c=>!JSON.stringify(c).includes(env.SUPABASE_SERVICE_ROLE_KEY)))})
test('invalid or expired Auth session and revoked membership cannot mutate',async()=>{for(const [options,status] of [[{auth:false},401],[{member:false},403]]){const {res,calls}=await run(options);assert.equal(res.code,status);assert.ok(!calls.some(c=>c.url.endsWith('/admin_set_manual_plan')))}})
test('confirmation, UUID, plans and forged actor fields are rejected',async()=>{for(const payload of [{...body,confirmed:false},{...body,targetId:'invalid'},{...body,requestId:'invalid'},{...body,plan:'paid'},{...body,admin_id:admin}]){const {res,calls}=await run({payload});assert.equal(res.code,400);assert.ok(!calls.some(c=>c.url.endsWith('/admin_set_manual_plan')))}})
test('self, other admin and ordinary bans stay unavailable and never invoke Auth Admin',async()=>{for(const targetId of [admin,target,'00000000-0000-0000-0000-000000000003'])for(const action of ['block','restore']){const {res,calls}=await run({payload:{action,targetId}});assert.equal(res.code,503);assert.equal(res.value.error,'BLOCKING_UNAVAILABLE');assert.ok(!calls.some(c=>c.url.includes('/auth/v1/admin')))}})
test('SQL refusal, audit failure, missing migration and unknown commit never report success',async()=>{for(const [options,status,code] of [[{sqlStatus:400,sql:{message:'STALE_PLAN'}},409,'STALE_PLAN'],[{sqlStatus:500,sql:{message:'sensitive internal SQL detail'}},503,'ADMIN_UNAVAILABLE'],[{sqlStatus:404,sql:{code:'PGRST202'}},503,'ADMIN_CONFIGURATION_MISSING'],[{throws:true},503,'RESULT_UNCONFIRMED'],[{sql:{plan:'pro'}},503,'RESULT_UNCONFIRMED']]){const {res}=await run(options);assert.equal(res.code,status);assert.equal(res.value.error,code);assert.ok(!res.value.confirmed)}})
test('idempotent replay is only successful after SQL confirms it',async()=>{const {res}=await run({sql:{confirmed:true,replayed:true,plan:'pro',changedAt:'2026-10-08T12:00:00Z'}});assert.equal(res.code,200);assert.equal(res.value.replayed,true)})
test('read methods cannot mutate',async()=>{const {res,calls}=await run({method:'GET'});assert.equal(res.code,405);assert.equal(calls.length,0)})

import { handleAdmin } from './admin-core.js'
test('management read endpoint validates filters, UUID and real calendar dates before RPC',async()=>{
 for(const query of [{action:'management-account',id:'invalid'},{action:'management-users',from:'2026-02-30'},{action:'management-users',from:'2026-10-10',to:'2026-10-01'},{action:'management-users',status:'invented'},{action:'management-users',page:['1']}]){
  const calls=[];const res={setHeader(){},status(code){this.code=code;return this},json(value){this.value=value;return this}}
  await handleAdmin({method:'GET',headers:{authorization:'Bearer test-jwt'},query},res,env,async url=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/auth/v1/user')?{id:admin}:true}})
  assert.equal(res.code,400);assert.equal(calls.length,2)
 }
})
test('filtered user RPC has no frontend-selected actor and preserves all filter values',async()=>{
 const calls=[];const res={setHeader(){},status(code){this.code=code;return this},json(value){this.value=value;return this}}
 await handleAdmin({method:'GET',headers:{authorization:'Bearer test-jwt'},query:{action:'management-users',search:'name',page:'2',status:'blocked',plan:'free',from:'2026-10-01',to:'2026-10-08'}},res,env,async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/auth/v1/user')?{id:admin}:url.endsWith('/is_meteo_admin')?true:{users:[],total:0,pageSize:20}}})
 assert.equal(res.code,200);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{search_text:'name',page_number:2,access_status:'blocked',selected_plan:'free',registered_from:'2026-10-01',registered_to:'2026-10-08'})
})
