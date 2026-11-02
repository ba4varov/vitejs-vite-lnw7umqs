import test from 'node:test'
import assert from 'node:assert/strict'
import {fcmEndpointShape,currentFcmShape} from '../../src/push-endpoint-shape.js'
test('only exact FCM URL forms return safe shape labels',()=>{
 for(const [endpoint,shape] of [
  ['https://fcm.googleapis.com/wp/SYNTHETIC','fcm-wp'],
  ['https://fcm.googleapis.com/fcm/send/SYNTHETIC','fcm-send'],
  ...['http://fcm.googleapis.com/wp/SYNTHETIC','https://fcm.googleapis.com.evil.invalid/wp/SYNTHETIC','https://user:secret@fcm.googleapis.com/wp/SYNTHETIC','https://fcm.googleapis.com:8443/wp/SYNTHETIC','https://fcm.googleapis.com/wp/','https://fcm.googleapis.com/wp/SYNTHETIC?token=SECRET','https://fcm.googleapis.com/wp/SYNTHETIC#SECRET',null,'SECRET'].map(x=>[x,'unsupported']),
 ])assert.equal(fcmEndpointShape(endpoint),shape)
})
test('reads the current browser subscription without serialization, mutation, network or storage',async()=>{
 const forbidden=()=>{throw Error('Unexpected side effect')}
 let endpoint='https://fcm.googleapis.com/wp/SYNTHETIC'
 const subscription={get endpoint(){return endpoint},toJSON:forbidden,unsubscribe:forbidden}
 const registration={scope:'https://fixture.invalid/',active:{scriptURL:'https://fixture.invalid/push-sw.js'},pushManager:{getSubscription:async()=>subscription,subscribe:forbidden}}
 const scope={location:{origin:'https://fixture.invalid'},navigator:{serviceWorker:{getRegistration:async()=>registration,register:forbidden}},fetch:forbidden,Notification:{requestPermission:forbidden},localStorage:{setItem:forbidden}}
 assert.equal(await currentFcmShape(scope),'fcm-wp')
 endpoint='https://fcm.googleapis.com/fcm/send/SYNTHETIC';assert.equal(await currentFcmShape(scope),'fcm-send')
 registration.pushManager.getSubscription=async()=>{throw Error(endpoint)}
 assert.equal(await currentFcmShape(scope),'unsupported')
 registration.active=null;assert.equal(await currentFcmShape(scope),'unsupported')
})
