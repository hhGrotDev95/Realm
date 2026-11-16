import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, loadEnv } from 'vite'
import { nativeBuildConfig } from './ios-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// Reuse Realm staging, but keep native output separate from the website's dist/.
const mode = 'staging'
const { apiUrl, publicAppUrl } = nativeBuildConfig({ ...loadEnv(mode, root, 'VITE_'), ...process.env })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
await build({
  root, mode,
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify(publicAppUrl),
  },
  // Match the iOS deployment target; keep Vite upgrades from silently raising it.
  build: { outDir: 'dist-ios', target: 'safari16.4' },
})
await writeFile(new URL('../dist-ios/native-build.json', import.meta.url), JSON.stringify({
  target: 'ios', mode, apiUrl, publicAppUrl, commit, dirty, builtAt: new Date().toISOString(),
}, null, 2) + '\n')
console.log(`Realm iPhone assets: ${mode}, API ${apiUrl}, public links ${publicAppUrl}, source ${commit}${dirty ? ' (local changes)' : ''}`)
