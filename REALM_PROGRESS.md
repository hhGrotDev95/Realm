# Realm – Fortschritt

Letzter dokumentierter Stand: 16.11.2026. Aktuelle Übergaben stehen am Ende; ältere Abschnitte beschreiben den damaligen Stand.

**Aktuelle Entscheidung (31.10.2026): Realm bleibt die Basis; seine iPhone-Integration und Geräteprüfung werden fortgesetzt. Nur das separate V2 bleibt pausiert. Vorhandene Änderungen erhalten. Maßgeblicher Ablauf: [Realm-iPhone-Integration](docs/IPHONE_INTEGRATION.md); Basisentscheidung: [Architekturvergleich](docs/ARCHITECTURE_OPTIONS.md).**

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

## Prüfbericht-Behebung · Welle 3 (claude/realm-fix-wave3)
- F05 Beitrittsfreigabe + Code-Erneuerung beim Entfernen, F09 Übergabe der Verantwortung, F11 Festival im Einladungslink, F06 ehrliche Zählung von Community-Meldungen + Freigabe durch Veranstalter, D05 Soforthilfe im Meldeformular. Migration `0013_crew_safety.sql`. Details in `docs/AUDIT.md`.
- Die API-Tests geben späteren Gästen eigene Test-IPs (seit Welle 4 nur noch Komfort).

## Prüfbericht-Behebung · Welle 4 (claude/realm-fix-wave4)
- F08 Anmeldung hinter Festival-WLAN (Proof of Work statt Sperre), F17 Timeouts, adaptives Polling, Kapazitätsziel + lokales Lastskript (`docs/CAPACITY.md`). Migration `0014_signup_challenges.sql`. Staging-Lasttest bleibt offen bis zum Deployment.

## Prüfbericht-Behebung · Welle 5a (claude/realm-fix-wave5)
- F01 Veranstalter-Konten: Einladung, Passwort, TOTP-Pflicht, Sitzungen, Festival-Bindung, Änderungsprotokoll; Konsolen-Tab „Zugang“. Migration `0015_admin_accounts.sql`.
- Erstes Konto: mit dem Plattform-Schlüssel anmelden („Plattform-Schlüssel verwenden“) → Tab „Zugang“ → sich selbst einladen. Danach den Schlüssel nur noch für CLI/Notfall nutzen.

## Prüfbericht-Behebung · Welle 5b (claude/realm-fix-wave5b)
- D10 Freigabe-Checkliste (Server + Konsole), D09 kompakte Konsolen-Navigation ≤ 720 px. Migration `0016_demo_medical.sql`.

## Prüfbericht-Behebung · Welle 6a (claude/realm-fix-wave6)
- F14 Schriften lokal (keine Google-Verbindung mehr), F16 vollständige Snapshots inkl. Live-Änderungen und Bühnenattributen.
- Welle 6b: F12 Löschfristen (Cron + `docs/DATA_RETENTION.md`), Profillöschung über alle Festivals. Migration `0017_guest_activity.sql`.
- Welle 6c: F15 Zeitmodell (Festival-Zeitzone, einheitliche Nachtgrenze 06:00) und Erinnerungen über alle Tage; Konsole: Zeitzone unter „Status“. Migration `0018_festival_timezone.sql`.
- Nacharbeit zu PR #32: Erinnerungs-Glocke mit `aria-pressed`; der Smoke-Test prüft den dauerhaften Zustand statt einer kurzlebigen Toast-Bestätigung. Der erste Folge-Head `3c021217` blieb in Firefox rot; erst der zusätzliche Ausgangszustands-Check (`9ed41053`) bestand CI. Eine eindeutige Ursache des flüchtigen Firefox-Verhaltens ist nicht abschließend bewiesen. Lokal: Unit-Tests, Build, Smoke und a11y mit Chrome bestanden. Vollständige CI wird vor dem Merge erneut geprüft.
- Nachtrag D08: Kartenübersicht auf 320 px (offener Teil aus Welle 0).
- **Welle 7a – Abschlussprüfung (20.10.2026):** vorhandenen WIP-Stand mit D08 und #32 zusammengeführt. Der Festival-Chat benutzt bereits `name(visitor, 'Uma')`; der gemeinsame Helfer prüft jetzt zusätzlich, dass „Weiter“ vor der Altersbestätigung gesperrt ist. Lokal bestanden: Import/Unit, Build, Smoke, a11y, vollständiger Live-Test sowie 41 API-Tests und Migrationstest mit 19 Migrationen. Finale Rechtstexte und Betreiberentscheidungen bleiben offen; technische Bereitstellung ist keine rechtliche Freigabe.

- PR #32 gemergt (`cfea513`, CI `39402205182` grün); D08 als PR #33 gemergt (`d40a6fc`, CI `39403712434` grün auf Head `6fb071b`). D08 enthält zusätzlich einen Schutz für leere Markerlisten.

## Prüfbericht-Behebung · Welle 7b
- Meldegründe für Crew-/Festival-Chat und Community-Inhalte; Veranstalter sehen nur gemeldete Crew-Inhalte. Entscheidung mit Pflichtbegründung, atomarem Änderungsprotokoll und privaten Autorenhinweisen im Chat/Profil. Migration `0020_moderation.sql`.
- Review-Korrekturen: kein Wiederbeleben entfernter Lage-Meldungen durch Bestätigungen; gebündelte D1-Abfragen statt N+1; erstmalige Meldung über die Identitätsabfrage; Umbruch langer Begründungen; neue Meldungen öffnen Prüfstatus erneut.
- PR #35 gemergt (`017d824f`): CI `39712702847` auf Head `d0cb8d30` mit web, api, live, Firefox und WebKit vollständig grün. Lokal: Import/Unit, Build, Smoke, 42 API-Tests/20 Migrationen und 17 a11y-Ansichten bestanden; intermittierende lokale Live-Zeitüberschreitungen werden in Welle 8 mit angeglichener Laufzeit weiter geprüft. Keine Tests deaktiviert. Rechtliche und betriebliche Voraussetzungen bleiben offen; siehe `docs/MODERATION.md`.
- CI verwendet explizit Ubuntu 24.04: Der Wechsel von `ubuntu-latest` auf Ubuntu 26.04 verhinderte die Browserinstallation mit Playwright 1.56.1. Melde- und Festival-Auswahlselektoren präzisiert; der Test einer ersten benannten Meldung benutzt den vorhandenen Vertrag einer namenlosen Gastsitzung.

## Prüfbericht-Behebung · Welle 7c
- `docs/DEVICE_STORAGE.md` inventarisiert tatsächliche Browser-Schlüssel, Inhalte, Auslöser, Löschmöglichkeiten und offene Erforderlichkeits-/Einwilligungsentscheidungen nach § 25 TDDDG. Eine Dokumentation erteilt keine rechtliche Freigabe.
- `scripts/licenses.mjs` erzeugt `docs/LICENSES.md` aus beiden installierten Abhängigkeitsbäumen und den Lockfiles; Scoped Packages, verschachtelte und fehlende optionale Pakete sind erfasst. Lokal: 88 installierte Paketwurzeln, 117 nur im Lockfile; `node scripts/licenses.mjs --check` bestanden. Mitlieferung von Lizenztexten und Rechte an Festivalinhalten bleiben gesondert zu prüfen.
- Der bei der Speicherinventur gefundene Same-Origin-API-Cache wird in Welle 8 korrigiert und separat getestet.
- Nachtrag aus der erneuten CI-Abnahme: Beim Wechsel von Festival- zu Crew-Moderation konnte eine alte Antwort die neue Liste samt Entscheidungsformular überschreiben. Request-Zähler und Cleanup ignorieren überholte Ergebnisse/Fehler; der Live-Test liefert die alte Festival-Antwort gezielt nach dem bereits bearbeiteten Crew-Formular aus.

