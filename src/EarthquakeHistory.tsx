import {useEffect,useMemo,useState} from 'react'
import {filterHistoryByRegion,HISTORY_MIN_MAGNITUDE} from '../server/earthquake-history-core.js'
import './earthquake-history.css'

type Earthquake = {
  id:string;source:string;magnitude:number;time:number;place:string;
  depthKm:number|null;lat:number;lon:number;url:string;preliminary:boolean
}
type HistoryData = {
  status:'ready'|'stale';source:'USGS';periodDays:number;checkedAt:number;
  events:Earthquake[];limitReached:boolean;limit:number
}
type Period=7|30
type Region='bulgaria'|'balkans'

const CACHE_MS=10*60_000
const snapshots=new Map<number,{at:number;data:HistoryData}>()
const active=new Map<number,Promise<HistoryData>>()

async function loadHistory(period:Period,force=false):Promise<HistoryData> {
  const cache=snapshots.get(period),now=Date.now()
  if(!force&&cache&&now>=cache.at&&now-cache.at<CACHE_MS)return cache.data
  if(active.has(period))return active.get(period)!
  const task=fetch(`/api/alerts?source=earthquake-history&period=${period}`,{
    headers:{Accept:'application/json'},
    signal:AbortSignal.timeout(11_000)
  }).then(async response=>{
    if(!response.ok)throw Error('EARTHQUAKE_HISTORY_UNAVAILABLE')
    const data=await response.json() as HistoryData
    if(!['ready','stale'].includes(data?.status)||data?.source!=='USGS'||
      data?.periodDays!==period||!Array.isArray(data.events)||
      !Number.isFinite(data.checkedAt))
      throw Error('INVALID_HISTORY_RESPONSE')
    snapshots.set(period,{at:Date.now(),data})
    return data
  }).finally(()=>{if(active.get(period)===task)active.delete(period)})
  active.set(period,task)
  return task
}

