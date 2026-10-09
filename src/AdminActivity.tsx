import { useEffect, useState } from 'react'
import { adminRequest, AdminError } from './admin-client'
import { AdminRegistrationChart } from './AdminRegistrationChart'
const copy = {
 bg:{title:'Потребителска активност',dau:'Активни днес · DAU',wau:'Активни за 7 дни · WAU',mau:'Активни за 30 дни · MAU',forecast_view:'Разгледани прогнози',search_complete:'Завършени търсения',chat_use:'Използване на чатбота',favorite_add:'Добавени любими',favorite_remove:'Премахнати любими',consenting:'Акаунти с дадено съгласие',scope:'Само регистрирани потребители с изрично съгласие. Това не е общият брой посетители. Дните са по UTC; DAU/WAU/MAU включват днес. Броячите на функции са за избрания период.',empty:'Все още няма измерена активност за периода. Не може да се заключи, че сайтът няма посетители.',missing:'Статистиката е недостъпна или миграцията още не е приложена.',loading:'Зареждане на активността…',days:'Активни потребители по дни',details:'Дневни стойности',scroll:'Плъзни за всички дни.',period:'Период',retry:'Опитай отново'},
 en:{title:'User activity',dau:'Active today · DAU',wau:'Active in 7 days · WAU',mau:'Active in 30 days · MAU',forecast_view:'Forecast views',search_complete:'Completed searches',chat_use:'Chatbot usage',favorite_add:'Favorites added',favorite_remove:'Favorites removed',consenting:'Accounts with consent',scope:'Only registered users with explicit consent. These are not total website visitors. Days use UTC; DAU/WAU/MAU include today. Feature counts cover the selected period.',empty:'No measured activity for this period yet. This does not mean the site has no visitors.',missing:'Statistics are unavailable or the migration has not been applied.',loading:'Loading activity…',days:'Daily active users',details:'Daily values',scroll:'Scroll to see all days.',period:'Period',retry:'Retry'},
}
export function AdminActivity({session,lang,summary=false,onDenied}:any) {
 const t=copy[lang as 'bg'|'en'],[period,setPeriod]=useState('30'),[data,setData]=useState<any>(null),[status,setStatus]=useState('loading'),[retry,setRetry]=useState(0)
 useEffect(() => {const controller=new AbortController();setStatus('loading');setData(null)
  void adminRequest(session,'activity',{period},controller.signal).then(result => {
   if(!Array.isArray(result.days) || typeof result.hasData!=='boolean' || !result.actions || !['dau','wau','mau','consenting'].every(k=>Number.isFinite(result[k]))) throw new Error('INVALID_RESPONSE')
   if(!controller.signal.aborted){setData(result);setStatus('ok')}
  }).catch(error=>{if(!controller.signal.aborted){setStatus('error');if(error instanceof AdminError && [401,403].includes(error.status))onDenied?.(error.status)}})
  return ()=>controller.abort()
 },[session.user.id,period,retry])
 return <section className="admin-activity">{summary && <h3>{t.title}</h3>}<p>{t.scope}</p>
  {!summary && <label className="admin-filters">{t.period}<select aria-label={t.period} value={period} onChange={e=>setPeriod(e.target.value)}>{[7,30,90].map(n=><option key={n} value={n}>{n} {lang==='bg'?'дни':'days'}</option>)}</select></label>}
  {status==='loading' ? <p role="status">{t.loading}</p> : status==='error' ? <><p role="status">{t.missing}</p><button onClick={()=>setRetry(n=>n+1)}>{t.retry}</button></> : <>
   <p>{t.consenting}: <strong>{data.consenting}</strong></p>
   {!data.hasData ? <p role="status">{t.empty}</p> : <><div className={summary ? "admin-card activity-summary-values" : "admin-stats"}>{(summary?['dau','mau','forecast_view','chat_use']:['dau','wau','mau','forecast_view','search_complete','chat_use','favorite_add','favorite_remove']).map(key=><section className={summary ? "activity-summary-value" : "admin-card"} key={key}><p>{t[key as keyof typeof t]}</p><strong>{data[key] ?? data.actions[key] ?? 0}</strong></section>)}</div>
   {!summary && <AdminRegistrationChart key={period} registrations={data.days} title={t.days} details={t.details} scrollHint={t.scroll} emptyLabel={t.empty} />}</>}
  </>}
 </section>
}
