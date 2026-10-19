import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { HttpError, normalizeCode, randomCode, randomId, randomToken, sha256, v } from './util'

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
}

type Guest = { id: string; nickname: string | null; color: string }
type App = { Bindings: Env; Variables: { guest: Guest } }

const MIN = 60_000
const REPORT_TTL = 60 * MIN
const STILL_EXTENDS = 30 * MIN
const FIXED_TO_RETIRE = 2
const LOCATIONS = ['generator', 'archive', 'lagoon', 'forest', 'observatory', 'camp'] as const
const SEVERITIES = ['info', 'warning'] as const

const app = new Hono<App>()

app.use('/api/*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return cors({ origin: (o) => (allowed.includes('*') || allowed.includes(o) ? o : null), allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 86400 })(c, next)
})

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Interner Fehler' }, 500)
})
app.notFound((c) => c.json({ error: 'Nicht gefunden' }, 404))

const body = async (c: Context) => {
  try {
    const b = await c.req.json()
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw 0
    return b as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'JSON-Body erwartet')
  }
}

async function rateLimit(db: D1Database, key: string, limit: number, windowMs: number) {
  const win = Math.floor(Date.now() / windowMs) * windowMs
  const row = await db
    .prepare('INSERT INTO rate (key, window, count) VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = ?2 THEN count + 1 ELSE 1 END, window = ?2 RETURNING count')
    .bind(key, win)
    .first<{ count: number }>()
  if (row && row.count > limit) throw new HttpError(429, 'Zu viele Anfragen – bitte kurz warten')
}

// Bearer auth for everything except guest creation, restore and health.
const auth = async (c: Context<App>, next: () => Promise<void>) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Nicht angemeldet')
  const g = await c.env.DB.prepare('SELECT id, nickname, color FROM guests WHERE token_hash = ?').bind(await sha256(token)).first<Guest>()
  if (!g) throw new HttpError(401, 'Sitzung ungültig')
  c.set('guest', g)
  await next()
}

const requireName = (g: Guest) => {
  if (!g.nickname) throw new HttpError(403, 'Bitte zuerst einen Namen wählen')
}

async function membership(db: D1Database, crewId: string, guestId: string) {
  const m = await db.prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND guest_id = ?').bind(crewId, guestId).first()
  if (!m) throw new HttpError(404, 'Crew nicht gefunden')
}

app.get('/api/health', (c) => c.json({ ok: true }))

/* ---------- Guest identity ---------- */

app.post('/api/guests', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local'
  await rateLimit(c.env.DB, 'guest:' + ip, 20, 60 * MIN)
  const b = await body(c).catch(() => ({}) as Record<string, unknown>)
  const nickname = v.str(b.nickname, 'Name', { max: 20, optional: true }) ?? null
  const color = v.color(b.color) ?? '#A58CFF'
  const id = randomId('g')
  const token = randomToken()
  await c.env.DB.prepare('INSERT INTO guests (id, token_hash, nickname, color, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, await sha256(token), nickname, color, Date.now()).run()
  return c.json({ id, token, nickname, color }, 201)
})

app.post('/api/restore', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local'
  await rateLimit(c.env.DB, 'restore:' + ip, 10, 60 * MIN)
  const code = normalizeCode(v.str((await body(c)).code, 'Code', { max: 40 })!)
  const g = await c.env.DB.prepare('SELECT id, nickname, color FROM guests WHERE recovery_hash = ?').bind(await sha256(code)).first<Guest>()
  if (!g) throw new HttpError(404, 'Code nicht gefunden')
  const token = randomToken()
  await c.env.DB.prepare('UPDATE guests SET token_hash = ? WHERE id = ?').bind(await sha256(token), g.id).run()
  return c.json({ ...g, token })
})

app.use('/api/me', auth)
app.use('/api/me/*', auth)
app.use('/api/crews', auth)
app.use('/api/crews/*', auth)
app.use('/api/meetups/*', auth)
app.use('/api/reports', auth)
app.use('/api/reports/*', auth)

