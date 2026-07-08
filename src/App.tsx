18:33:04.565 Running build in Washington, D.C., USA (East) – iad1
18:33:04.566 Build machine configuration: 2 cores, 8 GB
18:33:04.684 Cloning github.com/ba4varov/vitejs-vite-lnw7umqs (Branch: main, Commit: e143bcb)
18:33:04.893 Cloning completed: 208.000ms
18:33:05.551 Restored build cache from previous deployment (Hh2aWNWYu4AKJBfee23NrvjDWn7P)
18:33:05.761 Running "vercel build"
18:33:05.780 Vercel CLI 54.21.1
18:33:06.495 Installing dependencies...
18:33:07.167 
18:33:07.168 up to date in 545ms
18:33:07.168 
18:33:07.169 10 packages are looking for funding
18:33:07.169   run `npm fund` for details
18:33:07.202 Running "npm run build"
18:33:07.300 
18:33:07.300 > vite-react-typescript-starter@0.0.0 build
18:33:07.300 > tsc -b && vite build
18:33:07.301 
18:33:10.117 vite v8.1.1 building client environment for production...
18:33:10.195 
transforming...✓ 17 modules transformed.
18:33:10.233 ✗ Build failed in 114ms
18:33:10.234 error during build:
18:33:10.234 Build failed with 1 error:
18:33:10.234 
18:33:10.235 [plugin vite:css-post]
18:33:10.235 SyntaxError: [lightningcss minify] Unexpected token Comma
18:33:10.235 110 |    background: var(--code-bg);
18:33:10.235 111 |  }
18:33:10.235 112 |  import { useState, useEffect, useRef } from 'react'
18:33:10.235     |                   ^
18:33:10.235 113 |  import './App.css'
18:33:10.235 114 |  
18:33:10.235     at Module.<anonymous> (/vercel/path0/node_modules/lightningcss/node/index.js:56:14)
18:33:10.235     at minifyCSS (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:22470:59)
18:33:10.235     at async finalizeCss (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:22315:36)
18:33:10.235     at async Promise.all (index 1)
18:33:10.236     at async Object.run (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:2737:22)
18:33:10.236     at async PluginContextImpl.renderChunk (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:21848:19)
18:33:10.236     at async plugin (file:///vercel/path0/node_modules/rolldown/dist/shared/bindingify-input-options-CzVhGygm.mjs:1620:16)
18:33:10.236     at async plugin.<computed> (file:///vercel/path0/node_modules/rolldown/dist/shared/bindingify-input-options-CzVhGygm.mjs:1961:12)
18:33:10.236     at aggregateBindingErrorsIntoJsError (file:///vercel/path0/node_modules/rolldown/dist/shared/error-B68YLzl3.mjs:48:18)
18:33:10.236     at unwrapBindingResult (file:///vercel/path0/node_modules/rolldown/dist/shared/error-B68YLzl3.mjs:18:128)
18:33:10.236     at #build (file:///vercel/path0/node_modules/rolldown/dist/shared/rolldown-build-DR0wzp0V.mjs:3256:34)
18:33:10.236     at async buildEnvironment (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:32591:66)
18:33:10.237     at async Object.build (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:33013:19)
18:33:10.237     at async Object.buildApp (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:33010:153)
18:33:10.237     at async CAC.<anonymous> (file:///vercel/path0/node_modules/vite/dist/node/cli.js:777:3) {
18:33:10.237   errors: [Getter/Setter]
18:33:10.237 }
18:33:10.256 Error: Command "npm run build" exited with 1
