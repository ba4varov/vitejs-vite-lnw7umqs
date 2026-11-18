import {authenticate} from './profile-core.js'
import {EARTHQUAKE_DEFAULTS,EARTHQUAKE_PUSH_DELIVERY_ENABLED} from './earthquakes-core.js'

// Separate consent. Never mutate the existing weather-Push settings contract.
// Actual earthquake Push delivery is intentionally still fail-closed.
export function validEarthquakeConsentChange(body) {
  if(!body||Array.isArray(body)||typeof body!=='object')return false
  const keys=Object.keys(body).sort()
  if(body.enabled===false)return keys.length===1&&keys[0]==='enabled'
  return body.enabled===true&&
    keys.length===2&&keys[0]==='cityIndex'&&keys[1]==='enabled'&&
    Number.isInteger(body.cityIndex)&&body.cityIndex>=0&&body.cityIndex<=4
}

export function validEarthquakeConsentSnapshot(data) {
  if(!data||typeof data!=='object'||data.contractVersion!==1||
    data.deliveryEnabled!==false||typeof data.enabled!=='boolean'||
    data.radiusKm!==EARTHQUAKE_DEFAULTS.radiusKm||
    data.minMagnitude!==EARTHQUAKE_DEFAULTS.minMagnitude||
    !Number.isInteger(data.deviceCount)||data.deviceCount<0||data.deviceCount>10)return false
  if(!data.enabled)return data.city==null&&data.optedInAt==null
  const city=data.city
  return !!city&&!Array.isArray(city)&&typeof city==='object'&&
    typeof city.name==='string'&&city.name.trim().length>0&&city.name.length<=100&&
    Number.isFinite(city.latitude)&&Math.abs(city.latitude)<=90&&
    Number.isFinite(city.longitude)&&Math.abs(city.longitude)<=180&&
    typeof city.zone==='string'&&city.zone.length>0&&city.zone.length<=64&&
    typeof data.optedInAt==='string'&&!Number.isNaN(Date.parse(data.optedInAt))
}

export async function handleEarthquakeConsent(req,res,env=process.env,fetcher=fetch) {
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control','private, no-store')
  res.setHeader('Vary','Authorization')
  res.setHeader('X-Content-Type-Options','nosniff')
  if(!['GET','PUT'].includes(req.method))
    return res.status(405).json({error:'METHOD_NOT_ALLOWED',deliveryEnabled:false})
  if(Object.keys(req.query||{}).length||!req.headers?.authorization?.startsWith('Bearer '))
    return res.status(401).json({error:'INVALID_SESSION',deliveryEnabled:false})
  if(req.method==='PUT' && (!validEarthquakeConsentChange(req.body) ||
      JSON.stringify(req.body).length>160||
      Number(req.headers?.['content-length']||0)>512))
    return res.status(400).json({error:'INVALID_BODY',deliveryEnabled:false})
  if(req.method==='GET'&&req.body!=null&&Object.keys(req.body).length)
    return res.status(400).json({error:'INVALID_BODY',deliveryEnabled:false})
  const url=env.SUPABASE_URL?.replace(/\/$/,'')
  const key=env.SUPABASE_ANON_KEY
  if(!url||!key)return res.status(503).json({error:'PUSH_UNAVAILABLE',deliveryEnabled:false})
  try {
    const limited=(address,options)=>fetcher(address,{
      ...options,redirect:'error',signal:AbortSignal.timeout(5500)
    })
    const user=await authenticate(url,key,req.headers.authorization,limited)
    if(!user||typeof user.id!=='string')
      return res.status(401).json({error:'INVALID_SESSION',deliveryEnabled:false})
    const payload=req.method==='GET'?{operation:'load'}:
      req.body.enabled?{operation:'set',enabled:true,cityIndex:req.body.cityIndex}:
      {operation:'set',enabled:false}
    const rpc=await limited(`${url}/rest/v1/rpc/my_earthquake_push`,{
      method:'POST',headers:{
        apikey:key,Authorization:req.headers.authorization,
        'Content-Type':'application/json'
      },body:JSON.stringify({payload})
    })
    if(!rpc.ok)return res.status(rpc.status===401||rpc.status===403?403:503)
      .json({error:'EARTHQUAKE_CONSENT_UNAVAILABLE',deliveryEnabled:false})
    const data=await rpc.json()
    if(!validEarthquakeConsentSnapshot(data)||EARTHQUAKE_PUSH_DELIVERY_ENABLED)
      return res.status(503).json({error:'EARTHQUAKE_CONSENT_UNAVAILABLE',deliveryEnabled:false})
    return res.status(200).json(data)
  }catch{
    return res.status(503).json({error:'EARTHQUAKE_CONSENT_UNAVAILABLE',deliveryEnabled:false})
  }
}
