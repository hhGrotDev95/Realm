import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { defaultOn, isEnabled, MODULE_KEYS, moduleConflicts, MODULES, type ModuleKey, type ModuleState } from '../../src/modules'
import { checkBrand, HEX } from '../../src/theme/contrast'
import { HttpError, normalizeCode, randomCode, randomId, randomToken, sha256, v } from './util'

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
  /** Organizer secret (`wrangler secret put ADMIN_TOKEN`); admin routes are disabled without it. */
  ADMIN_TOKEN?: string
}

type Guest = { id: string; nickname: string | null; color: string }
type Festival = { id: string; slug: string; status: 'draft' | 'published' | 'archived'; stages: string[]; modules: ModuleState }
type App = { Bindings: Env; Variables: { guest: Guest; festival: Festival; isAdmin: boolean } }

const MIN = 60_000
const FLAGS_TO_HIDE = 2
/** The public festival chat needs more voices to hide a message than a crew of friends. */
const PUBLIC_FLAGS_TO_HIDE = 3
/** A location share ends on its own when the app has not confirmed it for this long. */
const LOCATION_TTL = 120 * MIN
const REPORT_TTL = 60 * MIN
const STILL_EXTENDS = 30 * MIN
const FIXED_TO_RETIRE = 2
const SEVERITIES = ['info', 'warning'] as const

const app = new Hono<App>()

app.use('/api/*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return cors({ origin: (o) => (allowed.includes('*') || allowed.includes(o) ? o : null), allowHeaders: ['Authorization', 'Content-Type', 'X-Festival'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 86400 })(c, next)
})

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Interner Fehler' }, 500)
})
app.notFound((c) => c.json({ error: 'Nicht gefunden' }, 404))

/**
 * Clients may send their own id so a retried request (offline queue) is stored once.
 * A replay by the same guest returns the existing row; someone else's id is a conflict.
 */
