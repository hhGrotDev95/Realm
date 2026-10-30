#!/usr/bin/env node

import { randomUUID } from 'node:crypto'

const TIMEOUT_MS = 10_000

function fail(message) {
  throw new Error(message)
}

function parseOrigin(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    fail('Pass an absolute HTTP(S) origin, for example https://staging.example.com')
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    fail('The URL must be an HTTP(S) origin without credentials, path, query, or fragment')
  }

  return url.origin
}

async function get(origin, path, headers = {}) {
  let response
  try {
    response = await fetch(new URL(path, origin), {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    const detail = error.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000}s` : error.message
    fail(`GET ${path} failed: ${detail}`)
  }
  return response
}

function contentType(response) {
  return (response.headers.get('content-type') ?? '').toLowerCase()
}

async function expectJson(response, label) {
  if (!response.ok) fail(`${label}: expected HTTP 200, got ${response.status}`)
  if (!contentType(response).includes('application/json')) fail(`${label}: expected JSON, got ${contentType(response) || 'no content-type'}`)
  try {
    return await response.json()
  } catch {
    fail(`${label}: invalid JSON response`)
  }
}

async function main() {
  const arg = process.argv[2]
  const expectedCommit = process.argv[3]
  if (!arg || process.argv.length < 3 || process.argv.length > 4) fail('Usage: node scripts/check-staging.mjs <https://staging-origin> [expected-commit]')
  if (expectedCommit && !/^[0-9a-f]{40}$/i.test(expectedCommit)) fail('Expected commit must be a full 40-character hexadecimal hash')
  const origin = parseOrigin(arg)
  const passed = []

  const shell = await get(origin, '/')
  if (!shell.ok) fail(`GET /: expected HTTP 200, got ${shell.status}`)
  if (!contentType(shell).includes('text/html')) fail(`GET /: expected HTML, got ${contentType(shell) || 'no content-type'}`)
  const html = await shell.text()
  if (!html.includes('id="root"') || !html.includes('Realm')) fail('GET /: response does not look like the Realm app shell')
  passed.push('app shell')

  const buildInfo = await expectJson(await get(origin, '/build-info.json'), 'GET /build-info.json')
  if (buildInfo.environment !== 'staging') fail('GET /build-info.json: expected environment "staging"')
  if (typeof buildInfo.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(buildInfo.commit)) fail('GET /build-info.json: expected a full 40-character commit hash')
  if (typeof buildInfo.dirty !== 'boolean') fail('GET /build-info.json: expected dirty to be a boolean')
  if (typeof buildInfo.builtAt !== 'string' || !Number.isFinite(Date.parse(buildInfo.builtAt))) fail('GET /build-info.json: expected a parseable builtAt timestamp')
  if (expectedCommit && buildInfo.commit.toLowerCase() !== expectedCommit.toLowerCase()) fail(`Build commit mismatch: expected ${expectedCommit}, got ${buildInfo.commit}`)
  if (expectedCommit && buildInfo.dirty !== false) fail('Build is marked dirty; an expected commit requires a clean build')
  passed.push(`staging build provenance (${buildInfo.commit}${buildInfo.dirty ? ', dirty' : ''})`)

  const status = await get(origin, '/development')
  if (!status.ok) fail(`GET /development: expected HTTP 200, got ${status.status}`)
  if (!contentType(status).includes('text/html')) fail(`GET /development: expected HTML, got ${contentType(status) || 'no content-type'}`)
  const statusHtml = await status.text()
  const previewTitle = '<title>Entwicklungsvorschau · realm-festival</title>'
  if (!statusHtml.includes(previewTitle)) fail('GET /development: expected preview title is missing')
  if (!statusHtml.includes(buildInfo.commit)) fail('GET /development: build commit does not match build-info.json')
  passed.push('development status page')

  const worker = await get(origin, '/sw.js')
  if (!worker.ok) fail(`GET /sw.js: expected HTTP 200, got ${worker.status}`)
  if (contentType(worker).includes('text/html')) fail('GET /sw.js: received HTML instead of the service worker')
  if (!(await worker.text()).includes("addEventListener('fetch'")) fail('GET /sw.js: response does not look like a service worker')
  passed.push('service worker')

  const manifest = await expectJson(await get(origin, '/sw-assets.json'), 'GET /sw-assets.json')
  if (typeof manifest.version !== 'string' || !manifest.version || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.some((file) => typeof file !== 'string' || !file)) {
    fail('GET /sw-assets.json: expected a version and at least one asset filename')
  }
  passed.push(`asset manifest (${manifest.files.length} files)`)

  const asset = manifest.files.find((file) => /^assets\/[^/]+\.(?:js|css)$/.test(file))
  if (!asset) fail('GET /sw-assets.json: no JS or CSS asset found under assets/')
  const assetPath = `/${asset}`
  const assetUrl = new URL(assetPath, origin)
  if (assetUrl.origin !== origin || !assetUrl.pathname.startsWith('/assets/')) fail('Manifest asset must resolve to a same-origin /assets/ path')
  const assetResponse = await get(origin, assetPath)
  if (!assetResponse.ok) fail(`GET ${assetPath}: expected HTTP 200, got ${assetResponse.status}`)
  if (contentType(assetResponse).includes('text/html')) fail(`GET ${assetPath}: received HTML instead of an app asset`)
  passed.push(`app asset (${assetPath})`)

  const health = await expectJson(await get(origin, '/api/health'), 'GET /api/health')
  if (health.ok !== true) fail('GET /api/health: expected { ok: true }')
  passed.push('API health')

  const festivals = await expectJson(await get(origin, '/api/festivals'), 'GET /api/festivals')
  if (!Array.isArray(festivals) || festivals.length === 0) fail('GET /api/festivals: expected at least one published festival')
  const first = festivals[0]
  if (!first || typeof first.slug !== 'string' || !first.slug || typeof first.name !== 'string' || !first.name) {
    fail('GET /api/festivals: first entry must have a slug and name')
  }
  passed.push(`published festivals (${festivals.length})`)

  const document = await expectJson(await get(origin, `/api/festivals/${encodeURIComponent(first.slug)}`), `GET /api/festivals/${first.slug}`)
  if (!document.festival || document.festival.slug !== first.slug || document.festival.status !== 'published') {
    fail('Festival document: expected the first listed festival in published status')
  }
  for (const key of ['days', 'stages', 'acts', 'pois', 'faq']) {
    if (!Array.isArray(document[key])) fail(`Festival document: expected ${key} to be an array`)
  }
  passed.push('published festival document')

  const missingPath = `/api/__staging-smoke-missing-${randomUUID()}`
  const missing = await get(origin, missingPath, { 'Sec-Fetch-Mode': 'navigate' })
  if (missing.status !== 404) fail(`GET ${missingPath}: expected API 404, got ${missing.status}`)
  if (contentType(missing).includes('text/html')) fail(`GET ${missingPath}: API miss returned the HTML app shell`)
  if (!contentType(missing).includes('application/json')) fail(`GET ${missingPath}: expected a JSON 404, got ${contentType(missing) || 'no content-type'}`)
  passed.push('API 404 stays JSON for navigation requests')

  for (const check of passed) console.log(`✓ ${check}`)
  console.log(`Staging smoke passed: ${origin}`)
}

main().catch((error) => {
  console.error(`Staging smoke failed: ${error.message}`)
  process.exitCode = 1
})
