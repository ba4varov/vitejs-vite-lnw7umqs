// Builds a LOCAL Lambda artifact. No Vercel credentials, API, project link or deployment.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {mkdir,rm,readFile,writeFile,cp} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const here=resolve(root,'work/push-node-build'),site=resolve(here,'source'),buildWork=resolve(here,'build'),bundle=resolve(here,'lambda')
const builder=resolve(process.env.PUSH_NODE_BUILDER_DIR??resolve(root,'tests/push-node-build'))
const require=createRequire(resolve(builder,'package.json'))
const {build}=require('@vercel/node'),{FileFsRef}=require('@vercel/build-utils')
assert.equal(require('@vercel/node/package.json').version,'23.0.0')
assert.match(process.version,/^v24\./)
await rm(here,{recursive:true,force:true})
const names=['api/push-operator.ts','server/push-node-operator.js','server/push-node-transport.js',
 'supabase/functions/_shared/push-operator.mjs','supabase/functions/_shared/push-test.mjs','supabase/functions/_shared/push-provider.mjs']
const files={}
for(const name of names){
 const destination=resolve(site,name);await mkdir(dirname(destination),{recursive:true})
 await writeFile(destination,await readFile(resolve(root,name)));files[name]=new FileFsRef({fsPath:destination})
}
await writeFile(resolve(site,'package.json'),JSON.stringify({name:'isolated-weather-node-build',private:true,type:'module',dependencies:{'web-push':'3.6.7','ipaddr.js':'2.5.0'}}))
files['package.json']=new FileFsRef({fsPath:resolve(site,'package.json')})
await cp(resolve(root,'node_modules'),resolve(buildWork,'node_modules'),{recursive:true})
const result=await build({files,entrypoint:'api/push-operator.ts',workPath:buildWork,
 config:{projectSettings:{nodeVersion:'24.x',installCommand:'',buildCommand:'true'}},meta:{},considerBuildCommand:true})
assert.equal(result.output.type,'Lambda');assert.equal(result.output.runtime,'nodejs24.x')
const builtNames=Object.keys(result.output.files)
for(const fragment of ['web-push','ipaddr.js','server/push-node-operator','server/push-node-transport','_shared/push-operator','_shared/push-test'])assert.ok(builtNames.some(n=>n.includes(fragment)),fragment)
assert.ok(!builtNames.some(n=>/(?:^|\/)(?:work|tests|\.env)(?:[/.]|$)|\.(?:pem|key)$/.test(n)))
for(const [name,ref] of Object.entries(result.output.files)){
 const destination=resolve(bundle,name);assert.ok(destination.startsWith(bundle+'/'))
 assert.ok(['FileFsRef','FileBlob'].includes(ref.type));await mkdir(dirname(destination),{recursive:true})
 await writeFile(destination,ref.type==='FileBlob'?ref.data:await readFile(ref.fsPath))
}
const entry=builtNames.find(n=>n==='api/push-operator.js'||n==='api/push-operator.ts')
assert.ok(entry,'Emitted entrypoint exists')
// A fresh child with an explicit synthetic environment cannot inherit real credentials.
const probe=resolve(here,'probe.mjs')
await writeFile(probe,`
import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import webpush from '${resolve(root,'node_modules/web-push/src/index.js')}';
const keys=webpush.generateVAPIDKeys();
Object.assign(process.env,{SUPABASE_URL:'https://'+'a'.repeat(20)+'.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic_service_key_do_not_use',PUSH_TEST_OPERATOR_TOKEN:'A'.repeat(43),PUSH_VAPID_PUBLIC_KEY:keys.publicKey,PUSH_NODE_VAPID_PRIVATE_KEY:keys.privateKey,PUSH_VAPID_SUBJECT:'mailto:fixture@example.invalid'});
let network=0;globalThis.fetch=async()=>{network++;throw Error('NETWORK_FORBIDDEN')};
const module=await import(pathToFileURL(process.argv[2]));
const handler=module.default?.fetch??module.default?.default?.fetch;assert.equal(typeof handler,'function');
for(const platform of [{VERCEL:'1',VERCEL_ENV:'production',PUSH_NODE_OPERATOR_ENABLED:'false'},{VERCEL:'1',VERCEL_ENV:'preview',PUSH_NODE_OPERATOR_ENABLED:'true'},{VERCEL:'1',VERCEL_ENV:'development',PUSH_NODE_OPERATOR_ENABLED:'true'}]){
 Object.assign(process.env,platform);
 const response=await handler(new Request('https://weather.fixture.invalid/api/push-operator',{method:'POST',body:'{}'}));
 assert.equal(response.status,503);assert.equal((await response.json()).error,'PUSH_NODE_DISABLED');assert.equal(network,0);
}
console.log(JSON.stringify({builtHandlerExecuted:true,previewWithSyntheticSecretsRefused:true,networkCalls:network}));
`)
const child=spawnSync(process.execPath,[probe,resolve(bundle,entry)],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000})
if(child.status!==0){process.stderr.write(child.stderr);throw Error('BUILT_HANDLER_PROBE_FAILED')}
const evidence={node:process.version,builder:require('@vercel/node/package.json').version,buildUtils:require('@vercel/build-utils/package.json').version,runtime:result.output.runtime,
 handler:result.output.handler,files:builtNames.length,probe:JSON.parse(child.stdout.trim()),hostedVercelExecution:false,deployment:false}
await writeFile(resolve(here,'evidence.json'),JSON.stringify(evidence,null,2)+'\n')
console.log(JSON.stringify(evidence,null,2))
