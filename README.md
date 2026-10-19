# Realm – Festival Companion (V2)

Mobile-first Web-App für ein Festival („Realm Open Air 2027“, Demo-Daten). Leitprinzip: **V1 zeigt alle Möglichkeiten – V2 zeigt nur, was gerade relevant ist.**

```bash
npm install
npm run dev      # Demo-Modus ohne Backend: http://localhost:5173
npm run build
```

### Mit Backend (lokal)

```bash
cd worker && npm install && npm run migrate:local && npm run dev   # API auf :8787
npm run dev:live                                                     # Web-App gegen die lokale API
```

Ohne `VITE_API_URL` läuft die App im Demo-Modus mit Beispiel-Crew. Mit gesetzter Variable sind Crew, Chat, Meetups, Meldungen, Plan-Abgleich und Profil-Sicherung echt und geräteübergreifend.

## Struktur

| Tab | Beantwortet |
| --- | --- |
| **Home** | Was ist gerade wichtig? – passt sich der Festivalphase an (Vorher · Anreise · Festival · Abreise · Danach) |
| **Line-up** | Was läuft, was habe ich geplant? – `Mein Plan \| Alle`, Sticky-Day-Picker, Suche/Filter als Icons, Liste oder Timeline |
| **Map** | Wo ist etwas? – Vollbild, Pan/Pinch/Zoom, Kategorien, Ebenen (Freunde, Meldungen, Pins, Satellit), Route |
| **Crew** | Wo sind meine Leute? – Gruppen pro Stage, nächster gemeinsamer Act, Meetups, Chat, Step-Challenge, Standort teilen |

Profil & Einstellungen öffnen sich über den Avatar oben rechts (dort auch der **Demo-Phasenwechsler**).

## Features

- **Gastmodus ohne Login**: zufällige pseudonyme ID; Name + Farbe werden erst beim ersten sozialen Feature abgefragt; optional sichern per Passkey, Apple/Google oder Recovery-Code.
- **Konflikt-Resolver**: Überschneidungen als eine kompakte Zeile („19:30–20:30 · 3 Acts“), Entscheidung mit Crew-Verteilung, Laufweg, Community-Tendenz – plus **Battle-Modus** (K.-o.-Duell).
- **Updates-Center**: Offiziell / Community bestätigt / Unbestätigt / App-Hinweis, mit Ort, Alter und Ablauf; „Stimmt noch“ / „Behoben“; eigene Meldungen laufen nach 60 Min. ab. Home zeigt maximal zwei.
- **Meetups kontextuell**: aus Act („Vor diesem Set treffen“), Kartenpunkt („Hier treffen“) oder Chatnachricht („In Meetup umwandeln“).
- **Festival Wrapped** (Phase „Danach“): Story-Slides; „Warst du da?“-Abfragen trennen *geplant* von *besucht*.
- **Step-Challenge**: explizites Opt-in, nur Tagessumme, crew-intern, „Top 10 %“ statt öffentlichem Rang.
- Zustand lokal persistiert (localStorage), Bottom-Sheets mit Drag-to-dismiss & Escape, Tap auf aktiven Tab scrollt nach oben, `prefers-reduced-motion` respektiert.

## Backend (`worker/`)

Cloudflare Worker (Hono) + D1 (SQLite). Kein Login: `POST /api/guests` erzeugt eine pseudonyme ID und ein Bearer-Token (gespeichert wird nur der SHA-256-Hash).

