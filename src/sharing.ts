export type SharingTransport = {
  share?: (data: ShareData) => Promise<void>
  writeText?: (text: string) => Promise<void>
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

// The installed iPhone WebView supports these APIs. Do not read the clipboard,
// and keep the call in the button's activation turn (no dynamic import/permission await).
function browserTransport(): SharingTransport {
  return {
    share: typeof navigator.share === 'function' ? navigator.share.bind(navigator) : undefined,
    writeText: navigator.clipboard?.writeText?.bind(navigator.clipboard),
  }
}

export async function copyText(text: string, transport = browserTransport()): Promise<boolean> {
  if (!transport.writeText) return false
  try {
    await transport.writeText(text)
    return true
  } catch {
    return false
  }
}

export async function shareText(data: ShareData, fallbackText: string, transport = browserTransport()): Promise<ShareResult> {
  if (!transport.share) return await copyText(fallbackText, transport) ? 'copied' : 'failed'
  try {
    await transport.share(data)
    // The OS accepted the handoff; this is not proof of delivery to a recipient.
    return 'shared'
  } catch (error) {
    // Dismissing the sheet must not silently overwrite the clipboard.
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled'
    return 'failed'
  }
}
