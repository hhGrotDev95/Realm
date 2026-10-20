// Central module registry: which optional features a festival offers. Shared by app, console and worker.

export const MODULES = {
  crew: { label: 'Crew & Freunde', hint: 'Crews gründen, sehen, wer zu welchem Act geht, Meetups', requires: [] },
  chat: { label: 'Crew-Chat', hint: 'Privater Chat innerhalb einer Crew', requires: ['crew'] },
  location: { label: 'Standort teilen', hint: 'Freiwillig, nur Bühnenbereich, nur für die eigene Crew', requires: ['crew'] },
  steps: { label: 'Step-Challenge', hint: 'Freiwillige Schritte-Rangliste in der Crew', requires: ['crew'] },
  reports: { label: 'Community-Meldungen', hint: 'Besucher melden z. B. leere Wasserstellen oder Schlangen', requires: [] },
  wrapped: { label: 'Festival-Rückblick', hint: '„Wrapped“ nach dem Festival', requires: [] },
  faq: { label: 'FAQ & Infos', hint: 'Antworten zu Einlass, Tickets, Camping, Essen …', requires: [] },
  faqbot: { label: 'FAQ-Bot', hint: 'Beantwortet Fragen nur aus freigegebenen FAQ – mit Quelle', requires: ['faq'] },
  festivalchat: { label: 'Festival-Chat', hint: 'Öffentlicher Chat für alle Besucher – braucht Moderation, daher erst nach Einschalten aktiv', requires: [], off: true },
} as const satisfies Record<string, { label: string; hint: string; requires: readonly string[]; off?: boolean }>

export type ModuleKey = keyof typeof MODULES
export type ModuleState = Partial<Record<ModuleKey, boolean>>
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]

/** What the festival chose for a module; without a choice it is on, except modules marked `off` (opt-in). */
export const defaultOn = (key: ModuleKey) => !('off' in MODULES[key] && MODULES[key].off)
const chosen = (state: ModuleState | undefined, key: ModuleKey) => state?.[key] ?? defaultOn(key)

/** A module is on when chosen and when everything it needs is on. */
export function isEnabled(state: ModuleState | undefined, key: ModuleKey): boolean {
  if (!chosen(state, key)) return false
  return (MODULES[key].requires as readonly ModuleKey[]).every((r) => isEnabled(state, r))
}

/** Checks a requested configuration: an enabled module whose requirement is disabled is a conflict. */
export function moduleConflicts(state: ModuleState): string[] {
  return MODULE_KEYS.filter((k) => chosen(state, k))
    .flatMap((k) => (MODULES[k].requires as readonly ModuleKey[]).filter((r) => !chosen(state, r)).map((r) => `„${MODULES[k].label}“ braucht „${MODULES[r].label}“`))
}
