#!/usr/bin/env node
// Read installed npm package manifests without executing dependency code. No network access.
// Run from any directory: node scripts/licenses.mjs [--check]
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'docs/LICENSES.md')
const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/licenses.mjs [--check]')
const sort = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const posix = (p) => p.split(path.sep).join('/')
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('\n', ' ')
const code = (s) => `<code>${esc(s).replaceAll('`', '&#96;')}</code>`
const link = (label, p) => `[${esc(label)}](../${p.split('/').map(encodeURIComponent).join('/')})`
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const license = (value) => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) return value.map(license).join(' ; ') || 'UNBEKANNT' // legacy list: do not invent AND/OR
  if (value && typeof value.type === 'string') return value.type
  return 'UNBEKANNT'
}
const licenseFiles = (dir) => {
  const found = []
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => sort(a.name, b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.isSymbolicLink()) continue
      const p = path.join(base, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile() && /^(licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i.test(entry.name)
        && !/\.(?:[cm]?[jt]sx?|map|json|node|wasm)$/i.test(entry.name)) found.push(posix(path.relative(root, p)))
    }
  }
  walk(dir)
  return found.sort(sort)
}
const scopes = []
for (const [label, subdir] of [['Web', ''], ['API', 'worker']]) {
  const base = path.join(root, subdir)
  const manifest = json(path.join(base, 'package.json'))
  const lockPath = path.join(base, 'package-lock.json')
  const lock = json(lockPath)
  if (!lock.packages || lock.lockfileVersion < 2) throw new Error(`${label}: package-lock with packages map required`)
  const installed = new Map()
  const scan = (modules, required = false) => {
    if (!existsSync(modules)) {
      if (required) throw new Error(`${label}: node_modules missing; run npm ci in ${subdir || '.'}`)
      return
    }
    const add = (dir) => {
      const pkgPath = path.join(dir, 'package.json')
      if (!existsSync(pkgPath)) throw new Error(`Package manifest missing: ${posix(path.relative(root, dir))}`)
      const pkg = json(pkgPath)
      const key = posix(path.relative(base, dir))
      installed.set(key, { pkg, files: licenseFiles(dir) })
      scan(path.join(dir, 'node_modules'))
    }
    for (const entry of readdirSync(modules, { withFileTypes: true }).sort((a, b) => sort(a.name, b.name))) {
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) throw new Error(`${label}: linked package requires manual review: ${entry.name}`)
      if (!entry.isDirectory()) continue
      const dir = path.join(modules, entry.name)
      if (!entry.name.startsWith('@')) add(dir)
      else for (const child of readdirSync(dir, { withFileTypes: true }).sort((a, b) => sort(a.name, b.name))) {
        if (child.isSymbolicLink()) throw new Error(`${label}: linked package requires manual review: ${entry.name}/${child.name}`)
        if (child.isDirectory()) add(path.join(dir, child.name))
      }
    }
  }
  scan(path.join(base, 'node_modules'), true)
  const packageKeys = Object.keys(lock.packages).filter((key) => /(?:^|\/)node_modules\//.test(key))
  const allKeys = [...new Set([...packageKeys, ...installed.keys()])].sort(sort)
  const rows = allKeys.map((key) => {
    const item = installed.get(key)
    const locked = lock.packages[key]
    const name = item?.pkg.name ?? locked?.name ?? key.split('node_modules/').at(-1)
    const version = item?.pkg.version ?? locked?.version ?? 'UNBEKANNT'
    const direct = key === `node_modules/${name}`
    const declaration = direct && Object.hasOwn(manifest.dependencies ?? {}, name) ? 'direkt / Laufzeit'
      : direct && Object.hasOwn(manifest.optionalDependencies ?? {}, name) ? 'direkt / Laufzeit, optional'
        : direct && Object.hasOwn(manifest.devDependencies ?? {}, name) ? 'direkt / Entwicklung'
          : !locked ? 'nicht im Lockfile'
            : locked.dev ? 'transitiv / Entwicklung' : locked.devOptional ? 'transitiv / Entwicklung + optionale Laufzeit' : 'transitiv / Laufzeit'
    const role = declaration + (locked?.optional && !declaration.includes('optional') ? ', optional' : '')
    const loc = posix(path.join(subdir, key))
    const status = !item ? 'nur Lockfile; nicht installiert'
      : !locked ? 'installiert; fehlt im Lockfile'
        : item.pkg.version !== locked.version ? `ABWEICHUNG: installiert ${item.pkg.version}; Lockfile ${locked.version}`
          : 'installiert'
    const expression = item ? license(item.pkg.license ?? item.pkg.licenses) : license(locked?.license)
    const platform = [locked?.os && `OS: ${locked.os.join(', ')}`, locked?.cpu && `CPU: ${locked.cpu.join(', ')}`, locked?.libc && `libc: ${locked.libc.join(', ')}`].filter(Boolean).join('; ') || 'keine Plattformbedingung im Lockfile'
    const files = item ? item.files.map((p) => link(posix(path.relative(path.join(root, loc), path.join(root, p))), p)).join(', ') || 'keine Lizenz-/NOTICE-Datei gefunden'
      : 'nicht geprüft (Paket fehlt lokal)'
    return { name, version, key, loc, role, status, expression, platform, files, item, locked }
  })
  scopes.push({
    label, subdir, rows, hash: createHash('sha256').update(readFileSync(lockPath)).digest('hex'),
    lockfile: posix(path.join(subdir, 'package-lock.json')),
  })
}

