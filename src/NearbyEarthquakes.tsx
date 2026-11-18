import {useEffect,useMemo,useState} from 'react'
import {EARTHQUAKE_DEFAULTS,nearbyEarthquakes} from '../server/earthquakes-core.js'
import './nearby-earthquakes.css'

// One public feed, shared by mounted views and StrictMode. Selected-city
// coordinates are used ONLY on the client to filter the normalized events.
let snapshot:{received:number;data:any}|null=null
let pending:Promise<any>|null=null
const POLL_MS=90_000
const CLIENT_CACHE_MS=75_000
async function loadEvents() {
  const now=Date.now()
  if (snapshot && now-snapshot.received<CLIENT_CACHE_MS && now>=snapshot.received) return snapshot.data
  if (pending) return pending
  const request=fetch('/api/earthquakes',{
    signal:AbortSignal.timeout(9000),
    headers:{Accept:'application/json'},
  }).then(async response=>{
    if(!response.ok)throw Error('EARTHQUAKES_UNAVAILABLE')
    const data=await response.json()
    if(!['ready','stale'].includes(data?.status)||!Array.isArray(data?.events))throw Error('INVALID_EARTHQUAKES_RESPONSE')
    snapshot={received:Date.now(),data}
    return data
  }).finally(()=>{if(pending===request)pending=null})
  pending=request
  return request
}

export function NearbyEarthquakes({enabled,lat,lon,city,lang,timeZone}:{
  enabled:boolean;lat:number;lon:number;city:string;lang:'bg'|'en';timeZone?:string
}) {
  const [data,setData]=useState<any>(null)
  const [error,setError]=useState(false)
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{
    if(!enabled||!Number.isFinite(lat)||!Number.isFinite(lon)) {
      setData(null)
      return
    }
    let active=true
    const poll=async()=>{
      if(document.visibilityState!=='visible')return
      try {
        const next=await loadEvents()
        if(active){setData(next);setError(false);setNow(Date.now())}
      }catch{
        if(active){setError(true);setNow(Date.now())}
      }
    }
    void poll()
    const timer=window.setInterval(()=>void poll(),POLL_MS)
    const visible=()=>{if(document.visibilityState==='visible')void poll()}
    document.addEventListener('visibilitychange',visible)
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
  },[enabled,lat,lon])
  const bg=lang==='bg'
  const events=useMemo(()=>enabled && Array.isArray(data?.events)?
    nearbyEarthquakes(data.events,{lat,lon},EARTHQUAKE_DEFAULTS,now):[],
    [data,enabled,lat,lon,now])
  // Don't keep showing unverified events beyond the permitted stale window.
  const verifiedRecently=typeof data?.checkedAt==='number' &&
    now>=data.checkedAt && now-data.checkedAt<5*60_000
  if(!enabled||!events.length||!verifiedRecently)return null

  const stale=data.status==='stale'||error||now-data.checkedAt>2*60_000
  const eventTime=(time:number)=>{
    try{return new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{
      timeZone:timeZone||undefined,day:'2-digit',month:'short',
      hour:'2-digit',minute:'2-digit'
    }).format(time)}catch{return new Date(time).toLocaleString(bg?'bg-BG':'en-GB')}
  }
  return <section className="earthquake-nearby" aria-labelledby="earthquake-nearby-title">
    <div className="earthquake-heading">
      <span className="earthquake-icon" aria-hidden="true">≋</span>
      <div>
        <h2 id="earthquake-nearby-title">{bg?'Регистрирани земетресения наблизо':'Nearby recorded earthquakes'}</h2>
        <p>{bg?'Последните 24 часа':'Past 24 hours'} · {bg?'до':'within'} {EARTHQUAKE_DEFAULTS.radiusKm} {bg?'км от':'km of'} {city} · M {EARTHQUAKE_DEFAULTS.minMagnitude.toFixed(1)}+</p>
      </div>
    </div>
    {stale && <p className="earthquake-data-status" role="status">{bg?'Данните може да са остарели. Проверете източника.':'The information may be outdated. Check the source.'}</p>}
    <ul>{events.slice(0,5).map((event:any)=><li key={event.id}>
      <div className="earthquake-event-top">
        <strong>{bg?'Магнитуд':'Magnitude'} M {event.magnitude.toFixed(1)}</strong>
        <span>{Math.round(event.distanceKm)} {bg?'км от града':'km from the city'}</span>
      </div>
      <p>{event.place|| (bg?'Местоположение на епицентъра':'Epicentre location')}</p>
      <p className="earthquake-detail">{eventTime(event.time)}{event.depthKm!=null? ` · ${bg?'Дълбочина':'Depth'}: ${event.depthKm} ${bg?'км':'km'}`:''}</p>
      <a href={event.url} target="_blank" rel="noopener noreferrer">
        {bg?'Детайли от USGS':'USGS event details'}
      </a>
    </li>)}</ul>
    <p className="earthquake-disclaimer">{bg?
      'Предварителни сеизмологични данни от USGS, които може да бъдат коригирани. Това НЕ е ранно предупреждение за предстоящ трус. Няма активна автоматична Push доставка.':
      'Preliminary USGS seismic information, subject to revision. This is NOT an earthquake early-warning system. Automatic Push delivery is not active.'}</p>
  </section>
}
