import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`Unable to read git ${args[0]} from ${root}.`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

try {
  await readFile(path.join(dist, 'index.html'));
} catch {
  throw new Error(`Missing ${path.join(dist, 'index.html')}; run the Vite build before staging-version.mjs.`);
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const commit = git('rev-parse', 'HEAD');
if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Git returned an invalid commit hash.');
const dirty = Boolean(git('status', '--porcelain').length);
const builtAt = new Date().toISOString();
const info = { name: pkg.name, version: pkg.version, environment: 'staging', commit, dirty, builtAt };
await writeFile(path.join(dist, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);

const e = escapeHtml;
const dirtyMessage = dirty
  ? '<p class="notice">Zum Build-Zeitpunkt waren nicht committete Änderungen vorhanden. Der angezeigte Commit bildet den Arbeitsstand daher nicht vollständig ab.</p>'
  : '<p class="notice">Der Arbeitsstand war zum Build-Zeitpunkt sauber.</p>';
const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#101114">
  <title>Entwicklungsvorschau · ${e(pkg.name)}</title>
  <style>
    :root{color-scheme:dark;font:16px/1.55 system-ui,sans-serif;background:#101114;color:#f5f2ec}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{width:min(100%,680px);padding:clamp(24px,6vw,48px);border:1px solid #34363c;border-radius:18px;background:#18191e}
    .eyebrow{color:#c9a5ff;font-size:.82rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{font-size:clamp(1.8rem,6vw,2.7rem);line-height:1.12;margin:.5rem 0 1rem}
    p{color:#d4d1cc}.notice{padding:12px 14px;border-left:3px solid #d8bc72;background:#22232a;border-radius:4px}
    dl{display:grid;grid-template-columns:minmax(100px,140px) 1fr;gap:8px 16px;margin:28px 0}
    dt{color:#aaa8a5}dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
    nav{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:28px;padding-top:20px;border-top:1px solid #34363c}
    a{color:#c9a5ff;text-underline-offset:3px}a:focus-visible{outline:3px solid #f5f2ec;outline-offset:4px;border-radius:2px}
    @media(max-width:420px){dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Entwicklungsvorschau · Nur Testdaten</div>
    <h1>${e(pkg.name)}${pkg.version ? ` <span>v${e(pkg.version)}</span>` : ''}</h1>
    <p>Diese Seite zeigt den Stand der Festival-App für Entwicklung und Prüfung.</p>
    ${dirtyMessage}
    <dl>
      <dt>Build-Commit</dt><dd><a href="https://github.com/hhGrotDev95/Realm/commit/${e(commit)}">${e(commit)}</a></dd>
      <dt>Erstellt (UTC)</dt><dd><time datetime="${e(builtAt)}">${e(builtAt)}</time></dd>
      <dt>Umgebung</dt><dd>Staging</dd>
    </dl>
    <nav aria-label="Links">
      <a href="/">App öffnen</a><a href="/#admin">Admin-Bereich</a>
      <a href="https://github.com/hhGrotDev95/Realm/actions">GitHub Actions</a>
      <a href="https://github.com/hhGrotDev95/Realm/blob/main/REALM_PROGRESS.md">Projektfortschritt</a>
    </nav>
  </main>
</body>
</html>
`;
await writeFile(path.join(dist, 'development.html'), html);
