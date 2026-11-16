import assert from 'node:assert/strict'
import { publicAppBase } from '../src/publicAppBase.ts'
import { nativeBuildConfig } from '../scripts/ios-config.mjs'

const env = { VITE_API_URL: 'https://api.realm.test/', VITE_PUBLIC_APP_URL: 'https://realm.test/' }
assert.deepEqual(nativeBuildConfig(env), { apiUrl: 'https://api.realm.test', publicAppUrl: 'https://realm.test' })
for (const key of Object.keys(env)) {
  for (const value of [undefined, '', '/api', 'http://realm.test', 'capacitor://localhost', 'https://user:secret@realm.test', 'https://realm.test/api', 'https://realm.test/?token=secret', 'https://realm.test/#admin']) {
    assert.throws(() => nativeBuildConfig({ ...env, [key]: value }), undefined, `${key}: ${value}`)
  }
}
assert.equal(publicAppBase(false, 'http://localhost:4321', 'https://realm.test'), 'http://localhost:4321')
assert.equal(publicAppBase(true, 'capacitor://localhost', env.VITE_PUBLIC_APP_URL), 'https://realm.test')
assert.throws(() => publicAppBase(true, 'capacitor://localhost'))
assert.throws(() => publicAppBase(true, 'capacitor://localhost', 'capacitor://localhost'))
console.log('Native build guards and public link origins passed')