## Welle 8a · Service-Worker-Cache nur für die App (23.10.2026, Branch `ccr-c4b0523e-z6874b`)
- Befund aus Welle 7c behoben: `public/sw.js` cachte jede erfolgreiche gleiche-Origin-GET-Antwort – bei einer API unter derselben Origin also Sitzungen, Crew-Chat usw. ohne Ablauf im Cache Storage.
- Jetzt Positivliste: nur `/`, `/assets/*`, `icon.svg`, `manifest.webmanifest`. `/api/…` (auch als Navigation) und alle anderen Pfade gehen ungecacht ans Netz. Die Offline-Shell wird nur durch eine erfolgreiche HTML-Antwort ersetzt (kein 503/JSON mehr als Startseite). Cache-Schreiben über `waitUntil`, Antwort wird nicht verzögert.
- Update-Bereinigung: Da der Cache-Name nur von den Build-Dateien abhängt, bleibt er bei reiner sw.js-Änderung gleich – die Aktivierung löscht deshalb zusätzlich alle Nicht-App-Einträge im behaltenen Cache und `realm-runtime`.
- Test `tests/sw.test.mts` (15 Prüfungen, in `test:import`): führt sw.js gegen einen nachgebildeten Cache Storage aus; am alten Stand schlägt er an („same-origin API requests bypass the worker“).
- CI (PR #37): `browsers (firefox)` scheiterte in einem von zwei Läufen desselben Commits am Erinnerungs-Schritt („reminders shown: []“). Ursache im Test: Die Erinnerung wartet nach dem Vorspulen der Uhr auf `getRegistration()` in Echtzeit, der Test nur fest 300 ms. Jetzt wartet er bis 5 s auf das Ergebnis (danach weiter 300 ms für eine fälschlich zweite Erinnerung). Firefox lokal nicht installiert – nur CI prüft das.
- CI `live` (gleicher PR): „crew tab still visible“ – die App zeigt nach dem Neuladen zuerst die Offline-Kopie des Festivals (`realm.bundle:*`) und erst danach die frische mit abgeschaltetem Modul; der Test prüfte sofort. Jetzt wartet er bis 10 s auf das Verschwinden (erster konkreter Fund für Welle 8b). Lokal: `npm run test:live` vollständig grün.
- Geprüft: typecheck, test:import (alle), build, test:e2e inkl. echtem Offline-Schritt (Server aus, App und Lazy-Screens laden) – grün. test:live/a11y/API nicht erneut gelaufen (sw.js wird nur im Produktions-Build registriert; Live-Test nutzt den Dev-Server).

## Welle 8b · Live-Test-Laufzeiten und Plan-Sync (24.10.2026, Branch `ccr-c4b0523e-64s280`)
- Zeitüberschreitungen untersucht: `tests/live.mjs` misst jetzt jeden Schritt (`✓ … (12.3 s)`, bei Fehler `✗ … (s)`) und nennt am Ende die fünf langsamsten. 3 Läufe hintereinander lokal grün, keine Zeitüberschreitung reproduzierbar; die Laufzeiten sind stabil (größter Posten 57 s Backoff-Messung, 41 s Festival-Assistent). Ursache aus Welle 7b damit lokal nicht nachweisbar – die Zeiten in künftigen CI-Logs zeigen, welcher Schritt hängt.
- Testskript: Wrangler und Vite liefen weiter, wenn Migration oder Browserstart scheiterten (Aufräumen nur im `finally` nach dem Browserstart). Jetzt `process.on('exit')`.
- **Fehler 1 (Plan-Sync):** Scheiterte der Plan-Upload (Funkloch, überlastetes WLAN), wurde er erst bei der nächsten Planänderung oder beim Neustart wiederholt – Crew-Avatare, Auswertung und eine Wiederherstellung sahen bis dahin einen alten Plan. Jetzt: Wiederholung mit Backoff (15 s → 2 min) bei Netz-/5xx-Fehlern und sofort, wenn das Netz zurückkommt; offline wird kein Upload versucht.
- **Fehler 2 (Wiederherstellung):** „Profil mit Code wiederherstellen“ setzte zuerst die Sitzung und lud dann `/api/me`. Dauerte das länger als 800 ms, lud das neue Gerät seinen (meist leeren) Plan hoch und überschrieb den gespeicherten Plan. Jetzt wird das Profil vor dem Sitzungswechsel gelesen; scheitert das, bleibt das bisherige Token aktiv.
- Neue Live-Schritte: „a plan change whose upload fails is retried without another edit“ und im Wiederherstellungsschritt verzögertes `/api/me` (2 s) mit Prüfung des Server-Plans. Beide schlagen am alten Stand an (`plan never reached the server (1 upload attempts)` bzw. `restore overwrote the saved plan: []`).
- Lokale Umgebung: Playwright findet den vorinstallierten Browser nur mit `CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Geprüft: typecheck Web + Worker, test:import, build, test:e2e, test:a11y, test:live (vollständig grün). Worker-API-Tests nicht gelaufen (kein Worker-Code geändert).

## Welle 8c · Lokaler Zustand übersteht zweiten Tab, Schäden und vollen Speicher (25.10.2026, Branch `ccr-c4b0523e-lwdrrd`)
- **Fehler 1 (zwei Tabs):** Jeder Tab schrieb seinen gesamten Zustand bei jeder Änderung. Ein zweiter offener Tab (z. B. installierte App und Browser) überschrieb dadurch Planänderungen des ersten. Nachgestellt: Herz in Tab A, Herz in Tab B, gespeichert sind 17 statt 18 Acts. Jetzt übernimmt jeder Tab die Änderungen des anderen über das `storage`-Ereignis, inklusive Sitzungstoken. Eine Profillöschung in einem Tab wird so nicht mehr vom anderen rückgängig gemacht.
- **Fehler 2 (beschädigter Zustand):** Der Start übernahm den gespeicherten Zustand ungeprüft (`{...state, ...JSON.parse(raw)}`). Ein einziges Feld mit falschem Typ (z. B. `reminders: null` aus einer älteren Version) brachte die App beim Start zum Absturz („Cannot convert undefined or null to object“, leerer Bildschirm). Jetzt prüft `restore()` jedes Feld einzeln: Falsche Typen fallen auf den Standardwert zurück, alles andere bleibt erhalten, auch Plan und Sitzung.
- **Fehler 3 (voller Speicher):** Schlug das Speichern fehl (QuotaExceeded, z. B. durch mehrere Festival-Kopien mit Geländeplan bis ~650 kB, oder gesperrte Websitedaten), wurde das stillschweigend ignoriert, und Änderungen fehlten beim nächsten Start. Jetzt geht die App in Stufen vor: Zuerst werden Offline-Kopien **anderer** Festivals entfernt, dann wird ohne ältere Chat-Nachrichten und Community-Meldungen gespeichert (beides lädt der Server erneut). Klappt beides nicht, erscheint einmal ein Hinweis, dass Änderungen beim Schließen verloren gehen.
- Dateien: `src/persist.ts` (neu, rein), `src/store.tsx`, `src/i18n/en-core.ts`, `tests/persist.test.mts` (11 Prüfungen, in `test:import`), `tests/smoke.mjs` (neuer Schritt), `docs/DEVICE_STORAGE.md`.
- Gegenprobe am alten Stand: Der neue Smoke-Schritt scheitert mit „the other tab overwrote a plan change: 16 → 17“. Ein Skript mit beschädigtem Feld zeigt den Absturz (Seitenfehler, Home erscheint nicht); mit der Korrektur startet die App.
- Geprüft (lokal, Chromium): typecheck, test:import (alle, inkl. 11 neuer Prüfungen), build, test:e2e (18 Schritte), test:a11y (keine Befunde), test:live (vollständig grün). Worker-API-Tests nicht gelaufen (kein Worker-Code geändert). Firefox/WebKit nur über CI.
- Grenze: Ändern zwei Tabs **gleichzeitig** (innerhalb weniger Millisekunden), gewinnt weiterhin der letzte. Ob ein voller Speicher im Feld tatsächlich auftritt, ist ohne Telemetrie nicht belegt. Die Absicherung kostet wenig und verhindert stillen Verlust.

## Welle 8d · Speicherübersicht im Profil (26.10.2026, Branch `ccr-c4b0523e-5f8zk2`)
- Backlog 5(a) aus Welle 8c umgesetzt: Profil → „Gerät“ zeigt, wie viel Realm auf dem Gerät speichert („Auf diesem Gerät gespeichert: N kB“), und gesondert die Offline-Kopien **anderer** Festivals. „Platz freigeben“ entfernt nach Rückfrage nur diese Kopien (`realm.bundle:<anderes>`); Pläne/Profile aller Festivals (`realm.v2:*`), die eigene Kopie und Einstellungen bleiben. Nutzen: Besucher:innen mehrerer Festivals können Speicher selbst zurückholen, bevor die Notfall-Stufen aus Welle 8c greifen.
- Größe = (Schlüssel + Wert) × 2 Byte (UTF-16, so zählen Browser das Kontingent); nur `realm.*`-Schlüssel. Nur im Live-Modus sichtbar (Demo hat keine Festival-Kopien); bei gesperrtem Speicher entfällt die Zeile.
- `src/persist.ts`: `otherBundleKeys`, `usage`, `dropOtherBundles` (über `storage.key(i)`, damit auch ohne echten Browser testbar); `src/store.tsx` nutzt `otherBundleKeys` für die Speicher-voll-Stufe statt einer eigenen Kopie der Regel.
- Geprüft (lokal, Chromium): typecheck, test:import (alle, persist jetzt 13 Prüfungen), build, test:e2e, test:a11y (keine Befunde; die neue Zeile erscheint dort nicht, weil a11y im Demo-Modus läuft), test:live vollständig grün inkl. neuem Schritt „the profile shows device storage and frees other festivals' offline copies without touching plans“. Worker-API-Tests nicht gelaufen (kein Worker-Code geändert). Firefox/WebKit nur über CI.

## Welle 8e · Plan folgt einem Re-Import des Veranstalters (29.10.2026, Branch `ccr-c4b0523e-3wv0ze`)
- Vorab: PR #40 (Welle 8d) war seit 26.10. grün und konfliktfrei, aber ungemergt – gemäß Absprache gemergt (`63e90b3`). Die Läufe vom 27./28.10. starteten auf dem alten Branch-Stand `b8ccffe` und bauten den längst gemergten Karteneditor (P6) erneut (Branches `…-9s9p1x`, `…-3z5mzs`, CI rot, nicht gemergt, verworfen). Gegenmaßnahme: neue `CLAUDE.md` mit „immer von `origin/main` ausgehen“, Prüfbefehlen und `CHROMIUM_PATH`.
- **Fehler (Nutzerablauf):** Ersetzt der Veranstalter das Programm per Import („Ersetzen“) und verschiebt dabei einen Act auf einen anderen Tag, bekommt er eine neue ID (`<Tag>-<Name>`); entfernte Acts verschwinden ganz. Der Plan der Besucher:innen behielt die alten IDs: Der Act fehlte **stillschweigend** in „Mein Plan“, Erinnerungen und „Warst du da?“ hingen an einer toten ID, die Planzählung im Profil stimmte nicht.
- Jetzt: Enthält der Plan unbekannte Acts, lädt die App das Festival **neu vom Server** (nie gegen eine ältere Offline-Kopie – sonst könnte ein zweiter Tab mit altem Stand einen gerade neu geplanten Act löschen; offline passiert nichts) und gleicht ab (`src/planReconcile.ts`):
  - **verlegt:** genau ein Act desselben Artists ist neu im Programm → der Plan zieht mit, Erinnerung und „Warst du da?“ ebenso. Ein zweites, schon vorher vorhandenes Set desselben Artists wird nie als Verlegung geraten.
  - **entfernt:** aus dem Plan genommen und benannt („Nachtfalter ist nicht mehr im Programm · Fr 00:30“).
  - Hinweis oben auf Home (vor „Änderung in deinem Plan“), einzeln mit „Verstanden“ quittierbar, übersteht Neustarts (`planNotices` im lokalen Zustand, beim Laden geprüft).
- Grenze: Ist die App zwischen dem Laden des neuen Programms und dem Abgleich geschlossen worden, fehlt beim nächsten Start der alte Stand – dann heißt es „Ein Act aus deinem Plan ist nicht mehr im Programm“ ohne Namen, und eine Verlegung wird nicht erkannt.
- Nebenbei: Doc-Kommentar von `FestivalPicker` (durch #40 verrutscht) wieder an der richtigen Stelle.
- Dateien: `src/planReconcile.ts` (neu, rein), `src/data.ts` (`EARLIER_LINEUPS`), `src/festival.ts` (`refetchFestival`), `src/store.tsx`, `src/screens/Home.tsx` (`PlanNotices`), `src/i18n/en-screens.ts`, `tests/planReconcile.test.mts` (10 Prüfungen, in `test:import`), `tests/live.mjs` (neuer Schritt), `docs/DEVICE_STORAGE.md`, `CLAUDE.md`.
- Geprüft (lokal, Chromium): typecheck, i18n-Wächter (566 Texte), test:import (alle, inkl. 10 neuer Plan-Abgleich-Prüfungen), build, test:e2e (alle Smoke-Schritte), test:a11y (keine Befunde), test:live vollständig grün inkl. neuem Schritt „organizer re-imports the line-up …“ (4,4 s). Worker-API-Tests nicht gelaufen (kein Worker-Code geändert). Eine Gegenprobe des neuen Live-Schritts am alten Stand wurde nicht ausgeführt. Firefox/WebKit nur über CI.

## Welle 8f · Konsole warnt vor betroffenen Plänen beim Import „Ersetzen“ (30.10.2026, Branch `ccr-c4b0523e-euuewh`)
- Backlog 5(c) aus Welle 8e umgesetzt. Bisher zeigte die Prüfung nur „N entfernt“; ob Besucher:innen diese Acts im Plan hatten, sah der Veranstalter nicht.
- Worker: Bei `mode: 'replace'` mit entfernten Acts liefert der Import (Trockenlauf und echter Lauf) `plans`: `visitorsLosing` (verschiedene Gäste mit einem wirklich entfallenden Act), `visitorsFollowing` (Gäste mit einem verlegten Act) und bis zu 10 Acts mit ≥ 3 Plänen (`movedTo` oder `null`). Verlegung = genau ein Act desselben Artists ist neu im Import – dieselbe Regel wie in der App (`src/planReconcile.ts`). Datenschutz wie in der Auswertung: nur Zahlen, `0` = niemand, `null` = 1–2 (nicht beziffert). Funktion `planImpact` in `worker/src/index.ts`; keine Migration.
- Konsole (Import → „Ersetzen“): Hinweis „Pläne von Besucher:innen sind betroffen“ (gelb, wenn jemand Acts verliert, sonst neutral) mit Erklärung, was die App den Betroffenen zeigt; die Bestätigungsfrage nennt die Zahlen ebenfalls. `docs/IMPORT.md` ergänzt.
- Tests: neuer API-Test „replace import dry run: how many synced plans lose or follow removed acts“ (Verlegung, Zurückhalten < 3, zweites neues Set ist keine Verlegung, `merge` → `null`, Trockenlauf schreibt nichts). Live-Schritt „organizer re-imports …“ prüft jetzt zuerst die Konsole: Hinweis, keine Auflistung eines Acts mit < 3 Plänen, Bestätigungstext, abgebrochene Bestätigung importiert nichts.
- Beim Testen gemerkt: Besucher:innen ohne Sitzung (nie etwas Soziales genutzt) synchronisieren ihren Plan nicht und werden deshalb nicht mitgezählt. Der Hinweis sagt das („mit dem Server abgeglichene Pläne“).
- Geprüft (lokal, Chromium): typecheck Web + Worker, test:import (alle), build, Worker `npm test` (43 API-Tests + Migrationstest), test:e2e, test:a11y (keine Befunde; die Konsole läuft dort ohne Server, der neue Hinweis wird also nicht von axe erfasst), test:live vollständig grün (neuer Teil im Re-Import-Schritt, 6,2 s). Eine Gegenprobe am alten Stand wurde nicht ausgeführt (das Feld `plans` existierte dort nicht). Firefox/WebKit nur über CI.

## Welle 8g · Zwei CI-Flakes behoben, Timetable nennt betroffene Pläne (31.10.2026, Branch `ccr-c4b0523e-ubsp37`)
- Vorab: PR #42 (Welle 8f) war grün, aber gegen den alten `main` (`11c9450`) gebaut. Lokal mit dem aktuellen `main` (#43, Staging) zusammengeführt und vollständig geprüft (typecheck, test:import, build, 44 API-Tests + Migrationstest, e2e, a11y, live – grün), dann gemäß Absprache gemergt (`e7ddf7d`).
- **Flake 1 (Firefox, Erinnerungs-Glocke, seit Welle 6c wiederkehrend):** CI-Log von Job 123910211888 ausgewertet: `pointerdown` auf der Glocke, `pointerup`/`click` auf dem Zwischenraum von `.sheet-actions` – die Glocke bewegte sich zwischen Drücken und Loslassen (Sheet fährt per Feder ein, Inhalt per x-Slide; unter `clock.install` greift Playwrights Stabilitätsprüfung offenbar nicht verlässlich). Der Test wartet jetzt in Echtzeit, bis die Glocke dreimal hintereinander dieselbe Position hat (`settled` in `tests/smoke.mjs`).
- **Flake 2 (lokal 1 von 5 Läufen, Zwei-Tab-Schritt):** „tab A does not show the plan change made in tab B: 0 → 12 open“ – gezählt wurde, bevor die „Alle“-Liste gerendert war. Der Test wartet jetzt auf die Liste und gibt der Anzeige im Hintergrund-Tab bis 5 s.
- **Feature (Backlog 5e):** Konsole → Live-Änderungen zeigt je Act „N Pläne“ und im Formular „In N abgeglichenen Plänen – diese Besucher:innen sehen die Änderung als Hinweis auf Home“ bzw. „In weniger als 3 … (oder keinem)“. Quelle sind die vorhandenen Auswertungs-Aggregate (`GET …/analytics`, Gruppen < 3 zurückgehalten) – kein Worker-Code, keine neue Datenerhebung. Schlägt das Laden fehl, bleibt die Liste wie bisher.
- Dateien: `src/admin/Admin.tsx` (`Timetable`, `PlanReach`), `tests/smoke.mjs`, `tests/live.mjs` (Konsolen-Schritt: drei Gäste planen Ruby Kade → Zahl ≥ 3; ein anderer Act → „weniger als 3“).
- Geprüft (lokal, Chromium): typecheck, test:import (alle), build, test:e2e 8 × hintereinander grün nach der Korrektur (vorher 1 von 5 rot), test:a11y (keine Befunde), test:live vollständig grün inkl. neuer Prüfung. Worker-API-Tests nach #42-Merge nicht erneut gelaufen (kein Worker-Code geändert). Firefox nicht lokal installiert – ob Flake 1 dort wirklich weg ist, zeigt erst die CI (über mehrere Läufe beobachten). Keine Gegenprobe des neuen Live-Teils am alten Stand (das Element `plan-reach` existierte dort nicht).

## Welle 8h · Konsole bereitet nach Absage/Verschiebung eine Meldung vor (04.11.2026, Branch `ccr-c4b0523e-w3jd4e`)
- Vorab: PR #44 (Welle 8g) war seit 31.10. grün und konfliktfrei, aber ungemergt – gemäß Absprache gemergt (`733a74d`). Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` zurückgesetzt.
- Backlog 5(f) umgesetzt. Problem: Eine Absage im Tab „Live-Änderungen“ erreicht als Hinweis nur Besucher:innen, die den Act geplant **und** ihren Plan abgeglichen haben; alle anderen (z. B. Leute vor der Bühne) sehen nur die Markierung im Line-up. Eine passende Meldung musste der Veranstalter bisher von Hand im anderen Tab abtippen.
- Jetzt: Nach dem Veröffentlichen einer Absage, Zeit- oder Bühnenänderung erscheint unter dem Formular „Die Änderung ist live …“ mit **„Meldung vorbereiten“**. Das wechselt zu „Meldungen“ mit vorausgefülltem Formular (Hinweis „Vorausgefüllt aus der Änderung an …“, „Verwerfen“):
  - Absage → Stufe **Warnung** (oben auf Home für alle), „Abgesagt: Maduk (Freitag 22:00, Generator)“, Text mit Grund aus dem Hinweisfeld.
  - Verschiebung/Bühnenwechsel → Stufe **Info** (nur Updates-Liste), „Verschoben: Maduk jetzt 00:30 statt 22:00, auf Lagoon statt Generator“.
  - Englische Fassung wird mit erzeugt; der (deutsche) Grund bleibt dort weg statt Sprachen zu mischen.
  - Ort = (neue) Bühne. Gültigkeit = bis 30 Min. nach Set-Ende (Festival-Zeitzone über `actTime`); leer (= bis gelöscht), wenn das Set vorbei ist oder weiter als 7 Tage (API-Grenze) entfernt – sonst liefe eine früh angelegte Meldung vor dem Festival ab.
  - Nichts wird automatisch veröffentlicht; nur-Hinweis-Änderungen bieten nichts an.
- Dateien: `src/admin/announcementDraft.ts` (neu, rein), `src/admin/Admin.tsx` (`ConsoleTabs`, `Announcements`, `Timetable`), `src/styles.css` (`.admin-draft`), `tests/announcementDraft.test.mts` (6 Prüfungen, in `test:import`), `tests/live.mjs` (Konsolen-Schritt: Angebot → Entwurf mit Titel und Stufe Info → Verwerfen leert das Formular → zurück und Zurücksetzen).
- Konsole bleibt deutsch (wie bisher, vom i18n-Wächter ausgenommen). Kein Worker-Code, keine Migration.

## Welle 8i · Zurückgesetzte Änderung räumt ihre Meldung ab (05.11.2026, Branch `ccr-c4b0523e-kv0u74`)
- Vorab: Session-Branch stand wieder auf `b8ccffe`. Weil dort die `CLAUDE.md` mit dem Hinweis noch fehlt, wurde zuerst erneut ein Karteneditor (P6) begonnen; erst ein Blick auf die CI-Läufe zeigte den Stand von `main`. Arbeit verworfen, Branch auf `origin/main` (`d6a8ce3`) gesetzt. Keine offenen PRs außer Alt-PR #26.
- Backlog 5(g) umgesetzt. Problem: Nach „Zurücksetzen“ einer Absage/Verschiebung blieb die dazu veröffentlichte Meldung stehen und widersprach dem Programm.
- Migration `0021_announcement_act.sql`: optionale Spalte `act_id` an Meldungen (+ Index). Worker: `POST /api/admin/announcements` nimmt `actId` an (nur Acts des eigenen Festivals, sonst 400); Lese-Antworten tragen `actId`. PATCH lässt die Verknüpfung unverändert.
- Konsole: Aus „Meldung vorbereiten“ veröffentlichte Meldungen merken sich den Act (Liste „Aktiv“ zeigt „Zur Änderung an …“). Nach **Zurücksetzen** – oder einer erneuten Änderung desselben Acts – erscheint „… spielt wieder wie ursprünglich geplant. Diese Meldung ist noch aktiv und stimmt nicht mehr: „…““ mit **Meldung entfernen** / **Behalten**. Nichts wird automatisch gelöscht; schon entfernte Meldungen (404) gelten als erledigt, andere Fehler werden gemeldet.
- Dateien: `worker/migrations/0021_announcement_act.sql`, `worker/src/index.ts`, `worker/test/api.test.mjs`, `src/api.ts`, `src/admin/announcementDraft.ts`, `src/admin/Admin.tsx`, `tests/live.mjs`.
- Prüfungen (lokal, Linux, Node 22, Chromium): `npm run typecheck`, `npm run test:import`, `npm run build` ohne Fehler · Worker-Typecheck · 43 API-Tests (erweitert: unbekannter/fremder Act → 400, `actId` in Antworten, bleibt bei PATCH) · Migrationstest (21 Migrationen) · `test:e2e` alle bestanden · `test:a11y` ohne schwerwiegende Befunde · `test:live` alle bestanden (Konsolen-Ablauf: verknüpfte Meldung veröffentlichen → Zurücksetzen → Angebot → entfernen → öffentliche Liste ohne Ruby Kade). Firefox/WebKit nur in CI.
- Nebenbei im Live-Test: Die Prüfung des Änderungsprotokolls nutzt jetzt `.first()`, da es nun zwei Meldungs-Einträge gibt.

## Welle 8j · Offizielle Meldung direkt beim Act (06.11.2026, Branch `ccr-c4b0523e-n2tvvo`)
- Vorab: PR #46 (Welle 8i) war grün, konfliktfrei und gegen den aktuellen `main` gebaut – gemäß Absprache gemergt (`275831c`). Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` gesetzt.
- Backlog 5(h) umgesetzt. Problem: Eine aus einer Absage/Verschiebung vorbereitete Meldung (mit `actId`) war für Besucher:innen nur in „Updates“ bzw. als Warnung auf Home sichtbar – wer den Act im Line-up öffnete, sah sie nicht.
- Jetzt: Das Act-Sheet zeigt alle aktiven offiziellen Meldungen mit passender `actId` (Bereich „Meldungen zu diesem Auftritt“, gleiche Darstellung wie in Updates, inkl. Gültigkeit) direkt unter dem Änderungshinweis. Auf Home öffnet ein Tipp auf eine solche Meldung den Act statt nur den Bühnen-Ort. Englische Besucher:innen sehen die englische Fassung (Mapping im Store unverändert).
- Dateien: `src/data.ts` (`FestivalUpdate.actId`), `src/store.tsx` (Feld durchreichen), `src/sheets.tsx` (`ActSheet`), `src/screens/Home.tsx`, `src/i18n/en-sheets.ts`, `tests/live.mjs` (Konsolen-Schritt: nach Veröffentlichen der verknüpften Meldung öffnet Lea Ruby Kade und sieht „Verschoben: Ruby Kade jetzt 18:45 statt 17:45“ im Act-Sheet). Kein Worker-Code, keine Migration.
- Prüfungen (lokal, Linux, Chromium): `npm run typecheck`, `npm run test:import` (alle, inkl. i18n-Wächter), `npm run build` ohne Fehler · `test:e2e` alle bestanden · `test:a11y` ohne schwerwiegende Befunde · `test:live` alle bestanden (Konsolen-Schritt 6,0 s). **Gegenprobe:** mit dem alten `src/` scheitert der neue Live-Schritt (Timeout auf `act-announcements`). Worker-Tests nicht erneut gelaufen (kein Worker-Code geändert). Firefox/WebKit nur in CI.

## Welle 8k · Updates führen zum Auftritt (07.11.2026, Branch `ccr-c4b0523e-qub45z`)
- Vorab: Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` (`6717219`) gesetzt. Offene PRs: nur Alt-PR #26.
- Backlog 5(i) umgesetzt. Problem: Im Sheet „Updates“ war eine offizielle Meldung zu einer Absage/Verschiebung nur Text – wer wissen wollte, wann und wo der Act jetzt spielt, musste ihn im Line-up suchen.
- Jetzt: Meldungen mit `actId` zeigen in „Updates“ den Knopf **„Zum Auftritt“** (Screenreader: „Zum Auftritt: Ruby Kade“), der das Act-Sheet öffnet; Zurück führt wieder zu den Updates. Nur, solange der Act noch im Programm ist (`actById`); im Act-Sheet selbst kein Selbstverweis.
- Dateien: `src/sheets.tsx` (`UpdateItem` mit optionalem `onAct`, `Updates`), `src/i18n/en-sheets.ts` („Go to set“), `tests/live.mjs` (Konsolen-Schritt: kein Knopf im Act-Sheet; Home → Updates → „Zum Auftritt“ → Act-Sheet mit Meldung → Zurück zu Updates → zu).
- Prüfungen (lokal, Linux, Chromium): `npm run typecheck`, `npm run test:import` (alle, inkl. i18n-Wächter), `npm run build` ohne Fehler · `test:e2e` alle bestanden · `test:a11y` ohne schwerwiegende Befunde · `test:live` alle bestanden (Konsolen-Schritt 9,1 s). **Gegenprobe:** mit dem alten `src/sheets.tsx` scheitert der neue Live-Teil (Knopf „Zum Auftritt: Ruby Kade“ fehlt). Worker-Tests nicht gelaufen (kein Worker-Code geändert). Firefox/WebKit nur in CI.

## Welle 8l · Zwei Tabs verlieren keine wartende Nachricht (08.11.2026, Branch `ccr-c4b0523e-nuggvm`)
- Vorab: Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` gesetzt. PR #48 (Welle 8k) war grün, konfliktfrei und gegen den aktuellen `main` gebaut – gemäß Absprache gemergt (`a1a24f3`). Offene PRs danach: nur Alt-PR #26.
- Backlog 5(d) umgesetzt: neuer Live-Schritt „two tabs offline: messages written in both arrive exactly once after reconnect“ – Ben hat zwei Tabs offen, schreibt offline nacheinander und gleichzeitig in beiden, geht online; Lea sieht jede Nachricht genau einmal, die Outbox ist danach leer. Das lief am alten Stand bereits grün.
- **Dabei gefundener Fehler:** Jeder Tab übernimmt beim `storage`-Ereignis den *gesamten* Zustand des anderen Tabs. Speichert der andere Tab einen Stand von *vor* der neuen Nachricht (z. B. direkt nach seinem Poll, der alle 8 s den Zustand ändert und speichert), verschwand die wartende Nachricht aus Outbox, Chat-Anzeige und – beim nächsten Speichern – aus dem Gerätespeicher. Offline geschrieben und App geschlossen = Nachricht weg, ohne Hinweis. **Gegenprobe:** Der Live-Schritt spielt genau diesen veralteten Stand ein und scheiterte am alten Code („a stale state from the other tab dropped a queued message from storage“).
- Jetzt (`src/outboxMerge.ts`, rein): Jeder Tab merkt sich seine selbst eingereihten Aktionen, bis ein Stand des anderen Tabs sie enthält. Fehlen sie in einem übernommenen Stand, ohne dass der andere Tab sie je gesehen hat, bleiben sie erhalten (samt „Wird gesendet …“-Blase bzw. Meetup) und der geheilte Zustand wird erneut gespeichert. Fehlen sie, nachdem der andere Tab sie gesehen hat, hat er sie gesendet – sie werden nicht wiederbelebt. Damit „gesendet“ von „veraltet“ unterscheidbar ist, speichert der Zustand die IDs der letzten 50 gesendeten Aktionen (`outboxSent`, keine Inhalte); ein veralteter Stand, der eine hier schon gesendete Aktion noch enthält, bringt sie nicht zurück. Datenschutz-Entscheidungen (Standort, Schritte löschen): Liegt im übernommenen Stand schon eine für dasselbe Ziel vor, gilt diese (wie bisher, keine Dublette). Doppeltes Senden bleibt durch Client-IDs harmlos.
- CI-Lauf 1 von PR #49 war rot („outbox not empty after delivery: 2“): Lea bekam jede Nachricht genau einmal, aber Aktionen blieben bis zum nächsten Poll liegen – in einem Hintergrund-Tab (pollt nicht) dauerhaft. Zwei Ursachen im ersten Merge: (1) sendet der andere Tab eine nur übernommene, nie von ihm gespeicherte Aktion, galt sie hier als „verdrängt“ und wurde neu eingereiht; (2) ein veralteter Stand mit einer hier schon gesendeten Aktion brachte sie zurück. Lokal reproduziert (2 von 2 rot), mit `outboxSent` behoben, danach 3 von 3 Live-Läufen grün. Der Test wartet bis 3 s auf das Leeren (unter dem 8-s-Poll, ein Wiedereinreihen fiele also weiter auf).
- Grenze: Nur die Outbox wird zusammengeführt. Plan und andere Felder folgen weiterhin dem zuletzt gespeicherten Stand („letzter Schreiber gewinnt“); das gleiche Millisekunden-Rennen kann dort theoretisch eine Plan-Änderung überschreiben (bisher nie beobachtet; der Smoke-Test „two open tabs never overwrite each other’s plan“ deckt die normale Abfolge ab).
- Dateien: `src/outboxMerge.ts` (neu), `src/store.tsx` (`queuedHere`, `storage`-Handler, `enqueue`, `enqueuePrivacy`, `flush`), `tests/outboxMerge.test.mts` (9 Prüfungen, in `test:import`), `tests/live.mjs`, `docs/DEVICE_STORAGE.md`, `package.json`. Kein Worker-Code, keine Migration, keine neuen UI-Texte.
- Prüfungen (lokal, Linux, Chromium): `npm run typecheck`, `npm run test:import` (alle, inkl. 9 neuer Merge-Prüfungen), `npm run build` ohne Fehler · `test:e2e` alle bestanden · `test:a11y` ohne schwerwiegende Befunde · `test:live` nach der Korrektur 3 × hintereinander alle bestanden (neuer Schritt 5,4–5,7 s). Gegenprobe am alten `src/store.tsx`: neuer Live-Teil scheitert. Worker-Tests nicht gelaufen (kein Worker-Code geändert). Firefox/WebKit nur in CI.

## Welle 8m · Updates führen zum Ort auf der Karte (09.11.2026, Branch `ccr-c4b0523e-duj9va`)
- Vorab: Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` (`e9c4d6f`) gesetzt. Offene PRs: nur Alt-PR #26.
- Backlog 5(j) umgesetzt. Problem: Eine offizielle Meldung ohne Act, aber mit Ort (in der Konsole frei getippt, z. B. „Lagoon“), führte in „Updates“ nirgends hin; Home öffnete nur Meldungen mit Punkt-ID (`poi`), die Konsolen-Meldungen nie haben.
- Jetzt (`src/updatePoi.ts`, rein): Der Ort wird einem Kartenpunkt zugeordnet – zuerst über `poi`, sonst über den Namen (Groß-/Kleinschreibung und Leerzeichen egal; „Bühne X“, „Stage X“, „X Stage“, „X-Bühne“ meinen die Bühne X). Nur bei **genau einem** Treffer; mehrdeutige oder unbekannte Orte bekommen keinen geratenen Link. In „Updates“ zeigt eine solche Meldung **„Auf der Karte zeigen“** (Screenreader: „Auf der Karte zeigen: Lagoon“), wechselt zur Karte, zentriert und öffnet den Ort. Gilt für alle Quellen mit auflösbarem Ort; Meldungen mit Act behalten „Zum Auftritt“. Home nutzt dieselbe Auflösung.
- **Dabei gefundener Fehler:** Im Live-Betrieb legte der Karten-Deep-Link das Ort-Sheet zweimal auf den Sheet-Stapel – das erste Escape/Zurück schien nichts zu tun (Live-Test reproduziert: nach Escape weiterhin „Lagoon“, nach dem zweiten leer). Betraf auch den vorhandenen Knopf „Auf der Karte zeigen“ im Ort-Sheet. Behoben in `openSheet` (`src/store.tsx`): Ein Sheet, das schon oben liegt, wird nicht noch einmal gestapelt (deckt auch Doppeltipps ab). Warum der Effekt in der Karte live doppelt feuert, ist nicht weiter untersucht – die Absicherung wirkt unabhängig davon.
- Dateien: `src/updatePoi.ts` (neu), `src/sheets.tsx` (`UpdateItem` mit `onMap`, `Updates`), `src/screens/Home.tsx`, `src/store.tsx` (`openSheet`), `src/i18n/en-sheets.ts`, `tests/updatePoi.test.mts` (6 Prüfungen, in `test:import`), `tests/live.mjs` (CLI-Meldungs-Schritt: kein „Zum Auftritt“, „Auf der Karte zeigen: Lagoon“ → Ort-Sheet „Lagoon“ → ein Escape schließt), `package.json`. Kein Worker-Code, keine Migration.
- Prüfungen (lokal, Linux, Chromium): `npm run typecheck`, `npm run test:import` (alle, inkl. 6 neuer Prüfungen und i18n-Wächter), `npm run build` ohne Fehler · `test:e2e` 18 bestanden · `test:a11y` ohne schwerwiegende Befunde · `test:live` 29 bestanden. **Gegenprobe:** mit dem alten `openSheet` scheitert der neue Live-Teil (Sheet nach einem Escape noch offen). Worker-Tests nicht gelaufen (kein Worker-Code geändert). Firefox/WebKit nur in CI.

## Welle 8n · Konsole erkennt den Ort einer Meldung (10.11.2026, Branch `ccr-c4b0523e-ls6063`)
- Vorab: Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` (`bb58a0c`) gesetzt. Offene PRs: nur Alt-PR #26.
- Backlog 5(l) umgesetzt. Problem: Ob eine Meldung in der App zur Karte führt (Welle 8m), hing davon ab, dass der frei getippte Ort exakt einen Kartenpunkt trifft – die Konsole verriet das nicht.
- Jetzt: Das Feld „Ort“ schlägt die Kartenpunkte des gewählten Festivals vor (Datalist, Namen ohne Dubletten) und sagt live (`aria-live`, per `aria-describedby` am Feld): „Wird auf der Karte verlinkt: …“, „N Kartenpunkte heißen so – … keinen Kartenlink“ oder „Kein Kartenpunkt mit diesem Namen – …“. Bei eindeutigem Treffer wird zusätzlich die Punkt-ID (`poi`) gespeichert (Worker kannte das Feld schon), damit der Link auch bei späterer Schreibweise des Orts stabil bleibt; die App bevorzugt `poi` und fällt sonst auf den Namen zurück.
- `src/updatePoi.ts`: neue Funktion `matchPlace` (Treffer / mehrdeutig / keiner); `poiForUpdate` nutzt sie – Verhalten unverändert (bestehende 6 Prüfungen grün).
- Dateien: `src/updatePoi.ts`, `src/admin/Admin.tsx` (`Announcements`), `src/api.ts` (`announce` mit `poi`), `tests/updatePoi.test.mts` (+1 Prüfung), `tests/live.mjs` (Konsolen-Schritt: „Parkplatz“ → kein Kartenpunkt, Vorschlagsliste enthält „Shuttle-Terminal“, „shuttle-terminal “ → verlinkt, öffentliche API liefert die `poi` des Terminals). Kein Worker-Code, keine Migration; Konsole bleibt deutsch (vom i18n-Wächter ausgenommen).
- Prüfungen (lokal, Linux, Chromium): `npm run typecheck`, `npm run test:import` (alle, 7 Ort-Prüfungen), `npm run build` ohne Fehler · `test:e2e` alle bestanden · `test:a11y` ohne schwerwiegende Befunde · `test:live` alle bestanden (Konsolen-Schritt 9,6 s). Keine Gegenprobe am alten Stand gefahren (der neue Live-Teil setzt UI voraus, die es vorher nicht gab). Worker-Tests nicht gelaufen (kein Worker-Code geändert). Firefox/WebKit nur in CI.

## Welle 8o · Konsole zeigt, welche Meldungen zur Karte führen (12.11.2026, Branch `ccr-c4b0523e-l24oy2`)
- Vorab: Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` gesetzt. PR #51 (Welle 8n) war grün, konfliktfrei und auf aktuellem `main` – gemäß Absprache gemergt (`7253229`). Offene PRs danach: nur Alt-PR #26. **Hinweis:** Der Durchlauf vom 11.11. (`ccr-c4b0523e-rihs9d`) hat P6 trotz `CLAUDE.md` ein weiteres Mal auf `b8ccffe` gebaut – ohne PR, verworfen (P6 ist seit `a210f77` in `main`); Branch kann gelöscht werden.
- Backlog 5(m) umgesetzt: In der Konsole zeigt die Liste „Aktiv“ bei jeder Meldung mit Ort, ob die App sie mit der Karte verknüpft – „Karte: Shuttle-Terminal“ oder „Ort „Parkplatz“ – kein Kartenlink“. Dieselbe Auflösung wie in der App (`poiForUpdate`: zuerst `poi`, sonst eindeutiger Name), daher auch für ältere Meldungen ohne `poi` richtig.
- Ebenfalls aus 5(m): Der Worker lehnt bei `POST` und `PATCH /api/admin/announcements` eine `poi` ab, die nicht zu diesem Festival gehört (400 „Kartenpunkt gehört nicht zu diesem Festival“), analog zu `actId`.
- Dateien: `src/admin/Admin.tsx` (`MapLinkNote`), `worker/src/index.ts` (`poiExists`), `worker/test/api.test.mjs` (unbekannte/fremde `poi` → 400, eigene → 201, `PATCH` behält bzw. prüft `poi`), `tests/live.mjs` (Konsolen-Schritt: „Karte: Shuttle-Terminal“ in der Liste). Keine Migration, keine neuen App-Texte (Konsole ist deutsch).
- **Durch den Live-Test gefundener Fehler in der eigenen Änderung:** Bühnen-Pins stehen nicht in der Tabelle `pois`, sondern werden im Festivaldokument aus `stages` als `stage-<id>` erzeugt. Die erste Fassung von `poiExists` lehnte deshalb jede Meldung zu einer Bühne ab (vorbereitete Meldung zur Verschiebung von Ruby Kade → 400). Jetzt prüft `poiExists` beide Quellen; API-Test um `stage-lagoon` (gültig) und `stage-gibts-nicht` (400) ergänzt.
- Prüfungen (lokal, Linux, Chromium): `npm run typecheck`, Worker-Typecheck, `npm run test:import` (alle), `npm run build` ohne Fehler · `test:e2e` 18 bestanden · `test:a11y` ohne schwerwiegende Befunde · Worker `npm test` 44 bestanden (inkl. Migrationstest) · `test:live` 29 bestanden (nach der Korrektur; erster Lauf scheiterte wie oben beschrieben). Firefox/WebKit nur in CI.

## Welle 8p · Aktive Meldungen in der Konsole bearbeiten (14.11.2026, Branch `ccr-c4b0523e-t3zbje`)
- Vorab: Session-Branch stand wieder auf `b8ccffe`; gemäß `CLAUDE.md` auf `origin/main` (`a08bef9`) gesetzt. Offene PRs: nur Alt-PR #26.
- Backlog 5(n) umgesetzt. Problem: Die Liste „Aktiv“ konnte nur entfernen. Tippfehler, Verlängerung oder Hochstufung Info → Warnung hieß Löschen und neu anlegen – Alter, Kartenpunkt und die Verknüpfung zur Timetable-Änderung (`actId`) gingen verloren.
- Jetzt: Stift-Knopf je Meldung („„…“ bearbeiten“) füllt das Formular („Meldung bearbeiten“, Gültigkeit = verbleibende Minuten), Hinweis „Alter und Verknüpfungen bleiben erhalten. Eine geänderte Gültigkeit zählt ab dem Speichern.“, Knöpfe „Abbrechen“ / „Änderungen speichern“ (gesperrt, solange nichts geändert ist). Gesendet wird nur, was sich geändert hat (`announcementPatch`): eine unveränderte Gültigkeit behält ihren Ablauf statt neu zu starten, ein unveränderter Ort seine `poi`; geleerte Felder gehen als `null`. Was vorher im Formular stand (neue Meldung, vorbereiteter Entwurf), kommt nach Speichern/Abbrechen zurück. Wurde die Meldung inzwischen entfernt (404), sagt die Konsole das und verlässt den Bearbeiten-Modus. Wird die gerade bearbeitete Meldung entfernt, endet der Modus ebenfalls.
- **Dabei gefundener Worker-Fehler:** `PATCH` mit `titleEn: null` ließ den englischen Text (`body_en`) in der Datenbank stehen; beim erneuten Hinzufügen eines englischen Titels tauchte der alte Text wieder auf. Jetzt wie bei `POST`: ohne englischen Titel kein englischer Text. Gegenprobe: neuer API-Test scheitert am alten Stand („old English text came back“).
- Dateien: `src/admin/announcementDraft.ts` (`announcementForm`, `announcementPatch`, rein), `src/admin/Admin.tsx` (`Announcements`), `src/api.ts` (`adminApi.updateAnnouncement`), `worker/src/index.ts` (PATCH `body_en`), `worker/test/api.test.mjs`, `tests/announcementDraft.test.mts` (+3 Prüfungen), `tests/live.mjs` (Konsolen-Schritt: vorausgefüllt, Speichern ohne Änderung gesperrt, Abbrechen stellt leeres Formular her, Titel + Stufe „Warnung“ ändern → keine Dublette, Kartenlink bleibt, Lea sieht die Warnung auf Home). Keine Migration, keine neuen App-Texte (Konsole ist deutsch).
- CI-Lauf 1 von PR #53: `live` rot im unberührten Schritt „a hanging request times out …“ (F17): Lea las ihre Chat-Blasen direkt nach dem Neuladen, als noch die Offline-Kopie ohne die neuen Nachrichten angezeigt wurde (Ausgabe: nur ältere Nachrichten; Ben hatte beide schon zugestellt). Ursache ist ein Rennen im Test, kein App-Fehler. Der Test wartet jetzt bis zu 15 s auf „Und danach“, bevor er die Reihenfolge prüft; lokal erneut alle Live-Schritte grün.
- CI-Lauf 2: `live` rot im Konsolen-Schritt (`→ 18:45` fehlte). **Echter Konsolen-Fehler, nicht von 8p verursacht:** Nach einem Tab-Wechsel lädt „Live-Änderungen“ die veröffentlichten Änderungen neu. Wählt man einen Act und verschiebt ihn („+30 Min.“), bevor das Laden fertig ist, wird das Formular mit dem geladenen Stand neu aufgebaut und die Eingabe verworfen; veröffentlicht wird der alte Stand. Jetzt zeigt die Konsole bis dahin „Lade Änderungen …“; schlägt das Laden fehl, öffnet sich das Formular wie bisher ab dem Line-up. Der Live-Test verzögert die Antwort jetzt gezielt um 1,5 s. **Gegenprobe:** Am alten `Admin.tsx` scheitert er genau wie in der CI, mit der Korrektur ist er grün.
- Prüfungen (lokal, Linux, Chromium): `npm run typecheck`, Worker-Typecheck, `npm run test:import` (alle), `npm run build` ohne Fehler · Worker `npm test` 43 API-Tests + Migrationstest bestanden · `test:e2e` alle bestanden · `test:a11y` ohne schwerwiegende Befunde · `test:live` alle bestanden (Konsolen-Schritt 9,9 s). Firefox/WebKit nur in CI.

## Historischer Web-Backlog · Stand 14.11.2026

Für neue Arbeitspakete gilt der jüngste datierte Übergabeeintrag und der Winterplan, insbesondere A2b. Die folgenden Web-Vorschläge sind kein Auftrag, die native Release-Priorität zu überspringen.
1. CI der nächsten PRs beobachten: Ist `browsers (firefox)` am Erinnerungs-Schritt weiterhin gelegentlich rot (trotz Welle 8g), Ereignisprotokoll im Log mit Glocken-Position vergleichen. Schrittzeiten prüfen; hängt ein Schritt wiederholt, dort ansetzen (Welle 8b bleibt beobachtend offen).
2. Produktentscheidung offen (Stand jetzt geprüft): Erinnerungen, „Warst du da?“ und Konfliktentscheidungen liegen **nur lokal** (Worker und API-Client kennen sie nicht). Bei „Profil wiederherstellen“ auf einem neuen Gerät gehen sie verloren. Mitnehmen (Komfort) oder lokal lassen (Datensparsamkeit)? Bis zur Entscheidung nicht umsetzen.
3. Offen ohne Zugang: Staging-Lasttest/Monitoring (F17, braucht Deployment), finale Rechtstexte und § 25-TDDDG-Entscheidungen (Betreiber, siehe `docs/DEVICE_STORAGE.md`).
4. Alt-PR #26 (D08, durch #33 erledigt) kann geschlossen werden – Entscheidung des Repo-Inhabers.
5. Backlog (Nutzen/Aufwand): (a) Speicherübersicht – erledigt in Welle 8d. (b) Plan folgt Re-Import – erledigt in Welle 8e. (c) Warnung vor betroffenen Plänen beim Import „Ersetzen“ – erledigt in Welle 8f. (e) Plan-Zahlen bei Einzeländerungen – erledigt in Welle 8g. (f) Meldung aus Absage/Verschiebung vorbereiten – erledigt in Welle 8h. (g) Verknüpfte Meldung beim Zurücksetzen entfernen – erledigt in Welle 8i. (h) Offizielle Meldung im Act-Sheet – erledigt in Welle 8j. (i) „Zum Auftritt“ in Updates – erledigt in Welle 8k. (d) Outbox bei zwei Tabs – erledigt in Welle 8l (inkl. Fehlerbehebung). (j) Ort-Meldungen → Karte – erledigt in Welle 8m. (l) Ortsvorschläge und Erkennung in der Konsole – erledigt in Welle 8n. (m) Kartenlink in der Liste „Aktiv“ + Worker prüft `poi` – erledigt in Welle 8o. **Nächste Umsetzung: (n)** – siehe unten. Ebenfalls zu prüfen: Sollen Pläne von Gästen ohne Sitzung überhaupt anonym gezählt werden? Das wäre eine Produktentscheidung (Datensparsamkeit) – nicht eigenmächtig umsetzen. (j) Danach prüfen: Meldungen ohne `actId`, aber mit Bühnen-Ort (`place`) führen in Updates noch nirgends hin – „Auf der Karte zeigen“ analog zu Home (`poi`). Aufwand klein: `UpdateItem` in `src/sheets.tsx`, Ort über `place` → POI auflösen wie auf Home (`src/screens/Home.tsx`), `focusPoi` + Tab „Map“; Live-Prüfung im Konsolen-Schritt. (l) Danach: Die Konsole könnte beim Feld „Ort“ die Kartenpunkte des Festivals vorschlagen (Datalist) und anzeigen, ob der Ort erkannt wird („wird auf der Karte verlinkt“ / „kein Kartenpunkt“) – dann verlinken Meldungen verlässlich. Aufwand klein: `AnnouncementForm` in `src/admin/Admin.tsx`, Punkte aus dem geladenen Festival, `poiForUpdate` wiederverwenden; Live-Prüfung im Konsolen-Schritt. Optional `poi` mitspeichern (Worker kennt das Feld bereits). (m) Konsole, Liste „Aktiv“: bei Meldungen mit Ort anzeigen, ob sie verlinkt sind („Karte: Shuttle-Terminal“) – älteren Meldungen ohne `poi` sieht man das sonst nicht an. Aufwand klein: `Announcements` in `src/admin/Admin.tsx`, `poiForUpdate` mit `POIS`; Live-Prüfung im Konsolen-Schritt. Ebenfalls klein: Der Worker prüft `poi` bei `POST /api/admin/announcements` nicht gegen die Punkte des Festivals (die App ignoriert fremde IDs, harmlos) – bei Gelegenheit wie `actId` mit 400 ablehnen, API-Test ergänzen. (n) Aktive Meldung in der Konsole bearbeiten – erledigt in Welle 8p. **Nächste Umsetzung: (o)** Bald ablaufende Meldungen in der Liste „Aktiv“ hervorheben („läuft in 5 Min. ab“) und mit einem Knopf „+30 Min.“ verlängern (`updateAnnouncement` mit `validMin = Rest + 30`); Aufwand klein, Live-Prüfung im Konsolen-Schritt. Frühere Beschreibung von (n): Heute kann die Liste „Aktiv“ nur entfernen; ein Tippfehler, eine Verlängerung („noch 30 Min.“) oder eine Hochstufung Info → Warnung erfordert Löschen und Neu-Anlegen – dabei gehen Alter und die Verknüpfung zur Timetable-Änderung (`actId`) verloren. Der Worker kann das bereits (`PATCH /api/admin/announcements/:id`, prüft seit 8o auch `poi`). Aufwand klein bis mittel: `adminApi.updateAnnouncement` in `src/api.ts`, Knopf „Bearbeiten“ je Eintrag in `Announcements` (`src/admin/Admin.tsx`), das vorhandene Formular mit den Werten füllen (Gültigkeit = verbleibende Minuten), „Änderungen speichern“/„Abbrechen“; Live-Prüfung im Konsolen-Schritt (Stufe ändern → Lea sieht Warnung auf Home). Nutzen: hoch im Festivalbetrieb, keine Abhängigkeit. (k) Danach abwägen: Plan-Änderungen beim Tab-Abgleich ebenso zusammenführen wie die Outbox (siehe Grenze in Welle 8l) – Nutzen klein, nur wenn einfach testbar.
6. Unbenutzte Alt-Branches mit bereits erledigter Arbeit (`ccr-c4b0523e-4xuz1d`, `…-9s9p1x`, `…-3z5mzs`, `…-ob2a6c`, `…-b2l3ty`, `…-arx1xq`, `…-rihs9d` – alles Doppelbauten von P6) können gelöscht werden. `ccr-c4b0523e-s9bhkw` enthält eine fertige Umsetzung für Punkt 2 (Erinnerungen/„Warst du da?“ bei Wiederherstellung, Stand 22.10., vor 8b/8c) – nach einer Entscheidung „mitnehmen“ als Vorlage nutzen, nicht blind mergen.

## Übernahme und Cloudflare-Staging (30.10.2026, Codex)

- Ausgangspunkt: frischer Checkout von `origin/main` auf `11c9450`, identisch mit dem übergebenen ZIP. Branch `codex/staging-preview`. PR #42 enthält bereits Claudes Importwarnung und bleibt zur separaten Prüfung erhalten. Keine alten Branches, Stashes oder PRs gelöscht; GitHub-Standardbranch weiterhin `claude/realm-festival-app`.
- Eine eigene Umgebung `realm-staging` verwendet Workers Static Assets und dieselbe Origin für Web-App und API, mit eigener D1-Datenbank (EU-Jurisdiktion). Bestehende LIR-Deployments bleiben unberührt. Produktions-Konfiguration und persönliche Admin-Einrichtung sind nicht Teil dieser Bereitstellung.
- `build:staging` erstellt eine Statusseite unter `/development` und `/build-info.json` mit Commit, Build-Zeit und Kennzeichnung eines veränderten Arbeitsverzeichnisses. `check:staging` prüft HTTP-/API-Routing, ein Build-Asset, Festivaldaten und optional den exakten sauberen Quellcommit ausschließlich lesend.
- Der vorbereitete GitHub-Workflow aktualisiert Staging optional nach erfolgreicher Push-CI auf `main`; überholte CI-Ergebnisse werden vor Migration/Deploy übersprungen. Aktivierung erfordert den separaten Cloudflare-CI-Token, die dokumentierte Repository-Variable und die Umstellung des Standardbranches. Bisher keine automatische Veröffentlichung aus GitHub aktiviert.
- Konkreter Review-Fund behoben: Eine zweite HTML-Seite konnte als Offline-App-Shell gespeichert werden. Der Service Worker behandelt jetzt nur Navigationen auf `/` als App-Shell (Screens verwenden Query/Hash). Regressionstest scheiterte am alten Stand; jetzt 18 Service-Worker-Prüfungen grün, einschließlich `/development` und `/development.html`.
- Wrangler innerhalb des vorhandenen Versionsbereichs auf 4.156.0 aktualisiert; die bei Installation gefundenen Undici-/Miniflare-Entwicklungsabhängigkeitsbefunde sind damit behoben (`npm audit`: 0 Befunde). Kein pauschales `audit fix`.
- Lokal auf macOS/Node 26.5.0 tatsächlich bestanden: Web-/Worker-Typprüfung, alle Unit-/Strukturprüfungen, Demo- und Staging-Build, 18 Browser-Smoke-Szenarien und A11y mit Chrome, 42 API-Tests, Altdaten-Migrationstest mit allen 20 Migrationen, vollständiger Live-Test mit 28 Szenarien. Kombinierter lokaler Staging-HTTP-Check und Wrangler-Deploy-Dry-Run ebenfalls bestanden. Firefox/WebKit und Node 22 müssen die CI bestätigen; kein Cloudflare-Lasttest.
- Delegation: Luna `researcher` für Cloudflare-Architektur, zwei Luna `worker` für Staging-Check und Statusseite; Astra `reviewer` für unabhängige Prüfung. Root hat Konfiguration, Integration, Tests und Veröffentlichung übernommen.
- Nächste Schritte nach der ersten Veröffentlichung: Cloudflare-Ergebnis und Quellcommit gegenprüfen; Admin-Einladung einrichten; GitHub-CI-Token/Standardbranch für automatische Vorschauen; PR #42 separat prüfen; Lasttest/Monitoring sowie Betreiber- und Produktentscheidungen bleiben offen.


## Winterplanung und Betriebszugänge (30.10.2026, Codex)

- PR #43 nach vollständig grüner PR-CI zusammengeführt (`062d8eb`); auch die main-Push-CI ist grün. GitHub-Standardbranch auf `main` umgestellt. PR #42 und alte Branches unverändert.
- Persönliches Plattform-Admin-Konto eingerichtet; Hannes hat Passwort und TOTP selbst eingerichtet. Abschluss über reine Statusabfrage bestätigt. Temporärer Bootstrap-Schlüssel entfernt; die verwendete Einladung ist verbraucht.
- Nach ausdrücklicher Freigabe separaten Cloudflare-CI-Token angelegt und ausschließlich in GitHub-Environment `staging` hinterlegt, Deploymentbranch `main`. Repository-Variable `REALM_STAGING_DEPLOY_ENABLED=true`. Tokenablauf 28.01.2027. Berechtigungen und Betriebsdetails: `docs/STAGING.md`.
- Manueller GitHub-Staginglauf 41051288845 erfolgreich, inklusive Migration/Deploy/Commit-Nachweis; öffentliche Build-/Health-Abfrage bestätigt `062d8eb`, `dirty=false`, API gesund. Erster neu ausgelöster automatischer Folgelauf noch nicht beobachtet. Keine neue native oder Produktionsbereitstellung.
- `docs/WINTER_RELEASE_PLAN.md` ist der lokale abhakbare Plan für öffentliche iOS-/Android-Apps und Web bis Let It Roll Winter am 22.–23.01.2027. Bestätigte Vorgaben: unabhängige Community-App, persönliche Entwicklerkonten noch anzulegen, beide öffentlichen Stores als Ziel. Bestehende LIR-V1 und separates Capacitor-V2-Projekt sowie die beiden relevanten ChatGPT-Chats und anonymisierte Besucherhinweise einbezogen. Keine privaten Chat-Rohdaten, Passwörter oder Tokens in Dokumenten.
- Architekturentscheidung ausdrücklich vor neuer nativer Implementierung: vorhandenes LIR-V2 anhand reproduzierbarer Geräte-Builds gegen Realm abnehmen und eine gemeinsame Basis bestimmen. Authentifizierung/Datenmodelle sind nicht direkt austauschbar. Bestehende V1 und LIR-V2 unverändert.
- Tatsächlich delegiert: Luna Researcher `native_release_plan`, Luna Explorer `realm_gap_plan` und `lir_v1_audit`, Luna Worker `winter_roadmap`; Astra Reviewer `winter_plan_review`. Reviewkorrekturen: abgeschlossene CI-Einrichtung korrekt markieren; Play-App-Einrichtung vor den obligatorischen geschlossenen Test legen. Dokumentationsänderungen mit `git diff --check` und lokalen Linkprüfungen kontrolliert; keine App-Codeänderung, deshalb keine zusätzliche lokale Volltestsuite.
- Lokales Git-Fetch wurde durch eine ungültige zusätzliche Ref-Datei `staging-preview 2` blockiert. Datei unverändert nach `.git/invalid-ref-backups/` verschoben; echte Branch-Refs erhalten. Danach Fetch erfolgreich, Dokumentationsbranch `codex/winter-release-plan` von aktuellem `origin/main` angelegt. Ursache der zusätzlichen Datei unbestätigt.
- Nächster konkreter Arbeitsschritt: Entwicklerkonten/Tester organisieren und das begrenzte Architektur-/Geräte-Build-Gate A2 durchführen. Dokumente dieses Schritts noch nicht committed oder veröffentlicht.

## Persönliche Dokumentation und Chat-Übergabe (30.10.2026, Codex)

- Auf Nutzerwunsch lokale Mappe `../DOKU/` mit Einstieg, wiederverwendbarem Startprompt, verständlicher Cloudflare-Erklärung, Kostenübersicht, rechtlichen Betreiberaufgaben und persönlicher Aufgabenliste erstellt. Sie liegt außerhalb dieses öffentlichen Repositories; die übergeordnete `.gitignore` schließt sie aus. Keine privaten Abrechnungsdetails in diese Fortschrittsdatei übernommen.
- Bestehende Cloudflare-Abonnements, angezeigte Nutzung, Rechnungsstatus und Kostenwarnung ausschließlich gelesen; Ergebnis mit Prüfdatum in der persönlichen Kostenübersicht dokumentiert. Öffentliche Anbieterpreise und Store-/Datenschutzanforderungen anhand offizieller Quellen geprüft. Keine Tarifänderung, kein Kauf und keine neue Zugriffsvergabe.
- `AGENTS.md` verlangt künftig verständliche Pflege der vorhandenen persönlichen Doku bei relevanten Änderungen sowie datierte Übergaben mit Tests, Grenzen und nächstem Schritt. Der Startprompt liest den aktuellen Git-/Plan-/PR-Stand neu und unterscheidet lokale Arbeit, main, Staging, native Geräteprüfung und tatsächliche Store-Freigabe. Eine später abgeschlossene Architekturentscheidung wird nicht durch den Prompt wieder geöffnet.
- Tatsächlich gelaufen: Luna Researcher `costs_research` und `legal_research`, Luna Worker `handover_docs`; Astra Reviewer `owner_docs_review`. Reviewkorrektur: Budgetwarnung betrifft nutzungsabhängige Kontokosten, nicht die gesamte Rechnung einschließlich Grundgebühren.
- Prüfung: lokale Dokumentlinks, Markdown-Codeblöcke, Leerzeichen, Git-Ausschluss der persönlichen Mappe und `git diff --check` kontrolliert. Nur Dokumentation/Arbeitsanleitung und lokaler Git-Ausschluss geändert; keine App-Tests oder neue native Builds erforderlich bzw. ausgeführt.
- Übergabe: weiterhin lokaler Branch `codex/winter-release-plan`; bestehende uncommittete Winterplan-/Staging-Dokumentation erhalten. Diese Dokumente und die neuen Anleitungen sind lokal, nicht committed, gepusht oder deployed. Die persönliche Mappe ist bewusst nicht Teil der öffentlichen Versionsverwaltung und benötigt eine private Sicherung.
- Nächster Entwicklungsschritt bleibt A2 (reproduzierbare Geräte-Builds und Wahl einer führenden Basis), parallel A1 (Entwicklerkonten/Tester). Vor kostenrelevanten Tests Betreiberbudget und aktuelle Tarifbedingungen klären. Kein neuer Architekturwechsel oder Funktionsumfang durch diese Doku beschlossen.

## A2 · Frischer V2-Build und native Vorprüfung (30.10.2026, Codex)

- Nächsten offenen Entwicklungsschritt A2 begonnen; `DOKU/STARTPROMPT.md`, aktuelle Projektanleitung, Winterplan, jüngste Übergaben und persönliche Doku gelesen. Nach erfolgreichem Fetch steht `origin/main` weiterhin auf `062d8eb`. Offene PRs #26 und #42 geprüft, unverändert gelassen. Branch `codex/a2-build-preflight` angelegt; sämtliche vorherigen uncommitteten Dokumentänderungen erhalten.
- Separaten V2-Kandidaten auf Commit `7380ba9389c46a77d7f77b8e0a21810da46da341` geprüft. 242 versionierte Dateien gegen den unveränderten Git-Index verifiziert und in eine temporäre Prüfkopie übernommen; keine lokalen Geheimnisse, Abhängigkeiten oder Datenbanken kopiert. Ein hängender `git archive`-Versuch wurde abgebrochen, Ursache ungeklärt. Original-V2 und seine zwei vorhandenen unversionierten Dokumentkopien unverändert.
- Frische V2-Installation mit Projekt-pnpm 11.19.0 und `--frozen-lockfile` in neuem Paketstore bestanden, Lockfile unverändert. Passkey-Patch-Prüfung (6/6), sechs Typprüfungen, 109 Tests (31 Domain, 16 Admin, 19 Web, 43 API), Web-/Admin-Build und lokaler Worker-Dry-Run grün. `@lir/mobile sync` erfolgreich; jeweils 24 Web-Dateien bytegleich in Android/iOS übernommen. Das Mobile-Paket besitzt kein natives Build-/Testskript; `pnpm build` erzeugt keine installierbare Handy-App. Web-Karten-Chunkwarnung bleibt als ungeprüftes Geräte-Performance-Thema bestehen.
- Native Versuche tatsächlich ausgeführt: Android `assembleDebug` stoppt vor Kompilierung wegen fehlender Java-Laufzeit; iOS-Simulator-Build stoppt, weil nur Command Line Tools statt Xcode aktiv sind. Android-SDK/`adb`/`sdkmanager` nicht auffindbar. Projekt verlangt Java 21 und SDK 36; Xcode-Anforderung anhand offizieller Capacitor-8-Doku geprüft. Hannes bestätigt nur ein vorhandenes iPhone; Modell/OS und Android-Testgerät offen. Kein Signing, kein installierbares natives Artefakt und keine Geräteabnahme.
- Realm-Referenz aktuell geprüft: Web-/Worker-Typecheck, alle 17 Dateien der Unit-/Struktursuite und Web-Build bestanden; 42 API-Tests sowie Altdatenprüfung über 4 alte + 16 neue Migrationen bestanden. API-Prüfung nach Sandbox-Portfehler mit erlaubtem lokalen Loopback wiederholt; nur temporäre Testkopien/D1-Pfade genutzt, vorhandene Testdaten erhalten. Keine Browser-E2E, Live-Staging-, Push-, Hintergrundortungs-, Last- oder Store-Prüfung in diesem Durchlauf.
- Ergebnis und Anleitung in `docs/NATIVE_BUILD_GATE.md`: Quell-/Lockfilebindung, echte Befehle und Ergebnisse, API-/Identitäts-/Offline-Lücken, Werkzeugvoraussetzungen und noch auszufüllende Geräteabnahme. Winterplan um belegten A2-Zwischenstand ergänzt; **A2 bleibt offen, keine führende Basis gewählt**. Persönliche Erklärung in `../DOKU/NATIVE_TESTS.md`, Einstieg und Aufgabenliste aktualisiert; keine Kostenfreigabe, neuen Konten oder rechtlichen Betreiberentscheidungen.
- Tatsächlich delegiert: Luna Explorer `a2_candidate_audit` für V2-Bestand, Luna Tester `a2_realm_checks` für Realm-Prüfungen, Luna Researcher `a2_toolchain_requirements` für offizielle Werkzeugvoraussetzungen und Astra Reviewer `a2_review` für unabhängige Schlussprüfung. Review ohne handlungsrelevante Befunde; keine erneute Testausführung durch den Reviewer. Root führte den frischen V2-Durchlauf und die Integration der Dokumentation aus.
- Abschlusskontrolle: Der direkte Aufruf des Projekt-pnpm ließ rekursive Unterbefehle zunächst das globale pnpm 11.25.0 finden. Nach explizitem Voranstellen des temporären pnpm-Binärordners liefern auch Unterbefehle 11.19.0; Typprüfungen, 109 Tests, Build und Sync damit erfolgreich wiederholt. Anleitung um diese Versionskontrolle ergänzt. Sechs Dokumente auf lokale Links (27 Ziele), Codeblöcke und Leerzeichen geprüft; `git diff --check` bestanden, Git-Ausschluss der persönlichen Doku bestätigt. Original-V2 weiterhin ohne Änderungen an versionierten Dateien.
- Übergabe: nur Dokumentationsänderungen, lokal auf `codex/a2-build-preflight`; nicht committed, gepusht, gemergt oder deployed. Web-Staging unverändert, kein nativer Geräte-Build und keine Store-Freigabe. Persönliche Doku bleibt außerhalb des öffentlichen Repositorys.
- **Nächster konkreter Schritt:** Hannes richtet Xcode ein und stellt iPhone-Modell/OS sowie Gerät bereit; Entwicklung baut und prüft den V2-Kandidaten auf diesem iPhone. Parallel Android-Werkzeuge (Java 21/SDK 36) und ein echtes Android-Testgerät organisieren. Danach API, Offline-Neustart, Outbox ohne Doppelsendung und Signing auf beiden Geräten protokollieren und erst damit A2 entscheiden. A1/Store-Konten bleiben unabhängig offen.

## Releaseumfang auf iPhone und Website geändert (30.10.2026, Codex)

- Ausdrückliche neue Nutzerentscheidung: Realm als native iPhone-App veröffentlichen; Android und weitere Geräte nutzen die responsive Website. Diese Entscheidung ersetzt die frühere Vorgabe zweier nativer Store-Apps. Google-Play-Konto, Android-Build-/Signing-/Store-Gates und Googles geschlossene Testpflicht aus dem aktiven Winterplan entfernt. Vorhandenen Android-Code und historische Testergebnisse erhalten; keine Codebestände zusammengeführt oder gelöscht.
- A2 bleibt offen: reproduzierbarer echter iPhone-Build mit API, Offline-Outbox, Signing und geprüfter Web-Kompatibilität erforderlich. V2 bleibt Kandidat, Realm Referenz. Hintergrundortung/APNs/native Erinnerungen für iPhone und Browserfunktionen getrennt abnehmen; keine Funktionsgleichheit aller Zugänge behauptet. Zieltermin 22.01.2027 und Apple-/Betreiberfreigaben bleiben bestehen.
- Erstes Testgerät laut Hannes: iPhone 17 Pro Max mit iOS 27. Modell/OS sind Nutzerangaben, noch kein Gerätebefund; genaue Unterversion/Build, Verbindung und Signing offen. USB-Abfrage meldete kein angeschlossenes iPhone. Xcode weiterhin nicht installiert, aktive Umgebung nur Command Line Tools. Für iOS 27 aktuelle Xcode-27-/SDK-Kombination anhand offizieller Apple-Unterlagen vorbereitet; Mac App Store zeigte Xcode 27.1.
- Versuch der Xcode-Einrichtung über die Mac-Oberfläche durch verweigerte macOS-Bildschirmaufnahme blockiert. Keine Installation gestartet, keine Sicherheitseinstellung oder Berechtigung geändert; Hannes um Installation und erstes Öffnen aus dem offiziellen App Store gebeten. Kein weiterer nativer Buildversuch ohne diese Voraussetzung. `pnpm --filter @lir/mobile exec capacitor sync ios` mit pnpm 11.19.0 in der bestehenden temporären Prüfkopie erfolgreich; Anleitung auf diesen iOS-spezifischen Ablauf umgestellt. Original-V2 unverändert.
- Aktualisierte Dateien: `README.md`, `docs/WINTER_RELEASE_PLAN.md`, `docs/NATIVE_BUILD_GATE.md`, dieses Protokoll; außerhalb des öffentlichen Repositorys persönliche `README`, `STARTPROMPT`, `MEINE_AUFGABEN`, `NATIVE_TESTS`, `KOSTEN` und `RECHT`. Die persönliche Kostenübersicht führt Google-Registrierung nicht mehr als geplante Ausgabe; bestehende Cloudflare-Kontoaufnahme unverändert. Keine Konten eröffnet, Verträge abgeschlossen oder Dienste bestellt.
- Delegation: Luna Worker `iphone_release_scope` hat Winterplan und Geräteprotokoll angepasst; Root hat die aktuelle Geräteangabe, Werkzeugprüfung und persönliche Dokumentation integriert. Astra Reviewer `iphone_scope_review` fand einen verbliebenen Android-Buildbefehl im aktiven iOS-Anleitungsblock; dieser wurde entfernt, der historische Fehlversuch bleibt dokumentiert.
- Dokumentprüfung: zehn aktualisierte Dateien, 36 lokale Linkziele, Codeblöcke und Leerzeichen kontrolliert; `git diff --check` bestanden. Persönliche Doku weiter durch die übergeordnete `.gitignore` ausgeschlossen. Original-V2 ohne Änderungen an versionierten Dateien. Keine erneuten App-/API-Suiten für reine Planänderungen.
- Übergabe: weiterhin nur lokale Änderungen auf `codex/a2-build-preflight`, vorherige Arbeit erhalten; nach Fetch `origin/main` weiterhin `062d8eb`, offene PRs #26/#42 unverändert. Nicht committed, gepusht, gemergt oder deployed. Web-Staging unverändert; kein nativer Geräte-Build, keine Store-Freigabe. Die App-/API-Suiten wurden für diese Dokumentationsänderung nicht erneut ausgeführt; frühere Ergebnisse bleiben im vorigen Eintrag datiert.
- **Nächster konkreter Schritt:** Xcode installieren und erstmals öffnen, iPhone 17 Pro Max entsperrt verbinden; anschließend tatsächliche Xcode-/iOS-Version, Gerätesichtbarkeit und Test-Signierung prüfen, V2 nativ bauen und Start/API/Offline/Outbox auf dem iPhone abnehmen. Parallel Web-Browsermatrix prüfen; keine Android-Werkzeuginstallation oder Google-Play-Vorbereitung mehr.

## V2-Geräteversuch, Korrekturen und ausdrückliche Pause (30.10.2026, Codex)

- Tatsächliche Umgebung: Xcode 27.2 (27B52), iPhone 17 Pro Max mit iOS 27.2 (24B115), USB gekoppelt. Hannes aktivierte den Entwicklermodus und erlaubte ausdrücklich die Nutzung seines vorhandenen Personal Teams für den lokalen Test einschließlich Provisionierung. Eine bezahlte Store-Mitgliedschaft ist damit nicht belegt. Das Personal Team unterstützt die im Projekt angeforderte APNs-Fähigkeit nicht; der lokale Testbuild verwendet eine separate gültige leere Entitlements-Plist. Die Release-Entitlements bleiben erhalten.
- **Auf dem iPhone installiert:** separater LIR-Companion-V2-Kandidat, App-ID `app.lircompanion.unofficial`, Version 1.0, Build 1, Basis `7380ba9`. Generischer unsignierter iOS-Build sowie signierter Gerätebuild bestanden. Erstes Profil ohne Gerät und anschließend ungültig versiegelte inkrementelle Ausgabe verworfen; vollständiger Neuaufbau mit frischem DerivedData bestand die Signaturprüfung und enthielt das Gerät im Profil. Installation und Start per `devicectl` Exit 0. Dies ist keine native Ausgabe der aktuellen Realm-Oberfläche.
- **Korrigierter Gerätebefund:** Die erste knappe Nutzerantwort wurde zunächst als Staging-/Offline-Erfolg interpretiert. Die anschließende rein lesende Prüfung fand einen Favoriten und drei Outbox-Einträge ausschließlich für `edition-preview-2027`. Hannes präzisierte Home als „LIR VORSCHAU 2027“ und Künstler Aurora Echo, Moss Circuit, Night Orbit. Damit sind Vorschau-Start und lokale Vorschau-Favoriten belegt, keine Staging-Daten, kein verifizierter Offline-Release und keine serverseitige Outbox-Verarbeitung. Die anfängliche Interpretation ist ausdrücklich zurückgenommen.
- Ursache des nativen API-Ausfalls: Capacitor 8.5 ignoriert `registerPluginType` bei aktivierter automatischer Registrierung; SecureSession stand nicht in der generierten Pluginliste. Die Tokenabfrage scheiterte bereits vor jeder HTTP-Anfrage und der Release-Loader fiel auf die Vorschau zurück. Einzeilige Umstellung auf `registerPluginInstance(SecureSessionPlugin())` lokal vorbereitet und unabhängig anhand des Capacitor-Codes geprüft. Noch kein Gerätenachweis für diese Korrektur.
- **Veröffentlicht:** ausschließlich der separat gefundene und ausdrücklich freigegebene CORS-Fix auf `api-v2-staging.lir-timetable.com`, Worker-Version `3955f395-3c5f-47ea-818f-2291c30485ce` (zuvor `ff1ff728-f223-4ddc-828f-0b2c5224836e`). Drei öffentliche Antwortpfade verwenden den Hono-Kontext statt roher Responses. Regression zuerst rot, danach 43 API-Tests/7 Dateien grün; Typprüfung, Staging-Konfigurationsprüfung und Deployment-Dry-Run bestanden. Live-Health und Release 200/304 liefern die erlaubten CORS-/Vary-/nosniff-Header; fremde Origin bleibt 403. Die 178 Test-Acts und der Release-Hash blieben unverändert. Keine Datenbankmigration, kein V2-Web-/Admin-Deploy, keine Änderung an Realm-Staging, V1 oder Produktion, keine Store-Veröffentlichung.
- Weiterer lokaler V2-Fix: schema-validierter Festival-Release in Dexie (45 Tage), Netzwerk zuerst; Cache-Ausfall verändert einen erfolgreichen Netzwerkabruf nicht. Gespeicherte Daten erlauben lokale Planansicht, aber keine destruktive Editionsbereinigung oder Crew-/Konto-Synchronisierung mit unbestätigter Edition. Unabhängiger Review fand zunächst zwei unzureichend gesperrte Crew-/Settings-Pfade; beide durch Nicht-Mounten im Cachemodus geschlossen. Offline-Regressionsprüfung am alten API-Code schlug fehl; final 33 Webtests/6 Dateien und Web-Typprüfung bestanden, anschließend Web-Build und iOS-Sync erfolgreich. Gate-Tests belegen Mount-Verhalten, keine realen laufenden Geräteanfragen.
- **Build 2:** Version 1.0 (Build 2), mit korrigierter Pluginregistrierung und lokalem Release-Cache, war beim Bearbeiten der Pause bereits fertig (`xcodebuild` Exit 0 / `BUILD SUCCEEDED`). Er liegt unter `/private/tmp/realm-a2-snapshot-oo0oye_6/ios-iphone-build2/Build/Products/Debug-iphoneos/App.app`. Nicht installiert, nicht gestartet, keine Geräteabnahme und keine separate abschließende Signaturprüfung. Auf dem iPhone verbleibt Build 1. Keine weitere Testaufforderung an Hannes.
- **Quellstand erhalten:** Realm auf `codex/a2-build-preflight`, Anwendungs-/Worker-Code unverändert; frühere Dokumentänderungen erhalten. Separates V2 auf neuem lokalem Branch `codex/iphone-a2-validation` von `7380ba9`, drei geänderte Dateien (API-Route, API-Test, Swift-Brücke), vorhandene unversionierte Dokumentkopien erhalten. Die sieben weiteren Web-Änderungen liegen in der temporären Prüfkopie und im zusätzlich gesicherten persönlichen Patch. Keine Änderungen dieses Arbeitsschritts committed, gepusht oder gemergt. Persönliche Belege und beide Patches unter `../DOKU/A2_PATCHES/`; keine privaten Gerätekennungen, Schlüssel oder Profile in den veröffentlichtbaren Dokumenten.
- **Pause und Einordnung:** Hannes hat weitere Implementierung, Deployments und iPhone-Tests bis zur Klärung des Nutzens für Realm ausdrücklich angehalten. Die bisherige Arbeit richtete die wiederverwendbare Mac-/Signing-Umgebung ein und evaluierte/reparierte V2; sie portierte keine Realm-Funktion. Der ausschließlich lesende Vergleich in `docs/ARCHITECTURE_OPTIONS.md` spricht bei Erhalt des heutigen Realm-Umfangs zunächst für Realm plus iPhone-Hülle. V2 als Basis würde zusätzlich Oberfläche, Adminabläufe, Datenmodelle und Authentifizierung betreffen. Empfehlung ist keine Entscheidung oder Umsetzungsfreigabe; A2 bleibt offen.
- Tatsächlich beteiligt: Luna Explorer `ios_build_audit`, Luna Worker `v2_public_cors_fix`, `native_release_cache`, `iphone_build_docs` und Astra Reviewer `v2_cors_review`. Nach der Pause ausschließlich lesend: Luna Explorer `realm_iphone_path_readonly` und `v2_basis_path_readonly`. Nach der Pause keine neuen Builds, App-/API-Suiten, Geräteaktionen oder Veröffentlichungen gestartet; nur bestehendes Build-Ergebnis gelesen, Dokumentation und Sicherungsmanifest aktualisiert.
- **Nächster Schritt ausschließlich:** Hannes entscheidet anhand des Vergleichs über die führende Basis und den zu erhaltenden Realm-Funktionsumfang. Bis dahin technische Umsetzung und Testreihe pausiert. Winterplan, Geräteprotokoll, Startprompt und persönliche Dokumentation halten diese Grenze fest.
- Abschluss der Dokumentation: unabhängige Schlussprüfung der Status-/Vergleichstexte durchgeführt; verbliebene historische Aussagen „V2 unverändert“/„Build ausstehend“ und der ungenaue Pluginname korrigiert. Zehn Dokumente mit 60 lokalen Linkzielen, Markdown-Codeblöcke und JSON-Belege geprüft; `git diff --check` in Realm und V2 bestanden. Persönliche DOKU weiterhin von Git ausgeschlossen. Keine zusätzliche App-/Geräteprüfung in diesem Dokumentationsabschluss.

## Realm als Basis gewählt · erste iPhone-Hülle (31.10.2026, Codex)

- **Neue ausdrückliche Entscheidung:** Realm bleibt mit seiner Oberfläche, seinen Funktionen und seinem Backend die führende Basis und erhält eine iPhone-Hülle. V2 bleibt pausiert. A2a ist damit abgeschlossen; A2b/Geräteabnahme bleibt offen. Frühere Aussagen zur noch offenen Auswahl sind historische Einträge und durch diese Entscheidung ersetzt. Winterplan, Architekturvergleich und persönliche DOKU entsprechend aktualisiert; das frühere Geräteprotokoll ist jetzt ausdrücklich V2-Historie.
- Nach Fetch unverändert aktuelles `origin/main` = `062d8ebf33474fcd55404e9d898d036d42000bdb`; offene PRs #26/#42 gelesen, unverändert. Neuer lokaler Branch `codex/realm-iphone-integration` auf dieser Basis. Vorhandene uncommittete Änderungen an Anleitungen/Plan/Staging/Protokoll erhalten. Keine Quell-, Build-, Geräte- oder Deployment-Aktion im separaten V2-Projekt.
- **Implementiert:** Capacitor Core/CLI/iOS exakt 8.5.3 mit Lockfile, eigenes iPhone-Xcode-Projekt und gebundener Swift-Paketversion. Entwicklungs-App-ID `app.realm.festival`, Realm-Icon aus vorhandenem SVG, dunkler Startbildschirm, Version 1.0/Build 1, iPhone-only. Nach Review Mindest-iOS 16.4 und explizites Safari-16.4-Webbuildziel, passend zur bestehenden CSS/Webfunktionalität. Keine neue Produktoberfläche, API-/Auth-Verträge oder Datenbankmigration.
- `build:ios`/`ios:sync` bauen das vorhandene Realm-Frontend im Staging-Modus getrennt nach `dist-ios/`; die native App lädt gebündelte Dateien, keine `server.url`. Fehlende/relative/unsichere API- oder öffentliche Linkadresse stoppen den Build. `native-build.json` dokumentiert API, Webadresse, Quellcommit und `dirty`. Native Origin dauerhaft `capacitor://localhost`, vorhandene Speicherkeys/Outbox erhalten; Safari-Speicher ist separat. Web-Service-Worker nur im Browser; native Oberfläche liegt bereits im App-Bundle. Crew-/Demo-/Admin-Einladungen zeigen aus der Hülle auf die öffentliche Website; Browserlinks behalten die bisherige Origin.
- **Backendgrenze lokal vorbereitet:** Staging-Allowlist um genau `capacitor://localhost` ergänzt. Erweiterte API-Prüfung nutzt explizite erlaubte Origins und belegt Preflight einschließlich Authorization/Content-Type/X-Festival, öffentliche 200- und unauthentifizierte 401-Antworten sowie fehlendes ACAO für fremde Origins. Keine Worker-Logik-/D1-Änderung. Rein lesender Live-Check auf Realm-Staging: Health 200, aber weiterhin **kein** `Access-Control-Allow-Origin` für iPhone. Der lokale CORS-Stand wurde nicht veröffentlicht; ein frischer nativer API-Start ist deshalb noch nicht möglich.
- **Tatsächlich bestanden:** Web-Typecheck, `test:import` mit 18 Unit-/Strukturdateien einschließlich neuer Native-URL-/Buildwachen, Web-Build; 18 Browser-Smoke-Szenarien inklusive Web-Offline-Neustart, Tab-Synchronisation und kleinen Displays in lokalem Google Chrome über Playwright. Worker-Typecheck, 42 API-Tests und Migrationstest über 4 alte + 16 neue Migrationen in isolierter Kopie mit eigener Test-D1. `npm run ios:sync` und finaler generischer unsignierter iOS-Debug-Build: Xcode 27.2 (27B52), SDK 27.2, Node 26.5.0/npm 11.17.0, `BUILD SUCCEEDED`/Exit 0. iPhone-Gerätefamilie und MinimumOSVersion 16.4 im fertigen Bundle geprüft; alle Webdateien bytegleich zwischen `dist-ios`, Xcode-Quellbundle und App-Artefakt. Web-CI um iPhone-Webbuild ergänzt; noch kein neuer Remote-CI-Lauf. Zusätzlich `npm run test:live` mit allen 28 Mehrbenutzerszenarien in isolierter Kopie bestanden (Exit 0), einschließlich exakter Browser-Einladungsadresse, Beitritt/Freigabe, Chat, Offline-Zustellung, Wiederholungen und Profilwiederherstellung/-löschung. Keine Änderungen an vorhandener lokaler D1.
- **Artefakt:** `/private/tmp/realm-iphone-derived/Build/Products/Debug-iphoneos/App.app`, unsigniert, nicht installiert/gestartet, temporär. Bundlebaum-SHA256 `762d42b291132c84d70109a8b26e45c3922931739306fb984b5081165d282b8f` (sortierte relative Dateipfade, NUL, Dateiinhalt, NUL; 77 Dateien); ausführbare Datei `App` SHA256 `4d94c30f9cf3ea9bb616822be4bdc96b98edf23e7aff32961df2c036cc69b4d3`. Quellbasis `062d8eb` mit lokalen Änderungen, kein bereits festgeschriebener Release-Commit.
- **Prüfgrenzen und Werkzeugbefunde:** Kein Signing/Provisionieren, keine Realm-Geräteinstallation, kein Simulatorlauf, keine native API-/Offline-/Outbox-/Push-/Hintergrundstandort-/Keychain-Abnahme, keine neue WebKit-/Firefox-/A11y-/Lastprüfung. Die ersten Browserstarts scheiterten am fehlenden Headless-Paket bzw. unvollständigen Chromium-Cache; Tests und Icon-Rasterung anschließend mit vorhandenem Google Chrome erfolgreich. Lokale Wrangler-Ports benötigten Sandbox-Freigabe; vorhandene lokale D1-Daten blieben erhalten. `npm audit` meldet sechs moderate transitive CLI-Entwicklungsabhängigkeiten; kein erzwungener Major-Downgrade oder ungeprüfter Override. Details/weitere native Funktionsgrenzen in `docs/IPHONE_INTEGRATION.md`.
- **Delegation und Review:** Luna Explorer `native_boundary`, Researcher `capacitor_facts`, Worker `plan_update` und `native_cors`, Tester `backend_checks`; Astra Reviewer `integration_review`. Reviewer fand die zu niedrige iOS-Mindestversion; auf 16.4 korrigiert, ausdrücklich nachgeprüft und neu gebaut. Keine weiteren handlungsrelevanten Reviewbefunde im Umfang des ersten Integrationsschritts. Root integrierte Code, Assets und Dokumentation.
- **Übergabe:** Änderungen an Paket-/Build-/CI-Konfiguration, `ios/`, kleinen Plattform-/Linkgrenzen, Worker-CORS-Konfiguration/-Tests, Readme/Plan/Integrationsleitfaden und persönlicher DOKU liegen nur lokal, uncommitted, ungepusht und undeployed. Persönliche DOKU bleibt außerhalb des öffentlichen Repositories und Git-ausgeschlossen. Finale Whitespace-/Dokumentlinkprüfung bestanden. Web-Staging, V2 und Store unverändert.
- **Nächster konkreter Schritt:** vorbereitete Realm-Staging-CORS-Änderung nach Review gezielt veröffentlichen und live nachweisen; danach Realm signiert installieren und Start/echte API-Daten, Flugmodus/Prozessende/Neustart und Outbox-Wiederverbindung serverseitig ohne Duplikate auf dem iPhone abnehmen. Sichere Sitzung, Teilen/Clipboard, ICS-Export, Universal Links und native Erinnerungen anschließend gezielt integrieren/prüfen. A2b bleibt offen; V2 bleibt pausiert.

## Realm-Staging freigegeben und iPhone-Testbuild installiert (31.10.2026, Codex)

- **Ausdrücklicher Auftrag:** vorbereitete API-Freigabe auf Realm-Staging veröffentlichen, Realm installieren und anschließend echte API-/Offline-/Outbox-Abläufe prüfen. V2 bleibt pausiert. Aktueller Branch `codex/realm-iphone-integration`, Basis und erneut geprüftes `origin/main` weiterhin `062d8ebf33474fcd55404e9d898d036d42000bdb`; offene PRs #26/#42 unverändert. Vorhandene lokale Änderungen erhalten.
- **Veröffentlicht:** ausschließlich die Realm-Staging-Einstellung `ALLOWED_ORIGINS` um `capacitor://localhost` ergänzt, neben der bisherigen Web-Origin. Cloudflare-Settings-PATCH mit vollständiger, vorher und nachher geprüfter Bindungsliste; D1-Bindung erhalten. Version `52a1aed1-473f-48f8-8aff-cf3a1d9e4e85` durch `bab7d612-aef8-4c5b-ab9f-2e7092c23919` ersetzt, Deployment `fde57f46-8757-4099-baf5-2a6c009b7279` am 31.10.2026 um 04:55:02 UTC zu 100 %. Kein Worker-/Web-Quellupload, keine Migration, keine Produktion oder V2-Veröffentlichung.
- **Live-Prüfung bestanden:** zwölf Kombinationen aus nativer, Web- und fremder Origin mit Preflight 204, Festival-GET 200, fehlender Authentifizierung 401 und fehlender Route 404. Nur erlaubte Origins erhalten passendes ACAO; Preflight erlaubt Authorization, Content-Type und X-Festival. Worker-Modulhash unverändert `57841d4a2aa2e302870eba32c6ef18e4ece5daa0bfb305e99a254e3bec9cdf43`; Web-Buildinfo, Index und Festivalantwort bytegleich, ebenso Asset-Routing, Zeitpläne und D1-Bindung. Öffentliche HTTP-Prüfungen vom Mac sind noch kein App-API-Nachweis.
- **Signiert und frisch installiert:** Realm 1.0/Build 1 (`app.realm.festival`) für iPhone 17 Pro Max/iOS 27.2 (24B115), Xcode 27.2 (27B52), Mindest-iOS 16.4. Hannes hat Entwicklermodus einschließlich Bestätigung nach Neustart aktiviert. Vollständiger signierter Neuaufbau mit vorhandenem lokalem Team in frischem DerivedData erfolgreich; `codesign --verify --deep --strict` bestanden, Zielgerät im eingebetteten Profil enthalten. Vor Installation per Bundle-ID keine vorhandene Realm-App gefunden; erneute Prüfung unmittelbar vor Installation sichert die frische Installation ab. `devicectl` meldet Installation erfolgreich. Signatur-/Teamdaten und Gerätekennungen bleiben privat; bezahlte Apple-Mitgliedschaft ist dadurch nicht belegt.
- **Installiertes Artefakt:** `/private/tmp/realm-iphone-signed-final/Build/Products/Debug-iphoneos/App.app`, 81 Dateien, Bundlebaum-SHA256 `67a6389e14fcf2a3435f7f330a19fbce7fdad55a07ab20e5154a494022b555e5`. `native-build.json` nennt Staging als API-/Webziel, Quellbasis `062d8eb` mit `dirty: true`, Buildzeit 31.10.2026 04:28:11.718 UTC. Dies ist ein lokaler Testbuild, kein festgeschriebener Release-/Store-Build.
- **Geräteprüfung noch offen:** Hannes wurde gebeten, für den ersten Start Flugmodus einzuschalten und WLAN auszuschalten; die Beobachtung des Fehler-/Leerzustands steht aus. Eine anschließend rein lesend kopierte Realm-App-Library enthält keine Realm-Speicherdateien oder -Keys. Das belegt weder erfolgreichen Start noch Offline-Verhalten. Echte Festival-API, Profil/Crew, Favorit, persistierte Offline-Nachricht nach Prozessende und genau einmalige serverseitige Zustellung sind weiterhin unbestätigt. Keine Vorschau oder Installation wird als bestandener Laufzeittest gezählt. A2b bleibt offen.
- **Dokumentation und Prüfgrenzen:** `docs/STAGING.md`, `docs/IPHONE_INTEGRATION.md`, `docs/WINTER_RELEASE_PLAN.md` und persönliche DOKU aktualisiert. Bereinigte Deployment-/Signatur-/Installationsbelege liegen ausschließlich in der Git-ausgeschlossenen persönlichen DOKU; rohe Geräte-/Kontodaten bleiben privat. Für diese Einstellungsbereitstellung und Dokumentation wurden die früheren Web-/API-/Migrationstests nicht erneut ausgeführt. Die aktuellen Prüfungen sind Live-CORS, Unverändertheitsvergleich, signierter Build, Signatur-/Profilprüfung und Installation; kein Simulator-, Store- oder vollständiger Native-Abnahmelauf.
- **Delegation:** Luna Researcher `staging_patch_audit`, Explorer `device_test_design`, Worker `staging_handover`; Astra Reviewer `deployment_review` prüfte die gezielte Veröffentlichung unabhängig. Root führte den Settings-PATCH, Vorher-/Nachherprüfung, Signing und die frische Installation durch. Das erste Installationskommando wurde automatisch abgelehnt, weil es vorhandene App-Daten nicht vor Überschreiben absicherte; die getrennte Bestandsprüfung und eine unmittelbar erneut geprüfte Leerliste vor Installation lösten diesen Punkt ohne Datenverlust.
- **Quellstand und nächster Schritt:** Quell-/Dokumentänderungen weiterhin lokal, uncommitted und ungepusht; nur die beschriebene Staging-Einstellung ist veröffentlicht. Der aktuelle main-Quellstand enthält noch die alte Allowlist. Vor dem nächsten regulären Pipeline-Deploy muss die geprüfte CORS-Quelländerung integriert sein, sonst könnte die native Origin zurückgesetzt werden. Zunächst den ersten Offline-Start beobachten, danach echte API-Daten laden und eine markierte Offline-Nachricht über App-Neustart bis zu genau einer Servernachricht verfolgen. V2 unverändert pausiert.
- **Abschlussreview und Dokumentprüfung:** Unabhängiger Review bestätigte Versions-, Signing- und Installationsbelege; die Beschreibung des Unverändertheitsvergleichs wurde auf die tatsächlich geprüften Dateien, Einstellungen und Bindungen eingegrenzt. Kein vollständiger Vergleich aller statischen Assets oder D1-Daten behauptet. `git diff --check` bestanden; 55 lokale Linkziele in sieben aktuellen Anleitungen gültig, Codeblöcke geschlossen und persönliche DOKU weiterhin Git-ausgeschlossen. Die erforderliche Nutzerbeobachtung für den Offline-Erststart steht weiterhin aus.

## Realm-Gerätetest · Offline-Start, Cache und Outbox belegt (31.10.2026, Codex)

- **Ausgangslage frisch geprüft:** `origin/main` nach Fetch jetzt `e7ddf7d` (PR #42 integriert), offene PRs #26/#44. Bestehender Branch `codex/realm-iphone-integration` auf `062d8eb` mit allen vorhandenen lokalen Änderungen erhalten. Für diesen Test bewusst den bereits installierten Realm-Build 1 verwendet; kein neuer Quell-/Buildstand hergestellt oder mit `main` zusammengeführt. Der veraltete globale Pause-Hinweis am Anfang dieses Protokolls ist auf die Entscheidung vom 31.10. korrigiert; V2 bleibt pausiert.
- **Vorprüfung:** zwölf aktuelle öffentliche Staging-CORS-Fälle bestanden (native/Web/fremde Origin; Preflight 204, Festival 200, fehlende Authentifizierung 401, fehlende Route 404). Öffentliche Web-Buildinfo weiterhin `062d8eb`, `dirty: false`; Festival `realm-open-air` mit 59 Test-Acts. Kein belegtes Winterprogramm. Auch `e7ddf7d` enthält noch die Web-only-Allowlist: Die CORS-Quelländerung muss vor dem nächsten regulären Pipeline-Deploy integriert werden.
- **Build unverändert:** iPhone 17 Pro Max/iOS 27.2 verbunden, Entwicklermodus aktiv; Geräteabfrage bestätigt installierte App `app.realm.festival`, Version 1.0/Build 1. Vorhandenes App-Artefakt weiterhin 81 Dateien, SHA-256 `67a6389e14fcf2a3435f7f330a19fbce7fdad55a07ab20e5154a494022b555e5`. Alle 53 `dist-ios`-Dateien entsprechen ihren Gegenstücken im Bundle (zusätzlich dort zwei Cordova-Dateien). `npm run test:native` bestanden. `codesign --verify --deep --strict` scheiterte innerhalb der Sandbox mit `CSSMERR_TP_NOT_TRUSTED`, bestand außerhalb derselben mit Exit 0; keine Zertifikats-/Vertrauenseinstellung geändert.
- **Erster Offline-Start:** Hannes beobachtete im Flugmodus mit ausgeschaltetem WLAN „Festival nicht erreichbar“ mit „Erneut versuchen“. Die erste neue App-Library-Kopie enthielt keine Realm-Schlüssel. Dieser UI-Nachweis stammt aus seiner Antwort; kein Screenshot oder nativer HTTP-Mitschnitt aufgenommen.
- **API-Download belegt:** Nach Netzrückkehr und Retry enthielt die App erstmals `realm.bundle:realm-open-air`, inhaltlich identisch zur aktuellen Staging-API (59 Acts), sowie genau einen Favoriten. Der API-Beleg ist die frisch entstandene native Speicherkopie mit Serververgleich, nicht nur ein angezeigter Festivalname. Alle vier Hauptansichten wurden nicht ausdrücklich als geprüft bestätigt.
- **Offline-Prozessneustart bestanden:** Hannes legte eine eigene Staging-Testcrew an und schrieb offline genau eine synthetische Nachricht. Vor Neustart: eine persistierte Nachrichtenaktion, serverseitig noch 0 Treffer. Nach `devicectl ... launch --terminate-existing app.realm.festival` (Exit 0) dieselbe Plan-Prüfsumme und dieselbe Outbox-ID-Prüfsumme, weiterhin 0 Servertreffer. Hannes bestätigte, dass Favorit und „Wird gesendet …“ sichtbar erhalten blieben.
- **Wiederverbindung und Duplikatprüfung bestanden:** Nach Netzrückkehr bestätigte Hannes den gesendeten Zustand. App-Speicher: Outbox 0, Favorit unverändert; authentifizierter Crew-GET: dieselbe Aktions-ID und der Testmarker jeweils genau einmal. Nach weiterem Online-Prozessneustart (Exit 0) erneut Outbox 0 und genau eine Servernachricht. Nachweiskette: Outbox **1 → 1 → 0 → 0**, Server **0 → 0 → 1 → 1**. Die frische Testcrew lieferte insgesamt 0 bzw. 1 Nachricht; der API-Endpunkt ist auf die neuesten 200 begrenzt.
- **Nebenwirkungen und Grenzen:** Über die App entstanden Testprofil, Testcrew und eine synthetische Staging-Nachricht; diese bleiben erhalten. Die Verifikations-GETs ändern keine Nachrichten, können aber `last_seen` aktualisieren. Keine Migration, keine Neuinstallation, kein Signing-/Web-/Worker-Deploy, keine Produktion oder Store-Veröffentlichung. Ein Gerät, ein Offline-Zyklus und ein zusätzlicher Online-Neustart; kein Dauertest oder allgemeiner Zustellgarantienachweis. Sichere Sitzung/Keychain, native Dienste und vollständige Bedien-/Browser-Abnahme bleiben offen. A2b und B4 nicht abgehakt.
- **Dokumentation und Delegation:** Integrationsleitfaden, Winterplan, Staging-Hinweis, dieses Protokoll sowie persönliche README, STARTPROMPT, MEINE_AUFGABEN und NATIVE_TESTS aktualisiert. Bereinigte JSON-Nachweise liegen ausschließlich in der Git-ausgeschlossenen persönlichen DOKU; rohe App-Kopien bleiben privat unter `/private/tmp/realm-runtime-checks/`. Luna Explorer `iphone_runtime_path` untersuchte Ablauf/Speichergrenzen, Luna Tester `installed_build_checks` prüfte URL-Wachen und vorhandenes Artefakt; Astra Reviewer `runtime_evidence_review` prüfte Methodik und Dokumentation. Der Reviewhinweis auf das mögliche Auth-Aktivitätsupdate wurde berücksichtigt. Root führte Geräte-/Serverabgleiche und Dokumentintegration aus; Hannes führte Netzumschaltung und UI-Schritte aus.
- **Prüfgrenzen:** Für diesen Geräte-/Dokumentationsschritt keine erneuten vollständigen Web-/Worker-/API-/Migrations-/Browser-Suiten, kein Build oder `ios:sync`; Anwendungscode unverändert. Aktuelle Prüfungen sind die oben genannten CORS-/Artefakt-/Native-Guard-/Gerätefälle. Frühere breite Suiten bleiben historische Nachweise.
- **Übergabe:** Nur die genannten Dokumente und privaten Prüfbelege dieses Schritts lokal geändert; nichts committed, gepusht, gemergt oder veröffentlicht. Der installierte native Build ist unverändert und nun im beschriebenen Umfang geprüft. Vorhandene fremde/lokale Änderungen bleiben erhalten; V2 unberührt.
- **Nächster konkreter Schritt:** Entwicklung und Hannes prüfen Home/Line-up/Karte/Crew auf dem iPhone systematisch auf Safe Areas, Tastatur, große Schrift und Rückkehr aus dem Hintergrund. Anschließend die nativen Integrationsgrenzen einzeln schließen und abnehmen. Unabhängig davon vor jedem nächsten Pipeline-Deploy den aktuellen `main` mit der geprüften CORS-Quelländerung sichern; keinen automatischen Merge veranlassen.
- **Abschlusskontrolle:** Unabhängiger Schlussreview des tatsächlichen Dokument-Deltas und der bereinigten Nachweise ohne weitere Befunde. Acht Dokumente mit 61 lokalen Linkzielen und zehn neue JSON-Belege einschließlich verknüpfter Einzelbelege geprüft; Codeblöcke, Whitespace und `git diff --check` bestanden. Git-Ausschluss der persönlichen DOKU erneut bestätigt.


## Realm-Bedienprüfung · Hauptansichten, Hintergrund und Tastaturbefund (31.10.2026, Codex)

- **Umfang und Ausgangslage:** Auf ausdrücklichen Nutzerwunsch A2b am vorhandenen Realm 1.0/Build 1 fortgesetzt: iPhone 17 Pro Max/iOS 27.2, Hochformat. Aktueller Fetch bestätigt `origin/main` `e7ddf7d`, offene PRs #26/#44. Branch `codex/realm-iphone-integration`, Basis `062d8eb` mit sämtlichen vorhandenen Änderungen erhalten. Geräte-/App-Abfragen bestätigen die verbundene installierte Realm-App; kein neuer Build, kein Sync und keine Installation.
- **Vier Ansichten und Bildschirmränder:** Hannes bestätigte Home, Line-up, Karte und Crew einschließlich Scroll-Enden, Act-/Ortsdetails und Crew-Chat als bedienbar, ohne verdeckte oder abgeschnittene Ränder. Gilt für seine bisherige Schriftgröße im Hochformat auf diesem Gerät; Nutzerbeobachtung, keine flächendeckende Screenshot-Abnahme.
- **Tastatur fehlgeschlagen:** Nach Eingabe eines synthetischen Chatentwurfs war die Oberfläche verschoben/vergrößert; Geräteaufnahme zeigt abgeschnittenen Senden-Knopf rechts und nicht sichtbaren Chatkopf. Nach Schließen der Tastatur blieb der Fehler laut Hannes und zweiter Aufnahme bestehen. Ein Prozessneustart stellt Home wieder normal dar, behebt die Ursache aber nicht. Line-up- und Karten-Suchfelder wurden in der Antwort nicht einzeln bestätigt.
- **Unerwartetes Absenden:** Der nur als Entwurf vorgesehene Testtext erschien nach Schließen als Chatnachricht. Hannes bestätigt, ausschließlich das Häkchen über der Tastatur betätigt zu haben. Der Code sendet über Formular-Submit; implizites Submit per Enter ist möglich, ein eigener Blur-Sendehandler existiert nicht. Ohne Ereignismitschnitt ist die konkrete iOS-Ereignisfolge offen. Keine Ursache als bewiesen behandelt, keine weitere Nachricht durch Codex gesendet; der angezeigte Zusatztext bleibt als Testdaten erhalten. Keine separate Serverzustellprüfung für diese Nachricht.
- **Große Schrift teilweise geprüft:** Hannes meldet sichtbares Textwachstum und lesbare übrige Ansichten/Details, beanstandet aber den Chat. Seine bereitgestellte Aufnahme zeigt sämtliche Chatbedienelemente vollständig, die Eingabe jedoch weit über dem unteren Rand mit großer Leerfläche darunter. Chatlayout weiter ungeklärt. Die genaue iOS-Stufe und ein kontrollierter Home-Schriftvergleich sind nicht unabhängig belegt. Die ursprüngliche Textgröße ist laut Hannes wiederhergestellt. A2b und B4 bleiben offen.
- **Hintergrundrückkehr als UI-Teiltest bestanden:** Hannes bestätigt alle vier Ansichten nach jeweils etwa 10 Sekunden über den Home-Bildschirm sowie das Act-Detail nach etwa 30 Sekunden Sperren/Entsperren als erhalten und bedienbar. Kein erfasster Lebenszyklus und keine unabhängig gemessenen Zeiten. Die spätere lesende Prozessabfrage (Exit 0, genau ein Treffer für Realm) fand eine andere Prozesskennung als die frühere Vergleichsmessung. Der Messabstand umfasst auch Textgrößenänderungen und Wartezeit; Zeitpunkt und Ursache des Wechsels bleiben offen. Daher keine Behauptung ununterbrochener Prozesslaufzeit und keine Zuordnung dieses Wechsels zum Hintergrundtest. Die zwei diagnostischen Neustarts zählen nicht als Hintergrundtest; ein Chatentwurf bleibt wegen des bekannten Tastaturfehlers bis zur Korrektur ausgeklammert.
- **Diagnosegrenze und Delegation:** Luna Explorer `iphone_ui_boundaries` prüfte CSS, Bedienpfade und Formularereignisse; Luna Researcher `ios_input_text_diagnosis` prüfte Capacitor-/WebKit-Grenzen und Primärquellen. Geerbte 15px-Eingabeschrift, `100dvh`-Hülle und das scrollbare Sheet sind Anhaltspunkte, kein Ursachennachweis. Für die Korrektur zuerst Fokus-/Blur-/Submit-Ereignisse und Visual-Viewport-Größe, Offset und Skalierung messen; keine pauschale Plugin-Umarbeitung. Root führte Geräteaufnahmen, Neustarts und Dokumentation aus; Hannes bediente das iPhone. Astra Reviewer `iphone_ui_review` prüfte den tatsächlichen Dokumentdelta unabhängig.
- **Dokumentation und Grenzen:** Dieses Protokoll, Integrationsleitfaden, Winterplan sowie persönliche README, STARTPROMPT, MEINE_AUFGABEN und NATIVE_TESTS aktualisiert. Nutzerantworten und vier bereinigte Geräteaufnahmen sind im privaten `realm-ui-evidence-2026-10-31.json` verknüpft. Unpassende Aufnahmen mit fremdem Bildschirminhalt bzw. Crew-Zugangscode nicht in die dauerhaften Belege übernommen. Keine Tokens, Gerätekennung oder Crew-Codes in öffentlichen Dokumenten. Anwendungscode unverändert; deshalb keine erneuten Web-/API-/Browser-Suiten, Builds, CORS- oder Signaturprüfungen. Frühere Prüfungen bleiben datierte historische Nachweise.
- **Übergabe:** Änderungen dieses Bedienlaufs ausschließlich lokale Dokumentation und private Belege; nicht committed, gepusht, gemergt oder deployed. Installierter Realm-Build unverändert, V2 unberührt und pausiert. Die bereits dokumentierte CORS-Quellintegration bleibt Voraussetzung vor einem regulären Pipeline-Deploy.
- **Nächster konkreter Schritt:** Den bestätigten Tastatur-/Sendefehler mit Fokus-/Viewport-/Submit-Messungen gezielt eingrenzen, korrigieren und auf dem iPhone samt Suchfeldern, Chat bei großer Schrift und Hintergrundwechsel mit Chatentwurf nachtesten. Weitere native Integrationen und B4-Fälle bleiben getrennte Aufgaben.
- **Abschlusskontrolle der Bedienprüfung:** Reviewhinweis zur überholten Prozesskennung im privaten Beleg behoben und im Schlussreview bestätigt; keine weiteren handlungsrelevanten Befunde. Sieben Dokumente mit 60 lokalen Linkzielen, geschlossene Codeblöcke und Whitespace geprüft; JSON gültig und vier Screenshot-Prüfsummen passend. Der ergänzte Großschriftbefund wurde ebenfalls unabhängig ohne neue Befunde geprüft. `git diff --check` bestanden, private DOKU weiterhin Git-ausgeschlossen. Die abschließenden Nutzerantworten zu Rückstellung und Hintergrund sowie die begrenzte Prozessvergleichsaussage sind oben und im privaten Beleg ergänzt; auch dieser Abschlussdelta wurde unabhängig ohne neue Befunde geprüft.


## A2b · Crew-Chat-Korrektur und Gerätevergleich (13.11.2026, Codex)

- **Quellstand:** STARTPROMPT, Projektunterlagen und persönliche Doku frisch gelesen; Fetch auf `origin/main` `a08bef99194663a8ef257d286283321c51affde8`, nur PR #26 offen. Vorhandene Änderungen gesichert und auf `codex/realm-chat-keyboard` mit aktueller main-Basis übertragen; Paket-Skriptkonflikt unter Erhalt der neueren Tests aufgelöst. Keine fremden Änderungen verworfen. Web-Staging liefert `a08bef9`, gebaut 12.11., clean.
- **Lokale Korrektur:** Crew-Chat sendet ausschließlich durch Aktivierung des Senden-Knopfs; kein implizites Formular-Submit, Enter/Blur erhalten den Entwurf. Eigene scrollbare Nachrichtenhistorie, am Chatbereich ausgerichtete Eingabe, mindestens 16px Eingabeschrift mit Wachstum. Nach dem ersten Gerätenachtest zusätzlich `useChatKeyboard`: ausschließlich das native Crew-Sheet an den unskalierten sichtbaren Bereich oberhalb der Tastatur anpassen; Pan über Geräte-Clientrect kompensieren, Safe Area oben beachten und normale Ränder nach Schließen wiederherstellen. Zeitversetzte Höhen-/Pan-Rückstellung berücksichtigt. Keine globale Hüllenänderung, Zoomsperre oder zusätzliche Keyboard-Bibliothek.
- **Regressionen und Prüfungen:** Alter Chat scheitert mit `Enter cleared the unsent draft`; erster Fix scheitert im ergänzten Test an Sheetoberkante −338,52px bei 440×541 sichtbarem Bereich. Finale fünf Chat-Browserfälle bestanden mit Exit 0: explizites Senden, Enter/Blur, lange Historie/320px, geerbte 22px-Schrift, Höhenwechsel, simulierte native Pan-/Viewport-Geometrie, getrennte Rückstellereihenfolge, bewusster Zoom und Aufräumen beim Sheetwechsel. Simulation ist kein iOS-Tastaturnachweis. Ein Test las die Profilanimation zu früh; der Check wartet jetzt auf sichtbare Geometrie. Typprüfung, finale Web-/iOS-Bundles und `git diff --check` bestanden. Vor dem ergänzten nativen Höhenpatch bestanden außerdem `test:import` inklusive Native-Guards, alle 18 Chrome-Smoke-Fälle und Barrierefreiheitssuite ohne schwerwiegende Befunde. Playwright-Headless-Shell fehlte; vorhandenes Google Chrome über `CHROMIUM_PATH` verwendet. CI-Einbindung für Chromium/Firefox/WebKit ergänzt; Remote-CI/andere Browser und vollständige Worker-/API-/Migrations-/Live-Suiten nicht wiederholt.
- **Signierte Gerätebuilds:** Realm 1.0 Builds 2, 3 und 4 jeweils gebaut, mit `codesign --verify --deep --strict` geprüft, je 54 Webdateien bytegleich zum Bundle nachgewiesen und nacheinander als Update installiert; Versionen per Geräteabfrage bestätigt. Keine App-Daten gelöscht. Aktuell installiert **Build 4**. Private Artefakt-/Versionsbelege liegen in DOKU; temporäre Apps unter `/private/tmp/realm-keyboard-{baseline,fix,fit}-ios/Build/Products/Debug-iphoneos/App.app`. CLI-Buildnummern 2/3/4 überschreiben die noch unveränderte Projekt-Buildnummer 1; dies sind lokale Staging-Testbuilds, keine Store-Artefakte.

| Gerätefall | Tatsächlicher Befund |
| --- | --- |
| Build 2, bisheriger Chat | 15px-Eingabe, Fokuszoom 1→1,0659, sichtbare Breite 440→413; Senden abgeschnitten, Kopf weg. Nach Häkchen laut Hannes weiter verschoben. Später selektiv wiedergewonnener Diagnoseverlauf bestätigt Blur, weiterhin Skalierung 1,0659 und Scroll/Offset 59. Im **leeren** Häkchen-Versuch kein Keydown oder Submit; Ursache des unerwarteten Versands vom 31.10. damit nicht bewiesen. |
| Build 3, erster Fix | 16px und Skalierung 1; nach Blur wieder 440×956, Scroll/Offset 0. Bei Tastatur jedoch Hülle 956px hoch, Pan 415px, Sheetoberkante −339px. Hannes präzisiert seine erste pauschale Sichtbarkeitsantwort: Kopf und Nachrichten verschwinden nach oben. Deshalb keine vollständige Abnahme. |
| Build 4, ergänzter Höhenfix | Nutzerbestätigung, sofort beim Fokus aufgenommener Screenshot und Messwerte stimmen überein: Kopf, Schließen, Nachrichten, Eingabe und Senden sichtbar. Sheet y=62…541 (Höhe 479), Eingabe/Senden bis y=533 bei sichtbarer Höhe 541; 16px, Skalierung 1. Nach Blur normale 956px-Höhe und Scroll/Offset 0. |
| Build 4, nichtleerer Entwurf | Hannes bestätigt: „Realm Entwurf 4“ bleibt nach ausschließlich dem weißen Häkchen in der Zubehörleiste im Eingabefeld, keine neue Nachrichtenblase, Ansicht normal. Nutzerbeobachtung; kein Serverzustellcheck. Eine zusätzlich sichtbare kurze Nachricht wurde laut Hannes bewusst über Senden verschickt. |

- **Bedienpaket abgeschlossen:** Hannes bestätigt in Build 4 den Erhalt von Entwurf/Nachrichten und die Bedienbarkeit nach etwa 10 Sekunden Home-Bildschirm sowie etwa 30 Sekunden Sperre; beide Suchfelder (Line-up und Karte) ohne Verschiebung. Beim angeforderten Maximum der app-spezifischen iOS-Schrift meldet er sichtbares Textwachstum und lesbare/erreichbare vier Ansichten samt Details und Chat. Die Chataufnahme zeigt alle Bedienelemente sowie den erhaltenen Entwurf. Der ursprüngliche Textwert ist anschließend ausdrücklich als wiederhergestellt bestätigt. Das sind Nutzerbeobachtungen plus begrenzte Aufnahmen/Messungen; exakte Textkategorie/Skalierungszunahme, durchgehende Prozesslaufzeit und ein kontrollierter Schriftvergleich sind nicht unabhängig belegt. Ein Gerät im Hochformat; keine pauschale Accessibility-/A2b-/B4-Abnahme.
- **Diagnose und Datenschutz:** Maximal 300 lokale Ereignis-/Viewport-/Geometriemesswerte im eigenen Schlüssel `realm.debug.keyboard.v1`, keine Eingabetexte, Nachrichten, Tokens oder Gerätekennungen. Build 4 enthält zusätzlich streng bereinigten Wiederabruf nur dieses Diagnosekeys beim Start; 64 frühere Messwerte wurden so wiedergewonnen. Syntaxprüfung, isolierter VM-Test mit 330 manipulierten Einträgen (Begrenzung, kein Sentinel-Leck, ausschließlich Diagnose-Key) und unabhängiger Review bestanden. Zeit-/Fontwerte sind im neuen Format numerisch. Normales `build:ios` entfernt die ausdrücklich injizierte Diagnose aus dem Bundle; gespeicherte Diagnosewerte bleiben davon unberührt. Eine Vollkopie der App-Library wurde von der automatischen Freigabeprüfung wegen möglicher Chats/Tokens abgelehnt und **nicht ausgeführt**. Die sichere Alternative verwendet nur gefilterte Diagnosewerte. Eine Aufnahme außerhalb von Realm wurde verworfen. Konsolenverbindungen endeten teils mit Exit 0; keine Absturzursache oder durchgehende Prozesslaufzeit daraus behauptet.
- **Staging tatsächlich geändert:** Native Origin war nach neuerem Web-Deploy wieder entfernt. Autorisiertes Settings-PATCH stellt `capacitor://localhost` neben der Web-Origin wieder her; 12/12 CORS-Fälle bestanden. Worker-Modulhash, D1-Bindung, Zeitpläne und drei öffentliche Antworten unverändert; einzige weitere Settings-Differenz Deployment-Metadatum `workers/triggered_by`: `version_upload`→`upload`. Kein Code-/Asset-Upload oder Migration; kein vollständiger Assets-Routing-/D1-Inhaltsvergleich. Lokale Quelländerung vor nächstem Pipeline-Deploy integrieren, sonst erneute Rücksetzung möglich.
- **Delegation und Review:** Luna Explorer `keyboard_layout_audit` untersuchte Layout und native Geometrie; Luna Worker `chat_regression` baute rote/grüne Regressionen, `keyboard_probe` Diagnose/Datenschutzcheck und Signing-Abgleich; Luna Researcher `staging_settings_patch` klärte Cloudflare- und Viewport-Grenzen. Astra Reviewer `chat_keyboard_review` prüfte Code, Datenschutz, Testabdeckung und Geräteaufnahme. Hinweise zu Fontprüfung, CI und versetzter Höhen-/Pan-Rückstellung eingearbeitet; letzter Nachreview ohne neue Befunde. Root verantwortet Integration, UI-Fix, Builds, CORS und Geräteabgleich.
- **Übergabe:** Lokal geändert, nichts committed/gepusht/gemergt. Web-Code nicht neu deployed; ausschließlich autorisierte Staging-Einstellung live geändert. Build 4 auf dem eigenen iPhone installiert und im oben angegebenen Teilumfang geprüft. V2 unberührt. A2b/B4 und Store-Freigabe offen; der 6.-November-Prüfpunkt ist noch keine vollständige A2b-Abnahme. Persönliche DOKU bleibt Git-ausgeschlossen.
- **Nächster konkreter Schritt:** Native Sitzungs-/Tokenablage und Logout/Profilwechsel/Neustart prüfen und die offene sichere Sitzung/Keychain-Integration gezielt schließen. Danach Teilen/Clipboard, Kalenderexport, Universal Links und native Erinnerungen einzeln abnehmen. Vor regulärem Web-Deploy die geprüfte CORS-Quelländerung integrieren; keinen automatischen Merge auslösen.

- **Abschlussdokumentation:** Fortschrittsprotokoll, Winterplan, iPhone-/Staging-Leitfaden und persönliche README/STARTPROMPT/MEINE_AUFGABEN/NATIVE_TESTS aktualisiert. Veraltete aktive Build-1-/Tastatur-Nächste-Schritte als historisch eingeordnet; aktuelle Geräteversion ist Build 4. Bereinigte Mess-, Build- und Bildbelege ausschließlich in der privaten DOKU.
- **Abschlusskontrolle:** Acht Dokumente mit 66 lokalen Linkzielen und geschlossenen Codeblöcken geprüft; elf im privaten Gesamtbeleg verknüpfte Dateien mit passenden SHA-256-Prüfsummen. Unabhängiger Abschlussreview ohne handlungsrelevante Befunde. `git diff --check` bestanden, DOKU weiterhin Git-ausgeschlossen.


## Gemeinsamer Realm-Stand · PR #53/#26 und iPhone-Korrekturen (16.11.2026, Codex)

- **Auftrag und Ausgangspunkt:** Hannes hat Prüfung und Zusammenführung der offenen PRs #53/#26 mit sämtlichen lokalen Realm-iPhone-Korrekturen ausdrücklich freigegeben. Frisch abgerufenes `origin/main`: `a08bef9`. Die 49 geänderten/neuen Quelldateien wurden vor der Integration separat gesichert und als `0fd63fe` auf `codex/realm-shared-2026-11-16` committed; keine vorhandene Arbeit verworfen und keine private DOKU veröffentlicht.
- **PR #53:** Head `4df944c` mit Merge-Commit `13aef45` übernommen. Die Veranstalterkonsole bearbeitet aktive Meldungen unter Erhalt von Alter, Kartenpunkt und Act-Verknüpfung. Der unabhängige Review fand zwei zusätzliche Fehler; `b0ccae3` sperrt Formular/Zeilenaktionen während laufender Mutationen und weist inzwischen abgelaufene Meldungen mit 404 zurück. Regressionen prüfen den verzögerten PATCH samt Entwurfswiederherstellung und abgelaufene Zeilen sowohl bei Text-/Stufenänderung als auch beim Versuch einer Verlängerung.
- **PR #26:** Seine D08-Kartenimplementierung ist durch PR #33 (`d40a6fc`) ersetzt. Die aktuelle Karte und ihre Prüfungen für 320×568 und 320×640 bleiben erhalten. Nur die weiterhin relevante Wartebedingung aus `514a9b9` wurde im Branding-Live-Test angepasst: nach Reload auf frische Festivalfarbe warten. Kein erneuter Einbau der konkurrierenden älteren Kartenlogik.
- **iPhone und gemeinsame Anleitung:** Capacitor-Hülle, getrennte native Assets, öffentliche Einladungslinks, native Staging-CORS-Allowlist und geprüfter Crew-Tastaturfix sind erstmals Teil des gemeinsamen Integrationsbranches. CI prüft native Web-Assets und Crew-Chat in Chromium/Firefox/WebKit. `AGENTS.md`, `CLAUDE.md` und README verweisen auf aktuellen `main`, Winterplan und die jüngste Übergabe; alte Web-Backlogs sind historisch eingeordnet. Fehlende private DOKU, Xcode oder Gerät in Cloud-Läufen dürfen nicht als erledigte Prüfung ausgegeben werden.
- **Lokale Prüfungen:** Web-/Worker-Typprüfung, 21 Unit-/Native-Testdateien, Web-Build, 18 Chrome-Smoke-Fälle, fünf Chat-Regressionen und 17 Barrierefreiheitsansichten bestanden. 43 API-Tests sowie Migrationstest mit vier alten und 17 neuen Migrationen bestanden. Alle 29 Live-Szenarien bestanden im Nachlauf einschließlich verzögertem PATCH/Entwurfserhalt und frischem Branding. Der erste ausführbare Live-Lauf scheiterte vorher am bestehenden Zwei-Tab-Offlinetest (`Gleichzeitig B`); dieselbe Stelle bestand im Nachlauf, kein Produktcode dafür geändert. Lokale Sandbox-Versuche scheiterten zuvor am Loopback-Bind (EPERM), außerhalb der Sandbox liefen die lokalen Testserver. `ios:sync` sowie unsignierter generischer Xcode-Debug-Build bestanden; alle 53 Webdateien stimmen zwischen `dist-ios`, nativem Quellbundle und gebauter App überein. `git diff --check` und 53 lokale Linkziele in neun Repository-Dokumenten geprüft.
- **Review:** Luna Explorer prüfte PR #26 gegen PR #33, Astra Reviewer prüfte PR #53 und anschließend die native Integration auf Regressionen und veröffentlichbare Inhalte. Luna Worker korrigierte die beiden Meldungsfehler samt Regressionen. Root verantwortet Zusammenführung, Gesamtprüfung und Veröffentlichung des autorisierten Quellstands. Keine gefundenen Zugangsdaten, Signierungsidentitäten oder privaten Rohdaten im neuen Quellbestand.
- **Grenzen:** Kein neuer signierter/auf dem iPhone installierter Build, keine neue Geräteabnahme. Build 4 vom 13.11. bleibt der letzte tatsächlich geprüfte Gerätestand. A2b/B4, sichere native Sitzung und Store-Freigabe bleiben offen. Kein neuer automatischer Coding-Zeitplan oder API-Zugang eingerichtet; persönliche Hinweise zur täglichen lokalen/Cloud-Arbeit bleiben in DOKU.
- **Veröffentlichung und Übernahme:** [Integrations-PR #54](https://github.com/hhGrotDev95/Realm/pull/54) enthält den gemeinsamen Quellstand; die Übernahme nach `main` ist ausdrücklich autorisiert und an die Gesamt-CI gebunden. Da lokales `git push` keinen Schreiblogin hatte, wurde die verbundene GitHub-Integration verwendet. Der erste GitHub-Dateibaum `5e5755d5ba8292975bce8b579a2ed16cb37e78e3` stimmt exakt mit dem lokalen Code-Commit `b0ccae3` überein; PR #53 ist als Commit-Vorfahre erhalten. Die lokalen Sicherungscommits bleiben erhalten. Aktueller Merge-/CI-Status ist am PR, der tatsächliche Web-Deploy an [build-info.json](https://realm-staging.heidlhannes95.workers.dev/build-info.json) nachvollziehbar; die persönliche Abschlussübergabe hält den beobachteten Endstand fest. Die native CORS-Allowlist ist Teil dieses regulären Quellstands, nicht mehr nur ein separates Settings-PATCH.
- **Nächster konkreter Schritt:** A2b – native Sitzungs-/Tokenablage sowie Logout, Profilwechsel und Neustart prüfen und die Keychain-Lücke gezielt schließen. Danach die weiteren Integrationsgrenzen aus `docs/IPHONE_INTEGRATION.md` abnehmen. Keine Wiederholung des bereits abgeschlossenen Bedienpakets, keine V2-Arbeit.


### Nachprüfung der Integration · Zwei-Tab-Outbox und Profilgrenzen (16.11.2026)

Die erste GitHub-CI des Code-Stands `9d6e71f` bestand vollständig. Beim
anschließenden Dokumentationsstand `0d356564` bestand erneut Web/API/Firefox/WebKit,
aber der Live-Job [43875079964](https://github.com/hhGrotDev95/Realm/actions/runs/43875079964)
scheiterte an einer nach Wiederverbindung fehlenden/bis dahin unbestätigten
Nachricht im Zwei-Tab-Test. Zusammen mit dem früheren lokalen Aussetzer war dies
ein Anlass zur Ursachenprüfung, nicht nur zu einem erneuten CI-Start.

`mergeOutbox` nahm irrtümlich an: Wenn ein anderer Tab eine Aktion einmal gesehen
hat und sie in einem später eintreffenden Snapshot fehlt, sei sie gesendet.
Ein älterer Snapshot kann diese Annahme widerlegen. Der neue Unit-Fall reproduzierte
am alten Code deterministisch eine leere Warteschlange statt der erhaltenen
Nachricht. Die Korrektur verlangt ausdrückliche Abschluss-IDs; die bestehenden
Regeln für ersetzte Datenschutzentscheidungen bleiben erhalten. Bestätigte
Chatzeilen werden im selben Profil und derselben Crew gegen alte wartende Zeilen
geschützt; frische Serverstände einschließlich Moderation behalten Vorrang.

Der unabhängige Review ergänzte die Profilgrenze: Ein Tab übernimmt bei einer
anderen Profilkennung nur deren Warteschlange. Laufende Sends/Refreshes prüfen
ihren Sitzungskontext nach dem Warten; die Zustandsreferenz wechselt synchron.
Profilwiederherstellung und Löschung anderer gespeicherter Profile verwenden
anfragebezogene Tokens, ohne währenddessen den aktiven API-Token auszutauschen.
Eine echte Profilablösung verwirft die alte lokale Queue, die Wiederherstellung
desselben Profils erhält Queue/Bestätigungen und passende Crew-Daten.

Nach der finalen Runtime-Korrektur bestanden erneut Typprüfung, die gesamte
Unit-/Native-Suite (darunter 13 gezielte Outbox-Fälle), Web-Build, 18 Chrome-Smoke-
und fünf Chat-Regressionen. `ios:sync` und der unsignierte generische Xcode-Build
bestanden; alle 53 Webdateien stimmen zwischen Ausgabe, nativem Quellbundle und
gebauter App überein (zusätzlich zwei identische generierte Cordova-Stubs).

Die Live-Suite umfasst nun 30 Szenarien, darunter veraltete wartende Snapshots
nach bestätigter Zustellung, Profilwechsel während einer verzögerten Sendung und
Wiederherstellung desselben Profils mit wartenden Nachrichten. Die neuen Fälle
prüfen ausdrückliche Bestätigungen, Sitzungskontext und genau einmalige
Serverzustellung. Bei der Erweiterung wurden zwei Testabläufe korrigiert:
das verbliebene Profilfenster vor Navigation schließen und den Plan über die
Oberfläche samt Serverabgleich vorbereiten, statt einen laufenden leeren
Browserplan allein durch eine serverseitige Teständerung zu ersetzen.
Unabhängiger Review von Runtime und Regressionen ohne verbleibenden materiellen
Befund. Der Profilwechseltest verwendet ein synthetisches Speicherereignis;
die Authentifizierung bei Löschung mehrerer Profile ist nicht separat live geprüft.

Der veröffentlichte Stand wird vor Übernahme mit allen fünf GitHub-CI-Jobs
geprüft; vollständige Laufresultate, finaler Commit und Merge sind am
[Integrations-PR #54](https://github.com/hhGrotDev95/Realm/pull/54) nachvollziehbar.
Die persönliche Abschlussübergabe hält den tatsächlich beobachteten
main-/Staging-Stand und die öffentlichen CORS-Prüfungen fest.
Diese Browser-Sitzungsgrenzen ersetzen weiterhin keine native Keychain-Integration
oder Geräteabnahme; der nächste A2b-Schritt bleibt unverändert.


## Private Projektübersicht und Release-Abgleich (16.11.2026, Codex)

Auf Nutzerauftrag entsteht eine separate, mobile Projektübersicht auf Cloudflare.
Sie fasst den dokumentierten Stand, nächste Schritte, persönliche Entscheidungen,
Meilensteine und Test-/Adminlinks zusammen. Die öffentliche Realm-App und ihre
Anmeldung werden dadurch nicht verändert. Hannes hat den täglichen Claude-Lauf
laut eigener Angabe deaktiviert; kein neuer KI-Zeitplan wurde eingerichtet.

Der Balken zählt ausschließlich die verpflichtenden A–D-Punkte im Winterplan:
aktuell 3 von 17 abgeschlossen (18 %). Dies ist weder der Anteil fertigen Codes
noch eine Zeit- oder Store-Reife-Schätzung. Der Zeitplan ist gefährdet: der
6.-November-Prüfpunkt ist nicht vollständig erfüllt; Build 4 ist intern vorhanden,
weitere Geräteprüfungen und die Beta-/TestFlight-Voraussetzungen bleiben offen.

Die Zusammenfassung steht in `docs/PROJECT_STATUS.json`; der Build liest die
Checkboxen aus `docs/WINTER_RELEASE_PLAN.md`. Ändern sich Freigabepunkte oder die
jüngste datierte Übergabe, verlangt er eine erneute Prüfung der Zusammenfassung.
Ein separater GitHub-Workflow prüft und veröffentlicht Änderungen nach Übernahme
in `main`. Diese Veröffentlichung benötigt keinen eingeschalteten Laptop.
Sie aktualisiert den Status; sie führt keine tägliche KI-Entwicklung aus.

Der Status-Worker liefert HTML und JSON ausschließlich nach einer vom Cloudflare-
Runtime bestätigten Access-Identität und genauem Eigentümerabgleich. Fehlende
Konfiguration oder Identität sperrt die Auslieferung. Keine Static Assets,
Datenbank, Besucherprofile oder private DOKU-Dateien werden eingebunden.
Der separate Worker ist veröffentlicht. Access schützt sämtlichen Traffic mit
einer Allow-Regel ausschließlich für den Eigentümer; der zusätzliche genaue
Identitätsabgleich bleibt aktiv. Erfolgreiche Eigentümeranmeldung über Cloudflare
und vollständige Anzeige in Safari beobachtet. Vor Access waren sechs anonyme/
gefälschte Aufrufe mit 403 gesperrt, danach führten dieselben sechs zur Anmeldung
(302). 15 Unit-/Daten-/Drift-/Zugangstests bestanden; UI bei 320/390/1280 px,
verdoppelte Schrift, axe ohne schwere Befunde und Wrangler-Bundleprüfung bestanden.
Luna-Implementierungen für Daten/Renderer und unabhängiger Astra-Review eingesetzt.
Review-Funde behoben: Status-Driftkontrolle und main-Push-Trigger ohne Pfadfilter,
damit ein neuerer fachfremder Commit die einzige Veröffentlichung nicht unterdrückt.
Native A2b-/B4-Abnahme, Keychain und Store-Freigabe bleiben offen. Der neue
GitHub-Ablauf und sein tatsächliches Ergebnis folgen nach Übernahme; die bisher
veröffentlichte Erstausgabe ist noch als lokale Vorschau gekennzeichnet.

Hannes bestätigt am 16.11.: Die kostenpflichtige Apple-Developer-Mitgliedschaft
ist noch nicht eingerichtet. A1 bleibt offen; Personal-Team-Testbuilds sind
kein TestFlight-/App-Store-Zugang.


Der erste Portal-PR-Lauf fand unter Linux bei 320 px und 200-%-Schrift einen
horizontalen Überlauf. Lokal mit Arial reproduziert: Das nicht umbrechende
Zuständigkeitslabel „Hannes + Entwicklung“ war zu breit. Es darf jetzt innerhalb
seiner Spalte umbrechen. Der UI-Test prüft zusätzlich diese Schrift-Fallback-
Variante und nennt bei Überläufen die betroffenen Elemente. Das ist eine echte
Darstellungskorrektur; der Test wurde nicht abgeschwächt.


## Projektportal: automatische Veröffentlichung nachgewiesen (16.11.2026, Codex)

[PR #55](https://github.com/hhGrotDev95/Realm/pull/55) ist nach vollständig grüner
[PR-CI](https://github.com/hhGrotDev95/Realm/actions/runs/43889887632) und
[Portal-Prüfung](https://github.com/hhGrotDev95/Realm/actions/runs/43889887693)
in `main` übernommen (`0ab654d8`). Der folgende automatische
[Portal-Lauf 43891577824](https://github.com/hhGrotDev95/Realm/actions/runs/43891577824)
bestand einschließlich echter Veröffentlichung und sechs anonymen/gefälschten
Zugriffsprüfungen. Cloudflare-Version `83352637-2e2a-42cf-9613-b396be513bc1`.
Die Statusseite steht unter <https://realm-project-status.heidlhannes95.workers.dev>.
Nach Neuladen zeigte Safari unter bestehender Eigentümeranmeldung ausdrücklich
`Commit 0ab654d8`, keine lokale Vorschau; der automatische Inhalt ist damit im
Browser beobachtet.
Eigentümeranmeldung über Cloudflare ist belegt; Zugang ausschließlich für den
Eigentümer, öffentliche Festival-App unabhängig davon.

15 Portal-Unitprüfungen und vier UI-Varianten bestehen. Der Nachtrag ändert nur
Dokumentation und kuratierte Statusdaten; Anwendung, Backend, Access-Code und
Workflow bleiben unverändert. Er wird über einen geprüften Dokumentations-PR
veröffentlicht und verwendet danach dieselbe automatische Portal-Pipeline.
Quellcommit und Erzeugungsdatum sind auf der Seite ablesbar; das fachliche
Prüfdatum bleibt getrennt. Persönliche Kontodaten und Gerätebelege bleiben in DOKU.

Hannes bestätigt Claude-Zeitplan deaktiviert und bezahlte Apple-Mitgliedschaft
noch nicht eingerichtet. Kein neuer täglicher KI-Lauf, keine neue API-Abrechnung,
keine zusätzliche iPhone-Installation. 3/17 Freigabepunkte; Novembertermine
gefährdet. Nächster Entwicklungsschritt: sichere native Sitzung/Keychain mit
Logout, Profilwechsel und Neustart; Hannes klärt parallel Apple-Konto und
Betreiber-/Rechtsangaben. A2b/B4 und Store-Freigabe bleiben offen.
