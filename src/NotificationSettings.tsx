import {useEffect,useState} from 'react'
import type {AuthSession} from './auth-client'
import {alertsRequest,alertNames} from './alerts-client'
export function NotificationSettings({session,lang}:{session:AuthSession;lang:'bg'|'en'}) {
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false)
 useEffect(()=>{let live=true;void alertsRequest(session).then(d=>{if(live)setData(d)}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[session.user.id,session.access_token])
 const save=async(enabled:string[])=>{setBusy(true);setFailed(false);try{setData(await alertsRequest(session,'PATCH',{enabled}));window.dispatchEvent(new Event('meteo-alert-settings'))}catch{setFailed(true);try{setData(await alertsRequest(session))}catch{setData(null)}}finally{setBusy(false)}}
 return <section className="notification-settings"><h3>{lang==='bg'?'Моите известия':'My notifications'}</h3><p>{lang==='bg'?'Само за разглеждания град, докато използваш сайта. Няма доставка при затворен сайт. Персоналните известия са изключени по подразбиране.':'Only for the current city while using the site. No delivery when the site is closed. Personal notifications are off by default.'}</p>
 {failed && <p role="alert">{lang==='bg'?'Известията са недостъпни. Опитай отново след обновяване.':'Notifications are unavailable. Refresh to retry.'}</p>}
 {data && Object.entries(alertNames[lang]).filter(([kind])=>data.pro||!['walk','garden','sport'].includes(kind)).map(([kind,name])=><label key={kind}><input type="checkbox" disabled={busy} checked={data.enabled.includes(kind)} onChange={e=>void save(e.target.checked?[...data.enabled,kind]:data.enabled.filter((k:string)=>k!==kind))}/>{String(name)}{['walk','garden','sport'].includes(kind)?' · Pro':''}</label>)}
 {data && <button type="button" disabled={busy} onClick={()=>void save([])}>{lang==='bg'?'Изключи всички':'Disable all'}</button>}
 </section>
}