app.get('/api/me', async (c) => {
  const g = c.get('guest')
  const crews = await c.env.DB.prepare('SELECT c.id, c.name, c.code FROM crews c JOIN crew_members m ON m.crew_id = c.id WHERE m.guest_id = ? ORDER BY m.joined_at').bind(g.id).all()
  const plan = await c.env.DB.prepare('SELECT act_id FROM plans WHERE guest_id = ?').bind(g.id).all<{ act_id: string }>()
  const secured = await c.env.DB.prepare('SELECT recovery_hash IS NOT NULL AS s FROM guests WHERE id = ?').bind(g.id).first<{ s: number }>()
  return c.json({ ...g, secured: !!secured?.s, crews: crews.results, plan: plan.results.map((r) => r.act_id) })
})

app.patch('/api/me', async (c) => {
  const g = c.get('guest')
  const b = await body(c)
  const nickname = v.str(b.nickname, 'Name', { max: 20, optional: true }) ?? g.nickname
  const color = v.color(b.color) ?? g.color
  await c.env.DB.prepare('UPDATE guests SET nickname = ?, color = ? WHERE id = ?').bind(nickname, color, g.id).run()
  return c.json({ ...g, nickname, color })
})

// Right to erasure: removes the guest and everything that cascades from it.
app.delete('/api/me', async (c) => {
  const id = c.get('guest').id
  await c.env.DB.batch([
    // crews nobody else belongs to go with the guest; everything else cascades
    c.env.DB.prepare('DELETE FROM crews WHERE id IN (SELECT crew_id FROM crew_members WHERE guest_id = ?1) AND NOT EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = crews.id AND m.guest_id != ?1)').bind(id),
    c.env.DB.prepare('DELETE FROM guests WHERE id = ?').bind(id),
  ])
  return c.body(null, 204)
})

app.post('/api/me/recovery', async (c) => {
  const code = randomCode(4)
  await c.env.DB.prepare('UPDATE guests SET recovery_hash = ? WHERE id = ?').bind(await sha256(code), c.get('guest').id).run()
  return c.json({ code })
})

app.put('/api/me/plan', async (c) => {
  const acts = (await body(c)).acts
  if (!Array.isArray(acts) || acts.length > 200 || !acts.every((a) => typeof a === 'string' && a.length <= 60)) throw new HttpError(400, 'acts ist ungültig')
  const id = c.get('guest').id
  const unique = [...new Set(acts as string[])]
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM plans WHERE guest_id = ?').bind(id), ...unique.map((a) => c.env.DB.prepare('INSERT INTO plans (guest_id, act_id) VALUES (?, ?)').bind(id, a))])
  return c.json({ acts: unique })
})

app.put('/api/me/steps', async (c) => {
  const b = await body(c)
  const day = v.int(b.day, 'day', 0, 2)
  const total = v.int(b.total, 'total', 0, 150_000)
  await c.env.DB.prepare('INSERT INTO steps (guest_id, day, total, synced_at) VALUES (?, ?, ?, ?) ON CONFLICT(guest_id, day) DO UPDATE SET total = excluded.total, synced_at = excluded.synced_at')
    .bind(c.get('guest').id, day, total, Date.now())
    .run()
  return c.json({ day, total })
})

app.delete('/api/me/steps', async (c) => {
  await c.env.DB.prepare('DELETE FROM steps WHERE guest_id = ?').bind(c.get('guest').id).run()
  return c.body(null, 204)
})

/* ---------- Crews ---------- */

app.post('/api/crews', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'crew:' + g.id, 10, 60 * MIN)
  const name = v.str((await body(c)).name, 'Crew-Name', { max: 40 })!
  const id = randomId('c')
  const code = randomCode(2)
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO crews (id, code, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, code, name, g.id, now),
    c.env.DB.prepare('INSERT INTO crew_members (crew_id, guest_id, joined_at) VALUES (?, ?, ?)').bind(id, g.id, now),
  ])
  return c.json({ id, name, code }, 201)
})

