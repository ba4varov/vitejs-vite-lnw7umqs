import {checkPushRegistration,vapidBytes,pushRegistrationMessages} from './push-browser.js'

// Read fresh owner-scoped state twice; never DELETE or retry a mutation.
export async function renewPush({scope=window,device,key,load,confirm,persist,authorize}) {
 const preflight=async()=>{
  let snapshot
  try {snapshot=await load()}catch {throw Error('preflight-failed')}
  if(!snapshot.registrationEnabled)throw Error('registration-disabled')
  if(snapshot.publicKey!==key)throw Error('vapid-mismatch')
  const selected=snapshot.devices.find(d=>d.id===device.id&&d.fingerprint===device.fingerprint)
  if(!selected)throw Error('device-mismatch')
  const p=snapshot.preferences
  if(!p.enabled||!p.cities.length||!p.categories.length||(!snapshot.pro&&p.categories.some(c=>['walk','garden','sport'].includes(c))))throw Error('preferences-required')
  if(snapshot.devices.length>=10)throw Error('device-limit')
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
   const data=await persist(renewed.toJSON(),selected.label)
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
  warning:'Да подновя ли Push регистрацията на избраното устройство? Старият браузърен абонамент не може надеждно да се възстанови. При неуспех известията може да останат недостъпни. Старият запис в базата ще бъде запазен.',
  checking:'Проверка на избраното устройство и ограниченията…',cancelled:'Подновяването е отказано. Няма промени.',success:'Push регистрацията е подновена. Старият запис е запазен. Това не доказва, че FCM ще приеме известие.',
  'registration-disabled':'Подновяването е недостъпно: новите регистрации са забранени.',
  'preferences-required':'Първо запази разрешени Push настройки с градове и категории.',
  'device-limit':'Достигнат е лимитът от 10 устройства. Подновяването е спряно преди отписване.',
  'permission-required':'Нужно е вече дадено разрешение за известия. Провери настройките на браузъра.',
  'preflight-failed':'Проверката на сесията или настройките не е потвърдена. Подновяването е спряно.',
  'unsubscribe-unconfirmed':'Отписването не е потвърдено. Няма опит за ново абониране. Провери регистрацията.',
  'subscribe-failed':'Старият браузърен абонамент е отписан, но новото абониране не успя. Старият DB запис е запазен. Няма автоматичен повторен опит.',
  'save-rejected':'Записването е отказано. Новият браузърен абонамент и старият DB запис са запазени. Провери сесията и настройките. Няма автоматичен повторен опит.',
  'save-unconfirmed':'Резултатът от записването е неясен; записът може да е създаден. Новият браузърен абонамент и старият DB запис са запазени. Провери „Моите устройства“, преди друго действие. Няма автоматичен повторен опит.'},
 en:{...pushRegistrationMessages.en,
  warning:'Renew Push registration for the selected device? The old browser subscription cannot reliably be restored. Notifications may remain unavailable if renewal fails. The old database record will be kept.',
  checking:'Checking the selected device and registration restrictions…',cancelled:'Renewal cancelled. Nothing changed.',success:'Push registration renewed. The old record was kept. This does not prove that FCM will accept a notification.',
  'registration-disabled':'Renewal is unavailable: new registrations are disabled.',
  'preferences-required':'First save allowed Push preferences with cities and categories.',
  'device-limit':'The 10-device limit has been reached. Renewal stopped before unsubscribing.',
  'permission-required':'Notification permission must already be granted. Check browser settings.',
  'preflight-failed':'Session or preferences checks could not be confirmed. Renewal stopped.',
  'unsubscribe-unconfirmed':'Unsubscribe was not confirmed. No new subscription was attempted. Check registration.',
  'subscribe-failed':'The old browser subscription was removed, but creating a new one failed. The old database record was kept. No automatic retry.',
  'save-rejected':'Saving was rejected. The new browser subscription and old database record were kept. Check your session and preferences. No automatic retry.',
  'save-unconfirmed':'The save result is unclear; the record may have been created. The new browser subscription and old database record were kept. Check “My devices” before another action. No automatic retry.'},
}
