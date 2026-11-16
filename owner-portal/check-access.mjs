import assert from 'node:assert/strict'

const base = new URL(process.argv[2] || 'https://realm-project-status.heidlhannes95.workers.dev')
assert.equal(base.protocol, 'https:')
for (const path of ['/', '/status.json', '/missing']) {
  for (const spoof of [false, true]) {
    const response = await fetch(new URL(path, base), {
      redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: spoof ? { 'Cf-Access-Authenticated-User-Email': 'owner@example.test', 'Cf-Access-Jwt-Assertion': 'forged' } : {},
    })
    assert.ok([302, 303, 307, 308, 403].includes(response.status), `${path}: unexpected ${response.status}`)
    const body = await response.text()
    assert.ok(!body.includes('reviewedAt') && !body.includes('Release-Checkliste'), `${path}: project data exposed`)
    if (response.status !== 403) {
      const destination = new URL(response.headers.get('location'), base)
      assert.equal(destination.protocol, 'https:')
      assert.ok(destination.hostname.endsWith('.cloudflareaccess.com') ||
        (destination.origin === base.origin && destination.pathname.startsWith('/cdn-cgi/access/')),
      `Unexpected login destination: ${destination.origin}`)
    }
    console.log(`${path} ${spoof ? 'forged identity' : 'anonymous'}: protected (${response.status})`)
  }
}
console.log('Anonymous denial verified. Owner login still requires a separate browser check.')
