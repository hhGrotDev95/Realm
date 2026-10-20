# Realm – Fortschritt

Stand: 20.10.2026

- Runde 1 (Aufgaben 1–3): Branch `claude/realm-next`, gemergt als PR #4
- Runde 2 (Aufgaben 4–6): Branch `claude/realm-next-2`, gemergt als PR #5
- Loop (fortlaufende Verbesserungen, je eine pro Runde): ab Aufgabe 7

# Runde 1

## Auswahl der Aufgaben

Kriterium: höchster Nutzen auf dem Festivalgelände und ohne externe Zugänge (Cloudflare-Konto, App-Store, Push-Schlüssel) umsetzbar.

| # | Aufgabe | Warum jetzt |
| --- | --- | --- |
| 1 | Offline-Warteschlange für soziale Aktionen | Auf Festivals ist das Netz regelmäßig weg; bisher gingen Chat, Zusagen und Meldungen dann verloren. |
| 2 | Offizielle Meldungen über das Backend | Warnungen des Veranstalters (Gewitter, Bühnenpause) kamen nur aus Demo-Daten. |
| 3 | Effizienter Sync | 8-s-Polling mit Vollabgleich belastet Netz und Akku; bei Ausfall wurde im Takt weiter gefeuert. |

Bewusst **nicht** gewählt (blockiert): Deployment (braucht Cloudflare-Konto), Web-Push (braucht VAPID-Schlüssel und Deployment), Passkeys/native Schritte (native App).

## 1 · Offline-Warteschlange — erledigt

- Chat, Meetups, Zusagen, Votes und Meldungen landen zuerst in einer persistierten Outbox (`localStorage`) und werden der Reihe nach gesendet; Netzwerk-, 429- und 5xx-Fehler bleiben in der Schlange, Validierungsfehler werden verworfen und gemeldet.
- Client-IDs machen Wiederholungen idempotent: gleicher Gast → `200` mit vorhandenem Datensatz, fremder Gast → `409`, ungültige ID → `400`.
- Ausstehende Nachrichten erscheinen als „Wird gesendet …“; eine Statuspille zeigt „Offline · N Änderungen warten“.

Dateien: `worker/src/index.ts`, `src/api.ts` (`OutboxOp`, `execute`, `retryable`, `opId`), `src/store.tsx` (Outbox, `flush`, `enqueue`), `src/App.tsx`, `src/sheets.tsx`, `src/styles.css`, `src/data.ts`.

Nachweis:
- API-Test „client ids make retries idempotent“ (doppelte Nachricht und Meetup werden einmal gespeichert, fremde/ungültige IDs abgelehnt).
- Live-E2E „offline: message is queued, shown as pending and delivered after reconnect“ – Ben schreibt im Funkloch, lädt offline neu, geht online; Lea erhält die Nachricht genau einmal.

## 2 · Offizielle Meldungen — erledigt

- Migration `0002_announcements.sql`; `GET /api/announcements` öffentlich (ohne Profil).
- `POST/PATCH/DELETE /api/admin/announcements` mit `ADMIN_TOKEN`-Secret (Vergleich in konstanter Zeit); ohne Secret sind die Routen gesperrt (`403`).
- Veranstalter-CLI `worker/scripts/announce.mjs` (`npm run announce -- add|list|remove`).
- Die App lädt Meldungen minütlich für alle, speichert sie offline, zählt das Alter offline weiter und blendet abgelaufene aus; Warnungen und Kritisches erscheinen als Hinweis oben auf Home. Demo-Meldungen nur noch ohne Backend.

Dateien: `worker/migrations/0002_announcements.sql`, `worker/src/index.ts`, `worker/scripts/announce.mjs`, `worker/package.json`, `src/api.ts`, `src/store.tsx`, `src/sheets.tsx`, `README.md`.

Nachweis:
- API-Test „announcements: admin-only writes, public reads, expiry“ (401 ohne/mit falschem Token, 400 bei ungültiger Stufe, Anlegen, öffentlich lesen, Ändern, Löschen, 404 danach).
- Live-E2E „official announcement from the organizer CLI reaches the app as an alert“ – CLI veröffentlicht, Lea sieht die Warnung auf Home inkl. „Gültig noch 30 Min.“.

## 3 · Effizienter Sync — erledigt

- Chat wird nach dem ersten Vollabruf nur noch inkrementell geladen (`?since=`), jeder 15. Abruf gleicht vollständig ab; neue Nachrichten werden per ID zusammengeführt.
- Polling per `setTimeout`-Schleife: 8 s im Normalfall, bei Fehlern exponentielles Backoff bis 2 min; Rückkehr ins Netz oder in den sichtbaren Tab synchronisiert sofort und setzt das Backoff zurück.

Dateien: `src/api.ts`, `src/store.tsx`, `src/data.ts`.

Nachweis:
- Live-E2E „sync is incremental and backs off while the network is down“ – Abrufe enthalten `since=`; offline höchstens 3 Versuche in 40 s (gemessen: 2) statt ~5.
- Live-E2E „new messages arrive incrementally without a reload“ – Nachricht erscheint ohne Reload, ältere bleiben genau einmal erhalten.

## Prüfläufe Runde 1