app.post('/api/crews/join', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'join:' + g.id, 20, 60 * MIN)
  const code = normalizeCode(v.str((await body(c)).code, 'Code', { max: 20 })!)
  const crew = await c.env.DB.prepare('SELECT id, name, code FROM crews WHERE code = ?').bind(code).first<{ id: string; name: string; code: string }>()
  if (!crew) throw new HttpError(404, 'Einladung nicht gefunden')
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?').bind(crew.id).first<{ n: number }>()
  if ((count?.n ?? 0) >= 50) throw new HttpError(409, 'Crew ist voll (max. 50)')
  await c.env.DB.prepare('INSERT OR IGNORE INTO crew_members (crew_id, guest_id, joined_at) VALUES (?, ?, ?)').bind(crew.id, g.id, Date.now()).run()
  return c.json(crew)
})

app.post('/api/crews/:id/leave', async (c) => {
  await c.env.DB.prepare('DELETE FROM crew_members WHERE crew_id = ? AND guest_id = ?').bind(c.req.param('id'), c.get('guest').id).run()
  return c.body(null, 204)
})

/** Everything a crew screen needs in one round trip; `since` limits messages to new ones. */
app.get('/api/crews/:id', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  await membership(c.env.DB, crewId, g.id)
  const since = Number(c.req.query('since') ?? 0) || 0
  const db = c.env.DB
  const [crew, members, plans, steps, messages, meetups, rsvps] = await db.batch([
    db.prepare('SELECT id, name, code FROM crews WHERE id = ?').bind(crewId),
    db.prepare(
      'SELECT g.id, g.nickname, g.color, m.share_location, CASE WHEN m.share_location = 1 THEN m.location END AS location, CASE WHEN m.share_location = 1 THEN m.location_at END AS location_at FROM crew_members m JOIN guests g ON g.id = m.guest_id WHERE m.crew_id = ? ORDER BY m.joined_at',
    ).bind(crewId),
    db.prepare('SELECT p.guest_id, p.act_id FROM plans p JOIN crew_members m ON m.guest_id = p.guest_id WHERE m.crew_id = ?').bind(crewId),
    db.prepare('SELECT s.guest_id, s.day, s.total, s.synced_at FROM steps s JOIN crew_members m ON m.guest_id = s.guest_id WHERE m.crew_id = ?').bind(crewId),
    db.prepare('SELECT * FROM (SELECT id, guest_id, text, created_at FROM messages WHERE crew_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 200) ORDER BY created_at').bind(crewId, since),
    db.prepare('SELECT id, created_by, place, poi, act_id, day, min, note, created_at FROM meetups WHERE crew_id = ? ORDER BY day, min').bind(crewId),
    db.prepare('SELECT r.meetup_id, r.guest_id, r.going FROM rsvps r JOIN meetups mt ON mt.id = r.meetup_id WHERE mt.crew_id = ?').bind(crewId),
  ])
  type R = Record<string, unknown>
  const planBy: Record<string, string[]> = {}
  for (const p of plans.results as R[]) (planBy[p.guest_id as string] ??= []).push(p.act_id as string)
  const stepsBy: Record<string, { day: number; total: number; syncedAt: number }[]> = {}
  for (const s of steps.results as R[]) (stepsBy[s.guest_id as string] ??= []).push({ day: s.day as number, total: s.total as number, syncedAt: s.synced_at as number })
  return c.json({
    crew: crew.results[0],
    me: g.id,
    serverTime: Date.now(),
    members: (members.results as R[]).map((m) => ({
      id: m.id,
      nickname: m.nickname,
      color: m.color,
      sharing: !!m.share_location,
      location: m.location ?? null,
      locationAt: m.location_at ?? null,
      plan: planBy[m.id as string] ?? [],
      steps: stepsBy[m.id as string] ?? [],
    })),
    messages: (messages.results as R[]).map((m) => ({ id: m.id, from: m.guest_id, text: m.text, at: m.created_at })),
    meetups: (meetups.results as R[]).map((m) => ({
      id: m.id,
      createdBy: m.created_by,
      place: m.place,
      poi: m.poi,
      actId: m.act_id,
      day: m.day,
      min: m.min,
      note: m.note,
      going: (rsvps.results as R[]).filter((r) => r.meetup_id === m.id && r.going).map((r) => r.guest_id),
      declined: (rsvps.results as R[]).filter((r) => r.meetup_id === m.id && !r.going).map((r) => r.guest_id),
    })),
  })
})

