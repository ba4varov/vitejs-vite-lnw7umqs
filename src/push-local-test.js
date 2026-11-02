export async function checkLocalNotification(scope=window){
 if(!scope.isSecureContext||!scope.navigator.serviceWorker||!scope.Notification)return 'local:unsupported'
 if(scope.Notification.permission!=='granted')return 'local:permission-required'
 try{
  const registration=await scope.navigator.serviceWorker.getRegistration('/')
  if(!registration?.active||registration.active.scriptURL!==new URL('/push-sw.js',scope.location.origin).href||registration.scope!==new URL('/',scope.location.origin).href)return 'local:worker-unavailable'
  await registration.showNotification('Meteo Pulse — локален тест',{body:'Локална проверка на това устройство. Не е изпратен Push.',tag:'meteo-pulse-local-test'})
  return 'local:requested'
 }catch{return 'local:failed'}
}
