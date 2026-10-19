import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppProvider } from './store'
import './styles.css'

// The organizer console lives at /#admin and is loaded only there.
const Admin = lazy(() => import('./admin/Admin'))
const isAdmin = () => location.hash.startsWith('#admin')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin() ? (
      <Suspense fallback={null}>
        <Admin />
      </Suspense>
    ) : (
      <AppProvider>
        <App />
      </AppProvider>
    )}
  </StrictMode>,
)
window.addEventListener('hashchange', () => location.reload())

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
