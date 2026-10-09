import webpush from 'web-push'
import {mkdirSync,writeFileSync,realpathSync} from 'node:fs'
import {resolve,relative,dirname} from 'node:path'

// Explicit file destination only; no stdout keys, no production/upload integration.
const destination=process.argv[2]
const root=resolve('work'),target=destination && resolve(destination)
if(!target || relative(root,target).startsWith('..') || relative(root,target)==='' || process.argv.length!==3){
 console.error('Usage: node scripts/generate-vapid.mjs work/<isolated-key-file>.json');process.exit(1)
}
mkdirSync(dirname(target),{recursive:true,mode:0o700})
if(realpathSync(root)!==root || relative(root,realpathSync(dirname(target))).startsWith('..')){
 console.error('Refusing a destination outside the private work directory.');process.exit(1)
}
writeFileSync(target,JSON.stringify(webpush.generateVAPIDKeys())+'\n',{flag:'wx',mode:0o600})
console.log('VAPID key pair written to the explicitly selected private work file. No keys printed.')
