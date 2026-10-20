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
// opt-in modules: off until the festival switches them on
assert.equal(isEnabled({}, 'festivalchat'), false)
assert.equal(isEnabled(undefined, 'festivalchat'), false)
assert.equal(isEnabled({ festivalchat: true }, 'festivalchat'), true)
assert.deepEqual(moduleConflicts({ festivalchat: true }), [])
console.log('✓ 11 Modul-Prüfungen bestanden')
