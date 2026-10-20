// Visitor-app translations. German is the source language: t('Deutscher Text') looks the
// text up in the English dictionary and falls back to German, so a missing entry never
// breaks the UI (tests/i18n.test.mts makes sure none is missing).
// Content the festival writes itself (acts, FAQ, announcements) is shown as authored.
import { EN } from './en.ts'

export type Lang = 'de' | 'en'
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
]
const KEY = 'realm.lang'

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'de' || saved === 'en') return saved
  } catch {}
  const nav = typeof navigator === 'undefined' ? 'de' : (navigator.languages?.[0] ?? navigator.language ?? 'de')
  return nav.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export let lang: Lang = detect()
/** BCP 47 locale for dates and numbers. */
export const locale = () => (lang === 'en' ? 'en-GB' : 'de-DE')

/** Switches the language for good; the app reloads so every screen picks it up at once. */
export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l)
  } catch {}
  lang = l
  location.reload()
}

/** For tests: switch without a reload. */
export const useLangForTest = (l: Lang) => {
  lang = l
}

/** Translates a German UI text; {name} placeholders are filled from vars. */
export function t(de: string, vars?: Record<string, string | number>): string {
  let s = lang === 'en' ? (EN[de] ?? de) : de
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
  return s
}

/** Number formatting in the current language (1.234 vs 1,234). */
export const num = (n: number) => n.toLocaleString(locale())

if (typeof document !== 'undefined') document.documentElement.lang = lang
