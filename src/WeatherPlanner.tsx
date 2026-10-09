import { useEffect, useRef, useState } from 'react'
import { restoreSession, type AuthSession } from './auth-client'

export function WeatherPlanner({lang, session, forecast, city}: {lang: string; session: AuthSession | null; forecast: any; city: string}) {
  const bg=lang==='bg'
  const [access,setAccess]=useState('loading'),[activity,setActivity]=useState('walk'),[result,setResult]=useState<any>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false)
  const version=useRef(0), request=useRef<AbortController | null>(null)
  const token=session?.access_token
  useEffect(()=>{
    version.current++; let cancelled=false; const controller=new AbortController()
    request.current?.abort();setResult(null);setFailed(false);setBusy(false);setAccess(session?'loading':'guest')
    if(session) void fetch('/api/profile',{headers:{Authorization:`Bearer ${session.access_token}`},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}).then(async response=>{
      if(!response.ok) throw Error('PROFILE_FAILED')
      const profile=await response.json()
      if(!cancelled) setAccess(profile.plan==='pro' && profile.permissions?.includes('planner:advanced')?'pro':'free')
    }).catch(()=>{if(!cancelled && !controller.signal.aborted) setAccess('unavailable')})
    return ()=>{cancelled=true;version.current++;controller.abort();request.current?.abort()}
  },[token])
  useEffect(()=>{version.current++;request.current?.abort();setResult(null);setFailed(false);setBusy(false)},[forecast,activity])
  const calculate=async()=>{
    if(busy || access!=='pro') return
    request.current?.abort();const controller=new AbortController();request.current=controller
    const revision=version.current
    setBusy(true);setFailed(false);setResult(null)
    try {
      const current=await restoreSession()
      if(!current || current.user.id!==session?.user.id) throw Error('SESSION_CHANGED')
      if(version.current!==revision) return
      const response=await fetch('/api/planner',{method:'POST',headers:{Authorization:`Bearer ${current.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({...forecast,activity}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])})
      if(version.current!==revision) return
      if(response.status===403 || response.status===401) {setAccess(response.status===403?'free':'guest');return}
      if(!response.ok) throw Error('PLANNER_FAILED')
      const data=await response.json()
      if(version.current===revision) setResult(data)
    } catch {if(version.current===revision && !controller.signal.aborted) setFailed(true)}
    finally {if(version.current===revision) setBusy(false)}
  }
  const format=(epoch:number)=>new Intl.DateTimeFormat(bg?'bg-BG':'en-GB',{timeZone:result.timeZone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(epoch)
  return <section className="card weather-planner" aria-labelledby="planner-title">
    <h2 id="planner-title">{bg?'Моят метео планер':'My Weather Planner'} <span className="planner-badge">Pro · Beta</span></h2>
    <details className="planner-plans"><summary>{bg?'Планове':'Plans'}</summary>
      <div className="planner-plan-grid"><div><h3>Free</h3><p>{bg?'Всички досегашни прогнози, графики, любими градове и Боби остават при същите условия, включително за гости.':'All existing forecasts, charts, favorites and Bobby remain available under the same conditions, including for guests.'}</p></div>
      <div><h3>Pro</h3><p>{bg?'Всичко от Free и метео планер с до три подходящи интервала за разходка, градинарство или спорт на открито.':'Everything in Free plus a weather planner with up to three suitable windows for walking, gardening or outdoor sport.'}</p></div></div>
      <p>{bg?'Pro функциите са в тестово развитие и се активират административно.':'Pro features are in testing and are activated administratively.'}</p>
    </details>
    {access==='loading' && <p role="status">{bg?'Проверка на достъпа…':'Checking access…'}</p>}
    {access==='unavailable' && <p role="alert">{bg?'Проверка на плана е недостъпна. Обнови страницата, за да опиташ отново.':'Plan verification is unavailable. Refresh the page to retry.'}</p>}
    {['guest','free'].includes(access) && <p>{bg?'Планерът подбира удобни двучасови интервали от следващите 72 часа. Достъпен е при административно активиран Pro план.':'The planner selects convenient two-hour windows in the next 72 hours. It requires administratively activated Pro access.'}</p>}
    {access==='guest' && <p><a href="#planner-auth" onClick={()=>document.querySelector<HTMLButtonElement>('.auth-nav button')?.click()}>{bg?'Регистрирай се или влез от бутоните в горната част на страницата.':'Register or sign in using the buttons at the top of the page.'}</a></p>}
    {access==='pro' && <>
      <p>{city} · {forecast?.timeZone || (bg?'Няма часова зона':'No time zone')}</p>
      <div className="planner-controls"><label>{bg?'Дейност':'Activity'}<select value={activity} onChange={e=>setActivity(e.target.value)}><option value="walk">{bg?'Разходка':'Walk'}</option><option value="garden">{bg?'Работа в градината':'Gardening'}</option><option value="sport">{bg?'Спорт на открито':'Outdoor sport'}</option></select></label>
      <button type="button" disabled={busy || !forecast} onClick={()=>void calculate()}>{busy?(bg?'Изчисляване…':'Calculating…'):(bg?'Намери подходящи интервали':'Find suitable windows')}</button></div>
      {!forecast && <p>{bg?'Почасовите данни или часовата зона липсват. Обнови прогнозата.':'Hourly data or the time zone is missing. Refresh the forecast.'}</p>}
      {failed && <p role="alert">{bg?'Заявката е неуспешна. Опитай отново.':'The request failed. Please try again.'}</p>}
      {result && <div aria-live="polite">{result.status==='insufficient'?<p>{bg?'Няма достатъчно почасови данни за препоръка.':'There is insufficient hourly data for a recommendation.'}</p>:result.status==='unsuitable'?<p>{bg?'Не намерихме подходящ двучасов интервал за тази дейност.':'No suitable two-hour window was found for this activity.'}</p>:<ol className="planner-windows">{result.windows.map((w:any)=><li key={w.start}><strong>{format(w.start)} – {format(w.end)}</strong><p>{bg?'Подходяща усещана температура':'Suitable feels-like temperature'}: {w.feelsLikeMin}–{w.feelsLikeMax} °C · {bg?'вятър до':'wind up to'} {w.wind} km/h · {bg?'валеж до':'rain up to'} {w.rain} mm ({w.rainProbability}%). {bg?'Без неблагоприятни метеорологични кодове.':'No adverse weather codes.'}</p></li>)}</ol>}</div>}
    </>}
    <p className="planner-note">{bg?'Ориентировъчни препоръки, без гаранция за безопасност. Използват заредената прогноза, а не независимо потвърдени данни. Проверявай местните предупреждения.':'Recommendations are indicative and do not guarantee safety. They use the loaded forecast, not independently verified data. Check local warnings.'}</p>
  </section>
}
