import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { defaultOn, isEnabled, MODULE_KEYS, moduleConflicts, MODULES, type ModuleKey, type ModuleState } from '../../src/modules'
import { checkBrand, HEX } from '../../src/theme/contrast'
import { powBits, verify } from '../../src/pow'
import { MAX_END, MAX_START, validTimeZone } from '../../src/festivalTime'
import { checkPassword, checkTotp, hashPassword, newTotpSecret } from './accounts'
import { HttpError, normalizeCode, randomCode, randomId, randomToken, sha256, v } from './util'

export interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
  /** Organizer secret (`wrangler secret put ADMIN_TOKEN`); admin routes are disabled without it. */
  ADMIN_TOKEN?: string
}

type Guest = { id: string; nickname: string | null; color: string }
type Festival = { id: string; slug: string; status: 'draft' | 'published' | 'archived'; stages: string[]; modules: ModuleState }
/** Who is working in the console: a personal account, or the platform key (break-glass, CLI) */
type Admin = { id: string; name: string; role: 'platform' | 'organizer'; festivals: Set<string>; session: string | null; totp: boolean; mfaReady: boolean }
type App = { Bindings: Env; Variables: { guest: Guest; festival: Festival; admin: Admin | null } }

const MIN = 60_000
const DAY = 24 * 60 * MIN

/**
 * How long data is kept (audit F12, see docs/DATA_RETENTION.md). The hourly cron enforces every line.
 * Deleting a guest cascades to plans (and their reminders/attendance marks), steps, crew memberships, messages, meetups, votes and flags.
 */
const RETENTION = {
  guestInactive: 180 * DAY,
  crewMessages: 60 * DAY,
  meetups: 60 * DAY,
  steps: 60 * DAY,
  festivalChat: 30 * DAY,
  reports: 1 * DAY, // after expiry
  announcements: 1 * DAY, // after expiry
  faqEvents: 365 * DAY,
  importSnapshots: 180 * DAY,
  auditLog: 730 * DAY,
  adminSessions: 1 * DAY, // after expiry
}
const FLAGS_TO_HIDE = 2
/** The public festival chat needs more voices to hide a message than a crew of friends. */
const PUBLIC_FLAGS_TO_HIDE = 3
/** A location share ends on its own when the app has not confirmed it for this long. */
const LOCATION_TTL = 120 * MIN
const REPORT_TTL = 60 * MIN
const STILL_EXTENDS = 30 * MIN
/** a community report lives at most this long, however often it is confirmed */
const REPORT_MAX_LIFE = 4 * 60 * MIN
const SEVERITIES = ['info', 'warning'] as const

const app = new Hono<App>()

app.use('/api/*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  return cors({ origin: (o) => (allowed.includes('*') || allowed.includes(o) ? o : null), allowHeaders: ['Authorization', 'Content-Type', 'X-Festival'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 86400 })(c, next)
})

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ ...err.data, error: err.message }, err.status)
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

/** Counts one request for `key` in the current window and returns the count so far. */
async function bump(db: D1Database, key: string, windowMs: number) {
  const win = Math.floor(Date.now() / windowMs) * windowMs
  const row = await db
    .prepare('INSERT INTO rate (key, window, count) VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = ?2 THEN count + 1 ELSE 1 END, window = ?2 RETURNING count')
    .bind(key, win)
    .first<{ count: number }>()
  return row?.count ?? 0
}

async function rateLimit(db: D1Database, key: string, limit: number, windowMs: number) {
  if ((await bump(db, key, windowMs)) > limit) throw new HttpError(429, 'Zu viele Anfragen – bitte kurz warten')
}

/**
 * Sign-ups behind one shared IP (audit F08): a festival WLAN or carrier NAT puts hundreds of visitors behind
 * one address, so the IP is only one signal. Up to SIGNUPS_FREE per 10 minutes need nothing; beyond that each
 * sign-up solves a one-time proof-of-work challenge that gets harder with volume; SIGNUPS_MAX is the hard cap.
 */
const SIGNUPS_FREE = 60
const SIGNUPS_MAX = 3000
const CHALLENGE_TTL = 10 * MIN

async function requireProofOfWork(c: Context<App>, signups: number, answer: unknown) {
  const db = c.env.DB
  const a = answer as { id?: unknown; nonce?: unknown } | undefined
  if (a && typeof a.id === 'string' && typeof a.nonce === 'number') {
    // one-time: the challenge is consumed whether or not the answer is right
    const ch = await db.prepare('DELETE FROM challenges WHERE id = ? AND created_at > ? RETURNING bits').bind(a.id, Date.now() - CHALLENGE_TTL).first<{ bits: number }>()
    if (ch && (await verify(a.id, a.nonce, ch.bits))) return
  }
  const id = randomToken()
  const bits = powBits(signups, SIGNUPS_FREE)
  await db.prepare('INSERT INTO challenges (id, bits, created_at) VALUES (?, ?, ?)').bind(id, bits, Date.now()).run()
  throw new HttpError(429, 'Viele Anmeldungen über dieses Netz – dein Gerät bestätigt kurz, dass es echt ist', { challenge: { id, bits } })
}

// Bearer auth for everything except guest creation, restore and health.
const auth = async (c: Context<App>, next: () => Promise<void>) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Nicht angemeldet')
  const row = await c.env.DB.prepare('SELECT id, nickname, color, last_seen FROM guests WHERE token_hash = ?').bind(await sha256(token)).first<Guest & { last_seen: number | null }>()
  if (!row) throw new HttpError(401, 'Sitzung ungültig')
  const { last_seen, ...g } = row
  // activity counts for the retention period (audit F12); written at most once a day
  if (!last_seen || last_seen < Date.now() - DAY) await c.env.DB.prepare('UPDATE guests SET last_seen = ? WHERE id = ?').bind(Date.now(), g.id).run()
  c.set('guest', g)
  await next()
}

const requireName = (g: Guest) => {
  if (!g.nickname) throw new HttpError(403, 'Bitte zuerst einen Namen wählen')
}

/** Membership is checked together with the tenant: a crew of another festival does not exist here. */
/** Members waiting for the owner's approval (audit F05) see nothing of the crew; only `allowPending` lets them in. */
async function membership(c: Context<App>, crewId: string, { allowPending = false } = {}) {
  const m = await c.env.DB.prepare('SELECT m.approved, c.created_by AS owner FROM crew_members m JOIN crews c ON c.id = m.crew_id WHERE m.crew_id = ? AND m.guest_id = ? AND c.festival_id = ?')
    .bind(crewId, c.get('guest').id, c.get('festival').id)
    .first<{ approved: number; owner: string }>()
  if (!m) throw new HttpError(404, 'Crew nicht gefunden')
  if (!m.approved && !allowPending) throw new HttpError(403, 'Dein Beitritt wartet noch auf Freigabe')
  return { pending: !m.approved, owner: m.owner === c.get('guest').id }
}

async function ownership(c: Context<App>, crewId: string, what: string) {
  const m = await membership(c, crewId)
  if (!m.owner) throw new HttpError(403, `Nur wer die Crew verantwortet, kann ${what}`)
}

/**
 * Audit F09: when the owner leaves or deletes their profile, the longest-standing approved member takes over;
 * a crew without any other approved member is dissolved (pending requests go with it).
 */
function handOver(db: D1Database, guestId: string, crewId: string | null) {
  const others = 'SELECT guest_id FROM crew_members WHERE crew_id = crews.id AND guest_id != ?1 AND approved = 1'
  return [
    db.prepare(`DELETE FROM crews WHERE id IN (SELECT crew_id FROM crew_members WHERE guest_id = ?1) AND (?2 IS NULL OR id = ?2) AND NOT EXISTS (${others})`).bind(guestId, crewId),
    db.prepare(`UPDATE crews SET created_by = (${others} ORDER BY joined_at LIMIT 1) WHERE created_by = ?1 AND (?2 IS NULL OR id = ?2)`).bind(guestId, crewId),
  ]
}

