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
} as const satisfies Record<string, { label: string; hint: string; requires: readonly string[] }>

export type ModuleKey = keyof typeof MODULES
export type ModuleState = Partial<Record<ModuleKey, boolean>>
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[]

/** Everything is on unless the festival switched it off; a module is off when anything it needs is off. */
export function isEnabled(state: ModuleState | undefined, key: ModuleKey): boolean {
  if (state?.[key] === false) return false
  return (MODULES[key].requires as readonly ModuleKey[]).every((r) => isEnabled(state, r))
}

/** Checks a requested configuration: an enabled module whose requirement is disabled is a conflict. */
export function moduleConflicts(state: ModuleState): string[] {
  return MODULE_KEYS.filter((k) => state[k] !== false)
    .flatMap((k) => (MODULES[k].requires as readonly ModuleKey[]).filter((r) => state[r] === false).map((r) => `„${MODULES[k].label}“ braucht „${MODULES[r].label}“`))
}
