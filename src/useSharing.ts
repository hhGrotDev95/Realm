import { useRef, useState } from 'react'
import { t } from './i18n'
import { copyText, shareText } from './sharing'

/** One explicit user action at a time; never report a copy before it succeeds. */
export function useSharing(toast: (message: string) => void) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try { await action() } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return {
    busy,
    copy: (text: string, copiedMessage: string) => run(async () => {
      toast(await copyText(text) ? copiedMessage : t('Kopieren nicht möglich. Bitte versuche es erneut.'))
    }),
    share: (data: ShareData, fallbackText: string, copiedMessage: string) => run(async () => {
      const result = await shareText(data, fallbackText)
      if (result === 'copied') toast(copiedMessage)
      else if (result === 'failed') toast(t('Teilen nicht möglich. Bitte versuche es erneut.'))
    }),
  }
}