| Prüfung | Ergebnis |
| --- | --- |
| `npm run typecheck` (Web) · `cd worker && npm run typecheck` | ohne Fehler |
| `cd worker && npm test` | 18 API-Tests bestanden |
| `npm run build && npm run test:e2e` (Demo-Modus) | 8 Abläufe bestanden |
| `npm run test:live` (2 Nutzer, echte API, lokale D1) | 11 Szenarien bestanden |
| GitHub Actions auf PR #4 (Head `c270628`) | `web`, `api`, `live` grün |

# Runde 2

## Auswahl der Aufgaben

| # | Aufgabe | Warum jetzt |
| --- | --- | --- |
| 4 | Timetable-Änderungen live | Verschiebungen und Absagen sind auf Festivals Alltag; der Plan der Besucher war davon bisher nicht betroffen. |
| 5 | Veranstalter-Konsole im Browser | Meldungen und Änderungen ließen sich nur per CLI pflegen – im Festivalbetrieb unrealistisch. |
| 6 | Barrierefreiheits-Audit | Nie systematisch geprüft; Kontrast im Freien bei Nacht und Screenreader-Nutzung sind Kernanforderungen. |

Weiterhin blockiert: Deployment und Web-Push (Cloudflare-Konto bzw. VAPID-Schlüssel), native Funktionen.

## 4 · Timetable-Änderungen live — erledigt

- Migration `0003_timetable_changes.sql`; `GET /api/timetable/changes` öffentlich, `PUT/DELETE /api/admin/timetable/:actId` mit Admin-Token; Validierung von Act-ID, Zeitpaar (Ende nach Beginn), Bühne und „mindestens eine Änderung“.
- Die App wendet Änderungen auf den gemeinsamen Timetable an (alle Screens sehen dieselbe Version, offline gecacht). Verschobene Acts zeigen „Neu 22:30 statt 22:15“, abgesagte werden durchgestrichen und fallen aus Konflikten und Jetzt/Als-Nächstes heraus.
- Betrifft eine Änderung einen Act im eigenen Plan, erscheint auf Home ein Hinweis (Absage rot, Verschiebung gelb); das Act-Sheet nennt alte und neue Zeit und den Grund.
- Der Demo-Modus nutzt denselben Mechanismus (Arcturus +15 Min.); die frühere doppelte Demo-Meldung dazu ist entfernt.
- Entfernt: `Cache-Control: max-age=20` auf öffentlichen Lesezugriffen – Worker-Antworten werden ohnehin nicht am Edge gecacht, der Header verzögerte nur Änderungen (im Test reproduziert).

Dateien: `worker/migrations/0003_timetable_changes.sql`, `worker/src/index.ts`, `src/data.ts` (`applyTimetableChanges`, `DEMO_CHANGES`), `src/api.ts`, `src/store.tsx`, `src/time.ts`, `src/screens/Lineup.tsx` (`ChangeTag`), `src/screens/Home.tsx` (`PlanChanges`), `src/sheets.tsx`, `src/styles.css`.

Nachweis:
- API-Test „timetable changes: admin-only, validated, public, revertible“.
- Smoke-Test „timetable change is shown on Home and in the line-up“ (Demo).
- Live-E2E „organizer cancels an act: plan alert and struck-through row“.

## 5 · Veranstalter-Konsole — erledigt

- `/#admin`, nachgeladen nur dort (eigener Chunk). Anmeldung mit Admin-Token, geprüft über `GET /api/admin/session`, nur im `sessionStorage` des Tabs gehalten.
- Meldungen: Titel, Text, Ort, Stufe (Info/Warnung/Kritisch), Gültigkeit; Liste aktiver Meldungen mit Entfernen.
- Timetable: Tagesauswahl, Act wählen, Zeit direkt oder per ±5/15/30 Min. verschieben, Bühne wechseln, absagen, Hinweis; Validierung (Format, Ende nach Beginn, „Keine Änderung“) und Zurücksetzen.
- Ohne Backend zeigt die Konsole „Kein Server konfiguriert“ statt toter Knöpfe.

Dateien: `src/admin/Admin.tsx`, `src/main.tsx`, `src/api.ts` (`adminApi`), `src/styles.css`, `worker/src/index.ts`, `README.md`.

Nachweis:
- API-Test-Erweiterung: `GET /api/admin/session` → 401 mit falschem, 200 mit richtigem Token.
- Live-E2E „organizer console: login, announcement, timetable change reach the app“ – falsches Token wird abgelehnt; Meldung und Verschiebung (+30 Min.) erscheinen bei Lea; Zurücksetzen funktioniert.

## 6 · Barrierefreiheit — erledigt

- Neuer Test `npm run test:a11y` (axe-core, WCAG 2.1 A/AA + Best Practices) über 12 Ansichten: Home, Act-Sheet, Line-up (Liste, Filter, Timeline), Konflikt-Resolver, Karte, Ort-Sheet, Crew, Chat, Profil, Konsole. Läuft jetzt auch in CI.
- Erster Lauf: 13 schwerwiegende Befunde. Behoben an der Ursache:
  - Kontrast: `--text-3` von `#7d7c8a` auf `#9493a1` (≥ 4,5 : 1 auf allen Flächen, nachgerechnet).
  - Dialoge ohne Namen: jedes Sheet hat ein `aria-label`.
  - Verschachtelte Bedienelemente: Act-Zeile und Herz sind jetzt Geschwister-Buttons statt Button-im-Button.
  - Seitenüberschrift (`h1` in App-Bar und Konsole) und Landmark (`main`) für die Karte.
