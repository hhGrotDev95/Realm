# Private Projektübersicht

Portal: <https://realm-project-status.heidlhannes95.workers.dev>

Der mobile Einstieg zeigt den belegten Projektstand, nächste Schritte, Aufgaben
für Hannes, Termine und Links. Die Festivalverwaltung bleibt separat:
[Adminportal](https://realm-staging.heidlhannes95.workers.dev/#admin) → persönlicher
Realm-Login (E-Mail, Passwort, TOTP) → **Neues Festival**. Der Assistent führt durch
Grunddaten, Bühnen, Timetable, Vorschau und bewusstes Veröffentlichen. Ein Entwurf
ist nicht öffentlich. Cloudflare-Anmeldung und Realm-Admin-Anmeldung sind getrennt.

## Daten und Aktualisierung

- `docs/WINTER_RELEASE_PLAN.md` bleibt die maßgebliche A–D-Checkliste. Der Balken
  zählt deren abgeschlossene Punkte; Basisfunktionen und optionale E-Punkte zählen
  nicht mit. 3/17 bedeutet 18 % dieser Checkliste, nicht 18 % fertige App.
- `docs/PROJECT_STATUS.json` enthält die verständliche, redaktionell geprüfte
  Zusammenfassung. Keine freie KI-Schätzung und kein automatisches Abhaken.
- `REALM_PROGRESS.md` enthält nachprüfbare Ergebnisse. Jede neue Übergabe bekommt
  eine datierte Überschrift der zweiten Ebene (`## ... (TT.MM.JJJJ, ...)`).
- `reviewedGateStates` und `reviewedHandoff` bestätigen, welche Checkboxen und
  jüngste Übergabe geprüft wurden. Bei Abweichungen scheitert der Build. Zuerst
  Texte, Termine, Grenzen und nächste Schritte prüfen, danach diese Marker ändern.
- `reviewedAt` ist das Datum der inhaltlichen Prüfung. `generatedAt` ist nur der
  technische Buildzeitpunkt. Der Status nennt zusätzlich den Quellcommit; lokale,
  nicht committete Ausgaben sind als Vorschau gekennzeichnet.

Nach jedem Arbeitspaket diese Quellen zusammen pflegen, `npm run build:owner` und
`npm run test:owner` ausführen und den tatsächlichen Prüf-/Veröffentlichungsstand
dokumentieren. Layout- oder Authänderungen benötigen zusätzlich `test:owner:ui`
und den passenden unabhängigen Review. AGENTS.md und CLAUDE.md schreiben dies vor.

Der Workflow `.github/workflows/owner-portal.yml` prüft relevante PRs. Jeder Push auf `main` wird geprüft; Änderungen
an den Quellen werden nach seinen erfolgreichen Prüfungen automatisch
veröffentlicht; manuelle Läufe sind ebenfalls nur von `main` erlaubt. Überholte
Commits werden übersprungen. Deployment erfolgt mit dem vorhandenen CI-Secret im
GitHub-Environment `staging`, ausschließlich in den separaten Status-Worker.
Keine D1-Migration und keine Änderung am öffentlichen Realm-Worker.

Damit bleibt die Seite nach veröffentlichten Arbeitspaketen ohne laufenden Laptop
aktuell. Dies ist keine tägliche KI-Entwicklung. Es wurde kein neuer KI-Zeitplan,
API-Schlüssel oder kostenpflichtiger KI-Dienst eingerichtet. Hannes hat den
bisherigen Claude-Zeitplan laut Nutzerangabe am 16.11.2026 deaktiviert.

## Privater Zugang

Nur diesen Worker unter **Workers & Pages → realm-project-status → Access** mit
**All traffic** und einer Allow-Regel für ausschließlich die E-Mail des
Eigentümers schützen. Keine kontoweite Access-Regel
aktivieren, da die öffentliche Festival-App erreichbar bleiben muss.
Die kontoweite Standardrichtlinie „Cloudflare account“ ist hier zu breit.
Zusätzlich gleicht der Worker die von Cloudflare bestätigte Identität exakt mit
dem Secret `OWNER_EMAIL` ab. Andere Kontomitglieder werden dadurch abgewiesen.
Die tatsächliche E-Mail gehört nicht in Repository oder Builddaten.

HTML und `/status.json` benutzen dieselbe Zugangskontrolle. Keine Static-Assets-
Bindung: Cloudflares Assets-Router reicht `ctx.access` derzeit nicht weiter.
Kein Vertrauen in vom Client gesetzte Access-/E-Mail-Header. Ohne Secret kommt
503, ohne bestätigte Identität 403. Die Seite ist vor Einrichtung des Logins
gesperrt. Preview-URLs sind deaktiviert; Access gilt für sämtlichen Worker-Traffic.
Alle Antworten verwenden `private, no-store`; kein Service Worker, keine Analyse,
keine externen Schriften/Skripte oder Bilddienste. Abmelden führt über Cloudflare
Access; es ändert keine separate Realm-Admin-Sitzung.

Die öffentliche Repository-Zusammenfassung enthält nur veröffentlichbare Fakten.
Private DOKU, E-Mail-Adresse, Passwörter, Tokens, Gerätekennungen und Rohbelege
werden niemals mitgebaut. Cloudflare-Login macht öffentlichen GitHub-Inhalt nicht
nachträglich privat. Für künftige vertrauliche Ergänzungen erst eine gesonderte
private Datenquelle entwerfen.

## Prüfen und veröffentlichen

```sh
npm ci
npm ci --prefix worker
npm run build:owner
npm run test:owner
npx playwright install chromium
npm run test:owner:ui
worker/node_modules/.bin/wrangler deploy --config owner-portal/wrangler.toml --dry-run
```

Auf diesem Mac kann `CHROMIUM_PATH` auf das installierte Google Chrome zeigen.
Der UI-Test verwendet nur einen lokalen Testserver mit synthetischer Identität;
der Deployment-Einstieg importiert diesen Adapter nicht. Er prüft 320/390/1280 px,
die aufgeklappte Checkliste, verdoppelte Schrift und axe auf schwere Befunde.

Ein autorisierter manueller Erstdeploy verwendet denselben expliziten
`--config owner-portal/wrangler.toml`-Pfad. `OWNER_EMAIL` einmal über
`wrangler secret put OWNER_EMAIL --config owner-portal/wrangler.toml` eintragen;
normale Deployments erhalten das Secret. Access im Dashboard konfigurieren.
Keinen ungeschützten Umweg einbauen, wenn Cloudflare keinen Identitätskontext
liefert. Kontozugang erneuern oder Access-Konfiguration korrigieren.

`npm run check:owner` prüft anonym und mit gefälschten Identitätsheadern `/`,
`/status.json` und einen unbekannten Pfad. 403 beweist die Sperre, jedoch noch
keinen funktionierenden Login. Der Eigentümer muss separat über den Browser
mit dem angebotenen Cloudflare-Access-Verfahren erfolgreich anmelden und die Seite sehen. Nach einem Deploy außerdem Quellstand
und Inhalt unter der echten Anmeldung prüfen. Ein früherer Live-Nachweis ersetzt
keine neue Prüfung bei Authänderungen.

## Einrichtungsstand · 16.11.2026

Lokale Unit-, Daten-/Drift-, Auth- und Rendererprüfungen bestanden; drei
Browserbreiten, 200-%-Schrift und axe bestanden. Erster Worker-Upload erfolgreich. Worker-Access ist für **All traffic** mit einer
Allow-Regel ausschließlich für den Eigentümer aktiviert, Sitzung 24 Stunden.
Anmeldung über den angebotenen Cloudflare-Login führte in Safari zur vollständigen
Projektübersicht. Sechs externe anonyme/gefälschte Anfragen wurden zur Access-
Anmeldung umgeleitet; vor Aktivierung sperrte der Worker sie mit 403.
Der automatische GitHub-Folgelauf wird nach Übernahme nachgewiesen; der finale
Übernahmestatus folgt im jüngsten Fortschrittseintrag.

Technische Grundlage: [Worker mit Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
und [Cloudflare als Identitätsanbieter](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/).
