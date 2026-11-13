import { useEffect, useState } from 'react'
import './official-warnings.css'

const MAX_CONFIRMED_AGE_MS = 60 * 60 * 1000
const FRESH_CONFIRMED_AGE_MS = 20 * 60 * 1000

function recentVerifiedDay(day:any, now:number) {
 return day?.status==='verified' && typeof day.checkedAt==='number' && Number.isFinite(day.checkedAt)
  && now>=day.checkedAt && now-day.checkedAt<MAX_CONFIRMED_AGE_MS
}

// A failed refresh is not a verified "green" day. Keep only a recent, same-place
// verified day until NIMH confirms a replacement or the confirmation expires.
function mergeVerifiedDays(previous:any, next:any, identity:string, now:number) {
 const incoming={...next,identity}
 if(!previous || previous.identity!==identity)return incoming
 if(next.data?.status==='unavailable')return previous
 if(next.data?.status!=='resolved' || !Array.isArray(next.data.days) || !Array.isArray(previous.data?.days))return incoming
 const previousByDate=new Map<string,any>(previous.data.days.map((day:any)=>[day.date,day]))
 const days=next.data.days.map((day:any)=>{
  if(day?.status==='verified')return day
  const earlier=previousByDate.get(day?.date)
  return day?.status==='unavailable' && recentVerifiedDay(earlier,now) ? earlier : day
 })
 const retained=days.some((day:any,i:number)=>day!==next.data.days[i])
 return {...incoming,data:{...next.data,...(retained && previous.data?.coverage==='municipality'?{coverage:'municipality',municipality:previous.data.municipality}:{}),days}}
}

// Share requests across StrictMode/remounts and city revisits within this document.
const requests = new Map<string, {until:number;promise:Promise<any>}>()
function loadWarnings(id:string) {
 const now=Date.now(), hit=requests.get(id)
 if(hit&&hit.until>now)return hit.promise
 if(requests.size>=100)requests.delete(requests.keys().next().value)
 const entry={until:now+15*60*1000,promise:null as Promise<any>}
 entry.promise=fetch(`/api/alerts?source=nimh&${id}`,{signal:AbortSignal.timeout(12000)}).then(async response=>{
  if(!response.ok)throw Error('Unavailable')
  return {id,data:await response.json(),received:Date.now()}
 }).catch(error=>{entry.until=now+60000;throw error})
 requests.set(id,entry)
 return entry.promise
}

