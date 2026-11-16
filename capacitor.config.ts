import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Development identity; reserve/confirm the store identity before distribution.
  appId: 'app.realm.festival',
  appName: 'Realm',
  webDir: 'dist-ios',
  backgroundColor: '#0a0a0d',
  // Keep this origin stable: WebView storage and the API allowlist depend on it.
  // Assets are bundled. Do not use server.url for an installable build.
  server: { hostname: 'localhost', iosScheme: 'capacitor' },
  // Realm's existing CSS owns the safe-area padding.
  ios: { contentInset: 'never' },
}

export default config