- Zweiter Lauf: 0 Befunde in allen 12 Ansichten (auch keine moderaten).

Dateien: `tests/a11y.mjs`, `package.json`, `.github/workflows/ci.yml`, `src/styles.css`, `src/ui.tsx`, `src/sheets.tsx`, `src/screens/Lineup.tsx`, `src/screens/MapScreen.tsx`, `src/App.tsx`, `src/admin/Admin.tsx`.

## Prüfläufe Runde 2

| Prüfung | Ergebnis |
| --- | --- |
| `npm run typecheck` (Web) · `cd worker && npm run typecheck` | ohne Fehler |
| `cd worker && npm test` | 19 API-Tests bestanden |
| `npm run build && npm run test:e2e` (Demo-Modus) | 9 Abläufe bestanden |
| `npm run test:a11y` | 12 Ansichten, 0 Befunde |
| `npm run test:live` (2 Nutzer + Veranstalter, echte API, lokale D1) | 13 Szenarien bestanden |

GitHub Actions auf PR #5 (Head `fd9d7be`): `web` (inkl. a11y), `api`, `live` grün.

# Loop

## 7 · Moderation im Crew-Chat — erledigt (Branch `claude/realm-moderation`)

- Migration `0004_moderation.sql`: `message_flags`, `crew_bans`, Soft-Delete (`deleted`, `updated_at`) für Nachrichten.
- Eigene Nachrichten löschen; die Gründerin/der Gründer der Crew löscht beliebige Nachrichten und entfernt Mitglieder (`DELETE /api/crews/:id/messages/:msgId`, `DELETE /api/crews/:id/members/:guestId`).
- Fremde Nachrichten melden (`POST …/messages/:msgId/flag`, einmal pro Person, nicht die eigene, Rate-Limit); ab 2 Meldungen ausgeblendet – nur die verfassende Person sieht ihren Text noch, mit Hinweis.
- Entfernte Mitglieder verlieren sofort den Zugriff (404), ihr Gerät meldet „Du bist nicht mehr Mitglied dieser Crew“, und der Einladungscode funktioniert für sie nicht mehr (403).
- Löschungen und Ausblendungen kommen auch über den inkrementellen `?since=`-Abruf an (`updated_at`), nicht erst beim Vollabgleich.
- UI: Tippen auf eine Nachricht zeigt „In Meetup umwandeln“, „Löschen“ (eigene bzw. als Gründer:in) und „Melden“; neues Sheet „Mitglieder“ mit Gründer:in-Kennzeichnung und „Entfernen“. Im Demo-Modus funktionieren Löschen und Melden lokal.

Dateien: `worker/migrations/0004_moderation.sql`, `worker/src/index.ts`, `worker/test/api.test.mjs`, `src/api.ts`, `src/data.ts`, `src/store.tsx`, `src/sheets.tsx` (`Chat`, `Members`), `src/screens/Crew.tsx`, `src/styles.css`, `tests/*.mjs`.

Nachweis:
- API-Test „moderation: delete own, flag others, owner deletes and removes“ (Rechte, Idempotenz, Ausblenden bei 2, inkrementelle Zustellung, Autor:in sieht eigenen Text, Rauswurf + Sperre).
- Smoke-Test (Demo): melden → ausgeblendet, eigene löschen → „Nachricht gelöscht“.
- Live-E2E „moderation: owner deletes a message, member reports one“ und „… the owner removes him“ (Rauswurf erreicht das Gerät, erneuter Beitritt abgelehnt).
- a11y: neue Ansichten „Crew-Chat · Nachrichtenaktionen“ und „Mitglieder“ ohne Befund.

| Prüfung | Ergebnis |
| --- | --- |
| Typecheck Web + Worker, Build | ohne Fehler |
| `cd worker && npm test` | 20 API-Tests bestanden |
| `npm run test:e2e` | 9 Abläufe bestanden |
| `npm run test:a11y` | 13 Ansichten, 0 Befunde |
| `npm run test:live` | 14 Szenarien bestanden |

GitHub Actions auf PR #6: grün, gemergt.

# Plattform (Produktvision „digitales Zuhause eines Festivals“)

Fahrplan, je Schritt ein PR: 1 Mandanten · 2 Festival anlegen + Import · 3 Branding · 4 Module · 5 FAQ + FAQ-Bot · 6 Karteneditor · 7 DE/EN · 8 Push · 9 Nutzungszahlen · 10 Kalender, Gruppenroute, Festival-Chat.

## P1 · Mandantenfähigkeit — erledigt (Branch `claude/realm-tenants`)

