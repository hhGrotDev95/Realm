// Unit tests for the module registry (defaults and dependencies).
// A configuration must be explicit: modules left out count as on, so switching off
// 'crew' alone conflicts with chat/location/steps until those are switched off too.
import assert from 'node:assert/strict'
import { isEnabled, moduleConflicts } from '../src/modules.ts'

assert.equal(isEnabled({}, 'chat'), true) // everything on by default
assert.equal(isEnabled({ chat: false }, 'chat'), false)
assert.equal(isEnabled({ crew: false }, 'chat'), false) // follows its requirement
assert.equal(isEnabled({ crew: false }, 'reports'), true) // independent modules stay on
assert.ok(moduleConflicts({ crew: false, chat: true }).includes('„Crew-Chat“ braucht „Crew & Freunde“'))
assert.deepEqual(moduleConflicts({ crew: false }), ['„Crew-Chat“ braucht „Crew & Freunde“', '„Standort teilen“ braucht „Crew & Freunde“', '„Step-Challenge“ braucht „Crew & Freunde“'])
assert.deepEqual(moduleConflicts({ crew: false, chat: false, location: false, steps: false }), [])
console.log('✓ 7 Modul-Prüfungen bestanden')
