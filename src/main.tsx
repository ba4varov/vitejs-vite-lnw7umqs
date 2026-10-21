import { startupLifecycle } from './startup-timing.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminApp from './AdminApp.tsx'
import {pushSupport,preparePushWorker} from './push-browser.js'

// A full document load always starts at the top. Background data updates do
// not run this module again and preserve the reader's scroll position.
window.scrollTo({ top: 0, left: 0, behavior: 'instant' })

// Registration alone never requests notification permission or subscribes.
if(pushSupport()==='supported')void preparePushWorker().catch(()=>{})

startupLifecycle.record('root:create')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/admin' || location.pathname.startsWith('/admin/') ? <AdminApp /> : <App />}
  </StrictMode>,
)