- Migration `0005_festivals.sql`: `festivals` (Status Entwurf/veröffentlicht/archiviert, Theme- und Modul-JSON), `festival_days`, `stages`, `acts`, `pois` mit Constraints und Indizes; `festival_id` auf Crews, Meldungen, Ankündigungen; Pläne, Schritte und Timetable-Änderungen mit Festival im Primärschlüssel neu aufgebaut. Altdaten werden dem ursprünglichen Festival `realm` zugeordnet.
- Migration `0006` (generiert aus `src/data.ts` per `worker/scripts/build-seed.mts`): Demo-Festival „Realm Open Air“ und ein zweites, „Nordlicht Sessions“, inklusive absichtlich kollidierender Act-ID `1-maduk`.
- Worker: Mandant aus `X-Festival`, serverseitig aufgelöst; Mitgliedschaft, Crews, Beitrittscodes, Pläne (nur bekannte Acts, Rest als `rejected`), Schritte, Standorte (nur eigene Bühnen), Meetups (nur eigene Acts), Meldungen, Votes, Ankündigungen und Timetable-Änderungen sind festivalgebunden. Entwürfe nur für Admins, Archiv schreibgeschützt.
- App: lädt das Festival vor dem ersten Rendern (Offline-Cache zuerst, frische Daten im Hintergrund), Festivalname, Daten und Ort aus den Festivaldaten, Zustand je Festival getrennt, Festivalwechsel im Profil; Fehlerbildschirm statt leerer App, wenn ein Festival weder online noch im Cache ist.
- Konsole: Festivalauswahl inkl. Entwürfen; Meldungen und Timetable wirken nur auf das gewählte Festival. CLI: `--festival`/`REALM_FESTIVAL`.

Durch die Tests gefundene und behobene Fehler:
- `ALTER TABLE … ADD COLUMN … REFERENCES` mit Standardwert scheitert in SQLite bei aktiven Fremdschlüsseln – fiel nur bei vorhandenen Daten auf (Migrationstest).
- Der API-Client wertete eine abgebrochene Antwort als leeren Erfolg `{}`; beim Offline-Neuladen wurde so ein leeres Festival gespeichert und die App startete nicht mehr. Jetzt: unlesbare Antwort = Netzwerkfehler, Festivaldokument wird vor Speichern und Laden geprüft.

Bekannte Grenze: Die Geländegrafik der Karte ist noch die des Demo-Festivals; eigene Geländepläne kommen mit dem Karteneditor (P6).

Dateien: `worker/migrations/0005_festivals.sql`, `worker/migrations/0006_seed_demo_festivals.sql`, `worker/scripts/build-seed.mts`, `worker/scripts/announce.mjs`, `worker/src/index.ts`, `worker/test/api.test.mjs`, `worker/test/migration.test.mjs`, `worker/package.json`, `src/festival.ts`, `src/main.tsx`, `src/api.ts`, `src/data.ts`, `src/store.tsx`, `src/sheets.tsx`, `src/admin/Admin.tsx`, `src/App.tsx`, `src/screens/Home.tsx`, `src/screens/Wrapped.tsx`, `src/screens/Lineup.tsx`, `tests/live.mjs`, `README.md`.

| Prüfung | Ergebnis |
| --- | --- |
| Typecheck Web + Worker, Build | ohne Fehler |
| `cd worker && npm test` | 23 API-Tests (neu: Festivals, Mandantentrennung, Entwurf/Archiv) + Migrationstest |
| `npm run test:e2e` (Demo) | 9 Abläufe bestanden |
| `npm run test:a11y` | 13 Ansichten, 0 Befunde |
| `npm run test:live` | 16 Szenarien (neu: Plan anlegen, Festivalwechsel mit getrennten Crews) |

GitHub Actions auf PR #7: `web`, `api`, `live` grün, gemergt.

## P2 · Festival anlegen und Import — erledigt (Branch `claude/realm-import`)

- Worker: Festival anlegen (Entwurf, Tage aus Startdatum mit Wochentagen), bearbeiten und Status setzen (Veröffentlichen nur mit Bühne und Act), Bühnen pflegen (belegte Bühnen nicht löschbar), Import mit `dryRun`, `merge`/`replace`, serverseitiger Neuvalidierung, Zeilennummern, Dubletten- und Überschneidungs-Warnungen, automatischen neuen Bühnen und stabilen IDs (`<Tag>-<Name>` oder eigene ID). Fehler blockieren den gesamten Import (422 mit Zeilenfehlern). `replace` legt vorher einen Snapshot an (Migration `0007`), der wiederherstellbar ist.
- Parser im Browser (`src/import/parse.ts`): JSON, CSV (`,` `;` Tab, Quotes, BOM), XLSX (nachgeladen), deutsche und englische Spalten, Tag als Nummer/Datum/Wochentag/Bezeichnung, Zeiten inkl. `24:30`, `01:30`, `22 Uhr`, Excel-Zeitzellen, kombinierte Zeitfenster, fehlendes Ende → 60 Min. mit Warnung.
- Konsole: „Neues Festival“, wiederaufnehmbarer Assistent (Grunddaten → Bühnen → Timetable → Prüfen & veröffentlichen), Tabs Import, Bühnen, Status (veröffentlichen, archivieren, reaktivieren, zurück auf Entwurf), Vorschau von Entwürfen in der App mit Banner. Admin-Lesezugriffe nutzen jetzt das Admin-Token (vorher scheiterten Meldungen/Änderungen bei Entwürfen).
- Doku für Veranstalter: `docs/IMPORT.md`.

Beim Testen gefunden und behoben: nach dem Veröffentlichen blieb der Assistent ohne markierten Tab stehen – die Konsole wechselt jetzt in die Status-Ansicht.