const lines = [
  '# Lizenzinventar',
  '',
  '<!-- Generated by scripts/licenses.mjs. Edit the generator, then regenerate. -->',
  '',
  'Erzeugt mit `node scripts/licenses.mjs`; prüfbar mit `node scripts/licenses.mjs --check`. Vorher `npm ci` im Projekt und in `worker/` ausführen. Das Skript liest ausschließlich Dateien, ohne Paketcode oder Netzwerkanfragen auszuführen.',
  '',
  `Installationsplattform dieses Inventars: **${process.platform}/${process.arch}**. Die Ausgabe ist für dieselben Lockfiles, installierten Pakete und Plattform deterministisch; auf einer anderen Plattform ändern sich die installierten optionalen Binärpakete. Ein dortiger Unterschied bei \`--check\` ist deshalb zunächst ein Inventarunterschied.`,
  '',
  'Erfasst sind die Paketwurzeln in beiden `node_modules`-Bäumen, einschließlich Scoped Packages und verschachtelter Abhängigkeiten. Untermodul-`package.json` innerhalb eines Pakets wird nicht als eigene npm-Abhängigkeit gezählt. Jede Installation wird separat mit Pfad aufgeführt; gleiche Pakete in Web und API sind keine zusätzlichen Lizenzarten.',
  '',
  '„Laufzeit“/„Entwicklung“ stammt aus den Abhängigkeiten des jeweiligen Projektmanifests und den npm-Lockfile-Markierungen, nicht aus einer Analyse des ausgelieferten Bundles. „Laufzeit“ kann deshalb auch nur beim Import verwendete Bibliotheken enthalten. Alle nicht installierten Lockfile-Einträge bleiben unten sichtbar. Plattformbedingungen erklären mögliche Auslassungen; sie beweisen nicht, warum npm ein optionales Paket tatsächlich ausgelassen hat.',
  '',
  'Bei installierten Paketen stammt die Lizenzangabe aus deren `package.json` (`license`, ersatzweise das ältere `licenses`-Feld); bei fehlenden Paketen nur aus dem Lockfile. Eine ältere Lizenzliste wird mit `;` wiedergegeben, ohne eine AND/OR-Auswahl zu erfinden. Fehlende Metadaten heißen `UNBEKANNT`. Angaben sind ungeprüfte Herstellerangaben, keine automatische Lizenzfreigabe.',
  '',
  'Die Dateilinks zeigen auf die nach `npm ci` lokal vorhandenen Lizenz-/Copyright-/NOTICE-Dateien. Diese werden rekursiv innerhalb des Pakets gesucht, ohne dessen verschachtelte `node_modules` einzubeziehen. Die Links sind im GitHub-Webviewer mangels eingechecktem `node_modules` nicht abrufbar; das Inventar ersetzt keine mitzuliefernden Lizenztexte.',
  '',
  '## Abdeckung',
  '',
  '| Projekt | Installierte Paketwurzeln | Nur im Lockfile | Lizenzangabe unbekannt | Lockfile SHA-256 |',
  '| --- | ---: | ---: | ---: | --- |',
  ...scopes.map((s) => `| ${s.label} | ${s.rows.filter((r) => r.item).length} | ${s.rows.filter((r) => !r.item).length} | ${s.rows.filter((r) => r.expression.includes('UNBEKANNT')).length} | ${link(s.lockfile, s.lockfile)}: ${code(s.hash)} |`),
  '',
  '## Vor einer Veröffentlichung zu prüfen',
  '',
  '- Tatsächlich ausgelieferte Web-/Worker-Artefakte gegen dieses Inventar abgleichen und vorgeschriebene Lizenztexte, Urheberhinweise und NOTICE-Inhalte im Auslieferungsweg zugänglich machen. Dieses Entwicklerdokument allein erfüllt das nicht.',
  '- OFL-Schriften samt ihren Lizenztexten berücksichtigen; Änderungen an Fonts und etwaige reservierte Namen separat prüfen.',
  '- Native optionale Pakete können weitere Komponenten und eigene Lizenztexte enthalten (z. B. `@img/sharp-libvips-*`). Deren LICENSE/NOTICE-Inhalte und mögliche Copyleft-Pflichten gesondert prüfen; ein npm-Lizenzfeld bildet eingebettete Komponenten nicht vollständig ab.',
  '- `UNBEKANNT`, fehlende Lizenzdateien, Lockfile-Abweichungen und nicht installierte Pakete vor ihrer Verwendung nachprüfen. Installationen auf Deployment-/CI-Plattformen zusätzlich inventarisieren, wenn sie andere Pakete ausliefern.',
  '- Festivalbilder, Logos, Karten, redaktionelle Inhalte, externe Dienste und separat heruntergeladene Browser-/Werkzeug-Binärdateien gehören nicht zum npm-Inventar; Nutzungsrechte und Bedingungen separat nachweisen. Auch die Lizenz des eigenen Realm-Codes wird hier nicht festgelegt.',
]
for (const scope of scopes) {
  for (const installed of [true, false]) {
    const rows = scope.rows.filter((r) => !!r.item === installed)
    lines.push('', `## ${scope.label}: ${installed ? 'installierte Pakete' : 'nur im Lockfile'}`, '')
    if (!rows.length) {
      lines.push('Keine.')
      continue
    }
    lines.push('| Paket / Version | Pfad | Einordnung | Lizenzangabe | Status / Plattform | Lizenz- und Hinweisdateien |', '| --- | --- | --- | --- | --- | --- |')
    for (const r of rows) lines.push(`| ${code(`${r.name}@${r.version}`)} | ${code(r.loc)} | ${esc(r.role)} | ${code(r.expression)} | ${esc(r.status)}${installed ? '' : `<br>${esc(r.platform)}`} | ${r.files} |`)
  }
}
const document = lines.join('\n') + '\n'
if (args.includes('--check')) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== document) {
    console.error('docs/LICENSES.md differs from the current installation. Run node scripts/licenses.mjs and review the changes.')
    process.exitCode = 1
  } else console.log('docs/LICENSES.md matches both installed dependency trees and lockfiles.')
} else {
  writeFileSync(output, document)
  console.log(`Wrote docs/LICENSES.md: ${scopes.map((s) => `${s.label} ${s.rows.filter((r) => r.item).length} installed / ${s.rows.filter((r) => !r.item).length} lockfile-only`).join('; ')}`)
}
