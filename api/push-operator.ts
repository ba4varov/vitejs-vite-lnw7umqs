import {handleSessionPush} from '../server/push-session-test.js'
import {handleNodeOperator} from '../server/push-node-operator.js'

// Same-origin session diagnostics and legacy operator tooling share one Node endpoint.
// Each entrypoint retains its own independent default-off gate and authentication.
export default {fetch:(request:Request)=>request.headers.has('origin')?handleSessionPush(request):handleNodeOperator(request)}
export const maxDuration=60