| Prüfung | Ergebnis |
| --- | --- |
| Typecheck Web + Worker, Build | ohne Fehler |
| `npm run test:import` | 8 Parser-Tests (CSV DE/EN, JSON, XLSX, Nachtzeiten, Zeilenfehler) |
| `cd worker && npm test` | 24 API-Tests (neu: Einrichtung + Import inkl. Favoriten-Erhalt, Snapshot, Archiv) + Migrationstest (7 Migrationen) |
| `npm run test:e2e` · `npm run test:a11y` | 9 Abläufe · 13 Ansichten ohne Befund |
| `npm run test:live` | 17 Szenarien (neu: Festival per Assistent anlegen, XLSX mit Zeilenfehler, Vorschau, Veröffentlichen, Besucher sieht Nachtset am Freitag) |

GitHub Actions auf PR #8: `web`, `api`, `live` grün, gemergt.

## P3 · Branding — erledigt (Branch `claude/realm-branding`)

- `src/theme/contrast.ts`: WCAG-Kontrast, automatische Textfarbe auf der Markenfarbe, abgeleitete CSS-Variablen; dieselbe Datei prüft in Konsole und Worker.
- Worker: `PUT /api/admin/festivals/:slug/theme` – Farbe muss alle Kontrastprüfungen bestehen (Text auf Buttons 4,5:1, Farbe als Text auf dem Hintergrund 4,5:1, auf Karten 3:1), Schrift aus fester Liste, Logo nur als PNG/WebP/JPEG/SVG-Data-URL bis ca. 150 kB (keine externen URLs).
- App: Farbe, Schrift und Logo werden beim Laden des Festivals gesetzt; Hero-Verlauf, Hover, Toast und Wrapped folgen der Markenfarbe statt fester Violett-Werte. Ohne Logo zeigt die App-Leiste den Anfangsbuchstaben des Festivals.
- Konsole: Tab „Branding“ mit Voreinstellungen, Farbwähler, Hex-Feld, Kontrastliste, Schriftwahl, Logo-Upload (Rasterbilder auf 256 px verkleinert) und Live-Vorschau.

Dateien: `src/theme/contrast.ts`, `src/theme/apply.ts`, `src/admin/Branding.tsx`, `src/admin/Admin.tsx`, `src/api.ts`, `src/festival.ts`, `src/data.ts`, `src/App.tsx`, `src/styles.css`, `src/screens/Wrapped.tsx`, `worker/src/index.ts`, `worker/test/api.test.mjs`, `tests/theme.test.mts`, `tests/live.mjs`, `package.json`, `README.md`.

| Prüfung | Ergebnis |
| --- | --- |
| Typecheck Web + Worker, Build | ohne Fehler |
| `npm run test:import` | 8 Parser- + 9 Kontrast-Prüfungen |
| `cd worker && npm test` | 25 API-Tests (neu: Branding-Validierung) + Migrationstest |
| `npm run test:e2e` · `npm run test:a11y` | 9 Abläufe · 13 Ansichten ohne Befund |
| `npm run test:live` | 17 Szenarien; der Festival-Ablauf prüft jetzt auch: unlesbare Farbe nicht speicherbar, Farbe/Schrift/Logo erreichen die Besucher-App |

GitHub Actions auf PR #9: `web`, `api`, `live` grün, gemergt.

## P4 · Module — erledigt (Branch `claude/realm-modules`)

- `src/modules.ts`: zentrale Liste (Crew & Freunde, Crew-Chat, Standort, Step-Challenge, Community-Meldungen, Rückblick) mit Abhängigkeiten; standardmäßig alles an, gespeichert werden nur ausgeschaltete Module.
- Worker: `PUT /api/admin/festivals/:slug/modules` (unbekannte Module und widersprüchliche Abhängigkeiten → 400); die Mandanten-Middleware weist Routen ausgeschalteter Module mit 403 ab (Crews, Meetups, Chat, Standort, Schritte, Meldungen); der Crew-Snapshot liefert ohne Chat/Standort/Schritte keine entsprechenden Daten.
- App: Crew-Tab, Meetup- und Crew-Module auf Home, „Crew einladen“, „Vor diesem Set treffen“, „Hier treffen“, „Problem melden“, Abstimmen bei Meldungen, Freunde- und Meldungs-Ebene der Karte, Chat-/Standort-/Schritte-Zeilen und der Rückblick erscheinen nur bei aktivem Modul; Polling fragt ausgeschaltete Module nicht ab.
- Konsole: Tab „Module“ mit Schaltern; Abschalten nimmt abhängige Module mit, Einschalten ihre Voraussetzungen.

Beim Testen gefunden und behoben: Die gemeinsame `Switch`-Komponente war ein `<button>` ohne `type` und schickte in Formularen das Formular schon beim Umschalten ab.

| Prüfung | Ergebnis |
| --- | --- |
| Typecheck Web + Worker, Build | ohne Fehler |
| `npm run test:import` | 8 Parser- + 9 Kontrast- + 7 Modul-Prüfungen |
| `cd worker && npm test` | 26 API-Tests (neu: Module, Abhängigkeiten, Auswirkung auf Snapshot) + Migrationstest |
| `npm run test:e2e` · `npm run test:a11y` | 9 Abläufe · 13 Ansichten ohne Befund |
| `npm run test:live` | 17 Szenarien; der Festival-Ablauf schaltet jetzt „Crew & Freunde“ ab: Crew-Tab verschwindet beim Besucher, API lehnt ab |

GitHub Actions auf PR #10: `web`, `api`, `live` grün, gemergt.

## P5 · FAQ und FAQ-Bot — erledigt (Branch `claude/realm-faq`)

