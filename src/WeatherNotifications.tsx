import {useEffect,useState,useRef} from 'react'
import type {AuthSession} from './auth-client'
import {alertsRequest,alertNames} from './alerts-client'
import {forecastRisks,alertKey} from '../server/alerts-logic.js'
export function WeatherNotifications({session,lang,forecast,city,locationKey}:{session:AuthSession|null;lang:string;forecast:any;city:string;locationKey:string}) {
 const bg=lang==='bg',[open,setOpen]=useState(false),[loaded,setLoaded]=useState<{view:string;rows:any[]}>({view:'',rows:[]}),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0)
 const guestRows=useRef<any[]>([]),requestVersion=useRef(0),controllerRef=useRef<AbortController|null>(null)
 const [guestState,setGuestState]=useState<Record<string,string>>({})
 const id=session?.user.id,token=session?.access_token,zone=forecast?.timeZone
 const scope=zone?{locationKey,zone}:undefined
 const view=JSON.stringify([id||'guest',locationKey,zone||null])
 // Update on render: even before effect cleanup an old mutation cannot enter a new view.
 const viewRef=useRef(view);viewRef.current=view
 useEffect(()=>{const change=()=>setRevision(v=>v+1);window.addEventListener('meteo-alert-settings',change);return()=>window.removeEventListener('meteo-alert-settings',change)},[])
 useEffect(()=>{
  let live=true;const controller=new AbortController();controllerRef.current=controller;requestVersion.current++;setLoaded({view,rows:[]});setFailed(false)
  if(!session){const risks=forecast?forecastRisks(forecast):[];const next=risks.map((event:any)=>{const previous=guestRows.current.find(row=>row.locationKey===locationKey&&row.zone===zone&&row.event.kind===event.kind&&row.event.start<event.end&&row.event.end>event.start);return {key:previous?.key||alertKey(locationKey,zone,event),locationKey,city,zone,event,updated:Date.now(),read:false}});if(forecast)guestRows.current=next;setLoaded({view,rows:next});if(forecast)setGuestState(s=>Object.fromEntries(next.filter(r=>s[r.key]).map(r=>[r.key,s[r.key]])));return()=>{live=false;controller.abort();requestVersion.current++}}
  const refresh=async(generate=true)=>{
   const ticket=++requestVersion.current
   try{
    const data=await alertsRequest(session,forecast&&generate?'POST':'GET',forecast&&generate?{city,locationKey,forecast:{timeZone:zone,hours:forecast.hours}}:undefined,controller.signal,forecast&&generate?undefined:scope)
    if(live&&viewRef.current===view&&ticket===requestVersion.current){setLoaded({view,rows:data.alerts});setFailed(false)}
   }catch{if(live&&viewRef.current===view&&ticket===requestVersion.current){setLoaded({view,rows:[]});setFailed(true)}}
  }
  void refresh()
  // Revalidate only this location's history and current rights while the site is visible.
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh(false)},60000)
  return()=>{live=false;controller.abort();requestVersion.current++;clearInterval(timer)}
 },[id,token,forecast,city,locationKey,revision])
 const rows=loaded.view===view?loaded.rows:[]
 const visible=rows.filter(row=>row.locationKey===locationKey&&row.zone===zone&&(session||guestState[row.key]!=='hidden')&&row.event.end>Date.now())
 const unread=visible.filter(row=>!row.read && (session||guestState[row.key]!=='read')).length
 const mutate=async(method:string,body?:object)=>{
  if(!scope||!session)return
  const ticket=++requestVersion.current,controller=controllerRef.current
  try{const data=await alertsRequest(session,method,body,controller?.signal,scope);if(viewRef.current===view&&!controller?.signal.aborted&&ticket===requestVersion.current){setLoaded({view,rows:data.alerts});setFailed(false)}}catch{if(viewRef.current===view&&!controller?.signal.aborted&&ticket===requestVersion.current){setLoaded({view,rows:[]});setFailed(true)}}
 }
 const format=(row:any,epoch:number)=>new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{timeZone:row.zone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(epoch)
 const explanation=(e:any)=>['walk','garden','sport'].includes(e.kind)?`${e.feelsLikeMin}–${e.feelsLikeMax} °C · ${bg?'вятър':'wind'} ≤ ${e.wind} km/h · ${e.rain} mm (${e.rainProbability}%)`:`${e.min}–${e.max} ${e.kind==='storm'?'WMO':e.kind==='rain'?'mm/h':e.kind==='wind'?'km/h':'°C'}`
 return <div className="weather-notifications"><button type="button" aria-label={bg?'Известия':'Notifications'} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg> {bg?'Известия':'Notifications'}{unread>0&&<span className="notification-count">{unread}</span>}</button>
 {open&&<section className="notification-panel" aria-label={bg?'Метеорологични известия':'Weather notifications'}><h3>{bg?'Известия':'Notifications'}</h3><p>{bg?'Само за текущата прогноза. Проверявай официалните местни предупреждения.':'For the current forecast only. Check official local warnings.'}</p>{failed&&<p role="status">{bg?'Известията временно са недостъпни. Прогнозата остава достъпна.':'Notifications are temporarily unavailable. The forecast remains available.'}</p>}
 {visible.length===0&&<p>{bg?'Няма нови известия.':'No new notifications.'}</p>}
 {visible.length>0&&<button type="button" onClick={()=>session?void mutate('DELETE'):setGuestState(s=>({...s,...Object.fromEntries(rows.map(r=>[r.key,'hidden']))}))}>{bg?'Изчисти известията':'Clear notifications'}</button>}
 <ul>{visible.map(row=><li key={row.key} className={row.read||guestState[row.key]==='read'?'notification-read':''}><strong>{alertNames[bg?'bg':'en'][row.event.kind]}</strong><p>{row.city} · {format(row,row.event.start)} – {format(row,row.event.end)} · {row.zone}</p><p>{explanation(row.event)}</p><small>{['walk','garden','sport'].includes(row.event.kind)?(bg?'Ориентировъчна препоръка от Pro планера':'Indicative Pro planner recommendation'):(bg?'Ориентировъчно предупреждение по прогноза':'Indicative forecast warning')} · Open-Meteo · {bg?'Обновено':'Updated'}: {format(row,row.updated)}</small><div><button type="button" disabled={row.read||guestState[row.key]==='read'} onClick={()=>session?void mutate('PATCH',{readKey:row.key}):setGuestState(s=>({...s,[row.key]:'read'}))}>{bg?'Прочетено':'Mark read'}</button><button type="button" onClick={()=>session?void mutate('PATCH',{hideKey:row.key}):setGuestState(s=>({...s,[row.key]:'hidden'}))}>{bg?'Скрий':'Hide'}</button></div></li>)}</ul></section>}
 </div>
}
