export function pushSupport(scope=window) {
 const n=scope.navigator
 const ios=/iPad|iPhone|iPod/.test(n.userAgent)||(/Macintosh/.test(n.userAgent)&&n.maxTouchPoints>1)
 if(ios && !scope.matchMedia('(display-mode: standalone)').matches && !n.standalone)return 'ios-install'
 return scope.isSecureContext && 'serviceWorker' in n && 'PushManager' in scope && 'Notification' in scope?'supported':'unsupported'
}
export async function preparePushWorker(scope=window) {
 if(pushSupport(scope)!=='supported')throw Error('UNSUPPORTED')
 return scope.navigator.serviceWorker.register('/push-sw.js',{scope:'/',updateViaCache:'none'})
}
export function vapidBytes(key) {
 const text=atob(key.replace(/-/g,'+').replace(/_/g,'/'))
 const bytes=Uint8Array.from(text,c=>c.charCodeAt(0))
 if(bytes.length!==65||bytes[0]!==4)throw Error('INVALID_PUBLIC_KEY')
 return bytes
}
export async function enrollPush({scope=window,registration,key,persist}) {
 // Called directly by the click handler, before any await loses iOS activation.
 const permission=await scope.Notification.requestPermission()
 if(permission!=='granted')throw Error(permission==='denied'?'DENIED':'DISMISSED')
 const existing=await registration.pushManager.getSubscription()
 const expected=vapidBytes(key)
 if(existing) {
  const actual=new Uint8Array(existing.options?.applicationServerKey || [])
  // Never relabel a subscription bound to the old VAPID key as a new one.
  if(actual.length!==expected.length || actual.some((byte,i)=>byte!==expected[i]))throw Error('KEY_ROTATION_REQUIRED')
 }
 const subscription=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:expected})
 try {return await persist(subscription.toJSON())}
 catch(error) {if(!existing)await subscription.unsubscribe().catch(()=>{});throw error}
}
export async function removePushDevice({registration,device,persist}) {
 // Remove server authority first. A network failure never falsely reports success.
 const data=await persist(device.id)
 const sub=await registration?.pushManager.getSubscription()
 if(sub) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint))
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
  if(fingerprint===device.fingerprint)await sub.unsubscribe()
 }
 return data
}

// Read only: never register a worker, request permission, serialize or mutate a subscription.
export async function checkPushRegistration({scope=window,device,key}) {
 try {
  if(!key)return 'missing-public-key'
  let expected
  try {expected=vapidBytes(key)}catch {return 'missing-public-key'}
  if(!scope.isSecureContext || !scope.navigator.serviceWorker)return 'worker-unavailable'
  let registration
  try {registration=await scope.navigator.serviceWorker.getRegistration('/')}catch {return 'worker-unavailable'}
  const expectedWorker=new URL('/push-sw.js',scope.location.origin).href
  if(!registration?.active || registration.active.scriptURL!==expectedWorker || registration.scope!==new URL('/',scope.location.origin).href)return 'worker-unavailable'
  if(typeof registration.pushManager?.getSubscription!=='function')return 'worker-unavailable'
  const subscription=await registration.pushManager.getSubscription()
  if(!subscription)return 'missing-subscription'
  const actual=new Uint8Array(subscription.options?.applicationServerKey || [])
  if(actual.length!==expected.length || actual.some((byte,i)=>byte!==expected[i]))return 'vapid-mismatch'
  if(typeof subscription.endpoint!=='string' || !subscription.endpoint || !/^[a-f0-9]{64}$/.test(device.fingerprint))return 'unavailable'
  const digest=await scope.crypto.subtle.digest('SHA-256',new TextEncoder().encode(subscription.endpoint))
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
  return fingerprint===device.fingerprint?'match':'device-mismatch'
 } catch {
  // Browser errors may contain sensitive values. Return only a fixed status.
  return 'unavailable'
 }
}
export const pushRegistrationMessages={
 bg:{'missing-public-key':'Публичният VAPID ключ за проверката липсва или е невалиден.', 'worker-unavailable':'Service Worker за Meteo Pulse е недостъпен. Опитай отново.', match:'Регистрацията съвпада с това устройство и VAPID ключа.', 'missing-subscription':'Липсва браузърен Push абонамент за Meteo Pulse.', 'vapid-mismatch':'VAPID ключът на браузърния абонамент не съвпада.', 'device-mismatch':'Браузърният абонамент не съвпада с избраното устройство.', unavailable:'Проверката не може да приключи. Браузърната регистрация е недостъпна. Опитай отново.'},
 en:{'missing-public-key':'The public VAPID key for the check is missing or invalid.', 'worker-unavailable':'The Meteo Pulse Service Worker is unavailable. Try again.', match:'Registration matches this device and the VAPID key.', 'missing-subscription':'No browser Push subscription for Meteo Pulse.', 'vapid-mismatch':'The browser subscription VAPID key does not match.', 'device-mismatch':'The browser subscription does not match the selected device.', unavailable:'The check could not complete. The browser registration is unavailable. Try again.'},
}
