import { createHash } from 'node:crypto'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Writes /sw-assets.json with every file of the build, so the service worker can cache the
 * whole app (including lazily loaded screens) when it installs – not only what the first
 * page view happened to request. The version changes with the content, so updates replace
 * the cache.
 */
function swManifest(): Plugin {
  return {
    name: 'realm-sw-manifest',
    apply: 'build',
    generateBundle(_, bundle) {
      // fonts: only the Latin subsets as woff2 up front; other scripts and legacy .woff load on demand
      const font = (f: string) => /\.woff2?$/.test(f)
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && (!font(f) || (/\.woff2$/.test(f) && /-latin(-ext)?-/.test(f))))
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw-assets.json', source: JSON.stringify({ version, files: ['icon.svg', 'manifest.webmanifest', ...files] }) })
    },
  }
}

export default defineConfig({ plugins: [react(), swManifest()] })