- Migration `0008_faq.sql` (FAQ je Festival mit Quelle, Stand, Status Entwurf/Freigegeben; Demo-FAQ generiert aus `DEMO_FAQ` per `worker/scripts/build-faq-seed.mts`).
- Worker: freigegebene FAQ im Festivaldokument (nur bei aktivem Modul), Admin-Routen zum Lesen, Anlegen/Ändern, Löschen; Entwürfe bleiben privat.
- Bot `src/faq/match.ts`: lokale Suche (Synonyme DE/EN, Umlaute, Wortstämme, Gewichtung Frage/Stichworte/Kategorie, Abdeckung), Antwort nur über einer Schwelle **und** mit Treffer in Frage/Stichworten/Kategorie; sonst Vorschläge oder ehrliches „keine freigegebene Antwort“ mit Verweis aufs Info-Zelt. Erzeugt nie eigenen Text.
- App: „Infos & FAQ“ (Fragezeichen in der App-Leiste) mit Bot, Suche, Kategorien und aufklappbaren Antworten, jeweils mit Quelle und Stand; offline nutzbar.
- Konsole: Tab „FAQ“ mit Liste, Editor, Freigabe und Bot-Testfeld. Neue Module „FAQ & Infos“ und „FAQ-Bot“.
- Nebenbei: `allowImportingTsExtensions`, damit `src/data.ts` auch von Node-Skripten (Seeds, Unit-Tests) geladen werden kann – der Import von `./modules` aus P4 hatte das Seed-Skript gebrochen.

Beim Testen gefunden und behoben: „Wer ist der Headliner am Samstag?“ bekam die Einlass-Antwort, weil „Samstag“ im Antworttext steht – jetzt zählt ein Treffer nur im Antworttext höchstens als Vorschlag.

| Prüfung | Ergebnis |
| --- | --- |
| Typecheck Web + Worker, Build | ohne Fehler |
| Unit-Tests (`npm run test:import`) | 8 Parser, 9 Kontrast, 7 Module, 19 FAQ-Bot (14 Fragen richtig beantwortet, 3 unbekannte ehrlich abgelehnt) |
| `cd worker && npm test` | 27 API-Tests (neu: FAQ-Entwurf/Freigabe/Modul) + Migrationstest (8 Migrationen) |
| `npm run test:e2e` · `npm run test:a11y` | 10 Abläufe (neu: Bot) · 14 Ansichten ohne Befund (neu: FAQ mit Bot-Antwort) |
| `npm run test:live` | 17 Szenarien; Festival-Ablauf: FAQ-Entwurf unsichtbar, nach Freigabe beantwortet der Bot die Frage – auch offline |

## Nächste Schritte

1. Bundle unter 500 kB (Karte, Wrapped, Sheets nachladen) – der Build warnt.
2. P6: Karteneditor (eigener Geländeplan, Marker mit relativen Koordinaten).
3. P7: Sprachen DE/EN.

## Runde: App-Paket & echtes Offline (claude/realm-bundle)
- Startpaket von 521 kB (gzip 165) auf 300 kB Haupt-Chunk (gzip 92) gesenkt: framer-motion über `LazyMotion` + nachgeladene `domMax`-Features, Karte/Crew/Wrapped/FAQ als Lazy-Chunks. Keine >500-kB-Warnung mehr.
- Echter Fehler gefunden: Der Service Worker cachte nur `/` – die App war nach einem Besuch **nicht** offline nutzbar. Jetzt: Build-Manifest `sw-assets.json` (Vite-Plugin), vollständiges Precaching, `ignoreVary` (Assets mit `Vary: Origin`).
- `LazyBoundary`: ein fehlgeschlagener Chunk-Load zeigt „Erneut versuchen“ statt die App abstürzen zu lassen.
- Smoke-Test prüft Offline jetzt ehrlich (Server wird beendet, da `setOffline` Service-Worker-Fetches nicht abdeckt).
- Geprüft: typecheck, test:import, build, test:e2e, test:a11y, test:live – alles grün.

## Runde: Karteneditor (Schritt 6, claude/realm-map-editor)
- Konsole → „Karte“: eigenen Geländeplan hochladen (PNG/JPEG/WebP, wird auf 1600 px skaliert und als JPEG gespeichert, max. ~650 kB), Bühnen und Punkte per Drag & Drop verschieben, neue Punkte per Klick setzen, Name/Kategorie/Status/Beschreibung/„wichtig“ bearbeiten, löschen. Tastatur: Pfeiltasten verschieben (Shift = große Schritte).
- API `PUT /api/admin/festivals/:slug/map` (validiert Koordinaten 0–1000 × 0–940, Kategorien, max. 300 Punkte); Migration 0009 (`festivals.site_map`).
- Behoben: Bühnen neuer Festivals fehlten auf der Karte, weil Bühnen-Pins nur aus der Seed-Tabelle kamen. Bühnen-Pins werden jetzt aus den Bühnen selbst erzeugt (eine Quelle für Positionen).
- Besucher-Karte zeigt den hochgeladenen Plan (Satelliten-Ebene entfällt dann).
- Geprüft: typecheck, Worker-API (28 Tests inkl. neuem Karten-Test), Migrationstest, test:import, e2e, a11y, live (neuer Schritt: Plan hochladen, Punkt per Klick setzen, mit Tastatur verschieben, Besucher findet ihn in der Kartensuche).

