import { LazyMotion } from 'framer-motion'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bootFestival } from './festival'
import { AppProvider } from './store'
import '@fontsource-variable/inter'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'
import { t } from './i18n'
import { isNativeApp } from './platform'
import { bootSecureSession } from './secureSession'

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
  bootSecureSession().then(() => bootFestival()).then((boot) => {
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
  }).catch(() => root.render(
    <div className="stagewrap"><div className="card" role="alert">
      <h1>{t('Sitzung nicht verfügbar')}</h1>
      <p>{t('Entsperre dein iPhone und versuche es erneut. Deine gespeicherten Daten werden nicht zurückgesetzt.')}</p>
      <button className="btn primary" onClick={() => location.reload()}>{t('Erneut versuchen')}</button>
    </div></div>,
  ))
}
window.addEventListener('hashchange', () => location.reload())

// Capacitor bundles all app assets; only the website needs the service-worker shell cache.
if (!isNativeApp && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