app.put('/api/crews/:id/location', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  await membership(c.env.DB, crewId, g.id)
  const b = await body(c)
  const share = v.bool(b.share, 'share')
  const location = b.location === null || b.location === undefined ? null : v.oneOf(b.location, 'location', LOCATIONS)
  await c.env.DB.prepare('UPDATE crew_members SET share_location = ?, location = ?, location_at = ? WHERE crew_id = ? AND guest_id = ?')
    .bind(share ? 1 : 0, share ? location : null, share && location ? Date.now() : null, crewId, g.id)
    .run()
  return c.json({ share, location: share ? location : null })
})

app.post('/api/crews/:id/messages', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  requireName(g)
  await membership(c.env.DB, crewId, g.id)
  await rateLimit(c.env.DB, 'msg:' + g.id, 30, MIN)
  const text = v.str((await body(c)).text, 'Nachricht', { max: 500 })!
  const msg = { id: randomId('m'), from: g.id, text, at: Date.now() }
  await c.env.DB.prepare('INSERT INTO messages (id, crew_id, guest_id, text, created_at) VALUES (?, ?, ?, ?, ?)').bind(msg.id, crewId, g.id, text, msg.at).run()
  return c.json(msg, 201)
})

app.post('/api/crews/:id/meetups', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  requireName(g)
  await membership(c.env.DB, crewId, g.id)
  await rateLimit(c.env.DB, 'meetup:' + g.id, 20, 60 * MIN)
  const b = await body(c)
  const m = {
    id: randomId('mt'),
    place: v.str(b.place, 'Treffpunkt', { max: 60 })!,
    poi: v.str(b.poi, 'poi', { max: 40, optional: true }) ?? null,
    actId: v.str(b.actId, 'actId', { max: 60, optional: true }) ?? null,
    day: v.int(b.day, 'day', 0, 3),
    min: v.int(b.min, 'min', 0, 30 * 60),
    note: v.str(b.note, 'Notiz', { max: 140, optional: true }) ?? '',
  }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO meetups (id, crew_id, created_by, place, poi, act_id, day, min, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(m.id, crewId, g.id, m.place, m.poi, m.actId, m.day, m.min, m.note, Date.now()),
    c.env.DB.prepare('INSERT INTO rsvps (meetup_id, guest_id, going) VALUES (?, ?, 1)').bind(m.id, g.id),
  ])
  return c.json({ ...m, createdBy: g.id, going: [g.id], declined: [] }, 201)
})

async function meetupFor(c: Context<App>) {
  const m = await c.env.DB.prepare('SELECT id, crew_id, created_by FROM meetups WHERE id = ?').bind(c.req.param('id')).first<{ id: string; crew_id: string; created_by: string }>()
  if (!m) throw new HttpError(404, 'Meetup nicht gefunden')
  await membership(c.env.DB, m.crew_id, c.get('guest').id)
  return m
}

app.put('/api/meetups/:id/rsvp', async (c) => {
  const g = c.get('guest')
  requireName(g)
  const m = await meetupFor(c)
  const going = v.bool((await body(c)).going, 'going')
  await c.env.DB.prepare('INSERT INTO rsvps (meetup_id, guest_id, going) VALUES (?, ?, ?) ON CONFLICT(meetup_id, guest_id) DO UPDATE SET going = excluded.going').bind(m.id, g.id, going ? 1 : 0).run()
  return c.json({ id: m.id, going })
})

app.delete('/api/meetups/:id', async (c) => {
  const m = await meetupFor(c)
  if (m.created_by !== c.get('guest').id) throw new HttpError(403, 'Nur wer eingeladen hat, kann absagen')
  await c.env.DB.prepare('DELETE FROM meetups WHERE id = ?').bind(m.id).run()
  return c.body(null, 204)
})

