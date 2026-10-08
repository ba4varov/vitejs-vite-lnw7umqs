const admin='00000000-0000-0000-0000-000000000001', target='00000000-0000-0000-0000-000000000002'
export async function setup(page:any, options:{missing?:boolean,protected?:boolean,failure?:number,uncertain?:boolean,historyCount?:number,empty?:boolean}={}) {
 await page.addInitScript(({admin}:any)=>localStorage.setItem('meteo-pulse-auth',JSON.stringify({access_token:'isolated-test-token',refresh_token:'isolated-test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:admin,email:'admin@example.invalid'}})),{admin})
 await page.route('https://auth.example.invalid/**',(r:any)=>r.fulfill({json:{}}))
 let plan='free', calls:any[]=[], reads:string[]=[], filters:any[]=[]
 const profileReads:string[]=[]
 const history:any[]=Array.from({length:options.historyCount || 1},(_,i)=>({id:i,admin_id:admin,action:i===1?'user_favorites_view':'user_details_view',occurred_at:new Date(Date.UTC(2026,9,8,11-i)).toISOString(),outcome:i===1?'not_found':'success'}))
 const user=()=>({id:target,email:'isolated-user@example.invalid',display_name:'Изолиран тест / Isolated test',created_at:'2026-10-01T12:00:00Z',last_sign_in_at:'2026-10-08T09:00:00Z',providers:['email','google'],plan,blocked:false})
 await page.route('**/api/admin?**',async(r:any)=>{
  const q=new URL(r.request().url()).searchParams, action=q.get('action');reads.push(action!)
  if(action?.startsWith('management-') && options.missing) return r.fulfill({status:503,json:{error:'ADMIN_CONFIGURATION_MISSING'}})
  if(action==='users' && q.get('id')) profileReads.push('user_details_view')
  if(action==='management-account') profileReads.push('user_management_view')
  if(action==='favorites') profileReads.push('user_favorites_view')
  if(action==='management-users') filters.push(Object.fromEntries(q))
  const json=action==='access'?{id:admin,email:'admin@example.invalid',authorized:true}
   : action==='stats'?{total:3,last7:1,last30:2,free:plan==='free'?3:2,pro:plan==='pro'?1:0,favorites:1,registrations:options.empty?[]:Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,8,9+i)).toISOString().slice(0,10),count:[0,20,29].includes(i)?1:0}))}
   : ['users','management-users'].includes(action!)?{users:q.get('plan') && q.get('plan')!==plan?[]:[user()],total:q.get('plan') && q.get('plan')!==plan?0:1,pageSize:20}
   : action==='favorites'?[{id:'isolated-city',name:'София',country:'България'}]
   : action==='management-account'?{id:target,plan,blocked:false,isAdmin:false,manualPro:plan==='pro',canManagePlan:!options.protected,subscriptionStatus:'active',history:[...history]}
   : action==='management-summary'?{blocked:0,asOf:'2026-10-08T12:00:00Z',entries:history.map(e=>({...e,object_id:target}))}
   : action==='audit'?{entries:history.map(e=>({...e,object_id:target})),total:history.length,pageSize:20}
   : action==='system'?{checks:['supabase','admin','openMeteo'].map(service=>({service,available:service!=='openMeteo',responseMs:123,checkedAt:'2026-10-08T10:00:00Z',problem:service==='openMeteo'?'CHECK_FAILED':null}))}
   : action==='analytics'?{period:q.get('period') || '30',total:3,last7:1,last30:3,login7:1,login30:2,noLogin30:1,free:3,pro:0,unknownPlan:0,favorites:1,uniqueCities:1,buckets:Array.from({length:q.get('period')==='12m'?12:Number(q.get('period')||30)},(_,i)=>({date:new Date(Date.UTC(2026,q.get('period')==='12m'?i:8,q.get('period')==='12m'?1:9+i)).toISOString().slice(0,10),registrations:i<3?1:0,last_logins:i<2?1:0})),cities:[{name:'София / Sofia',country:'BG',latitude_key:42.6977,longitude_key:23.3219,count:1}]}
   : {}
  return r.fulfill({json})
 })
 await page.route('**/api/admin-management',async(r:any)=>{
  const b=r.request().postDataJSON();calls.push(b)
  if(options.failure) return r.fulfill({status:options.failure,json:{error:options.failure===403?'FORBIDDEN':'ADMIN_UNAVAILABLE'}})
  if(options.uncertain && calls.length===1) return r.fulfill({status:503,json:{error:'RESULT_UNCONFIRMED'}})
  plan=b.plan;history.unshift({id:calls.length,admin_id:admin,action:plan==='pro'?'manual_pro_grant':'free_restore',occurred_at:'2026-10-08T12:00:00Z',outcome:'success',previous_value:b.expectedPlan,new_value:b.plan})
  await new Promise(resolve=>setTimeout(resolve,150))
  return r.fulfill({json:{confirmed:true,plan,changedAt:'2026-10-08T12:00:00Z'}})
 })
 return {calls,reads,filters,profileReads}
}
