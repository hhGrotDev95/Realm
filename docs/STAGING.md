# Realm-Entwicklungsvorschau

- App: https://realm-staging.heidlhannes95.workers.dev
- Stand der ausgelieferten Version: https://realm-staging.heidlhannes95.workers.dev/development
- Maschinenlesbar: `/build-info.json` (Commit, Build-Zeit, ungespeicherter Git-Stand).
- Fortschritt und offene Entscheidungen: `REALM_PROGRESS.md`.

Die Vorschau verwendet Testdaten und eine eigene D1-Datenbank `realm-staging` (beim Anlegen auf EU-Jurisdiktion beschränkt). Bestehende LIR-Worker/Datenbanken und eine spätere Produktion sind davon getrennt. Keine echten personenbezogenen Testdaten verwenden. Ein veröffentlichter Vorschau-Link ist keine Produktionsfreigabe.

## Architektur

Ein Cloudflare Worker liefert den Vite-Produktionsbuild und die bestehende Hono-API aus. `assets.run_worker_first = ["/api/*"]` schützt API-Routen einschließlich 404-Antworten vor dem SPA-Fallback. Die stündliche Datenbereinigung bleibt aktiv. Die Demo-Festivals kommen aus den vorhandenen Migrationen.

`.env.staging` enthält nur den öffentlichen Origin. Der API-Client hängt `/api/...` selbst an; deshalb darf dort kein zusätzliches `/api` stehen. Tokens gehören ausschließlich in Cloudflare-Secrets beziehungsweise in die lokale Wrangler-Anmeldung.

## Lokal prüfen

```sh
npm ci
npm --prefix worker ci
npm run typecheck
npm run test:import
npm --prefix worker run typecheck
npm --prefix worker test
npm run build
npm run test:e2e
npm run test:a11y
npm run test:live
```

Die Browser-Skripte unterstützen `CHROMIUM_PATH` für einen vorhandenen Chrome-/Chromium-Pfad. Firefox/WebKit werden von der bestehenden CI separat geprüft.

Für die kombinierte lokale Staging-Umgebung:

```sh
VITE_API_URL=http://localhost:8790 npm run build:staging
npm --prefix worker run migrate:staging:local
npm --prefix worker run dev:staging
# In einem zweiten Terminal:
npm run check:staging -- http://localhost:8790
```

## Cloudflare aktualisieren

Aus einem geprüften Commit mit sauberem Arbeitsverzeichnis:

```sh
npm run build:staging
npm --prefix worker run deploy:staging -- --dry-run
npm --prefix worker run migrate:staging
npm --prefix worker run deploy:staging
npm run check:staging -- https://realm-staging.heidlhannes95.workers.dev
```

`build:staging` erzeugt zusätzlich die Statusseite. Sie zeigt ausdrücklich an, wenn der Build aus einem veränderten Arbeitsverzeichnis stammt. Der Staging-Check liest nur Daten: App-Shell, Service Worker, Manifest/Asset, Festival-Dokument und API-404. Er ersetzt weder Browser-/Mehrbenutzertests noch einen Lasttest.

Die Konsole benötigt ein persönliches Veranstalterkonto mit Zwei-Faktor-Anmeldung. Der erste Plattform-Zugang wird über einen separat gesetzten `ADMIN_TOKEN` und eine Einladung eingerichtet; kein gemeinsames Passwort oder Token wird veröffentlicht. Ohne Einrichtung besteht noch kein nutzbarer Admin-Zugang.

## Automatische Aktualisierung vorbereiten

`.github/workflows/staging.yml` kann manuell gestartet werden. Automatisch folgt es erst dann einem erfolgreichen **Push-CI-Lauf auf `main`**, wenn die Repository-Variable `REALM_STAGING_DEPLOY_ENABLED=true` gesetzt wurde. Es prüft den exakten Commit aus diesem Lauf aus.

Vor Aktivierung:

1. Diesen Branch nach grüner CI prüfen/mergen und GitHubs Standardbranch auf `main` umstellen (derzeit noch `claude/realm-festival-app`).
2. Im GitHub-Environment `staging` das Secret `CLOUDFLARE_API_TOKEN` hinterlegen. Einen separaten Cloudflare-API-Token verwenden, auf dieses Konto beschränkt, mit Workers Scripts Edit und D1 Edit sowie den von Wrangler benötigten Kontolese-Rechten. Die lokale OAuth-Anmeldung nicht kopieren.
3. Den Workflow einmal manuell prüfen; danach die Variable aktivieren. Der Workflow gibt App- und Status-Link aus und schlägt bei einer defekten Bereitstellung fehl.

Produktion, Lasttest, Alarme, Wiederherstellungsprobe, Push und die offenen Betreiber-/Rechtstexte sind separate nächste Schritte. Eine fehlgeschlagene Staging-Prüfung rollt Datenbankmigrationen nicht automatisch zurück.

Referenzen: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [SPA-Routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), [Wrangler-Umgebungen](https://developers.cloudflare.com/workers/wrangler/environments/).