function clientId(raw: unknown, prefix: string) {
  if (raw === undefined) return randomId(prefix)
  if (typeof raw !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9_-]{10,40}$`).test(raw)) throw new HttpError(400, 'id ist ungültig')
  return raw
}

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

/** Membership is checked together with the tenant: a crew of another festival does not exist here. */
async function membership(c: Context<App>, crewId: string, guestId = c.get('guest').id) {
  const m = await c.env.DB.prepare('SELECT 1 FROM crew_members m JOIN crews c ON c.id = m.crew_id WHERE m.crew_id = ? AND m.guest_id = ? AND c.festival_id = ?')
    .bind(crewId, guestId, c.get('festival').id)
    .first()
  if (!m) throw new HttpError(404, 'Crew nicht gefunden')
}

async function isAdminRequest(c: Context<App>) {
  const expected = c.env.ADMIN_TOKEN
  if (!expected) return false
  const given = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  // constant-time comparison via hashing both sides
  const [a, b] = await Promise.all([sha256(given), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function loadFestival(db: D1Database, slug: string): Promise<Festival | null> {
  const f = await db.prepare('SELECT id, slug, status, modules FROM festivals WHERE slug = ?').bind(slug).first<Omit<Festival, 'stages' | 'modules'> & { modules: string }>()
  if (!f) return null
  const stages = await db.prepare('SELECT id FROM stages WHERE festival_id = ?').bind(f.id).all<{ id: string }>()
  return { ...f, modules: JSON.parse(f.modules || '{}') as ModuleState, stages: stages.results.map((s) => s.id) }
}

/**
 * Resolves the tenant from the X-Festival header (a slug) on the server. Drafts exist only for
 * admins; archived festivals are read-only until reactivated.
 */
const tenant = async (c: Context<App>, next: () => Promise<void>) => {
  const slug = c.req.header('X-Festival')
  if (!slug) throw new HttpError(400, 'X-Festival fehlt')
  const f = await loadFestival(c.env.DB, slug)
  const admin = c.get('isAdmin') ?? (await isAdminRequest(c))
  if (!f || (f.status === 'draft' && !admin)) throw new HttpError(404, 'Festival nicht gefunden')
  // withdrawing consent, deleting data and leaving always work – an organizer's switch must never lock people in
  const privacy = isPrivacyAction(c.req.method, c.req.path)
  if (f.status === 'archived' && c.req.method !== 'GET' && !admin && !privacy) throw new HttpError(403, 'Festival ist archiviert und schreibgeschützt')
  c.set('festival', f)
  // switched-off modules do not exist for this festival – not even for clients that ignore the UI
  const mod = moduleFor(c.req.path)
  if (mod && !privacy && !isEnabled(f.modules, mod)) throw new HttpError(403, `„${MODULES[mod].label}“ ist bei diesem Festival nicht aktiviert`)
  await next()
}

/**
 * Requests that withdraw consent or delete data. The location route only counts when it stops
 * sharing; the route itself refuses share:true while the module is off or the festival archived.
 */
function isPrivacyAction(method: string, path: string) {
  if (method === 'DELETE' && path === '/api/me/steps') return true
  if (method === 'POST' && /^\/api\/crews\/[^/]+\/leave$/.test(path)) return true
  if (method === 'PUT' && /^\/api\/crews\/[^/]+\/location$/.test(path)) return true
  return false
}

function moduleFor(path: string): ModuleKey | null {
  if (/^\/api\/crews\/[^/]+\/messages/.test(path)) return 'chat'
  if (/^\/api\/crews\/[^/]+\/location$/.test(path)) return 'location'
  if (path.startsWith('/api/crews') || path.startsWith('/api/meetups')) return 'crew'
  if (path.startsWith('/api/me/steps')) return 'steps'
  if (path.startsWith('/api/reports')) return 'reports'
  if (path.startsWith('/api/faq/')) return 'faqbot'
  if (path.startsWith('/api/festival-chat')) return 'festivalchat'
  return null
}

async function actExists(c: Context<App>, actId: string) {
  return !!(await c.env.DB.prepare('SELECT 1 FROM acts WHERE festival_id = ? AND id = ?').bind(c.get('festival').id, actId).first())
}

app.get('/api/health', (c) => c.json({ ok: true }))

/* ---------- Festivals (public) ---------- */

type FestivalRow = { id: string; slug: string; name: string; location: string | null; status: string; theme: string; modules: string; site_map: string | null; updated_at: number }

app.get('/api/festivals', async (c) => {
  const rows = await c.env.DB.prepare("SELECT slug, name, location FROM festivals WHERE status = 'published' ORDER BY name").all()
  return c.json(rows.results)
})

/** Everything the visitor app needs to render a festival, in one cacheable document. */
app.get('/api/festivals/:slug', async (c) => {
  const f = await c.env.DB.prepare('SELECT * FROM festivals WHERE slug = ?').bind(c.req.param('slug')).first<FestivalRow>()
  if (!f || (f.status === 'draft' && !(await isAdminRequest(c)))) throw new HttpError(404, 'Festival nicht gefunden')
  const db = c.env.DB
  const [days, stages, acts, pois, faqs] = await db.batch([
    db.prepare('SELECT idx, date, label, short FROM festival_days WHERE festival_id = ? ORDER BY idx').bind(f.id),
    db.prepare('SELECT id, name, color, x, y, vibe FROM stages WHERE festival_id = ? ORDER BY sort, name').bind(f.id),
    db.prepare('SELECT id, day, stage_id AS stage, artist, start_min AS start, end_min AS "end", genre, bio, popularity FROM acts WHERE festival_id = ? ORDER BY day, start_min').bind(f.id),
    db.prepare('SELECT id, cat, name, x, y, detail, status, important FROM pois WHERE festival_id = ? ORDER BY rowid').bind(f.id),
    db.prepare("SELECT id, question, answer, category, keywords, source, updated_at AS updatedAt, question_en, answer_en, keywords_en FROM faqs WHERE festival_id = ? AND status = 'published' ORDER BY sort, category, question").bind(f.id),
  ])
  return c.json({
    festival: { slug: f.slug, name: f.name, location: f.location, status: f.status, theme: JSON.parse(f.theme), modules: JSON.parse(f.modules), siteMap: f.site_map, updatedAt: f.updated_at },
    days: days.results,
    stages: stages.results,
    acts: acts.results,
    // stage pins come from the stages themselves, so every stage is on the map and positions have one source
    pois: [
      ...(stages.results as { id: string; name: string; x: number; y: number; vibe: string }[]).map((s) => ({ id: 'stage-' + s.id, cat: 'stage', name: s.name, x: s.x, y: s.y, detail: s.vibe, important: true })),
      ...(pois.results as Record<string, unknown>[]).map((p) => ({ ...p, status: p.status ?? undefined, important: !!p.important })),
    ],
    // published answers travel with the festival document, so FAQ and bot work offline
    faq: isEnabled(JSON.parse(f.modules) as ModuleState, 'faq') ? (faqs.results as FaqRow[]).map(publicFaq) : [],
  })
})

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
app.use('/api/festival-chat', auth)
app.use('/api/festival-chat/*', auth)

// tenant-scoped routes (the profile itself – PATCH/DELETE /api/me, recovery – is global)
for (const path of ['/api/me/plan', '/api/me/steps', '/api/crews', '/api/crews/*', '/api/meetups/*', '/api/reports', '/api/reports/*', '/api/announcements', '/api/timetable/*', '/api/faq/*', '/api/festival-chat', '/api/festival-chat/*'])
  app.use(path, tenant)
app.get('/api/me', tenant)

app.get('/api/me', async (c) => {
  const g = c.get('guest')
  const fid = c.get('festival').id
  const crews = await c.env.DB.prepare('SELECT c.id, c.name, c.code FROM crews c JOIN crew_members m ON m.crew_id = c.id WHERE m.guest_id = ? AND c.festival_id = ? ORDER BY m.joined_at').bind(g.id, fid).all()
  const plan = await c.env.DB.prepare('SELECT act_id FROM plans WHERE guest_id = ? AND festival_id = ?').bind(g.id, fid).all<{ act_id: string }>()
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
  const fid = c.get('festival').id
  // only acts of this festival are stored; unknown ids (stale or foreign) are reported back
  const known = new Set((await c.env.DB.prepare('SELECT id FROM acts WHERE festival_id = ?').bind(fid).all<{ id: string }>()).results.map((r) => r.id))
  const unique = [...new Set(acts as string[])]
  const accepted = unique.filter((a) => known.has(a))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM plans WHERE guest_id = ? AND festival_id = ?').bind(id, fid),
    ...accepted.map((a) => c.env.DB.prepare('INSERT INTO plans (guest_id, festival_id, act_id) VALUES (?, ?, ?)').bind(id, fid, a)),
  ])
  return c.json({ acts: accepted, rejected: unique.filter((a) => !known.has(a)) })
})

app.put('/api/me/steps', async (c) => {
  const b = await body(c)
  const day = v.int(b.day, 'day', 0, 13)
  const total = v.int(b.total, 'total', 0, 150_000)
  await c.env.DB.prepare('INSERT INTO steps (guest_id, festival_id, day, total, synced_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guest_id, festival_id, day) DO UPDATE SET total = excluded.total, synced_at = excluded.synced_at')
    .bind(c.get('guest').id, c.get('festival').id, day, total, Date.now())
    .run()
  return c.json({ day, total })
})

app.delete('/api/me/steps', async (c) => {
  await c.env.DB.prepare('DELETE FROM steps WHERE guest_id = ? AND festival_id = ?').bind(c.get('guest').id, c.get('festival').id).run()
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
    c.env.DB.prepare('INSERT INTO crews (id, festival_id, code, name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, c.get('festival').id, code, name, g.id, now),
    c.env.DB.prepare('INSERT INTO crew_members (crew_id, guest_id, joined_at) VALUES (?, ?, ?)').bind(id, g.id, now),
  ])
  return c.json({ id, name, code }, 201)
})

app.post('/api/crews/join', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'join:' + g.id, 20, 60 * MIN)
  const code = normalizeCode(v.str((await body(c)).code, 'Code', { max: 20 })!)
  const crew = await c.env.DB.prepare('SELECT id, name, code FROM crews WHERE code = ? AND festival_id = ?').bind(code, c.get('festival').id).first<{ id: string; name: string; code: string }>()
  if (!crew) throw new HttpError(404, 'Einladung nicht gefunden')
  const banned = await c.env.DB.prepare('SELECT 1 FROM crew_bans WHERE crew_id = ? AND guest_id = ?').bind(crew.id, g.id).first()
  if (banned) throw new HttpError(403, 'Du wurdest aus dieser Crew entfernt')
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?').bind(crew.id).first<{ n: number }>()
  if ((count?.n ?? 0) >= 50) throw new HttpError(409, 'Crew ist voll (max. 50)')
  await c.env.DB.prepare('INSERT OR IGNORE INTO crew_members (crew_id, guest_id, joined_at) VALUES (?, ?, ?)').bind(crew.id, g.id, Date.now()).run()
  return c.json(crew)
})

app.post('/api/crews/:id/leave', async (c) => {
  await membership(c, c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM crew_members WHERE crew_id = ? AND guest_id = ?').bind(c.req.param('id'), c.get('guest').id).run()
  return c.body(null, 204)
})

/** Everything a crew screen needs in one round trip; `since` limits messages to new ones. */
app.get('/api/crews/:id', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  await membership(c, crewId)
  const since = Number(c.req.query('since') ?? 0) || 0
  const db = c.env.DB
  const [crew, members, plans, steps, messages, meetups, rsvps] = await db.batch([
    db.prepare('SELECT id, name, code, created_by AS owner FROM crews WHERE id = ?').bind(crewId),
    db.prepare(
      `SELECT g.id, g.nickname, g.color, (m.share_location = 1 AND m.location_at > ${Date.now() - LOCATION_TTL}) AS share_location, CASE WHEN m.share_location = 1 AND m.location_at > ${Date.now() - LOCATION_TTL} THEN m.location END AS location, CASE WHEN m.share_location = 1 AND m.location_at > ${Date.now() - LOCATION_TTL} THEN m.location_at END AS location_at FROM crew_members m JOIN guests g ON g.id = m.guest_id WHERE m.crew_id = ? ORDER BY m.joined_at`,
    ).bind(crewId),
    db.prepare('SELECT p.guest_id, p.act_id FROM plans p JOIN crew_members m ON m.guest_id = p.guest_id WHERE m.crew_id = ? AND p.festival_id = ?').bind(crewId, c.get('festival').id),
    db.prepare('SELECT s.guest_id, s.day, s.total, s.synced_at FROM steps s JOIN crew_members m ON m.guest_id = s.guest_id WHERE m.crew_id = ? AND s.festival_id = ?').bind(crewId, c.get('festival').id),
    db.prepare(
      `SELECT * FROM (
         SELECT m.id, m.guest_id, m.text, m.created_at, m.deleted,
           (SELECT COUNT(*) FROM message_flags f WHERE f.message_id = m.id) AS flags,
           EXISTS (SELECT 1 FROM message_flags f WHERE f.message_id = m.id AND f.guest_id = ?3) AS flagged_by_me
         FROM messages m
         WHERE m.crew_id = ?1 AND (m.created_at > ?2 OR m.updated_at > ?2)
         ORDER BY m.created_at DESC LIMIT 200
       ) ORDER BY created_at`,
    ).bind(crewId, since, g.id),
    db.prepare('SELECT id, created_by, place, poi, act_id, day, min, note, created_at FROM meetups WHERE crew_id = ? ORDER BY day, min').bind(crewId),
    db.prepare('SELECT r.meetup_id, r.guest_id, r.going FROM rsvps r JOIN meetups mt ON mt.id = r.meetup_id WHERE mt.crew_id = ?').bind(crewId),
  ])
  type R = Record<string, unknown>
  const mods = c.get('festival').modules
  const chatOn = isEnabled(mods, 'chat')
  const locationOn = isEnabled(mods, 'location')
  const stepsOn = isEnabled(mods, 'steps')
  const planBy: Record<string, string[]> = {}
  for (const p of plans.results as R[]) (planBy[p.guest_id as string] ??= []).push(p.act_id as string)
  const stepsBy: Record<string, { day: number; total: number; syncedAt: number }[]> = {}
  for (const s of steps.results as R[]) (stepsBy[s.guest_id as string] ??= []).push({ day: s.day as number, total: s.total as number, syncedAt: s.synced_at as number })
  return c.json({
    crew: { ...(crew.results[0] as R), owner: undefined },
    owner: (crew.results[0] as R).owner,
    me: g.id,
    serverTime: Date.now(),
    members: (members.results as R[]).map((m) => ({
      id: m.id,
      nickname: m.nickname,
      color: m.color,
      sharing: locationOn && !!m.share_location,
      location: locationOn ? (m.location ?? null) : null,
      locationAt: locationOn ? (m.location_at ?? null) : null,
      plan: planBy[m.id as string] ?? [],
      steps: stepsOn ? (stepsBy[m.id as string] ?? []) : [],
    })),
    messages: (chatOn ? (messages.results as R[]) : []).map((m) => {
      const deleted = !!m.deleted
      // hidden messages stay readable for their author, so they know what happened
      const hidden = !deleted && (m.flags as number) >= FLAGS_TO_HIDE
      return { id: m.id, from: m.guest_id, text: deleted || (hidden && m.guest_id !== g.id) ? null : m.text, at: m.created_at, deleted, hidden, flaggedByMe: !!m.flagged_by_me }
    }),
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
  await membership(c, crewId)
  const b = await body(c)
  const share = v.bool(b.share, 'share')
  const f = c.get('festival')
  if (share && !isEnabled(f.modules, 'location')) throw new HttpError(403, `„${MODULES.location.label}“ ist bei diesem Festival nicht aktiviert`)
  if (share && f.status === 'archived') throw new HttpError(403, 'Festival ist archiviert und schreibgeschützt')
  const location = b.location === null || b.location === undefined ? null : v.oneOf(b.location, 'location', [...f.stages, 'camp'])
  // location_at is the moment consent was last confirmed; the share expires LOCATION_TTL later
  await c.env.DB.prepare('UPDATE crew_members SET share_location = ?, location = ?, location_at = ? WHERE crew_id = ? AND guest_id = ?')
    .bind(share ? 1 : 0, share ? location : null, share ? Date.now() : null, crewId, g.id)
    .run()
  return c.json({ share, location: share ? location : null })
})

app.post('/api/crews/:id/messages', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  requireName(g)
  await membership(c, crewId)
  await rateLimit(c.env.DB, 'msg:' + g.id, 30, MIN)
  const b = await body(c)
  const text = v.str(b.text, 'Nachricht', { max: 500 })!
  const msg = { id: clientId(b.id, 'm'), from: g.id, text, at: Date.now() }
  const res = await c.env.DB.prepare('INSERT OR IGNORE INTO messages (id, crew_id, guest_id, text, created_at) VALUES (?, ?, ?, ?, ?)').bind(msg.id, crewId, g.id, text, msg.at).run()
  if (!res.meta.changes) {
    const prev = await c.env.DB.prepare('SELECT id, guest_id AS "from", text, created_at AS at FROM messages WHERE id = ? AND guest_id = ? AND crew_id = ?').bind(msg.id, g.id, crewId).first()
    if (!prev) throw new HttpError(409, 'id ist bereits vergeben')
    return c.json(prev, 200)
  }
  return c.json(msg, 201)
})

async function messageFor(c: Context<App>) {
  const crewId = c.req.param('id')!
  const g = c.get('guest')
  await membership(c, crewId)
  const m = await c.env.DB.prepare('SELECT m.id, m.guest_id, m.deleted, c.created_by AS owner FROM messages m JOIN crews c ON c.id = m.crew_id WHERE m.id = ? AND m.crew_id = ?')
    .bind(c.req.param('msgId')!, crewId)
    .first<{ id: string; guest_id: string; deleted: number; owner: string }>()
  if (!m || m.deleted) throw new HttpError(404, 'Nachricht nicht gefunden')
  return { m, g }
}

// Authors delete their own messages; the crew owner can delete any.
app.delete('/api/crews/:id/messages/:msgId', async (c) => {
  const { m, g } = await messageFor(c)
  if (m.guest_id !== g.id && m.owner !== g.id) throw new HttpError(403, 'Nur eigene Nachrichten können gelöscht werden')
  await c.env.DB.prepare("UPDATE messages SET deleted = 1, text = '', updated_at = ? WHERE id = ?").bind(Date.now(), m.id).run()
  return c.body(null, 204)
})

app.post('/api/crews/:id/messages/:msgId/flag', async (c) => {
  const { m, g } = await messageFor(c)
  if (m.guest_id === g.id) throw new HttpError(400, 'Eigene Nachrichten kannst du löschen statt melden')
  await rateLimit(c.env.DB, 'flag:' + g.id, 30, 60 * MIN)
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO message_flags (message_id, guest_id, created_at) VALUES (?, ?, ?)').bind(m.id, g.id, now),
    c.env.DB.prepare('UPDATE messages SET updated_at = ? WHERE id = ?').bind(now, m.id),
  ])
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM message_flags WHERE message_id = ?').bind(m.id).first<{ n: number }>()
  return c.json({ id: m.id, flags: n?.n ?? 0, hidden: (n?.n ?? 0) >= FLAGS_TO_HIDE })
})

// The owner removes a member; the removal also bans them from rejoining with the code.
app.delete('/api/crews/:id/members/:guestId', async (c) => {
  const crewId = c.req.param('id')
  const target = c.req.param('guestId')
  const g = c.get('guest')
  await membership(c, crewId)
  const crew = await c.env.DB.prepare('SELECT created_by FROM crews WHERE id = ?').bind(crewId).first<{ created_by: string }>()
  if (crew?.created_by !== g.id) throw new HttpError(403, 'Nur wer die Crew gegründet hat, kann Mitglieder entfernen')
  if (target === g.id) throw new HttpError(400, 'Verlasse die Crew stattdessen')
  const res = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM crew_members WHERE crew_id = ? AND guest_id = ?').bind(crewId, target),
    c.env.DB.prepare('INSERT OR IGNORE INTO crew_bans (crew_id, guest_id, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM guests WHERE id = ?)').bind(crewId, target, Date.now(), target),
  ])
  if (!res[0].meta.changes) throw new HttpError(404, 'Mitglied nicht gefunden')
  return c.body(null, 204)
})

app.post('/api/crews/:id/meetups', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  requireName(g)
  await membership(c, crewId)
  await rateLimit(c.env.DB, 'meetup:' + g.id, 20, 60 * MIN)
  const b = await body(c)
  const m = {
    id: clientId(b.id, 'mt'),
    place: v.str(b.place, 'Treffpunkt', { max: 60 })!,
    poi: v.str(b.poi, 'poi', { max: 40, optional: true }) ?? null,
    actId: v.str(b.actId, 'actId', { max: 60, optional: true }) ?? null,
    day: v.int(b.day, 'day', 0, 13),
    min: v.int(b.min, 'min', 0, 30 * 60),
    note: v.str(b.note, 'Notiz', { max: 140, optional: true }) ?? '',
  }
  if (m.actId && !(await actExists(c, m.actId))) throw new HttpError(400, 'Act gehört nicht zu diesem Festival')
  const existing = await c.env.DB.prepare('SELECT crew_id, created_by FROM meetups WHERE id = ?').bind(m.id).first<{ crew_id: string; created_by: string }>()
  if (existing) {
    if (existing.created_by !== g.id || existing.crew_id !== crewId) throw new HttpError(409, 'id ist bereits vergeben')
    return c.json({ ...m, createdBy: g.id, going: [g.id], declined: [] }, 200)
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
  await membership(c, m.crew_id)
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

/* ---------- Official announcements ---------- */

type AnnouncementRow = { id: string; title: string; body: string | null; place: string | null; poi: string | null; severity: string; created_at: number; expires_at: number | null; title_en: string | null; body_en: string | null }
const toAnnouncement = (r: AnnouncementRow, now: number) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  place: r.place,
  poi: r.poi,
  severity: r.severity,
  ageMin: Math.max(0, Math.floor((now - r.created_at) / MIN)),
  validMin: r.expires_at === null ? null : Math.max(0, Math.ceil((r.expires_at - now) / MIN)),
  ...(r.title_en ? { en: { title: r.title_en, body: r.body_en } } : {}),
})

app.get('/api/announcements', async (c) => {
  const now = Date.now()
  const rows = await c.env.DB.prepare('SELECT * FROM announcements WHERE festival_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 50').bind(c.get('festival').id, now).all<AnnouncementRow>()
  return c.json(rows.results.map((r) => toAnnouncement(r, now)))
})

const admin = async (c: Context<App>, next: () => Promise<void>) => {
  if (!c.env.ADMIN_TOKEN) throw new HttpError(403, 'Admin-Zugang ist nicht eingerichtet')
  if (!(await isAdminRequest(c))) throw new HttpError(401, 'Admin-Token ungültig')
  c.set('isAdmin', true)
  await next()
}
app.use('/api/admin/*', admin)
app.get('/api/admin/session', (c) => c.json({ ok: true }))
app.get('/api/admin/festivals', async (c) => {
  const rows = await c.env.DB.prepare('SELECT slug, name, status FROM festivals ORDER BY status, name').all()
  return c.json(rows.results)
})
// festival-scoped admin routes
for (const path of ['/api/admin/announcements', '/api/admin/announcements/*', '/api/admin/timetable/*']) app.use(path, tenant)

const SEVERITY_ALL = ['info', 'warning', 'critical'] as const
function announcementInput(b: Record<string, unknown>, partial = false) {
  const opt = (k: string) => partial && b[k] === undefined
  return {
    title: opt('title') ? undefined : v.str(b.title, 'Titel', { min: 3, max: 120 }),
    body: v.str(b.body, 'Text', { max: 1000, optional: true }) ?? (opt('body') ? undefined : null),
    place: v.str(b.place, 'Ort', { max: 60, optional: true }) ?? (opt('place') ? undefined : null),
    poi: v.str(b.poi, 'poi', { max: 40, optional: true }) ?? (opt('poi') ? undefined : null),
    severity: opt('severity') ? undefined : b.severity === undefined ? 'info' : v.oneOf(b.severity, 'severity', SEVERITY_ALL),
    validMin: b.validMin === undefined || b.validMin === null ? (opt('validMin') ? undefined : null) : v.int(b.validMin, 'validMin', 1, 7 * 24 * 60),
    titleEn: v.str(b.titleEn, 'Titel (Englisch)', { min: 3, max: 120, optional: true }) ?? (opt('titleEn') ? undefined : null),
    bodyEn: v.str(b.bodyEn, 'Text (Englisch)', { max: 1000, optional: true }) ?? (opt('bodyEn') ? undefined : null),
  }
}

app.post('/api/admin/announcements', async (c) => {
  const a = announcementInput(await body(c))
  const now = Date.now()
  const row: AnnouncementRow = { id: randomId('a'), title: a.title!, body: a.body ?? null, place: a.place ?? null, poi: a.poi ?? null, severity: a.severity!, created_at: now, expires_at: a.validMin ? now + a.validMin * MIN : null, title_en: a.titleEn ?? null, body_en: a.titleEn ? (a.bodyEn ?? null) : null }
  await c.env.DB.prepare('INSERT INTO announcements (id, festival_id, title, body, place, poi, severity, created_at, expires_at, title_en, body_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, c.get('festival').id, row.title, row.body, row.place, row.poi, row.severity, row.created_at, row.expires_at, row.title_en, row.body_en)
    .run()
  return c.json(toAnnouncement(row, now), 201)
})

app.patch('/api/admin/announcements/:id', async (c) => {
  const a = announcementInput(await body(c), true)
  const now = Date.now()
  const cur = await c.env.DB.prepare('SELECT * FROM announcements WHERE id = ? AND festival_id = ?').bind(c.req.param('id'), c.get('festival').id).first<AnnouncementRow>()
  if (!cur) throw new HttpError(404, 'Meldung nicht gefunden')
  const next: AnnouncementRow = {
    ...cur,
    title: a.title ?? cur.title,
    body: a.body === undefined ? cur.body : a.body,
    place: a.place === undefined ? cur.place : a.place,
    poi: a.poi === undefined ? cur.poi : a.poi,
    severity: a.severity ?? cur.severity,
    expires_at: a.validMin === undefined ? cur.expires_at : a.validMin === null ? null : now + a.validMin * MIN,
    title_en: a.titleEn === undefined ? cur.title_en : a.titleEn,
    body_en: a.bodyEn === undefined ? cur.body_en : a.bodyEn,
  }
  await c.env.DB.prepare('UPDATE announcements SET title = ?, body = ?, place = ?, poi = ?, severity = ?, expires_at = ?, title_en = ?, body_en = ? WHERE id = ?')
    .bind(next.title, next.body, next.place, next.poi, next.severity, next.expires_at, next.title_en, next.body_en, next.id)
    .run()
  return c.json(toAnnouncement(next, now))
})

app.delete('/api/admin/announcements/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM announcements WHERE id = ? AND festival_id = ?').bind(c.req.param('id'), c.get('festival').id).run()
  if (!res.meta.changes) throw new HttpError(404, 'Meldung nicht gefunden')
  return c.body(null, 204)
})

/* ---------- Festival setup (admin) ---------- */

const PALETTE = ['#FF6B5A', '#5AC8FF', '#FFC94D', '#7BE0A0', '#E07BFF', '#4FD1C5', '#F6AD55', '#A58CFF']
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50)

async function festivalBySlug(c: Context<App>) {
  const f = await c.env.DB.prepare('SELECT id, slug, name, status FROM festivals WHERE slug = ?').bind(c.req.param('slug')!).first<{ id: string; slug: string; name: string; status: string }>()
  if (!f) throw new HttpError(404, 'Festival nicht gefunden')
  return f
}
const touch = (db: D1Database, id: string) => db.prepare('UPDATE festivals SET updated_at = ? WHERE id = ?').bind(Date.now(), id)

function daysFrom(start: string, count: number) {
  const [y, m, d] = start.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i))
    const label = WEEKDAYS[date.getUTCDay()]
    return { idx: i, date: date.toISOString().slice(0, 10), label, short: label.slice(0, 2) }
  })
}

app.post('/api/admin/festivals', async (c) => {
  const b = await body(c)
  const name = v.str(b.name, 'Name', { min: 2, max: 60 })!
  const slug = v.str(b.slug, 'Kurzname', { min: 2, max: 40, optional: true }) ?? slugify(name)
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new HttpError(400, 'Kurzname darf nur a–z, 0–9 und - enthalten')
  const start = v.str(b.startDate, 'Startdatum', { max: 10 })!
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start))) throw new HttpError(400, 'Startdatum im Format JJJJ-MM-TT')
  const dayCount = v.int(b.days, 'Anzahl Tage', 1, 14)
  const location = v.str(b.location, 'Ort', { max: 80, optional: true }) ?? null
  if (await c.env.DB.prepare('SELECT 1 FROM festivals WHERE slug = ?').bind(slug).first()) throw new HttpError(409, `Kurzname „${slug}“ ist schon vergeben`)
  const id = randomId('f')
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO festivals (id, slug, name, location, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)").bind(id, slug, name, location, now, now),
    ...daysFrom(start, dayCount).map((d) => c.env.DB.prepare('INSERT INTO festival_days (festival_id, idx, date, label, short) VALUES (?, ?, ?, ?, ?)').bind(id, d.idx, d.date, d.label, d.short)),
  ])
  return c.json({ slug, name, location, status: 'draft' }, 201)
})

app.patch('/api/admin/festivals/:slug', async (c) => {
  const f = await festivalBySlug(c)
  const b = await body(c)
  const name = v.str(b.name, 'Name', { min: 2, max: 60, optional: true }) ?? f.name
  const status = b.status === undefined ? f.status : v.oneOf(b.status, 'Status', ['draft', 'published', 'archived'] as const)
  if (status === 'published' && f.status !== 'published') {
    // publishing needs something to show
    const [{ n: acts }, { n: stages }] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM acts WHERE festival_id = ?').bind(f.id).first<{ n: number }>().then((r) => r ?? { n: 0 }),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM stages WHERE festival_id = ?').bind(f.id).first<{ n: number }>().then((r) => r ?? { n: 0 }),
    ])
    if (!stages || !acts) throw new HttpError(400, 'Zum Veröffentlichen braucht das Festival mindestens eine Bühne und einen Act')
  }
  const updates: D1PreparedStatement[] = [c.env.DB.prepare('UPDATE festivals SET name = ?, status = ?, updated_at = ? WHERE id = ?').bind(name, status, Date.now(), f.id)]
  // an archived festival is over: nobody keeps sharing a location there
  if (status === 'archived') updates.push(c.env.DB.prepare('UPDATE crew_members SET share_location = 0, location = NULL, location_at = NULL WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = ?)').bind(f.id))
  if (b.location !== undefined) updates.push(c.env.DB.prepare('UPDATE festivals SET location = ? WHERE id = ?').bind(v.str(b.location, 'Ort', { max: 80, optional: true }) ?? null, f.id))
  await c.env.DB.batch(updates)
  return c.json({ slug: f.slug, name, status })
})

/** Replaces the stage list; stages still used by acts cannot be removed. */
app.put('/api/admin/festivals/:slug/stages', async (c) => {
  const f = await festivalBySlug(c)
  const list = (await body(c)).stages
  if (!Array.isArray(list) || list.length > 40) throw new HttpError(400, 'stages ist ungültig')
  const stages = list.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    const name = v.str(s.name, `Bühne ${i + 1}: Name`, { max: 40 })!
    const id = v.str(s.id, `Bühne ${i + 1}: id`, { max: 40, optional: true }) ?? (slugify(name) || `buehne-${i + 1}`)
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new HttpError(400, `Bühne ${i + 1}: id ist ungültig`)
    return { id, name, color: v.color(s.color) ?? PALETTE[i % PALETTE.length], vibe: v.str(s.vibe, `Bühne ${i + 1}: Vibe`, { max: 60, optional: true }) ?? '', sort: i }
  })
  if (new Set(stages.map((s) => s.id)).size !== stages.length) throw new HttpError(400, 'Zwei Bühnen haben denselben Namen')
  const used = (await c.env.DB.prepare('SELECT DISTINCT stage_id FROM acts WHERE festival_id = ?').bind(f.id).all<{ stage_id: string }>()).results.map((r) => r.stage_id)
  const missing = used.filter((u) => !stages.some((s) => s.id === u))
  if (missing.length) throw new HttpError(409, `Bühne(n) noch mit Acts belegt: ${missing.join(', ')}`)
  const existing = await c.env.DB.prepare('SELECT id, x, y FROM stages WHERE festival_id = ?').bind(f.id).all<{ id: string; x: number; y: number }>()
  const pos = new Map(existing.results.map((r) => [r.id, r]))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM stages WHERE festival_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(f.id, JSON.stringify(stages.map((s) => s.id))),
    ...stages.map((s, i) =>
      c.env.DB.prepare(
        'INSERT INTO stages (festival_id, id, name, color, x, y, vibe, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(festival_id, id) DO UPDATE SET name = excluded.name, color = excluded.color, vibe = excluded.vibe, sort = excluded.sort',
      ).bind(f.id, s.id, s.name, s.color, pos.get(s.id)?.x ?? 200 + (i % 4) * 180, pos.get(s.id)?.y ?? 220 + Math.floor(i / 4) * 200, s.vibe, s.sort),
    ),
    touch(c.env.DB, f.id),
  ])
  return c.json({ stages })
})

/** Turns optional modules on or off; dependencies must be consistent. */
app.put('/api/admin/festivals/:slug/modules', async (c) => {
  const f = await festivalBySlug(c)
  const b = await body(c)
  const state: ModuleState = {}
  for (const [k, val] of Object.entries(b)) {
    if (!MODULE_KEYS.includes(k as ModuleKey)) throw new HttpError(400, `Unbekanntes Modul „${k}“`)
    state[k as ModuleKey] = v.bool(val, k)
  }
  const conflicts = moduleConflicts(state)
  if (conflicts.length) throw new HttpError(400, conflicts.join('; '))
  // only choices that differ from the default are stored (most modules are on, opt-in ones off)
  const stored = Object.fromEntries(Object.entries(state).filter(([k, on]) => on !== defaultOn(k as ModuleKey)))
  const db = c.env.DB
  // switching a sensitive module off ends what people shared with it; switching it on again starts from zero
  await db.batch([
    db.prepare('UPDATE festivals SET modules = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(stored), Date.now(), f.id),
    ...(!isEnabled(state, 'location') ? [db.prepare('UPDATE crew_members SET share_location = 0, location = NULL, location_at = NULL WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = ?)').bind(f.id)] : []),
    ...(!isEnabled(state, 'steps') ? [db.prepare('DELETE FROM steps WHERE festival_id = ?').bind(f.id)] : []),
  ])
  return c.json(stored)
})

/* FAQ (admin): drafts stay in the console until published. */
type FaqRow = { id: string; question: string; answer: string; category: string; keywords: string; source: string | null; status: string; sort: number; updated_at: number; updatedAt?: number; question_en: string | null; answer_en: string | null; keywords_en: string | null }
/** English version travels as `en` only when the organizer wrote one (question and answer). */
const faqEn = (r: FaqRow) => (r.question_en && r.answer_en ? { en: { question: r.question_en, answer: r.answer_en, keywords: r.keywords_en ?? '' } } : {})
const toFaq = (r: FaqRow) => ({ id: r.id, question: r.question, answer: r.answer, category: r.category, keywords: r.keywords, source: r.source, status: r.status, sort: r.sort, updatedAt: r.updated_at, ...faqEn(r) })
const publicFaq = (r: FaqRow) => ({ id: r.id, question: r.question, answer: r.answer, category: r.category, keywords: r.keywords, source: r.source, updatedAt: r.updatedAt ?? r.updated_at, ...faqEn(r) })

app.get('/api/admin/festivals/:slug/faq', async (c) => {
  const f = await festivalBySlug(c)
  const rows = await c.env.DB.prepare('SELECT * FROM faqs WHERE festival_id = ? ORDER BY sort, category, question').bind(f.id).all<FaqRow>()
  return c.json(rows.results.map(toFaq))
})

/** Optional English version: question and answer belong together, keywords are extra. */
function englishFaq(raw: unknown) {
  const e = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const question = v.str(e.question, 'Frage (Englisch)', { min: 3, max: 200, optional: true }) ?? null
  const answer = v.str(e.answer, 'Antwort (Englisch)', { min: 3, max: 2000, optional: true }) ?? null
  if (!question !== !answer) throw new HttpError(400, 'Englisch: bitte Frage und Antwort angeben – oder beides leer lassen')
  return { question_en: question, answer_en: answer, keywords_en: question ? (v.str(e.keywords, 'Stichworte (Englisch)', { max: 300, optional: true }) ?? null) : null }
}

app.put('/api/admin/festivals/:slug/faq/:id', async (c) => {
  const f = await festivalBySlug(c)
  const id = c.req.param('id')
  if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new HttpError(400, 'id darf nur a–z, 0–9 und - enthalten')
  const b = await body(c)
  const row: FaqRow = {
    id,
    question: v.str(b.question, 'Frage', { min: 3, max: 200 })!,
    answer: v.str(b.answer, 'Antwort', { min: 3, max: 2000 })!,
    category: v.str(b.category, 'Kategorie', { max: 40, optional: true }) ?? 'Allgemein',
    keywords: v.str(b.keywords, 'Stichworte', { max: 300, optional: true }) ?? '',
    source: v.str(b.source, 'Quelle', { max: 80, optional: true }) ?? null,
    status: b.status === undefined ? 'draft' : v.oneOf(b.status, 'Status', ['draft', 'published'] as const),
    sort: b.sort === undefined ? 0 : v.int(b.sort, 'sort', 0, 9999),
    updated_at: Date.now(),
    ...englishFaq(b.en),
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO faqs (festival_id, id, question, answer, category, keywords, source, status, sort, updated_at, question_en, answer_en, keywords_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(festival_id, id) DO UPDATE SET question = excluded.question, answer = excluded.answer, category = excluded.category, keywords = excluded.keywords, source = excluded.source, status = excluded.status, sort = excluded.sort, updated_at = excluded.updated_at,
         question_en = excluded.question_en, answer_en = excluded.answer_en, keywords_en = excluded.keywords_en`,
    ).bind(f.id, row.id, row.question, row.answer, row.category, row.keywords, row.source, row.status, row.sort, row.updated_at, row.question_en, row.answer_en, row.keywords_en),
    touch(c.env.DB, f.id),
  ])
  return c.json(toFaq(row))
})

