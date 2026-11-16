/** The website keeps its current origin; packaged iPhone builds require a public destination. */
export function publicAppBase(native: boolean, browserOrigin: string, configured?: string): string {
  if (!native) return browserOrigin
  if (!configured) throw new Error('Missing public app URL in native build')
  const url = new URL(configured)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid public app URL in native build')
  }
  return url.origin
}
