// Native Deno TCP + TLS: numeric connection target, independently verified provider identity.
// Node https lookup/Agent/servername hooks are not reliable in all Edge Runtime versions.
export const denoConnector=(network=Deno)=>async(target:{address:string;hostname:string},signal:AbortSignal)=>{
 let tcp:Deno.TcpConn|undefined,tls:Deno.TlsConn|undefined
 const close=()=>{for(const conn of [tls,tcp])try{conn?.close()}catch{/* Already consumed/closed. */}}
 signal.addEventListener('abort',close,{once:true})
 try {
  tcp=await network.connect({hostname:target.address,port:443})
  if(signal.aborted)throw Error('TIMEOUT')
  tls=await network.startTls(tcp,{hostname:target.hostname,alpnProtocols:['http/1.1']})
  await tls.handshake()
  if(signal.aborted)throw Error('TIMEOUT')
  return {read:(buffer:Uint8Array)=>tls!.read(buffer),write:(bytes:Uint8Array)=>tls!.write(bytes),close:()=>{signal.removeEventListener('abort',close);close()}}
 }catch{signal.removeEventListener('abort',close);close();throw Error('TLS_FAILED')}
}
