const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]));

const text = (value) => escapeHtml(value ?? '').replace(/\r?\n/g, '<br>');
const list = (value) => Array.isArray(value) ? value : [];
const STATE_LABELS = {
  done: 'Abgeschlossen',
  upcoming: 'Ausstehend',
  'in-progress': 'In Arbeit',
  blocked: 'Blockiert',
  missed: 'Verpasst',
  'at-risk': 'Gefährdet',
  planned: 'Geplant',
};
const stateLabel = (value) => STATE_LABELS[value] || value || '';

function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function formatGermanDate(value) {
  if (typeof value !== 'string' || !value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = /T\d{2}:\d{2}/.test(value);
  return new Intl.DateTimeFormat('de-DE', hasTime
    ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }
    : { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function externalLink(url, label, className = '') {
  const safeUrl = safeHttpsUrl(url);
  if (!safeUrl) return '';
  return `<a${className ? ` class="${className}"` : ''} href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${text(label)}<span class="link-arrow" aria-hidden="true">↗</span></a>`;
}

function cards(items, renderCard, empty = '') {
  return items.length ? items.map(renderCard).join('') : empty;
}

export function renderDashboard(data) {
  const projectName = text(data.projectName || 'Realm');
  const schedule = data.schedule || {};
  const progress = data.progress || {};
  const done = Number.isFinite(Number(progress.done)) ? Math.max(0, Number(progress.done)) : 0;
  const total = Number.isFinite(Number(progress.total)) ? Math.max(done, Number(progress.total)) : done;
  const percent = total > 0
    ? Math.min(100, Math.max(0, Math.round((done / total) * 100)))
    : 0;
  const progressLabel = `Release-Checkliste: ${done} von ${total} abgeschlossen`;
  const gates = list(data.gates);
  const completedGates = gates.filter((gate) => gate.done).length;
  const gatePhases = [...new Set(gates.map((gate) => gate.phase || 'Weitere Punkte'))];
  const links = list(data.links);
  const linkGroups = [...new Set(links.map((link) => link.group || 'Weitere Links'))];
  const milestones = list(data.milestones);
  const recent = list(data.recent);

  const foundationSection = cards(list(data.foundation), (item) => `
    <article class="foundation-card">
      <h3>${text(item.title)}</h3>
      <p>${text(item.text)}</p>
    </article>`);

  const nextActions = cards(list(data.nextActions), (item, index) => `
    <li class="action-card">
      <span class="action-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
      <div><h3>${text(item.title)}</h3><p>${text(item.text)}</p></div>
      ${item.owner ? `<span class="owner-tag">${text(item.owner)}</span>` : ''}
    </li>`);

  const ownerTasks = cards(list(data.ownerTasks), (item) => `
    <li class="task-card"><span class="task-mark" aria-hidden="true"></span>
      <div><h3>${text(item.title)}</h3><p>${text(item.text)}</p></div>
    </li>`);

  const milestoneItems = cards(milestones, (item) => `
    <li class="milestone">
      <div class="milestone-date">${text(formatGermanDate(item.date))}</div>
      <div class="milestone-body">
        <div class="milestone-heading"><h3>${text(item.title)}</h3><span class="state-pill">${text(stateLabel(item.state))}</span></div>
        <p>${text(item.note)}</p>
      </div>
    </li>`);

  const checklist = gatePhases.map((phase) => {
    const phaseGates = gates.filter((gate) => (gate.phase || 'Weitere Punkte') === phase);
    return `<section class="check-phase" aria-labelledby="phase-${escapeHtml(phase).replace(/[^a-zA-Z0-9_-]/g, '-')}">
      <h3 id="phase-${escapeHtml(phase).replace(/[^a-zA-Z0-9_-]/g, '-')}">${text(phase)}</h3>
      <ul class="gate-list">${phaseGates.map((gate) => `
        <li class="gate ${gate.done ? 'is-done' : ''}">
          <span class="gate-status" aria-hidden="true">${gate.done ? '✓' : '·'}</span>
          <div class="gate-copy"><h4>${text(gate.title)}</h4>
            ${gate.note ? `<p>${text(gate.note)}</p>` : ''}
            <div class="gate-meta">${gate.state ? `<span>${text(stateLabel(gate.state))}</span>` : ''}${gate.owner ? `<span>· ${text(gate.owner)}</span>` : ''}</div>
          </div>
        </li>`).join('')}</ul>
    </section>`;
  }).join('');

  const changeItems = cards(recent, (item) => `
    <article class="change-card"><time>${text(formatGermanDate(item.date))}</time><h3>${text(item.title)}</h3><p>${text(item.summary)}</p></article>`);

  const resourceGroups = linkGroups.map((group) => {
    const groupLinks = links.filter((link) => (link.group || 'Weitere Links') === group);
    return `<div class="resource-group"><h3>${text(group)}</h3><div class="resource-list">${groupLinks.map((link) => {
      const href = safeHttpsUrl(link.url);
      return href ? `<a class="resource-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        <span class="resource-copy"><strong>${text(link.label)}</strong><span>${text(link.description)}</span></span><span class="resource-arrow" aria-hidden="true">↗</span>
      </a>` : '';
    }).join('')}</div></div>`;
  }).join('');

  const sourceLinks = [
    externalLink(data.source?.planUrl, 'Release-Plan'),
    externalLink(data.source?.progressUrl, 'Fortschrittsprotokoll'),
  ].filter(Boolean).join('');

  const quickLinks = [
    { match: /app|test|preview|iphone/i, label: 'App testen' },
    { match: /admin|verwaltung|konsole/i, label: 'Adminportal' },
  ].map(({ match, label }) => {
    const link = links.find((item) => match.test(`${item.label || ''} ${item.group || ''} ${item.description || ''}`));
    return link ? externalLink(link.url, label, 'quick-link') : '';
  }).filter(Boolean).join('');

  const releaseDate = formatGermanDate(data.releaseDate);
  const reviewedAt = formatGermanDate(data.reviewedAt);
  const generatedAt = formatGermanDate(data.generatedAt);
  const shortCommit = typeof data.source?.commit === 'string' ? data.source.commit.slice(0, 8) : '';

  const webUrl = safeHttpsUrl(data.web?.url);
  const nativeStatus = `
    <article class="platform-card native-card">
      <div class="platform-head"><span class="platform-icon" aria-hidden="true"></span><span class="platform-label">iPhone · nativ</span></div>
      <h3>${text(data.device?.label)}</h3><p>${text(data.device?.summary)}</p>
      <div class="platform-foot"><span class="status-dot"></span>Geräte- und Store-Prüfung separat</div>
    </article>`;
  const webStatus = `
    <article class="platform-card web-card">
      <div class="platform-head"><span class="platform-icon web-icon" aria-hidden="true">↗</span><span class="platform-label">Website</span></div>
      <h3>${text(data.web?.label)}</h3><p>${text(data.web?.summary)}</p>
      ${webUrl ? externalLink(webUrl, 'Website öffnen', 'platform-link') : ''}
    </article>`;

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111b2b">
  <meta name="robots" content="noindex, nofollow">
  <title>${projectName} · Projektübersicht</title>
  <style>
    :root{color-scheme:dark;--ink:#f1f4f1;--muted:#aab7bd;--faint:#a3afb5;--base:#111b2b;--panel:#182536;--panel-raised:#1c2b3c;--line:#304052;--mint:#a8edcf;--lime:#d9f47c;--orange:#f4bb82;--serif:Georgia,'Times New Roman',serif;--sans:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    *{box-sizing:border-box}html{background:var(--base);scroll-behavior:smooth}body{margin:0;background:radial-gradient(ellipse at 84% 0%,#233946 0,transparent 34rem),var(--base);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}a{color:inherit}.shell{width:min(100% - 40px,1000px);margin:0 auto}.topbar{padding:24px 0 20px;border-bottom:1px solid #ffffff12;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}.wordmark{font-size:13px;letter-spacing:.19em;text-transform:uppercase;font-weight:750;color:var(--mint)}.private-label{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid #ffffff20;border-radius:999px;color:#c7d0d3;font-size:12px}.private-label:before{content:'';width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 12px #d9f47c77}.header-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.header-actions a{min-height:44px;padding:0 10px;display:inline-flex;align-items:center;color:var(--muted);font-size:12px;text-decoration:none;border-radius:9px}.hero{padding:42px 0 32px;max-width:790px}.eyebrow,.section-kicker{margin:0 0 13px;color:var(--mint);font-weight:700;font-size:11px;letter-spacing:.17em;text-transform:uppercase}.hero h1{font:500 clamp(38px,8vw,70px)/1.04 var(--serif);letter-spacing:-.045em;margin:0;max-width:780px}.hero-summary{color:#cad4d3;font-size:clamp(17px,2.4vw,21px);line-height:1.5;max-width:640px;margin:20px 0 0}.hero-meta{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:22px;color:var(--muted);font-size:13px}.hero-meta strong{color:var(--ink);font-weight:600}.hero-meta span{display:inline-flex;gap:6px}.hero-meta span+span:before{content:'·';color:var(--faint);margin-right:4px}.quick-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.quick-link{min-height:48px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 17px;border-radius:11px;background:var(--mint);color:#10251d;font-size:14px;font-weight:750;text-decoration:none}.quick-link+.quick-link{background:#263a46;color:var(--ink);border:1px solid #a8edcf55}.section{padding:33px 0;border-top:1px solid #ffffff14}.section-title-row{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:20px}.section-title-row h2{font:500 clamp(25px,4vw,34px)/1.15 var(--serif);letter-spacing:-.025em;margin:0}.section-title-row>p{color:var(--muted);font-size:13px;margin:0}.progress-panel{padding:23px 24px 19px;background:linear-gradient(120deg,#1d3340,#192638 70%);border:1px solid #a8edcf28;border-radius:18px}.progress-label{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:13px}.progress-label strong{font-size:16px}.progress-percent{flex:none;white-space:nowrap;color:var(--mint);font-size:14px;font-weight:750;font-variant-numeric:tabular-nums}.progress-track{height:9px;overflow:hidden;background:#0e1723;border-radius:99px}.progress-track progress{display:block;width:100%;height:100%;border:0;background:transparent;appearance:none}.progress-track progress::-webkit-progress-bar{background:#0e1723;border-radius:99px}.progress-track progress::-webkit-progress-value{background:linear-gradient(90deg,var(--mint),var(--lime));border-radius:99px}.progress-track progress::-moz-progress-bar{background:linear-gradient(90deg,var(--mint),var(--lime));border-radius:99px}.progress-note{margin:12px 0 0;color:var(--muted);font-size:12px}.foundation-grid,.platform-grid,.change-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.foundation-card,.platform-card,.change-card{padding:19px;background:var(--panel);border:1px solid var(--line);border-radius:15px}.foundation-card h3,.action-card h3,.task-card h3,.milestone h3,.change-card h3{font-size:16px;line-height:1.35;margin:0 0 6px;font-weight:670}.foundation-card p,.action-card p,.task-card p,.milestone p,.change-card p,.platform-card p{color:var(--muted);font-size:14px;margin:0;line-height:1.55}.actions-list,.task-list,.milestone-list,.gate-list{list-style:none;padding:0;margin:0}.actions-list{display:grid;gap:10px}.action-card{display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:start;gap:14px;padding:17px 18px;border:1px solid var(--line);background:var(--panel);border-radius:14px}.action-number{font:500 19px/1.4 var(--serif);color:var(--mint);font-variant-numeric:tabular-nums}.owner-tag{font-size:11px;font-weight:700;padding:5px 9px;border-radius:999px;background:#a8edcf16;color:var(--mint);white-space:normal;max-width:100%}.task-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.task-card{display:flex;gap:13px;padding:17px;border-radius:14px;background:var(--panel);border:1px solid var(--line)}.task-mark{flex:0 0 20px;width:20px;height:20px;margin-top:1px;border:1px solid #8797a0;border-radius:6px}.milestone-list{position:relative;padding-left:4px}.milestone-list:before{content:'';position:absolute;left:9px;top:10px;bottom:14px;width:1px;background:var(--line)}.milestone{position:relative;display:grid;grid-template-columns:100px 1fr;gap:17px;padding:0 0 22px}.milestone:last-child{padding-bottom:0}.milestone-date{position:relative;color:var(--mint);font-size:13px;font-weight:700;padding-left:23px;font-variant-numeric:tabular-nums}.milestone-date:before{content:'';position:absolute;left:1px;top:7px;width:9px;height:9px;border:2px solid var(--mint);background:var(--base);border-radius:50%;z-index:1}.milestone-heading{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 5px}.milestone-heading h3{margin:0}.state-pill{font-size:10px;line-height:1.4;color:#d5e5dd;border:1px solid #ffffff22;border-radius:99px;padding:3px 7px}.checklist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.check-phase{padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:15px}.check-phase>h3{font-size:13px;color:var(--mint);letter-spacing:.04em;margin:0 0 11px}.gate-list{display:grid;gap:11px}.gate{display:grid;grid-template-columns:19px minmax(0,1fr);gap:9px}.gate-status{display:grid;place-items:center;width:18px;height:18px;margin-top:2px;border:1px solid #7e8c92;border-radius:6px;color:transparent;font-size:12px}.gate.is-done .gate-status{color:#112218;border-color:var(--mint);background:var(--mint);font-weight:900}.gate h4{font-size:13px;line-height:1.4;margin:0}.gate p{font-size:12px;line-height:1.5;color:var(--muted);margin:4px 0 0}.gate-meta{display:flex;flex-wrap:wrap;gap:5px;font-size:10px;color:var(--faint);margin-top:4px}.change-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.change-card time{display:block;color:var(--mint);font-size:11px;font-variant-numeric:tabular-nums;margin-bottom:10px}.change-card h3{font-size:15px}.change-card p{font-size:13px}.platform-card{min-height:194px;display:flex;flex-direction:column;align-items:flex-start}.platform-head{display:flex;align-items:center;gap:9px;margin-bottom:17px}.platform-icon{width:28px;height:28px;border-radius:9px;background:#ffffff12;color:var(--mint);display:grid;place-items:center;font-size:18px;font-weight:700}.platform-label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700}.platform-card h3{font-size:18px;margin:0 0 5px}.platform-card p{font-size:13px}.platform-foot{margin-top:auto;padding-top:15px;font-size:11px;color:#d1bb96;display:flex;align-items:center;gap:8px}.status-dot{width:7px;height:7px;border-radius:50%;background:var(--orange)}.platform-link{display:inline-flex;align-items:center;gap:7px;margin-top:auto;padding-top:12px;color:var(--mint);font-weight:700;text-decoration:none;font-size:13px;min-height:44px}.resource-group+.resource-group{margin-top:19px}.resource-group h3{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:0 0 9px}.resource-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.resource-link{min-height:68px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;text-decoration:none;transition:background .15s,border-color .15s}.resource-link:hover,.resource-link:focus-visible{background:var(--panel-raised);border-color:#a8edcf77}.resource-copy{display:grid;gap:3px}.resource-copy strong{font-size:14px}.resource-copy>span{font-size:12px;color:var(--muted)}.resource-arrow,.link-arrow{color:var(--mint);font-size:16px;flex:none}.link-arrow{margin-left:5px}.source-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:19px;padding-top:14px;border-top:1px solid #ffffff12;color:var(--faint);font-size:12px}.source-links{display:flex;gap:16px;flex-wrap:wrap}.source-links a{color:var(--muted);text-decoration:underline;text-decoration-color:#ffffff3a;text-underline-offset:3px;min-height:32px;display:inline-flex;align-items:center}.footer{padding:25px 0 38px;border-top:1px solid #ffffff14;color:var(--muted);font-size:12px}.footer p{margin:0;max-width:800px}.footer p+p{margin-top:8px;color:var(--faint)}.empty{color:var(--muted);font-size:14px;padding:16px 0}
    .gate-details{border:1px solid var(--line);border-radius:15px;background:#141f2e;overflow:hidden}.gate-details>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:12px 17px;cursor:pointer;color:var(--ink);font-weight:700;list-style:none}.gate-details>summary::-webkit-details-marker{display:none}.gate-details>summary:after{content:'＋';color:var(--mint);font-size:18px}.gate-details[open]>summary:after{content:'−'}.gate-summary-count{color:var(--muted);font-size:12px;font-weight:500}.gate-details-content{padding:0 13px 13px}.quick-link:focus-visible,.header-actions a:focus-visible,.gate-details>summary:focus-visible,.resource-link:focus-visible{outline:3px solid var(--lime);outline-offset:3px}
    @media(max-width:640px){.shell{width:min(100% - 32px,1000px)}.topbar{padding-top:18px}.hero{padding:33px 0 27px}.section{padding:27px 0}.section-title-row{align-items:flex-start;flex-direction:column;gap:7px}.foundation-grid,.platform-grid,.change-grid,.checklist,.task-list,.resource-list{grid-template-columns:1fr}.action-card{grid-template-columns:30px minmax(0,1fr);gap:11px}.owner-tag{grid-column:2;justify-self:start}.milestone{grid-template-columns:82px 1fr;gap:10px}.progress-panel{padding:18px}.source-row{align-items:flex-start;flex-direction:column}.platform-card{min-height:0}.platform-foot,.platform-link{margin-top:16px}.change-grid{gap:9px}.change-card{padding:16px}.gate-details-content{padding:0 9px 9px}.gate-details>summary{align-items:flex-start;flex-direction:column;gap:3px}.header-actions{margin-left:auto}}
    @media(max-width:360px){.shell{width:calc(100% - 24px)}.hero-meta{gap:7px 10px}.milestone{grid-template-columns:72px 1fr;gap:7px}.milestone-date{font-size:12px}.progress-label{align-items:flex-start;flex-direction:column;gap:3px}.quick-actions{display:grid;grid-template-columns:1fr}.quick-link{width:100%}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{transition:none!important}}
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar"><div class="wordmark">Realm · Winter 2027</div><span class="private-label">Private Projektübersicht</span><nav class="header-actions" aria-label="Dashboard-Aktionen"><a href="/" aria-label="Dashboard aktualisieren">Aktualisieren</a><a href="/cdn-cgi/access/logout">Abmelden</a></nav></header>
    <main>
      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Projektübersicht</p>
        <h1 id="page-title">${projectName}</h1>
        <p class="hero-summary">${text(schedule.summary)}</p>
        <div class="hero-meta">
          <span><strong>Status</strong> ${text(schedule.label)}</span>
          <span><strong>Release-Ziel</strong> ${text(releaseDate)}</span>
          <span><strong>Inhalt geprüft</strong> ${text(reviewedAt)}</span>
        </div>
        ${quickLinks ? `<nav class="quick-actions" aria-label="Projekt-Shortcuts">${quickLinks}</nav>` : ''}
      </section>

      <section class="section" aria-labelledby="progress-title">
        <div class="section-title-row"><h2 id="progress-title">Release-Checkliste</h2><p>Abgehakte Punkte im Gesamtplan</p></div>
        <div class="progress-panel">
          <div class="progress-label"><strong>${escapeHtml(progressLabel)}</strong><span class="progress-percent">${percent}%</span></div>
          <div class="progress-track"><progress aria-label="${escapeHtml(progressLabel)}" max="${total || 1}" value="${Math.min(done, total)}">${percent}%</progress></div>
          <p class="progress-note">Der Zähler zeigt Aufgabenpunkte, keine aufgewendete Zeit oder allgemeine Release-Bereitschaft.</p>
        </div>
      </section>

      <section class="section" aria-labelledby="platforms-title"><div class="section-title-row"><h2 id="platforms-title">Plattformen</h2><p>Getrennte Nachweise, eigener Status</p></div><div class="platform-grid">${nativeStatus}${webStatus}</div></section>

      ${foundationSection ? `<section class="section" aria-labelledby="foundation-title"><div class="section-title-row"><h2 id="foundation-title">Fundament & Umfang</h2></div><div class="foundation-grid">${foundationSection}</div></section>` : ''}

      ${nextActions ? `<section class="section" aria-labelledby="next-title"><div class="section-title-row"><h2 id="next-title">Als Nächstes</h2><p>Die nächsten konkreten Schritte</p></div><ol class="actions-list">${nextActions}</ol></section>` : ''}

      ${ownerTasks ? `<section class="section" aria-labelledby="owner-title"><div class="section-title-row"><h2 id="owner-title">Aufgaben für Hannes</h2></div><ul class="task-list">${ownerTasks}</ul></section>` : ''}

      ${milestoneItems ? `<section class="section" aria-labelledby="milestones-title"><div class="section-title-row"><h2 id="milestones-title">Weg zum Release</h2><p>Ziele und Prüfpunkte</p></div><ol class="milestone-list">${milestoneItems}</ol></section>` : ''}

      ${checklist ? `<section class="section" aria-labelledby="gates-title"><div class="section-title-row"><h2 id="gates-title">Freigabepunkte</h2><p>Native Freigabe und Web-Status getrennt verfolgen</p></div><details class="gate-details"><summary><span>Alle ${gates.length} Freigabepunkte anzeigen</span><span class="gate-summary-count">${completedGates} von ${gates.length} erledigt</span></summary><div class="gate-details-content"><div class="checklist">${checklist}</div></div></details></section>` : ''}

      ${changeItems ? `<section class="section" aria-labelledby="changes-title"><div class="section-title-row"><h2 id="changes-title">Zuletzt geändert</h2><p>Aktuelle Projektentscheidungen</p></div><div class="change-grid">${changeItems}</div></section>` : ''}

      ${resourceGroups ? `<section class="section" aria-labelledby="resources-title"><div class="section-title-row"><h2 id="resources-title">Schnellzugriff</h2><p>Tests, Verwaltung und Projektdokumente</p></div>${resourceGroups}<div class="source-row"><span>${data.source?.dirty ? 'Lokale Vorschau' : `Commit ${text(shortCommit)}`}${generatedAt ? ` · Erzeugt ${text(generatedAt)}` : ''}</span><span class="source-links">${sourceLinks}</span></div></section>` : ''}
    </main>
    <footer class="footer">
      <p>Die Checkliste zählt erledigte Aufgabenpunkte und sagt nichts über Zeitaufwand oder Gesamtbereitschaft aus. Native Geräteprüfung, Apple-Store-Freigabe und Web-Prüfung sind getrennte Freigabepunkte.</p>
      <p>Nach veröffentlichten Arbeitspaketen wird diese Übersicht aktualisiert. „Inhalt geprüft“ nennt den fachlichen Stand; das Erzeugungsdatum bezeichnet nur die technische Aktualisierung.</p>
    </footer>
  </div>
</body>
</html>`;
}
