#!/usr/bin/env node
// Organizer CLI for official announcements.
//   REALM_API=https://… REALM_ADMIN_TOKEN=… node scripts/announce.mjs add "Gewitterwarnung ab 22:30" --severity warning --body "…" --place "Gelände" --valid 180
//   … node scripts/announce.mjs list
//   … node scripts/announce.mjs remove <id>
const API = (process.env.REALM_API ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const TOKEN = process.env.REALM_ADMIN_TOKEN

const [cmd, ...rest] = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]
  else positional.push(rest[i])
}

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = res.status === 204 ? null : await res.json()
  if (!res.ok) throw new Error(`${res.status}: ${data?.error ?? 'Fehler'}`)
  return data
}

try {
  if (cmd === 'list') {
    for (const a of await call('GET', '/api/announcements')) console.log(`${a.id}  [${a.severity}]  ${a.title}${a.validMin !== null ? `  (noch ${a.validMin} Min.)` : ''}`)
  } else if (cmd === 'add' && positional[0]) {
    if (!TOKEN) throw new Error('REALM_ADMIN_TOKEN fehlt')
    const a = await call('POST', '/api/admin/announcements', {
      title: positional[0],
      body: flags.body,
      place: flags.place,
      poi: flags.poi,
      severity: flags.severity,
      validMin: flags.valid ? Number(flags.valid) : undefined,
    })
    console.log(`Veröffentlicht: ${a.id}`)
  } else if (cmd === 'remove' && positional[0]) {
    if (!TOKEN) throw new Error('REALM_ADMIN_TOKEN fehlt')
    await call('DELETE', `/api/admin/announcements/${positional[0]}`)
    console.log('Entfernt')
  } else {
    console.log('Verwendung: announce.mjs list | add "<Titel>" [--severity info|warning|critical] [--body …] [--place …] [--poi …] [--valid <Min.>] | remove <id>')
    process.exitCode = 2
  }
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
}
