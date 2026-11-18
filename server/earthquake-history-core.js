// USGS historical earthquake catalog: public, limited to a fixed geographic
// window and two fixed time windows. Never accepts coordinates from visitors.
// This is a browsing history, not an earthquake alert or early warning.
import {normalizeUsgsEarthquakes} from './earthquakes-core.js'

const USGS_CATALOG='https://earthquake.usgs.gov/fdsnws/event/1/query'
const DAY_MS=86_400_000
const PERIODS=new Set([7,30])
const MAX_RESULTS=500
const MAX_FEED_BYTES=2_500_000
const CACHE_MS=10*60_000
const STALE_MS=30*60_000
export const HISTORY_MIN_MAGNITUDE=3
export const BALKAN_HISTORY_BOUNDING_BOX=Object.freeze({
  minlatitude:34.5,maxlatitude:47.5,minlongitude:12.5,maxlongitude:31.5
})
// A geographic approximation, not the political borders of Bulgaria.
// Label this as "Bulgaria and nearby areas" in the interface.
export const BULGARIA_NEARBY_BOUNDING_BOX=Object.freeze({
  minlatitude:41.0,maxlatitude:44.4,minlongitude:22.0,maxlongitude:29.3
})
const cache=new Map()
const inFlight=new Map()

export function usgsHistoryUrl(period,now=Date.now()) {
  if(!PERIODS.has(period)||!Number.isFinite(now))return null
  const url=new URL(USGS_CATALOG)
  const params={
    format:'geojson',eventtype:'earthquake',orderby:'time',
    starttime:new Date(now-period*DAY_MS).toISOString(),
    minlatitude:String(BALKAN_HISTORY_BOUNDING_BOX.minlatitude),
    maxlatitude:String(BALKAN_HISTORY_BOUNDING_BOX.maxlatitude),
    minlongitude:String(BALKAN_HISTORY_BOUNDING_BOX.minlongitude),
    maxlongitude:String(BALKAN_HISTORY_BOUNDING_BOX.maxlongitude),
    minmagnitude:String(HISTORY_MIN_MAGNITUDE),
    limit:String(MAX_RESULTS),
    nodata:'204'
  }
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value)
  return url.toString()
}

const inside=(item,box)=>Number.isFinite(item?.lat)&&Number.isFinite(item?.lon)&&
  item.lat>=box.minlatitude&&item.lat<=box.maxlatitude&&
  item.lon>=box.minlongitude&&item.lon<=box.maxlongitude

export function filterHistoryByRegion(events,region='bulgaria',limit=12) {
  if(!Array.isArray(events)||!['bulgaria','balkans'].includes(region)||
    !Number.isInteger(limit)||limit<1||limit>100)return []
  const box=region==='bulgaria'?BULGARIA_NEARBY_BOUNDING_BOX:BALKAN_HISTORY_BOUNDING_BOX
  return events.filter(event=>inside(event,box) &&
    Number.isFinite(event?.magnitude)&&event.magnitude>=HISTORY_MIN_MAGNITUDE)
    .sort((a,b)=>b.time-a.time)
    .slice(0,limit)
}

export async function loadUsgsHistory(period,{fetcher=fetch,now=Date.now()}={}) {
  if(!PERIODS.has(period))throw Error('INVALID_PERIOD')
  const previous=cache.get(period)
  if(previous&&now>=previous.checkedAt&&now-previous.checkedAt<CACHE_MS)
    return {...previous,stale:false}
  if(inFlight.has(period))return inFlight.get(period)
  const task=(async()=>{
    try {
      const response=await fetcher(usgsHistoryUrl(period,now),{
        headers:{Accept:'application/geo+json, application/json'},
        signal:AbortSignal.timeout(8500),
        redirect:'error'
      })
      if(response.status===204) {
        const result={checkedAt:now,source:'USGS',events:[],periodDays:period,
          limit:MAX_RESULTS,limitReached:false}
        cache.set(period,result)
        return {...result,stale:false}
      }
      if(!response.ok)throw Error('USGS_CATALOG_UNAVAILABLE')
      const bytes=Number(response.headers?.get?.('content-length'))
      if(Number.isFinite(bytes)&&bytes>MAX_FEED_BYTES)throw Error('CATALOG_TOO_LARGE')
      const raw=await response.text()
      if(raw.length>MAX_FEED_BYTES)throw Error('CATALOG_TOO_LARGE')
      const feed=JSON.parse(raw)
      const events=normalizeUsgsEarthquakes(feed,now,{
        maxAgeMs:period*DAY_MS,minMagnitude:HISTORY_MIN_MAGNITUDE,maxItems:MAX_RESULTS
      }).filter(event=>inside(event,BALKAN_HISTORY_BOUNDING_BOX))
      const result={checkedAt:now,source:'USGS',events,periodDays:period,
        limit:MAX_RESULTS,limitReached:feed.features.length>=MAX_RESULTS}
      cache.set(period,result)
      return {...result,stale:false}
    }catch(err){
      if(previous&&now>=previous.checkedAt&&now-previous.checkedAt<STALE_MS)
        return {...previous,stale:true}
      throw err
    }
  })()
  inFlight.set(period,task)
  try{return await task}
  finally{if(inFlight.get(period)===task)inFlight.delete(period)}
}

export async function handleEarthquakeHistory(req,res,{fetcher=fetch,now=Date.now()}={}) {
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options','nosniff')
  if(req.method!=='GET'){
    res.setHeader('Cache-Control','no-store')
    return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
  }
  const query=req.query||{}
  const period=query.period===undefined?7:Number(query.period)
  if(Object.keys(query).some(key=>key!=='period') ||
    typeof query.period==='object' || !PERIODS.has(period) ||
    (query.period!==undefined&&!['7','30'].includes(query.period)) ||
    req.headers?.authorization) {
    res.setHeader('Cache-Control','no-store')
    return res.status(400).json({error:'INVALID_REQUEST'})
  }
  try {
    const result=await loadUsgsHistory(period,{fetcher,now})
    res.setHeader('Cache-Control',result.stale?'public, s-maxage=30, max-age=0':
      'public, s-maxage=600, stale-while-revalidate=120, max-age=0')
    return res.status(200).json({
      status:result.stale?'stale':'ready',source:result.source,periodDays:result.periodDays,
      magnitudeThreshold:HISTORY_MIN_MAGNITUDE,checkedAt:result.checkedAt,
      limitReached:result.limitReached,limit:result.limit,events:result.events,
      pushDeliveryEnabled:false
    })
  }catch{
    res.setHeader('Cache-Control','no-store')
    res.setHeader('Retry-After','60')
    return res.status(503).json({status:'unavailable',error:'EARTHQUAKE_HISTORY_UNAVAILABLE'})
  }
}