app.delete('/api/admin/festivals/:slug/faq/:id', async (c) => {
  const f = await festivalBySlug(c)
  const res = await c.env.DB.prepare('DELETE FROM faqs WHERE festival_id = ? AND id = ?').bind(f.id, c.req.param('id')).run()
  if (!res.meta.changes) throw new HttpError(404, 'Eintrag nicht gefunden')
  await touch(c.env.DB, f.id).run()
  return c.body(null, 204)
})

const FONT_KEYS = ['bricolage', 'space', 'unbounded', 'fraunces', 'archivo'] as const
const LOGO_MAX = 200_000 // characters of the data: URL (~150 kB image)

/** Branding: brand colour (must pass the same WCAG checks as the console), display font, logo. */
app.put('/api/admin/festivals/:slug/theme', async (c) => {
  const f = await festivalBySlug(c)
  const b = await body(c)
  const theme: Record<string, string> = {}
  if (b.brand !== undefined && b.brand !== null) {
    if (typeof b.brand !== 'string' || !HEX.test(b.brand)) throw new HttpError(400, 'Markenfarbe als #RRGGBB angeben')
    const check = checkBrand(b.brand)
    if (!check.ok) throw new HttpError(400, `Kontrast zu gering: ${check.checks.filter((x) => !x.ok).map((x) => `${x.label} ${x.ratio}:1 (min. ${x.min}:1)`).join(', ')}`)
    theme.brand = b.brand.toLowerCase()
  }
  if (b.font !== undefined && b.font !== null) theme.font = v.oneOf(b.font, 'Schrift', FONT_KEYS)
  if (b.logo !== undefined && b.logo !== null) {
    if (typeof b.logo !== 'string' || !/^data:image\/(png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(b.logo)) throw new HttpError(400, 'Logo muss ein PNG, WebP, JPEG oder SVG sein')
    if (b.logo.length > LOGO_MAX) throw new HttpError(400, 'Logo ist zu groß (max. ca. 150 kB)')
    theme.logo = b.logo
  }
  await c.env.DB.prepare('UPDATE festivals SET theme = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(theme), Date.now(), f.id).run()
  return c.json(theme)
})

/* ---------- Festival chat (opt-in module) ---------- */

type PublicMsgRow = { id: string; guest_id: string; nickname: string | null; color: string; text: string; created_at: number; updated_at: number; deleted: number; restored: number; flags: number; mine_flag: number }
const PUBLIC_MSG_SELECT = `SELECT m.id, m.guest_id, g.nickname, g.color, m.text, m.created_at, m.updated_at, m.deleted, m.restored,
  (SELECT COUNT(*) FROM festival_message_flags f WHERE f.message_id = m.id) AS flags,
  (SELECT COUNT(*) FROM festival_message_flags f WHERE f.message_id = m.id AND f.guest_id = ?) AS mine_flag
  FROM festival_messages m JOIN guests g ON g.id = m.guest_id`

/** Hidden or deleted messages travel without their text; authors still see their own hidden ones. */
function publicMessage(r: PublicMsgRow, me: string) {
  const hidden = !r.restored && r.flags >= PUBLIC_FLAGS_TO_HIDE
  const withheld = !!r.deleted || (hidden && r.guest_id !== me)
  return { id: r.id, from: r.guest_id === me ? 'me' : r.guest_id, name: r.nickname ?? 'Gast', color: r.color, text: withheld ? null : r.text, at: r.created_at, deleted: !!r.deleted || undefined, hidden: hidden || undefined, flaggedByMe: !!r.mine_flag || undefined }
}

app.get('/api/festival-chat', async (c) => {
  const g = c.get('guest')
  const since = Number(c.req.query('since') ?? 0) || 0
  const rows = since
    ? await c.env.DB.prepare(`${PUBLIC_MSG_SELECT} WHERE m.festival_id = ? AND m.updated_at > ? ORDER BY m.created_at LIMIT 200`).bind(g.id, c.get('festival').id, since).all<PublicMsgRow>()
    : await c.env.DB.prepare(`SELECT * FROM (${PUBLIC_MSG_SELECT} WHERE m.festival_id = ? ORDER BY m.created_at DESC LIMIT 100) ORDER BY created_at`).bind(g.id, c.get('festival').id).all<PublicMsgRow>()
  return c.json({ serverTime: Date.now(), messages: rows.results.map((r) => publicMessage(r, g.id)) })
})

app.post('/api/festival-chat', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'fchat:' + g.id, 10, MIN)
  const b = await body(c)
  const text = v.str(b.text, 'Nachricht', { max: 300 })!
  const id = clientId(b.id, 'fm')
  const now = Date.now()
  const res = await c.env.DB.prepare('INSERT OR IGNORE INTO festival_messages (id, festival_id, guest_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, c.get('festival').id, g.id, text, now, now).run()
  if (!res.meta.changes && !(await c.env.DB.prepare('SELECT 1 FROM festival_messages WHERE id = ? AND guest_id = ?').bind(id, g.id).first())) throw new HttpError(409, 'id ist bereits vergeben')
  const row = await c.env.DB.prepare(`${PUBLIC_MSG_SELECT} WHERE m.id = ?`).bind(g.id, id).first<PublicMsgRow>()
  return c.json(publicMessage(row!, g.id), res.meta.changes ? 201 : 200)
})

async function publicMessageFor(c: Context<App>) {
  const m = await c.env.DB.prepare('SELECT id, guest_id, deleted FROM festival_messages WHERE id = ? AND festival_id = ?').bind(c.req.param('id')!, c.get('festival').id).first<{ id: string; guest_id: string; deleted: number }>()
  if (!m || m.deleted) throw new HttpError(404, 'Nachricht nicht gefunden')
  return m
}

app.delete('/api/festival-chat/:id', async (c) => {
  const m = await publicMessageFor(c)
  if (m.guest_id !== c.get('guest').id) throw new HttpError(403, 'Nur eigene Nachrichten können gelöscht werden')
  await c.env.DB.prepare("UPDATE festival_messages SET deleted = 1, text = '', updated_at = ? WHERE id = ?").bind(Date.now(), m.id).run()
  return c.body(null, 204)
})

app.post('/api/festival-chat/:id/flag', async (c) => {
  const m = await publicMessageFor(c)
  const g = c.get('guest')
  requireName(g)
  if (m.guest_id === g.id) throw new HttpError(400, 'Eigene Nachrichten kannst du löschen statt melden')
  await rateLimit(c.env.DB, 'fflag:' + g.id, 30, 60 * MIN)
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO festival_message_flags (message_id, guest_id, created_at) VALUES (?, ?, ?)').bind(m.id, g.id, now),
    c.env.DB.prepare('UPDATE festival_messages SET updated_at = ? WHERE id = ?').bind(now, m.id),
  ])
  const r = await c.env.DB.prepare('SELECT restored, (SELECT COUNT(*) FROM festival_message_flags WHERE message_id = ?) AS n FROM festival_messages WHERE id = ?').bind(m.id, m.id).first<{ restored: number; n: number }>()
  return c.json({ id: m.id, hidden: !r?.restored && (r?.n ?? 0) >= PUBLIC_FLAGS_TO_HIDE })
})

