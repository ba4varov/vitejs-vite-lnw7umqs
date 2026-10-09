import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminApp from './AdminApp.tsx'
import {pushSupport,preparePushWorker} from './push-browser.js'

// Registration alone never requests notification permission or subscribes.
if(pushSupport()==='supported')void preparePushWorker().catch(()=>{})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/admin' || location.pathname.startsWith('/admin/') ? <AdminApp /> : <App />}
  </StrictMode>,
)