## Runde: Deutsch/Englisch (Schritt 7, claude/realm-i18n)
- Besucher-App komplett zweisprachig: 467 UI-Texte über `t('Deutscher Text')` (`src/i18n/`); Sprache folgt dem Browser, lässt sich im Profil umschalten und wird gemerkt; `<html lang>` passt sich an.
- Wochentage aus dem Datum in der jeweiligen Sprache, Daten/Zahlen über `Intl` (`locale()`, `num()`, `formatRange`).
- Festival-Inhalte (Acts, FAQ, Meldungen) bleiben wie vom Veranstalter geschrieben; Fehlermeldungen des Servers und die Veranstalter-Konsole sind noch deutsch.
- Wächter-Test `tests/i18n.test.mts`: jeder `t()`-Text hat eine englische Übersetzung mit denselben Platzhaltern, keine verwaisten Einträge, keine Template-Strings.
- Nebenbei behoben: Tagesumschalter zeigte den Monat fest als „.07.“; Wrapped behauptete immer „Drei Tage. Fünf Stages.“ und „3 Tage“ – jetzt aus den echten Festivaldaten.
- Tests laufen jetzt explizit mit `locale: 'de-DE'` (Playwright-Standard ist Englisch); neuer Smoke-Schritt prüft die englische App und den Sprachwechsel.
- Geprüft: typecheck, test:import (inkl. i18n), build, e2e, a11y, live.

## Runde: Auswertung für Veranstalter (Schritt 9, claude/realm-analytics)
- Konsole → „Auswertung“: Kennzahlen (Profile mit Plan, Crews, Personen in Crews, Chat, Meetups, Step-Challenge), meistgeplante Acts, Heatmap „Erwarteter Andrang“ (Bühne × Stunde, je Tag), FAQ-Bot: Fragen ohne Antwort (mit „Erledigt“) und häufig genutzte Antworten.
- Datenschutz: nur Summen; jede Gruppe unter 3 wird serverseitig zurückgehalten (auch Freitextfragen – erst wenn 3 Personen dieselbe Frage stellen). FAQ-Bot-Ereignisse sind anonym (keine Gast-ID), werden nach 365 Tagen gelöscht und hängen am Modul „FAQ-Bot“.
- API: `POST /api/faq/events`, `GET /api/admin/festivals/:slug/analytics`, `DELETE …/analytics/faq-misses`; Migration 0010.
- Grenze: Planzahlen kennt der Server nur von Besucher:innen mit Server-Profil (entsteht beim ersten sozialen Feature) – in der Konsole so beschrieben.
- Geprüft: Worker-API (29 inkl. neuem Auswertungstest), Migration, test:import, e2e, a11y, live (neuer Schritt: 3 Planungen + 3 Bot-Lücken erscheinen, „Erledigt“ entfernt die Frage).
- Ablauf ab jetzt: eigene PRs werden nach grüner CI selbst gemergt (Absprache vom 20.10.).
## Runde: Mein Tag & Kalender-Export (Schritt 10a, claude/realm-agenda)
- „Mein Plan“ zeigt zwischen zwei Sets die freie Zeit und den Laufweg zur nächsten Stage; reicht die Zeit nicht für den Weg, wird es als „Knapp“ markiert.
- Kalender-Export (.ics): ganzer Plan („Plan in den Kalender“) oder einzelner Act (Act-Sheet); Erinnerung 15 Min. vorher, stabile UIDs (erneuter Import aktualisiert statt zu verdoppeln), Sets nach Mitternacht am richtigen Datum, RFC-5545-Escaping und Zeilenumbruch.
- Tests: `tests/ics.test.mts` (14 Prüfungen), Smoke-Schritt lädt die Datei wirklich herunter und prüft sie; i18n-Wächter fing die neuen Texte ab (474 Texte).

## Runde: Fairer Treffpunkt / Gruppenroute (Schritt 10b, claude/realm-group-route)
- Crew → unter „Wo ist meine Crew?“: Vorschlag „Fairer Treffpunkt für alle“ – der offene Ort (Stage, Bar, Food, Info, Wasser, Eingang), an dem der längste Weg aller Crew-Mitglieder mit geteiltem Standort am kürzesten ist (Minimax, bei Gleichstand kleinste Gesamtstrecke). Direkt „Route“ oder „Hier treffen“ (Meetup).
- `src/meet.ts` rein und getestet (`tests/meet.test.mts`, 7 Prüfungen); Smoke-Schritt folgt der Route bis zum Banner.
## Runde: Festival-Chat (Schritt 10c, claude/realm-festival-chat)
- Neues Opt-in-Modul „Festival-Chat“: öffentlicher Chat für alle Besucher eines Festivals, standardmäßig **aus**. Modul-Register kennt jetzt Opt-in-Module (`off: true`); gespeichert wird jede Abweichung vom Standard (vorher nur „aus“ – ein eingeschaltetes Opt-in-Modul wäre verloren gegangen).
- Moderation: Name nötig zum Schreiben, 300 Zeichen, 10 Nachrichten/Min.; 3 Meldungen blenden aus (Autor sieht weiter); Konsole „Chat-Moderation“ (nur wenn Modul an): ausgeblendete zuerst, Wiederherstellen oder Löschen. Nachrichten verfallen 30 Tage nach der letzten Änderung.
- App: Einstieg auf Home und im Crew-Bereich, eigenes nachladbares Sheet mit inkrementellem Polling (8 s).
- Nebenbei: Namensdialog fragte immer „Wie soll deine Crew dich nennen?“ – jetzt neutral „Wie sollen dich andere nennen?“.
- Geprüft: Worker-API (30, neuer Chat-Test inkl. Mandantentrennung), Modul-Tests (11), i18n (486), e2e, a11y, live (neuer Schritt: einschalten → schreiben mit Namensabfrage → Spam per Polling → 3 Meldungen → ausgeblendet → Veranstalter löscht).

