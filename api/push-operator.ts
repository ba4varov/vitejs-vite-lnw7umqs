import {handleNodeOperator} from '../server/push-node-operator.js'

// No CORS/browser sender or body parser; the shared operator reads a bounded Request stream.
export default {fetch:(request:Request)=>handleNodeOperator(request)}
export const maxDuration=60
