// Earthquake reporting, not earthquake early warning.
// USGS explicitly recommends real-time GeoJSON feeds for displaying new events.
// Never send a browser/device position to the provider: filter near a city in-browser.
export const EARTHQUAKE_FEED_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
export const EARTHQUAKE_DEFAULTS = Object.freeze({
  radiusKm: 300,
  minMagnitude: 3.0,
  pushRequested: true,
})
// Existing Meteo Pulse push-check edge function is intentionally fail-closed.
// This gate must remain false until authenticated, opt-in, deduplicated delivery
// and operator validation have been separately implemented and approved.
export const EARTHQUAKE_PUSH_DELIVERY_ENABLED = false
export const EARTHQUAKE_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000
export const EARTHQUAKE_FRESH_PUSH_AGE_MS = 45 * 60 * 1000
const CACHE_MS = 60_000
const STALE_MS = 5 * 60_000
const MAX_FEED_BYTES = 2_500_000
const MAX_ITEMS = 500
let cached = null
let inFlight = null

const point = (lat,lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) &&
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180

export function distanceKm(a,b) {
  if (!point(a?.lat,a?.lon) || !point(b?.lat,b?.lon)) return null
  const rad=Math.PI/180
  const dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2
  return 6371.0088*2*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))))
}

export function normalizeUsgsEarthquakes(feed, now=Date.now(), {
  maxAgeMs=EARTHQUAKE_MAX_EVENT_AGE_MS, minMagnitude=3, maxItems=MAX_ITEMS
}={}) {
  if (feed?.type !== 'FeatureCollection' || !Array.isArray(feed.features))
    throw Error('INVALID_USGS_FEED')
  if (!Number.isFinite(maxAgeMs) || maxAgeMs<=0 || maxAgeMs>31*86_400_000 ||
    !Number.isFinite(minMagnitude) || minMagnitude<0 || minMagnitude>10 ||
    !Number.isSafeInteger(maxItems) || maxItems<1 || maxItems>1000)
    throw Error('INVALID_USGS_OPTIONS')
  if (feed.features.length > 6000) throw Error('OVERSIZE_USGS_FEED')
  const events=[]
  const seen=new Set()
  for (const row of feed.features) {
    const p=row?.properties,g=row?.geometry,c=g?.coordinates
    const id=typeof row?.id==='string'?row.id:''
    const lat=c?.[1],lon=c?.[0],depth=c?.[2],mag=p?.mag,time=p?.time
    if (!/^[a-zA-Z0-9_-]{2,90}$/.test(id) || seen.has(id) ||
      p?.type!=='earthquake' || g?.type!=='Point' ||
      !point(lat,lon) || !Number.isFinite(mag) || mag < minMagnitude ||
      !Number.isFinite(time) || time > now+120_000 || time < now-maxAgeMs ||
      (depth!=null && (!Number.isFinite(depth)||depth < -10||depth > 800))) continue
    const updated=Number.isFinite(p?.updated)?p.updated:time
    const url=typeof p?.url==='string'&&
      /^https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\/[a-zA-Z0-9_-]+(?:\/)?$/.test(p.url) ?
      p.url : 'https://earthquake.usgs.gov/earthquakes/eventpage/'+encodeURIComponent(id)
    const place=typeof p?.place==='string'?Array.from(p.place)
      .filter(ch=>ch.codePointAt(0)>=32).join('').replace(/[<>]/g,'').slice(0,140):''
    const item={
      id:'usgs:'+id,
      source:'USGS',
      magnitude:Math.round(mag*10)/10,
      lat,lon,depthKm:Number.isFinite(depth)?Math.round(depth*10)/10:null,
      time,updatedAt:Math.max(time,updated),
      place, url,
      preliminary:true,
    }
    seen.add(id)
    events.push(item)
  }
  return events.sort((a,b)=>b.time-a.time).slice(0,maxItems)
}

export function nearbyEarthquakes(events,location,settings=EARTHQUAKE_DEFAULTS,now=Date.now()) {
  if (!Array.isArray(events)||!point(location?.lat,location?.lon)) return []
  const radius=Number(settings?.radiusKm),minMag=Number(settings?.minMagnitude)
  if (!Number.isFinite(radius)||radius<=0||radius>500 || !Number.isFinite(minMag)||minMag<0||minMag>10) return []
  return events.map(event=>({...event,distanceKm:distanceKm(location,event)}))
    .filter(event=>event.distanceKm!==null && event.distanceKm<=radius && event.magnitude>=minMag &&
      event.time<=now+120_000 && event.time>=now-EARTHQUAKE_MAX_EVENT_AGE_MS)
    .sort((a,b)=>b.time-a.time).slice(0,12)
}

