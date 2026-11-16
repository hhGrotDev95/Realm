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

Die Konsole verwendet ein persönliches Konto mit Zwei-Faktor-Anmeldung. Das erste Plattform-Konto ist seit 30.10.2026 eingerichtet und TOTP aktiviert. Die Einladung wurde über einen nur vorübergehend gesetzten `ADMIN_TOKEN` erzeugt; der Bootstrap-Schlüssel wurde danach entfernt. Persönliche Sitzungen funktionieren unabhängig davon. Passwörter und MFA-Geheimnisse gehören nicht in diese Dokumentation.

## Automatische Aktualisierung

Seit 30.10.2026 eingerichtet:

- PR #43 ist nach grüner CI in `main` integriert; `main` ist GitHubs Standardbranch.
- Im GitHub-Environment `staging` liegt das Secret `CLOUDFLARE_API_TOKEN`. Die Deployment-Branch-Regel erlaubt ausschließlich `main`.
- Separater Token `Realm Staging GitHub CI`: Workers Scripts Edit, D1 Edit, Account Settings Read, auf das verwendete Cloudflare-Konto beschränkt. Diese Rechte sind kontoweit und nicht ausschließlich auf den Realm-Worker begrenzt. Ablauf 28.01.2027; vor Ablauf erneuern. Die lokale OAuth-Anmeldung wurde nicht kopiert.
- Repository-Variable `REALM_STAGING_DEPLOY_ENABLED=true` ist gesetzt. `.github/workflows/staging.yml` folgt damit erfolgreichen **Push-CI-Läufen auf `main`** und verwendet deren exakten Quellcommit. Überholte Ergebnisse werden vor Migration/Deploy übersprungen.
- Erster manueller GitHub-Deploymentlauf [41051288845](https://github.com/hhGrotDev95/Realm/actions/runs/41051288845) erfolgreich: Installation, Unit-Prüfungen, Worker-Typprüfung, Build, Migrationen, Deploy und öffentlicher Staging-Check samt Quellcommit. Ausgeliefert: `062d8ebf33474fcd55404e9d898d036d42000bdb`, sauberer Build. Öffentliche Health-/Build-Abfrage zusätzlich bestätigt.

Der automatische Folgelauf nach einem neuen main-CI-Ereignis ist noch nicht separat beobachtet; der reale Deploymentpfad wurde mit dem manuellen Lauf geprüft. Zum Ausschalten der Automatik die Repository-Variable auf `false` setzen; manuelle Läufe bleiben möglich. Der Token läuft am 28. Januar ab, wenn er nicht ersetzt wird. GitHub meldet außerdem eine Wartungswarnung für die Node-Laufzeit von `actions/checkout@v4`/`setup-node@v4`; der Lauf ist erfolgreich, eine geplante Aktualisierung der Action-Versionen bleibt offen.

Der abhakbare Weg zur iPhone-App und responsiven Website für Januar steht in [WINTER_RELEASE_PLAN.md](WINTER_RELEASE_PLAN.md). Android nutzt die Website.

Die Realm-iPhone-Hülle verwendet dieselbe Staging-API. Am 31.10.2026 wurde die
Allowlist gezielt auf `capacitor://localhost` erweitert; sie enthält weiterhin
`https://realm-staging.heidlhannes95.workers.dev`. Das war ein Cloudflare-
Einstellungsupdate ohne Code- oder Asset-Deployment. Deployment `fde57f46-8757-4099-baf5-2a6c009b7279`
wechselte von Version `52a1aed1-473f-48f8-8aff-cf3a1d9e4e85` zu
`bab7d612-aef8-4c5b-ab9f-2e7092c23919`. Öffentliche Prüfungen ergaben:
Preflight 204, Festival-API 200, fehlende Authentifizierung 401 und fehlende
Route 404 mit den erlaubten CORS-Headern für Web- und native Origin; eine
fremde Origin erhielt kein `Access-Control-Allow-Origin`. Vorher/Nachher
verglichen wurden Worker-Modulhash und ETag, Assets-Routing, Zeitpläne und
D1-Bindung; diese Werte blieben unverändert. Nur App-Shell (`/`),
`/build-info.json` und Festivalantworten waren bytegleich. Es wurden keine
Assets hochgeladen und keine D1-Migration oder Schreiboperation ausgeführt;
D1-Daten und einzelne Assets wurden nicht verglichen.
Die Web-Oberfläche läuft weiter aus dem zuvor ausgelieferten Stand
`062d8ebf33474fcd55404e9d898d036d42000bdb`. Die CORS-Prüfung allein bestätigt
keinen Test aus der App; Stand der signierten Installation und offenen
Geräteprüfungen siehe [iPhone-Integrationsleitfaden](IPHONE_INTEGRATION.md).
Native Build-Ausgaben liegen in `dist-ios/`,
Web-Staging bleibt bei `dist/`. Ablauf und Grenzen:
[IPHONE_INTEGRATION.md](IPHONE_INTEGRATION.md).

**Konfigurationsdrift beachten:** Das gezielte Cloudflare-Einstellungsupdate
ist bereits live, die lokale `worker/wrangler.toml` enthält dieselbe Allowlist
im Staging-Environment, aber der weiterhin ausgelieferte `main`-Stand
`062d8ebf33474fcd55404e9d898d036d42000bdb` enthält noch die alte Web-only-Origin.
Ein nächster regulärer `main`-Deploy könnte daher die native Origin wieder
entfernen. Die geprüfte CORS-Quelländerung muss vor dem nächsten regulären
Pipeline-Deploy in den Quellstand integriert werden. Bei der erneuten Prüfung
am 31.10.2026 war `origin/main` bereits `e7ddf7d` (PR #42), ebenfalls noch mit
Web-only-Allowlist; die öffentliche Buildinfo zeigte weiterhin `062d8eb`.
Zwölf frische HTTP-Prüfungen bestätigten die aktuell noch wirksame native
CORS-Freigabe. Daraus folgt kein erfolgreicher Pipeline-Deploy von `e7ddf7d`.

Produktion, Lasttest, Alarme, Wiederherstellungsprobe, Push und die offenen Betreiber-/Rechtstexte sind separate nächste Schritte. Eine fehlgeschlagene Staging-Prüfung rollt Datenbankmigrationen nicht automatisch zurück.

Referenzen: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [SPA-Routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), [Wrangler-Umgebungen](https://developers.cloudflare.com/workers/wrangler/environments/).


### Native Origin erneut wiederhergestellt · 13.11.2026

Die frische öffentliche Vorprüfung fand Web-Build `a08bef9` (12.11.2026,
`dirty: false`) und erneut ausschließlich die Web-Origin in `ALLOWED_ORIGINS`.
Das bereits autorisierte, gezielte Settings-PATCH ergänzt wieder
`capacitor://localhost`. Zwölf öffentliche CORS-Fälle bestanden: Preflight 204,
Festival 200, fehlende Anmeldung 401 und fehlende Route 404 mit passenden Headern
für Web und native Origin; eine fremde Origin erhält keine Freigabe.
Worker-Modulhash, Zeitpläne, D1-Bindung und die Antworten auf `/`,
`/build-info.json` und `/api/festivals/realm-open-air` blieben unverändert.
Die einzige weitere Settings-Abweichung war das Deployment-Metadatum
`workers/triggered_by` (`version_upload` → `upload`). Kein Code-/Asset-Upload,
keine Migration; D1-Inhalte, sämtliche Assets und Assets-Routing wurden in
diesem Durchlauf nicht vollständig verglichen. Keine native Sitzungsabnahme.

Die lokale CORS-Quelländerung ist weiterhin uncommittet. Sie muss vor dem
nächsten regulären Web-Deploy in dessen Quellstand übernommen werden, sonst
kann die Pipeline die native Freigabe erneut entfernen. Kein automatischer
Merge oder Web-Deploy wurde ausgelöst.


### CORS im gemeinsamen Quellstand · 16.11.2026

[Integrations-PR #54](https://github.com/hhGrotDev95/Realm/pull/54) enthält die
native Origin `capacitor://localhost` direkt in `worker/wrangler.toml` neben
der Web-Staging-Origin. Die API-Suite prüft erlaubte und fremde Origins.
Damit stammt die Freigabe nach der regulären Übernahme aus derselben
versionierten Konfiguration wie der übrige Worker. Die oben beschriebenen
separaten Settings-PATCHes und Driftbefunde bleiben historische Belege.

Die bestehende Staging-Pipeline folgt weiterhin nur erfolgreicher main-Push-CI.
Ein PR- oder Browser-Test allein ist kein Deploymentnachweis; den tatsächlich
veröffentlichten Commit immer über `/build-info.json` abgleichen. Für den
Gesamtstand gelten der jüngste Fortschrittseintrag und der Winterplan.