const bearer = (c: Context<App>) => c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''

async function isPlatformKey(c: Context<App>) {
  const expected = c.env.ADMIN_TOKEN
  if (!expected) return false
  // constant-time comparison via hashing both sides
  const [a, b] = await Promise.all([sha256(bearer(c)), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The console user behind this request (audit F01), or null. A personal session counts only while it is
 * valid and not revoked; `mfaReady` only after the authenticator code was confirmed in this session.
 * ADMIN_TOKEN stays as the platform key for the CLI and for creating the first account.
 */
async function resolveAdmin(c: Context<App>): Promise<Admin | null> {
  const cached = c.get('admin')
  if (cached !== undefined) return cached
  let a: Admin | null = null
  const token = bearer(c)
  if (token && (await isPlatformKey(c))) {
    a = { id: 'platform-key', name: 'Plattform-Schlüssel', role: 'platform', festivals: new Set(), session: null, totp: true, mfaReady: true }
  } else if (token) {
    const now = Date.now()
    const row = await c.env.DB.prepare(
      'SELECT s.id AS sid, s.mfa, a.id, a.name, a.role, a.totp_enabled FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ? AND a.disabled = 0',
    )
      .bind(await sha256(token), now)
      .first<{ sid: string; mfa: number; id: string; name: string; role: 'platform' | 'organizer'; totp_enabled: number }>()
    if (row) {
      const fs = await c.env.DB.prepare('SELECT festival_id FROM admin_festivals WHERE admin_id = ?').bind(row.id).all<{ festival_id: string }>()
      await c.env.DB.prepare('UPDATE admin_sessions SET last_seen = ? WHERE id = ?').bind(now, row.sid).run()
      a = { id: row.id, name: row.name, role: row.role, festivals: new Set(fs.results.map((r) => r.festival_id)), session: row.sid, totp: !!row.totp_enabled, mfaReady: !!row.totp_enabled && !!row.mfa }
    }
  }
  c.set('admin', a)
  return a
}

/** Platform admins reach every festival; organizers only the ones they are assigned to. */
const canAccess = (a: Admin | null, festivalId: string) => !!a && a.mfaReady && (a.role === 'platform' || a.festivals.has(festivalId))

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
  const admin = !!f && canAccess(await resolveAdmin(c), f.id)
  // drafts exist only for their organizers; console routes only for festivals the account may manage
  if (!f || (f.status === 'draft' && !admin) || (c.req.path.startsWith('/api/admin/') && !admin)) throw new HttpError(404, 'Festival nicht gefunden')
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
  // removing someone from a crew is a safety action, also when modules are off or the festival is archived
  if (method === 'DELETE' && /^\/api\/crews\/[^/]+\/members\/[^/]+$/.test(path)) return true
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

async function platformLegal(db: D1Database) {
  const rows = await db.prepare("SELECT key, value FROM platform_settings WHERE key IN ('imprint', 'privacy')").all<{ key: string; value: string }>()
  const m = Object.fromEntries(rows.results.map((r) => [r.key, r.value]))
  return { imprint: m.imprint ?? null, privacy: m.privacy ?? null }
}

/** The platform's legal notice and privacy information, also without a festival (console, landing). */
app.get('/api/legal', async (c) => c.json(await platformLegal(c.env.DB)))

/* ---------- Festivals (public) ---------- */

type FestivalRow = { id: string; slug: string; name: string; location: string | null; status: string; theme: string; modules: string; site_map: string | null; timezone: string; imprint: string | null; privacy: string | null; min_age: number; updated_at: number }

app.get('/api/festivals', async (c) => {
  const rows = await c.env.DB.prepare("SELECT slug, name, location FROM festivals WHERE status = 'published' ORDER BY name").all()
  return c.json(rows.results)
})

/** Everything the visitor app needs to render a festival, in one cacheable document. */
app.get('/api/festivals/:slug', async (c) => {
  const f = await c.env.DB.prepare('SELECT * FROM festivals WHERE slug = ?').bind(c.req.param('slug')).first<FestivalRow>()
  if (!f || (f.status === 'draft' && !canAccess(await resolveAdmin(c), f.id))) throw new HttpError(404, 'Festival nicht gefunden')
  const db = c.env.DB
  const [days, stages, acts, pois, faqs] = await db.batch([
    db.prepare('SELECT idx, date, label, short FROM festival_days WHERE festival_id = ? ORDER BY idx').bind(f.id),
    db.prepare('SELECT id, name, color, x, y, vibe FROM stages WHERE festival_id = ? ORDER BY sort, name').bind(f.id),
    db.prepare('SELECT id, day, stage_id AS stage, artist, start_min AS start, end_min AS "end", genre, bio, popularity FROM acts WHERE festival_id = ? ORDER BY day, start_min').bind(f.id),
    db.prepare('SELECT id, cat, name, x, y, detail, status, important FROM pois WHERE festival_id = ? ORDER BY rowid').bind(f.id),
    db.prepare("SELECT id, question, answer, category, keywords, source, updated_at AS updatedAt, question_en, answer_en, keywords_en FROM faqs WHERE festival_id = ? AND status = 'published' ORDER BY sort, category, question").bind(f.id),
  ])
  return c.json({
    festival: { slug: f.slug, name: f.name, location: f.location, status: f.status, theme: JSON.parse(f.theme), modules: JSON.parse(f.modules), siteMap: f.site_map, timezone: f.timezone, updatedAt: f.updated_at },
    // legal notice and privacy information: the festival's own, and the platform's (Welle 7)
    legal: { imprint: f.imprint, privacy: f.privacy, minAge: f.min_age, platform: await platformLegal(c.env.DB) },
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
  await rateLimit(c.env.DB, 'guesth:' + ip, SIGNUPS_MAX, 60 * MIN)
  const b = await body(c).catch(() => ({}) as Record<string, unknown>)
  const signups = await bump(c.env.DB, 'guest:' + ip, 10 * MIN)
  if (signups > SIGNUPS_FREE) await requireProofOfWork(c, signups, b.challenge)
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
  const crews = await c.env.DB.prepare("SELECT c.id, c.name, CASE WHEN m.approved = 1 THEN c.code ELSE '' END AS code, m.approved = 0 AS pending FROM crews c JOIN crew_members m ON m.crew_id = c.id WHERE m.guest_id = ? AND c.festival_id = ? ORDER BY m.joined_at").bind(g.id, fid).all()
  const plan = await c.env.DB.prepare('SELECT act_id FROM plans WHERE guest_id = ? AND festival_id = ?').bind(g.id, fid).all<{ act_id: string }>()
  const secured = await c.env.DB.prepare('SELECT recovery_hash IS NOT NULL AS s FROM guests WHERE id = ?').bind(g.id).first<{ s: number }>()
  const marks = (await c.env.DB.prepare('SELECT act_id, remind, attended FROM plan_marks WHERE guest_id = ? AND festival_id = ?').bind(g.id, fid).all<{ act_id: string; remind: number; attended: number | null }>()).results
  return c.json({
    ...g,
    secured: !!secured?.s,
    crews: crews.results.map((r) => ({ ...r, pending: !!r.pending })),
    plan: plan.results.map((r) => r.act_id),
    reminders: marks.filter((m) => m.remind).map((m) => m.act_id),
    attended: Object.fromEntries(marks.filter((m) => m.attended !== null).map((m) => [m.act_id, !!m.attended])),
  })
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
    // crews without another approved member go with the guest, the others get a new owner; everything else cascades
    ...handOver(c.env.DB, id, null),
    c.env.DB.prepare('DELETE FROM guests WHERE id = ?').bind(id),
  ])
  return c.body(null, 204)
})

app.post('/api/me/recovery', async (c) => {
  const code = randomCode(4)
  await c.env.DB.prepare('UPDATE guests SET recovery_hash = ? WHERE id = ?').bind(await sha256(code), c.get('guest').id).run()
  return c.json({ code })
})

/** Reminders (act ids) and attendance answers (act id → yes/no); null when the request carries neither. */
function parseMarks(reminders: unknown, attended: unknown, known: Set<string>) {
  if (reminders === undefined && attended === undefined) return null
  const isId = (a: unknown): a is string => typeof a === 'string' && a.length <= 60
  if (reminders !== undefined && (!Array.isArray(reminders) || reminders.length > 300 || !reminders.every(isId))) throw new HttpError(400, 'reminders ist ungültig')
  const answers = attended === undefined ? [] : attended && typeof attended === 'object' && !Array.isArray(attended) ? Object.entries(attended) : null
  if (!answers || answers.length > 300 || !answers.every(([k, v]) => isId(k) && typeof v === 'boolean')) throw new HttpError(400, 'attended ist ungültig')
  const marks = new Map<string, { act: string; remind: boolean; attended: boolean | null }>()
  const mark = (act: string) => marks.get(act) ?? (marks.set(act, { act, remind: false, attended: null }), marks.get(act)!)
  for (const a of (reminders as string[] | undefined) ?? []) if (known.has(a)) mark(a).remind = true
  for (const [a, v] of answers as [string, boolean][]) if (known.has(a)) mark(a).attended = v
  return [...marks.values()]
}

app.put('/api/me/plan', async (c) => {
  const b = await body(c)
  const acts = b.acts
  if (!Array.isArray(acts) || acts.length > 200 || !acts.every((a) => typeof a === 'string' && a.length <= 60)) throw new HttpError(400, 'acts ist ungültig')
  const id = c.get('guest').id
  const fid = c.get('festival').id
  // only acts of this festival are stored; unknown ids (stale or foreign) are reported back
  const known = new Set((await c.env.DB.prepare('SELECT id FROM acts WHERE festival_id = ?').bind(fid).all<{ id: string }>()).results.map((r) => r.id))
  const unique = [...new Set(acts as string[])]
  const accepted = unique.filter((a) => known.has(a))
  // reminders and "Were you there?" answers ride along (optional: older apps send only acts and keep the marks)
  const marks = parseMarks(b.reminders, b.attended, known)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM plans WHERE guest_id = ? AND festival_id = ?').bind(id, fid),
    ...accepted.map((a) => c.env.DB.prepare('INSERT INTO plans (guest_id, festival_id, act_id) VALUES (?, ?, ?)').bind(id, fid, a)),
    ...(marks
      ? [
          c.env.DB.prepare('DELETE FROM plan_marks WHERE guest_id = ? AND festival_id = ?').bind(id, fid),
          ...marks.map((m) => c.env.DB.prepare('INSERT INTO plan_marks (guest_id, festival_id, act_id, remind, attended) VALUES (?, ?, ?, ?, ?)').bind(id, fid, m.act, m.remind ? 1 : 0, m.attended === null ? null : m.attended ? 1 : 0)),
        ]
      : []),
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
    // new crews ask the owner before anyone joins (audit F05); the owner can switch that off
    c.env.DB.prepare('INSERT INTO crews (id, festival_id, code, name, created_by, created_at, approve_joins) VALUES (?, ?, ?, ?, ?, ?, 1)').bind(id, c.get('festival').id, code, name, g.id, now),
    c.env.DB.prepare('INSERT INTO crew_members (crew_id, guest_id, joined_at) VALUES (?, ?, ?)').bind(id, g.id, now),
  ])
  return c.json({ id, name, code, pending: false }, 201)
})

app.post('/api/crews/join', async (c) => {
  const g = c.get('guest')
  requireName(g)
  await rateLimit(c.env.DB, 'join:' + g.id, 20, 60 * MIN)
  const code = normalizeCode(v.str((await body(c)).code, 'Code', { max: 20 })!)
  const crew = await c.env.DB.prepare('SELECT id, name, code, approve_joins FROM crews WHERE code = ? AND festival_id = ?').bind(code, c.get('festival').id).first<{ id: string; name: string; code: string; approve_joins: number }>()
  if (!crew) throw new HttpError(404, 'Einladung nicht gefunden')
  const banned = await c.env.DB.prepare('SELECT 1 FROM crew_bans WHERE crew_id = ? AND guest_id = ?').bind(crew.id, g.id).first()
  if (banned) throw new HttpError(403, 'Du wurdest aus dieser Crew entfernt')
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?').bind(crew.id).first<{ n: number }>()
  if ((count?.n ?? 0) >= 50) throw new HttpError(409, 'Crew ist voll (max. 50)')
  const existing = await c.env.DB.prepare('SELECT approved FROM crew_members WHERE crew_id = ? AND guest_id = ?').bind(crew.id, g.id).first<{ approved: number }>()
  if (!existing) await c.env.DB.prepare('INSERT INTO crew_members (crew_id, guest_id, joined_at, approved) VALUES (?, ?, ?, ?)').bind(crew.id, g.id, Date.now(), crew.approve_joins ? 0 : 1).run()
  const pending = existing ? !existing.approved : !!crew.approve_joins
  // until approved, the joiner learns nothing but the crew's name
  return c.json({ id: crew.id, name: crew.name, code: pending ? '' : crew.code, pending })
})

app.post('/api/crews/:id/leave', async (c) => {
  const crewId = c.req.param('id')
  const id = c.get('guest').id
  await membership(c, crewId, { allowPending: true })
  await c.env.DB.batch([...handOver(c.env.DB, id, crewId), c.env.DB.prepare('DELETE FROM crew_members WHERE crew_id = ? AND guest_id = ?').bind(crewId, id)])
  return c.body(null, 204)
})

/** Owner settings: whether joining needs approval. */
app.patch('/api/crews/:id', async (c) => {
  const crewId = c.req.param('id')
  await ownership(c, crewId, 'Einstellungen ändern')
  const approveJoins = v.bool((await body(c)).approveJoins, 'approveJoins')
  await c.env.DB.prepare('UPDATE crews SET approve_joins = ? WHERE id = ?').bind(approveJoins ? 1 : 0, crewId).run()
  return c.json({ approveJoins })
})

/** A fresh invite code: the old link stops working at once. */
app.post('/api/crews/:id/code', async (c) => {
  const crewId = c.req.param('id')
  await ownership(c, crewId, 'den Einladungscode erneuern')
  const code = randomCode(2)
  await c.env.DB.prepare('UPDATE crews SET code = ? WHERE id = ?').bind(code, crewId).run()
  return c.json({ code })
})

app.post('/api/crews/:id/members/:guestId/approve', async (c) => {
  const crewId = c.req.param('id')
  await ownership(c, crewId, 'Beitritte freigeben')
  const res = await c.env.DB.prepare('UPDATE crew_members SET approved = 1, joined_at = ? WHERE crew_id = ? AND guest_id = ? AND approved = 0').bind(Date.now(), crewId, c.req.param('guestId')).run()
  if (!res.meta.changes) throw new HttpError(404, 'Keine offene Anfrage')
  return c.body(null, 204)
})

/** Everything a crew screen needs in one round trip; `since` limits messages to new ones. */
app.get('/api/crews/:id', async (c) => {
  const crewId = c.req.param('id')
  const g = c.get('guest')
  const me = await membership(c, crewId, { allowPending: true })
  if (me.pending) {
    const crew = await c.env.DB.prepare('SELECT id, name FROM crews WHERE id = ?').bind(crewId).first<{ id: string; name: string }>()
    return c.json({ pending: true, crew: { ...crew, code: '' } })
  }
  const since = Number(c.req.query('since') ?? 0) || 0
  const db = c.env.DB
  const [crew, members, plans, steps, messages, meetups, rsvps] = await db.batch([
    db.prepare('SELECT id, name, code, created_by AS owner, approve_joins FROM crews WHERE id = ?').bind(crewId),
    db.prepare(
      `SELECT g.id, g.nickname, g.color, (m.share_location = 1 AND m.location_at > ${Date.now() - LOCATION_TTL}) AS share_location, CASE WHEN m.share_location = 1 AND m.location_at > ${Date.now() - LOCATION_TTL} THEN m.location END AS location, CASE WHEN m.share_location = 1 AND m.location_at > ${Date.now() - LOCATION_TTL} THEN m.location_at END AS location_at, m.approved FROM crew_members m JOIN guests g ON g.id = m.guest_id WHERE m.crew_id = ? ORDER BY m.joined_at`,
    ).bind(crewId),
    db.prepare('SELECT p.guest_id, p.act_id FROM plans p JOIN crew_members m ON m.guest_id = p.guest_id WHERE m.crew_id = ? AND m.approved = 1 AND p.festival_id = ?').bind(crewId, c.get('festival').id),
    db.prepare('SELECT s.guest_id, s.day, s.total, s.synced_at FROM steps s JOIN crew_members m ON m.guest_id = s.guest_id WHERE m.crew_id = ? AND m.approved = 1 AND s.festival_id = ?').bind(crewId, c.get('festival').id),
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
  const head = crew.results[0] as R
  return c.json({
    crew: { id: head.id, name: head.name, code: head.code, approveJoins: !!head.approve_joins },
    owner: head.owner,
    me: g.id,
    serverTime: Date.now(),
    // join requests are visible to the owner only, and carry nothing but a name
    members: (members.results as R[]).filter((m) => m.approved || me.owner).map((m) => !m.approved ? { id: m.id, nickname: m.nickname, color: m.color, pending: true, sharing: false, location: null, locationAt: null, plan: [], steps: [] } : ({
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

// The owner removes a member or declines a join request: that profile is banned and the invite code renewed.
app.delete('/api/crews/:id/members/:guestId', async (c) => {
  const crewId = c.req.param('id')
  const target = c.req.param('guestId')
  const g = c.get('guest')
  await ownership(c, crewId, 'Mitglieder entfernen')
  if (target === g.id) throw new HttpError(400, 'Verlasse die Crew stattdessen')
  const code = randomCode(2)
  const res = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM crew_members WHERE crew_id = ? AND guest_id = ?').bind(crewId, target),
    c.env.DB.prepare('INSERT OR IGNORE INTO crew_bans (crew_id, guest_id, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM guests WHERE id = ?)').bind(crewId, target, Date.now(), target),
    // the ban binds only to this guest profile; a new invite code keeps a fresh profile out too (audit F05)
    c.env.DB.prepare('UPDATE crews SET code = ? WHERE id = ?').bind(code, crewId),
  ])
  if (!res[0].meta.changes) throw new HttpError(404, 'Mitglied nicht gefunden')
  return c.json({ code })
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
    min: v.int(b.min, 'min', 0, MAX_START),
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

/** what an account can do before its authenticator app is confirmed in this session */
const MFA_FREE = /^\/api\/admin\/(me|session|logout|totp\/setup|totp\/enable)$/

const admin = async (c: Context<App>, next: () => Promise<void>) => {
  const a = await resolveAdmin(c)
  if (!a) throw new HttpError(401, 'Bitte anmelden')
  if (!a.mfaReady && !MFA_FREE.test(c.req.path)) throw new HttpError(403, a.totp ? 'Bitte den Code aus der Authenticator-App eingeben' : 'Bitte zuerst die Zwei-Faktor-Anmeldung einrichten', { mfa: a.totp ? 'verify' : 'setup' })
  await next()
  // change log: who changed what, when – successful writes only (errors are thrown past this point)
  if (c.req.method !== 'GET' && c.res.status < 400 && !c.req.path.startsWith('/api/admin/totp')) {
    const festival = c.req.path.match(/^\/api\/admin\/festivals\/([^/]+)/)?.[1] ?? c.req.header('X-Festival') ?? null
    await c.env.DB.prepare('INSERT INTO audit_log (admin_id, admin_name, festival, action, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(a.id, a.name, festival, `${c.req.method} ${c.req.path}`, c.res.status, Date.now())
      .run()
  }
}
app.use('/api/admin/*', admin)

/* ---------- Organizer accounts (audit F01) ---------- */

const SESSION_TTL = 12 * 60 * MIN
const INVITE_TTL = 7 * 24 * 60 * MIN

async function newSession(c: Context<App>, adminId: string) {
  const token = randomToken()
  const now = Date.now()
  await c.env.DB.prepare('INSERT INTO admin_sessions (id, token_hash, admin_id, mfa, created_at, expires_at, last_seen, agent) VALUES (?, ?, ?, 0, ?, ?, ?, ?)')
    .bind(randomId('as'), await sha256(token), adminId, now, now + SESSION_TTL, now, (c.req.header('User-Agent') ?? '').slice(0, 120))
    .run()
  return token
}

type AdminRow = { id: string; email: string; name: string; role: 'platform' | 'organizer'; password: string; totp_secret: string | null; totp_enabled: number; totp_last_step: number; disabled: number }

app.post('/api/auth/login', async (c) => {
  const b = await body(c)
  const email = v.str(b.email, 'E-Mail', { max: 120 })!.toLowerCase()
  const password = v.str(b.password, 'Passwort', { max: 200 })!
  await rateLimit(c.env.DB, 'login:' + email, 10, 15 * MIN)
  await rateLimit(c.env.DB, 'loginip:' + (c.req.header('CF-Connecting-IP') ?? 'local'), 100, 15 * MIN)
  const a = await c.env.DB.prepare('SELECT * FROM admins WHERE email = ? AND disabled = 0').bind(email).first<AdminRow>()
  // same work whether or not the account exists
  const ok = await checkPassword(password, a?.password ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
  if (!a || !ok) throw new HttpError(401, 'E-Mail oder Passwort falsch')
  return c.json({ token: await newSession(c, a.id), mfa: a.totp_enabled ? 'verify' : 'setup', name: a.name, role: a.role })
})

/** Second step of the login: the code from the authenticator app unlocks this session. */
app.post('/api/auth/totp', async (c) => {
  const code = v.str((await body(c)).code, 'Code', { max: 10 })!.replace(/\s/g, '')
  const tokenHash = await sha256(bearer(c))
  await rateLimit(c.env.DB, 'totp:' + tokenHash, 10, 15 * MIN)
  const row = await c.env.DB.prepare('SELECT s.id AS sid, a.* FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ? AND a.disabled = 0')
    .bind(tokenHash, Date.now())
    .first<AdminRow & { sid: string }>()
  if (!row) throw new HttpError(401, 'Bitte erneut anmelden')
  if (!row.totp_enabled || !row.totp_secret) throw new HttpError(400, 'Zwei-Faktor ist noch nicht eingerichtet')
  const step = await checkTotp(row.totp_secret, code)
  // each code works once, so an observed code cannot be replayed
  if (step === null || step <= row.totp_last_step) throw new HttpError(401, 'Code falsch oder schon benutzt')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admin_sessions SET mfa = 1 WHERE id = ?').bind(row.sid),
    c.env.DB.prepare('UPDATE admins SET totp_last_step = ? WHERE id = ?').bind(step, row.id),
  ])
  return c.json({ ok: true })
})

/** Accepting an invitation: a one-time link creates the account (or adds the festival to an existing one). */
app.post('/api/auth/accept', async (c) => {
  const b = await body(c)
  const tokenHash = await sha256(v.str(b.token, 'Einladung', { max: 100 })!)
  const password = v.str(b.password, 'Passwort', { min: 12, max: 200 })!
  await rateLimit(c.env.DB, 'accept:' + (c.req.header('CF-Connecting-IP') ?? 'local'), 20, 15 * MIN)
  const inv = await c.env.DB.prepare('SELECT * FROM admin_invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').bind(tokenHash, Date.now()).first<{ email: string; role: 'platform' | 'organizer'; festival_id: string | null }>()
  if (!inv) throw new HttpError(404, 'Einladung ungültig, abgelaufen oder schon benutzt')
  const existing = await c.env.DB.prepare('SELECT * FROM admins WHERE email = ?').bind(inv.email).first<AdminRow>()
  let id: string
  if (existing) {
    if (existing.disabled || !(await checkPassword(password, existing.password))) throw new HttpError(401, 'Für diese E-Mail gibt es schon ein Konto – bitte dessen Passwort eingeben')
    id = existing.id
  } else {
    id = randomId('ad')
    const name = v.str(b.name, 'Name', { min: 2, max: 60 })!
    await c.env.DB.prepare('INSERT INTO admins (id, email, name, role, password, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, inv.email, name, inv.role, await hashPassword(password), Date.now()).run()
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admin_invites SET used_at = ? WHERE token_hash = ?').bind(Date.now(), tokenHash),
    ...(inv.festival_id ? [c.env.DB.prepare('INSERT OR IGNORE INTO admin_festivals (admin_id, festival_id) VALUES (?, ?)').bind(id, inv.festival_id)] : []),
  ])
  const a = await c.env.DB.prepare('SELECT * FROM admins WHERE id = ?').bind(id).first<AdminRow>()
  return c.json({ token: await newSession(c, id), mfa: a!.totp_enabled ? 'verify' : 'setup', name: a!.name, role: a!.role }, 201)
})

async function festivalSlugs(db: D1Database, a: Admin) {
  const rows = a.role === 'platform' ? await db.prepare('SELECT slug FROM festivals ORDER BY name').all<{ slug: string }>() : await db.prepare('SELECT f.slug FROM festivals f JOIN admin_festivals af ON af.festival_id = f.id WHERE af.admin_id = ? ORDER BY f.name').bind(a.id).all<{ slug: string }>()
  return rows.results.map((r) => r.slug)
}

app.get('/api/admin/me', async (c) => {
  const a = c.get('admin')!
  const row = a.session ? await c.env.DB.prepare('SELECT email FROM admins WHERE id = ?').bind(a.id).first<{ email: string }>() : null
  return c.json({ id: a.id, name: a.name, email: row?.email ?? null, role: a.role, totp: a.totp, mfa: a.mfaReady, personal: !!a.session, festivals: a.mfaReady ? await festivalSlugs(c.env.DB, a) : [] })
})
app.get('/api/admin/session', (c) => c.json({ ok: true }))

app.post('/api/admin/logout', async (c) => {
  const a = c.get('admin')!
  if (a.session) await c.env.DB.prepare('UPDATE admin_sessions SET revoked = 1 WHERE id = ?').bind(a.session).run()
  return c.body(null, 204)
})

/** Step 1 of two-factor setup: a fresh secret for the authenticator app (shown once). */
app.post('/api/admin/totp/setup', async (c) => {
  const a = c.get('admin')!
  if (!a.session) throw new HttpError(400, 'Nur für persönliche Konten')
  // replacing an active second factor needs a session that already proved it
  if (a.totp && !a.mfaReady) throw new HttpError(403, 'Bitte zuerst mit dem bisherigen Code anmelden')
  const row = await c.env.DB.prepare('SELECT email, totp_secret, totp_enabled FROM admins WHERE id = ?').bind(a.id).first<{ email: string; totp_secret: string | null; totp_enabled: number }>()
  // a secret not yet confirmed is shown again (a reload or a second tab must not invalidate the app entry)
  const secret = !row!.totp_enabled && row!.totp_secret ? row!.totp_secret : newTotpSecret()
  await c.env.DB.prepare('UPDATE admins SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').bind(secret, a.id).run()
  return c.json({ secret, uri: `otpauth://totp/Realm:${encodeURIComponent(row!.email)}?secret=${secret}&issuer=Realm` })
})

/** Step 2: the first code from the app confirms the setup and unlocks this session. */
app.post('/api/admin/totp/enable', async (c) => {
  const a = c.get('admin')!
  const code = v.str((await body(c)).code, 'Code', { max: 10 })!.replace(/\s/g, '')
  const row = await c.env.DB.prepare('SELECT totp_secret FROM admins WHERE id = ?').bind(a.id).first<{ totp_secret: string | null }>()
  if (!row?.totp_secret) throw new HttpError(400, 'Bitte zuerst einrichten')
  const step = await checkTotp(row.totp_secret, code)
  if (step === null) throw new HttpError(400, 'Code passt nicht – Uhrzeit des Handys prüfen und erneut versuchen')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admins SET totp_enabled = 1, totp_last_step = ? WHERE id = ?').bind(step, a.id),
    c.env.DB.prepare('UPDATE admin_sessions SET mfa = 1 WHERE id = ?').bind(a.session),
  ])
  return c.json({ ok: true })
})

app.get('/api/admin/sessions', async (c) => {
  const a = c.get('admin')!
  const rows = await c.env.DB.prepare('SELECT id, created_at, last_seen, expires_at, agent FROM admin_sessions WHERE admin_id = ? AND revoked = 0 AND expires_at > ? ORDER BY last_seen DESC').bind(a.id, Date.now()).all<Record<string, unknown>>()
  return c.json(rows.results.map((r) => ({ id: r.id, createdAt: r.created_at, lastSeen: r.last_seen, expiresAt: r.expires_at, agent: r.agent, current: r.id === a.session })))
})

app.delete('/api/admin/sessions/:id', async (c) => {
  const res = await c.env.DB.prepare('UPDATE admin_sessions SET revoked = 1 WHERE id = ? AND admin_id = ? AND revoked = 0').bind(c.req.param('id'), c.get('admin')!.id).run()
  if (!res.meta.changes) throw new HttpError(404, 'Sitzung nicht gefunden')
  return c.body(null, 204)
})

/** Invitations: platform admins invite anyone; organizers invite co-organizers for their own festivals. */
app.post('/api/admin/invites', async (c) => {
  const a = c.get('admin')!
  const b = await body(c)
  const email = v.str(b.email, 'E-Mail', { max: 120 })!.toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'E-Mail ist ungültig')
  const role = b.role === undefined ? 'organizer' : v.oneOf(b.role, 'Rolle', ['platform', 'organizer'] as const)
  if (role === 'platform' && a.role !== 'platform') throw new HttpError(403, 'Nur die Plattform-Verwaltung lädt Plattform-Admins ein')
  let festivalId: string | null = null
  if (b.festival !== undefined && b.festival !== null) {
    const f = await c.env.DB.prepare('SELECT id FROM festivals WHERE slug = ?').bind(v.str(b.festival, 'Festival', { max: 40 })!).first<{ id: string }>()
    if (!f || !canAccess(a, f.id)) throw new HttpError(404, 'Festival nicht gefunden')
    festivalId = f.id
  }
  if (role === 'organizer' && !festivalId) throw new HttpError(400, 'Veranstalter:innen werden immer für ein Festival eingeladen')
  const token = randomToken()
  const now = Date.now()
  await c.env.DB.prepare('INSERT INTO admin_invites (token_hash, email, role, festival_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await sha256(token), email, role, festivalId, a.id, now, now + INVITE_TTL).run()
  return c.json({ token, email, role, expiresAt: now + INVITE_TTL }, 201)
})

/** Accounts with access to the festivals this admin manages (platform: all). */
app.get('/api/admin/accounts', async (c) => {
  const a = c.get('admin')!
  const slug = c.req.query('festival')
  const f = slug ? await c.env.DB.prepare('SELECT id FROM festivals WHERE slug = ?').bind(slug).first<{ id: string }>() : null
  if (slug && (!f || !canAccess(a, f.id))) throw new HttpError(404, 'Festival nicht gefunden')
  if (!f && a.role !== 'platform') throw new HttpError(400, 'festival fehlt')
  const rows = f
    ? await c.env.DB.prepare('SELECT a.id, a.name, a.email, a.role, a.totp_enabled, a.disabled FROM admins a JOIN admin_festivals af ON af.admin_id = a.id WHERE af.festival_id = ? ORDER BY a.name').bind(f.id).all<Record<string, unknown>>()
    : await c.env.DB.prepare('SELECT id, name, email, role, totp_enabled, disabled FROM admins ORDER BY role, name').all<Record<string, unknown>>()
  return c.json(rows.results.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, totp: !!r.totp_enabled, disabled: !!r.disabled })))
})

/** Takes a festival away from an account – effective with the account's next request. */
app.delete('/api/admin/accounts/:id/festivals/:slug', async (c) => {
  const f = await festivalBySlug(c)
  const res = await c.env.DB.prepare('DELETE FROM admin_festivals WHERE admin_id = ? AND festival_id = ?').bind(c.req.param('id'), f.id).run()
  if (!res.meta.changes) throw new HttpError(404, 'Zugang nicht gefunden')
  return c.body(null, 204)
})

/** Platform only: disable an account and end all its sessions. */
app.delete('/api/admin/accounts/:id', async (c) => {
  if (c.get('admin')!.role !== 'platform') throw new HttpError(403, 'Nur für die Plattform-Verwaltung')
  const id = c.req.param('id')
  const res = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admins SET disabled = 1 WHERE id = ?').bind(id),
    c.env.DB.prepare('UPDATE admin_sessions SET revoked = 1 WHERE admin_id = ?').bind(id),
  ])
  if (!res[0].meta.changes) throw new HttpError(404, 'Konto nicht gefunden')
  return c.body(null, 204)
})

/** Change log of a festival (platform without festival: everything). */
app.get('/api/admin/audit', async (c) => {
  const a = c.get('admin')!
  const slug = c.req.query('festival')
  if (slug) {
    const f = await c.env.DB.prepare('SELECT id FROM festivals WHERE slug = ?').bind(slug).first<{ id: string }>()
    if (!f || !canAccess(a, f.id)) throw new HttpError(404, 'Festival nicht gefunden')
  } else if (a.role !== 'platform') throw new HttpError(400, 'festival fehlt')
  const rows = slug
    ? await c.env.DB.prepare('SELECT admin_name, festival, action, status, created_at FROM audit_log WHERE festival = ? ORDER BY id DESC LIMIT 200').bind(slug).all<Record<string, unknown>>()
    : await c.env.DB.prepare('SELECT admin_name, festival, action, status, created_at FROM audit_log ORDER BY id DESC LIMIT 200').all<Record<string, unknown>>()
  return c.json(rows.results.map((r) => ({ by: r.admin_name, festival: r.festival, action: r.action, status: r.status, at: r.created_at })))
})

app.get('/api/admin/festivals', async (c) => {
  const a = c.get('admin')!
  const rows =
    a.role === 'platform'
      ? await c.env.DB.prepare('SELECT slug, name, status FROM festivals ORDER BY status, name').all()
      : await c.env.DB.prepare('SELECT f.slug, f.name, f.status FROM festivals f JOIN admin_festivals af ON af.festival_id = f.id WHERE af.admin_id = ? ORDER BY f.status, f.name').bind(a.id).all()
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
  // another organizer's festival does not exist for this account (audit F01)
  if (!f || !canAccess(c.get('admin') ?? null, f.id)) throw new HttpError(404, 'Festival nicht gefunden')
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
    // whoever creates a festival manages it
    ...(c.get('admin')!.session ? [c.env.DB.prepare('INSERT INTO admin_festivals (admin_id, festival_id) VALUES (?, ?)').bind(c.get('admin')!.id, id)] : []),
  ])
  return c.json({ slug, name, location, status: 'draft' }, 201)
})

app.patch('/api/admin/festivals/:slug', async (c) => {
  const f = await festivalBySlug(c)
  const b = await body(c)
  const name = v.str(b.name, 'Name', { min: 2, max: 60, optional: true }) ?? f.name
  const status = b.status === undefined ? f.status : v.oneOf(b.status, 'Status', ['draft', 'published', 'archived'] as const)
  if (status === 'published' && f.status !== 'published') {
    // going live needs what visitors will rely on, plus the organizer's explicit confirmations (audit D10)
    const given = Array.isArray(b.confirm) ? (b.confirm as unknown[]).filter((x): x is string => typeof x === 'string') : []
    const checks = await readiness(c.env.DB, f.id, given)
    const missing = checks.filter((x) => !x.ok)
    if (missing.length) throw new HttpError(400, 'Noch nicht bereit: ' + missing.map((x) => x.text).join(' · '), { checks })
  }
  const updates: D1PreparedStatement[] = [c.env.DB.prepare('UPDATE festivals SET name = ?, status = ?, updated_at = ? WHERE id = ?').bind(name, status, Date.now(), f.id)]
  // an archived festival is over: nobody keeps sharing a location there
  if (status === 'archived') updates.push(c.env.DB.prepare('UPDATE crew_members SET share_location = 0, location = NULL, location_at = NULL WHERE crew_id IN (SELECT id FROM crews WHERE festival_id = ?)').bind(f.id))
  if (b.location !== undefined) updates.push(c.env.DB.prepare('UPDATE festivals SET location = ? WHERE id = ?').bind(v.str(b.location, 'Ort', { max: 80, optional: true }) ?? null, f.id))
  if (b.timezone !== undefined) {
    const tz = v.str(b.timezone, 'Zeitzone', { max: 60 })!
    if (!validTimeZone(tz)) throw new HttpError(400, 'Zeitzone ist ungültig (z. B. Europe/Berlin)')
    updates.push(c.env.DB.prepare('UPDATE festivals SET timezone = ? WHERE id = ?').bind(tz, f.id))
  }
  await c.env.DB.batch(updates)
  return c.json({ slug: f.slug, name, status })
})

/**
 * What must hold before a festival goes live (audit D10). Data checks follow what is switched on; the
 * confirmations are the organizer's responsibility and cannot be derived from data – the app shows a
 * schematic map and official warnings, so someone has to vouch for both.
 */
async function readiness(db: D1Database, festivalId: string, confirmed: string[]) {
  const [counts, mods] = await Promise.all([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM stages WHERE festival_id = ?1) AS stages, (SELECT COUNT(*) FROM acts WHERE festival_id = ?1) AS acts,
           (SELECT COUNT(*) FROM festival_days WHERE festival_id = ?1) AS days,
           (SELECT COUNT(*) FROM pois WHERE festival_id = ?1 AND cat = 'entrance') AS entrances, (SELECT COUNT(*) FROM pois WHERE festival_id = ?1 AND cat = 'medical') AS medical,
           (SELECT COUNT(*) FROM faqs WHERE festival_id = ?1 AND status = 'published') AS faqs`,
      )
      .bind(festivalId)
      .first<Record<string, number>>(),
    db.prepare('SELECT modules FROM festivals WHERE id = ?').bind(festivalId).first<{ modules: string }>(),
  ])
  const [legal, platform] = await Promise.all([db.prepare('SELECT imprint, privacy FROM festivals WHERE id = ?').bind(festivalId).first<{ imprint: string | null; privacy: string | null }>(), platformLegal(db)])
  const n = counts ?? {}
  const m = JSON.parse(mods?.modules || '{}') as ModuleState
  const on = MODULE_KEYS.filter((k) => isEnabled(m, k))
  const community = on.some((k) => k === 'reports' || k === 'chat' || k === 'festivalchat')
  const data = [
    { id: 'stages', ok: n.stages > 0, text: 'Mindestens eine Bühne' },
    { id: 'acts', ok: n.acts > 0, text: 'Mindestens ein Act im Timetable' },
    { id: 'days', ok: n.days > 0, text: 'Festivaltage festgelegt' },
    { id: 'entrance', ok: n.entrances > 0, text: 'Mindestens ein Eingang auf der Karte' },
    { id: 'medical', ok: n.medical > 0, text: 'Sanität auf der Karte' },
    ...(isEnabled(m, 'faqbot') ? [{ id: 'faq', ok: n.faqs > 0, text: 'Freigegebene FAQ für den FAQ-Bot' }] : []),
    { id: 'imprint', ok: !!(legal?.imprint || platform.imprint), text: 'Impressum hinterlegt (Festival oder Plattform)' },
    { id: 'privacy', ok: !!(legal?.privacy || platform.privacy), text: 'Datenschutzhinweise hinterlegt (Festival oder Plattform)' },
  ].map((x) => ({ ...x, kind: 'data' as const }))
  const confirm = [
    { id: 'terrain', text: 'Eingänge, Ausgänge, Sanität und Notrufnummer auf der Karte stimmen mit dem Gelände überein' },
    { id: 'warnings', text: 'Es ist geregelt, wer im Ernstfall offizielle Warnungen in dieser Konsole veröffentlicht' },
    { id: 'modules', text: `Nur diese Funktionen sind eingeschaltet, und wir bieten sie während des Festivals wirklich an: ${on.map((k) => MODULES[k].label).join(', ') || 'keine'}` },
    ...(community ? [{ id: 'moderation', text: 'Die Moderation der Community-Funktionen ist während des Festivals besetzt' }] : []),
    { id: 'preview', text: 'Die Besucher-Vorschau wurde angesehen' },
  ].map((x) => ({ ...x, kind: 'confirm' as const, ok: confirmed.includes(x.id) }))
  return [...data, ...confirm]
}

app.get('/api/admin/festivals/:slug/readiness', async (c) => {
  const f = await festivalBySlug(c)
  return c.json({ checks: await readiness(c.env.DB, f.id, []) })
})

const LEGAL_MAX = 30_000

/** The festival's legal notice, privacy information and minimum age – texts come from the organizer. */
app.put('/api/admin/festivals/:slug/legal', async (c) => {
  const f = await festivalBySlug(c)
  const b = await body(c)
  const text = (x: unknown, name: string) => (x === undefined ? undefined : (v.str(x, name, { max: LEGAL_MAX, optional: true }) ?? null))
  const imprint = text(b.imprint, 'Impressum')
  const privacy = text(b.privacy, 'Datenschutzhinweise')
  const minAge = b.minAge === undefined ? undefined : v.int(b.minAge, 'Mindestalter', 0, 21)
  const db = c.env.DB
  await db.batch([
    ...(imprint !== undefined ? [db.prepare('UPDATE festivals SET imprint = ? WHERE id = ?').bind(imprint, f.id)] : []),
    ...(privacy !== undefined ? [db.prepare('UPDATE festivals SET privacy = ? WHERE id = ?').bind(privacy, f.id)] : []),
    ...(minAge !== undefined ? [db.prepare('UPDATE festivals SET min_age = ? WHERE id = ?').bind(minAge, f.id)] : []),
    touch(db, f.id),
  ])
  const row = await db.prepare('SELECT imprint, privacy, min_age FROM festivals WHERE id = ?').bind(f.id).first<{ imprint: string | null; privacy: string | null; min_age: number }>()
  return c.json({ imprint: row!.imprint, privacy: row!.privacy, minAge: row!.min_age })
})

/** Platform texts – platform administrators only. */
app.put('/api/admin/platform/legal', async (c) => {
  if (c.get('admin')!.role !== 'platform') throw new HttpError(403, 'Nur für die Plattform-Verwaltung')
  const b = await body(c)
  const db = c.env.DB
  const writes = (['imprint', 'privacy'] as const).flatMap((k) => {
    if (b[k] === undefined) return []
    const val = v.str(b[k], k === 'imprint' ? 'Impressum' : 'Datenschutzhinweise', { max: LEGAL_MAX, optional: true })
    return [val ? db.prepare('INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, val) : db.prepare('DELETE FROM platform_settings WHERE key = ?').bind(k)]
  })
  if (writes.length) await db.batch(writes)
  return c.json(await platformLegal(db))
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
    db.prepare('SELECT id, name, color, x, y, vibe, sort FROM stages WHERE festival_id = ? ORDER BY sort').bind(f.id),
    db.prepare('SELECT id, day, stage_id, artist, start_min, end_min, genre, bio, popularity FROM acts WHERE festival_id = ?').bind(f.id),
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
    if (typeof r.start !== 'number' || typeof r.end !== 'number' || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.start >= MAX_START || r.end > MAX_END) {
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
    // the snapshot holds everything visitors see of the timetable: stages with their attributes, acts and
    // live changes (audit F16); a replace import is a new base timetable, so old live changes go with it
    snapshotId = randomId('snap')
    const changes = await db.prepare('SELECT * FROM timetable_changes WHERE festival_id = ?').bind(f.id).all()
    writes.push(
      db.prepare('INSERT INTO import_snapshots (id, festival_id, created_at, note, data) VALUES (?, ?, ?, ?, ?)').bind(snapshotId, f.id, Date.now(), `Vor Import (${summary.rows} Zeilen)`, JSON.stringify({ v: 2, stages, acts: actRows.results, changes: changes.results })),
      db.prepare('DELETE FROM acts WHERE festival_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(f.id, JSON.stringify(acts.map((a) => a.id))),
      db.prepare('DELETE FROM timetable_changes WHERE festival_id = ?').bind(f.id),
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
  type StageSnap = { id: string; name: string; color?: string; x?: number; y?: number; vibe?: string; sort?: number }
  type ChangeSnap = ChangeRow
  const data = JSON.parse(snap.data) as { v?: number; stages: StageSnap[]; acts: { id: string; day: number; stage_id: string; artist: string; start_min: number; end_min: number; genre: string; bio: string; popularity?: number }[]; changes?: ChangeSnap[] }
  const db = c.env.DB
  const ids = JSON.stringify(data.acts.map((a) => a.id))
  await db.batch([
    db.prepare('DELETE FROM acts WHERE festival_id = ?').bind(f.id),
    // stages come back with their attributes as saved (older snapshots: name only, current attributes kept)
    ...data.stages.map((st, i) =>
      st.color === undefined
        ? db.prepare('INSERT OR IGNORE INTO stages (festival_id, id, name, color, x, y, vibe, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(f.id, st.id, st.name, PALETTE[i % PALETTE.length], 200 + (i % 4) * 180, 220 + Math.floor(i / 4) * 200, '', i)
        : db
            .prepare('INSERT INTO stages (festival_id, id, name, color, x, y, vibe, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(festival_id, id) DO UPDATE SET name = excluded.name, color = excluded.color, x = excluded.x, y = excluded.y, vibe = excluded.vibe, sort = excluded.sort')
            .bind(f.id, st.id, st.name, st.color, st.x ?? 0, st.y ?? 0, st.vibe ?? '', st.sort ?? i),
    ),
    ...data.acts.map((a) =>
      db.prepare('INSERT INTO acts (festival_id, id, day, stage_id, artist, start_min, end_min, genre, bio, popularity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(f.id, a.id, a.day, a.stage_id, a.artist, a.start_min, a.end_min, a.genre, a.bio, a.popularity ?? 0.5),
    ),
    // live changes exactly as they were (older snapshots without them: drop changes of acts that are gone)
    ...(data.changes
      ? [
          db.prepare('DELETE FROM timetable_changes WHERE festival_id = ?').bind(f.id),
          ...data.changes.map((ch) =>
            db.prepare('INSERT INTO timetable_changes (festival_id, act_id, start_min, end_min, stage, cancelled, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(f.id, ch.act_id, ch.start_min, ch.end_min, ch.stage, ch.cancelled, ch.note, ch.updated_at),
          ),
        ]
      : [db.prepare('DELETE FROM timetable_changes WHERE festival_id = ? AND act_id NOT IN (SELECT value FROM json_each(?))').bind(f.id, ids)]),
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
  // the same limits as the import (audit F15): start before 06:00 next morning, end by 12:00
  const time = (x: unknown, name: string, max: number) => (x === undefined || x === null ? null : v.int(x, name, 0, max))
  const start = time(b.start, 'start', MAX_START - 1)
  const end = time(b.end, 'end', MAX_END)
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
    `SELECT r.id, r.title, r.place, r.poi, r.severity, r.created_at, r.expires_at, r.guest_id, r.verified,
       (SELECT COUNT(*) FROM votes WHERE report_id = r.id AND kind = 'still' AND guest_id != r.guest_id) AS still,
       (SELECT COUNT(*) FROM votes WHERE report_id = r.id AND kind = 'fixed' AND guest_id != r.guest_id) AS fixed,
       (SELECT kind FROM votes WHERE report_id = r.id AND guest_id = ?) AS my_vote
     FROM reports r WHERE r.festival_id = ? AND r.expires_at > ? ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(g.id, c.get('festival').id, now)
    .all<Record<string, unknown>>()
  return c.json(
    rows.results.map((r) => {
      // people who reported it: the reporter plus everyone else who said "still true" – own votes never count (audit F06)
      const confirms = 1 + (r.still as number)
      return {
        id: r.id,
        title: r.title,
        place: r.place,
        poi: r.poi,
        severity: r.severity,
        // "official" only when the organizer checked it; otherwise it says how many reported it, nothing more
        source: r.verified ? 'official' : confirms >= 3 ? 'confirmed' : 'unconfirmed',
        confirms,
        fixedVotes: r.fixed,
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
  if (r.guest_id === g.id && kind === 'still') throw new HttpError(400, 'Die eigene Meldung zählt schon – du kannst sie nur zurückziehen')
  await c.env.DB.prepare('INSERT INTO votes (report_id, guest_id, kind, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(report_id, guest_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at').bind(id, g.id, kind, now).run()
  if (kind === 'still') {
    // confirmations keep a report alive, but never beyond REPORT_MAX_LIFE after it was made
    await c.env.DB.prepare('UPDATE reports SET expires_at = MIN(created_at + ?, MAX(expires_at, ?)) WHERE id = ?').bind(REPORT_MAX_LIFE, now + STILL_EXTENDS, id).run()
  } else if (r.guest_id === g.id) {
    // the reporter can retire their own report; "fixed" from others is shown, but only the organizer or time ends it
    await c.env.DB.prepare('UPDATE reports SET expires_at = ? WHERE id = ?').bind(now, id).run()
  }
  return c.json({ id, kind })
})

/** Organizer view of community reports: verify as official or end them. */
app.get('/api/admin/festivals/:slug/reports', async (c) => {
  const f = await festivalBySlug(c)
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.place, r.created_at, r.expires_at, r.verified, g.nickname,
       (SELECT COUNT(*) FROM votes WHERE report_id = r.id AND kind = 'still' AND guest_id != r.guest_id) AS still,
       (SELECT COUNT(*) FROM votes WHERE report_id = r.id AND kind = 'fixed' AND guest_id != r.guest_id) AS fixed
     FROM reports r LEFT JOIN guests g ON g.id = r.guest_id WHERE r.festival_id = ? AND r.expires_at > ? ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(f.id, Date.now())
    .all<Record<string, unknown>>()
  return c.json(rows.results.map((r) => ({ id: r.id, title: r.title, place: r.place, by: r.nickname ?? 'Gast', at: r.created_at, expiresAt: r.expires_at, verified: !!r.verified, reporters: 1 + (r.still as number), fixedVotes: r.fixed })))
})

app.put('/api/admin/festivals/:slug/reports/:id', async (c) => {
  const f = await festivalBySlug(c)
  const verified = v.bool((await body(c)).verified, 'verified')
  const res = await c.env.DB.prepare('UPDATE reports SET verified = ? WHERE id = ? AND festival_id = ? AND expires_at > ?').bind(verified ? 1 : 0, c.req.param('id'), f.id, Date.now()).run()
  if (!res.meta.changes) throw new HttpError(404, 'Meldung nicht gefunden')
  return c.json({ verified })
})

app.delete('/api/admin/festivals/:slug/reports/:id', async (c) => {
  const f = await festivalBySlug(c)
  const now = Date.now()
  const res = await c.env.DB.prepare('UPDATE reports SET expires_at = ? WHERE id = ? AND festival_id = ? AND expires_at > ?').bind(now, c.req.param('id'), f.id, now).run()
  if (!res.meta.changes) throw new HttpError(404, 'Meldung nicht gefunden')
  return c.body(null, 204)
})

/** Hourly housekeeping: every retention period in RETENTION, expired shares, rate windows, challenges. */
async function housekeeping(db: D1Database, now: number) {
  const R = RETENTION
  await db.batch([
    db.prepare('DELETE FROM guests WHERE COALESCE(last_seen, created_at) < ?').bind(now - R.guestInactive),
    db.prepare('DELETE FROM messages WHERE created_at < ?').bind(now - R.crewMessages),
    db.prepare('DELETE FROM meetups WHERE created_at < ?').bind(now - R.meetups),
    db.prepare('DELETE FROM steps WHERE synced_at < ?').bind(now - R.steps),
    // crews nobody belongs to any more
    db.prepare('DELETE FROM crews WHERE NOT EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = crews.id)'),
    db.prepare('DELETE FROM reports WHERE expires_at < ?').bind(now - R.reports),
    db.prepare('DELETE FROM announcements WHERE expires_at IS NOT NULL AND expires_at < ?').bind(now - R.announcements),
    db.prepare('DELETE FROM festival_messages WHERE updated_at < ?').bind(now - R.festivalChat),
    db.prepare('DELETE FROM faq_events WHERE created_at < ?').bind(now - R.faqEvents),
    db.prepare('DELETE FROM import_snapshots WHERE created_at < ?').bind(now - R.importSnapshots),
    db.prepare('DELETE FROM audit_log WHERE created_at < ?').bind(now - R.auditLog),
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now - R.adminSessions),
    db.prepare('DELETE FROM admin_invites WHERE expires_at < ?').bind(now - R.adminSessions),
    db.prepare('DELETE FROM rate WHERE window < ?').bind(now - 2 * 60 * MIN),
    db.prepare('DELETE FROM challenges WHERE created_at < ?').bind(now - CHALLENGE_TTL),
    // expired location shares are ended for good, not just hidden
    db.prepare('UPDATE crew_members SET share_location = 0, location = NULL, location_at = NULL WHERE share_location = 1 AND location_at < ?').bind(now - LOCATION_TTL),
  ])
}

export default {
  fetch: app.fetch,
  async scheduled(_: ScheduledController, env: Env) {
    await housekeeping(env.DB, Date.now())
  },
}

