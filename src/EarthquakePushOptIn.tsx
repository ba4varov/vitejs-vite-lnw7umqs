import {useEffect,useState} from 'react'
import type {AuthSession} from './auth-client'
import type {PushCity} from './push-client'
import {earthquakeConsentRequest,type EarthquakePushConsentSnapshot} from './earthquake-push-client'
import './earthquake-push-opt-in.css'

const sameCity=(a:PushCity,b:EarthquakePushConsentSnapshot['city'])=>
  !!b&&a.latitude===b.latitude&&a.longitude===b.longitude&&a.name===b.name

export function EarthquakePushOptIn({session,lang,cities,onDirtyChange,onBusyChange}:{
  session:AuthSession;lang:'bg'|'en';cities:PushCity[];
  onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void;
}) {
  const bg=lang==='bg'
  const [snapshot,setSnapshot]=useState<EarthquakePushConsentSnapshot|null>(null)
  const [enabled,setEnabled]=useState(false)
  const [cityIndex,setCityIndex]=useState(0)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState(false)
  useEffect(()=>{
    let live=true
    setSnapshot(null);setMessage('');setError(false)
    void earthquakeConsentRequest(session,'GET',undefined,()=>live)
      .then(result=>{
        if(!live)return
        setSnapshot(result);setEnabled(result.enabled)
        const index=cities.findIndex(city=>sameCity(city,result.city))
        setCityIndex(index>=0?index:0)
      }).catch(()=>{
        if(live)setError(true)
      })
    return()=>{live=false}
  },[session.user.id])
  useEffect(()=>{
    if(!snapshot?.enabled||!cities.length)return
    const index=cities.findIndex(city=>sameCity(city,snapshot.city))
    if(index>=0)setCityIndex(index)
  },[snapshot?.city?.latitude,snapshot?.city?.longitude,snapshot?.city?.name,cities])
  const selected=cities[cityIndex]
  const changed=!!snapshot&&(enabled!==snapshot.enabled||
    (enabled&&!!selected&&!sameCity(selected,snapshot.city)))
  useEffect(()=>{onDirtyChange?.(changed)},[changed,onDirtyChange])
  useEffect(()=>{onBusyChange?.(busy)},[busy,onBusyChange])
  const save=async()=>{
    if(busy||!snapshot||!changed||enabled&&(!selected||cityIndex<0||cityIndex>4))return
    setBusy(true);setMessage('');setError(false)
    try {
      const result=await earthquakeConsentRequest(session,'PUT',
        enabled?{enabled:true,cityIndex}:{enabled:false})
      setSnapshot(result);setEnabled(result.enabled)
      setMessage(bg?
        result.enabled?'Съгласието е запазено. Автоматичните Push известия все още не се изпращат.':
          'Съгласието за земетресения е оттеглено.':
        result.enabled?'Consent saved. Automatic earthquake Push delivery is still disabled.':
          'Earthquake consent has been withdrawn.')
    }catch{
      setError(true)
      setMessage(bg?'Промяната не е потвърдена. Проверете по-късно, преди да опитате отново.':
        'The change was not confirmed. Check the status before trying again.')
    }finally{setBusy(false)}
  }
  return <div className="earthquake-optin" aria-labelledby="earthquake-optin-heading">
    <h4 id="earthquake-optin-heading">
      {bg?'Push за земетресения – подготовка':'Earthquake Push – preparation'}
    </h4>
    <p>{bg?
      'До 300 км от избран запазен град, магнитуд M 3.0 или повече. Само за вече регистрирани земетресения, не ранно предупреждение.':
      'Within 300 km of a saved city, magnitude M 3.0 or greater. Notifications concern recorded earthquakes, not early warning.'}</p>
    <p className="earthquake-optin-disclosure">
      {bg?
        'Важно: дори при запазено съгласие автоматичната доставка е ИЗКЛЮЧЕНА, докато не приключат отделните проверки и одобрението. Не се иска ново разрешение от браузъра.':
        'Important: automatic delivery is DISABLED, even with saved consent, until separately reviewed and approved. No browser permission is requested here.'}
    </p>
    {error&&<p role="status" className="earthquake-optin-error">
      {message||(bg?'Настройките не могат да бъдат проверени.':'Cannot verify these settings.')}
    </p>}
    {!error&&message&&<p role="status">{message}</p>}
    {!snapshot&&!error&&<p role="status">{bg?'Проверка на съгласието…':'Checking consent…'}</p>}
    {snapshot&&<>
      <label className="earthquake-optin-toggle">
        <input type="checkbox" checked={enabled} disabled={busy||enabled===false&&cities.length===0}
          onChange={e=>setEnabled(e.target.checked)}/>
        {bg?'Желая известия за земетресения за избрания град':
          'I want earthquake notifications for the selected city'}
      </label>
      {enabled&&<label className="earthquake-optin-select">
        {bg?'Град за земетресенията':'City for earthquake monitoring'}
        <select value={cityIndex} disabled={busy||!cities.length}
          onChange={e=>setCityIndex(Number(e.target.value))}>
          {cities.map((city,i)=><option key={`${city.latitude}:${city.longitude}`} value={i}>
            {city.name}
          </option>)}
        </select>
      </label>}
      {!cities.length&&<p>{bg?
        'Добавете град в основните Push настройки по-долу и го запазете, преди да изберете известия за земетресения.':
        'Add and save a city in the main Push preferences below before selecting earthquake notifications.'}</p>}
      <p>{bg?'Записани устройства':'Registered devices'}: {snapshot.deviceCount}.
        {' '}{bg?'За бъдеща доставка ще са нужни регистрирано устройство и разрешени известия.':
          'A registered device and notification permission will be required before future delivery.'}</p>
      <button type="button" onClick={()=>void save()}
        disabled={busy||!changed||(enabled&&!selected)}>
        {busy?(bg?'Запазване…':'Saving…'):(bg?'Запази съгласието':'Save consent')}
      </button>
      {snapshot.enabled&&snapshot.optedInAt&&<p className="earthquake-optin-date">
        {bg?'Съгласието е запазено на':'Consent saved on'}{' '}
        {new Date(snapshot.optedInAt).toLocaleString(bg?'bg-BG':'en-GB')}
      </p>}
    </>}
  </div>
}
