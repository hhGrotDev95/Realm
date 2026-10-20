// FAQ bot: finds the best *published* answer for a question. It never writes text of its
// own – it either returns an approved answer (with source and date) or says it has none.
// Runs on the device, so it works offline with the cached festival data.

export interface Faq {
  id: string
  question: string
  answer: string
  category: string
  keywords?: string
  source?: string | null
  updatedAt: number
}

export interface BotAnswer {
  kind: 'answer' | 'unsure' | 'none'
  faq?: Faq
  suggestions: Faq[]
  score: number
}

/** Everyday words people use for the same thing at a festival (German and English). */
const SYNONYMS: string[][] = [
  ['wc', 'toilette', 'klo', 'toiletten', 'dixi', 'toilet', 'restroom', 'bathroom'],
  ['einlass', 'eingang', 'reinkommen', 'entrance', 'entry', 'tor', 'gate'],
  ['ticket', 'tickets', 'karte', 'eintrittskarte', 'bändchen', 'baendchen', 'band', 'wristband'],
  ['essen', 'food', 'futter', 'hunger', 'imbiss', 'vegan', 'vegetarisch'],
  ['trinken', 'wasser', 'durst', 'water', 'drink', 'trinkwasser'],
  ['camping', 'zelt', 'zelten', 'campingplatz', 'tent', 'campground', 'pavillon'],
  ['auto', 'parken', 'parkplatz', 'car', 'parking', 'anreise'],
  ['bus', 'shuttle', 'bahn', 'zug', 'train', 'öpnv', 'oepnv'],
  ['verloren', 'fundsachen', 'fundbüro', 'fundbuero', 'lost', 'found', 'vergessen'],
  ['hilfe', 'sanitäter', 'sanitaeter', 'sani', 'medical', 'arzt', 'notfall', 'verletzt', 'awareness'],
  ['bezahlen', 'zahlen', 'karte', 'cashless', 'bargeld', 'cash', 'payment', 'pay'],
  ['glas', 'flasche', 'flaschen', 'mitnehmen', 'erlaubt', 'verboten', 'allowed', 'bring'],
  ['handy', 'akku', 'laden', 'aufladen', 'strom', 'powerbank', 'charge', 'charging'],
  ['alter', 'jugendlich', 'minderjährig', 'u18', 'ausweis', 'age'],
]
const STOP = new Set(
  'der die das ein eine einen einem einer und oder ist sind wo wie was wann wer gibt es ich man kann darf muss mit auf im in am an zum zur von für fuer bei mein meine meinen the a an is are where how what when can i do to of for on at it my auch noch schon mal bitte denn hier da'.split(' '),
)

/** Lowercase, fold umlauts, crude German/English stemming. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => t.replace(/(ungen|ung|en|er|es|e|s|n)$/, '') || t)
}

const SYN_INDEX = new Map<string, number>()
SYNONYMS.forEach((group, i) => group.flatMap((w) => tokens(w)).forEach((t) => SYN_INDEX.set(t, i)))
/** A token and its synonym group, so "Klo" finds the "WC" answer. */
const expand = (t: string) => (SYN_INDEX.has(t) ? [t, `#syn${SYN_INDEX.get(t)}`] : [t])

interface Doc {
  faq: Faq
  terms: Map<string, number> // weighted term frequencies
  strong: Set<string> // terms from question, keywords and category
}

/** Thresholds tuned on the demo FAQ: below MIN the bot admits it has no answer. */
export const ANSWER_MIN = 2.2
export const SUGGEST_MIN = 0.8

export function buildIndex(faqs: Faq[]) {
  const docs: Doc[] = faqs.map((faq) => {
    const terms = new Map<string, number>()
    const strong = new Set<string>()
    const add = (text: string | undefined, w: number) => {
      for (const t of tokens(text ?? ''))
        for (const x of expand(t)) {
          terms.set(x, (terms.get(x) ?? 0) + w)
          if (w > 1) strong.add(x)
        }
    }
    add(faq.question, 3)
    add(faq.keywords, 3)
    add(faq.category, 1.5)
    add(faq.answer, 1)
    return { faq, terms, strong }
  })
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = (t: string) => Math.log(1 + (docs.length + 1) / ((df.get(t) ?? 0) + 0.5))
  return { docs, idf }
}

export function ask(question: string, faqs: Faq[]): BotAnswer {
  const q = [...new Set(tokens(question).flatMap(expand))]
  if (!q.length || !faqs.length) return { kind: 'none', suggestions: [], score: 0 }
  const { docs, idf } = buildIndex(faqs)
  const scored = docs
    .map((d) => {
      let score = 0
      let hits = 0
      let strongHit = false
      for (const t of q) {
        const tf = d.terms.get(t)
        if (tf) {
          score += idf(t) * (tf / (tf + 1.5)) * 2.5
          if (!t.startsWith('#syn')) hits++
          if (d.strong.has(t)) strongHit = true
        }
      }
      // reward covering more of the question
      const coverage = hits / q.filter((t) => !t.startsWith('#syn')).length
      score *= 0.5 + coverage
      // a word that only appears somewhere in an answer is a hint, never an answer
      if (!strongHit) score = Math.min(score, ANSWER_MIN - 0.01)
      return { faq: d.faq, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best || best.score < SUGGEST_MIN) return { kind: 'none', suggestions: [], score: best?.score ?? 0 }
  const suggestions = scored.filter((x) => x.score >= SUGGEST_MIN).slice(0, 3).map((x) => x.faq)
  if (best.score < ANSWER_MIN) return { kind: 'unsure', suggestions, score: best.score }
  return { kind: 'answer', faq: best.faq, suggestions: suggestions.filter((f) => f.id !== best.faq.id), score: best.score }
}