/** Organizer moderation: everything incl. hidden messages and flag counts, newest first. */
app.get('/api/admin/festivals/:slug/chat', async (c) => {
  const f = await festivalBySlug(c)
  const rows = await c.env.DB.prepare(`${PUBLIC_MSG_SELECT} WHERE m.festival_id = ? AND m.deleted = 0 ORDER BY (flags >= ${PUBLIC_FLAGS_TO_HIDE} AND m.restored = 0) DESC, m.created_at DESC LIMIT 200`).bind('', f.id).all<PublicMsgRow>()
  return c.json(rows.results.map((r) => ({ id: r.id, name: r.nickname ?? 'Gast', text: r.text, at: r.created_at, flags: r.flags, hidden: !r.restored && r.flags >= PUBLIC_FLAGS_TO_HIDE, restored: !!r.restored })))
})

app.delete('/api/admin/festivals/:slug/chat/:id', async (c) => {
  const f = await festivalBySlug(c)
  const res = await c.env.DB.prepare("UPDATE festival_messages SET deleted = 2, text = '', updated_at = ? WHERE id = ? AND festival_id = ? AND deleted = 0").bind(Date.now(), c.req.param('id'), f.id).run()
  if (!res.meta.changes) throw new HttpError(404, 'Nachricht nicht gefunden')
  return c.body(null, 204)
})

