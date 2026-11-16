const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GATE_LINE = /^- \[([ xX])\] \*\*([A-D]\d+[a-z]?) — ([^*]+)\*\*/;
const GATE_LIKE_LINE = /^- \[[ xX]\]/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requireDate(value, label) {
  assert(isCalendarDate(value), `${label} must be a valid YYYY-MM-DD calendar date`);
}

function requireText(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string`);
}

function safeUrl(value, label) {
  requireText(value, label);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`);
  }
  assert(url.protocol === 'https:' && url.hostname && !url.username && !url.password, `${label} must be a safe HTTPS URL`);
  return url.toString();
}

function latestDatedHandoff(progress) {
  const headings = progress.match(/^## .+\d{1,2}\.\d{1,2}\.\d{4}.*$/gm);
  return headings?.at(-1) ?? null;
}

function validateSourceHeaders(plan, progress, curated) {
  assert(/^#\s+\S.+/.test(plan), 'Release plan source header is missing');
  assert(/^#\s+\S.+/.test(progress), 'Progress source header is missing');
  const latest = latestDatedHandoff(progress);
  assert(latest, 'Dated level-two progress handoff header is missing');
  assert(latest === curated.reviewedHandoff, 'Latest dated progress handoff changed; review docs/PROJECT_STATUS.json and update reviewedHandoff');
}

export function parseGates(plan) {
  const lines = plan.split(/\r?\n/);
  let inChecklist = false;
  let phase = null;
  let optionalSection = false;
  const gates = [];

  for (const line of lines) {
    if (/^## Umsetzungs-Checkliste\s*$/.test(line)) {
      inChecklist = true;
      continue;
    }
    if (inChecklist && /^## Scope nachrangig/.test(line)) {
      optionalSection = true;
      inChecklist = false;
      continue;
    }
    if (!inChecklist || optionalSection) continue;

    const phaseHeading = line.match(/^### ([A-D]) ·/);
    if (phaseHeading) {
      phase = phaseHeading[1];
      continue;
    }
    if (!phase || !GATE_LIKE_LINE.test(line)) continue;

    const match = line.match(GATE_LINE);
    assert(match, `Malformed ${phase} release checklist item: ${line}`);
    const [, checkbox, id, title] = match;
    const owner = line.match(/\*\*\s*·\s*\*\*([^*]+)\*\*\s*·/);
    assert(id.startsWith(phase), `Gate ${id} is in the wrong phase (${phase})`);
    assert(!gates.some(gate => gate.id === id), `Duplicate release gate ID: ${id}`);
    assert(owner, `Missing owner in ${phase} release checklist item: ${id}`);
    gates.push({ id, title: title.trim(), done: checkbox.toLowerCase() === 'x', phase, owner: owner[1].trim() });
  }

  assert(inChecklist === false && gates.length > 0, 'Release checklist section or A-D gates are missing');
  for (const phaseId of ['A', 'B', 'C', 'D']) {
    assert(gates.some(gate => gate.phase === phaseId), `Release checklist has no ${phaseId} gates`);
  }
  return gates;
}

function validateCurated(data, gates) {
  assert(data && typeof data === 'object' && !Array.isArray(data), 'Curated status must be a JSON object');
  for (const key of ['projectName', 'reviewedAt', 'reviewedHandoff', 'reviewedGateStates', 'releaseDate', 'schedule', 'foundation', 'nextActions', 'ownerTasks', 'milestones', 'links', 'recent', 'device', 'web', 'gateOverrides']) {
    assert(Object.hasOwn(data, key), `Curated status is missing required field: ${key}`);
  }
  requireText(data.projectName, 'projectName');
  requireDate(data.reviewedAt, 'reviewedAt');
  requireText(data.reviewedHandoff, 'reviewedHandoff');
  requireDate(data.releaseDate, 'releaseDate');
  requireText(data.schedule?.label, 'schedule.label');
  requireText(data.schedule?.summary, 'schedule.summary');

  for (const field of ['foundation', 'nextActions', 'ownerTasks', 'milestones', 'links', 'recent']) {
    assert(Array.isArray(data[field]), `${field} must be an array`);
  }
  for (const [index, item] of data.foundation.entries()) {
    requireText(item.title, `foundation[${index}].title`);
    requireText(item.text, `foundation[${index}].text`);
  }
  for (const [index, item] of data.nextActions.entries()) {
    requireText(item.title, `nextActions[${index}].title`);
    requireText(item.text, `nextActions[${index}].text`);
    requireText(item.owner, `nextActions[${index}].owner`);
  }
  for (const [index, item] of data.ownerTasks.entries()) {
    requireText(item.title, `ownerTasks[${index}].title`);
    requireText(item.text, `ownerTasks[${index}].text`);
  }
  for (const [index, item] of data.milestones.entries()) {
    requireDate(item.date, `milestones[${index}].date`);
    requireText(item.title, `milestones[${index}].title`);
    requireText(item.state, `milestones[${index}].state`);
    requireText(item.note, `milestones[${index}].note`);
  }
  for (const [index, item] of data.links.entries()) {
    requireText(item.label, `links[${index}].label`);
    safeUrl(item.url, `links[${index}].url`);
    requireText(item.description, `links[${index}].description`);
    requireText(item.group, `links[${index}].group`);
  }
  for (const [index, item] of data.recent.entries()) {
    requireDate(item.date, `recent[${index}].date`);
    requireText(item.title, `recent[${index}].title`);
    requireText(item.summary, `recent[${index}].summary`);
  }
  requireText(data.device?.label, 'device.label');
  requireText(data.device?.summary, 'device.summary');
  requireText(data.web?.label, 'web.label');
  requireText(data.web?.summary, 'web.summary');
  safeUrl(data.web?.url, 'web.url');

  assert(data.reviewedGateStates && typeof data.reviewedGateStates === 'object' && !Array.isArray(data.reviewedGateStates), 'reviewedGateStates must be an object keyed by gate ID');
  const gateIds = gates.map(gate => gate.id);
  const reviewedIds = Object.keys(data.reviewedGateStates);
  assert(reviewedIds.length === gateIds.length && gateIds.every(id => Object.hasOwn(data.reviewedGateStates, id)), 'Release gates changed since review; review docs/PROJECT_STATUS.json and update reviewedGateStates');
  for (const gate of gates) {
    const reviewedDone = data.reviewedGateStates[gate.id];
    assert(typeof reviewedDone === 'boolean', `reviewedGateStates.${gate.id} must be a boolean`);
    assert(reviewedDone === gate.done, `Gate ${gate.id} changed since review; review docs/PROJECT_STATUS.json and update reviewedGateStates`);
  }

  assert(data.gateOverrides && typeof data.gateOverrides === 'object' && !Array.isArray(data.gateOverrides), 'gateOverrides must be an object keyed by gate ID');
  const ids = new Set(gateIds);
  for (const [id, override] of Object.entries(data.gateOverrides)) {
    assert(ids.has(id), `Unknown gate override ID: ${id}`);
    assert(override && typeof override === 'object' && !Array.isArray(override), `Gate override ${id} must be an object`);
    if (override.note !== undefined) requireText(override.note, `gateOverrides.${id}.note`);
    if (override.owner !== undefined) requireText(override.owner, `gateOverrides.${id}.owner`);
    if (override.state !== undefined) {
      assert(['done', 'blocked', 'in-progress', 'upcoming'].includes(override.state), `Unknown state for gate override ${id}: ${override.state}`);
      assert(override.state !== 'done' || gates.find(gate => gate.id === id).done, `Unchecked gate ${id} cannot have done state`);
    }
  }
  for (const [index, item] of data.milestones.entries()) {
    assert(['missed', 'at-risk', 'planned', 'completed'].includes(item.state), `Unknown state for milestones[${index}]: ${item.state}`);
  }
}

function validateGeneratedFields(data) {
  for (const key of ['generatedAt', 'source', 'device', 'web']) assert(Object.hasOwn(data, key), `Generated status is missing required field: ${key}`);
  assert(typeof data.generatedAt === 'string' && !Number.isNaN(Date.parse(data.generatedAt)), 'generatedAt must be an ISO timestamp');
  requireText(data.source.commit, 'source.commit');
  assert(typeof data.source.dirty === 'boolean', 'source.dirty must be a boolean');
  safeUrl(data.source.planUrl, 'source.planUrl');
  safeUrl(data.source.progressUrl, 'source.progressUrl');
}

export function buildStatus({ curated, plan, progress, generatedAt = new Date().toISOString(), source }) {
  assert(source && typeof source === 'object' && !Array.isArray(source), 'Source metadata must be an object');
  const parsedGates = parseGates(plan);
  validateCurated(curated, parsedGates);
  validateSourceHeaders(plan, progress, curated);

  const overrides = curated.gateOverrides;
  const gates = parsedGates.map(gate => {
    const override = overrides[gate.id] ?? {};
    return {
      ...gate,
      state: gate.done ? 'done' : (override.state ?? 'upcoming'),
      owner: override.owner ?? gate.owner,
      note: override.note ?? ''
    };
  });
  const done = gates.filter(gate => gate.done).length;

  const output = {
    projectName: curated.projectName,
    reviewedAt: curated.reviewedAt,
    generatedAt,
    releaseDate: curated.releaseDate,
    schedule: curated.schedule,
    progress: { done, total: gates.length, percent: Math.round((done / gates.length) * 100) },
    foundation: curated.foundation,
    nextActions: curated.nextActions,
    ownerTasks: curated.ownerTasks,
    milestones: curated.milestones,
    links: curated.links.map(item => ({ ...item, url: safeUrl(item.url, `link ${item.label}`) })),
    gates,
    recent: curated.recent,
    source,
    device: curated.device,
    web: curated.web
  };

  validateGeneratedFields(output);
  return output;
}
