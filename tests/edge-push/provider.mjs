// Disposable local TLS provider only, no Internet or real push subscriptions.
import {createServer} from 'node:https'
import {readFileSync} from 'node:fs'
createServer({cert:readFileSync('/fixtures/cert.pem'),key:readFileSync('/fixtures/key.pem')},(req,res)=>{
 const valid=req.url==='/wp/isolated' && req.headers.host==='fcm.googleapis.com' && req.headers['content-encoding']==='aes128gcm' && req.headers.authorization?.startsWith('vapid ')
 const status=valid && req.headers['x-test-status']==='302'?302:valid?201:400
 req.resume();req.on('end',()=>{res.writeHead(status,{location:'https://untrusted.example.invalid/'});res.end()})
}).listen(9443,'127.0.0.1',()=>console.log('fixture-ready'))