/** Flags were unfounded: show the message again; new flags no longer hide it. */
app.post('/api/admin/festivals/:slug/chat/:id/restore', async (c) => {
  const f = await festivalBySlug(c)
  const res = await c.env.DB.prepare('UPDATE festival_messages SET restored = 1, updated_at = ? WHERE id = ? AND festival_id = ? AND deleted = 0').bind(Date.now(), c.req.param('id'), f.id).run()
  if (!res.meta.changes) throw new HttpError(404, 'Nachricht nicht gefunden')
  return c.body(null, 204)
})

/* ---------- Analytics ---------- */

/** Groups smaller than this are never shown, so no single visitor can be singled out. */
const MIN_GROUP = 3
const normalizeQuestion = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').replace(/[?!.¿¡]+$/g, '').trim().slice(0, 140)

/** The FAQ bot reports anonymously whether it found an answer (no guest, no session needed). */
app.post('/api/faq/events', async (c) => {
  const b = await body(c)
  const ip = c.req.header('CF-Connecting-IP') ?? 'local'
  await rateLimit(c.env.DB, 'faq:' + ip, 60, 10 * MIN)
  const kind = v.oneOf(b.kind, 'kind', ['hit', 'miss'] as const)
  const f = c.get('festival')
  if (kind === 'hit') {
    const faqId = v.str(b.faqId, 'faqId', { max: 80 })!
    if (!(await c.env.DB.prepare("SELECT 1 FROM faqs WHERE festival_id = ? AND id = ? AND status = 'published'").bind(f.id, faqId).first())) throw new HttpError(404, 'Antwort nicht gefunden')
    await c.env.DB.prepare("INSERT INTO faq_events (festival_id, kind, faq_id, created_at) VALUES (?, 'hit', ?, ?)").bind(f.id, faqId, Date.now()).run()
  } else {
    const q = normalizeQuestion(v.str(b.question, 'Frage', { min: 3, max: 300 })!)
    await c.env.DB.prepare("INSERT INTO faq_events (festival_id, kind, question, created_at) VALUES (?, 'miss', ?, ?)").bind(f.id, q, Date.now()).run()
  }
  return c.body(null, 204)
})

