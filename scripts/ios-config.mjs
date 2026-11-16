/** Native builds must never silently become the built-in demo or share a local WebView URL. */
export function nativeBuildConfig(env) {
  const origin = (key) => {
    const value = env[key]?.trim()
    let url
    try { url = new URL(value) } catch { throw new Error(`${key} must be an absolute HTTPS origin for the iPhone build`) }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`${key} must be an HTTPS origin without credentials, path, query or fragment`)
    }
    return url.origin
  }
  return { apiUrl: origin('VITE_API_URL'), publicAppUrl: origin('VITE_PUBLIC_APP_URL') }
}
