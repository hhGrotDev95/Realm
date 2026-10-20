import { LazyMotion } from 'framer-motion'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bootFestival } from './festival'
import { AppProvider } from './store'
import './styles.css'
import { t } from './i18n'

// The organizer console lives at /#admin and is loaded only there.
const Admin = lazy(() => import('./admin/Admin'))
const isAdmin = () => location.hash.startsWith('#admin')
const loadMotion = () => import('./motionFeatures').then((m) => m.default)
const root = createRoot(document.getElementById('root')!)

function BootError({ error }: { error: string }) {
  return (
    <div className="stagewrap">
      <div className="card" style={{ maxWidth: 360, margin: 16, textAlign: 'center' }} role="alert">
        <h1 className="h-display" style={{ fontSize: 24, marginBottom: 8 }}>
          {t('Festival nicht erreichbar')}
        </h1>
        <p className="muted small">{t('Die Festivaldaten konnten nicht geladen werden und sind auf diesem Gerät noch nicht gespeichert. ({error})', { error })}</p>
        <button className="btn primary block" onClick={() => location.reload()}>
          {t('Erneut versuchen')}
        </button>
      </div>
    </div>
  )
}

if (isAdmin()) {
  root.render(
    <StrictMode>
      <LazyMotion features={loadMotion} strict>
        <Suspense fallback={null}>
          <Admin />
        </Suspense>
      </LazyMotion>
    </StrictMode>,
  )
} else {
  bootFestival().then((boot) => {
    if (!boot.ok) return root.render(<BootError error={boot.error} />)
    // newer festival data arrived after rendering the cached copy: let the app re-read it
    boot.fresh.then((changed) => changed && window.dispatchEvent(new Event('realm:festival-updated')))
    root.render(
      <StrictMode>
        <LazyMotion features={loadMotion} strict>
          <AppProvider>
            <App />
          </AppProvider>
        </LazyMotion>
      </StrictMode>,
    )
  })
}
window.addEventListener('hashchange', () => location.reload())

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
