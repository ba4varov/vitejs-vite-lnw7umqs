import {useEffect,useState} from 'react'
import type {AuthSession} from './auth-client'
import {alertsRequest,alertNames} from './alerts-client'
export function NotificationSettings({session,lang,onDirtyChange,onBusyChange}:{session:AuthSession;lang:'bg'|'en';onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}) {
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false)
 useEffect(()=>{let live=true;void alertsRequest(session).then(d=>{if(live)setData(d)}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[session.user.id,session.access_token])
 const [draft,setDraft]=useState<string[]>([]),[saved,setSaved]=useState(false)
 useEffect(()=>{if(data)setDraft(data.enabled)},[data])
 const dirty=!!data&&JSON.stringify(draft)!==JSON.stringify(data.enabled)
 useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
 useEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange])
 const save=async(enabled:string[])=>{setBusy(true);setFailed(false);setSaved(false);try{setData(await alertsRequest(session,'PATCH',{enabled}));setSaved(true);window.dispatchEvent(new Event('meteo-alert-settings'))}catch{setFailed(true)}finally{setBusy(false)}}
 return <section className="notification-settings"><h3>{lang==='bg'?'Моите известия':'My notifications'}</h3><p>{lang==='bg'?'Само за разглеждания град, докато използваш сайта. Няма доставка при затворен сайт. Персоналните известия са изключени по подразбиране.':'Only for the current city while using the site. No delivery when the site is closed. Personal notifications are off by default.'}</p>
 {!data&&!failed && <p role="status">{lang==='bg'?'Зареждане…':'Loading…'}</p>}
 {data&&!data.pro && <p>{lang==='bg'?'Персоналните категории изискват текущ Pro план.':'Personal categories require a current Pro plan.'}</p>}
 {failed && <p role="alert">{lang==='bg'?(data?'Известията са недостъпни. Незапазените промени са запазени тук. Опитай отново.':'Метео настройките временно не могат да бъдат заредени. Затвори и опитай отново.'):(data?'Notifications are unavailable. Unsaved changes are kept here. Please retry.':'Weather preferences temporarily cannot be loaded. Close and try again.')}</p>}
 {data && Object.entries(alertNames[lang]).map(([kind,name])=><label key={kind}><input type="checkbox" disabled={busy||(!data.pro&&['walk','garden','sport'].includes(kind))} checked={draft.includes(kind)} onChange={e=>{setSaved(false);setDraft(e.target.checked?[...draft,kind]:draft.filter(k=>k!==kind))}}/>{String(name)}{['walk','garden','sport'].includes(kind)?' · Pro':''}</label>)}
 {saved && <p role="status">{lang==='bg'?'Настройките са запазени.':'Settings saved.'}</p>}
 {data && <button type="button" className="auth-submit" disabled={busy||!dirty} onClick={()=>void save(draft)}>{lang==='bg'?'Запази метео настройките':'Save weather preferences'}</button>}
 {data && <button type="button" disabled={busy} onClick={()=>void save([])}>{lang==='bg'?'Изключи всички':'Disable all'}</button>}
 </section>
}