/**
 * Aggregates for the organizer: interest per act (from synced plans), community activity and
 * FAQ-bot usage. Only counts, never people; any group below MIN_GROUP is withheld.
 */
app.get('/api/admin/festivals/:slug/analytics', async (c) => {
  const f = await festivalBySlug(c)
  const db = c.env.DB
  const [profiles, acts, crews, members, messages, meetups, reports, steps, hits, misses] = await db.batch([
    db.prepare('SELECT COUNT(DISTINCT guest_id) AS n FROM plans WHERE festival_id = ?').bind(f.id),
    db.prepare('SELECT act_id AS id, COUNT(*) AS n FROM plans WHERE festival_id = ? GROUP BY act_id').bind(f.id),
    db.prepare('SELECT COUNT(*) AS n FROM crews WHERE festival_id = ?').bind(f.id),
    db.prepare('SELECT COUNT(DISTINCT m.guest_id) AS n FROM crew_members m JOIN crews c ON c.id = m.crew_id WHERE c.festival_id = ?').bind(f.id),
    db.prepare('SELECT COUNT(*) AS n FROM messages m JOIN crews c ON c.id = m.crew_id WHERE c.festival_id = ?').bind(f.id),
    db.prepare('SELECT COUNT(*) AS n FROM meetups m JOIN crews c ON c.id = m.crew_id WHERE c.festival_id = ?').bind(f.id),
    db.prepare('SELECT COUNT(*) AS n FROM reports WHERE festival_id = ?').bind(f.id),
    db.prepare('SELECT COUNT(DISTINCT guest_id) AS n FROM steps WHERE festival_id = ?').bind(f.id),
    db.prepare("SELECT e.faq_id AS id, q.question, COUNT(*) AS n FROM faq_events e JOIN faqs q ON q.festival_id = e.festival_id AND q.id = e.faq_id WHERE e.festival_id = ? AND e.kind = 'hit' GROUP BY e.faq_id ORDER BY n DESC LIMIT 10").bind(f.id),
    db.prepare("SELECT question, COUNT(*) AS n, MAX(created_at) AS last FROM faq_events WHERE festival_id = ? AND kind = 'miss' GROUP BY question ORDER BY n DESC, last DESC LIMIT 20").bind(f.id),
  ])
  const n = (r: D1Result) => (r.results[0] as { n: number } | undefined)?.n ?? 0
  const group = (x: number) => (x >= MIN_GROUP ? x : 0)
  const actRows = acts.results as { id: string; n: number }[]
  return c.json({
    minGroup: MIN_GROUP,
    profiles: group(n(profiles)),
    acts: actRows.filter((a) => a.n >= MIN_GROUP).map((a) => ({ id: a.id, plans: a.n })),
    withheldActs: actRows.filter((a) => a.n < MIN_GROUP).length,
    community: { crews: group(n(crews)), members: group(n(members)), messages: group(n(messages)), meetups: group(n(meetups)), reports: group(n(reports)), steps: group(n(steps)) },
    faq: {
      hits: (hits.results as { id: string; question: string; n: number }[]).filter((h) => h.n >= MIN_GROUP),
      // a question someone typed is shown only once several people asked it the same way
      misses: (misses.results as { question: string; n: number; last: number }[]).filter((m) => m.n >= MIN_GROUP),
    },
  })
})

/** The organizer has answered (or dismissed) a missed question. */
app.delete('/api/admin/festivals/:slug/analytics/faq-misses', async (c) => {
  const f = await festivalBySlug(c)
  const q = normalizeQuestion(v.str((await body(c)).question, 'Frage', { max: 300 })!)
  await c.env.DB.prepare("DELETE FROM faq_events WHERE festival_id = ? AND kind = 'miss' AND question = ?").bind(f.id, q).run()
  return c.body(null, 204)
})

const MAP_W = 1000
const MAP_H = 940
const POI_CATS = ['water', 'wc', 'food', 'medical', 'bar', 'entrance', 'camping', 'info', 'shuttle'] as const
const SITE_MAP_MAX = 900_000 // characters of the data: URL (~650 kB image)

/**
 * Map editor: site plan image, stage positions and all other pins in one save.
 * Coordinates are map units (0–1000 × 0–940), the same space the visitor map draws in.
 * siteMap: omitted = unchanged, null = back to the built-in illustration.
 */