export function EarthquakeHistory({lang}:{lang:'bg'|'en'}) {
  const bg=lang==='bg'
  const [expanded,setExpanded]=useState(false)
  const [region,setRegion]=useState<Region>('bulgaria')
  const [period,setPeriod]=useState<Period>(7)
  const [viewCount,setViewCount]=useState(10)
  const [reload,setReload]=useState(0)
  const [result,setResult]=useState<{period:Period;data:HistoryData}|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState(false)
  useEffect(()=>{
    if(!expanded)return
    let activeView=true
    const task=async()=>{
      setLoading(true)
      setError(false)
      try {
        const data=await loadHistory(period,reload>0)
        if(activeView){setResult({period,data});setError(false)}
      }catch{
        if(activeView){setError(true);setResult(null)}
      }finally{
        if(activeView)setLoading(false)
      }
    }
    void task()
    return()=>{activeView=false}
  },[expanded,period,reload])
  const data=result?.period===period?result.data:null
  const events=useMemo(()=>data?filterHistoryByRegion(data.events,region,100):[],
    [data,region])
  const shown=events.slice(0,viewCount)
  const stale=data?.status==='stale'
  const regionName=region==='bulgaria'?
    (bg?'България и близки райони':'Bulgaria and nearby areas'):
    (bg?'Балкански регион':'Balkan region')
  const time=(stamp:number)=>{
    try{return new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{
      timeZone:'Europe/Sofia',day:'2-digit',month:'short',
      year:'numeric',hour:'2-digit',minute:'2-digit'
    }).format(stamp)}
    catch{return new Date(stamp).toISOString()}
  }
  return <section className="earthquake-history" aria-labelledby="earthquake-history-title">
    <div className="earthquake-history-header">
      <div>
        <h2 id="earthquake-history-title">{bg?'Последни земетресения':'Recent earthquakes'}</h2>
        <p>{bg?'България и Балканите · архив от USGS':'Bulgaria and the Balkans · USGS catalog'}</p>
      </div>
      <button type="button" className="earthquake-history-toggle"
        aria-expanded={expanded} aria-controls="earthquake-history-body"
        onClick={()=>setExpanded(current=>!current)}>
        {expanded?(bg?'Скрий':'Hide'):(bg?'Виж историята':'Browse history')}
        <span aria-hidden="true">{expanded?'−':'+'}</span>
      </button>
    </div>
    {expanded&&<div id="earthquake-history-body" className="earthquake-history-body">
      <div className="earthquake-history-controls">
        <div role="group" aria-label={bg?'Регион':'Region'}>
          <button type="button" aria-pressed={region==='bulgaria'}
            onClick={()=>{setRegion('bulgaria');setViewCount(10)}}>
            {bg?'България и околностите':'Bulgaria area'}
          </button>
          <button type="button" aria-pressed={region==='balkans'}
            onClick={()=>{setRegion('balkans');setViewCount(10)}}>
            {bg?'Балканите':'Balkans'}
          </button>
        </div>
        <div role="group" aria-label={bg?'Период':'Period'}>
          <button type="button" aria-pressed={period===7}
            onClick={()=>{setPeriod(7);setViewCount(10)}}>{bg?'7 дни':'7 days'}</button>
          <button type="button" aria-pressed={period===30}
            onClick={()=>{setPeriod(30);setViewCount(10)}}>{bg?'30 дни':'30 days'}</button>
        </div>
      </div>
      <p className="earthquake-history-scope">
        {regionName} · M {HISTORY_MIN_MAGNITUDE.toFixed(1)}+ ·
        {' '}{bg?'Географски ориентировъчен обхват, не точни държавни граници.':
          'Approximate geographic area, not exact national borders.'}
      </p>
      {loading&&<p className="earthquake-history-status" role="status">
        {bg?'Зареждам регистрираните земетресения…':'Loading recorded earthquakes…'}
      </p>}
      {error&&!loading&&<div className="earthquake-history-status" role="status">
        {bg?'Източникът временно не е достъпен. Не можем да потвърдим данните.':
          'The source is temporarily unavailable. Data could not be verified.'}
        <button type="button" onClick={()=>setReload(i=>i+1)}>
          {bg?'Опитай отново':'Try again'}
        </button>
      </div>}
      {data&&!loading&&<>
        {stale&&<p className="earthquake-history-status" role="status">
          {bg?'Показани са последните успешно получени данни. Възможно е да са остарели.':
            'Showing the last successfully retrieved data, which may be outdated.'}
        </p>}
        <div className="earthquake-history-meta">
          <span>{bg?'Последна проверка':'Last checked'}: {time(data.checkedAt)} ({bg?'българско време':'Bulgaria time'})</span>
          <button type="button" onClick={()=>setReload(i=>i+1)}>
            {bg?'Провери отново':'Check again'}
          </button>
        </div>
        {events.length===0?
          <p className="earthquake-history-status" role="status">
            {bg?'USGS не съобщава събития по тези критерии за избрания период. Това не е потвърждение за липса на земетресения.':
              'USGS reports no events matching this filter for the selected period. This does not confirm that no earthquakes occurred.'}
          </p>:
          <>
            <ol className="earthquake-history-list">
              {shown.map(event=><li key={event.id}>
                <div className="earthquake-history-summary">
                  <strong>M {event.magnitude.toFixed(1)}</strong>
                  <span>{time(event.time)}</span>
                </div>
                <p>{event.place|| (bg?'Епицентър в региона':'Epicentre within the region')}</p>
                <p className="earthquake-history-depth">
                  {bg?'Дълбочина':'Depth'}: {event.depthKm===null?
                    (bg?'неизвестна':'unknown'):`${event.depthKm} km`}
                  {' · '}<a href={event.url} target="_blank" rel="noopener noreferrer">
                    {bg?'Данни от USGS':'USGS event'}
                  </a>
                </p>
              </li>)}
            </ol>
            {viewCount<events.length&&<button type="button" className="earthquake-history-more"
              onClick={()=>setViewCount(n=>Math.min(n+10,100))}>
              {bg?'Покажи още':'Show more'} ({events.length-viewCount})
            </button>}
          </>
        }
        {data.limitReached&&<p className="earthquake-history-status">
          {bg?'Показани са най-новите до 500 събития от архива, не непременно пълен списък.':
            'Only the latest up to 500 catalog events are included; this may not be a complete history.'}
        </p>}
      </>}
      <p className="earthquake-history-disclaimer">
        {bg?
          'Информация от USGS, предварителна и подлежаща на промяна. Не е ранно предупреждение. Автоматични Push известия за земетресения не се изпращат.':
          'USGS preliminary records may be revised. Not an early-warning system. No automatic earthquake Push notifications are sent.'}
      </p>
    </div>}
  </section>
}
