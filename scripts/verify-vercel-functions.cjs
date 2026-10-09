// Local builder verification only; never deploys or reads production credentials.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
const {build}=require(path.join(process.cwd(),'work/vercel-builder/node_modules/@vercel/node'))
const {FileFsRef}=require(path.join(process.cwd(),'work/vercel-builder/node_modules/@vercel/build-utils'))
;(async()=>{
 const root=process.cwd(),target=path.join(root,'work/function-build')
 await fs.mkdir(target,{recursive:true})
 const files={}
 for(const dir of ['api','server'])for(const name of await fs.readdir(dir))files[`${dir}/${name}`]=new FileFsRef({fsPath:path.join(root,dir,name)})
 for(const name of ['package.json','package-lock.json','tsconfig.api.json'])files[name]=new FileFsRef({fsPath:path.join(root,name)})
 await fs.symlink(path.join(root,'node_modules'),path.join(target,'node_modules'),'dir').catch(e=>{if(e.code!=='EEXIST')throw e})
 const functions=[]
 for(const entrypoint of Object.keys(files).filter(k=>k.startsWith('api/'))){
  const result=await build({files,entrypoint,workPath:target,config:{projectSettings:{installCommand:'',buildCommand:'true'}},meta:{},considerBuildCommand:true})
  assert.equal(result.output.type,'Lambda')
  const names=Object.keys(result.output.files)
  assert.ok(names.some(n=>n.includes(entrypoint.replace('.ts','.js'))))
  assert.ok(!names.some(n=>n.includes('.test.')))
  functions.push({entrypoint,type:result.output.type,runtime:result.output.runtime,files:names})
 }
 assert.equal(functions.length,8);assert.ok(functions.length<=12)
 await fs.writeFile('docs/vercel-functions-stage6c.json',JSON.stringify({builder:'@vercel/node 23.0.0',verification:'Local official builder using installed dependencies; no deployment performed',count:functions.length,hobbyLimit:12,functions},null,2)+'\n')
 console.log(`PASS: ${functions.length} official Lambda bundles`)
})().catch(e=>{console.error(e);process.exitCode=1})