app.put('/api/admin/festivals/:slug/map', async (c) => {
  const f = await festivalBySlug(c)
  const b = await body(c)
  const coord = (x: unknown, name: string, max: number) => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > max) throw new HttpError(400, `${name} liegt außerhalb der Karte`)
    return Math.round(x)
  }
  let siteMap: string | null | undefined
  if (b.siteMap === null) siteMap = null
  else if (b.siteMap !== undefined) {
    if (typeof b.siteMap !== 'string' || !/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(b.siteMap)) throw new HttpError(400, 'Geländeplan muss ein PNG, WebP oder JPEG sein')
    if (b.siteMap.length > SITE_MAP_MAX) throw new HttpError(400, 'Geländeplan ist zu groß (max. ca. 650 kB)')
    siteMap = b.siteMap
  }
  const known = new Set((await c.env.DB.prepare('SELECT id FROM stages WHERE festival_id = ?').bind(f.id).all<{ id: string }>()).results.map((r) => r.id))
  const rawStages = b.stages ?? []
  const rawPois = b.pois ?? []
  if (!Array.isArray(rawStages) || !Array.isArray(rawPois)) throw new HttpError(400, 'stages und pois müssen Listen sein')
  const stages = (rawStages as Record<string, unknown>[]).map((s, i) => {
    const id = v.oneOf(s?.id, `Bühne ${i + 1}`, [...known])
    return { id, x: coord(s.x, `Bühne ${id}`, MAP_W), y: coord(s.y, `Bühne ${id}`, MAP_H) }
  })
  if (rawPois.length > 300) throw new HttpError(400, 'Höchstens 300 Punkte pro Karte')
  const pois = (rawPois as Record<string, unknown>[]).map((p, i) => {
    const n = `Punkt ${i + 1}`
    const id = v.str(p?.id, `${n}: id`, { max: 40 })!
    if (!/^[a-z0-9_-]+$/i.test(id) || id.startsWith('stage-')) throw new HttpError(400, `${n}: id ist ungültig`)
    return {
      id,
      cat: v.oneOf(p.cat, `${n}: Kategorie`, POI_CATS),
      name: v.str(p.name, `${n}: Name`, { max: 40 })!,
      detail: v.str(p.detail, `${n}: Beschreibung`, { max: 80, optional: true }) ?? '',
      status: p.status === undefined || p.status === null ? null : v.oneOf(p.status, `${n}: Status`, ['open', 'busy', 'closed'] as const),
      important: p.important === undefined ? false : v.bool(p.important, `${n}: wichtig`),
      x: coord(p.x, n, MAP_W),
      y: coord(p.y, n, MAP_H),
    }
  })
  if (new Set(pois.map((p) => p.id)).size !== pois.length) throw new HttpError(400, 'Zwei Punkte haben dieselbe id')
  const db = c.env.DB
  await db.batch([
    ...(siteMap !== undefined ? [db.prepare('UPDATE festivals SET site_map = ? WHERE id = ?').bind(siteMap, f.id)] : []),
    ...stages.map((s) => db.prepare('UPDATE stages SET x = ?, y = ? WHERE festival_id = ? AND id = ?').bind(s.x, s.y, f.id, s.id)),
    ...(b.pois !== undefined
      ? [
          db.prepare('DELETE FROM pois WHERE festival_id = ?').bind(f.id),
          ...pois.map((p) => db.prepare('INSERT INTO pois (festival_id, id, cat, name, x, y, detail, status, important) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(f.id, p.id, p.cat, p.name, p.x, p.y, p.detail, p.status, p.important ? 1 : 0)),
        ]
      : []),
    touch(db, f.id),
  ])
  return c.json({ stages: stages.length, pois: pois.length, siteMap: siteMap === undefined ? undefined : !!siteMap })
})

type ImportRow = { row: number; id?: string; day: number; stage: string; artist: string; start: number; end: number; genre?: string; bio?: string }
type Issue = { row: number; message: string }

/**
 * Imports a timetable that the console has already parsed (CSV/XLSX/JSON) into rows.
 * Everything is re-validated here. merge = upsert by id; replace = additionally removes acts
 * missing from the file after saving a snapshot. Writes only when there are no errors.
 * Ids are stable: an explicit id, else "<day>-<artist>", so favorites survive re-imports.
 */
