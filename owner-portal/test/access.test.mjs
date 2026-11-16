import assert from 'node:assert/strict'
import test from 'node:test'
import { createHandler } from '../src/handler.mjs'

const data = { privateMarker: 'OWNER_DASHBOARD_SENTINEL' }
const env = { OWNER_EMAIL: 'owner@example.test' }
const context = (identity) => ({ access: { aud: 'test-app', getIdentity: async () => identity } })
const app = createHandler(data, (value) => `<html>${value.privateMarker}</html>`)

test('every path and HEAD denies unauthenticated or spoofed client identity', async () => {
  for (const path of ['/', '/status.json', '/anything']) {
    for (const method of ['GET', 'HEAD']) {
      const r = await app.fetch(new Request(`https://example.test${path}`, { method, headers: { 'Cf-Access-Jwt-Assertion': 'forged', 'Cf-Access-Authenticated-User-Email': env.OWNER_EMAIL } }), env, {})
      assert.equal(r.status, 403)
      assert.ok(!(await r.text()).includes(data.privateMarker))
      assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0')
    }
  }
})

test('missing configuration, other identity and unavailable identity fail closed', async () => {
  const req = new Request('https://example.test/status.json')
  assert.equal((await app.fetch(req, {}, context({ email: env.OWNER_EMAIL }))).status, 503)
  for (const identity of [{ email: 'other@example.test' }, undefined, { email: [env.OWNER_EMAIL] }]) {
    const r = await app.fetch(req, env, context(identity))
    assert.equal(r.status, 403)
    assert.ok(!(await r.text()).includes(data.privateMarker))
  }
  assert.equal((await app.fetch(req, env, { access: { getIdentity: async () => { throw new Error('unavailable') } } })).status, 403)
})

test('only the authenticated owner can read HTML and JSON, with no shared caching', async () => {
  const ctx = context({ email: 'Owner@example.test' })
  const html = await app.fetch(new Request('https://example.test/'), env, ctx)
  assert.equal(html.status, 200)
  assert.ok((await html.text()).includes(data.privateMarker))
  const json = await app.fetch(new Request('https://example.test/status.json'), env, ctx)
  assert.deepEqual(await json.json(), data)
  for (const r of [html, json]) {
    assert.match(r.headers.get('cache-control'), /no-store/)
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.match(r.headers.get('x-robots-tag'), /noindex/)
    assert.equal(r.headers.get('access-control-allow-origin'), null)
  }
  const head = await app.fetch(new Request('https://example.test/', { method: 'HEAD' }), env, ctx)
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal((await app.fetch(new Request('https://example.test/', { method: 'POST' }), env, ctx)).status, 405)
  assert.equal((await app.fetch(new Request('https://example.test/missing'), env, ctx)).status, 404)
})
