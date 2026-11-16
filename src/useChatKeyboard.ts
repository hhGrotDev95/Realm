import { useEffect, type RefObject } from 'react'
import { isNativeApp } from './platform'

/** Keep the native Crew sheet inside the unzoomed WebView above its keyboard. */
export function useChatKeyboard(history: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport
    const sheet = history.current?.closest<HTMLElement>('.crew-chat-sheet')
    const device = sheet?.parentElement
    if (!isNativeApp || !viewport || !sheet || !device) return

    let frame = 0
    let keyboardSeen = false
    const reset = () => {
      keyboardSeen = false
      sheet.classList.remove('keyboard-fit')
      sheet.style.removeProperty('--chat-visible-top')
      sheet.style.removeProperty('--chat-visible-bottom')
    }
    const update = () => {
      frame = 0
      const bounds = device.getBoundingClientRect()
      const focused = document.activeElement === sheet.querySelector('.chat-input input')
      const height = Math.min(window.innerHeight, viewport.height)
      const stillPanned = keyboardSeen && bounds.top < -1
      // Ignore deliberate zoom and ordinary full-viewport changes. Keep fitting
      // during blur until keyboard dismissal actually restores the viewport.
      if (Math.abs(viewport.scale - 1) > 0.01 || (bounds.height - height < 80 && !stillPanned) || (!focused && !keyboardSeen)) {
        reset()
        return
      }
      keyboardSeen = true
      // On the measured unzoomed WKWebView, client rects already include its
      // keyboard pan. Adding visualViewport.offsetTop would count it twice.
      sheet.style.setProperty('--chat-visible-top', `${Math.max(0, -bounds.top)}px`)
      sheet.style.setProperty('--chat-visible-bottom', `${Math.max(0, bounds.bottom - height)}px`)
      sheet.classList.add('keyboard-fit')
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    document.addEventListener('visibilitychange', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      document.removeEventListener('visibilitychange', schedule)
      reset()
    }
  }, [history])
}