const labels = {
 bg: { yellow:'Жълт код', orange:'Оранжев код', red:'Червен код', heat:'Висока температура', cold:'Ниска температура', wind:'Вятър', rain:'Дъжд', snow:'Сняг / поледица', storm:'Гръмотевична активност', fog:'Мъгла', waves:'Силно вълнение', official:'Опасно време', municipality:'Община', district:'Област', marine:'Морско предупреждение' },
 en: { yellow:'Yellow warning', orange:'Orange warning', red:'Red warning', heat:'High temperature', cold:'Low temperature', wind:'Wind', rain:'Rain', snow:'Snow / ice', storm:'Thunderstorms', fog:'Fog', waves:'High waves', official:'Severe weather', municipality:'Municipality', district:'District', marine:'Marine warning' },
}
export function OfficialWarnings({ placeId, area, gpsIssue, gpsRestored, locationKey, city, countryCode, lang, enabled }: {gpsRestored?:boolean;gpsIssue?:string | null;placeId?:number;area?:{region:string;municipality?:string};locationKey:string;city:string;countryCode?:string;lang:'bg'|'en';enabled:boolean}) {
 const isBulgarianPlace=!countryCode||countryCode.toUpperCase()==='BG'
 const query=isBulgarianPlace?(area?new URLSearchParams(area).toString():placeId?`id=${placeId}`:''):''
 const identity=`${locationKey}:${query}`
 const [snapshot,setSnapshot]=useState<any>(null)
 const [refreshFailed,setRefreshFailed]=useState(false)
 const [clock,setClock]=useState(Date.now())
 useEffect(()=>{
  setSnapshot(null)
  setRefreshFailed(false)
  if(!enabled||!query)return
  let alive=true
  const load=async()=>{
   try {
    const next=await loadWarnings(query)
    if(!alive)return
    setRefreshFailed(next.data?.status==='unavailable' || (Array.isArray(next.data?.days) && next.data.days.some((day:any)=>day.status==='unavailable')))
    setSnapshot(previous=>mergeVerifiedDays(previous,next,identity,Date.now()))
    setClock(Date.now())
   }catch{
    if(alive){setRefreshFailed(true);setClock(Date.now())}
   }
  }
  void load()
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void load()},15*60*1000)
  let lastVisible=Date.now()
  const visible=()=>{if(document.visibilityState==='visible'&&Date.now()-lastVisible>=5*60*1000){lastVisible=Date.now();void load()}}
  document.addEventListener('visibilitychange',visible)
  return ()=>{alive=false;clearInterval(interval);document.removeEventListener('visibilitychange',visible)}
 },[identity,enabled])
 useEffect(()=>{
  const tick=()=>setClock(Date.now())
  const id=setInterval(tick,60000)
  document.addEventListener('visibilitychange',tick)
  return()=>{clearInterval(id);document.removeEventListener('visibilitychange',tick)}
 },[])
 const bg=lang==='bg', l=labels[lang]
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock)
 const data=enabled&&snapshot?.identity===identity?snapshot.data:null
 const days=Array.isArray(data?.days)?data.days.filter((day:any)=>day.date>=today&&recentVerifiedDay(day,clock)):[]
 const warnings=days.flatMap((day:any)=>Array.isArray(day.warnings)?day.warnings.filter((w:any)=>['yellow','orange','red'].includes(w.level)&&w.date===day.date).map((w:any)=>({...w,source:day.source})):[])
 const showingOlderConfirmation=refreshFailed||days.some((day:any)=>clock-day.checkedAt>=FRESH_CONFIRMED_AGE_MS)
 if(!warnings.length)return null
 return <section className="official-warnings" aria-labelledby="official-warnings-title">
  <h2 id="official-warnings-title">{bg?'Официални предупреждения · НИМХ':'Official warnings · NIMH'}</h2>
  <p>{city}{data?.municipality&&` · ${bg?'община':'municipality'} ${data.municipality}`}{data?.region&&` · ${data.region}`}</p>
  {showingOlderConfirmation&&<p role="status">{bg?'Няма ново потвърждение от НИМХ. Показваме последните потвърдени кодове, които може да са остарели.':'No new NIMH confirmation. Showing the last verified warnings, which may be outdated.'}</p>}
  {gpsRestored&&<p role="status">{bg?'Показваме последното запазено GPS място, а не ново определено местоположение. Използвайте „Моето местоположение“ за нова GPS проверка.':'Showing the last saved GPS place, not a new location fix. Use My location for a fresh GPS check.'}</p>}
  {gpsIssue&&<p role="status">{({
   pending: bg?'Проверяваме административната област за GPS местоположението.':'Checking the administrative district for your GPS location.',
   accuracy: bg?'GPS точността е недостатъчна за официалните кодове (нужна е до 1 км за област и до 100 м за община). Изберете населено място или опитайте GPS отново.':'GPS accuracy is insufficient for official warnings (1 km for district, 100 m for municipality). Select a settlement or retry GPS.',
   administrative: bg?'Липсват потвърдени административни данни за GPS местоположението. Изберете населено място. Това не означава липса на опасност.':'Confirmed administrative data are missing for the GPS location. Select a settlement. This does not mean there is no danger.',
   unavailable: bg?'Услугата за определяне на GPS областта е недостъпна. Опитайте отново или изберете населено място. Това не означава липса на опасност.':'The GPS district service is unavailable. Retry or select a settlement. This does not mean there is no danger.'
  } as Record<string,string>)[gpsIssue]}</p>}
  {(data?.coverage==='district'||days.some((d:any)=>d.coverage==='district'))&&<p role="status">{bg?'Потвърдена е само областта. Общинският код не е проверен.':'Only the district is confirmed. Municipality warnings are unverified.'}</p>}
  {warnings.filter(w=>w.scope!=='marine').map((w:any,i:number)=><article className={`official-warning official-warning-${w.level}`} key={`${w.date}-${w.scope}-${w.kind}-${i}`}>
   <h3>{l[w.level]} · {w.hazards?.map((h:string)=>l[h]||l.official).join(' / ')||l[w.kind]||l.official}</h3>
   <p><strong>{l[w.scope]}: {w.area}</strong></p>
   <p>{bg?'Валидност':'Valid'}: {new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{timeZone:'Europe/Sofia',dateStyle:'long'}).format(new Date(`${w.date}T12:00:00Z`))} · {bg?'календарен ден, Europe/Sofia':'calendar day, Europe/Sofia'}</p>
   <p lang="bg">{w.description}</p>
   {!bg&&<small>Original NIMH text in Bulgarian.</small>}
  </article>)}
  {warnings.some(w=>w.scope==='marine')&&<details className="marine-context"><summary>{bg?'Отделно: предупреждения за морския район (не за населеното място)':'Separate: marine-area warnings (not for the settlement)'}</summary>{warnings.filter(w=>w.scope==='marine').map((w:any,i:number)=><div key={i}><p><strong>{l[w.level]} · {w.area} · {w.date}</strong></p><p lang="bg">{w.description}</p></div>)}</details>}
  {days.length>0&&<small>{bg?'Проверено':'Checked'}: {new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}).format(Math.min(...days.map((d:any)=>d.checkedAt)))} · Europe/Sofia</small>}
  <p><a href="https://weather.bg/obshtini/" target="_blank" rel="noreferrer">{bg?'Източник: НИМХ · днес и утре':'Source: NIMH · today and tomorrow'}</a> · <a href="https://meteo.bg/" target="_blank" rel="noreferrer">meteo.bg</a></p>
  <small>{bg?'Кодовете за областта и морето са отделни от тези за общината. Общинските текстове са стандартни по праговете на НИМХ.':'District and marine warnings have separate scopes from municipality warnings. Municipality texts use standard NIMH thresholds.'}</small>
 </section>
}
