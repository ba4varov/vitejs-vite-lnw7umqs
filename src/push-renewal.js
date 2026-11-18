import {checkPushRegistration,vapidBytes,pushRegistrationMessages} from './push-browser.js'

// Read fresh owner-scoped state twice; never DELETE or retry a mutation.
export async function renewPush({scope=window,device,key,load,confirm,persist,authorize}) {
 const preflight=async()=>{
  let snapshot
  try {snapshot=await load()}catch {throw Error('preflight-failed')}
  // Fail before browser unsubscribe when a cached tab talks to a different API contract.
  if(snapshot.pushProtocolVersion!==2)throw Error('client-outdated')
  if(!snapshot.registrationEnabled)throw Error('registration-disabled')
  if(snapshot.publicKey!==key)throw Error('vapid-mismatch')
  const selected=snapshot.devices.find(d=>d.id===device.id&&d.fingerprint===device.fingerprint)
  if(!selected)throw Error('device-mismatch')
  const p=snapshot.preferences
  if(!p.enabled||!p.cities.length||!p.categories.length||(!snapshot.pro&&p.categories.some(c=>['walk','garden','sport'].includes(c))))throw Error('preferences-required')
  // In-place renewal reuses the existing device row, even at the 10-device limit.
  if(!selected.label?.trim())throw Error('preflight-failed')
  const status=await checkPushRegistration({scope,device:selected,key})
  if(status!=='match')throw Error(status)
  if(scope.Notification.permission!=='granted')throw Error('permission-required')
  return selected
 }
 try {
  await preflight()
  if(!await confirm())return {status:'cancelled'}
  const selected=await preflight()
  const registration=await scope.navigator.serviceWorker.getRegistration('/')
  const subscription=await registration?.pushManager.getSubscription()
  // Check the exact subscription object that will be unsubscribed, closing the
  // gap between the diagnostic lookup and the destructive browser operation.
  const capturedScope={isSecureContext:scope.isSecureContext,location:scope.location,crypto:scope.crypto,navigator:{serviceWorker:{}}}
  // Native registration properties are not enumerable; preserve them explicitly.
  capturedScope.navigator.serviceWorker.getRegistration=async()=>({scope:registration?.scope,active:registration?.active,pushManager:{getSubscription:async()=>subscription}})
  const status=await checkPushRegistration({scope:capturedScope,device:selected,key})
  if(status!=='match')throw Error(status)
  if(!await authorize())throw Error('preflight-failed')
  let removed
  try {removed=await subscription.unsubscribe()}catch {throw Error('unsubscribe-unconfirmed')}
  if(!removed)throw Error('unsubscribe-unconfirmed')
  let renewed
  try {renewed=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(key)})}catch {throw Error('subscribe-failed')}
  try {
   const json=renewed.toJSON()
   const data=await persist(json,selected.label)
   // A successful HTTP response must contain the same device ID with the new
   // endpoint fingerprint. Reject stale snapshots or an accidental extra row.
   const digest=await scope.crypto.subtle.digest('SHA-256',new TextEncoder().encode(json.endpoint))
   const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
   const same=data?.devices?.find(d=>d.id===selected.id)
   if(!same||same.fingerprint!==fingerprint)return {status:'save-unconfirmed'}
   return {status:'success',data}
  }catch(error) {
   // Keep the new subscription even after a known rejection. No rollback,
   // second POST, DELETE, or subscription serialization in messages/logs.
   const rejected=[400,401,403,405,413,429].includes(error?.status)||error?.message==='SESSION_CHANGED'
   return {status:rejected?'save-rejected':'save-unconfirmed'}
  }
 }catch(error) {
  return {status:Object.hasOwn(pushRenewalMessages.en,error?.message)?error.message:'preflight-failed'}
 }
}
export const pushRenewalMessages={
 bg:{...pushRegistrationMessages.bg,
  warning:'Да подновя ли Push регистрацията на избраното устройство? Браузърът първо отписва стария абонамент. При успешен запис същият идентификатор на устройството ще получи новите данни. При отказ известията може да останат недостъпни, а старият запис в базата ще остане.',
  checking:'Проверка на избраното устройство и ограниченията…',cancelled:'Подновяването е отказано. Няма промени.',success:'Push регистрацията е подновена за същото устройство, без нов запис. Това не доказва, че FCM ще приеме известие.',
  'client-outdated':'Страницата и сървърът са с различни версии. Презареди Метео Пулс и провери устройството. Няма промяна на абонамента.',
  'registration-disabled':'Подновяването е недостъпно: новите регистрации са забранени.',
  'preferences-required':'Първо запази разрешени Push настройки с градове и категории.',
  'permission-required':'Нужно е вече дадено разрешение за известия. Провери настройките на браузъра.',
  'preflight-failed':'Проверката на сесията или настройките не е потвърдена. Подновяването е спряно.',
  'unsubscribe-unconfirmed':'Отписването не е потвърдено. Няма опит за ново абониране. Провери регистрацията.',
  'subscribe-failed':'Старият браузърен абонамент е отписан, но новото абониране не успя. Старият DB запис е запазен. Няма автоматичен повторен опит.',
  'save-rejected':'Записването е отказано. Новият браузърен абонамент и старият DB запис са запазени. Провери сесията и настройките. Няма автоматичен повторен опит.',
  'save-unconfirmed':'Резултатът от записването е неясен; записът може да е създаден. Новият браузърен абонамент и старият DB запис са запазени. Провери „Моите устройства“, преди друго действие. Няма автоматичен повторен опит.'},
 en:{...pushRegistrationMessages.en,
  warning:'Renew Push registration for this device? The browser first unsubscribes the old subscription. On success the same device ID receives new credentials. On failure notifications may remain unavailable and the old database record remains.',
  checking:'Checking the selected device and registration restrictions…',cancelled:'Renewal cancelled. Nothing changed.',success:'Push subscription renewed in place under the same device ID. This does not prove FCM will accept a notification.',
  'client-outdated':'The page and server versions differ. Reload Meteo Pulse and check the device. No subscription was changed.',
  'registration-disabled':'Renewal is unavailable: new registrations are disabled.',
  'preferences-required':'First save allowed Push preferences with cities and categories.',
  'permission-required':'Notification permission must already be granted. Check browser settings.',
  'preflight-failed':'Session or preferences checks could not be confirmed. Renewal stopped.',
  'unsubscribe-unconfirmed':'Unsubscribe was not confirmed. No new subscription was attempted. Check registration.',
  'subscribe-failed':'The old browser subscription was removed, but creating a new one failed. The old database record was kept. No automatic retry.',
  'save-rejected':'Saving was rejected. The new browser subscription and old database record were kept. Check your session and preferences. No automatic retry.',
  'save-unconfirmed':'The save result is unclear; the record may have been created. The new browser subscription and old database record were kept. Check “My devices” before another action. No automatic retry.'},
}
