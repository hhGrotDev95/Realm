// English dictionary, keyed by the German source text. Split by area to keep files readable.
import { EN_SHEETS } from './en-sheets.ts'
import { EN_SCREENS } from './en-screens.ts'
import { EN_CORE } from './en-core.ts'

export const EN: Record<string, string> = { ...EN_CORE, ...EN_SCREENS, ...EN_SHEETS }
