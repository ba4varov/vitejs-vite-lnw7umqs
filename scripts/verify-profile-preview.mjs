// Read-only comparison of served entry assets with a local build. curl preserves the session proxy.
import {execFileSync} from 'node:child_process'
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
const [target,dist='dist',report='work/preview-comparison.json']=process.argv.slice(2)
if(!target)throw Error('Usage: node scripts/verify-profile-preview.mjs https://preview-origin/ [dist] [report.json]')
const origin=new URL(target).origin,temporary=mkdtempSync(join(tmpdir(),'profile-preview-'))
const result={target:new URL('/',origin).href,hostedVerified:false,assets:[],errors:[]}
const hash=buffer=>createHash('sha256').update(buffer).digest('hex')
let counter=0
function download(path){
 const url=new URL(path,origin)
 if(url.origin!==origin)throw Error('Cross-origin asset or redirect requires separate investigation')
 const headers=join(temporary,`${counter}.headers`),body=join(temporary,`${counter++}.body`)
 try{execFileSync('curl',['--silent','--show-error','--max-time','20','--max-filesize','20000000','--dump-header',headers,'--output',body,url.href],{stdio:['ignore','ignore','pipe']})}
 catch(error){throw Error(`Download failed: ${url.href}: ${String(error.stderr||error.message).trim()}`)}
 const lines=readFileSync(headers,'utf8'),status=Array.from(lines.matchAll(/^HTTP\/\S+ (\d+)/gm)).at(-1)?.[1]
 if(status!=='200')throw Error(`HTTP ${status}: ${url.href}; no hosted verification (redirects are not followed)`)
 return {body:readFileSync(body),headers:lines}
}
try{
 const remote=download('/'),html=remote.body.toString(),localHtml=readFileSync(join(dist,'index.html'),'utf8')
 const entries=text=>Array.from(text.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g),m=>m[1])
 const paths=entries(html),expected=entries(localHtml)
 if(!paths.length)throw Error('No JS/CSS entry assets: possible authentication or stale HTML response')
 result.entryPathsMatch=JSON.stringify(paths)===JSON.stringify(expected)
 if(!result.entryPathsMatch)result.errors.push('Served entry paths differ from the local build; verify build environment and deployment SHA')
 for(const path of paths){
  const response=download(path),relative=new URL(path,origin).pathname.replace(/^\//,'')
  const root=resolve(dist),local=resolve(root,relative)
  if(!local.startsWith(root+'/'))throw Error('Invalid asset path')
  let localHash=null;try{localHash=hash(readFileSync(local))}catch{}
  const text=response.body.toString(),isJS=path.endsWith('.js')
  const row={path,servedSha256:hash(response.body),localSha256:localHash,equal:hash(response.body)===localHash,profileDialog:text.includes('profile-dialog'),profileTabs:text.includes('profile-tabs')}
  result.assets.push(row)
  if(!row.equal)result.errors.push(`Asset bytes differ: ${path}`)
  if(!row.profileDialog||!row.profileTabs)result.errors.push(`Redesign selectors missing from ${isJS?'JavaScript':'CSS'} entry: ${path}`)
 }
 result.hostedVerified=result.errors.length===0
}catch(error){result.errors.push(error.message)}finally{
 rmSync(temporary,{recursive:true,force:true})
 writeFileSync(report,JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result,null,2))
 process.exitCode=result.hostedVerified?0:1
}
