# Realm – Fortschritt

Stand: 19.10.2026 · Branch `claude/realm-next`

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

- Migration `0002_announcements.sql`; `GET /api/announcements` öffentlich (ohne Profil, 20 s cachebar).
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

## Prüfläufe

| Prüfung | Ergebnis |
| --- | --- |
| `npm run typecheck` (Web) · `cd worker && npm run typecheck` | ohne Fehler |
| `cd worker && npm test` | 18 API-Tests bestanden |
| `npm run build && npm run test:e2e` (Demo-Modus) | 8 Abläufe bestanden |
| `npm run test:live` (2 Nutzer, echte API, lokale D1) | 11 Szenarien bestanden |

## Nächste Schritte

1. Deployment auf Cloudflare (braucht Konto/Freigabe): `wrangler d1 create`, Migrationen, `ADMIN_TOKEN` setzen, Web-App mit `VITE_API_URL` bauen.
2. Web-Push für Meetups und offizielle Warnungen (VAPID-Schlüssel nötig).
3. Admin-Oberfläche im Browser statt CLI; Timetable aus dem Backend.