| Bereich | Endpunkte |
| --- | --- |
| Profil | `POST /api/guests`, `GET/PATCH/DELETE /api/me`, `POST /api/me/recovery`, `POST /api/restore`, `PUT /api/me/plan`, `PUT/DELETE /api/me/steps` |
| Crew | `POST /api/crews`, `POST /api/crews/join`, `GET /api/crews/:id` (Snapshot), `POST /api/crews/:id/leave`, `PUT /api/crews/:id/location`, `POST /api/crews/:id/messages`, `POST /api/crews/:id/meetups` |
| Moderation | `DELETE /api/crews/:id/messages/:msgId` (eigene / Gründer:in), `POST /api/crews/:id/messages/:msgId/flag` (ab 2 Meldungen ausgeblendet), `DELETE /api/crews/:id/members/:guestId` (Gründer:in, sperrt Wiederbeitritt) |
| Meetups | `PUT /api/meetups/:id/rsvp`, `DELETE /api/meetups/:id` |
| Meldungen | `GET/POST /api/reports`, `PUT /api/reports/:id/vote` |
| Offiziell | `GET /api/announcements` (öffentlich), `POST/PATCH/DELETE /api/admin/announcements[/:id]` (Admin-Token) |

Veranstalter-Konsole im Browser: `/#admin` (Anmeldung mit dem Admin-Token, gespeichert nur für den Tab). Dort lassen sich Meldungen veröffentlichen/entfernen und Acts verschieben, umziehen oder absagen; Änderungen erscheinen innerhalb einer Minute in der App. Timetable-Änderungen: `GET /api/timetable/changes`, `PUT/DELETE /api/admin/timetable/:actId`.

Alternativ per CLI:

```bash
cd worker
npx wrangler secret put ADMIN_TOKEN                     # einmalig; lokal: .dev.vars mit ADMIN_TOKEN=…
REALM_API=https://… REALM_ADMIN_TOKEN=… npm run announce -- add "Gewitterwarnung ab 22:30" --severity warning --valid 180
REALM_API=https://… npm run announce -- list
REALM_API=https://… REALM_ADMIN_TOKEN=… npm run announce -- remove <id>
```

Datenschutz und Missbrauchsschutz:

- Soziale Aktionen erfordern einen Namen, aber nie E-Mail oder Telefonnummer.
- Standort nur als Stage-Bereich und nur, solange aktiv geteilt; Schritte nur als Tagessumme.
- `DELETE /api/me` löscht Profil und alle abhängigen Daten (Crews ohne weitere Mitglieder inklusive).
- Recovery-Codes werden nur gehasht gespeichert; Wiederherstellen rotiert das Token.
- Meldungen laufen nach 60 Min. ab, „Stimmt noch“ verlängert um 30 Min., zwei „Behoben“ (oder die meldende Person) beenden sie.
- Rate-Limits pro Gast bzw. IP; ein stündlicher Cron räumt abgelaufene Daten auf.

Frontend-Sync: Crew-Snapshot und Meldungen werden alle 8 s (nur bei sichtbarem Tab) abgefragt; Plan-Änderungen werden entprellt hochgeladen. Offizielle Meldungen werden für alle (auch ohne Profil) minütlich geladen und offline zwischengespeichert.

Offline-Warteschlange: Chat, Meetups, Zusagen, Votes und Meldungen landen zuerst in einer lokal gespeicherten Outbox und werden der Reihe nach gesendet, sobald Netz da ist. Client-IDs machen Wiederholungen serverseitig idempotent.

### Deployment

```bash
cd worker
npx wrangler d1 create realm          # database_id in wrangler.toml eintragen
npm run migrate:remote
npm run deploy                        # ALLOWED_ORIGINS in wrangler.toml auf die Web-Domain setzen
# Web-App mit VITE_API_URL=https://realm-api.<account>.workers.dev bauen
```

## Tests

- `npm run test:e2e` – Smoke-Test der Demo-App (7 Abläufe)
- `cd worker && npm test` – 16 API-Integrationstests gegen `wrangler dev` mit lokaler D1
- `npm run test:live` – zwei Browser-Nutzer gegen die echte API (Crew gründen, per Link beitreten, Chat, Meetup-Zusage, geteilte Pläne, Meldung bestätigen, Wiederherstellung auf neuem Gerät)

## Visuelles System

Violett nur für Marke und primäre Aktionen · Stage-Farben nur als Punkt/Kante · Grün = live/bestätigt, Amber = Warnung, Rot = kritisch · Uppercase nur für Mini-Labels · ein primärer Button pro Card.

Stack: Vite, React 19, TypeScript, Framer Motion, Lucide.