## Runde: Englische Veranstalter-Inhalte (claude/realm-content-en)
- FAQ und Meldungen haben eine optionale englische Fassung (Konsole: „Englische Fassung (optional)“). Englische Besucher:innen sehen sie, sonst die deutsche; der FAQ-Bot versteht dann englische Fragen (deutsche Stichworte bleiben zusätzlich durchsuchbar).
- API: `en`-Objekt in FAQ (`en: { question, answer, keywords }`) und Meldungen (`titleEn`, `bodyEn` → `en: { title, body }`); halbe Fassungen (Frage ohne Antwort) werden abgelehnt – auch schon in der Konsole. Migration 0012.
- Grenze: Kategorie-Namen, Act-Bios und Ortsnamen bleiben wie eingegeben.
- Geprüft: Worker-API (neuer Test), Migration, test:import, e2e, a11y, live (neuer Schritt: englische Fassung pflegen → englischer Besucher sieht FAQ und Meldung auf Englisch, Bot beantwortet englische Frage).
## Prüfbericht-Behebung · Welle 0 (claude/realm-fix-wave0)
- F07 Chat-Absturz in neuen Chrome-Versionen (Crew- und Festival-Chat), D07 Fokus im Dialog + Schließen-Knopf, D06 Lesbarkeit vergangener Acts, D08 Line-up auf 320 px. Jeder Fix mit einem Test, der am alten Stand nachweislich anschlägt; Übersicht in `docs/AUDIT.md`.
- Tests: Browser-Setup zentral (`tests/browser.mjs`, `BROWSER=chromium|firefox|webkit`), CI-Job `browsers` für Firefox und WebKit.

## Prüfbericht-Behebung · Welle 1 (claude/realm-fix-wave1)
- F02, F03, F10, F13, D04 und feste Schrittwerte – Details und Tests in `docs/AUDIT.md`. Neue Migration nicht nötig; Server: `isPrivacyAction`, Standort-TTL 2 h (+ Cron), Modul-/Archiv-Abschaltung beendet Freigaben.

## Prüfbericht-Behebung · Welle 2 (claude/realm-fix-wave2)
- F04/D02 ehrliche Navigation, D01 keine Demo-Inhalte im Live-Modus + Demo-Kennzeichen, D03 Warnungen in jeder Phase oben. Details in `docs/AUDIT.md`. Nebenbei gefunden und behoben: nach der Standortwahl startete die angeforderte Richtung nicht (Karte kannte den Ort noch nicht).

## Runde: Karte auf 320 px (Prüfbericht D08, Branch `ccr-c4b0523e-ltc4vo`, 20.10.)
- Auf 320 px überdeckten sich Marker (Generator × Wasserstelle Nord, Meldungs-Pins auf ihren Orten), Stage-Namen liefen aus dem Bild oder unter die Kartenknöpfe, Meldungs-Pins waren 22 px klein.
- Jetzt: `src/screens/mapLabels.ts` entscheidet je Ansicht, welche Stages ihren Namen zeigen (frei von Nachbarn, Bildrand und Bedienelementen; ausgewählte zuerst, sonst von links – kein Flackern beim Verschieben). Meldungen als Warn-Badge am Ort, Knopfname „<Ort> – Meldung: <Titel>“. Marker-Tippfläche 44 px. Eigene Pins dürfen weiter überall liegen (bewusst gesetzt).
- Verworfen: Startausschnitt in den freien Bereich (unter Suche, links der Knöpfe) zu zentrieren – auf 320 px schnitt das links mehr ab als vorher.
- Geprüft: typecheck (Web + Worker), build, test:import (inkl. 9 neuer Kartenbeschriftungs-Prüfungen), test:e2e (neuer 320-px-Kartenschritt; am alten Stand nachweislich rot), test:a11y (0 Befunde), Worker-API (33), test:live (alle Szenarien). Firefox/WebKit lokal nicht installiert → nur CI-Job `browsers`.

## Nächste Schritte (Stand 20.10.)
1. Übrige Befunde F01, F05, F06, F08, F09, F11, F12, F14–F17, D05, D09, D10 aus den Prüfberichten vom 20.10. – **Blocker:** Die Berichte liegen nicht im Repo (nur ihre IDs in `docs/AUDIT.md`), Google Drive findet sie nicht. Bitte als `docs/audit-source.md` o. ä. ablegen, sonst kann ein Durchlauf sie nicht bearbeiten.
2. Unabhängig davon möglich: Plattform-Schritt 8 Push (braucht VAPID-Schlüssel + Deployment → blockiert) – stattdessen lokal planbare Erinnerungen vor geplanten Acts (Notification API ohne Server) prüfen.
3. Karte: Namen kompakter Stages per Langdruck/Fokus als Tooltip zeigen (heute nur über Antippen → Ort-Sheet).
