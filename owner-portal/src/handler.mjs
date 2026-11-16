import { renderDashboard } from './render.mjs'

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
}

const email = (value) => typeof value === 'string' ? value.trim().toLowerCase() : ''
const reply = (text, status, contentType = 'text/plain; charset=utf-8', head = false, extra = {}) =>
  new Response(head ? null : text, { status, headers: { ...headers, 'Content-Type': contentType, ...extra } })

/** Only the runtime's authenticated Access context is trusted, never client headers. */
export function createHandler(data, render = renderDashboard) {
  return {
    async fetch(request, env, ctx) {
      const head = request.method === 'HEAD'
      const owner = email(env?.OWNER_EMAIL)
      if (!owner || !owner.includes('@')) return reply('Der private Zugang wird eingerichtet.', 503, undefined, head)
      if (!ctx?.access || typeof ctx.access.getIdentity !== 'function') return reply('Cloudflare-Anmeldung erforderlich.', 403, undefined, head)
      let identity
      try { identity = await ctx.access.getIdentity() } catch { return reply('Anmeldung konnte nicht geprüft werden.', 403, undefined, head) }
      if (email(identity?.email) !== owner) return reply('Dieser Zugang ist nur für den Projekteigentümer freigegeben.', 403, undefined, head)
      if (!['GET', 'HEAD'].includes(request.method)) return reply('Methode nicht erlaubt.', 405, undefined, false, { Allow: 'GET, HEAD' })
      const path = new URL(request.url).pathname
      if (path === '/') return reply(render(data), 200, 'text/html; charset=utf-8', head)
      if (path === '/status.json') return reply(JSON.stringify(data), 200, 'application/json; charset=utf-8', head)
      return reply('Seite nicht gefunden.', 404, undefined, head)
    },
  }
}
