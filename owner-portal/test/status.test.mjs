import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildStatus, isCalendarDate, parseGates } from '../lib/status.mjs';

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [curated, plan, progress] = await Promise.all([
  readFile(resolve(repoDir, 'docs/PROJECT_STATUS.json'), 'utf8').then(JSON.parse),
  readFile(resolve(repoDir, 'docs/WINTER_RELEASE_PLAN.md'), 'utf8'),
  readFile(resolve(repoDir, 'REALM_PROGRESS.md'), 'utf8')
]);
const reviewedProgress = `${progress.trimEnd()}\n\n${curated.reviewedHandoff}\n`;
const source = {
  commit: 'f228d353',
  dirty: true,
  planUrl: 'https://github.com/hhGrotDev95/Realm/blob/main/docs/WINTER_RELEASE_PLAN.md',
  progressUrl: 'https://github.com/hhGrotDev95/Realm/blob/main/REALM_PROGRESS.md'
};
const build = (overrides = {}) => buildStatus({ curated, plan, progress: reviewedProgress, source, generatedAt: '2026-11-16T12:00:00.000Z', ...overrides });

test('counts only canonical A-D checklist gates and excludes optional E1', () => {
  const gates = parseGates(plan);
  const status = build();
  assert.equal(gates.length, 17);
  assert.equal(gates.some(gate => gate.id === 'E1'), false);
  assert.deepEqual(status.progress, { done: 3, total: 17, percent: 18 });
  assert.deepEqual(status.gates.filter(gate => gate.done).map(gate => gate.id), ['A2a', 'A4a', 'A4b']);
});

test('follows new canonical checklist items without a code change', () => {
  const expandedPlan = plan.replace('### C ·', '- [ ] **B6 — Future release check** · **Hannes** · Added to the canonical plan.\n\n### C ·');
  const status = build({
    plan: expandedPlan,
    curated: { ...curated, reviewedGateStates: { ...curated.reviewedGateStates, B6: false } }
  });
  assert.deepEqual(status.progress, { done: 3, total: 18, percent: 17 });
  assert.equal(status.gates.some(gate => gate.id === 'B6'), true);
});

test('fails when a canonical checkbox changes or a gate is added before review snapshots update', () => {
  const changedCheckboxes = plan.replace('- [ ] **A1 —', '- [x] **A1 —');
  assert.throws(() => build({ plan: changedCheckboxes }), /Gate A1 changed since review; review docs\/PROJECT_STATUS.json/);
  const addedGate = plan.replace('### C ·', '- [ ] **B6 — Future release check** · **Hannes** · Added to the canonical plan.\n\n### C ·');
  assert.throws(() => build({ plan: addedGate }), /Release gates changed since review; review docs\/PROJECT_STATUS.json/);
});

test('canonical checked state takes precedence over a curated state override', () => {
  const status = build({ curated: { ...curated, gateOverrides: { ...curated.gateOverrides, A2a: { state: 'blocked' } } } });
  const gate = status.gates.find(item => item.id === 'A2a');
  assert.equal(gate.done, true);
  assert.equal(gate.state, 'done');
});

test('rejects malformed and duplicate checklist IDs', () => {
  assert.throws(() => parseGates(plan.replace('- [ ] **A1 —', '- [ ] **A —')), /Malformed A release checklist item/);
  assert.throws(() => parseGates(plan.replace('- [ ] **A2b —', '- [ ] **A1 —')), /Duplicate release gate ID/);
});

test('rejects unknown gate overrides and source-header drift', () => {
  assert.throws(() => build({ curated: { ...curated, gateOverrides: { X9: { note: 'unknown' } } } }), /Unknown gate override ID: X9/);
  assert.throws(() => build({ plan: plan.replace(/^# .+$/m, '') }), /Release plan source header/);
  assert.throws(() => build({ progress: reviewedProgress.replace(/^# .+$/m, '') }), /Progress source header/);
  assert.throws(() => build({ progress: `${reviewedProgress}\n## New dated handoff (17.11.2026, Codex)\n` }), /Latest dated progress handoff changed; review docs\/PROJECT_STATUS.json/);
});

test('requires A-D phases and rejects invalid or contradictory gate states', () => {
  const withoutPhaseD = plan.replace(/^### D ·.*\n[\s\S]*?(?=^###|^##)/m, '');
  assert.throws(() => parseGates(withoutPhaseD), /no D gates/);
  assert.throws(() => build({ curated: { ...curated, gateOverrides: { A1: { state: 'finished' } } } }), /Unknown state for gate override A1/);
  assert.throws(() => build({ curated: { ...curated, gateOverrides: { A1: { state: 'done' } } } }), /Unchecked gate A1 cannot have done state/);
});

test('validates calendar dates including leap days', () => {
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2027-02-29'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.throws(() => build({ curated: { ...curated, reviewedAt: '2026-02-30' } }), /reviewedAt must be a valid/);
  assert.throws(() => build({ curated: { ...curated, milestones: [{ ...curated.milestones[0], date: '2026-11-31' }] } }), /milestones\[0\].date must be a valid/);
});

test('rejects unsafe URLs', () => {
  assert.throws(() => build({ curated: { ...curated, links: [{ ...curated.links[0], url: 'http://example.com' }] } }), /safe HTTPS URL/);
  assert.throws(() => build({ curated: { ...curated, links: [{ ...curated.links[0], url: 'https://user:secret@example.com' }] } }), /safe HTTPS URL/);
});

test('keeps the manually reviewed date unchanged when generating a fresh timestamp', () => {
  // Fix both dates in this fixture, independently of the daily project review date.
  const status = build({ curated: { ...curated, reviewedAt: '2026-11-16' }, generatedAt: '2026-12-01T08:00:00.000Z' });
  assert.equal(status.reviewedAt, '2026-11-16');
  assert.equal(status.generatedAt, '2026-12-01T08:00:00.000Z');
});

test('uses reviewed device, web, and recent content from curated data', () => {
  const status = build();
  assert.deepEqual(status.device, curated.device);
  assert.deepEqual(status.web, curated.web);
  assert.deepEqual(status.recent, curated.recent);
});
