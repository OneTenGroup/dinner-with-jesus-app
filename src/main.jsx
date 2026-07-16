import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import { requestReload } from './lib/appUpdate'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)

// PWA update handling -- this is the actual fix for installed devices
// not picking up new deploys. The default auto-injected registration
// (registerType: 'autoUpdate' with no manual wiring) only checks for a
// new service worker once, on that initial page load -- there was
// nothing here re-checking on foreground return, and nothing coor-
// dinating *when* it's safe to reload. Registering manually via
// virtual:pwa-register gives control over both.
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onRegisteredSW(swUrl, registration) {
        if (!registration) return
        const checkForUpdate = () => registration.update().catch(() => {})
        checkForUpdate() // check the instant we're registered, not just on next natural navigation
        setInterval(checkForUpdate, 60 * 1000) // periodic while the app stays open
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate()
        })
        window.addEventListener('focus', checkForUpdate) // covers foreground return on platforms that don't fire visibilitychange reliably
      },
      onNeedRefresh() {
        // Workbox's skipWaiting+clientsClaim mean a new worker normally
        // activates on its own without waiting on this callback -- it's
        // kept as a safety net so any future config change that leaves
        // a worker genuinely "waiting" still routes through the same
        // busy-aware reload path instead of silently doing nothing.
        requestReload()
      }
    })

    // The moment a new service worker actually takes control of this
    // page (fires once skipWaiting+clientsClaim complete), the page's
    // already-loaded JS is stale relative to what the worker would now
    // serve. This -- not onNeedRefresh -- is the reliable signal that
    // an update is ready to apply.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      requestReload()
    })
  })
}
