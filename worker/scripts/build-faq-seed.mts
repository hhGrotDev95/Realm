// Writes the demo FAQ (src/data.ts DEMO_FAQ) as seed rows for migration 0008.
// Run: node --experimental-strip-types scripts/build-faq-seed.mts > /tmp/faq.sql
import { DEMO_FAQ } from '../../src/data.ts'

const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
DEMO_FAQ.forEach((f, i) =>
  console.log(
    `INSERT INTO faqs (festival_id, id, question, answer, category, keywords, source, status, sort, updated_at) VALUES ('realm', ${q(f.id)}, ${q(f.question)}, ${q(f.answer)}, ${q(f.category)}, ${q(f.keywords ?? '')}, ${q(f.source ?? null)}, 'published', ${i}, ${f.updatedAt});`,
  ),
)
