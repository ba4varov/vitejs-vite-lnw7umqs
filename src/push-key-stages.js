// Closed vocabulary only. Never accept exception messages, IDs or response bodies.
export const keyStages = [
 'session:before','session:before-request','session:after-request',
 'registration:rejected','browser:subscription','browser:identity','browser:crypto',
 'browser:key-read','browser:key-format','browser:key-missing',
 'request:transport','request:timeout','request:http','request:response',
 'api:method','api:configuration','api:input',
 'auth:http','auth:rejected','auth:transport','auth:timeout','auth:response',
 'rpc:unauthorized','rpc:forbidden','rpc:not-found','rpc:rejected',
 'rpc:schema-cache','rpc:sql-permission','rpc:sql-ambiguous','rpc:sql-function',
 'rpc:transport','rpc:timeout','rpc:response','rpc:result-unavailable','rpc:complete'
]
export const safeKeyStage = value => keyStages.includes(value) ? value : null
export const keyStageError = stage => Object.assign(Error('CHECK_UNAVAILABLE'), {diagnostic:safeKeyStage(stage)})
export const transportStage = (stage,error) => `${stage}:${['TimeoutError','AbortError'].includes(error?.name)?'timeout':'transport'}`
