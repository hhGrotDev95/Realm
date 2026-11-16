import assert from 'node:assert/strict'
import test from 'node:test'
import { renderDashboard } from '../src/render.mjs'

test('curated text cannot inject markup or unsafe links', () => {
  const attack = '<script>alert("private")</script>'
  const html = renderDashboard({
    projectName: attack, schedule: { label: attack, summary: attack },
    progress: { done: 3, total: 17 },
    links: [
      { label: attack, url: 'javascript:alert(1)', group: attack },
      { label: 'credentials', url: 'https://name:secret@example.test/', group: 'test' },
      { label: attack, url: 'https://example.test/?q=%22', group: 'test' },
    ],
    gates: [{ id: 'A1', title: attack, note: attack, phase: 'A', owner: attack, state: 'blocked' }],
  })
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('href="javascript:'))
  assert.ok(!html.includes('name:secret'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('18%'))
  assert.ok(html.includes('Blockiert'))
})
