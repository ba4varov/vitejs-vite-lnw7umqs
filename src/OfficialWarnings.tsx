import { useEffect, useState } from 'react'
import './official-warnings.css'

// Share requests across StrictMode/remounts and city revisits within this document.
const requests = new Map<number, {until:number;promise:Promise<any>}>()
function loadWarnings(id:number) {
 const now=Date.now(), hit=requests.get(id)
 if(hit&&hit.until>now)return hit.promise
 if(requests.size>=100)requests.delete(requests.keys().next().value)
 const entry={until:now+15*60*1000,promise:null as Promise<any>}
 entry.promise=fetch(`/api/alerts?source=nimh&id=${id}`,{signal:AbortSignal.timeout(12000)}).then(async response=>{
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
export function OfficialWarnings({ placeId, city, lang, enabled }: {placeId?:number;city:string;lang:'bg'|'en';enabled:boolean}) {
 const [snapshot,setSnapshot]=useState<any>(null)
 const [clock,setClock]=useState(Date.now())
 useEffect(()=>{
  setSnapshot(null)
  if(!enabled||!placeId)return
  let alive=true
  const load=async()=>{
   try {
    const next=await loadWarnings(placeId)
    if(alive)setSnapshot(next)
   }catch{if(alive)setSnapshot(null)}
  }
  void load()
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void load()},15*60*1000)
  let lastVisible=Date.now()
  const visible=()=>{if(document.visibilityState==='visible'&&Date.now()-lastVisible>=5*60*1000){lastVisible=Date.now();void load()}}
  document.addEventListener('visibilitychange',visible)
  return ()=>{alive=false;clearInterval(interval);document.removeEventListener('visibilitychange',visible)}
 },[placeId,enabled])
 useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(id)},[])
 const bg=lang==='bg', l=labels[lang]
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock)
 const data=enabled&&snapshot&&snapshot.id===placeId&&clock-snapshot.received<20*60*1000?snapshot.data:null
 const days=Array.isArray(data?.days)?data.days.filter((d:any)=>d.date>=today&&d.status==='verified'&&clock-d.checkedAt>=0&&clock-d.checkedAt<20*60*1000):[]
 const warnings=days.flatMap((day:any)=>Array.isArray(day.warnings)?day.warnings.filter((w:any)=>['yellow','orange','red'].includes(w.level)&&w.date===day.date).map((w:any)=>({...w,source:day.source})):[])
 return <section className="official-warnings" aria-labelledby="official-warnings-title">
  <h2 id="official-warnings-title">{bg?'Официални предупреждения · НИМХ':'Official warnings · NIMH'}</h2>
  <p>{city}{data?.municipality&&` · ${bg?'община':'municipality'} ${data.municipality} · ${data.region}`}</p>
  {warnings.map((w:any,i:number)=><article className={`official-warning official-warning-${w.level}`} key={`${w.date}-${w.scope}-${w.kind}-${i}`}>
   <h3>{l[w.level]} · {w.hazards?.map((h:string)=>l[h]||l.official).join(' / ')||l[w.kind]||l.official}</h3>
   <p><strong>{l[w.scope]}: {w.area}</strong></p>
   <p>{bg?'Валидност':'Valid'}: {new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{timeZone:'Europe/Sofia',dateStyle:'long'}).format(new Date(`${w.date}T12:00:00Z`))} · {bg?'календарен ден, Europe/Sofia':'calendar day, Europe/Sofia'}</p>
   <p lang="bg">{w.description}</p>
   {!bg&&<small>Original NIMH text in Bulgarian.</small>}
  </article>)}
  {days.length===2&&warnings.length===0?<p>{bg?'Няма публикувани жълти, оранжеви или червени кодове за проверените дати и обхвати.':'No published yellow, orange or red warnings for the verified dates and areas.'}</p>:days.length<2&&<p role="status">{!placeId? (bg?'Общината не е потвърдена. Изберете населено място от търсенето, за да проверите официалните кодове.':'Municipality is unverified. Select a settlement from search to check official warnings.'):(bg?'Част от официалните данни са недостъпни или непроверени. Това не означава липса на опасност.':'Some official data are unavailable or unverified. This does not mean there is no danger.')}</p>}
  {days.length>0&&<small>{bg?'Проверено':'Checked'}: {new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}).format(Math.min(...days.map((d:any)=>d.checkedAt)))} · Europe/Sofia</small>}
  <p><a href="https://weather.bg/obshtini/" target="_blank" rel="noreferrer">{bg?'Източник: НИМХ · днес и утре':'Source: NIMH · today and tomorrow'}</a> · <a href="https://meteo.bg/" target="_blank" rel="noreferrer">meteo.bg</a></p>
  <small>{bg?'Кодовете за областта и морето са отделни от тези за общината. Общинските текстове са стандартни по праговете на НИМХ.':'District and marine warnings have separate scopes from municipality warnings. Municipality texts use standard NIMH thresholds.'}</small>
 </section>
}