app.post('/api/admin/festivals/:slug/import', async (c) => {
  const f = await festivalBySlug(c)
  const b = await body(c)
  const mode = v.oneOf(b.mode ?? 'merge', 'mode', ['merge', 'replace'] as const)
  const dryRun = b.dryRun === undefined ? false : v.bool(b.dryRun, 'dryRun')
  const createStages = b.createStages === undefined ? true : v.bool(b.createStages, 'createStages')
  if (!Array.isArray(b.rows) || b.rows.length > 2000) throw new HttpError(400, 'rows muss eine Liste mit höchstens 2000 Zeilen sein')
  const db = c.env.DB
  const [days, stageRows, actRows] = await db.batch([
    db.prepare('SELECT idx FROM festival_days WHERE festival_id = ?').bind(f.id),
    db.prepare('SELECT id, name FROM stages WHERE festival_id = ? ORDER BY sort').bind(f.id),
    db.prepare('SELECT id, day, stage_id, artist, start_min, end_min, genre, bio FROM acts WHERE festival_id = ?').bind(f.id),
  ])
  const dayIdx = new Set((days.results as { idx: number }[]).map((d) => d.idx))
  const stages = stageRows.results as { id: string; name: string }[]
  const stageByKey = new Map<string, string>()
  for (const s of stages) {
    stageByKey.set(s.id, s.id)
    stageByKey.set(s.name.toLowerCase(), s.id)
  }
  const newStages: { id: string; name: string }[] = []
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const acts: { id: string; day: number; stage: string; artist: string; start: number; end: number; genre: string; bio: string; row: number }[] = []
  const seen = new Map<string, number>()

  for (const raw of b.rows as Record<string, unknown>[]) {
    const r = raw as Partial<ImportRow>
    const row = typeof r.row === 'number' ? r.row : acts.length + errors.length + 1
    const fail = (message: string) => errors.push({ row, message })
    const artist = typeof r.artist === 'string' ? r.artist.trim() : ''
    if (!artist) {
      fail('Act/Künstler fehlt')
      continue
    }
    if (artist.length > 80) {
      fail('Act-Name ist länger als 80 Zeichen')
      continue
    }
    if (typeof r.day !== 'number' || !dayIdx.has(r.day)) {
      fail(`Tag ${typeof r.day === 'number' ? r.day + 1 : '?'} gibt es in diesem Festival nicht`)
      continue
    }
    if (typeof r.start !== 'number' || typeof r.end !== 'number' || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end > 36 * 60) {
      fail('Beginn oder Ende fehlt oder ist ungültig')
      continue
    }
    if (r.end <= r.start) {
      fail('Ende liegt nicht nach dem Beginn')
      continue
    }
    const stageName = typeof r.stage === 'string' ? r.stage.trim() : ''
    if (!stageName) {
      fail('Bühne fehlt')
      continue
    }
    let stage = stageByKey.get(stageName.toLowerCase()) ?? stageByKey.get(slugify(stageName))
    if (!stage) {
      if (!createStages) {
        fail(`Bühne „${stageName}“ ist unbekannt`)
        continue
      }
      stage = slugify(stageName) || `buehne-${stages.length + newStages.length + 1}`
      newStages.push({ id: stage, name: stageName })
      stageByKey.set(stageName.toLowerCase(), stage)
      stageByKey.set(stage, stage)
      warnings.push({ row, message: `Neue Bühne „${stageName}“ wird angelegt` })
    }
    let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().toLowerCase() : `${r.day}-${slugify(artist)}`
    if (!/^[a-z0-9-]{1,60}$/.test(id)) {
      fail(`id „${id}“ darf nur a–z, 0–9 und - enthalten`)
      continue
    }
    const dupKey = `${r.day}|${stage}|${r.start}|${artist.toLowerCase()}`
    if (seen.has(dupKey)) {
      warnings.push({ row, message: `Doppelt (wie Zeile ${seen.get(dupKey)}) – übersprungen` })
      continue
    }
    seen.set(dupKey, row)
    if (acts.some((a) => a.id === id)) {
      // same artist twice on one day: keep both with distinct, still deterministic ids
      let n = 2
      while (acts.some((a) => a.id === `${id}-${n}`)) n++
      id = `${id}-${n}`
    }
    acts.push({ id, day: r.day, stage, artist, start: r.start, end: r.end, genre: typeof r.genre === 'string' ? r.genre.trim().slice(0, 60) : '', bio: typeof r.bio === 'string' ? r.bio.trim().slice(0, 1000) : '', row })
  }

  // overlapping slots on the same stage are allowed but flagged
  for (const a of acts)
    for (const o of acts)
      if (o.row > a.row && o.day === a.day && o.stage === a.stage && o.start < a.end && a.start < o.end)
        warnings.push({ row: o.row, message: `Überschneidet sich auf derselben Bühne mit Zeile ${a.row} (${a.artist})` })

  type Existing = { id: string; day: number; stage_id: string; artist: string; start_min: number; end_min: number; genre: string; bio: string }
  const before = new Map((actRows.results as Existing[]).map((a) => [a.id, a]))
  const same = (a: (typeof acts)[number], e: Existing) => a.day === e.day && a.stage === e.stage_id && a.artist === e.artist && a.start === e.start_min && a.end === e.end_min && a.genre === e.genre && a.bio === e.bio
  const summary = {
    rows: (b.rows as unknown[]).length,
    created: acts.filter((a) => !before.has(a.id)).length,
    updated: acts.filter((a) => before.has(a.id) && !same(a, before.get(a.id)!)).length,
    unchanged: acts.filter((a) => before.has(a.id) && same(a, before.get(a.id)!)).length,
    removed: mode === 'replace' ? [...before.keys()].filter((id) => !acts.some((a) => a.id === id)).length : 0,
    stagesCreated: newStages.length,
  }
  errors.sort((x, y) => x.row - y.row)
  warnings.sort((x, y) => x.row - y.row)
  if (dryRun || errors.length) return c.json({ dryRun: true, mode, summary, errors, warnings, written: false }, errors.length && !dryRun ? 422 : 200)

  let snapshotId: string | null = null
  const writes: D1PreparedStatement[] = []
  if (mode === 'replace') {
    snapshotId = randomId('snap')
    writes.push(
      db.prepare('INSERT INTO import_snapshots (id, festival_id, created_at, note, data) VALUES (?, ?, ?, ?, ?)').bind(snapshotId, f.id, Date.now(), `Vor Import (${summary.rows} Zeilen)`, JSON.stringify({ stages, acts: actRows.results })),
      db.prepare('DELETE FROM acts WHERE festival_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(f.id, JSON.stringify(acts.map((a) => a.id))),
    )
  }
  newStages.forEach((s, i) =>
    writes.push(
      db.prepare('INSERT INTO stages (festival_id, id, name, color, x, y, vibe, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(f.id, s.id, s.name, PALETTE[(stages.length + i) % PALETTE.length], 200 + ((stages.length + i) % 4) * 180, 220 + Math.floor((stages.length + i) / 4) * 200, '', stages.length + i),
    ),
  )
  for (const a of acts)
    writes.push(
      db.prepare(
        `INSERT INTO acts (festival_id, id, day, stage_id, artist, start_min, end_min, genre, bio, popularity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.5)
         ON CONFLICT(festival_id, id) DO UPDATE SET day = excluded.day, stage_id = excluded.stage_id, artist = excluded.artist, start_min = excluded.start_min, end_min = excluded.end_min, genre = excluded.genre, bio = excluded.bio`,
      ).bind(f.id, a.id, a.day, a.stage, a.artist, a.start, a.end, a.genre, a.bio),
    )
  writes.push(touch(db, f.id))
  await db.batch(writes)
  return c.json({ dryRun: false, mode, summary, errors, warnings, written: true, snapshotId })
})

app.get('/api/admin/festivals/:slug/snapshots', async (c) => {
  const f = await festivalBySlug(c)
  const rows = await c.env.DB.prepare('SELECT id, created_at AS createdAt, note FROM import_snapshots WHERE festival_id = ? ORDER BY created_at DESC LIMIT 20').bind(f.id).all()
  return c.json(rows.results)
})

app.post('/api/admin/festivals/:slug/snapshots/:id/restore', async (c) => {
  const f = await festivalBySlug(c)
  const snap = await c.env.DB.prepare('SELECT data FROM import_snapshots WHERE id = ? AND festival_id = ?').bind(c.req.param('id'), f.id).first<{ data: string }>()
  if (!snap) throw new HttpError(404, 'Snapshot nicht gefunden')
  const data = JSON.parse(snap.data) as { stages: { id: string; name: string }[]; acts: { id: string; day: number; stage_id: string; artist: string; start_min: number; end_min: number; genre: string; bio: string }[] }
  const db = c.env.DB
  await db.batch([
    db.prepare('DELETE FROM acts WHERE festival_id = ?').bind(f.id),
    // stages removed since the snapshot come back so every restored act has its stage
    ...data.stages.map((st, i) => db.prepare('INSERT OR IGNORE INTO stages (festival_id, id, name, color, x, y, vibe, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(f.id, st.id, st.name, PALETTE[i % PALETTE.length], 200 + (i % 4) * 180, 220 + Math.floor(i / 4) * 200, '', i)),
    ...data.acts.map((a) =>
      db.prepare('INSERT INTO acts (festival_id, id, day, stage_id, artist, start_min, end_min, genre, bio, popularity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.5)').bind(f.id, a.id, a.day, a.stage_id, a.artist, a.start_min, a.end_min, a.genre, a.bio),
    ),
    touch(db, f.id),
  ])
  return c.json({ restored: data.acts.length })
})

/* ---------- Timetable changes ---------- */

type ChangeRow = { act_id: string; start_min: number | null; end_min: number | null; stage: string | null; cancelled: number; note: string | null; updated_at: number }
const toChange = (r: ChangeRow) => ({ actId: r.act_id, start: r.start_min, end: r.end_min, stage: r.stage, cancelled: !!r.cancelled, note: r.note, updatedAt: r.updated_at })

app.get('/api/timetable/changes', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM timetable_changes WHERE festival_id = ? ORDER BY updated_at DESC').bind(c.get('festival').id).all<ChangeRow>()
  return c.json(rows.results.map(toChange))
})

app.put('/api/admin/timetable/:actId', async (c) => {
  const actId = c.req.param('actId')
  if (!/^[a-z0-9-]{1,60}$/.test(actId)) throw new HttpError(400, 'actId ist ungültig')
  if (!(await actExists(c, actId))) throw new HttpError(404, 'Act gehört nicht zu diesem Festival')
  const b = await body(c)
  const time = (x: unknown, name: string) => (x === undefined || x === null ? null : v.int(x, name, 0, 30 * 60))
  const start = time(b.start, 'start')
  const end = time(b.end, 'end')
  if ((start === null) !== (end === null)) throw new HttpError(400, 'start und end gehören zusammen')
  if (start !== null && end! <= start) throw new HttpError(400, 'end muss nach start liegen')
  const stage = b.stage === undefined || b.stage === null ? null : v.oneOf(b.stage, 'stage', c.get('festival').stages)
  const cancelled = b.cancelled === undefined ? false : v.bool(b.cancelled, 'cancelled')
  const note = v.str(b.note, 'Hinweis', { max: 140, optional: true }) ?? null
  if (start === null && stage === null && !cancelled) throw new HttpError(400, 'Keine Änderung angegeben')
  const row: ChangeRow = { act_id: actId, start_min: start, end_min: end, stage, cancelled: cancelled ? 1 : 0, note, updated_at: Date.now() }
  await c.env.DB.prepare(
    'INSERT INTO timetable_changes (festival_id, act_id, start_min, end_min, stage, cancelled, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(festival_id, act_id) DO UPDATE SET start_min = excluded.start_min, end_min = excluded.end_min, stage = excluded.stage, cancelled = excluded.cancelled, note = excluded.note, updated_at = excluded.updated_at',
  )
    .bind(c.get('festival').id, row.act_id, row.start_min, row.end_min, row.stage, row.cancelled, row.note, row.updated_at)
    .run()
  return c.json(toChange(row))
})

app.delete('/api/admin/timetable/:actId', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM timetable_changes WHERE festival_id = ? AND act_id = ?').bind(c.get('festival').id, c.req.param('actId')).run()
  if (!res.meta.changes) throw new HttpError(404, 'Keine Änderung für diesen Act')
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
     FROM reports r WHERE r.festival_id = ? AND r.expires_at > ? ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(g.id, c.get('festival').id, now)
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
    id: clientId(b.id, 'r'),
    title: v.str(b.title, 'Titel', { min: 3, max: 120 })!,
    place: v.str(b.place, 'Ort', { max: 60, optional: true }) ?? null,
    poi: v.str(b.poi, 'poi', { max: 40, optional: true }) ?? null,
    severity: b.severity === undefined ? 'info' : v.oneOf(b.severity, 'severity', SEVERITIES),
  }
  const res = await c.env.DB.prepare('INSERT OR IGNORE INTO reports (id, festival_id, guest_id, title, place, poi, severity, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(r.id, c.get('festival').id, g.id, r.title, r.place, r.poi, r.severity, now, now + REPORT_TTL).run()
  if (!res.meta.changes) {
    const prev = await c.env.DB.prepare('SELECT 1 FROM reports WHERE id = ? AND guest_id = ? AND festival_id = ?').bind(r.id, g.id, c.get('festival').id).first()
    if (!prev) throw new HttpError(409, 'id ist bereits vergeben')
    return c.json({ ...r, source: 'unconfirmed', confirms: 1, mine: true, myVote: null, ageMin: 0, validMin: REPORT_TTL / MIN }, 200)
  }
  return c.json({ ...r, source: 'unconfirmed', confirms: 1, mine: true, myVote: null, ageMin: 0, validMin: REPORT_TTL / MIN }, 201)
})

app.put('/api/reports/:id/vote', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'vote:' + g.id, 60, 10 * MIN)
  const kind = v.oneOf((await body(c)).kind, 'kind', ['still', 'fixed'] as const)
  const id = c.req.param('id')
  const now = Date.now()
  const r = await c.env.DB.prepare('SELECT id, guest_id, expires_at FROM reports WHERE id = ? AND festival_id = ? AND expires_at > ?').bind(id, c.get('festival').id, now).first<{ id: string; guest_id: string; expires_at: number }>()
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
  // hourly housekeeping: drop long-expired reports/announcements and stale rate windows
  async scheduled(_: ScheduledController, env: Env) {
    const now = Date.now()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reports WHERE expires_at < ?').bind(now - 24 * 60 * MIN),
      env.DB.prepare('DELETE FROM announcements WHERE expires_at IS NOT NULL AND expires_at < ?').bind(now - 24 * 60 * MIN),
      env.DB.prepare('DELETE FROM rate WHERE window < ?').bind(now - 2 * 60 * MIN),
      // expired location shares are ended for good, not just hidden
      env.DB.prepare('UPDATE crew_members SET share_location = 0, location = NULL, location_at = NULL WHERE share_location = 1 AND location_at < ?').bind(now - LOCATION_TTL),
      // the public chat is ephemeral: 30 days after the last change
      env.DB.prepare('DELETE FROM festival_messages WHERE updated_at < ?').bind(now - 30 * 24 * 60 * MIN),
      // FAQ-bot statistics are kept for one festival cycle
      env.DB.prepare('DELETE FROM faq_events WHERE created_at < ?').bind(now - 365 * 24 * 60 * MIN),
    ])
  },
}

