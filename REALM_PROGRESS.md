# Realm – Fortschritt

Stand: 19.10.2026

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

## Nächste Schritte

1. Bundle unter 500 kB bringen (Build warnt inzwischen): Karte, Wrapped und Sheets nachladen.
2. Deployment auf Cloudflare (braucht Konto/Freigabe).
3. Web-Push für Meetups, Planänderungen und offizielle Warnungen (VAPID-Schlüssel nötig).