export function earthquakeDedupKey(event) {
  return typeof event?.id==='string' && /^usgs:[A-Za-z0-9_-]{2,90}$/.test(event.id) ?
    'earthquake:'+event.id : null
}

// Produces candidates only. Does NOT send or grant permission.
// Future job must atomically insert (user_id,event_key) before one permitted
// attempt, verify browser subscription+permission, and never retry uncertain sends.
export function earthquakePushCandidates(events,subscriber,alreadySent=new Set(),now=Date.now()) {
  if (!EARTHQUAKE_PUSH_DELIVERY_ENABLED || subscriber?.pushRequested!==true ||
    subscriber?.browserPermission!=='granted' || subscriber?.enabled!==true ||
    !Number.isFinite(subscriber?.consentedAt)) return []
  const location={lat:subscriber.lat,lon:subscriber.lon}
  return nearbyEarthquakes(events,location,subscriber,now)
    .filter(event=>event.time>=subscriber.consentedAt &&
      now-event.time<=EARTHQUAKE_FRESH_PUSH_AGE_MS &&
      !alreadySent.has(earthquakeDedupKey(event)))
    .map(event=>({key:earthquakeDedupKey(event),event}))
}

// All callers on the same server instance share one provider request. CDN
// public cache headers protect across serverless instances.
export async function loadUsgsFeed({fetcher=fetch,now=Date.now()}={}) {
  if (cached && now-cached.checkedAt<CACHE_MS && now>=cached.checkedAt)
    return {...cached,stale:false}
  if (inFlight) return inFlight
  const task=(async()=>{
    try {
      const response=await fetcher(EARTHQUAKE_FEED_URL,{
        headers:{Accept:'application/geo+json, application/json'},
        signal:AbortSignal.timeout(7500),
        redirect:'error',
      })
      if (!response.ok) throw Error('UPSTREAM_FAILED')
      const size=Number(response.headers?.get?.('content-length'))
      if (Number.isFinite(size) && size>MAX_FEED_BYTES) throw Error('UPSTREAM_TOO_LARGE')
      const raw=await response.text()
      if (raw.length>MAX_FEED_BYTES) throw Error('UPSTREAM_TOO_LARGE')
      const data=JSON.parse(raw)
      const events=normalizeUsgsEarthquakes(data,now)
      cached={events,checkedAt:now,source:'USGS',feedUpdatedAt:
        Number.isFinite(data.metadata?.generated)?data.metadata.generated:now}
      return {...cached,stale:false}
    }catch(error){
      if (cached && now-cached.checkedAt<=STALE_MS && now>=cached.checkedAt)
        return {...cached,stale:true}
      throw error
    }
  })()
  inFlight=task
  try {return await task} finally {if(inFlight===task)inFlight=null}
}

export async function handleEarthquakes(req,res,{fetcher=fetch,now=Date.now()}={}) {
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('X-Content-Type-Options','nosniff')
  if (req.method!=='GET') {
    res.setHeader('Cache-Control','no-store')
    return res.status(405).json({error:'METHOD_NOT_ALLOWED'})
  }
  if (Object.keys(req.query||{}).length || req.headers?.authorization) {
    res.setHeader('Cache-Control','no-store')
    return res.status(400).json({error:'INVALID_REQUEST'})
  }
  try {
    const data=await loadUsgsFeed({fetcher,now})
    res.setHeader('Cache-Control',data.stale?'public, s-maxage=15, max-age=0':
      'public, s-maxage=60, stale-while-revalidate=60, max-age=0')
    return res.status(200).json({
      status:data.stale?'stale':'ready',
      source:'USGS',checkedAt:data.checkedAt,feedUpdatedAt:data.feedUpdatedAt,
      events:data.events,refreshSeconds:90,pushDeliveryEnabled:false,
    })
  }catch{
    res.setHeader('Cache-Control','no-store')
    res.setHeader('Retry-After','60')
    return res.status(503).json({status:'unavailable',error:'EARTHQUAKES_UNAVAILABLE'})
  }
}
