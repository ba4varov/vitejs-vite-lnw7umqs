import {useEffect,useRef,useState} from 'react'
import type {AuthSession} from './auth-client'
import {pushRequest,type PushSnapshot,type PushPreferences,type PushCity} from './push-client'
import {pushSupport,preparePushWorker,enrollPush,removePushDevice} from './push-browser.js'
import {alertNames} from './alerts-client'
const personal=['walk','garden','sport']
const presets:PushCity[]=[{name:'София',latitude:42.6977,longitude:23.3219,zone:'Europe/Sofia'},{name:'Пловдив',latitude:42.1354,longitude:24.7453,zone:'Europe/Sofia'},{name:'Варна',latitude:43.2141,longitude:27.9147,zone:'Europe/Sofia'},{name:'Бургас',latitude:42.5048,longitude:27.4626,zone:'Europe/Sofia'}]
export function PushSettings({session,lang,onDirtyChange,onBusyChange}:{session:AuthSession;lang:'bg'|'en';onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}) {
 const bg=lang==='bg',support=pushSupport()
 const [data,setData]=useState<PushSnapshot|null>(null),[draft,setDraft]=useState<PushPreferences>({enabled:false,cities:[],categories:[]}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[worker,setWorker]=useState<ServiceWorkerRegistration|null>(null)
 const [label,setLabel]=useState(''),[city,setCity]=useState<PushCity>({name:'',latitude:0,longitude:0,zone:'Europe/Sofia'})
 const live=useRef(true)
 const apply=(d:PushSnapshot)=>{if(live.current){setData(d);setDraft(d.preferences)}}
 useEffect(()=>{live.current=true;void pushRequest(session).then(apply).catch(()=>{if(live.current)setMessage(bg?'Push настройките временно не могат да бъдат заредени. Затвори и опитай отново.':'Push preferences temporarily cannot be loaded. Close and try again.')});return()=>{live.current=false}},[session.user.id,session.access_token])
 useEffect(()=>{let active=true;if(support==='supported')void preparePushWorker().then(r=>{if(active)setWorker(r)}).catch(()=>{if(active)setMessage(bg?'Service Worker е недостъпен.':'Service Worker is unavailable.')});return()=>{active=false}},[support])
 const fail=(error:any)=>setMessage(error.message==='KEY_ROTATION_REQUIRED'?(bg?'Ключът е обновен. Отпиши това устройство от списъка или изчисти известията за сайта в браузъра, после го регистрирай отново.':'The key has changed. Remove this device from the list or reset this site’s notifications in browser settings, then register it again.'):error.message==='DENIED'?(bg?'Разрешението е отказано. Можеш да го промениш от настройките на браузъра.':'Permission denied. Change it in browser settings.'):error.message==='DISMISSED'?(bg?'Разрешението не е дадено. Няма регистрирано устройство.':'Permission was not granted. No device registered.'):(bg?'Промяната не е потвърдена. Обнови и опитай отново.':'Change was not confirmed. Refresh and retry.'))
 const save=async(p:PushPreferences)=>{setBusy(true);setMessage('');try{apply(await pushRequest(session,'PATCH',p));setMessage(bg?'Push настройките са запазени. Доставката остава изключена.':'Push preferences saved. Delivery remains disabled.')}catch(e){fail(e)}finally{if(live.current)setBusy(false)}}
 const subscribe=()=>{
  if(!worker||!data?.publicKey)return
  setBusy(true);setMessage('')
  // Permission request occurs synchronously in enrollPush, directly from this click.
  void enrollPush({registration:worker,key:data.publicKey,persist:async(subscription:object)=>{
   const result=await pushRequest(session,'POST',{subscription,label:label.trim()});apply(result);return result
  }}).then(()=>{if(live.current)setMessage(bg?'Устройството е записано за подготовка. Автоматична доставка няма.':'Device prepared. Automatic delivery is disabled.')}).catch(fail).finally(()=>{if(live.current)setBusy(false)})
 }
 const remove=async(device:any)=>{setBusy(true);setMessage('');try{await removePushDevice({registration:worker,device,persist:async(id:string)=>{const result=await pushRequest(session,'DELETE',{id});apply(result);return result}})}catch(e){fail(e)}finally{if(live.current)setBusy(false)}}
 const dirty=!!data&&JSON.stringify(draft)!==JSON.stringify(data.preferences)
 const unsavedInputs=Boolean(city.name.trim() || (label.trim() && !data?.devices.some(device=>device.label===label.trim())))
 useEffect(()=>{onDirtyChange?.(dirty||unsavedInputs)},[dirty,unsavedInputs,onDirtyChange])
 useEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange])
 const add=(c:PushCity)=>{
  if(!c.name.trim()||!Number.isFinite(c.latitude)||Math.abs(c.latitude)>90||!Number.isFinite(c.longitude)||Math.abs(c.longitude)>180||draft.cities.length>=5)return false
  try{new Intl.DateTimeFormat('en',{timeZone:c.zone}).format(0)}catch{return false}
  if(draft.cities.some(x=>x.latitude===c.latitude&&x.longitude===c.longitude))return false
  setDraft({...draft,cities:[...draft.cities,{...c,name:c.name.trim()}]})
  return true
 }
 return <section className="push-settings" aria-label={bg?'Push известия':'Push notifications'}>
  <h3>{bg?'Push известия при затворен сайт':'Push notifications when the site is closed'}</h3>
  <p>{bg?'Подготовка: автоматичната доставка е изключена. Тези настройки са независими от камбанката и съгласието за аналитика.':'Preparation: automatic delivery is disabled. These preferences are independent of the bell and analytics consent.'}</p>
  <p>{support==='ios-install'?(bg?'За iPhone/iPad: iOS 16.4 или по-нова версия → Добави към началния екран → отвори приложението от иконата.':'For iPhone/iPad: iOS 16.4 or later → Add to Home Screen → open from the icon.'):support==='unsupported'?(bg?'Този браузър не поддържа Web Push. Нужни са HTTPS и съвместим браузър.':'This browser does not support Web Push. HTTPS and a compatible browser are required.'):(bg?'Поддържан браузър. Разрешението се иска само с бутона за регистрация.':'Supported browser. Permission is requested only by the registration button.')}</p>
  {!data&&!message&&<p role="status">{bg?'Зареждане на Push настройките…':'Loading Push preferences…'}</p>}
  {message&&<p role="status">{message}</p>}
  {support==='supported'&&Notification.permission==='denied'&&<p>{bg?'Разрешението е отказано. За ново включване промени настройките за известия на този сайт в браузъра.':'Permission is denied. To enable notifications again, change this site’s notification settings in your browser.'}</p>}
  {data&&<>
   <fieldset disabled={busy}><legend>{bg?'Градове и категории за бъдеща доставка':'Cities and categories for future delivery'}</legend>
    <p>{bg?'До 5 града. Предупрежденията за опасно време са безплатни и ориентировъчни по прогноза. Персоналните препоръки изискват текущ Pro достъп.':'Up to 5 cities. Dangerous weather forecast warnings are free and indicative. Personal recommendations require current Pro access.'}</p>
    <label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>{bg?'Следи избраните градове и категории':'Monitor selected cities and categories'}</label>
    {Object.entries(alertNames[lang]).map(([kind,name])=><label key={kind}><input type="checkbox" disabled={personal.includes(kind)&&!data.pro} checked={draft.categories.includes(kind)} onChange={e=>setDraft({...draft,categories:e.target.checked?[...draft.categories,kind]:draft.categories.filter(k=>k!==kind)})}/>{String(name)}{personal.includes(kind)?' · Pro':''}</label>)}
    <div className="push-presets">{presets.map(c=><button type="button" key={c.name} onClick={()=>add(c)}>{bg?'Добави ':'Add '}{c.name}</button>)}</div>
    <ul>{draft.cities.map(c=><li key={`${c.latitude}:${c.longitude}`}>{c.name} ({c.zone}) <button type="button" onClick={()=>setDraft({...draft,cities:draft.cities.filter(x=>x!==c)})}>{bg?'Премахни град':'Remove city'}</button></li>)}</ul>
    <details><summary>{bg?'Друг град по координати':'Another city by coordinates'}</summary>
     <label>{bg?'Име на град':'City name'}<input value={city.name} maxLength={100} onChange={e=>setCity({...city,name:e.target.value})}/></label>
     <label>{bg?'Географска ширина':'Latitude'}<input type="number" min={-90} max={90} step="any" value={city.latitude} onChange={e=>setCity({...city,latitude:e.target.value===''?NaN:Number(e.target.value)})}/></label>
     <label>{bg?'Географска дължина':'Longitude'}<input type="number" min={-180} max={180} step="any" value={city.longitude} onChange={e=>setCity({...city,longitude:e.target.value===''?NaN:Number(e.target.value)})}/></label>
     <label>{bg?'Часова зона (IANA)':'Time zone (IANA)'}<input value={city.zone} maxLength={64} onChange={e=>setCity({...city,zone:e.target.value})}/></label>
     <button type="button" onClick={()=>{if(add(city))setCity({name:'',latitude:0,longitude:0,zone:'Europe/Sofia'})}}>{bg?'Добави град':'Add city'}</button>
    </details>
    <button type="button" disabled={draft.enabled&&(!draft.cities.length||!draft.categories.length)} onClick={()=>void save({...draft,categories:data.pro?draft.categories:draft.categories.filter(k=>!personal.includes(k))})}>{bg?'Запази push настройките':'Save push preferences'}</button>
   </fieldset>
   <button type="button" disabled={busy} onClick={()=>void save({...data.preferences,enabled:false,categories:data.pro?data.preferences.categories:data.preferences.categories.filter(k=>!personal.includes(k))})}>{bg?'Спри всички push известия':'Stop all push notifications'}</button>
   <h4>{bg?'Моите устройства':'My devices'}</h4>
   {!data.devices.length&&<p>{bg?'Няма регистрирани устройства.':'No registered devices.'}</p>}
   <ul>{data.devices.map(d=><li key={d.id}>{d.label} <button type="button" disabled={busy} onClick={()=>void remove(d)}>{bg?'Отпиши устройство':'Unsubscribe device'}</button></li>)}</ul>
   <label>{bg?'Име на това устройство':'Name of this device'}<input value={label} maxLength={80} disabled={busy} onChange={e=>setLabel(e.target.value)}/></label>
   {!data.registrationEnabled&&<p>{bg?'Регистрацията на устройства е неактивна до ръчно конфигуриране и одобрение.':'Device registration is inactive pending manual configuration and approval.'}</p>}
   <button type="button" disabled={busy||dirty||!worker||support!=='supported'||!data.registrationEnabled||!data.preferences.enabled||!label.trim()||!data.preferences.cities.length||!data.preferences.categories.length||Notification.permission==='denied'} onClick={subscribe}>{bg?'Разреши и регистрирай това устройство':'Allow and register this device'}</button>
  </>}
 </section>
}
