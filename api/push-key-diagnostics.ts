import {handlePushKeyDiagnostics} from '../server/push-key-diagnostics.js'
export const config={api:{bodyParser:{sizeLimit:'1kb'}}}
export default async function handler(req:any,res:any){return handlePushKeyDiagnostics(req,res)}