/* ---------- Community reports ---------- */

app.get('/api/reports', async (c) => {
  const g = c.get('guest')
  const now = Date.now()
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.place, r.poi, r.severity, r.created_at, r.expires_at, r.guest_id,
       (SELECT COUNT(*) FROM votes WHERE report_id = r.id AND kind = 'still') AS still,
       (SELECT kind FROM votes WHERE report_id = r.id AND guest_id = ?) AS my_vote
     FROM reports r WHERE r.expires_at > ? ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(g.id, now)
    .all<Record<string, unknown>>()
  return c.json(
    rows.results.map((r) => {
      const confirms = 1 + (r.still as number)
      return {
        id: r.id,
        title: r.title,
        place: r.place,
        poi: r.poi,
        severity: r.severity,
        // the reporter counts as the first confirmation; three make it "confirmed"
        source: confirms >= 3 ? 'confirmed' : 'unconfirmed',
        confirms,
        mine: r.guest_id === g.id,
        myVote: r.my_vote ?? null,
        ageMin: Math.floor((now - (r.created_at as number)) / MIN),
        validMin: Math.ceil(((r.expires_at as number) - now) / MIN),
      }
    }),
  )
})

app.post('/api/reports', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'report:' + g.id, 5, 10 * MIN)
  const b = await body(c)
  const now = Date.now()
  const r = {
    id: randomId('r'),
    title: v.str(b.title, 'Titel', { min: 3, max: 120 })!,
    place: v.str(b.place, 'Ort', { max: 60, optional: true }) ?? null,
    poi: v.str(b.poi, 'poi', { max: 40, optional: true }) ?? null,
    severity: b.severity === undefined ? 'info' : v.oneOf(b.severity, 'severity', SEVERITIES),
  }
  await c.env.DB.prepare('INSERT INTO reports (id, guest_id, title, place, poi, severity, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(r.id, g.id, r.title, r.place, r.poi, r.severity, now, now + REPORT_TTL).run()
  return c.json({ ...r, source: 'unconfirmed', confirms: 1, mine: true, myVote: null, ageMin: 0, validMin: REPORT_TTL / MIN }, 201)
})

app.put('/api/reports/:id/vote', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'vote:' + g.id, 60, 10 * MIN)
  const kind = v.oneOf((await body(c)).kind, 'kind', ['still', 'fixed'] as const)
  const id = c.req.param('id')
  const now = Date.now()
  const r = await c.env.DB.prepare('SELECT id, guest_id, expires_at FROM reports WHERE id = ? AND expires_at > ?').bind(id, now).first<{ id: string; guest_id: string; expires_at: number }>()
  if (!r) throw new HttpError(404, 'Meldung ist abgelaufen')
  await c.env.DB.prepare('INSERT INTO votes (report_id, guest_id, kind, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(report_id, guest_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at').bind(id, g.id, kind, now).run()
  if (kind === 'still') {
    await c.env.DB.prepare('UPDATE reports SET expires_at = MAX(expires_at, ?) WHERE id = ?').bind(now + STILL_EXTENDS, id).run()
  } else {
    const fixed = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE report_id = ? AND kind = 'fixed'").bind(id).first<{ n: number }>()
    // the reporter can retire their own report; otherwise two independent "fixed" votes do
    if (r.guest_id === g.id || (fixed?.n ?? 0) >= FIXED_TO_RETIRE) await c.env.DB.prepare('UPDATE reports SET expires_at = ? WHERE id = ?').bind(now, id).run()
  }
  return c.json({ id, kind })
})

export default {
  fetch: app.fetch,
  // hourly housekeeping: drop long-expired reports and stale rate windows
  async scheduled(_: ScheduledController, env: Env) {
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reports WHERE expires_at < ?').bind(now - 24 * 60 * MIN),
      env.DB.prepare('DELETE FROM rate WHERE window < ?').bind(now - 2 * 60 * MIN),
    ])
  },
}

