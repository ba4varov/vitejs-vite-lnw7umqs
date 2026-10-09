/* Push only: no fetch handler, precache, offline forecasts, auth or analytics. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('push', event => {
 let payload
 try {payload=event.data?.json()}catch{/* Display a safe generic notification. */}
 const title=typeof payload?.title==='string'?payload.title.slice(0,80):'Метео Пулс'
 const body=typeof payload?.body==='string'?payload.body.slice(0,240):'Има нова метео информация. Отвори сайта за актуална прогноза.'
 const tag=typeof payload?.eventId==='string'?payload.eventId.slice(0,200):'meteo-pulse'
 // Fixed same-origin destination; payload cannot open third-party/OAuth URLs.
 event.waitUntil(self.registration.showNotification(title,{body,tag,icon:'/pwa/icon-192.png',badge:'/pwa/badge-96.png',data:{url:'/'}}))
})
self.addEventListener('notificationclick', event => {
 event.notification.close()
 event.waitUntil((async()=>{
  const origin=self.location.origin
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) {
   if(new URL(client.url).origin===origin && new URL(client.url).pathname==='/')return client.focus()
  }
  return self.clients.openWindow(origin+'/')
 })())
})
// Subscription rotation requires a fresh authenticated visit. No tokens in SW.
