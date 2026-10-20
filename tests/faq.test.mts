// FAQ bot: answers only from approved entries, finds them with everyday words, admits gaps.
import assert from 'node:assert/strict'
import { DEMO_FAQ } from '../src/data.ts'
import { ask, tokens } from '../src/faq/match.ts'

const expect = (q: string, id: string) => {
  const r = ask(q, DEMO_FAQ)
  assert.equal(r.kind, 'answer', `"${q}" → ${r.kind} (${r.score.toFixed(2)})`)
  assert.equal(r.faq!.id, id, `"${q}" → ${r.faq!.id}`)
}
const none = (q: string) => {
  const r = ask(q, DEMO_FAQ)
  assert.notEqual(r.kind, 'answer', `"${q}" should not be answered but got ${r.faq?.id} (${r.score.toFixed(2)})`)
}

assert.deepEqual(tokens('Wo ist das Klo?'), ['klo'])
expect('Wann ist Einlass?', 'einlass-zeiten')
expect('ab wann kann man rein / Tore offen', 'einlass-zeiten')
expect('Bändchen verloren', 'bändchen-verloren')
expect('wo tausche ich mein Ticket', 'baendchen')
expect('Darf ich einen Pavillon mitnehmen?', 'camping')
expect('Sind Glasflaschen erlaubt?', 'mitnehmen')
expect('Wo kann ich Wasser auffüllen', 'wasser')
expect('vegan essen', 'essen')
expect('Kann ich bar zahlen?', 'bezahlen')
expect('Akku leer, wo Handy laden?', 'akku')
expect('lost and found', 'fundsachen')
expect('Mir geht es nicht gut', 'hilfe')
expect('Shuttle vom Bahnhof', 'anreise')
// unrelated or unknown questions get no invented answer
none('Wer ist der Headliner am Samstag?')
none('Wie wird das Wetter?')
none('asdf qwer')
assert.equal(ask('', DEMO_FAQ).kind, 'none')
assert.equal(ask('Wann ist Einlass?', []).kind, 'none')
console.log('✓ 19 FAQ-Bot-Prüfungen bestanden')
